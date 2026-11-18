// في /api/ai/chat (Vercel) — قبل أي استدعاء لمزوّد الذكاء الاصطناعي، وبعد التحقق من التوكن.
// user.id يأتي من التوكن الموثَّق فقط. SUPABASE_SERVICE_ROLE_KEY سرّ في الخادم.
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: cfg } = await admin.from("app_settings").select("value").eq("key", "subs_config").maybeSingle();
const c = cfg?.value || {};
const units = c.meter === "token"
  ? Math.max(1, Math.ceil((estimatedTokens / 1000) * (c.token_cost_per_1k ?? 1)))  // estimatedTokens: تقدير مدخلات+مخرجات
  : (c.msg_cost ?? 1);

const { data, error } = await admin.rpc("ai_consume", { p_user: user.id, p_units: units });
if (error) {
  const code = /insufficient_ai_credits/.test(error.message) ? "insufficient_ai_credits"
             : /fair_use_exceeded/.test(error.message) ? "fair_use_exceeded" : "providers_busy";
  return res.status(402).json({ error: code });          // الواجهة تعرض الرسالة وتفتح "اشحن الآن"
}
// data = { ok, unlimited, credits?, plan, tier: 'standard'|'advanced', priority }
// استخدم data.tier لاختيار النموذج الأقوى، وdata.priority لأولوية الطابور.
