// شاشة المندوب (11/11، طلبه) — منقولة من نسخة Pro: أوردراته الشغّالة بس + زرار «سلّمت للعميل» بيسجّل مكانه لحظة التسليم (مش تتبع طول اليوم).
// المندوب مبيقفلش الأوردر: بيسجّل deliveredAt + deliveredLoc بس، والكاشير بيشوف «سُلّم للعميل» ويقفل الأوردر بعد ما المندوب يرجّع الفلوس.
// القراية: query واحد (driverName == اسمه && status == PENDING) — القواعد بتشترط الفلتر ده. زرار الأدمن deliv_cfg/track.enabled=false بيوقف تسجيل الموقع.
import { collection, query, where, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
.drvwrap .dempty{text-align:center;color:#64748b;padding:30px 10px;font-size:16px}
.dtoast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:12px;z-index:99;font-size:14px}
`;
  document.head.appendChild(s);
}

export function mountDriver(root, { db, driverName }) {
  css(); root.classList.add('drvwrap');
  let ORDERS = [], READY = false, BUSY = '', SEEN = null, TRK = true;
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
      ${!READY ? '<div class="dempty">⏳ جاري التحميل…</div>' : list.length ? list.map(o => card(o, now)).join('') : '<div class="dempty">مفيش أوردرات عليك دلوقتي ✔</div>'}`;
    root.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => deliver(b.dataset.fin));
    root.querySelectorAll('[data-loctest]').forEach(b => b.onclick = testLocation);
  }

  onSnapshot(query(collection(db, 'deliv_orders'), where('driverName', '==', driverName), where('status', '==', 'PENDING')), snap => {
    ORDERS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ids = new Set(ORDERS.map(o => o.id));
    if (SEEN && [...ids].some(i => !SEEN.has(i))) { try { navigator.vibrate && navigator.vibrate([250, 120, 250]); } catch (e) { } toast('🆕 أوردر جديد'); }
    SEEN = ids; READY = true; draw();
  }, e => { root.innerHTML = `<div class="dempty" style="color:#b91c1c">مقدرتش أقرا أوردراتك: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — كلّم المدير (حسابك مش مربوط باسمك)' : ''}</div>`; });
  onSnapshot(doc(db, 'deliv_cfg', 'track'), s => { TRK = !s.exists() || s.data().enabled !== false; draw(); }, () => { });
  if (PERM === 'unknown' && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(st => { PERM = st.state; st.onchange = () => { PERM = st.state; if (PERM !== 'granted') TEST = null; draw(); }; draw(); }).catch(() => { });
  }
  setInterval(() => { if (root.isConnected && !BUSY && !TESTING) draw(); }, 30000);
  draw();
}
