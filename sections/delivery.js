// قسم متابعة الدليفري (1/11) — منقول من برنامج «إدارة توصيل الصيدلية» (AI Studio) لموقع المرتبات.
// الأوردرات في deliv_orders والطيارين في deliv_drivers. الوقت بالـ ms زي البرنامج القديم.
// الأدمن: كل حاجة (تسجيل، تعديل، حذف، طيارين، تحليلات). جهاز الكاشير: تسجيل + تسليم + تعديل أوردر لسه شغال. صاحب الصيدلية: اطلاع.
// الطلعة المجمعة: أوردرات نفس الطيار بينها ≤ 5 دقايق = طلعة واحدة، ونصيب الأوردر = وقت الطلعة ÷ عدد الأوردرات.
// متأخر: أوردر منفرد من 20 دقيقة، وطلعة مجمعة من 30 دقيقة (وعد التوصيل 30 دقيقة). في الإحصائيات «متأخر» = أكتر من 30 دقيقة.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const M = n => N(n) + ' ج';
const MIN = 60000, BATCH_GAP = 5 * MIN, LATE_SINGLE = 20 * MIN, LATE_BATCH = 30 * MIN, PROMISE = 30 * MIN;
const EMPLOYEES = ['عبد ربه', 'اسراء', 'عادل', 'ايه', 'ايمان', 'د*أنس', 'كريم', 'طارق', 'العربي', 'جمال', 'منه', 'احمد السعيد'];
const ZONES = ['داخل المعمورة الشاطئ', 'خارج المعمورة'];
const DEF_DRIVERS = ['عبدالله', 'عزوز'];

const dayKey = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ts));
const timeStr = ts => ts ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) : '—';
const dateStr = ts => { const [y, m, d] = dayKey(ts).split('-'); return `${+d}/${+m}`; };
const dur = ms => { if (ms == null || isNaN(ms)) return '—'; const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const durMin = ms => (ms == null || isNaN(ms)) ? '—' : Math.round(ms / MIN) + ' د';
const nm = n => String(n || '').replace(/\*/g, '').trim();

let ROOT, ROLE, DB, UID, ORDERS = [], DRIVERS = [], READY = 0, BM = new Map(), EDIT = null, UNSUB = [], TICK = null, REFRESH = null;
let ST = { view: 'live', period: 'today', from: '', to: '', driver: '', zone: '', mute: false, shown: 60 };
const ALARMED = new Set();

const canWrite = () => ROLE === 'admin' || ROLE === 'cashier';
const isAdm = () => ROLE === 'admin';
const seeStats = () => ROLE === 'admin' || ROLE === 'viewer';

/* ---------- الطلعات المجمعة ---------- */
function batchMap(list, now) {
  const map = new Map(), byDrv = new Map();
  list.forEach(o => { const k = (o.driverName || '').trim().toLowerCase(); if (!byDrv.has(k)) byDrv.set(k, []); byDrv.get(k).push(o); });
  byDrv.forEach(arr => {
    arr.sort((a, b) => a.startTime - b.startTime);
    const clusters = []; let cur = [];
    arr.forEach(o => { if (cur.length && Math.abs(o.startTime - cur[cur.length - 1].startTime) > BATCH_GAP) { clusters.push(cur); cur = []; } cur.push(o); });
    if (cur.length) clusters.push(cur);
    clusters.forEach(c => {
      const size = c.length, start = Math.min(...c.map(o => o.startTime));
      const done = c.filter(o => o.status === 'COMPLETED' && o.endTime);
      const end = done.length ? Math.max(...done.map(o => o.endTime)) : null;
      const total = done.length ? Math.max(0, end - start) : Math.max(0, now - start);
      const eff = Math.round(total / size), th = size > 1 ? LATE_BATCH : LATE_SINGLE;
      c.forEach((o, i) => map.set(o.id, { batch: size > 1, size, idx: i + 1, start, eff, th, all: done.length === size }));
    });
  });
  return map;
}
const orderMs = (o, b) => o.endTime ? (b ? b.eff : o.endTime - o.startTime) : null;

/* ---------- ستايل ---------- */
function css() {
  if ($('#delCss')) return;
  const s = document.createElement('style'); s.id = 'delCss';
  s.textContent = `
.delwrap .dbar{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px 0 12px;padding:8px;border-radius:18px;background:linear-gradient(135deg,#0F1B2D,#0B6B60)}
.delwrap .dbar::-webkit-scrollbar{display:none}
.delwrap .dbar button{flex:0 0 auto;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 15px;font-size:13.5px;font-weight:700;min-height:44px}
.delwrap .dbar button.on{background:#FFC83D;color:#10202E;border-color:transparent}
.delwrap .dbar .n{display:inline-block;margin-inline-start:6px;background:rgba(0,0,0,.18);border-radius:99px;padding:1px 8px;font-size:12px}
.delwrap .dk{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:12px}
.delwrap .dk>div{background:var(--card);border-radius:16px;padding:12px 14px;box-shadow:var(--shadow);border-inline-start:4px solid var(--green)}
.delwrap .dk .l{font-size:12px;color:var(--muted)}.delwrap .dk .v{font-family:Alexandria,sans-serif;font-size:21px;font-weight:700}
.delwrap .dk .bad{border-inline-start-color:#C0392B}
.delwrap .dform{background:var(--card);border-radius:18px;padding:14px;box-shadow:var(--shadow);margin-bottom:12px}
.delwrap .dform.edit{outline:3px solid #FFC83D}
.delwrap .dform h3{margin:0 0 10px;font-size:16px}
.delwrap .g2{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.delwrap .seg{display:flex;gap:6px;flex-wrap:wrap}
.delwrap .seg button,.delwrap .chip{min-height:44px;border-radius:99px;padding:8px 14px;background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:700;font-size:13.5px}
.delwrap .seg button.on,.delwrap .chip.on{background:#1F2A44;color:#fff;border-color:#1F2A44}
.delwrap .pay{display:flex;gap:8px;flex-wrap:wrap}
.delwrap .pay label{display:inline-flex;gap:6px;align-items:center;min-height:44px;padding:0 12px;border:1px solid var(--line);border-radius:12px;font-weight:700;cursor:pointer}
.delwrap .pay input{width:auto;margin:0}
.delwrap .go{min-height:52px;font-size:16.5px;font-weight:800;border-radius:14px;margin-top:12px;width:100%}
.delwrap .oc{background:var(--card);border-radius:18px;padding:14px;margin-bottom:10px;box-shadow:var(--shadow);border-inline-start:6px solid #0B8577}
.delwrap .oc.late{border-inline-start-color:#C0392B;background:color-mix(in srgb,#C0392B 9%,var(--card))}
.delwrap .oc .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.delwrap .oc h4{margin:0;font-size:16px}
.delwrap .oc .meta{font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.8}
.delwrap .oc .tm{font-family:Alexandria,sans-serif;font-size:26px;font-weight:700;color:#0B6B60;line-height:1}
.delwrap .oc.late .tm{color:#C0392B}
.delwrap .oc .tl{font-size:11px;color:var(--muted);text-align:center}
.delwrap .tag{display:inline-block;border-radius:8px;padding:1px 8px;font-size:12px;font-weight:700;background:#EEF1F5;color:#475467;margin-inline-end:4px}
.delwrap .tag.b{background:#E0E9FF;color:#2A4FB0}.delwrap .tag.o{background:#FFEDD5;color:#C2410C}.delwrap .tag.r{background:#FDE2E1;color:#A32E1E}.delwrap .tag.g{background:#DCF5E3;color:#1B7F3B}
.delwrap .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.delwrap .acts button{min-height:44px;border-radius:12px;padding:6px 14px;font-weight:700}
.delwrap .acts .fin{background:#1B7F3B;color:#fff;flex:1 1 140px;font-size:15px}
.delwrap .tw{overflow-x:auto;background:var(--card);border-radius:16px;box-shadow:var(--shadow);margin-bottom:12px}
.delwrap table{width:100%;border-collapse:collapse;font-size:13.5px}
.delwrap th,.delwrap td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
.delwrap th{background:color-mix(in srgb,var(--green) 10%,var(--card));font-size:12.5px}
.delwrap td.l,.delwrap th.l{text-align:start}
.delwrap tr.late td{background:color-mix(in srgb,#C0392B 8%,var(--card))}
.delwrap .ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.delwrap .ctl input,.delwrap .ctl select{width:auto;min-width:130px}
.delwrap .empty{text-align:center;color:var(--muted);padding:26px 10px}
.delwrap h3.sec{margin:16px 0 8px;font-size:16px}
.delwrap .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0F1B2D;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
`;
  document.head.appendChild(s);
}
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

/* ---------- صوت ---------- */
let AC = null;
function beep(freq = 880, n = 3) {
  if (ST.mute) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + i * 0.28;
      o.frequency.value = freq; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.start(t); o.stop(t + 0.22);
    }
  } catch (e) { }
}

/* ---------- البيانات ---------- */
const active = () => ORDERS.filter(o => o.status === 'PENDING').sort((a, b) => b.startTime - a.startTime);
const done = () => ORDERS.filter(o => o.status === 'COMPLETED' && o.endTime);
const drvList = () => { const s = new Set(DRIVERS.map(d => d.name)); ORDERS.forEach(o => o.driverName && s.add(o.driverName)); return [...s]; };

function periodRange() {
  const now = Date.now(), t = dayKey(now), ms = 864e5;
  const dk = k => k, back = n => dayKey(now - n * ms);
  switch (ST.period) {
    case 'today': return [t, t];
    case 'yest': return [back(1), back(1)];
    case '7': return [back(6), t];
    case 'month': return [t.slice(0, 8) + '01', t];
    case 'custom': return [ST.from || '0000-00-00', ST.to || '9999-99-99'];
    default: return ['0000-00-00', '9999-99-99'];
  }
}
function filtered() {
  const [a, b] = periodRange();
  return done().filter(o => { const k = dayKey(o.endTime); return k >= a && k <= b && (!ST.driver || o.driverName === ST.driver) && (!ST.zone || (o.zone || ZONES[0]) === ST.zone); });
}

function driverStats(list, bm) {
  const m = new Map();
  drvList().forEach(d => m.set(d, { n: d, c: 0, ms: 0, val: 0, out: 0, outVal: 0, b: [0, 0, 0, 0, 0] }));
  list.forEach(o => {
    const x = m.get(o.driverName) || (m.set(o.driverName, { n: o.driverName, c: 0, ms: 0, val: 0, out: 0, outVal: 0, b: [0, 0, 0, 0, 0] }), m.get(o.driverName));
    const t = orderMs(o, bm.get(o.id)) / MIN, out = o.zone === 'خارج المعمورة';
    x.c++; x.ms += orderMs(o, bm.get(o.id)); x.val += o.orderValue || 0;
    if (out) { x.out++; x.outVal += o.orderValue || 0; }
    x.b[t < 10 ? 0 : t < 15 ? 1 : t < 20 ? 2 : t <= 30 ? 3 : 4]++;
  });
  return [...m.values()].sort((a, b) => b.c - a.c);
}

/* ---------- العرض ---------- */
function render() {
  if (!ROOT) return;
  const act = active(), tabs = [['live', '🛵 شغّال دلوقتي', act.length]];
  if (seeStats()) tabs.push(['stats', '📊 الطيارين'], ['log', '📋 السجل']);
  if (!tabs.some(t => t[0] === ST.view)) ST.view = 'live';
  ROOT.innerHTML = `<div class="dbar">${tabs.map(t => `<button class="${ST.view === t[0] ? 'on' : ''}" data-v="${t[0]}">${t[1]}${t[2] != null ? `<span class="n">${t[2]}</span>` : ''}</button>`).join('')}
    <button data-mute title="صوت التنبيه">${ST.mute ? '🔕 الصوت مقفول' : '🔔 الصوت شغال'}</button></div>
    ${!READY ? '<p class="sub">جاري التحميل…</p>' : ST.view === 'live' ? liveHtml(act) : ST.view === 'stats' ? statsHtml() : logHtml()}`;
  ROOT.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ST.view = b.dataset.v; EDIT = null; render(); });
  ROOT.querySelector('[data-mute]').onclick = () => { ST.mute = !ST.mute; render(); };
  bind();
}

function formHtml() {
  const e = EDIT ? ORDERS.find(o => o.id === EDIT) : null, drs = drvList();
  const zone = e ? (e.zone || ZONES[0]) : (ST.zone_in || ZONES[0]);
  const emp = e ? e.employeeName : (localStorage.getItem('del_emp') || '');
  return `<div class="dform ${e ? 'edit' : ''}" id="dForm"><h3>${e ? '✏️ تعديل الأوردر' : '➕ أوردر جديد'}</h3>
  <div class="g2">
    <div><label>الموظف اللي سجّل الأوردر *</label><select id="dEmp"><option value="">— اختار —</option>${EMPLOYEES.map(x => `<option ${x === emp ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <div><label>الطيار *</label><select id="dDrv">${drs.map(x => `<option ${e && e.driverName === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      ${isAdm() ? `<div class="seg" style="margin-top:6px"><button type="button" data-adddrv>+ طيار</button><button type="button" data-deldrv>حذف الطيار ده</button></div>` : ''}</div>
    <div><label>اسم العميل / الرقم</label><input id="dCus" value="${esc(e ? e.customerName : '')}"></div>
    <div><label>قيمة الأوردر (ج)</label><input id="dVal" type="number" inputmode="decimal" min="0" value="${e ? e.orderValue : ''}"></div>
    <div><label>الفكة اللي معاه (ج)</label><input id="dChg" type="number" inputmode="decimal" min="0" value="${e ? e.changeGiven : ''}"></div>
  </div>
  <label style="margin-top:10px">المنطقة *</label>
  <div class="seg" id="dZone">${ZONES.map(z => `<button type="button" data-z="${esc(z)}" class="${z === zone ? 'on' : ''}">${esc(z)}</button>`).join('')}</div>
  <label style="margin-top:10px">الدفع</label>
  <div class="pay"><label><input type="radio" name="dPay" value="cash" ${!e || (!e.isVisa && !e.isVodafoneCash) ? 'checked' : ''}> كاش</label>
    <label><input type="radio" name="dPay" value="visa" ${e && e.isVisa ? 'checked' : ''}> فيزا</label>
    <label><input type="radio" name="dPay" value="voda" ${e && e.isVodafoneCash ? 'checked' : ''}> فودافون كاش</label></div>
  <label style="margin-top:10px">ملاحظات</label><input id="dNote" value="${esc(e ? e.notes : '')}">
  <button class="go" id="dGo">${e ? 'حفظ التعديل' : '🛵 ابدأ الأوردر'}</button>
  ${e ? '<button class="ghost go" id="dCancel" style="margin-top:6px">إلغاء التعديل</button>' : ''}<div class="err" id="dErr"></div></div>`;
}

function liveHtml(act) {
  const now = Date.now(), bm = batchMap(ORDERS.filter(o => now - o.startTime < 36 * 3600e3), now);
  const cards = act.map(o => {
    const b = bm.get(o.id) || { th: LATE_SINGLE, start: o.startTime }, late = now - b.start >= b.th;
    return `<div class="oc ${late ? 'late' : ''}" data-id="${o.id}" data-start="${o.startTime}" data-bs="${b.start}" data-th="${b.th}">
      <div class="top"><div><h4>${esc(nm(o.driverName))} ← ${esc(o.customerName || 'عميل')}</h4>
        <div class="meta"><span class="tag ${o.zone === 'خارج المعمورة' ? 'o' : ''}">${esc(o.zone || ZONES[0])}</span>${b.batch ? `<span class="tag b">طلعة مجمعة ${b.idx}/${b.size}</span>` : ''}${o.isVisa ? '<span class="tag">فيزا</span>' : ''}${o.isVodafoneCash ? '<span class="tag">فودافون كاش</span>' : ''}<br>
        الأوردر <b>${M(o.orderValue)}</b>${o.changeGiven ? ` · فكة ${M(o.changeGiven)}` : ''} · خرج ${timeStr(o.startTime)}${o.employeeName ? ` · سجّله ${esc(nm(o.employeeName))}` : ''}${o.notes ? `<br>📝 ${esc(o.notes)}` : ''}</div></div>
        <div><div class="tm" data-tm>${dur(now - o.startTime)}</div><div class="tl">${late ? 'متأخر!' : 'من خروجه'}</div></div></div>
      ${canWrite() ? `<div class="acts"><button class="fin" data-fin="${o.id}">✅ تم التسليم</button><button class="ghost" data-rc="${o.id}">🧾 إيصال</button><button class="ghost" data-ed="${o.id}">✏️ تعديل</button>${isAdm() ? `<button class="ghost" data-rm="${o.id}">🗑️</button>` : ''}</div>` : ''}</div>`;
  }).join('');
  return `${canWrite() ? formHtml() : ''}<h3 class="sec">الأوردرات الشغالة دلوقتي</h3>${cards || '<div class="empty">مفيش أوردرات شغالة دلوقتي</div>'}`;
}

function statsHtml() {
  const list = filtered(), bm = batchMap(done(), Date.now()), ds = driverStats(list, bm);
  const tot = list.length, ms = list.reduce((s, o) => s + orderMs(o, bm.get(o.id)), 0), late = list.filter(o => orderMs(o, bm.get(o.id)) > PROMISE).length;
  const val = list.reduce((s, o) => s + (o.orderValue || 0), 0), out = list.filter(o => o.zone === 'خارج المعمورة');
  const days = {}; list.forEach(o => { const k = dayKey(o.endTime); (days[k] = days[k] || []).push(o); });
  return `${filterBar()}
  <div class="dk"><div><div class="l">أوردرات اتسلّمت</div><div class="v">${N(tot)}</div></div>
    <div><div class="l">متوسط الوقت للأوردر</div><div class="v">${tot ? durMin(ms / tot) : '—'}</div></div>
    <div class="${late ? 'bad' : ''}"><div class="l">أكتر من 30 دقيقة</div><div class="v">${N(late)}${tot ? ` <small>(${Math.round(late / tot * 100)}%)</small>` : ''}</div></div>
    <div><div class="l">قيمة الأوردرات</div><div class="v">${M(val)}</div></div>
    <div><div class="l">خارج المعمورة</div><div class="v">${N(out.length)}</div><div class="l">${M(out.reduce((s, o) => s + (o.orderValue || 0), 0))}</div></div></div>
  <h3 class="sec">الطيارين</h3><div class="tw"><table><tr><th class="l">الطيار</th><th>أوردرات</th><th>متوسط الوقت</th><th>&lt;10</th><th>10–15</th><th>15–20</th><th>20–30</th><th>&gt;30</th><th>خارج المعمورة</th><th>القيمة</th></tr>
  ${ds.map(d => `<tr><td class="l"><b>${esc(nm(d.n))}</b></td><td>${d.c}</td><td>${d.c ? durMin(d.ms / d.c) : '—'}</td>${d.b.map((x, i) => `<td ${i === 4 && x ? 'style="color:#C0392B;font-weight:800"' : ''}>${x}</td>`).join('')}<td>${d.out}${d.out ? ` (${M(d.outVal)})` : ''}</td><td>${M(d.val)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">مفيش بيانات في الفترة دي</td></tr>'}</table></div>
  <h3 class="sec">يوم بيوم</h3><div class="tw"><table><tr><th class="l">اليوم</th><th>أوردرات</th><th>متوسط الوقت</th><th>&gt;30 د</th><th>القيمة</th></tr>
  ${Object.keys(days).sort().reverse().map(k => { const a = days[k], t = a.reduce((s, o) => s + orderMs(o, bm.get(o.id)), 0); return `<tr><td class="l">${k.slice(8)}/${k.slice(5, 7)}</td><td>${a.length}</td><td>${durMin(t / a.length)}</td><td>${a.filter(o => orderMs(o, bm.get(o.id)) > PROMISE).length}</td><td>${M(a.reduce((s, o) => s + (o.orderValue || 0), 0))}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">—</td></tr>'}</table></div>
  <button class="ghost" data-xl>📥 تنزيل إكسل (السجل + الطيارين)</button>`;
}

function logHtml() {
  const list = filtered().sort((a, b) => b.endTime - a.endTime), bm = batchMap(done(), Date.now()), shown = list.slice(0, ST.shown);
  return `${filterBar()}<div class="tw"><table><tr><th class="l">التاريخ</th><th>خرج</th><th>وصل</th><th>الوقت</th><th class="l">الطيار</th><th class="l">العميل</th><th>المنطقة</th><th>القيمة</th><th>الدفع</th><th class="l">سجّله</th>${isAdm() ? '<th></th>' : ''}</tr>
  ${shown.map(o => { const b = bm.get(o.id), t = orderMs(o, b), late = t > PROMISE;
    return `<tr class="${late ? 'late' : ''}"><td class="l">${dateStr(o.endTime)}</td><td>${timeStr(o.startTime)}</td><td>${timeStr(o.endTime)}</td><td><b>${durMin(t)}</b>${b && b.batch ? ` <span class="tag b">طلعة ${b.size}</span>` : ''}</td><td class="l">${esc(nm(o.driverName))}</td><td class="l">${esc(o.customerName || '—')}${o.notes ? ' 📝' : ''}</td><td>${o.zone === 'خارج المعمورة' ? '<span class="tag o">برا</span>' : 'جوا'}</td><td>${M(o.orderValue)}</td><td>${o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون' : 'كاش'}</td><td class="l">${esc(nm(o.employeeName) || '—')}</td>${isAdm() ? `<td><button class="ghost sm" data-ed="${o.id}">✏️</button> <button class="ghost sm" data-rc="${o.id}">🧾</button> <button class="ghost sm" data-rm="${o.id}">🗑️</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="11" class="empty">مفيش أوردرات في الفترة دي</td></tr>`}</table></div>
  ${list.length > ST.shown ? `<button class="ghost" data-more>عرض المزيد (${list.length - ST.shown})</button>` : ''}<p class="sub">${N(list.length)} أوردر في الفترة · الصف الأحمر = أكتر من 30 دقيقة.</p>`;
}

function filterBar() {
  const P = [['today', 'النهارده'], ['yest', 'إمبارح'], ['7', 'آخر 7 أيام'], ['month', 'الشهر ده'], ['all', 'الكل'], ['custom', 'من – إلى']];
  return `<div class="ctl chips">${P.map(p => `<button class="chip ${ST.period === p[0] ? 'on' : ''}" data-p="${p[0]}">${p[1]}</button>`).join('')}</div>
  <div class="ctl">${ST.period === 'custom' ? `<input type="date" id="fFrom" value="${ST.from}"><input type="date" id="fTo" value="${ST.to}">` : ''}
    <select id="fDrv"><option value="">كل الطيارين</option>${drvList().map(d => `<option ${ST.driver === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
    <select id="fZone"><option value="">كل المناطق</option>${ZONES.map(z => `<option ${ST.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>`;
}

/* ---------- الأحداث ---------- */
function bind() {
  ROOT.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { ST.period = b.dataset.p; ST.shown = 60; render(); });
  [['fFrom', 'from'], ['fTo', 'to'], ['fDrv', 'driver'], ['fZone', 'zone']].forEach(([id, k]) => { const e = $('#' + id, ROOT); if (e) e.onchange = () => { ST[k] = e.value; ST.shown = 60; render(); }; });
  const more = $('[data-more]', ROOT); if (more) more.onclick = () => { ST.shown += 100; render(); };
  const xl = $('[data-xl]', ROOT); if (xl) xl.onclick = exportXl;
  ROOT.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finish(b.dataset.fin));
  ROOT.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => receipt(b.dataset.rc));
  ROOT.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { EDIT = b.dataset.ed; ST.view = 'live'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  ROOT.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => remove(b.dataset.rm));
  const f = $('#dForm', ROOT); if (!f) return;
  f.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { f.querySelectorAll('[data-z]').forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#dGo', f).onclick = save;
  const c = $('#dCancel', f); if (c) c.onclick = () => { EDIT = null; render(); };
  const ad = $('[data-adddrv]', f); if (ad) ad.onclick = addDrv;
  const dd = $('[data-deldrv]', f); if (dd) dd.onclick = delDrv;
}

async function save() {
  const err = $('#dErr'), g = id => $('#' + id, ROOT), emp = g('dEmp').value, drv = g('dDrv').value;
  const z = ROOT.querySelector('[data-z].on'), pay = ROOT.querySelector('[name=dPay]:checked').value;
  err.textContent = '';
  if (!emp) { err.textContent = 'اختار الموظف اللي سجّل الأوردر'; return; }
  if (!drv) { err.textContent = 'مفيش طيار — ضيف طيار الأول'; return; }
  if (!z) { err.textContent = 'اختار المنطقة'; return; }
  const val = parseFloat(g('dVal').value) || 0, chg = parseFloat(g('dChg').value) || 0;
  if (val < 0 || val >= 100000 || chg < 0) { err.textContent = 'راجع القيمة'; return; }
  const data = { driverName: drv, customerName: g('dCus').value.trim(), employeeName: emp, zone: z.dataset.z, orderValue: val, changeGiven: chg,
    isVisa: pay === 'visa', isVodafoneCash: pay === 'voda', notes: g('dNote').value.trim() };
  try {
    localStorage.setItem('del_emp', emp);
    if (EDIT) { await updateDoc(doc(DB, 'deliv_orders', EDIT), data); EDIT = null; toast('اتعدّل ✔'); }
    else { const ref = doc(collection(DB, 'deliv_orders')); await setDoc(ref, { ...data, startTime: Date.now(), endTime: null, status: 'PENDING', by: UID }); beep(660, 1); toast('الأوردر بدأ 🛵'); }
    render();
  } catch (e) { err.textContent = 'مقدرتش أحفظ: ' + (e.code || e.message); }
}
async function finish(id) {
  try { await updateDoc(doc(DB, 'deliv_orders', id), { status: 'COMPLETED', endTime: Date.now() }); beep(990, 2); toast('تم التسليم ✔'); }
  catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}
async function remove(id) {
  const o = ORDERS.find(x => x.id === id); if (!o || !confirm(`تمسح الأوردر ده نهائي؟\n${nm(o.driverName)} ← ${o.customerName || 'عميل'} (${M(o.orderValue)})`)) return;
  try { await deleteDoc(doc(DB, 'deliv_orders', id)); toast('اتمسح'); } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}
async function addDrv() {
  const n = (prompt('اسم الطيار الجديد:') || '').trim(); if (!n) return;
  if (drvList().includes(n)) { toast('الطيار ده موجود'); return; }
  try { await addDoc(collection(DB, 'deliv_drivers'), { name: n }); toast('اتضاف ✔'); } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}
async function delDrv() {
  const n = $('#dDrv', ROOT).value, d = DRIVERS.find(x => x.name === n);
  if (!d) { toast('الطيار ده مش في القايمة (متسجل على أوردرات قديمة بس)'); return; }
  if (!confirm(`تشيل الطيار «${n}» من القايمة؟ أوردراته القديمة هتفضل في السجل.`)) return;
  try { await deleteDoc(doc(DB, 'deliv_drivers', d.id)); toast('اتشال'); } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}

function receipt(id) {
  const o = ORDERS.find(x => x.id === id); if (!o) return;
  const w = window.open('', '_blank', 'width=380,height=620'); if (!w) { toast('المتصفح قافل النافذة — اسمح بالـ popups'); return; }
  const pay = o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون كاش' : 'كاش';
  w.document.write(`<!doctype html><meta charset="utf-8"><title>إيصال</title><body dir="rtl" style="font-family:Tahoma,sans-serif;width:72mm;margin:0 auto;padding:6px;font-size:13px;color:#000">
  <h3 style="text-align:center;margin:4px 0">صيدلية د. أنس نحيله</h3><div style="text-align:center;font-size:11px">خدمة 24 ساعة · 01288827555</div><hr>
  <div>التاريخ: ${dateStr(o.startTime)} — ${timeStr(o.startTime)}</div><div>العميل: ${esc(o.customerName || '—')}</div><div>المنطقة: ${esc(o.zone || ZONES[0])}</div>
  <div>الطيار: ${esc(nm(o.driverName))}</div><div>الدفع: ${pay}</div><hr>
  <div style="font-size:17px;font-weight:bold">الإجمالي: ${N(o.orderValue)} ج</div>${o.changeGiven ? `<div>فكة مع الطيار: ${N(o.changeGiven)} ج</div>` : ''}${o.notes ? `<div>ملاحظات: ${esc(o.notes)}</div>` : ''}<hr>
  <div style="text-align:center">شكراً لثقتكم 🌿</div><script>onload=()=>{print()}<\/script>`);
  w.document.close();
}

function exportXl() {
  if (!window.XLSX) { toast('مكتبة الإكسل مش محملة'); return; }
  const list = filtered().sort((a, b) => a.endTime - b.endTime), bm = batchMap(done(), Date.now());
  const log = [['التاريخ', 'خرج', 'وصل', 'وقت الأوردر (دقيقة)', 'طلعة مجمعة (عدد)', 'الطيار', 'العميل', 'المنطقة', 'القيمة', 'الفكة', 'الدفع', 'سجّله', 'ملاحظات']]
    .concat(list.map(o => { const b = bm.get(o.id); return [dayKey(o.endTime), timeStr(o.startTime), timeStr(o.endTime), +(orderMs(o, b) / MIN).toFixed(1), b && b.batch ? b.size : 1, o.driverName, o.customerName, o.zone || ZONES[0], o.orderValue, o.changeGiven, o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون كاش' : 'كاش', o.employeeName, o.notes]; }));
  const drv = [['الطيار', 'أوردرات', 'متوسط الوقت (دقيقة)', 'أقل من 10', '10–15', '15–20', '20–30', 'أكتر من 30', 'خارج المعمورة (عدد)', 'خارج المعمورة (قيمة)', 'القيمة']]
    .concat(driverStats(list, bm).map(d => [d.n, d.c, d.c ? +(d.ms / d.c / MIN).toFixed(1) : 0, ...d.b, d.out, d.outVal, d.val]));
  const how = [['طريقة الحساب'], ['وقت الأوردر = وقت الوصول − وقت الخروج.'], ['الطلعة المجمعة: أوردرات نفس الطيار بينها 5 دقايق أو أقل = طلعة واحدة، ونصيب كل أوردر = وقت الطلعة ÷ عدد الأوردرات.'],
    ['مثال: طيار خرج بأوردرين الساعة 3:00 و3:02 ورجع 3:40 → وقت الطلعة 40 دقيقة ÷ 2 = 20 دقيقة لكل أوردر.'], ['"أكتر من 30" = الأوردر اللي عدّى وعد التوصيل (30 دقيقة).'], ['الفترة: ' + periodRange().join(' → ')]];
  const wb = XLSX.utils.book_new();
  [['طريقة الحساب', how], ['الطيارين', drv], ['السجل', log]].forEach(([n, r]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r), n));
  XLSX.writeFile(wb, `دليفري_${dayKey(Date.now())}.xlsx`);
}

/* ---------- تايمر ---------- */
function tick() {
  const now = Date.now();
  ROOT.querySelectorAll('.oc[data-start]').forEach(c => {
    const late = now - +c.dataset.bs >= +c.dataset.th;
    const t = c.querySelector('[data-tm]'); if (t) t.textContent = dur(now - +c.dataset.start);
    if (late !== c.classList.contains('late')) { c.classList.toggle('late', late); const l = c.querySelector('.tl'); if (l) l.textContent = late ? 'متأخر!' : 'من خروجه'; }
    if (late && !ALARMED.has(c.dataset.id)) { ALARMED.add(c.dataset.id); beep(1200, 4); }
  });
}

export async function mountDelivery(root, role) {
  ROOT = root; ROLE = role; css();
  ROOT.id = ROOT.id || 'delRoot'; ROOT.classList.add('delwrap');
  const app = getApp(); DB = getFirestore(app); UID = getAuth(app).currentUser ? getAuth(app).currentUser.uid : '';
  UNSUB.forEach(u => u()); UNSUB = []; clearInterval(TICK); clearInterval(REFRESH);
  const fail = e => { ROOT.innerHTML = `<div class="banner bad">مقدرتش أقرا الدليفري: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; };
  UNSUB.push(onSnapshot(query(collection(DB, 'deliv_orders'), orderBy('startTime', 'desc'), limit(6000)), s => {
    ORDERS = s.docs.map(d => ({ id: d.id, ...d.data() })); READY = 1;
    if (!(document.activeElement && ROOT.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName))) render();
  }, fail));
  UNSUB.push(onSnapshot(collection(DB, 'deliv_drivers'), s => {
    DRIVERS = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!DRIVERS.length && isAdm() && READY === 0) DEF_DRIVERS.forEach(n => addDoc(collection(DB, 'deliv_drivers'), { name: n }).catch(() => { }));
  }, () => { }));
  TICK = setInterval(() => { if (ROOT.isConnected) tick(); }, 1000);
  REFRESH = setInterval(() => { if (ROOT.isConnected && ST.view === 'live' && !(document.activeElement && ROOT.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName))) render(); }, 30000);
  render();
}
