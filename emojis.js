/* MADA exclusive emoji runtime. Stored as {{mx:id}}; rendered as SVG; copied as :id:. Heavy pack loads lazily. */
(function () {
  "use strict";
  var ID = /^[a-z][a-z0-9_]{1,28}$/, BASE = "/assets/emojis/", MK = "mada_mx_mute", P = null, pend = null;
  var T = function (a, b) { return typeof L === "function" ? L(a, b) : a; };
  var still = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var tokRe = function () { return /\{\{mx:([a-z][a-z0-9_]{1,28})\}\}/g; };

  function load() {
    if (window.MX_PACK) return Promise.resolve((P = window.MX_PACK));
    if (pend) return pend;
    pend = new Promise(function (res, rej) {
      var l = document.createElement("link"); l.rel = "stylesheet"; l.href = BASE + "pack.css"; document.head.appendChild(l);
      var s = document.createElement("script"); s.src = BASE + "pack.js";
      s.onload = function () { P = window.MX_PACK; res(P); };
      s.onerror = function () { pend = null; rej(new Error("mx_load")); };
      document.head.appendChild(s);
    });
    return pend;
  }

  function html(id) {
    return '<span class="mx" data-mx="' + id + '" role="img" aria-label=":' + id + ':" draggable="false" contenteditable="false"></span>';
  }

  /* b: raw text, plain: escaper for normal chunks, allow: optional Set of permitted ids (messages) */
  function render(b, plain, allow) {
    var re = tokRe(), o = "", i = 0, m;
    while ((m = re.exec(b))) {
      o += plain(b.slice(i, m.index));
      o += (!allow || allow.has(m[1])) ? html(m[1]) : plain(":" + m[1] + ":");
      i = m.index + m[0].length;
    }
    return o + plain(b.slice(i));
  }

  function ids(t) {
    var re = tokRe(), s = {}, o = [], m;
    while ((m = re.exec(String(t || "")))) if (!s[m[1]]) { s[m[1]] = 1; o.push(m[1]); }
    return o;
  }

  function hydrate(el) {
    if (el._h) return; el._h = 1;
    var id = el.getAttribute("data-mx");
    if (!P || !ID.test(id) || !P.has(id)) { el.replaceWith(document.createTextNode(":" + id + ":")); return; }
    el.innerHTML = P.svg(id);
    el.style.setProperty("--a", "mx" + P.anim(id));
    el.setAttribute("aria-label", P.name(id));
  }

  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      var el = en.target;
      if (!el.isConnected) { io.unobserve(el); return; }
      if (en.isIntersecting) load().then(function () { hydrate(el); el.classList.add("on"); }).catch(function () {});
      else el.classList.remove("on");
    });
  }, { rootMargin: "160px" }) : null;

  var q = 0;
  function scan() {
    q = 0;
    var n = document.querySelectorAll(".mx:not([data-w])");
    for (var i = 0; i < n.length; i++) {
      n[i].setAttribute("data-w", "1");
      if (io) io.observe(n[i]); else (function (el) { load().then(function () { hydrate(el); el.classList.add("on"); }).catch(function () {}); })(n[i]);
    }
  }
  new MutationObserver(function () { if (!q) q = requestAnimationFrame(scan); }).observe(document.documentElement, { childList: true, subtree: true });

  /* sound: only from a user action, global mute */
  function muted() { try { return localStorage.getItem(MK) === "1"; } catch (e) { return false; } }
  function toggleMute() { try { localStorage.setItem(MK, muted() ? "0" : "1"); } catch (e) {} }
  function play(id) {
    if (muted() || !P || !P.has(id)) return;
    try { P.play(id, 0.7); } catch (e) {}
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest(".mx");
    if (!el || el.closest("#mepk")) return;
    var id = el.getAttribute("data-mx");
    if (!ID.test(id)) return;
    play(id);
    if (still()) return;
    el.classList.remove("play"); void el.offsetWidth; el.classList.add("play");
    setTimeout(function () { el.classList.remove("play"); }, 2100);
  });

  /* no dragging */
  document.addEventListener("dragstart", function (e) {
    var n = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (n && n.closest && n.closest(".mx")) e.preventDefault();
  });

  /* copy/cut: plain ":id:" text, never the internal token */
  function plainOf(root) {
    var o = "";
    (function w(n) {
      if (n.nodeType === 3) { o += n.nodeValue; return; }
      if (n.nodeType === 1) {
        if (n.classList.contains("mx")) { var id = n.getAttribute("data-mx"); if (ID.test(id)) o += ":" + id + ":"; return; }
        if (n.tagName === "BR") { o += "\n"; return; }
      } else if (n.nodeType !== 11) return;
      for (var c = n.firstChild; c; c = c.nextSibling) w(c);
      if (n.nodeType === 1 && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TR)$/.test(n.tagName) && o && o.slice(-1) !== "\n") o += "\n";
    })(root);
    return o.replace(/\n+$/, "");
  }
  function onCopy(e) {
    var t = e.target, cd = e.clipboardData;
    if (!cd) return;
    if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && /^(text|search)?$/i.test(t.type)))) {
      var a = t.selectionStart, b = t.selectionEnd;
      if (a == null || a === b) return;
      var s = t.value.slice(a, b);
      if (s.indexOf("{{mx:") < 0) return;
      cd.setData("text/plain", s.replace(tokRe(), ":$1:"));
      e.preventDefault();
      if (e.type === "cut") { t.setRangeText("", a, b, "end"); t.dispatchEvent(new Event("input", { bubbles: true })); }
      return;
    }
    var sel = window.getSelection && getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    var has = false, parts = [];
    for (var i = 0; i < sel.rangeCount; i++) {
      var f = sel.getRangeAt(i).cloneContents();
      if (f.querySelector(".mx")) has = true;
      parts.push(plainOf(f));
    }
    if (!has) return;
    cd.setData("text/plain", parts.join("\n"));
    e.preventDefault();
  }
  document.addEventListener("copy", onCopy, true);
  document.addEventListener("cut", onCopy, true);

  /* picker pieces (called from the existing picker) */
  function grid(v) {
    if (!window.MX_PACK) {
      load().then(function () { if (typeof madaEmoDraw === "function") madaEmoDraw(); }).catch(function () {});
      return "";
    }
    P = window.MX_PACK;
    var lock = typeof MEMO_LOCK === "string" ? MEMO_LOCK : "";
    return P.ids.map(function (id) {
      return '<button type="button" class="mep-e' + (v ? "" : " lk") + '" data-ecode="mx:' + id + '" aria-label="' + P.name(id).replace(/"/g, "") + '">' +
        html(id) + (v ? "" : '<i class="mep-l">' + lock + "</i>") + "</button>";
    }).join("");
  }
  function note(v) {
    var m = muted();
    return '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:6px">' +
      (v ? "" : '<p class="sub" style="margin:0;text-align:center">' + T("حصرية للحسابات الموثّقة. جدّد التوثيق لاستخدامها.", "Exclusive to verified accounts. Renew verification to use them.") + "</p>") +
      '<button type="button" data-emute aria-pressed="' + m + '" aria-label="' + T("كتم الأصوات", "Mute sounds") + '">' + (m ? "🔇" : "🔊") + "</button></div>";
  }

  window.MX = { load: load, html: html, render: render, ids: ids, grid: grid, note: note, play: play, muted: muted, toggleMute: toggleMute };
})();
