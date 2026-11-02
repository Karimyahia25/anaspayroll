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
let ASG = {};   // اختيار المندوب والمنطقة لأوردرات السيستم اللي لسه متوزعتش
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
:is(#adm,#delivery) .delwrap .dbar{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px 0 14px;padding:4px;border-radius:16px;background:#f1f5f9;border:1px solid #e2e8f0}
:is(#adm,#delivery) .delwrap .dbar::-webkit-scrollbar{display:none}
:is(#adm,#delivery) .delwrap .dbar button{flex:1 0 auto;background:transparent;color:#475569;border:0;border-radius:12px;padding:9px 16px;font-size:14px;font-weight:700;min-height:44px;box-shadow:none}
:is(#adm,#delivery) .delwrap .dbar button.on{background:#fff;color:#047857;box-shadow:0 1px 2px rgba(0,0,0,.08)}
:is(#adm,#delivery) .delwrap .dbar .n{display:inline-block;margin-inline-start:6px;background:#d1fae5;color:#065f46;border-radius:99px;padding:1px 8px;font-size:12px}
:is(#adm,#delivery) .delwrap .dlay{display:grid;gap:20px;grid-template-columns:1fr;align-items:start}
@media(min-width:1024px){:is(#adm,#delivery) .delwrap .dlay{grid-template-columns:5fr 7fr}}
:is(#adm,#delivery) .delwrap .dform{background:#fff;border-radius:24px;border:1px solid #e2e8f0;padding:24px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
:is(#adm,#delivery) .delwrap .dform.edit{outline:3px solid #fbbf24}
:is(#adm,#delivery) .delwrap .dform h3{margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0;font-size:18px;font-weight:800;color:#1e293b}
:is(#adm,#delivery) .delwrap .fld{margin-bottom:16px}
:is(#adm,#delivery) .delwrap .fld>label,:is(#adm,#delivery) .delwrap .lbl{display:block;font-size:14px;font-weight:500;color:#475569;margin:0 0 4px}
:is(#adm,#delivery) .delwrap .lbl.b{font-weight:700;color:#334155}
:is(#adm,#delivery) .delwrap .req{color:#ef4444;font-weight:800}
:is(#adm,#delivery) .delwrap .dform input[type=text],:is(#adm,#delivery) .delwrap .dform input[type=number],:is(#adm,#delivery) .delwrap .dform input:not([type]),:is(#adm,#delivery) .delwrap .dform select{width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font-size:15px;color:#1e293b;margin:0;min-height:44px}
:is(#adm,#delivery) .delwrap .dform input:focus,:is(#adm,#delivery) .delwrap .dform select:focus{outline:2px solid #10b981;border-color:#10b981}
:is(#adm,#delivery) .delwrap .emp select{font-weight:700}
:is(#adm,#delivery) .delwrap .row2{display:flex;gap:8px}
:is(#adm,#delivery) .delwrap .row2 select{flex:1}
:is(#adm,#delivery) .delwrap .trash{background:#fef2f2;color:#ef4444;border:0;border-radius:12px;padding:0 14px;min-height:44px;font-size:17px;box-shadow:none}
:is(#adm,#delivery) .delwrap .lnk{background:none;border:0;color:#059669;font-size:12px;font-weight:600;padding:0;min-height:0;box-shadow:none;cursor:pointer}
:is(#adm,#delivery) .delwrap .zones{display:grid;grid-template-columns:1fr 1fr;gap:10px}
:is(#adm,#delivery) .delwrap .zones.miss button{box-shadow:0 0 0 3px #fca5a5}
:is(#adm,#delivery) .delwrap .zones button{border-radius:16px;padding:14px 12px;text-align:right;display:flex;flex-direction:column;gap:8px;min-height:104px;font-weight:400;align-items:stretch;border-width:2px;border-style:solid;box-shadow:none}
:is(#adm,#delivery) .delwrap .zones button b{display:block;font-size:17px;font-weight:900;line-height:1.3}
:is(#adm,#delivery) .delwrap .zones button small{font-size:13px;font-weight:700}
:is(#adm,#delivery) .delwrap .zones button .ic{width:34px;height:34px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:17px}
:is(#adm,#delivery) .delwrap .zones button.in{background:#ecfdf5;border-color:#34d399;color:#064e3b}
:is(#adm,#delivery) .delwrap .zones button.in small{color:#047857}:is(#adm,#delivery) .delwrap .zones button.in .ic{background:#a7f3d0}
:is(#adm,#delivery) .delwrap .zones button.out{background:#eef2ff;border-color:#818cf8;color:#312e81}
:is(#adm,#delivery) .delwrap .zones button.out small{color:#4338ca}:is(#adm,#delivery) .delwrap .zones button.out .ic{background:#c7d2fe}
:is(#adm,#delivery) .delwrap .zones button.on.in{background:#059669;border-color:#047857;color:#fff;box-shadow:0 4px 10px rgba(5,150,105,.35)}
:is(#adm,#delivery) .delwrap .zones button.on.in small{color:#d1fae5}:is(#adm,#delivery) .delwrap .zones button.on.in .ic{background:#fff}
:is(#adm,#delivery) .delwrap .zones button.on.out{background:#4f46e5;border-color:#3730a3;color:#fff;box-shadow:0 4px 10px rgba(79,70,229,.35)}
:is(#adm,#delivery) .delwrap .zones button.on.out small{color:#e0e7ff}:is(#adm,#delivery) .delwrap .zones button.on.out .ic{background:#fff}
:is(#adm,#delivery) .delwrap .g2{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:640px){:is(#adm,#delivery) .delwrap .g2{grid-template-columns:1fr 1fr}}
:is(#adm,#delivery) .delwrap .pays{display:grid;grid-template-columns:1fr 1fr;gap:12px}
:is(#adm,#delivery) .delwrap .pay{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px;border-radius:16px;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;cursor:pointer;user-select:none;margin:0}
:is(#adm,#delivery) .delwrap .pay>span{display:flex;align-items:center;gap:8px}
:is(#adm,#delivery) .delwrap .pay .ic{width:32px;height:32px;border-radius:12px;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;font-style:normal}
:is(#adm,#delivery) .delwrap .pay b{display:block;font-size:14px;line-height:1.2}
:is(#adm,#delivery) .delwrap .pay small{font-size:10px;color:#64748b;font-weight:500}
:is(#adm,#delivery) .delwrap .pay input{width:20px!important;height:20px;min-height:0!important;margin:0;padding:0}
:is(#adm,#delivery) .delwrap .pay.visa.on{background:#eff6ff;border-color:#3b82f6;box-shadow:0 0 0 1px #60a5fa;color:#172554}
:is(#adm,#delivery) .delwrap .pay.visa.on .ic{background:#2563eb;color:#fff}
:is(#adm,#delivery) .delwrap .pay.voda.on{background:#fff1f2;border-color:#f43f5e;box-shadow:0 0 0 1px #fb7185;color:#4c0519}
:is(#adm,#delivery) .delwrap .pay.voda.on .ic{background:#e11d48;color:#fff}
:is(#adm,#delivery) .delwrap .go{width:100%;min-height:48px;margin-top:8px;background:#059669;color:#fff;border:0;border-radius:12px;font-size:16px;font-weight:700;box-shadow:0 10px 15px -3px rgba(167,243,208,.9)}
:is(#adm,#delivery) .delwrap .go.ghost{background:#f1f5f9;color:#475569;box-shadow:none}
:is(#adm,#delivery) .delwrap .lhead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;padding-bottom:8px;border-bottom:1px solid #f1f5f9;margin-bottom:16px}
:is(#adm,#delivery) .delwrap .lhead h2{margin:0;font-size:18px;font-weight:900;color:#1e293b}
:is(#adm,#delivery) .delwrap .pill{display:inline-block;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700;background:#d1fae5;color:#065f46;margin-inline-start:8px}
:is(#adm,#delivery) .delwrap .pill.red{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca}
:is(#adm,#delivery) .delwrap .sndb{font-size:12px;font-weight:600;border-radius:12px;padding:6px 10px;min-height:0;border:1px solid #a7f3d0;background:#ecfdf5;color:#047857;box-shadow:none}
:is(#adm,#delivery) .delwrap .sndb.off{background:#f1f5f9;color:#94a3b8;border-color:transparent}
:is(#adm,#delivery) .delwrap .oc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:12px}
:is(#adm,#delivery) .delwrap .oc.batch{border:2px solid #c7d2fe}
:is(#adm,#delivery) .delwrap .oc.outz{border:2px solid #818cf8}
:is(#adm,#delivery) .delwrap .oc.late{background:rgba(254,242,242,.85);border:2px solid #f87171;box-shadow:0 0 0 1px #f87171,0 4px 6px rgba(254,202,202,.6)}
:is(#adm,#delivery) .delwrap .oc .top{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px}
:is(#adm,#delivery) .delwrap .who{display:flex;gap:12px;align-items:center}
:is(#adm,#delivery) .delwrap .av{width:44px;height:44px;border-radius:50%;background:#d1fae5;border:2px solid #a7f3d0;display:flex;align-items:center;justify-content:center;font-size:21px;flex:none}
:is(#adm,#delivery) .delwrap .oc.batch .av,:is(#adm,#delivery) .delwrap .oc.outz .av{background:#eef2ff;border-color:#a5b4fc}
:is(#adm,#delivery) .delwrap .oc.late .av{background:#fee2e2;border-color:#f87171}
:is(#adm,#delivery) .delwrap .who h4{margin:0;font-size:16px;font-weight:900;color:#1e293b;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
:is(#adm,#delivery) .delwrap .oc.late .who h4{color:#450a0a}
:is(#adm,#delivery) .delwrap .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center}
:is(#adm,#delivery) .delwrap .cu{font-size:12px;color:#64748b;font-weight:500}
:is(#adm,#delivery) .delwrap .bg{font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid}
:is(#adm,#delivery) .delwrap .bg.emp{color:#065f46;background:#ecfdf5;border-color:#a7f3d0}
:is(#adm,#delivery) .delwrap .bg.zin{color:#fff;background:#059669;border-color:#047857;font-size:12.5px;padding:3px 10px;font-weight:800}
:is(#adm,#delivery) .delwrap .bg.zout{color:#fff;background:#4f46e5;border-color:#3730a3;font-size:12.5px;padding:3px 10px;font-weight:800}
:is(#adm,#delivery) .delwrap .bg.cm{color:#78350f;background:#fef3c7;border-color:#fcd34d;font-size:12.5px;padding:3px 10px;font-weight:800}
:is(#adm,#delivery) .delwrap .bg.bat{color:#3730a3;background:#eef2ff;border-color:#c7d2fe;font-size:12px;padding:4px 10px;border-radius:12px}
:is(#adm,#delivery) .delwrap .bg.red{background:#dc2626;color:#fff;border-color:#dc2626;font-weight:800}
:is(#adm,#delivery) .delwrap .tms{display:flex;flex-direction:column;gap:6px;align-items:flex-end}
:is(#adm,#delivery) .delwrap .bd{display:inline-block;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;background:#f1f5f9;color:#334155}
:is(#adm,#delivery) .delwrap .bd.warn{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
:is(#adm,#delivery) .delwrap .bd.out{background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe}
:is(#adm,#delivery) .delwrap .bd.late{background:#dc2626;color:#fff}
:is(#adm,#delivery) .delwrap .dt{display:flex;gap:8px;font-size:11px;color:#64748b;font-weight:600}
:is(#adm,#delivery) .delwrap .dt span{background:#f1f5f9;border-radius:6px;padding:2px 8px}
:is(#adm,#delivery) .delwrap .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
:is(#adm,#delivery) .delwrap .dgrid>div{background:#f8fafc;border-radius:12px;padding:8px}
:is(#adm,#delivery) .delwrap .oc.late .dgrid>div{background:rgba(254,226,226,.7);border:1px solid #fecaca}
:is(#adm,#delivery) .delwrap .dgrid small{display:block;font-size:10px;color:#64748b;font-weight:600;margin-bottom:2px}
:is(#adm,#delivery) .delwrap .dgrid b{font-size:14px;color:#1e293b}
:is(#adm,#delivery) .delwrap .oc.late .dgrid b{color:#7f1d1d}
:is(#adm,#delivery) .delwrap .pb{display:inline-flex;gap:4px;align-items:center;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:900;border:1px solid;margin-inline-end:8px}
:is(#adm,#delivery) .delwrap .pb.v{background:#dbeafe;color:#1e3a8a;border-color:#bfdbfe}
:is(#adm,#delivery) .delwrap .pb.f{background:#ffe4e6;color:#881337;border-color:#fecdd3}
:is(#adm,#delivery) .delwrap .note{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:10px;font-size:12px;font-weight:600;color:#78350f}
:is(#adm,#delivery) .delwrap .ftr{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:12px}
:is(#adm,#delivery) .delwrap .tot{background:#f8fafc;border-radius:12px;padding:8px 14px;text-align:center}
:is(#adm,#delivery) .delwrap .tot small{display:block;font-size:10px;color:#64748b;font-weight:700}
:is(#adm,#delivery) .delwrap .tot b{font-size:16px;font-weight:900;color:#047857}
:is(#adm,#delivery) .delwrap .oc.late .tot b{color:#b91c1c}
:is(#adm,#delivery) .delwrap .btns{display:flex;flex-wrap:wrap;gap:8px}
:is(#adm,#delivery) .delwrap .btns button{min-height:42px;border-radius:12px;padding:8px 14px;font-size:13px;font-weight:700;box-shadow:none}
:is(#adm,#delivery) .delwrap .btns .fin{background:#059669;color:#fff;border:0;box-shadow:0 4px 6px rgba(167,243,208,.9);flex:1 1 90px}
:is(#adm,#delivery) .delwrap .btns .prn{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
:is(#adm,#delivery) .delwrap .btns .edt{background:#f1f5f9;color:#334155;border:1px solid #e2e8f0}
:is(#adm,#delivery) .delwrap .btns .del{background:#f8fafc;color:#64748b;border:1px solid #e2e8f0}
:is(#adm,#delivery) .delwrap .oc.asg{background:#fffbeb;border:2px dashed #f59e0b}
:is(#adm,#delivery) .delwrap .asgbox{display:flex;flex-direction:column;gap:10px;border-top:1px solid #fde68a;padding-top:12px}
:is(#adm,#delivery) .delwrap .asgbox select{width:100%;background:#fff;border:1px solid #fcd34d;border-radius:12px;padding:10px 12px;font-size:15px;font-weight:700;min-height:44px}
:is(#adm,#delivery) .delwrap .asgbox .zones button{min-height:78px;padding:10px;gap:6px}
:is(#adm,#delivery) .delwrap .asgbox .zones button b{font-size:15px}
:is(#adm,#delivery) .delwrap .asgbox .zones.miss button{box-shadow:0 0 0 3px #fca5a5}
:is(#adm,#delivery) .delwrap .pill.am{background:#fef3c7;color:#92400e;border:1px solid #fcd34d}
:is(#adm,#delivery) .delwrap .hint2{font-size:12px;color:#64748b;margin:-8px 0 14px;background:#f8fafc;border-radius:10px;padding:8px 10px}
:is(#adm,#delivery) .delwrap .dk{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:12px}
:is(#adm,#delivery) .delwrap .dk>div{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:12px 14px;border-inline-start:4px solid #10b981}
:is(#adm,#delivery) .delwrap .dk .l{font-size:12px;color:#64748b}:is(#adm,#delivery) .delwrap .dk .v{font-size:21px;font-weight:800}
:is(#adm,#delivery) .delwrap .dk .bad{border-inline-start-color:#dc2626}
:is(#adm,#delivery) .delwrap .chip,:is(#adm,#delivery) .delwrap .seg button{min-height:40px;border-radius:99px;padding:6px 14px;background:#fff;color:#334155;border:1px solid #e2e8f0;font-weight:700;font-size:13px;box-shadow:none}
:is(#adm,#delivery) .delwrap .chip.on{background:#059669;color:#fff;border-color:#059669}
:is(#adm,#delivery) .delwrap .tag{display:inline-block;border-radius:8px;padding:1px 8px;font-size:12px;font-weight:700;background:#f1f5f9;color:#475569;margin-inline-end:4px}
:is(#adm,#delivery) .delwrap .tag.b{background:#eef2ff;color:#3730a3}:is(#adm,#delivery) .delwrap .tag.o{background:#4f46e5;color:#fff}:is(#adm,#delivery) .delwrap .tag.i{background:#059669;color:#fff}
:is(#adm,#delivery) .delwrap .cmm{background:#fff;border:1px solid #fcd34d;border-radius:20px;padding:18px;margin-top:20px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
:is(#adm,#delivery) .delwrap .cmm h2{margin:0;font-size:18px;font-weight:900}
:is(#adm,#delivery) .delwrap .cmm .cd{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700;color:#475569}
:is(#adm,#delivery) .delwrap .cmm .cd input{width:auto;min-height:40px}
:is(#adm,#delivery) .delwrap .cmm td b{color:#b45309;font-size:16px}
:is(#adm,#delivery) .delwrap .cmm .hint{font-size:12px;color:#64748b;margin:8px 0 0}
:is(#adm,#delivery) .delwrap .tw{overflow-x:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:12px}
:is(#adm,#delivery) .delwrap table{width:100%;border-collapse:collapse;font-size:13.5px}
:is(#adm,#delivery) .delwrap th,:is(#adm,#delivery) .delwrap td{padding:9px 10px;border-bottom:1px solid #f1f5f9;text-align:center;white-space:nowrap}
:is(#adm,#delivery) .delwrap th{background:#f8fafc;font-size:12.5px;color:#475569}
:is(#adm,#delivery) .delwrap td.l,:is(#adm,#delivery) .delwrap th.l{text-align:start}
:is(#adm,#delivery) .delwrap tr.late td{background:#fef2f2}
:is(#adm,#delivery) .delwrap .ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
:is(#adm,#delivery) .delwrap .ctl input,:is(#adm,#delivery) .delwrap .ctl select{width:auto;min-width:130px}
:is(#adm,#delivery) .delwrap .ctl.chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}:is(#adm,#delivery) .delwrap .ctl.chips>*{flex:0 0 auto}
:is(#adm,#delivery) .delwrap .empty{text-align:center;color:#64748b;padding:26px 10px;background:#fff;border:1px dashed #cbd5e1;border-radius:16px}
:is(#adm,#delivery) .delwrap h3.sec{margin:16px 0 8px;font-size:16px;font-weight:800}
.deltoast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
`;
  document.head.appendChild(s);
}
function toast(t) { const d = document.createElement('div'); d.className = 'deltoast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

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
const active = () => ORDERS.filter(o => o.status === 'PENDING').sort((a, b) => (!!a.driverName - !!b.driverName) || b.startTime - a.startTime);   // اللي من غير مندوب الأول
const done = () => ORDERS.filter(o => o.status === 'COMPLETED' && o.endTime && o.driverName);
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
  ${e ? '' : '<p class="hint2">فواتير التوصيل بتنزل هنا لوحدها من فارما فلاي — سجّل بإيدك بس الأوردر اللي ملوش فاتورة، علشان ميتكررش.</p>'}
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
  const now = Date.now(), bm = batchMap(ORDERS.filter(o => o.driverName && now - o.startTime < 36 * 3600e3), now);
  const needN = act.filter(o => !o.driverName).length;
  const lateN = act.filter(o => o.driverName).filter(o => { const b = bm.get(o.id) || { th: LATE_SINGLE, start: o.startTime }; return o.zone !== 'خارج المعمورة' && now - b.start >= b.th; }).length;
  const cards = act.map(o => {
    if (!o.driverName) return asgCard(o, now);
    const b = bm.get(o.id) || { th: LATE_SINGLE, start: o.startTime, batch: false, size: 1, idx: 1 }, out = o.zone === 'خارج المعمورة';
    const late = !out && now - b.start >= b.th, min = Math.floor((now - o.startTime) / MIN), warn = min >= (b.batch ? 25 : 15);
    const cls = late ? 'late' : out ? 'outz' : b.batch ? 'batch' : '';
    return `<div class="oc ${cls}" data-id="${o.id}" data-start="${o.startTime}" data-bs="${b.start}" data-th="${b.th}" data-out="${out ? 1 : 0}" data-batch="${b.batch ? 1 : 0}">
      ${b.batch ? `<div><span class="bg bat">🔗 طلعة مجمعة (${b.size} أوردرات معاً) · أوردر #${b.idx} من ${b.size}</span> <span class="cu">${out ? 'خارج المعمورة (بدون إنذار)' : 'مهلة الإنذار: 30 دقيقة'}</span></div>` : ''}
      <div class="top"><div class="who"><div class="av">🛵</div><div>
        <h4>${esc(nm(o.driverName))}${late ? `<span class="bg red" data-lt>⚠ متأخر (+${b.th / MIN} د)</span>` : '<span data-lt></span>'}</h4>
        <div class="chips">${o.customerName ? `<span class="cu">👤 ${esc(o.customerName)}</span>` : ''}${o.employeeName ? `<span class="bg emp">الموظف: ${esc(nm(o.employeeName))}</span>` : ''}<span class="bg ${out ? 'zout' : 'zin'}">${out ? '🧭' : '📍'} ${esc(o.zone || ZONES[0])}</span>${out ? `<span class="bg cm">💰 عمولة الدليفري ${COMM_OUT} ج</span>` : ''}${o.source === 'pos' ? `<span class="bg bat">من السيستم #${o.posId}</span>` : ''}${o.district ? `<span class="cu">🏠 ${esc(o.district)}</span>` : ''}${o.posEndTime ? `<span class="bg cm">✅ اتقفل في السيستم ${timeStr(o.posEndTime)}</span>` : ''}</div></div></div>
        <div class="tms"><span class="bd ${late ? 'late' : out ? 'out' : warn ? 'warn' : ''}" data-bd>🕒 منذ ${min} د${out ? ' · بدون إنذار' : ''}</span>
          <div class="dt"><span>📅 ${dateStr(o.startTime)}</span><span>خروج: ${timeStr(o.startTime)}</span></div></div></div>
      <div class="dgrid"><div><small>قيمة الطلب</small><b>${M(o.orderValue)}</b></div><div><small>فكة للطلب</small><b>${M(o.changeGiven || 0)}</b></div></div>
      ${(o.isVisa || o.isVodafoneCash) ? `<div>${o.isVisa ? '<span class="pb v">💳 دفع بالفيزا</span>' : ''}${o.isVodafoneCash ? '<span class="pb f">📱 فودافون كاش</span>' : ''}</div>` : ''}
      ${o.notes ? `<div class="note">ملاحظة: ${esc(o.notes)}</div>` : ''}
      <div class="ftr"><div class="tot"><small>المبلغ الإجمالي المطلوب</small><b>${M((o.orderValue || 0) + (o.changeGiven || 0))}</b></div>
      ${canWrite() ? `<div class="btns"><button class="fin" data-fin="${o.id}">✔ تسليم</button><button class="prn" data-rc="${o.id}">🖨 طباعة ريسيت</button><button class="edt" data-ed="${o.id}">✏️ تعديل</button>${isAdm() ? `<button class="del" data-rm="${o.id}">🗑 حذف</button>` : ''}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="dlay">${canWrite() ? `<div>${formHtml()}</div>` : ''}
    <div><div class="lhead"><div><h2 style="display:inline">الأوردرات النشطة حالياً</h2><span class="pill">${act.length - needN} جاري توصيلها</span>${needN ? `<span class="pill am">🧾 ${needN} محتاج مندوب</span>` : ''}${lateN ? `<span class="pill red">⚠ ${lateN} متأخر (تجاوز مهلة التوصيل)</span>` : ''}</div>
      <button class="sndb ${ST.mute ? 'off' : ''}" data-mute>${ST.mute ? '🔇 الصوت مكتوم' : '🔊 الصوت مفعل'}</button></div>
      ${cards || '<div class="empty">لا توجد طلبات نشطة حالياً</div>'}</div></div>${commHtml()}`;
}

// عمولة الدليفري باليوم (طلبه 2/11): الأوردرات اللي اتسلّمت خارج المعمورة في اليوم ده × 5 ج، لكل مندوب
function asgCard(o, now) {
  const a = ASG[o.id] || {}, min = Math.floor((now - o.startTime) / MIN), drs = drvList();
  return `<div class="oc asg" data-id="${o.id}" data-start="${o.startTime}" data-bs="${o.startTime}" data-th="${LATE_SINGLE}" data-out="0" data-batch="0">
    <div class="top"><div class="who"><div class="av">🧾</div><div>
      <h4>${esc(nm(o.customerName) || 'عميل بدون اسم')}<span class="bg bat">من السيستم #${o.posId || ''}</span></h4>
      <div class="chips">${o.district ? `<span class="cu">🏠 ${esc(o.district)}</span>` : ''}${o.employeeName ? `<span class="bg emp">الكاشير: ${esc(nm(o.employeeName))}</span>` : ''}${o.posEndTime ? `<span class="bg cm">✅ اتقفل في السيستم ${timeStr(o.posEndTime)}</span>` : ''}</div></div></div>
      <div class="tms"><span class="bd" data-bd>🕒 منذ ${min} د</span><div class="dt"><span>📅 ${dateStr(o.startTime)}</span><span>الفاتورة: ${timeStr(o.startTime)}</span></div></div></div>
    <div class="dgrid"><div><small>قيمة الطلب</small><b>${M(o.orderValue)}</b></div><div><small>الحالة</small><b style="color:#b45309">محتاج مندوب ومنطقة</b></div></div>
    ${canWrite() ? `<div class="asgbox"><select data-asd="${o.id}"><option value="">-- اختر المندوب (إجباري) --</option>${drs.map(x => `<option ${a.drv === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <div class="zones" data-asz="${o.id}">
        <button type="button" data-az="${ZONES[0]}" class="in ${a.zone === ZONES[0] ? 'on' : ''}"><span class="ic">📍</span><span><b>داخل المعمورة الشاطئ</b><small>من غير عمولة</small></span></button>
        <button type="button" data-az="${ZONES[1]}" class="out ${a.zone === ZONES[1] ? 'on' : ''}"><span class="ic">🧭</span><span><b>خارج المعمورة</b><small>عمولة الدليفري ${COMM_OUT} ج</small></span></button></div>
      <div class="btns"><button class="fin" data-asgo="${o.id}">🛵 تأكيد وبدء التوصيل</button>${isAdm() ? `<button class="del" data-rm="${o.id}">🗑 حذف</button>` : ''}</div></div>` : ''}</div>`;
}

async function assign(id) {
  const o = ORDERS.find(x => x.id === id); if (!o) return;
  const a = ASG[id] || {};
  if (!a.drv) { toast('اختار المندوب الأول'); return; }
  if (!a.zone) { toast('لازم تختار المنطقة: داخل أو خارج المعمورة'); const z = ROOT.querySelector(`[data-asz="${id}"]`); if (z) z.classList.add('miss'); return; }
  const data = { driverName: a.drv, zone: a.zone };
  if (o.posEndTime) { data.status = 'COMPLETED'; data.endTime = o.posEndTime; }   // الكاشير قفل التوصيل في السيستم قبل ما نحدد المندوب
  try { await updateDoc(doc(DB, 'deliv_orders', id), data); delete ASG[id]; beep(660, 1); toast(o.posEndTime ? 'اتسجّل واتقفل (اتقفل في السيستم) ✔' : 'الأوردر بدأ 🛵'); }
  catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}

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
  ROOT.querySelectorAll('[data-asd]').forEach(sel => sel.onchange = () => { (ASG[sel.dataset.asd] = ASG[sel.dataset.asd] || {}).drv = sel.value; });
  ROOT.querySelectorAll('[data-az]').forEach(b => b.onclick = () => {
    const box = b.closest('[data-asz]'), id = box.dataset.asz;
    (ASG[id] = ASG[id] || {}).zone = b.dataset.az; box.classList.remove('miss');
    box.querySelectorAll('[data-az]').forEach(x => x.classList.toggle('on', x === b));
  });
  ROOT.querySelectorAll('[data-asgo]').forEach(b => b.onclick = () => assign(b.dataset.asgo));
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
