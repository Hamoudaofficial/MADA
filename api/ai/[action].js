const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const CFG = {
  gemini: { rpd: 250 },
  groq: { rpd: 1000 },
  cloudflare: { rpd: 400 },
  embeddings: { model: "@cf/baai/bge-m3", dim: 1024 }
};
const E = process.env;
const CONF = require("../_mada-ai-config");
const PR = require("../_mada-ai-prompt");
let _sql;
const q = (t, p) => { if (!_sql) _sql = neon(E.NEON_DATABASE_URL); return _sql.query(t, p || []); };

const EU = "AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IE,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE,IS,LI,NO";
const blockedRegion = c => {
  c = String(c || "").toUpperCase();
  return (E.AI_BLOCK_GEMINI_REGIONS || "EU,GB,CH").split(",").map(s => s.trim().toUpperCase())
    .some(r => r === "EU" ? EU.split(",").includes(c) : r === c);
};

async function authUser(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) return null;
  try {
    const r = await fetch(E.SUPABASE_URL + "/auth/v1/user", { headers: { apikey: E.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id } : null;
  } catch (e) { return null; }
}

const adminIds = () => (E.AI_ADMIN_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const limitFor = uid => adminIds().includes(uid) ? +(E.AI_ADMIN_DAILY_LIMIT || 300) : +(E.AI_DAILY_USER_LIMIT || 30);

async function takeQuota(uid) {
  const lim = limitFor(uid);
  const r = await q("insert into ai_usage(user_id,day,requests) values($1,current_date,1) on conflict (user_id,day) do update set requests=ai_usage.requests+1 where ai_usage.requests<$2 returning requests", [uid, lim]);
  return r.length > 0;
}
const refundQuota = uid => q("update ai_usage set requests=greatest(requests-1,0) where user_id=$1 and day=current_date", [uid]).catch(() => {});
async function quotaInfo(uid) {
  const r = await q("select requests from ai_usage where user_id=$1 and day=current_date", [uid]);
  const d = new Date(); const reset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return { used: r[0] ? r[0].requests : 0, limit: limitFor(uid), resets_at: reset.toISOString() };
}

/* ---------- providers: عدة مفاتيح لكل مزوّد (Vercel env فقط) ----------
   GROQ_API_KEY, GROQ_API_KEY_2.._10, أو GROQ_API_KEYS=a,b,c  (نفس الشيء لـ GEMINI_API_KEY)
   Cloudflare: CF_API_TOKEN (+ CF_ACCOUNT_ID) و CF_API_TOKEN_2 (+ CF_ACCOUNT_ID_2 اختياري) */
const collect = base => {
  const v = [];
  const add = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean).forEach(x => { if (!v.includes(x)) v.push(x); });
  add(E[base]); add(E[base + "S"]);
  for (let i = 1; i <= 10; i++) add(E[base + "_" + i]);
  return v;
};
const cfKeys = () => {
  const v = [];
  const add = (t, a) => { t = String(t || "").trim(); a = String(a || E.CF_ACCOUNT_ID || "").trim(); if (t && a && !v.some(x => x.k === t)) v.push({ k: t, acc: a }); };
  add(E.CF_API_TOKEN, E.CF_ACCOUNT_ID);
  for (let i = 1; i <= 10; i++) add(E["CF_API_TOKEN_" + i], E["CF_ACCOUNT_ID_" + i]);
  return v;
};
const KEYS = { gemini: () => collect("GEMINI_API_KEY").map(k => ({ k })), groq: () => collect("GROQ_API_KEY").map(k => ({ k })), cloudflare: cfKeys };
const have = {};
for (const p in KEYS) have[p] = () => KEYS[p]().length > 0;

/* Round-Robin + تجاوز المفتاح المستنفد/الفاشل مؤقتًا (في ذاكرة النسخة) */
const rr = {}, cool = new Map();
const kid = (p, x) => p + ":" + x.k.slice(-8);
const coolKey = (p, x, ms) => cool.set(kid(p, x), Date.now() + ms);
const msToMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime(); };
const liveKeys = p => {
  const ks = KEYS[p](); if (!ks.length) return [];
  const s = rr[p] = ((rr[p] || 0) + 1) % ks.length;
  return ks.map((_, i) => ks[(s + i) % ks.length]).filter(x => (cool.get(kid(p, x)) || 0) <= Date.now());
};

/* توجيه التكلفة: light = سريع رخيص، mid = متوسط، heavy = أقوى */
function pickOrder(text, opts) {
  const heavy = text.length > 1500 || /```|برمج|كود|حلل|تحليل|function|code|analy[sz]e|debug|sql|regex/i.test(text) || opts.attachments;
  const tier = heavy ? "heavy" : text.length <= PR.LIGHT_MAX_CHARS ? "light" : "mid";
  let order = heavy ? ["gemini", "groq", "cloudflare"] : ["groq", "gemini", "cloudflare"];
  order = order.filter(p => have[p]());
  if (opts.private || opts.region) order = order.filter(p => p !== "gemini");
  order.tier = tier;
  return order;
}
const modelFor = (p, tier) => p === "groq" ? (tier === "light" ? PR.MODELS.groq.light : PR.MODELS.groq.strong) : PR.MODELS[p];

async function* sse(res) {
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/); buf = parts.pop();
    for (const p of parts) {
      const d = p.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (d && d !== "[DONE]") { try { yield JSON.parse(d); } catch (e) {} }
    }
  }
}

const open = {
  async gemini(msgs, sys, sig, x, m, mt) {
    /* هامش إضافي لأن tokens التفكير في Gemini تُحسب ضمن الحد */
    const body = { systemInstruction: { parts: [{ text: sys }] }, contents: msgs.map(z => ({ role: z.role === "assistant" ? "model" : "user", parts: [{ text: z.content }] })), generationConfig: { maxOutputTokens: mt + 1024 } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`, { method: "POST", signal: sig, headers: { "Content-Type": "application/json", "x-goog-api-key": x.k }, body: JSON.stringify(body) });
    return { r, pick: j => ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(z => z.text || "").join("") };
  },
  async groq(msgs, sys, sig, x, m, mt) {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", signal: sig, headers: { "Content-Type": "application/json", Authorization: "Bearer " + x.k }, body: JSON.stringify({ model: m, stream: true, max_tokens: mt, messages: [{ role: "system", content: sys }, ...msgs] }) });
    return { r, pick: j => (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || "" };
  },
  async cloudflare(msgs, sys, sig, x, m, mt) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${x.acc}/ai/run/${m}`, { method: "POST", signal: sig, headers: { "Content-Type": "application/json", Authorization: "Bearer " + x.k }, body: JSON.stringify({ stream: true, max_tokens: mt, messages: [{ role: "system", content: sys }, ...msgs] }) });
    return { r, pick: j => j.response || "" };
  }
};

async function blockedSet() {
  const r = await q("select provider from ai_provider_state where day=current_date and blocked_until>now()");
  return new Set(r.map(x => x.provider));
}
async function usageMap() {
  const r = await q("select provider,requests from ai_provider_state where day=current_date");
  return Object.fromEntries(r.map(x => [x.provider, x.requests]));
}
const block = (p, daily) => q(`insert into ai_provider_state(provider,day,blocked_until) values($1,current_date,${daily ? "date_trunc('day',now())+interval '1 day'" : "now()+interval '60 seconds'"}) on conflict (provider,day) do update set blocked_until=excluded.blocked_until`, [p]).catch(() => {});
const countReq = p => q("insert into ai_provider_state(provider,day,requests) values($1,current_date,1) on conflict (provider,day) do update set requests=ai_provider_state.requests+1", [p]).catch(() => {});

/* يبث من أول مفتاح/مزوّد سليم؛ التحويل التلقائي يحدث قبل أول token فقط */
async function* run(order, msgs, sys, abort) {
  const tier = order.tier || "mid", mt = PR.MAX_TOKENS[tier] || 800;
  const blocked = await blockedSet(), used = await usageMap();
  const hot = p => used[p] >= 0.8 * (CFG[p].rpd || 1e9) * Math.max(1, KEYS[p]().length);
  const chain = [...order.filter(p => !blocked.has(p) && !hot(p)), ...order.filter(p => !blocked.has(p) && hot(p))];
  for (const p of chain) {
    let tried = 0;
    for (const x of liveKeys(p)) {
      tried++;
      const ctl = new AbortController(), onAbort = () => ctl.abort(); abort.addEventListener("abort", onAbort);
      const timer = setTimeout(() => ctl.abort(), 20000);
      try {
        const { r, pick } = await open[p](msgs, sys, ctl.signal, x, modelFor(p, tier), mt);
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          clearTimeout(timer);
          coolKey(p, x, r.status === 429 ? (/per\s*day|daily|PerDay/i.test(t) ? msToMidnight() : 60000) : (r.status === 401 || r.status === 403) ? 600000 : 20000);
          continue;
        }
        let first = true;
        for await (const j of sse(r)) {
          const t = pick(j); if (!t) continue;
          if (first) { first = false; clearTimeout(timer); countReq(p); yield { engine: p }; }
          yield { text: t };
        }
        clearTimeout(timer);
        if (!first) return;
        coolKey(p, x, 20000);
      } catch (e) {
        clearTimeout(timer);
        if (abort.aborted) return;
        coolKey(p, x, 20000);
      } finally { abort.removeEventListener("abort", onAbort); }
    }
    if (tried) await block(p, false);
  }
  yield { fail: true };
}

/* ---------- memory ---------- */
async function embed(text) {
  const x = KEYS.cloudflare()[0];
  if (!x) return null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${x.acc}/ai/run/${CFG.embeddings.model}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + x.k }, body: JSON.stringify({ text: [text.slice(0, 2000)] }) });
    const j = await r.json(); const v = j.result && j.result.data && j.result.data[0];
    return Array.isArray(v) && v.length === CFG.embeddings.dim ? "[" + v.join(",") + "]" : null;
  } catch (e) { return null; }
}
async function memoryOn(uid) {
  const r = await q("select memory_enabled from ai_settings where user_id=$1", [uid]);
  return r[0] ? r[0].memory_enabled : true;
}
async function recall(uid, text) {
  const v = await embed(text);
  const rows = v
    ? await q("select content from ai_memories where user_id=$1 and embedding is not null order by embedding <=> $2::vector limit 5", [uid, v])
    : await q("select content from ai_memories where user_id=$1 order by created_at desc limit 5", [uid]);
  let out = "", n = 0;
  for (const r of rows) { if (n + r.content.length > 2000) break; out += "- " + r.content + "\n"; n += r.content.length; }
  return out;
}
async function remember(uid, content) {
  const v = await embed(content);
  await q("insert into ai_memories(user_id,content,kind,embedding) values($1,$2,'fact',$3::vector)", [uid, content.slice(0, 500), v]);
}
const REM = /^\s*(?:تذكّر|تذكر|احفظ في ذاكرتك|remember(?: that)?)\s*[:،,-]?\s*(.{3,500})$/is;

/* ---------- الـ Prompt: افتراضي من _mada-ai-prompt.js ويتجاوزه نص الأدمن من Neon ---------- */
let _pT, _pc = { t: 0, v: null };
const promptT = () => _pT || (_pT = q("create table if not exists ai_prompt(id int primary key, content text not null, updated_by uuid, updated_at timestamptz not null default now())").then(() => true, () => { _pT = null; return false; }));
async function getPrompt() {
  if (_pc.v !== null && Date.now() - _pc.t < 60000) return _pc.v;
  let v = PR.SYSTEM;
  try { if (await promptT()) { const r = await q("select content from ai_prompt where id=1"); if (r[0] && r[0].content) v = r[0].content; } } catch (e) {}
  _pc = { t: Date.now(), v };
  return v;
}

/* ---------- كاش الإجابات المتكررة (Neon) ---------- */
let _cT;
const cacheT = () => _cT || (_cT = q("create table if not exists ai_answer_cache(h text primary key, answer text not null, created_at timestamptz not null default now())").then(() => true, () => { _cT = null; return false; }));
const NOCACHE = /اليوم|الآن|حاليا|حالياً|الحالي|آخر|أخبار|اخبار|سعر|today|now|current|latest|news|price/i;

const fail = (res, s, code) => res.status(s).json({ error: code });
const parse = b => { if (typeof b === "string") { try { return JSON.parse(b); } catch (e) { return {}; } } return b || {}; };

async function health(res) {
  let neonOk = false, neonErr = "";
  try { await q("select 1"); neonOk = true; } catch (e) { neonErr = String(e.message || e).slice(0, 120); }
  res.json({ env: { NEON_DATABASE_URL: !!E.NEON_DATABASE_URL, SUPABASE_URL: !!E.SUPABASE_URL, SUPABASE_ANON_KEY: !!E.SUPABASE_ANON_KEY, GEMINI_API_KEY: !!E.GEMINI_API_KEY, GROQ_API_KEY: !!E.GROQ_API_KEY, CF: have.cloudflare() }, keys: { gemini: KEYS.gemini().length, groq: KEYS.groq().length, cloudflare: KEYS.cloudflare().length }, neon: neonOk, neon_error: neonErr });
}
async function simple(action, req, res) {
  const u = await authUser(req);
  if (!u) return fail(res, 401, "unauthorized");
  if (action === "quota") return res.json(await quotaInfo(u.id));
  if (action === "memory") {
    if (req.method === "DELETE") { await q("delete from ai_memories where user_id=$1", [u.id]); return res.json({ ok: true }); }
    const rows = await q("select id,content,created_at from ai_memories where user_id=$1 order by created_at desc limit 100", [u.id]);
    return res.json({ enabled: await memoryOn(u.id), items: rows });
  }
  if (req.method === "GET") return res.json({ memory_enabled: await memoryOn(u.id) });
  const b = parse(req.body);
  if (req.method !== "POST" || typeof b.memory_enabled !== "boolean") return fail(res, 400, "bad_request");
  await q("insert into ai_settings(user_id,memory_enabled) values($1,$2) on conflict (user_id) do update set memory_enabled=$2,updated_at=now()", [u.id, b.memory_enabled]);
  res.json({ ok: true });
}

/* أدمن فقط: GET يقرأ الـ Prompt الحالي، POST {prompt} يحفظ، POST {reset:true} يعيد الافتراضي */
async function promptAdmin(req, res) {
  const u = await authUser(req);
  if (!u) return fail(res, 401, "unauthorized");
  if (!adminIds().includes(u.id)) return fail(res, 403, "unauthorized");
  if (req.method === "GET") { const v = await getPrompt(); return res.json({ prompt: v, is_default: v === PR.SYSTEM }); }
  if (req.method !== "POST") return fail(res, 405, "bad_request");
  const b = parse(req.body);
  if (!(await promptT())) return fail(res, 503, "providers_busy");
  if (b.reset === true) await q("delete from ai_prompt where id=1");
  else if (typeof b.prompt === "string" && b.prompt.trim().length >= 20 && b.prompt.length <= PR.PROMPT_MAX) await q("insert into ai_prompt(id,content,updated_by) values(1,$1,$2) on conflict (id) do update set content=$1,updated_by=$2,updated_at=now()", [b.prompt.trim(), u.id]);
  else return fail(res, 400, "bad_request");
  _pc = { t: 0, v: null };
  res.json({ ok: true });
}

const chatHit = new Map();
async function chat(req, res) {
  if (req.method !== "POST") return fail(res, 405, "bad_request");
  const user = await authUser(req);
  if (!user) return fail(res, 401, "unauthorized");
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  const text = b && typeof b.message === "string" ? b.message.trim() : "";
  if (!text || text.length > 8000) return fail(res, 400, "bad_request");
  const priv = b.private === true, region = blockedRegion(req.headers["x-vercel-ip-country"]);
  const order = pickOrder(text, { private: priv, region, attachments: !!(b.attachments && b.attachments.length) });
  if (!order.length) return res.status(503).json({ error: region ? "region_restricted" : "providers_busy", detail: "no AI provider key configured (set GROQ_API_KEY and/or GEMINI_API_KEY in Vercel)" });
  if (mkRate(chatHit, PR.CHAT_PER_MINUTE)(user.id)) return fail(res, 429, "rate_limited");
  if (!(await takeQuota(user.id))) return fail(res, 429, "quota_exceeded");

  try {
    let conv = b.conversation_id;
    if (conv) {
      const ok = await q("select 1 from ai_conversations where id=$1 and user_id=$2", [conv, user.id]).catch(() => []);
      if (!ok.length) conv = null;
    }
    if (!conv) conv = (await q("insert into ai_conversations(user_id,title) values($1,$2) returning id", [user.id, text.slice(0, 60)]))[0].id;

    const hist = (await q("select role,content from ai_messages where conversation_id=$1 and role in ('user','assistant') order by created_at desc limit $2", [conv, PR.HIST_MESSAGES])).reverse().map(m => ({ role: m.role, content: String(m.content).slice(0, PR.HIST_MSG_CHARS) }));
    if (order.tier === "light" && hist.length > 2) order.tier = "mid";
    const memOn = !priv && await memoryOn(user.id);
    const base = await getPrompt();
    let sys = base + "\n\n" + PR.PLATFORM, mem = "";
    if (order.tier === "heavy") sys += "\n\n" + PR.HEAVY_NOTE;
    if (memOn) { mem = await recall(user.id, text); if (mem) sys += "\n\nمعلومات يحفظها المستخدم عن نفسه (استخدمها عند الصلة فقط):\n" + mem; }

    await q("insert into ai_messages(conversation_id,role,content) values($1,'user',$2)", [conv, text]);
    const saved = memOn ? text.match(REM) : null;
    if (saved) await remember(user.id, saved[1].trim()).catch(() => {});

    const cacheable = !priv && !hist.length && !saved && !mem && order.tier !== "heavy" && text.length <= PR.CACHE.MAX_Q && !NOCACHE.test(text) && !(b.attachments && b.attachments.length);
    const ckey = crypto.createHash("sha256").update(base + PR.PLATFORM + "|" + text.toLowerCase().replace(/\s+/g, " ")).digest("hex");
    let hit = null;
    if (cacheable && await cacheT()) {
      const c = await q("select answer from ai_answer_cache where h=$1 and created_at>now()-($2||' days')::interval", [ckey, String(PR.CACHE.TTL_DAYS)]).catch(() => []);
      if (c[0]) hit = c[0].answer;
    }

    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    ev("meta", { conversation_id: conv });
    const ac = new AbortController(); res.on("close", () => ac.abort());

    let engine = "", out = "", failed = false;
    if (hit) { engine = "cache"; out = hit; ev("meta", { conversation_id: conv, engine }); ev("delta", { text: hit }); }
    else for await (const x of run(order, [...hist, { role: "user", content: text }], sys, ac.signal)) {
      if (x.engine) { engine = x.engine; ev("meta", { conversation_id: conv, engine }); }
      else if (x.text) { out += x.text; ev("delta", { text: x.text }); }
      else if (x.fail) failed = true;
    }
    if (out) {
      await q("insert into ai_messages(conversation_id,role,content,engine) values($1,'assistant',$2,$3)", [conv, out, engine]).catch(() => {});
      await q("update ai_conversations set updated_at=now() where id=$1", [conv]).catch(() => {});
      if (cacheable && engine !== "cache" && await cacheT()) await q("insert into ai_answer_cache(h,answer) values($1,$2) on conflict (h) do update set answer=excluded.answer,created_at=now()", [ckey, out]).catch(() => {});
      ev("done", { engine, quota: await quotaInfo(user.id).catch(() => null) });
    } else if (!ac.signal.aborted) {
      if (failed) await refundQuota(user.id);
      ev("error", { code: "providers_busy" });
    }
    res.end();
  } catch (e) {
    await refundQuota(user.id);
    if (!res.headersSent) return fail(res, 503, "providers_busy");
    res.write(`event: error\ndata: ${JSON.stringify({ code: "providers_busy" })}\n\n`); res.end();
  }
}

/* ---------- conversations (list / open / delete) ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function convs(action, req, res) {
  const u = await authUser(req);
  if (!u) return fail(res, 401, "unauthorized");
  if (action === "conversations") {
    if (req.method !== "GET") return fail(res, 405, "bad_request");
    return res.json({ items: await q("select id,title,updated_at from ai_conversations where user_id=$1 order by updated_at desc limit 50", [u.id]) });
  }
  const id = String((req.query && req.query.id) || "");
  if (!UUID.test(id)) return fail(res, 400, "bad_request");
  if (req.method === "DELETE") {
    const r = await q("delete from ai_conversations where id=$1 and user_id=$2 returning id", [id, u.id]);
    if (!r.length) return fail(res, 404, "not_found");
    q("insert into ai_audit(user_id,action,payload) values($1,'conversation_delete',$2::jsonb)", [u.id, JSON.stringify({ id })]).catch(() => {});
    return res.json({ ok: true });
  }
  if (req.method === "GET") {
    if (!(await q("select 1 from ai_conversations where id=$1 and user_id=$2", [id, u.id])).length) return fail(res, 404, "not_found");
    return res.json({ messages: await q("select role,content from ai_messages where conversation_id=$1 and role in ('user','assistant') order by created_at asc limit 200", [id]) });
  }
  return fail(res, 405, "bad_request");
}

/* ---------- comment tools (compose / summarize) ---------- */
const burst = new Map();
const tooFast = uid => {
  const n = Date.now(), a = (burst.get(uid) || []).filter(t => n - t < 60000);
  if (a.length >= CONF.ASSIST.PER_MINUTE) { burst.set(uid, a); return true; }
  a.push(n); burst.set(uid, a); return false;
};
const clean = s => String(s || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, " ").replace(/<[^>]*>/g, " ").replace(/[<>]/g, "").trim();
async function assist(req, res) {
  if (req.method !== "POST") return fail(res, 405, "bad_request");
  const u = await authUser(req);
  if (!u) return fail(res, 401, "unauthorized");
  const b = parse(req.body), A = CONF.ASSIST, mode = b.mode, text = typeof b.text === "string" ? clean(b.text) : "";
  const max = mode === "compose" ? A.COMPOSE_IN_MAX : mode === "summarize" ? A.SUMMARY_IN_MAX : 0;
  if (!max || !text || text.length > max) return fail(res, 400, "bad_request");
  const region = blockedRegion(req.headers["x-vercel-ip-country"]);
  const order = pickOrder(text, { region });
  if (!order.length) return res.status(503).json({ error: region ? "region_restricted" : "providers_busy" });
  if (tooFast(u.id)) return fail(res, 429, "rate_limited");
  if (!(await takeQuota(u.id))) return fail(res, 429, "quota_exceeded");
  const ac = new AbortController(); res.on("close", () => ac.abort());
  const sys = mode === "compose" ? A.COMPOSE_SYSTEM : A.SUMMARY_SYSTEM;
  const msg = mode === "compose" ? "<idea>" + text + "</idea>" : "<comment>" + text + "</comment>";
  let out = "";
  try { for await (const x of run(order, [{ role: "user", content: msg }], sys, ac.signal)) if (x.text) out += x.text; } catch (e) {}
  out = clean(out).replace(/^["«“]+|["»”]+$/g, "").slice(0, mode === "compose" ? A.COMPOSE_OUT_MAX : A.SUMMARY_OUT_MAX).trim();
  if (!out) { await refundQuota(u.id); return res.status(503).json({ error: "providers_busy" }); }
  res.json({ text: out });
}

/* ---------- post summary (psum) + Neon cache ---------- */
const mkRate = (map, lim) => uid => {
  const n = Date.now(), a = (map.get(uid) || []).filter(t => n - t < 60000);
  if (a.length >= lim) { map.set(uid, a); return true; }
  a.push(n); map.set(uid, a); return false;
};
const psGen = new Map(), psHit = new Map();
let _psT;
const psTable = () => _psT || (_psT = q("create table if not exists ai_post_summaries(post_id uuid primary key,body_hash text not null,summary text not null,created_at timestamptz not null default now())").then(() => true, () => { _psT = null; return false; }));
/* النص يُقرأ من قاعدة البيانات بجلسة المستخدم نفسها (RLS)، ولا يُؤخذ من العميل */
async function postBody(req, id) {
  try {
    const r = await fetch(`${E.SUPABASE_URL}/rest/v1/posts?id=eq.${id}&deleted_at=is.null&select=body&limit=1`, { headers: { apikey: E.SUPABASE_ANON_KEY, Authorization: req.headers.authorization } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j[0] && typeof j[0].body === "string" ? j[0].body : null;
  } catch (e) { return null; }
}
async function psum(req, res) {
  if (req.method !== "POST") return fail(res, 405, "bad_request");
  const u = await authUser(req);
  if (!u) return fail(res, 401, "unauthorized");
  const P = CONF.POST_SUMMARY, id = String(parse(req.body).post_id || "");
  if (!UUID.test(id)) return fail(res, 400, "bad_request");
  if (mkRate(psHit, P.CACHED_PER_MINUTE)(u.id)) return fail(res, 429, "rate_limited");
  const raw = await postBody(req, id);
  if (raw === null) return fail(res, 404, "not_found");
  const text = clean(raw);
  if (text.length <= P.MIN_LEN) return fail(res, 400, "bad_request");
  const hash = crypto.createHash("sha256").update(text).digest("hex"), cacheOk = await psTable();
  if (cacheOk) {
    const c = await q("select summary from ai_post_summaries where post_id=$1 and body_hash=$2", [id, hash]).catch(() => []);
    if (c.length) return res.json({ text: c[0].summary, cached: true });
  }
  const region = blockedRegion(req.headers["x-vercel-ip-country"]), body = text.slice(0, P.IN_MAX);
  const order = pickOrder(body, { region });
  if (!order.length) return res.status(503).json({ error: region ? "region_restricted" : "providers_busy" });
  if (mkRate(psGen, P.PER_MINUTE)(u.id)) return fail(res, 429, "rate_limited");
  if (!(await takeQuota(u.id))) return fail(res, 429, "quota_exceeded");
  const ac = new AbortController(); res.on("close", () => ac.abort());
  let out = "";
  try { for await (const x of run(order, [{ role: "user", content: "<post>" + body + "</post>" }], P.SYSTEM, ac.signal)) if (x.text) out += x.text; } catch (e) {}
  out = clean(out).replace(/^["«“]+|["»”]+$/g, "").slice(0, P.OUT_MAX).trim();
  if (!out) { await refundQuota(u.id); return res.status(503).json({ error: "providers_busy" }); }
  if (cacheOk) await q("insert into ai_post_summaries(post_id,body_hash,summary) values($1,$2,$3) on conflict (post_id) do update set body_hash=excluded.body_hash,summary=excluded.summary,created_at=now()", [id, hash, out]).catch(() => {});
  res.json({ text: out, cached: false });
}

module.exports = async (req, res) => {
  const action = String((req.query && req.query.action) || "").toLowerCase();
  try {
    if (action === "health") return await health(res);
    if (action === "chat") return await chat(req, res);
    if (action === "conversations" || action === "conversation") return await convs(action, req, res);
    if (action === "assist") return await assist(req, res);
    if (action === "psum") return await psum(req, res);
    if (action === "prompt") return await promptAdmin(req, res);
    if (action === "autopilot") return await require("../_mada-ai-autopilot")(req, res, { q, run, pickOrder, getPrompt, E, PR });
    if (["quota", "memory", "settings"].includes(action)) return await simple(action, req, res);
    return fail(res, 404, "bad_request");
  } catch (e) {
    if (!res.headersSent) return res.status(503).json({ error: "providers_busy", detail: String(e.message || e).slice(0, 120) });
    res.end();
  }
};
