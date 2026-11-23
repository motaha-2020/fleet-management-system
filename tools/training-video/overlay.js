/*
 * Presenter layer for the training video, injected into every page by film.mjs (context.addInitScript).
 * A headless browser shows no mouse, so this draws one, plus a highlight ring with a label, a toast, and the
 * "live test" panel where every check appears as it passes. It lives in a shadow root on <html> (outside the
 * React tree, mounted after load) so it never touches the app. film.mjs drives it through window.__tv.
 */
(() => {
  if (window.__tv) return;
  const init = window.__tvInit || {};
  const phone = !!init.phone;
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(`__tv_${k}`); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem(`__tv_${k}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  let hud = store.get("hud", null) || init.hud || [];
  let pos = store.get("pos", null) || { x: innerWidth * 0.5, y: innerHeight * 0.6 };

  const host = document.createElement("div");
  host.id = "__tv-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host, * { box-sizing: border-box; font-family: "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, sans-serif; }
  .cur { position: fixed; left: 0; top: 0; width: 30px; height: 30px; transition-property: transform; transition-timing-function: cubic-bezier(.3,.7,.2,1); will-change: transform; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
  .cur.phone { width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(27,99,168,.28); border: 2px solid rgba(255,255,255,.9); filter: none; box-shadow: 0 0 0 2px rgba(27,99,168,.55); }
  .ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid #F5B700; animation: rip .55s ease-out forwards; }
  @keyframes rip { to { transform: scale(3.6); opacity: 0; } }
  .ring { position: fixed; border: 3px solid #F5B700; border-radius: 12px; box-shadow: 0 0 0 6px rgba(245,183,0,.22), 0 0 22px rgba(245,183,0,.45); transition: all .35s ease; opacity: 0; }
  .ring.on { opacity: 1; }
  .label { position: fixed; max-width: 420px; background: #0E2233; color: #fff; padding: 8px 14px; border-radius: 10px; font-size: 17px; font-weight: 600; line-height: 1.5; direction: rtl; box-shadow: 0 6px 18px rgba(0,0,0,.25); opacity: 0; transition: opacity .3s ease; }
  .label.on { opacity: 1; }
  .label::before { content: ""; position: absolute; inset-inline-start: 18px; width: 12px; height: 12px; background: #0E2233; transform: rotate(45deg); }
  .label.below::before { top: -6px; } .label.above::before { bottom: -6px; }
  .toast { position: fixed; top: 76px; left: 50%; transform: translateX(-50%); background: rgba(14,34,51,.94); color: #fff; padding: 12px 22px; border-radius: 999px; font-size: 18px; font-weight: 600; direction: rtl; opacity: 0; transition: opacity .3s; white-space: nowrap; }
  .toast.on { opacity: 1; }
  .hud { position: fixed; left: 18px; bottom: 18px; width: 330px; background: rgba(255,255,255,.97); border: 1px solid #DFE5EC; border-radius: 14px; box-shadow: 0 10px 30px rgba(14,34,51,.18); direction: rtl; overflow: hidden; }
  .hud header { display: flex; align-items: center; gap: 8px; background: #0E2233; color: #fff; padding: 9px 14px; font-size: 15px; font-weight: 700; }
  .hud header .dot { width: 9px; height: 9px; border-radius: 50%; background: #e5484d; box-shadow: 0 0 0 3px rgba(229,72,77,.3); }
  .hud header .n { margin-inline-start: auto; font-weight: 600; color: #6CB4EE; direction: rtl; }
  .hud ul { list-style: none; margin: 0; padding: 6px 0; }
  .hud li { display: flex; gap: 8px; align-items: flex-start; padding: 5px 14px; font-size: 14.5px; color: #12202E; line-height: 1.45; }
  .hud li .m { flex: none; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .hud li.ok .m { background: #3F6A14; } .hud li.bad .m { background: #B01F2C; }
  .hud li.new { animation: pop .6s ease; background: #ECF3E1; }
  .hud li.bad.new { background: #FBE8EA; }
  @keyframes pop { from { transform: translateX(-24px); opacity: 0; } }
  .hud.empty ul { display: none; }
  .hud.phone { left: 10px; right: 10px; bottom: 10px; width: auto; }
  .hud.phone ul li:not(:first-child) { display: none; }
</style>
<div class="ring"></div><div class="label"></div><div class="toast"></div>
<div class="hud"><header><span class="dot"></span><span>اختبار حي</span><span class="n"></span></header><ul></ul></div>
<div class="cur${phone ? " phone" : ""}">${phone ? "" : `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.6 20.3 L11.7 13.6 L18 13.4 Z" fill="#fff" stroke="#12202E" stroke-width="1.6" stroke-linejoin="round"/></svg>`}</div>`;
  const $ = (s) => root.querySelector(s);
  const cur = $(".cur"), ring = $(".ring"), label = $(".label"), toast = $(".toast"), hudEl = $(".hud");
  if (phone) hudEl.classList.add("phone");

  const place = (ms = 0) => { cur.style.transitionDuration = `${ms}ms`; cur.style.transform = `translate(${pos.x}px, ${pos.y}px)`; };
  const renderHud = (fresh = false) => {
    const ok = hud.filter((c) => c.ok).length, bad = hud.length - ok;
    hudEl.classList.toggle("empty", !hud.length);
    $(".hud .n").textContent = hud.length ? `✓ ${ok}${bad ? `  ·  ✗ ${bad}` : ""}` : "";
    const last = hud.slice(-4).reverse();
    $(".hud ul").innerHTML = last.map((c, i) => `<li class="${c.ok ? "ok" : "bad"}${fresh && i === 0 ? " new" : ""}"><span class="m">${c.ok ? "✓" : "✗"}</span><span></span></li>`).join("");
    root.querySelectorAll(".hud li span:last-child").forEach((s, i) => { s.textContent = last[i].name; });
  };
  const ensure = () => { if (!host.isConnected && document.body) document.documentElement.appendChild(host); };
  place(0);
  renderHud();
  const start = () => { ensure(); setInterval(ensure, 400); };
  if (document.readyState === "complete") start(); else addEventListener("load", start);

  window.__tv = {
    ensure,
    move(x, y, ms = 600) { ensure(); pos = { x, y }; store.set("pos", pos); place(ms); },
    tap(x, y) { ensure(); const r = document.createElement("div"); r.className = "ripple"; r.style.left = `${x}px`; r.style.top = `${y}px`; root.appendChild(r); setTimeout(() => r.remove(), 700); },
    ring(rect, text) {
      ensure();
      const pad = 6;
      Object.assign(ring.style, { left: `${rect.x - pad}px`, top: `${rect.y - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px` });
      ring.classList.add("on");
      if (text) {
        label.textContent = text;
        label.classList.remove("above", "below");
        const below = rect.y + rect.height + 70 < innerHeight;
        label.classList.add(below ? "below" : "above", "on");
        const lw = Math.min(420, Math.max(160, text.length * 9 + 30));
        const left = Math.max(10, Math.min(innerWidth - lw - 10, rect.x + rect.width - lw));
        Object.assign(label.style, { left: `${left}px`, top: below ? `${rect.y + rect.height + 16}px` : "auto", bottom: below ? "auto" : `${innerHeight - rect.y + 16}px` });
      } else label.classList.remove("on");
    },
    clear() { ring.classList.remove("on"); label.classList.remove("on"); },
    toast(text) { ensure(); toast.textContent = text; toast.classList.add("on"); },
    untoast() { toast.classList.remove("on"); },
    check(name, ok) { ensure(); hud = [...hud, { name, ok }]; store.set("hud", hud); renderHud(true); },
    hide() { host.style.display = "none"; },
    show() { host.style.display = ""; },
  };
})();
