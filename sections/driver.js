// شاشة المندوب (11/11، طلبه) — منقولة من نسخة Pro: أوردراته الشغّالة بس + زرار «سلّمت للعميل» بيسجّل مكانه لحظة التسليم (مش تتبع طول اليوم).
// المندوب مبيقفلش الأوردر: بيسجّل deliveredAt + deliveredLoc بس، والكاشير بيشوف «سُلّم للعميل» ويقفل الأوردر بعد ما المندوب يرجّع الفلوس.
// القراية: query واحد (driverName == اسمه && status == PENDING) — القواعد بتشترط الفلتر ده. زرار الأدمن deliv_cfg/track.enabled=false بيوقف تسجيل الموقع.
import { collection, query, where, onSnapshot, doc, updateDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const M = n => (+n || 0).toLocaleString('en-US') + ' ج';
const timeStr = ts => new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
const PROMISE = 30 * 60000;
const isOut = o => o.zone === 'خارج المعمورة';

function getLocation() {
  return new Promise(res => {
    if (!navigator.geolocation) return res({ status: 'unavailable' });
    navigator.geolocation.getCurrentPosition(
      p => res({ ok: true, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.max(0, Math.round(p.coords.accuracy || 0)) }),
      e => res({ status: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
}
const LOC_MSG = {
  denied: 'رفضت إذن الموقع، فمش هنقدر نسجّل مكان التسليم. تسلّم من غير موقع؟ (فعّل الإذن من إعدادات المتصفح)',
  timeout: 'الموقع اتأخر ومقدرناش نحدده. تسلّم من غير موقع؟',
  unavailable: 'الـ GPS مش متاح دلوقتي (شغّل الموقع في الموبايل). تسلّم من غير موقع؟',
};
const PLATFORM = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
const HOW = {
  android: 'اضغط أيقونة الإعدادات (🔒 أو ⚙) يسار الرابط ← الأذونات ← الموقع ← سماح. وتأكد إن الموقع (GPS) شغّال من إعدادات الموبايل.',
  ios: 'الإعدادات ← الخصوصية والأمان ← خدمات الموقع ← شغّلها، وبعدين Safari Websites ← «أثناء استخدام التطبيق». وارجع افتح البرنامج.',
  desktop: 'اضغط أيقونة الإعدادات يسار الرابط ← Site settings ← Location ← Allow، وبعدين حدّث الصفحة.',
};

function css() {
  if (document.getElementById('drvCss')) return;
  const s = document.createElement('style'); s.id = 'drvCss';
  s.textContent = `
.drvwrap{max-width:560px;margin:0 auto;color:#1e293b}
.drvwrap .dhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:4px 0 10px}
.drvwrap .dhead h2{margin:0;font-size:19px}
.drvwrap .dcount{background:#dbeafe;color:#1e3a8a;border-radius:99px;padding:3px 12px;font-weight:800;font-size:14px}
.drvwrap .dnote{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:12px;padding:8px 12px;font-size:12.5px;margin-bottom:12px}
.drvwrap .dloc{border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:12px;border:1px solid;display:flex;flex-direction:column;gap:6px}
.drvwrap .dloc.ok{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}
.drvwrap .dloc.warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
.drvwrap .dloc.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.drvwrap .dhow{font-size:12px;line-height:1.7}
.drvwrap .dlb{background:#fff;border:1px solid currentColor;color:inherit;border-radius:10px;min-height:44px;font-weight:700;font-size:14px;box-shadow:none}
.drvwrap .dcard{background:#fff;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 2px 10px rgba(15,23,42,.08);border:2px solid transparent}
.drvwrap .dcard.late{border-color:#f87171;background:#fef2f2}
.drvwrap .dcard.sent{border-color:#4ade80;background:#f0fdf4}
.drvwrap .dtop{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.drvwrap .dcust{font-weight:800;font-size:17px}.drvwrap .dval{font-weight:900;font-size:22px;color:#0f766e;white-space:nowrap}
.drvwrap .dchg{font-size:13px;color:#b45309;font-weight:700;margin-top:2px}
.drvwrap .dchips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.drvwrap .dchip{background:#f1f5f9;border-radius:99px;padding:4px 10px;font-size:12.5px;font-weight:700}
.drvwrap .dchip.out{background:#e0e7ff;color:#3730a3}.drvwrap .dchip.in{background:#ccfbf1;color:#115e59}.drvwrap .dchip.late{background:#fee2e2;color:#991b1b}.drvwrap .dchip.pay{background:#fef3c7;color:#92400e}
.drvwrap .dnotes{font-size:13px;background:#fffbeb;border-radius:10px;padding:6px 10px;margin-bottom:10px}
.drvwrap .dgo{width:100%;min-height:56px;border:0;border-radius:14px;background:#0f766e;color:#fff;font-size:19px;font-weight:800;cursor:pointer}
.drvwrap .dgo:disabled{opacity:.6}
.drvwrap .dwait{text-align:center;font-weight:800;color:#166534;font-size:15px;padding:10px;background:#dcfce7;border-radius:12px;line-height:1.7}
.drvwrap .dctl{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}.drvwrap .dsub{font-size:13px;color:#475569;line-height:1.7}.drvwrap .dgo.stop{background:#dc2626}.drvwrap .dtrk{background:#fff;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px}
.drvwrap .dempty{text-align:center;color:#64748b;padding:30px 10px;font-size:16px}
.dtoast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:12px;z-index:99;font-size:14px}
`;
  document.head.appendChild(s);
}

export function mountDriver(root, { db, driverName, uid }) {
  css(); root.classList.add('drvwrap');
  let ORDERS = [], READY = false, BUSY = '', SEEN = null, TRK = true;
  const sget = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, sset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };

  /* ===== (13/11، طلبه) تنبيه الأوردر الجديد: سارينة عالية + اهتزاز + شاشة حمرا لحد ما يدوس «تمام» + إشعار نظام لو الصفحة في الخلفية ===== */
  let AC = null, ALERT_T = null, ALERT_EL = null, WL = null;
  const audioOk = () => !!AC && AC.state === 'running';
  function unlockAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state !== 'running') AC.resume().then(draw); } catch (e) { } }
  document.addEventListener('pointerdown', unlockAudio, true);   // أي لمسة بتفتح الصوت (شرط المتصفح)
  function siren(secs = 3) {
    try {
      unlockAudio(); if (!AC) return;
      const t0 = AC.currentTime, pulse = 0.25, n = Math.floor(secs / pulse);
      const comp = AC.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 6;
      const master = AC.createGain(); master.gain.value = 1; comp.connect(master); master.connect(AC.destination);
      for (let i = 0; i < n; i++) {
        const t = t0 + i * pulse, o = AC.createOscillator(), g = AC.createGain();
        o.type = 'square'; o.frequency.value = i % 2 ? 1050 : 1500; o.connect(g); g.connect(comp);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
        g.gain.setValueAtTime(0.9, t + pulse * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + pulse * 0.98);
        o.start(t); o.stop(t + pulse);
      }
    } catch (e) { }
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400, 150, 400]); } catch (e) { }
  }
  function dismissAlert() { clearInterval(ALERT_T); ALERT_T = null; if (ALERT_EL) { ALERT_EL.remove(); ALERT_EL = null; } }
  async function sysNotify(list) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = await navigator.serviceWorker.ready, o = list[0];
      reg.showNotification('🆕 أوردر جديد ليك', { body: `${o.customerName || 'عميل'} · ${M(o.orderValue)}${list.length > 1 ? ' (+' + (list.length - 1) + ')' : ''}`, tag: 'new-order', renotify: true, requireInteraction: true, vibrate: [400, 150, 400, 150, 400], icon: 'icons/drv-192.png' });
    } catch (e) { }
  }
  function newOrderAlert(list) {
    dismissAlert(); siren(3); sysNotify(list);
    ALERT_EL = document.createElement('div');
    ALERT_EL.style.cssText = 'position:fixed;inset:0;z-index:200;background:#b91c1c;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center';
    ALERT_EL.innerHTML = `<div style="font-size:64px">🚨</div><div style="font-size:30px;font-weight:900">أوردر جديد!</div>
      ${list.slice(0, 3).map(o => `<div style="font-size:20px;font-weight:700">👤 ${esc(o.customerName || 'عميل')} — ${M(o.orderValue)}</div>`).join('')}
      <button type="button" style="margin-top:14px;min-height:60px;width:100%;max-width:320px;border:0;border-radius:16px;background:#fff;color:#b91c1c;font:inherit;font-size:22px;font-weight:900">تمام، استلمت ✔</button>`;
    ALERT_EL.querySelector('button').onclick = dismissAlert;
    document.body.appendChild(ALERT_EL);
    let n = 0; ALERT_T = setInterval(() => { if (++n > 20) return dismissAlert(); siren(3); }, 6000);   // بتكرر كل 6 ثواني لحد ما يدوس (أقصى دقيقتين)
  }
  async function wantWake() { try { if ('wakeLock' in navigator && !WL && !document.hidden && (TON || ORDERS.length)) { WL = await navigator.wakeLock.request('screen'); WL.addEventListener('release', () => { WL = null; }); } } catch (e) { } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wantWake(); });

  /* ===== (13/11، طلبه) التتبع المباشر: المندوب بيشغّله بزرار، وبيبعت موقعه لـ deliv_loc/{uid}؛ الكاشير بيشوفه. المتصفح بيوقفه لو الشاشة اتقفلت ===== */
  let LIVEOK = true, TON = sget('drv_trk') === '1', WATCH = null, HB = null, LAST = null, LASTSENT = 0, SENT = 0, TERR = '';
  const SEND_EVERY = 30e3, HEARTBEAT = 60e3, MIN_MOVE = 30;
  const dist = (a, b) => { const R = 6371000, r = x => x * Math.PI / 180, dl = r(b.lat - a.lat), dg = r(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  async function pushLoc(on) {
    const data = on && LAST ? { name: driverName, on: true, lat: LAST.lat, lng: LAST.lng, acc: Math.round(LAST.acc || 0), spd: LAST.spd == null ? null : Math.round(LAST.spd * 3.6), at: serverTimestamp() } : { name: driverName, on: false, at: serverTimestamp() };
    await setDoc(doc(db, 'deliv_loc', uid), data);
    if (on) { SENT++; LASTSENT = Date.now(); }
  }
  const tryPush = async () => { try { await pushLoc(true); TERR = ''; } catch (e) { TERR = 'مقدرتش أبعت الموقع: ' + (e.code || e.message); } draw(); };
  function onPos(p) {
    const c = p.coords, prev = LAST; LAST = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, spd: c.speed };
    const dt = Date.now() - LASTSENT;
    if (!prev || (dt >= SEND_EVERY && dist(prev, LAST) >= MIN_MOVE) || dt >= HEARTBEAT) tryPush(); else draw();
  }
  function onPosErr(e) { TERR = { 1: 'إذن الموقع مرفوض — فعّله من إعدادات المتصفح.', 2: 'مش قادر أحدد الموقع — شغّل GPS.', 3: 'تحديد الموقع اتأخر — اتأكد إن GPS شغال.' }[e.code] || e.message; if (e.code === 1) stopTrack(true); else draw(); }
  function startTrack() {
    if (!LIVEOK || WATCH != null) return;
    if (!navigator.geolocation) { TERR = 'المتصفح ده مش بيدعم تحديد الموقع'; draw(); return; }
    TERR = ''; TON = true; sset('drv_trk', '1'); LAST = null; SENT = 0; LASTSENT = 0;
    WATCH = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    HB = setInterval(() => { if (TON && LAST && Date.now() - LASTSENT >= HEARTBEAT) tryPush(); }, 10000);   // نبضة لو واقف
    wantWake(); draw();
  }
  async function stopTrack(silent) {
    TON = false; sset('drv_trk', ''); LAST = null;
    if (WATCH != null) navigator.geolocation.clearWatch(WATCH); WATCH = null; clearInterval(HB); HB = null;
    try { if (WL) await WL.release(); } catch (e) { } WL = null;
    try { await pushLoc(false); } catch (e) { if (!silent) TERR = 'الإيقاف اتسجّل على موبايلك بس: ' + (e.code || e.message); }
    draw();
  }
  function ctlBar() {
    const notif = ('Notification' in window) && Notification.permission === 'default';
    const sound = !audioOk() ? `<button type="button" class="dlb" data-sound>🔔 اضغط لتفعيل صوت تنبيه الأوردر</button>` : '<div class="dsub">🔔 صوت التنبيه شغال</div>';
    const trk = !LIVEOK ? '<div class="dsub">⛔ التتبع المباشر متوقف من الإدارة</div>'
      : `<div class="dtrk"><button type="button" class="dgo ${TON ? 'stop' : ''}" style="min-height:48px;font-size:17px" data-trk>${TON ? '⏹ إيقاف التتبع' : '▶ تشغيل التتبع'}</button>
         <div class="dsub">${TON ? (LAST ? `🟢 شغال — دقة ±${Math.round(LAST.acc)} م · اتبعت ${SENT} مرة` : '🟡 بدوّر على الموقع…') : '⚪ التتبع مقفول'}${TON ? '<br>سيب الشاشة مفتوحة على التطبيق — لو اتقفلت الإشارة بتقف' : ''}</div></div>`;
    return `<div class="dctl">${sound}${notif ? '<button type="button" class="dlb" data-notif>📲 فعّل إشعارات النظام</button>' : ''}${trk}${TERR ? `<div class="dsub" style="color:#b91c1c">${esc(TERR)}</div>` : ''}</div>`;
  }
  let PERM = (window.isSecureContext && navigator.geolocation) ? 'unknown' : 'unsupported', TEST = null, TESTING = false;
  const toast = t => { const d = document.createElement('div'); d.className = 'dtoast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); };

  function locBar() {
    if (!TRK) return '<div class="dnote">📍 تسجيل مكان التسليم متوقف من الإدارة — هتسلّم من غير موقع.</div>';
    const btn = t => `<button type="button" class="dlb" data-loctest ${TESTING ? 'disabled' : ''}>${TESTING ? '⏳ بفحص…' : t}</button>`;
    if (PERM === 'unsupported') return `<div class="dloc bad"><b>🔴 الموقع مش متاح في المتصفح ده</b><span>افتح البرنامج من كروم أو سفاري على رابط https. التسليم هيتسجّل من غير موقع.</span></div>`;
    if (PERM === 'denied') return `<div class="dloc bad"><b>🔴 الموقع محظور</b><span>هتسلّم من غير موقع لحد ما تفتحه.</span><div class="dhow">${HOW[PLATFORM]}</div>${btn('🔄 جرّب تاني')}</div>`;
    if (TEST && !TEST.ok) return `<div class="dloc warn"><b>🟡 مقدرتش أحدد موقعك</b><span>${TEST.status === 'timeout' ? 'الموقع اتأخر — جرّب في مكان مفتوح.' : 'الـ GPS مش متاح — شغّل «الموقع/Location» من إعدادات الموبايل.'}</span>${btn('🔄 فحص تاني')}</div>`;
    if (TEST && TEST.ok) return `<div class="dloc ${TEST.acc > 100 ? 'warn' : 'ok'}"><b>${TEST.acc > 100 ? '🟡' : '🟢'} الموقع شغّال — دقة ±${TEST.acc} متر</b>${TEST.acc > 100 ? '<span>الدقة ضعيفة — لو أمكن اقف في مكان مفتوح قبل التسليم.</span>' : ''}${btn('🔄 فحص تاني')}</div>`;
    if (PERM === 'granted') return `<div class="dloc ok"><b>🟢 الموقع مسموح</b>${btn('📍 اختبر موقعي')}</div>`;
    return `<div class="dloc warn"><b>🟡 لسه ماسمحتش بالموقع</b><span>فعّله دلوقتي علشان التسليم يتسجّل بمكانه.</span>${btn('📍 فعّل الموقع')}</div>`;
  }
  async function testLocation() {
    if (TESTING || PERM === 'unsupported') return;
    TESTING = true; draw();
    const r = await getLocation(); TESTING = false; TEST = r;
    if (r.ok) PERM = 'granted'; else if (r.status === 'denied') { PERM = 'denied'; TEST = null; }
    draw();
  }

  function card(o, now) {
    const sent = !!o.deliveredAt, out = isOut(o), t0 = o.assignedAt || o.startTime;
    const min = Math.floor((now - t0) / 60000), late = !sent && !out && (now - o.startTime) >= PROMISE;
    return `<div class="dcard ${sent ? 'sent' : late ? 'late' : ''}"><div class="dtop"><div><div class="dcust">👤 ${esc(o.customerName || 'عميل')}</div>${o.changeGiven ? `<div class="dchg">فكة معاك: ${M(o.changeGiven)}</div>` : ''}</div><div class="dval">${M(o.orderValue)}</div></div>
      <div class="dchips"><span class="dchip ${out ? 'out' : 'in'}">${out ? 'خارج المعمورة' : 'داخل المعمورة الشاطئ'}</span>
        <span class="dchip">🕒 خرجت من ${min} د</span>${late ? '<span class="dchip late">⚠ عدّى 30 دقيقة</span>' : ''}
        ${o.isVisa ? '<span class="dchip pay">💳 فيزا</span>' : ''}${o.isVodafoneCash ? '<span class="dchip pay">📱 فودافون كاش</span>' : ''}</div>
      ${o.notes ? `<div class="dnotes">📝 ${esc(o.notes)}</div>` : ''}
      ${sent ? `<div class="dwait">✅ سلّمته للعميل ${timeStr(o.deliveredAt)}<br>ارجع الصيدلية وسلّم الفلوس للكاشير</div>`
             : `<button type="button" class="dgo" data-fin="${esc(o.id)}" ${BUSY ? 'disabled' : ''}>${BUSY === o.id ? '⏳ بحدد موقعك…' : '✔ سلّمت للعميل'}</button>`}</div>`;
  }

  async function deliver(id) {
    const o = ORDERS.find(x => x.id === id); if (!o || BUSY || o.deliveredAt) return;
    if (!navigator.onLine) { toast('مفيش نت — مينفعش تسجّل التسليم دلوقتي'); return; }
    if (!confirm(`تأكيد إنك سلّمت أوردر «${o.customerName || 'عميل'}» (${M(o.orderValue)}) للعميل؟`)) return;
    BUSY = id; draw();
    let loc = { skipped: true };
    if (TRK) {
      loc = await getLocation();
      if (loc.ok) PERM = 'granted'; else if (loc.status === 'denied') PERM = 'denied';
      if (!loc.ok && !confirm(LOC_MSG[loc.status])) { BUSY = ''; draw(); return; }
    }
    const data = { deliveredAt: Date.now(), locStatus: loc.ok ? 'ok' : (loc.status || 'off'), ...(loc.ok ? { deliveredLoc: { lat: loc.lat, lng: loc.lng, acc: loc.acc } } : {}) };
    try {
      await updateDoc(doc(db, 'deliv_orders', id), data);
      toast(loc.ok && loc.acc > 100 ? `✔ اتسجّل (دقة الموقع ضعيفة ±${loc.acc} متر)` : '✔ اتسجّل — ارجع للصيدلية بالفلوس');
    } catch (e) { toast('مقدرتش أسجّل: ' + (e.code === 'permission-denied' ? 'الأوردر اتغيّر أو اتقفل — حدّث الصفحة' : (e.code || e.message))); }
    BUSY = ''; draw();
  }

  function draw() {
    const now = Date.now();
    const list = [...ORDERS].sort((a, b) => (a.assignedAt || a.startTime) - (b.assignedAt || b.startTime));
    const pend = list.filter(o => !o.deliveredAt).length;
    root.innerHTML = `<div class="dhead"><h2>🛵 أهلاً ${esc(driverName)}</h2><span class="dcount">${pend} للتسليم</span></div>
      <div class="dnote">📍 بنسجّل موقعك لحظة ضغطك على «سلّمت للعميل» بس — مش بنتتبعك طول اليوم. الكاشير هو اللي بيقفل الأوردر بعد ما تسلّمه الفلوس.</div>
      ${locBar()}
      ${ctlBar()}
      ${!READY ? '<div class="dempty">⏳ جاري التحميل…</div>' : list.length ? list.map(o => card(o, now)).join('') : '<div class="dempty">مفيش أوردرات عليك دلوقتي ✔</div>'}`;
    root.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => deliver(b.dataset.fin));
    root.querySelectorAll('[data-loctest]').forEach(b => b.onclick = testLocation);
    root.querySelectorAll('[data-sound]').forEach(b => b.onclick = () => { unlockAudio(); siren(1); });
    root.querySelectorAll('[data-notif]').forEach(b => b.onclick = async () => { try { await Notification.requestPermission(); } catch (e) { } draw(); });
    root.querySelectorAll('[data-trk]').forEach(b => b.onclick = () => (TON ? stopTrack() : startTrack()));
  }

  onSnapshot(query(collection(db, 'deliv_orders'), where('driverName', '==', driverName), where('status', '==', 'PENDING')), snap => {
    ORDERS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ids = new Set(ORDERS.map(o => o.id));
    if (SEEN) { const fresh = ORDERS.filter(o => !SEEN.has(o.id)); if (fresh.length) newOrderAlert(fresh); }
    wantWake();
    SEEN = ids; READY = true; draw();
  }, e => { root.innerHTML = `<div class="dempty" style="color:#b91c1c">مقدرتش أقرا أوردراتك: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — كلّم المدير (حسابك مش مربوط باسمك)' : ''}</div>`; });
  onSnapshot(doc(db, 'deliv_cfg', 'live'), s => { LIVEOK = !s.exists() || s.data().enabled !== false; if (!LIVEOK && TON) stopTrack(true); else draw(); }, () => { });
  if (TON) setTimeout(() => { const t = TON; TON = false; if (t) startTrack(); }, 1500);   // رجوع بعد ريفريش: كمّل التتبع لو كان شغال
  onSnapshot(doc(db, 'deliv_cfg', 'track'), s => { TRK = !s.exists() || s.data().enabled !== false; draw(); }, () => { });
  if (PERM === 'unknown' && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(st => { PERM = st.state; st.onchange = () => { PERM = st.state; if (PERM !== 'granted') TEST = null; draw(); }; draw(); }).catch(() => { });
  }
  setInterval(() => { if (root.isConnected && !BUSY && !TESTING) draw(); }, 30000);
  draw();
}
