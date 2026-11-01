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
const EMPLOYEES = ['عبد ربه', 'اسراء', 'عادل', 'ايه', 'ايمان', 'د*أنس', 'كريم', 'طارق', 'العربي'];
const ZONES = ['داخل المعمورة الشاطئ', 'خارج المعمورة'];
const DEF_DRIVERS = ['عبدالله', 'عزوز'];
const COMM_OUT = 5;   // (2/11، طلبه) عمولة الدليفري على كل أوردر اتسلّم خارج المعمورة
const isOut = o => o.zone === 'خارج المعمورة';
const commOf = o => isOut(o) ? COMM_OUT : 0;

const dayKey = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ts));
const timeStr = ts => ts ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) : '—';
const opDay = ts => dayKey(ts - 9 * 3600e3);   // (2/11) اليوم التشغيلي 9ص → 9ص (زي الخزنة): الشيفت اللي بيعدّي نص الليل يفضل في يوم واحد
const dayLbl = ts => { const k = opDay(ts); return `${+k.slice(8)}/${+k.slice(5, 7)}`; };
const dateStr = ts => { const [y, m, d] = dayKey(ts).split('-'); return `${+d}/${+m}`; };
const dur = ms => { if (ms == null || isNaN(ms)) return '—'; const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const durMin = ms => (ms == null || isNaN(ms)) ? '—' : Math.round(ms / MIN) + ' د';
const nm = n => String(n || '').replace(/\*/g, '').trim();

let ROOT, ROLE, DB, UID, ORDERS = [], DRIVERS = [], READY = 0, BM = new Map(), EDIT = null, UNSUB = [], TICK = null, REFRESH = null;
let DR = {};   // مسودة الفورم (علشان التحديث التلقائي ميمسحش اللي اتكتب)
let ST = { cday: '', view: 'live', period: 'today', from: '', to: '', driver: '', zone: '', mute: false, shown: 60 };
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
  // نفس ألوان وترتيب برنامج جيميناي الأصلي (slate + emerald للداخل، indigo للخارج، أحمر للمتأخر)
  s.textContent = `
.delwrap{color:#1e293b;text-align:right}
.delwrap .dbar{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px 0 14px;padding:4px;border-radius:16px;background:#f1f5f9;border:1px solid #e2e8f0}
.delwrap .dbar::-webkit-scrollbar{display:none}
.delwrap .dbar button{flex:1 0 auto;background:transparent;color:#475569;border:0;border-radius:12px;padding:9px 16px;font-size:14px;font-weight:700;min-height:44px;box-shadow:none}
.delwrap .dbar button.on{background:#fff;color:#047857;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.delwrap .dbar .n{display:inline-block;margin-inline-start:6px;background:#d1fae5;color:#065f46;border-radius:99px;padding:1px 8px;font-size:12px}
.delwrap .dlay{display:grid;gap:20px;grid-template-columns:1fr;align-items:start}
@media(min-width:1024px){.delwrap .dlay{grid-template-columns:5fr 7fr}}
.delwrap .dform{background:#fff;border-radius:24px;border:1px solid #e2e8f0;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.delwrap .dform.edit{outline:3px solid #fbbf24}
.delwrap .dform h3{margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;font-size:18px;font-weight:800;color:#1e293b}
.delwrap .fld{margin-bottom:16px}
.delwrap .fld>label,.delwrap .lbl{display:block;font-size:14px;font-weight:500;color:#475569;margin:0 0 4px}
.delwrap .lbl.b{font-weight:700;color:#334155}
.delwrap .req{color:#ef4444;font-weight:800}
.delwrap .dform input[type=text],.delwrap .dform input[type=number],.delwrap .dform input:not([type]),.delwrap .dform select{width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font-size:15px;color:#1e293b;margin:0;min-height:44px}
.delwrap .dform input:focus,.delwrap .dform select:focus{outline:2px solid #10b981;border-color:#10b981}
.delwrap .emp select{font-weight:700}
.delwrap .row2{display:flex;gap:8px}
.delwrap .row2 select{flex:1}
.delwrap .trash{background:#fef2f2;color:#ef4444;border:0;border-radius:12px;padding:0 14px;min-height:44px;font-size:17px;box-shadow:none}
.delwrap .lnk{background:none;border:0;color:#059669;font-size:12px;font-weight:600;padding:0;min-height:0;box-shadow:none;cursor:pointer}
.delwrap .zones{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.delwrap .zones.miss button{box-shadow:0 0 0 3px #fca5a5}
.delwrap .zones button{border-radius:16px;padding:14px 12px;text-align:right;display:flex;flex-direction:column;gap:8px;min-height:104px;font-weight:400;align-items:stretch;border-width:2px;border-style:solid;box-shadow:none}
.delwrap .zones button b{display:block;font-size:17px;font-weight:900;line-height:1.3}
.delwrap .zones button small{font-size:13px;font-weight:700}
.delwrap .zones button .ic{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:17px}
.delwrap .zones button.in{background:#ecfdf5;border-color:#34d399;color:#064e3b}
.delwrap .zones button.in small{color:#047857}.delwrap .zones button.in .ic{background:#a7f3d0}
.delwrap .zones button.out{background:#eef2ff;border-color:#818cf8;color:#312e81}
.delwrap .zones button.out small{color:#4338ca}.delwrap .zones button.out .ic{background:#c7d2fe}
.delwrap .zones button.on.in{background:#059669;border-color:#047857;color:#fff;box-shadow:0 4px 10px rgba(5,150,105,.35)}
.delwrap .zones button.on.in small{color:#d1fae5}.delwrap .zones button.on.in .ic{background:#fff}
.delwrap .zones button.on.out{background:#4f46e5;border-color:#3730a3;color:#fff;box-shadow:0 4px 10px rgba(79,70,229,.35)}
.delwrap .zones button.on.out small{color:#e0e7ff}.delwrap .zones button.on.out .ic{background:#fff}
.delwrap .g2{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:640px){.delwrap .g2{grid-template-columns:1fr 1fr}}
.delwrap .pays{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.delwrap .pay{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-radius:16px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;cursor:pointer;user-select:none;margin:0}
.delwrap .pay>span{display:flex;align-items:center;gap:8px}
.delwrap .pay .ic{width:32px;height:32px;border-radius:12px;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;font-style:normal}
.delwrap .pay b{display:block;font-size:14px;line-height:1.2}
.delwrap .pay small{font-size:10px;color:#64748b;font-weight:500}
.delwrap .pay input{width:20px!important;height:20px;min-height:0!important;margin:0;padding:0}
.delwrap .pay.visa.on{background:#eff6ff;border-color:#3b82f6;box-shadow:0 0 0 1px #60a5fa;color:#172554}
.delwrap .pay.visa.on .ic{background:#2563eb;color:#fff}
.delwrap .pay.voda.on{background:#fff1f2;border-color:#f43f5e;box-shadow:0 0 0 1px #fb7185;color:#4c0519}
.delwrap .pay.voda.on .ic{background:#e11d48;color:#fff}
.delwrap .go{width:100%;min-height:48px;margin-top:8px;background:#059669;color:#fff;border:0;border-radius:12px;font-size:16px;font-weight:700;box-shadow:0 10px 15px -3px rgba(167,243,208,.9)}
.delwrap .go.ghost{background:#f1f5f9;color:#475569;box-shadow:none}
.delwrap .lhead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding-bottom:8px;border-bottom:1px solid #f1f5f9;margin-bottom:16px}
.delwrap .lhead h2{margin:0;font-size:18px;font-weight:900;color:#1e293b}
.delwrap .pill{display:inline-block;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700;background:#d1fae5;color:#065f46;margin-inline-start:8px}
.delwrap .pill.red{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca}
.delwrap .sndb{font-size:12px;font-weight:600;border-radius:12px;padding:6px 10px;min-height:0;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;box-shadow:none}
.delwrap .sndb.off{background:#f1f5f9;color:#94a3b8;border-color:transparent}
.delwrap .oc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:12px}
.delwrap .oc.batch{border:2px solid #c7d2fe}
.delwrap .oc.outz{border:2px solid #818cf8}
.delwrap .oc.late{background:rgba(254,242,242,.85);border:2px solid #f87171;box-shadow:0 0 0 1px #f87171,0 4px 6px rgba(254,202,202,.6)}
.delwrap .oc .top{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px}
.delwrap .who{display:flex;gap:12px;align-items:center}
.delwrap .av{width:44px;height:44px;border-radius:50%;background:#d1fae5;border:2px solid #a7f3d0;display:flex;align-items:center;justify-content:center;font-size:21px;flex:none}
.delwrap .oc.batch .av,.delwrap .oc.outz .av{background:#eef2ff;border-color:#a5b4fc}
.delwrap .oc.late .av{background:#fee2e2;border-color:#f87171}
.delwrap .who h4{margin:0;font-size:16px;font-weight:900;color:#1e293b;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.delwrap .oc.late .who h4{color:#450a0a}
.delwrap .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center}
.delwrap .cu{font-size:12px;color:#64748b;font-weight:500}
.delwrap .bg{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid}
.delwrap .bg.emp{color:#065f46;background:#ecfdf5;border-color:#a7f3d0}
.delwrap .bg.zin{color:#fff;background:#059669;border-color:#047857;font-size:12.5px;padding:3px 10px;font-weight:800}
.delwrap .bg.zout{color:#fff;background:#4f46e5;border-color:#3730a3;font-size:12.5px;padding:3px 10px;font-weight:800}
.delwrap .bg.cm{color:#78350f;background:#fef3c7;border-color:#fcd34d;font-size:12.5px;padding:3px 10px;font-weight:800}
.delwrap .bg.bat{color:#3730a3;background:#eef2ff;border-color:#c7d2fe;font-size:12px;padding:4px 10px;border-radius:12px}
.delwrap .bg.red{background:#dc2626;color:#fff;border-color:#dc2626;font-weight:800}
.delwrap .tms{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
.delwrap .bd{display:inline-block;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;background:#f1f5f9;color:#334155}
.delwrap .bd.warn{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.delwrap .bd.out{background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe}
.delwrap .bd.late{background:#dc2626;color:#fff}
.delwrap .dt{display:flex;gap:8px;font-size:11px;color:#64748b;font-weight:600}
.delwrap .dt span{background:#f1f5f9;border-radius:6px;padding:2px 8px}
.delwrap .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.delwrap .dgrid>div{background:#f8fafc;border-radius:12px;padding:8px}
.delwrap .oc.late .dgrid>div{background:rgba(254,226,226,.7);border:1px solid #fecaca}
.delwrap .dgrid small{display:block;font-size:10px;color:#64748b;font-weight:600;margin-bottom:2px}
.delwrap .dgrid b{font-size:14px;color:#1e293b}
.delwrap .oc.late .dgrid b{color:#7f1d1d}
.delwrap .pb{display:inline-flex;gap:4px;align-items:center;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:900;border:1px solid;margin-inline-end:8px}
.delwrap .pb.v{background:#dbeafe;color:#1e3a8a;border-color:#bfdbfe}
.delwrap .pb.f{background:#ffe4e6;color:#881337;border-color:#fecdd3}
.delwrap .note{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px;font-size:12px;font-weight:600;color:#78350f}
.delwrap .ftr{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:12px}
.delwrap .tot{background:#f8fafc;border-radius:12px;padding:8px 14px;text-align:center}
.delwrap .tot small{display:block;font-size:10px;color:#64748b;font-weight:700}
.delwrap .tot b{font-size:16px;font-weight:900;color:#047857}
.delwrap .oc.late .tot b{color:#b91c1c}
.delwrap .btns{display:flex;flex-wrap:wrap;gap:8px}
.delwrap .btns button{min-height:42px;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:700;box-shadow:none}
.delwrap .btns .fin{background:#059669;color:#fff;border:0;box-shadow:0 4px 6px rgba(167,243,208,.9);flex:1 1 90px}
.delwrap .btns .prn{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
.delwrap .btns .edt{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}
.delwrap .btns .del{background:#f8fafc;color:#64748b;border:1px solid #e2e8f0}
.delwrap .dk{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:12px}
.delwrap .dk>div{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:12px 14px;border-inline-start:4px solid #10b981}
.delwrap .dk .l{font-size:12px;color:#64748b}.delwrap .dk .v{font-size:21px;font-weight:800}
.delwrap .dk .bad{border-inline-start-color:#dc2626}
.delwrap .chip,.delwrap .seg button{min-height:40px;border-radius:99px;padding:6px 14px;background:#fff;color:#334155;border:1px solid #e2e8f0;font-weight:700;font-size:13px;box-shadow:none}
.delwrap .chip.on{background:#059669;color:#fff;border-color:#059669}
.delwrap .tag{display:inline-block;border-radius:8px;padding:1px 8px;font-size:12px;font-weight:700;background:#f1f5f9;color:#475569;margin-inline-end:4px}
.delwrap .tag.b{background:#eef2ff;color:#3730a3}.delwrap .tag.o{background:#4f46e5;color:#fff}.delwrap .tag.i{background:#059669;color:#fff}
.delwrap .cmm{background:#fff;border:1px solid #fcd34d;border-radius:20px;padding:18px;margin-top:20px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.delwrap .cmm h2{margin:0;font-size:18px;font-weight:900}
.delwrap .cmm .cd{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;color:#475569}
.delwrap .cmm .cd input{width:auto;min-height:40px}
.delwrap .cmm td b{color:#b45309;font-size:16px}
.delwrap .cmm .hint{font-size:12px;color:#64748b;margin:8px 0 0}
.delwrap .tw{overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:12px}
.delwrap table{width:100%;border-collapse:collapse;font-size:13.5px}
.delwrap th,.delwrap td{padding:9px 10px;border-bottom:1px solid #f1f5f9;text-align:center;white-space:nowrap}
.delwrap th{background:#f8fafc;font-size:12.5px;color:#475569}
.delwrap td.l,.delwrap th.l{text-align:start}
.delwrap tr.late td{background:#fef2f2}
.delwrap .ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.delwrap .ctl input,.delwrap .ctl select{width:auto;min-width:130px}
.delwrap .ctl.chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.delwrap .ctl.chips>*{flex:0 0 auto}
.delwrap .empty{text-align:center;color:#64748b;padding:26px 10px;background:#fff;border:1px dashed #cbd5e1;border-radius:16px}
.delwrap h3.sec{margin:16px 0 8px;font-size:16px;font-weight:800}
.delwrap .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
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
  const now = Date.now(), t = opDay(now), ms = 864e5;
  const back = n => opDay(now - n * ms);
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
  return done().filter(o => { const k = opDay(o.endTime); return k >= a && k <= b && (!ST.driver || o.driverName === ST.driver) && (!ST.zone || (o.zone || ZONES[0]) === ST.zone); });
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
</div>
    ${!READY ? '<p class="sub">جاري التحميل…</p>' : ST.view === 'live' ? liveHtml(act) : ST.view === 'stats' ? statsHtml() : logHtml()}`;
  ROOT.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ST.view = b.dataset.v; EDIT = null; render(); });
  ROOT.querySelectorAll('[data-mute]').forEach(b => b.onclick = () => { ST.mute = !ST.mute; render(); });
  bind();
}

function formHtml() {
  const e = EDIT ? ORDERS.find(o => o.id === EDIT) : null, drs = drvList();
  const d = e ? { emp: e.employeeName || '', drv: e.driverName, cus: e.customerName || '', zone: e.zone || '', val: e.orderValue, chg: e.changeGiven || '', visa: !!e.isVisa, voda: !!e.isVodafoneCash, note: e.notes || '' }
    : { emp: DR.emp !== undefined ? DR.emp : (localStorage.getItem('del_emp') || ''), drv: DR.drv || '', cus: DR.cus || '', zone: DR.zone || '', val: DR.val || '', chg: DR.chg || '', visa: !!DR.visa, voda: !!DR.voda, note: DR.note || '' };
  return `<div class="dform ${e ? 'edit' : ''}" id="dForm"><h3>${e ? '✏️ تعديل الأوردر' : '🚀 تسجيل طلب جديد'}</h3>
  <div class="fld emp"><label>الموظف المسئول <span class="req">* (إجباري)</span></label>
    <select id="dEmp"><option value="">-- اختر الموظف المسئول (إجباري) --</option>${EMPLOYEES.map(x => `<option ${x === d.emp ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
  <div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><label style="margin:0">اسم المندوب</label>${isAdm() ? '<button type="button" class="lnk" data-adddrv>+ إضافة مندوب جديد</button>' : ''}</div>
    <div class="row2"><select id="dDrv">${drs.length ? '' : '<option value="">لا يوجد مناديب مسجلين</option>'}${drs.map(x => `<option ${d.drv === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      ${isAdm() ? '<button type="button" class="trash" data-deldrv title="حذف المندوب">🗑</button>' : ''}</div></div>
  <div class="fld"><label>اسم العميل (اختياري)</label><input id="dCus" placeholder="مثال: محمد أحمد" value="${esc(d.cus)}"></div>
  <div class="fld"><label class="lbl b">المنطقة والنطاق <span class="req">* (إجباري — لازم تختار واحدة)</span></label>
    <div class="zones" id="dZone">
      <button type="button" data-z="${ZONES[0]}" class="in ${d.zone === ZONES[0] ? 'on' : ''}"><span class="ic">📍</span><span><b>داخل المعمورة الشاطئ</b><small>من غير عمولة</small></span></button>
      <button type="button" data-z="${ZONES[1]}" class="out ${d.zone === ZONES[1] ? 'on' : ''}"><span class="ic">🧭</span><span><b>خارج المعمورة</b><small>عمولة الدليفري ${COMM_OUT} ج</small></span></button></div></div>
  <div class="fld g2"><div><label class="lbl">قيمة الطلب</label><input id="dVal" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" value="${d.val}"></div>
    <div><label class="lbl">فكة إضافية للطلب</label><input id="dChg" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" value="${d.chg}"></div></div>
  <div class="fld"><label class="lbl">طريقة الدفع الخاصة بالطلب</label><div class="pays">
    <label class="pay visa ${d.visa ? 'on' : ''}"><span><i class="ic">💳</i><span><b>فيزا</b><small>دفع بالفيزا</small></span></span><input type="checkbox" id="dVisa" ${d.visa ? 'checked' : ''}></label>
    <label class="pay voda ${d.voda ? 'on' : ''}"><span><i class="ic">📱</i><span><b>فودافون كاش</b><small>محفظة إلكترونية</small></span></span><input type="checkbox" id="dVoda" ${d.voda ? 'checked' : ''}></label></div></div>
  <div class="fld"><label>ملاحظات (للتذكرة)</label><input id="dNote" placeholder="مثال: تسليم عند الباب الخلفي..." value="${esc(d.note)}"></div>
  <button class="go" id="dGo">${e ? 'حفظ التعديل' : 'بدء التوصيل'}</button>
  ${e ? '<button class="go ghost" id="dCancel">إلغاء التعديل</button>' : ''}<div class="err" id="dErr"></div></div>`;
}

function liveHtml(act) {
  const now = Date.now(), bm = batchMap(ORDERS.filter(o => now - o.startTime < 36 * 3600e3), now);
  const lateN = act.filter(o => { const b = bm.get(o.id) || { th: LATE_SINGLE, start: o.startTime }; return o.zone !== 'خارج المعمورة' && now - b.start >= b.th; }).length;
  const cards = act.map(o => {
    const b = bm.get(o.id) || { th: LATE_SINGLE, start: o.startTime, batch: false, size: 1, idx: 1 }, out = o.zone === 'خارج المعمورة';
    const late = !out && now - b.start >= b.th, min = Math.floor((now - o.startTime) / MIN), warn = min >= (b.batch ? 25 : 15);
    const cls = late ? 'late' : out ? 'outz' : b.batch ? 'batch' : '';
    return `<div class="oc ${cls}" data-id="${o.id}" data-start="${o.startTime}" data-bs="${b.start}" data-th="${b.th}" data-out="${out ? 1 : 0}" data-batch="${b.batch ? 1 : 0}">
      ${b.batch ? `<div><span class="bg bat">🔗 طلعة مجمعة (${b.size} أوردرات معاً) · أوردر #${b.idx} من ${b.size}</span> <span class="cu">${out ? 'خارج المعمورة (بدون إنذار)' : 'مهلة الإنذار: 30 دقيقة'}</span></div>` : ''}
      <div class="top"><div class="who"><div class="av">🛵</div><div>
        <h4>${esc(nm(o.driverName))}${late ? `<span class="bg red" data-lt>⚠ متأخر (+${b.th / MIN} د)</span>` : '<span data-lt></span>'}</h4>
        <div class="chips">${o.customerName ? `<span class="cu">👤 ${esc(o.customerName)}</span>` : ''}${o.employeeName ? `<span class="bg emp">الموظف: ${esc(nm(o.employeeName))}</span>` : ''}<span class="bg ${out ? 'zout' : 'zin'}">${out ? '🧭' : '📍'} ${esc(o.zone || ZONES[0])}</span>${out ? `<span class="bg cm">💰 عمولة الدليفري ${COMM_OUT} ج</span>` : ''}</div></div></div>
        <div class="tms"><span class="bd ${late ? 'late' : out ? 'out' : warn ? 'warn' : ''}" data-bd>🕒 منذ ${min} د${out ? ' · بدون إنذار' : ''}</span>
          <div class="dt"><span>📅 ${dateStr(o.startTime)}</span><span>خروج: ${timeStr(o.startTime)}</span></div></div></div>
      <div class="dgrid"><div><small>قيمة الطلب</small><b>${M(o.orderValue)}</b></div><div><small>فكة للطلب</small><b>${M(o.changeGiven || 0)}</b></div></div>
      ${(o.isVisa || o.isVodafoneCash) ? `<div>${o.isVisa ? '<span class="pb v">💳 دفع بالفيزا</span>' : ''}${o.isVodafoneCash ? '<span class="pb f">📱 فودافون كاش</span>' : ''}</div>` : ''}
      ${o.notes ? `<div class="note">ملاحظة: ${esc(o.notes)}</div>` : ''}
      <div class="ftr"><div class="tot"><small>المبلغ الإجمالي المطلوب</small><b>${M((o.orderValue || 0) + (o.changeGiven || 0))}</b></div>
      ${canWrite() ? `<div class="btns"><button class="fin" data-fin="${o.id}">✔ تسليم</button><button class="prn" data-rc="${o.id}">🖨 طباعة ريسيت</button><button class="edt" data-ed="${o.id}">✏️ تعديل</button>${isAdm() ? `<button class="del" data-rm="${o.id}">🗑 حذف</button>` : ''}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="dlay">${canWrite() ? `<div>${formHtml()}</div>` : ''}
    <div><div class="lhead"><div><h2 style="display:inline">الأوردرات النشطة حالياً</h2><span class="pill">${act.length} جاري توصيلها</span>${lateN ? `<span class="pill red">⚠ ${lateN} متأخر (تجاوز مهلة التوصيل)</span>` : ''}</div>
      <button class="sndb ${ST.mute ? 'off' : ''}" data-mute>${ST.mute ? '🔇 الصوت مكتوم' : '🔊 الصوت مفعل'}</button></div>
      ${cards || '<div class="empty">لا توجد طلبات نشطة حالياً</div>'}</div></div>${commHtml()}`;
}

// عمولة الدليفري باليوم (طلبه 2/11): الأوردرات اللي اتسلّمت خارج المعمورة في اليوم ده × 5 ج، لكل مندوب
function commHtml() {
  const day = ST.cday || opDay(Date.now()), per = new Map();
  drvList().forEach(n => per.set(n, 0));
  done().forEach(o => { if (isOut(o) && opDay(o.endTime) === day) per.set(o.driverName, (per.get(o.driverName) || 0) + 1); });
  const rows = [...per.entries()].sort((a, b) => b[1] - a[1]), tot = rows.reduce((s, r) => s + r[1], 0);
  return `<div class="cmm"><div class="lhead" style="border:0;margin-bottom:8px"><h2>💰 عمولة الدليفري — يوم ${+day.slice(8)}/${+day.slice(5, 7)} <small style="font-size:12px;color:#64748b;font-weight:600">(من 9 ص لـ 9 ص)</small></h2>
    <div class="cd"><label for="cDay">اليوم:</label><input type="date" id="cDay" value="${day}"></div></div>
  <div class="tw" style="margin:0"><table><tr><th class="l">المندوب</th><th>أوردرات خارج المعمورة اتسلّمت</th><th>العمولة (${COMM_OUT} ج للأوردر)</th></tr>
  ${rows.map(([n, c]) => `<tr><td class="l"><b style="color:#1e293b;font-size:14px">${esc(nm(n))}</b></td><td>${c}</td><td><b>${M(c * COMM_OUT)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">مفيش مناديب</td></tr>'}
  ${rows.length > 1 ? `<tr><td class="l"><b style="color:#1e293b">الإجمالي</b></td><td><b style="color:#1e293b">${tot}</b></td><td><b>${M(tot * COMM_OUT)}</b></td></tr>` : ''}</table></div>
  <p class="hint">بتتحسب على الأوردرات اللي اتضغط عليها «تسليم» خارج المعمورة في اليوم ده. اليوم بيبدأ 9 الصبح وبيخلص 9 الصبح اللي بعده، فالشيفت اللي بيعدّي نص الليل عمولته كلها في يوم واحد. الأوردر الشغال لسه ملوش عمولة لحد ما يتسلّم.</p></div>`;
}

function statsHtml() {
  const list = filtered(), bm = batchMap(done(), Date.now()), ds = driverStats(list, bm);
  const tot = list.length, ms = list.reduce((s, o) => s + orderMs(o, bm.get(o.id)), 0), late = list.filter(o => orderMs(o, bm.get(o.id)) > PROMISE).length;
  const val = list.reduce((s, o) => s + (o.orderValue || 0), 0), out = list.filter(o => o.zone === 'خارج المعمورة');
  const days = {}; list.forEach(o => { const k = opDay(o.endTime); (days[k] = days[k] || []).push(o); });
  return `${filterBar()}
  <div class="dk"><div><div class="l">أوردرات اتسلّمت</div><div class="v">${N(tot)}</div></div>
    <div><div class="l">متوسط الوقت للأوردر</div><div class="v">${tot ? durMin(ms / tot) : '—'}</div></div>
    <div class="${late ? 'bad' : ''}"><div class="l">أكتر من 30 دقيقة</div><div class="v">${N(late)}${tot ? ` <small>(${Math.round(late / tot * 100)}%)</small>` : ''}</div></div>
    <div><div class="l">قيمة الأوردرات</div><div class="v">${M(val)}</div></div>
    <div><div class="l">خارج المعمورة</div><div class="v">${N(out.length)}</div><div class="l">${M(out.reduce((s, o) => s + (o.orderValue || 0), 0))}</div></div>
    <div style="border-inline-start-color:#f59e0b"><div class="l">عمولة الدليفري</div><div class="v">${M(out.length * COMM_OUT)}</div><div class="l">${COMM_OUT} ج × ${N(out.length)} أوردر</div></div></div>
  <h3 class="sec">الطيارين</h3><div class="tw"><table><tr><th class="l">الطيار</th><th>أوردرات</th><th>متوسط الوقت</th><th>&lt;10</th><th>10–15</th><th>15–20</th><th>20–30</th><th>&gt;30</th><th>خارج المعمورة</th><th>عمولة الدليفري</th><th>القيمة</th></tr>
  ${ds.map(d => `<tr><td class="l"><b>${esc(nm(d.n))}</b></td><td>${d.c}</td><td>${d.c ? durMin(d.ms / d.c) : '—'}</td>${d.b.map((x, i) => `<td ${i === 4 && x ? 'style="color:#C0392B;font-weight:800"' : ''}>${x}</td>`).join('')}<td>${d.out}${d.out ? ` (${M(d.outVal)})` : ''}</td><td><b style="color:#b45309">${M(d.out * COMM_OUT)}</b></td><td>${M(d.val)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">مفيش بيانات في الفترة دي</td></tr>'}</table></div>
  <h3 class="sec">🏆 ترتيب المناديب (الأسرع)</h3><div class="tw"><table><tr><th>#</th><th class="l">المندوب</th><th>أوردرات</th><th>متوسط الوقت</th><th>أكتر من 30 د</th><th>نسبة التأخير</th></tr>
  ${ds.filter(d => d.c).sort((a, b) => a.ms / a.c - b.ms / b.c).map((d, i) => `<tr><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="l"><b>${esc(nm(d.n))}</b></td><td>${d.c}</td><td><b>${durMin(d.ms / d.c)}</b></td><td>${d.b[4]}</td><td ${d.b[4] ? 'style="color:#dc2626;font-weight:800"' : ''}>${Math.round(d.b[4] / d.c * 100)}%</td></tr>`).join('') || '<tr><td colspan="6" class="empty">مفيش بيانات في الفترة دي</td></tr>'}</table></div>
  <h3 class="sec">يوم بيوم</h3><div class="tw"><table><tr><th class="l">اليوم</th><th>أوردرات</th><th>متوسط الوقت</th><th>&gt;30 د</th><th>خارج المعمورة</th><th>عمولة الدليفري</th><th>القيمة</th></tr>
  ${Object.keys(days).sort().reverse().map(k => { const a = days[k], t = a.reduce((s, o) => s + orderMs(o, bm.get(o.id)), 0); return `<tr><td class="l">${k.slice(8)}/${k.slice(5, 7)}</td><td>${a.length}</td><td>${durMin(t / a.length)}</td><td>${a.filter(o => orderMs(o, bm.get(o.id)) > PROMISE).length}</td><td>${a.filter(isOut).length}</td><td><b style="color:#b45309">${M(a.filter(isOut).length * COMM_OUT)}</b></td><td>${M(a.reduce((s, o) => s + (o.orderValue || 0), 0))}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}</table></div>
  <div class="ctl"><button class="ghost" data-xl>📥 تنزيل إكسل (السجل + الطيارين)</button><button class="ghost" data-rep>📋 نسخ تقرير للواتساب</button></div>`;
}

function logHtml() {
  const list = filtered().sort((a, b) => b.endTime - a.endTime), bm = batchMap(done(), Date.now()), shown = list.slice(0, ST.shown);
  return `${filterBar()}<div class="tw"><table><tr><th class="l">اليوم</th><th>خرج</th><th>وصل</th><th>الوقت</th><th class="l">الطيار</th><th class="l">العميل</th><th>المنطقة</th><th>عمولة</th><th>القيمة</th><th>الدفع</th><th class="l">سجّله</th>${isAdm() ? '<th></th>' : ''}</tr>
  ${shown.map(o => { const b = bm.get(o.id), t = orderMs(o, b), late = t > PROMISE;
    return `<tr class="${late ? 'late' : ''}"><td class="l">${dayLbl(o.endTime)}</td><td>${timeStr(o.startTime)}</td><td>${timeStr(o.endTime)}</td><td><b>${durMin(t)}</b>${b && b.batch ? ` <span class="tag b">طلعة ${b.size}</span>` : ''}</td><td class="l">${esc(nm(o.driverName))}</td><td class="l">${esc(o.customerName || '—')}${o.notes ? ' 📝' : ''}</td><td>${isOut(o) ? '<span class="tag o">خارج المعمورة</span>' : '<span class="tag i">داخل المعمورة</span>'}</td><td>${isOut(o) ? M(COMM_OUT) : '—'}</td><td>${M(o.orderValue)}</td><td>${o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون' : 'كاش'}</td><td class="l">${esc(nm(o.employeeName) || '—')}</td>${isAdm() ? `<td><button class="ghost sm" data-ed="${o.id}">✏️</button> <button class="ghost sm" data-rc="${o.id}">🧾</button> <button class="ghost sm" data-rm="${o.id}">🗑️</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="12" class="empty">مفيش أوردرات في الفترة دي</td></tr>`}</table></div>
  ${list.length > ST.shown ? `<button class="ghost" data-more>عرض المزيد (${list.length - ST.shown})</button>` : ''}<p class="sub">${N(list.length)} أوردر في الفترة · الصف الأحمر = أكتر من 30 دقيقة.</p>`;
}

function filterBar() {
  const P = [['today', 'النهارده'], ['yest', 'إمبارح'], ['7', 'آخر 7 أيام'], ['month', 'الشهر ده'], ['all', 'الكل'], ['custom', 'من – إلى']];
  return `<div class="ctl chips">${P.map(p => `<button class="chip ${ST.period === p[0] ? 'on' : ''}" data-p="${p[0]}">${p[1]}</button>`).join('')}</div>
  <p class="sub" style="margin:0 0 8px">اليوم = من 9 الصبح لـ 9 الصبح اللي بعده.</p>
  <div class="ctl">${ST.period === 'custom' ? `<input type="date" id="fFrom" value="${ST.from}"><input type="date" id="fTo" value="${ST.to}">` : ''}
    <select id="fDrv"><option value="">كل الطيارين</option>${drvList().map(d => `<option ${ST.driver === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
    <select id="fZone"><option value="">كل المناطق</option>${ZONES.map(z => `<option ${ST.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>`;
}

/* ---------- الأحداث ---------- */
function bind() {
  ROOT.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { ST.period = b.dataset.p; ST.shown = 60; render(); });
  [['fFrom', 'from'], ['fTo', 'to'], ['fDrv', 'driver'], ['fZone', 'zone']].forEach(([id, k]) => { const e = $('#' + id, ROOT); if (e) e.onchange = () => { ST[k] = e.value; ST.shown = 60; render(); }; });
  const cd = $('#cDay', ROOT); if (cd) cd.onchange = () => { ST.cday = cd.value; render(); };
  const more = $('[data-more]', ROOT); if (more) more.onclick = () => { ST.shown += 100; render(); };
  const xl = $('[data-xl]', ROOT); if (xl) xl.onclick = exportXl;
  const rp = $('[data-rep]', ROOT); if (rp) rp.onclick = copyReport;
  ROOT.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finish(b.dataset.fin));
  ROOT.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => receipt(b.dataset.rc));
  ROOT.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { EDIT = b.dataset.ed; ST.view = 'live'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  ROOT.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => remove(b.dataset.rm));
  const f = $('#dForm', ROOT); if (!f) return;
  f.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { f.querySelectorAll('[data-z]').forEach(x => x.classList.remove('on')); b.classList.add('on'); $('#dZone', f).classList.remove('miss'); draft(); });
  f.addEventListener('input', draft); f.addEventListener('change', draft);
  f.querySelectorAll('.pay input').forEach(i => i.onchange = () => i.closest('.pay').classList.toggle('on', i.checked));
  $('#dGo', f).onclick = save;
  const c = $('#dCancel', f); if (c) c.onclick = () => { EDIT = null; render(); };
  const ad = $('[data-adddrv]', f); if (ad) ad.onclick = addDrv;
  const dd = $('[data-deldrv]', f); if (dd) dd.onclick = delDrv;
}

function draft() {
  if (EDIT) return;
  const g = id => { const e = $('#' + id, ROOT); return e ? e : { value: '', checked: false }; }, z = ROOT.querySelector('[data-z].on');
  DR = { emp: g('dEmp').value, drv: g('dDrv').value, cus: g('dCus').value, zone: z ? z.dataset.z : '', val: g('dVal').value, chg: g('dChg').value, visa: g('dVisa').checked, voda: g('dVoda').checked, note: g('dNote').value };
}

async function save() {
  const err = $('#dErr'), g = id => $('#' + id, ROOT), emp = g('dEmp').value, drv = g('dDrv').value;
  const z = ROOT.querySelector('[data-z].on');
  err.textContent = '';
  if (!emp) { err.textContent = 'اختار الموظف اللي سجّل الأوردر'; return; }
  if (!drv) { err.textContent = 'مفيش طيار — ضيف طيار الأول'; return; }
  if (!z) { err.textContent = 'لازم تختار المنطقة: داخل المعمورة ولا خارج المعمورة'; $('#dZone', ROOT).classList.add('miss'); $('#dZone', ROOT).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const val = parseFloat(g('dVal').value) || 0, chg = parseFloat(g('dChg').value) || 0;
  if (val < 0 || val >= 100000 || chg < 0) { err.textContent = 'راجع القيمة'; return; }
  const data = { driverName: drv, customerName: g('dCus').value.trim(), employeeName: emp, zone: z.dataset.z, orderValue: val, changeGiven: chg,
    isVisa: g('dVisa').checked, isVodafoneCash: g('dVoda').checked, notes: g('dNote').value.trim() };
  try {
    localStorage.setItem('del_emp', emp);
    if (EDIT) { await updateDoc(doc(DB, 'deliv_orders', EDIT), data); EDIT = null; toast('اتعدّل ✔'); }
    else { const ref = doc(collection(DB, 'deliv_orders')); await setDoc(ref, { ...data, startTime: Date.now(), endTime: null, status: 'PENDING', by: UID }); beep(660, 1); toast('الأوردر بدأ 🛵'); DR = {}; }
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

function copyReport() {
  const list = filtered(), bm = batchMap(done(), Date.now()), ds = driverStats(list, bm).filter(d => d.c), [a, b] = periodRange();
  const tot = list.length, ms = list.reduce((x, o) => x + orderMs(o, bm.get(o.id)), 0), late = list.filter(o => orderMs(o, bm.get(o.id)) > PROMISE).length;
  const lbl = k => `${+k.slice(8)}/${+k.slice(5, 7)}`, per = a === b ? `يوم ${lbl(a)}` : `من ${a < '0001' ? 'البداية' : lbl(a)} لـ ${b > '9998' ? 'النهاردة' : lbl(b)}`;
  const t = [`📋 تقرير الدليفري — ${per} (9ص–9ص)`, `✅ اتسلّم ${tot} أوردر · متوسط الوقت ${tot ? durMin(ms / tot) : '—'} · أكتر من 30 دقيقة: ${late}`, `💵 قيمة الأوردرات: ${M(list.reduce((x, o) => x + (o.orderValue || 0), 0))}`, '',
    '🛵 المناديب:', ...ds.map(d => `• ${nm(d.n)}: ${d.c} أوردر (${d.out} خارج المعمورة) · متوسط ${durMin(d.ms / d.c)} · عمولة ${M(d.out * COMM_OUT)}`),
    '', `💰 إجمالي عمولة الدليفري: ${M(list.filter(isOut).length * COMM_OUT)}`].join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('اتنسخ — الصقه في الواتساب ✔')) : Promise.reject()).catch(() => prompt('انسخ التقرير:', t));
}

function exportXl() {
  if (!window.XLSX) { toast('مكتبة الإكسل مش محملة'); return; }
  const list = filtered().sort((a, b) => a.endTime - b.endTime), bm = batchMap(done(), Date.now());
  const log = [['اليوم التشغيلي (9ص–9ص)', 'خرج', 'وصل', 'وقت الأوردر (دقيقة)', 'طلعة مجمعة (عدد)', 'الطيار', 'العميل', 'المنطقة', 'القيمة', 'الفكة', 'الدفع', 'عمولة الدليفري', 'سجّله', 'ملاحظات']]
    .concat(list.map(o => { const b = bm.get(o.id); return [opDay(o.endTime), timeStr(o.startTime), timeStr(o.endTime), +(orderMs(o, b) / MIN).toFixed(1), b && b.batch ? b.size : 1, o.driverName, o.customerName, o.zone || ZONES[0], o.orderValue, o.changeGiven, o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون كاش' : 'كاش', commOf(o), o.employeeName, o.notes]; }));
  const drv = [['الطيار', 'أوردرات', 'متوسط الوقت (دقيقة)', 'أقل من 10', '10–15', '15–20', '20–30', 'أكتر من 30', 'خارج المعمورة (عدد)', 'خارج المعمورة (قيمة)', 'عمولة الدليفري', 'القيمة']]
    .concat(driverStats(list, bm).map(d => [d.n, d.c, d.c ? +(d.ms / d.c / MIN).toFixed(1) : 0, ...d.b, d.out, d.outVal, d.out * COMM_OUT, d.val]));
  const how = [['طريقة الحساب'], ['وقت الأوردر = وقت الوصول − وقت الخروج.'], ['الطلعة المجمعة: أوردرات نفس الطيار بينها 5 دقايق أو أقل = طلعة واحدة، ونصيب كل أوردر = وقت الطلعة ÷ عدد الأوردرات.'],
    ['مثال: طيار خرج بأوردرين الساعة 3:00 و3:02 ورجع 3:40 → وقت الطلعة 40 دقيقة ÷ 2 = 20 دقيقة لكل أوردر.'], ['"أكتر من 30" = الأوردر اللي عدّى وعد التوصيل (30 دقيقة).'], ['عمولة الدليفري = ' + COMM_OUT + ' ج × عدد الأوردرات اللي اتسلّمت خارج المعمورة. مثال: مندوب سلّم 8 أوردرات خارج المعمورة في اليوم = 8 × ' + COMM_OUT + ' = ' + (8 * COMM_OUT) + ' ج.'], ['الفترة: ' + periodRange().join(' → ')], ['اليوم التشغيلي بيبدأ 9 الصبح وبيخلص 9 الصبح اللي بعده.']];
  const wb = XLSX.utils.book_new();
  [['طريقة الحساب', how], ['الطيارين', drv], ['السجل', log]].forEach(([n, r]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r), n));
  XLSX.writeFile(wb, `دليفري_${opDay(Date.now())}.xlsx`);
}

/* ---------- تايمر ---------- */
function tick() {
  const now = Date.now();
  ROOT.querySelectorAll('.oc[data-start]').forEach(c => {
    const out = c.dataset.out === '1', min = Math.floor((now - +c.dataset.start) / MIN);
    const late = !out && now - +c.dataset.bs >= +c.dataset.th, warn = min >= (c.dataset.batch === '1' ? 25 : 15);
    const bd = c.querySelector('[data-bd]'); if (bd) { bd.textContent = `🕒 منذ ${min} د${out ? ' · بدون إنذار' : ''}`; bd.className = 'bd ' + (late ? 'late' : out ? 'out' : warn ? 'warn' : ''); }
    if (late !== c.classList.contains('late')) {
      c.classList.toggle('late', late);
      const lt = c.querySelector('[data-lt]'); if (lt) { lt.className = late ? 'bg red' : ''; lt.textContent = late ? `⚠ متأخر (+${+c.dataset.th / MIN} د)` : ''; }
    }
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
