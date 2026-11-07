// قسم متابعة الدليفري (1/11) — منقول من برنامج «إدارة توصيل الصيدلية» (AI Studio) لموقع المرتبات، وأُعيد بناء أساسه 2/11 بعد مراجعة صريحة.
// الأوردرات في deliv_orders والطيارين في deliv_drivers وسجل التغييرات في deliv_log (بيتكتب بس). الوقت بالـ ms.
// الأوقات التلاتة (2/11): startTime = وقت الفاتورة (أو التسجيل اليدوي) · assignedAt = خروج المندوب (لحظة تأكيد المندوب) · endTime = التسليم.
//   endSource: app = ضغطة «تسليم» (موثوق) · pos = «إتمام التوصيل» في فارما فلاي (مش موثوق — بيتحسب في الإجماليات بس، مش في ترتيب المناديب).
// متأخر = من الفاتورة 30 دقيقة (وعد التوصيل) لأوردر جوه المعمورة. الطلعة المجمعة = أوردرات نفس المندوب بتتأكد في خلال 5 دقايق.
// القراية: الشاشة الحية بتسمع على الأوردرات المفتوحة + اللي اتسلّم من 9 الصبح بس. الإحصائيات بتسحب الفترة اللي تختارها عند الطلب (علشان حصة Firebase المجانية).
// العمولة: بتتخزن على الأوردر وقت التسليم (comm) فتغيير السعر بعدين مبيغيّرش القديم.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, query, orderBy, limit, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const commFor = zone => zone === 'خارج المعمورة' ? COMM_OUT : 0;
const commOf = o => o.comm != null ? o.comm : commFor(o.zone);   // المتخزنة وقت التسليم، وللقديم بالسعر الحالي

const dayKey = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ts));
const timeStr = ts => ts ? new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(ts)) : '—';
const opDay = ts => dayKey(ts - 9 * 3600e3);   // (2/11) اليوم التشغيلي 9ص → 9ص (زي الخزنة): الشيفت اللي بيعدّي نص الليل يفضل في يوم واحد
const addDay = (k, n) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const cairoHour = ts => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }).format(new Date(ts));
function cairoStart(k) {   // بداية اليوم التشغيلي k (9 الصبح بتوقيت القاهرة) بالـ ms
  const [y, m, d] = k.split('-').map(Number);
  for (const h of [6, 7]) { const t = Date.UTC(y, m - 1, d, h); if (cairoHour(t) === 9) return t; }
  return Date.UTC(y, m - 1, d, 7);
}
const dayLbl = ts => { const k = opDay(ts); return `${+k.slice(8)}/${+k.slice(5, 7)}`; };
const dateStr = ts => { const [y, m, d] = dayKey(ts).split('-'); return `${+d}/${+m}`; };
const dur = ms => { if (ms == null || isNaN(ms)) return '—'; const s = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const durMin = ms => (ms == null || isNaN(ms)) ? '—' : Math.round(ms / MIN) + ' د';
const nm = n => String(n || '').replace(/\*/g, '').trim();

let ROOT, ROLE, DB, UID, ORDERS = [], DRIVERS = [], READY = 0, EDIT = null, UNSUB = [], UDONE = null, TICK = null, REFRESH = null;
let OPEN = new Map(), DONE = new Map(), HIST = [];   // OPEN = المفتوح · DONE = اللي اتسلّم من 9 الصبح · HIST = فترة الإحصائيات (عند الطلب)
const HC = new Map();                                   // كاش الفترات: 'من|إلى' ← {at, rows}
let ASG = {};   // اختيار المندوب والمنطقة لأوردرات السيستم اللي لسه متوزعتش
let DR = {};   // مسودة الفورم (علشان التحديث التلقائي ميمسحش اللي اتكتب)
let ST = { cday: '', view: 'live', period: 'today', from: '', to: '', driver: '', zone: '', mute: false, shown: 60 };
const ALARMED = new Set();

const canWrite = () => ROLE === 'admin' || ROLE === 'cashier';
const isAdm = () => ROLE === 'admin';
const canDrv = () => ROLE === 'admin' || ROLE === 'cashier';   // (2/11، طلبه) إضافة/شيل مندوب: الأدمن وجهاز الدليفري
const seeStats = () => ROLE === 'admin' || ROLE === 'viewer';

/* ---------- الطلعات المجمعة (بوقت خروج المندوب) ---------- */
const t0 = o => o.assignedAt || o.startTime;
function batchMap(list, now) {
  const map = new Map(), byDrv = new Map();
  list.forEach(o => { const k = (o.driverName || '').trim().toLowerCase(); if (!k) return; if (!byDrv.has(k)) byDrv.set(k, []); byDrv.get(k).push(o); });
  byDrv.forEach(arr => {
    arr.sort((a, b) => t0(a) - t0(b));
    const clusters = []; let cur = [];
    arr.forEach(o => { if (cur.length && Math.abs(t0(o) - t0(cur[cur.length - 1])) > BATCH_GAP) { clusters.push(cur); cur = []; } cur.push(o); });
    if (cur.length) clusters.push(cur);
    clusters.forEach(c => {
      const size = c.length, start = Math.min(...c.map(t0));
      const done = c.filter(o => o.status === 'COMPLETED' && o.endTime);
      const end = done.length ? Math.max(...done.map(o => o.endTime)) : null;
      const total = done.length ? Math.max(0, end - start) : Math.max(0, now - start);
      c.forEach((o, i) => map.set(o.id, { batch: size > 1, size, idx: i + 1, start, eff: Math.round(total / size) }));
    });
  });
  return map;
}
const rideMs = (o, b) => o.endTime ? (b ? b.eff : o.endTime - t0(o)) : null;   // من خروج المندوب (نصيب الأوردر من الطلعة)
const totMs = o => o.endTime ? o.endTime - o.startTime : null;                   // من الفاتورة/التسجيل لحد التسليم = اللي العميل شافه
const endSrc = o => o.endSource || (o.source === 'pos' ? 'pos' : 'app');

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
:is(#adm,#delivery) .delwrap .topbar{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 14px}
:is(#adm,#delivery) .delwrap .topbar .newbar:only-child{grid-column:1/-1}
:is(#adm,#delivery) .delwrap .newbar.comm{background:linear-gradient(135deg,#b45309,#f59e0b);box-shadow:0 10px 18px -8px rgba(217,119,6,.7)}
:is(#adm,#delivery) .delwrap .newbar.comm small{color:#fef3c7}
@media(max-width:560px){:is(#adm,#delivery) .delwrap .newbar{font-size:15px;min-height:58px}:is(#adm,#delivery) .delwrap .newbar small{font-size:10.5px}}
:is(#adm,#delivery) .delwrap .mdl .cmm{margin-top:0}
:is(#adm,#delivery) .delwrap .newbar{width:100%;min-height:66px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;margin:0;border-radius:18px;border:0;background:linear-gradient(135deg,#047857,#10b981);color:#fff;font-size:20px;font-weight:900;box-shadow:0 10px 18px -8px rgba(5,150,105,.7);cursor:pointer}
:is(#adm,#delivery) .delwrap .newbar small{font-size:12px;font-weight:600;color:#d1fae5}
:is(#adm,#delivery) .delwrap .ocgrid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));align-items:start}
:is(#adm,#delivery) .delwrap .ocgrid .oc{margin-bottom:0}
@media(max-width:480px){:is(#adm,#delivery) .delwrap .ocgrid{grid-template-columns:1fr}}
:is(#adm,#delivery) .delwrap h3.sec.need{color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:8px 12px}
.dgrp{margin-bottom:14px}.dgh{display:flex;align-items:center;gap:8px;width:100%;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px;min-height:44px;margin-bottom:8px;box-shadow:none;color:#1e293b;font-size:15px}.dgh .dgt{margin-inline-start:auto;font-size:12px;color:#475569}
.mback{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:70;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px 12px}
.mdl{position:relative;width:min(560px,100%);margin:auto}
.mdl .mclose{position:absolute;top:10px;left:10px;z-index:2;width:40px;height:40px;padding:0;border-radius:50%;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;font-size:18px;box-shadow:none}
:is(#adm,#delivery) .delwrap .split{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;align-items:start}
@media(max-width:1000px){:is(#adm,#delivery) .delwrap .split{grid-template-columns:1fr}:is(#adm,#delivery) .delwrap .pane.need{order:2}}
:is(#adm,#delivery) .delwrap .pane{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:12px}
:is(#adm,#delivery) .delwrap .pane.need{background:#fffbeb;border-color:#fcd34d}
:is(#adm,#delivery) .delwrap .pane h3{margin:0 0 10px;font-size:15px;font-weight:900;color:#1e293b}
:is(#adm,#delivery) .delwrap .pane.need h3{color:#b45309}
:is(#adm,#delivery) .delwrap .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
@media(max-width:600px){:is(#adm,#delivery) .delwrap .tiles{grid-template-columns:1fr 1fr;gap:8px}:is(#adm,#delivery) .delwrap .tile .tbtn .fin{font-size:13px}}
:is(#adm,#delivery) .delwrap .stack{display:flex;flex-direction:column;gap:10px}
:is(#adm,#delivery) .delwrap .stack .oc{margin:0}
:is(#adm,#delivery) .delwrap .tile{padding:10px;gap:6px;border-radius:14px;margin:0;min-width:0}
:is(#adm,#delivery) .delwrap .tile .th{display:flex;justify-content:space-between;align-items:center;gap:4px}
:is(#adm,#delivery) .delwrap .tile .dn{font-size:15px;font-weight:900;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:is(#adm,#delivery) .delwrap .tile .tt{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
:is(#adm,#delivery) .delwrap .tile .bd{font-size:13px;padding:3px 10px}
:is(#adm,#delivery) .delwrap .tile .tc{font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
:is(#adm,#delivery) .delwrap .sugh{font-size:12px;color:#92400e;background:#fffbeb;border:1px dashed #fcd34d;border-radius:10px;padding:6px 10px}
:is(#adm,#delivery) .delwrap .pill.sys{background:#f1f5f9;color:#475569;border:1px solid #e2e8f0}
:is(#adm,#delivery) .delwrap .pill.sys.ok{background:#dcfce7;color:#166534;border-color:#bbf7d0}
:is(#adm,#delivery) .delwrap .pill.sys.bad{background:#fee2e2;color:#991b1b;border-color:#fecaca;font-weight:800}
:is(#adm,#delivery) .delwrap .tile .rd{font-size:10.5px;color:#64748b;margin-top:-3px}
:is(#adm,#delivery) .delwrap .tile .tm2 b{font-size:18px;font-weight:900;color:#047857}
:is(#adm,#delivery) .delwrap .tile.late .tm2 b{color:#b91c1c}
:is(#adm,#delivery) .delwrap .tile .tm2 small{display:block;font-size:10.5px;color:#64748b}
:is(#adm,#delivery) .delwrap .tile .tb{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
:is(#adm,#delivery) .delwrap .tile .tb .bg{font-size:11px;padding:2px 7px}
:is(#adm,#delivery) .delwrap .tile .tb .pb{padding:1px 6px;font-size:12px;margin:0}
:is(#adm,#delivery) .delwrap .tile .nt{font-size:14px}
:is(#adm,#delivery) .delwrap .tile .tbtn{display:flex;flex-direction:column;gap:6px;margin-top:auto}
:is(#adm,#delivery) .delwrap .tile .tbtn .fin{width:100%;min-height:38px;background:#059669;color:#fff;border:0;border-radius:10px;font-size:14px;font-weight:800;padding:6px;box-shadow:none}
:is(#adm,#delivery) .delwrap .tile .ib{display:flex;gap:6px}
:is(#adm,#delivery) .delwrap .tile .ib button{flex:1;min-height:34px;padding:4px;border-radius:9px;font-size:15px;box-shadow:none;border:1px solid #e2e8f0;background:#f8fafc;color:#334155}
:is(#adm,#delivery) .delwrap .dlay{display:grid;gap:20px;grid-template-columns:1fr;align-items:start}
@media(min-width:1024px){:is(#adm,#delivery) .delwrap .dlay{grid-template-columns:5fr 6fr}}
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
:is(#adm,#delivery) .delwrap .oc{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.05);display:flex;flex-direction:column;gap:9px}
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
:is(#adm,#delivery) .delwrap .dgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
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
:is(#adm,#delivery) .delwrap .asgbox .zones button{min-height:66px;padding:8px 10px;gap:4px}
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
// بيرسم الشاشة من جديد. بيستنى بس لو الموظف بيكتب في خانة نص دلوقتي (أقل من 8 ثواني من آخر كتابة)، أو لو نافذة مفتوحة (بنرسم لما تتقفل).
// (2/11) قبل كده كان بيستنى لو أي select ماسك الفوكس — والموبايل بيسيبه ماسك بعد الاختيار فالأوردر مكانش بيتنقل لـ «جاري توصيلها».
let LAST_UI = 0;
function safeRender() {
  if (!ROOT || !ROOT.isConnected) return;
  if (ST.formOpen || EDIT || ST.ask) { ST.dirty = true; return; }
  const a = document.activeElement;
  if (a && ROOT.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !/^(checkbox|radio|date)$/.test(a.type) && Date.now() - LAST_UI < 8000) { setTimeout(safeRender, 2500); return; }
  render();
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

/* ---------- صوت الفاتورة الجديدة ---------- */
const audioOn = () => !!(AC && AC.state === 'running');
function armAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state !== 'running') AC.resume(); } catch (e) { } }
function siren(secs = 3) {   // (7/11) نغمة هادية بس عالية 3 ثواني: 3 نغمات جرس ناعمة (صول ← سي ← ري) بدون حدّة، بجين عالي
  if (ST.mute) return;
  try {
    armAudio();
    const t0 = AC.currentTime, notes = [784, 988, 1175], step = secs / notes.length;
    const comp = AC.createDynamicsCompressor(); comp.connect(AC.destination);   // يرفع الإحساس بالعلو من غير تشويه
    notes.forEach((f, i) => {
      const t = t0 + i * step;
      [[f, 1], [f * 2, 0.25]].forEach(([fr, k]) => {                             // نغمة أساسية + هارمونك خفيف = صوت جرس دافي
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'sine'; o.frequency.value = fr; o.connect(g); g.connect(comp);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9 * k, t + 0.12);                  // بداية ناعمة
        g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.98);            // وتخفت براحة
        o.start(t); o.stop(t + step);
      });
    });
  } catch (e) { }
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { }
}
let SEEN = null;   // الأوردرات المفتوحة اللي شفناها (أول تحميل مبيرنش)
function checkNew() {
  const ids = new Set(OPEN.keys());
  if (SEEN) { let n = 0; ids.forEach(id => { if (!SEEN.has(id)) { const o = OPEN.get(id); if (o && !o.driverName && o.source === 'pos') n++; } }); if (n) siren(); }
  SEEN = ids;
}
let SYS = null;    // نبضة سيرفر الصيدلية (deliv_sys/sync)

/* ---------- اقتراح المنطقة من عنوان العميل (تجربة 2/11 — الكاشير يغيّره عادي، ودقته بتظهر في الإحصائيات) ---------- */
const nrm = t => String(t || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652]/g, '');
const OUT_KW = ['بلد', 'اصلاح', 'مندره', 'ابو قير', 'ابوقير', 'سموحه', 'بيطاش', 'سيوف', 'عجمي', 'وادي القمر', 'عصافره', 'ميامي', 'منتزه', 'سيدي بشر', 'هانوفيل', 'شماعه'];
function suggestZone(district) {
  const t = nrm(district); if (!t || t === '0') return '';
  if (OUT_KW.some(k => t.includes(k))) return ZONES[1];
  if (t.includes('شاط') || t.includes('معمور')) return ZONES[0];
  return '';
}

/* ---------- البيانات ---------- */
const rebuild = () => { const m = new Map(OPEN); DONE.forEach((v, k) => m.set(k, v)); ORDERS = [...m.values()]; };
const findOrder = id => ORDERS.find(o => o.id === id) || HIST.find(o => o.id === id);
const active = () => ORDERS.filter(o => o.status === 'PENDING').sort((a, b) => b.startTime - a.startTime);   // (5/11، طلبه) الجديد فوق والقديم تحت
// كل اللي اتسلّم: الفترة المحمّلة + الحي (الحي بيكسب)
const pool = () => { const m = new Map(); HIST.forEach(o => m.set(o.id, o)); ORDERS.forEach(o => { if (o.status === 'COMPLETED') m.set(o.id, o); }); return [...m.values()].filter(o => o.status === 'COMPLETED' && o.endTime && o.driverName); };
const drvList = () => { const s = new Set(DRIVERS.map(d => d.name)); ORDERS.forEach(o => o.driverName && s.add(o.driverName)); HIST.forEach(o => o.driverName && s.add(o.driverName)); return [...s]; };

function periodRange() {
  const now = Date.now(), t = opDay(now), back = n => opDay(now - n * 864e5);
  switch (ST.period) {
    case 'today': return [t, t];
    case 'yest': return [back(1), back(1)];
    case '7': return [back(6), t];
    case 'month': return [t.slice(0, 8) + '01', t];
    case 'custom': { let a = ST.from || t, b = ST.to || t; if (a > b) [a, b] = [b, a]; const lim = addDay(b, -119); if (a < lim) a = lim; return [a, b]; }   // أقصى 120 يوم
    default: return [back(89), t];                                                                                                              // «آخر 90 يوم»
  }
}
function filtered() {
  const [a, b] = periodRange();
  return pool().filter(o => { const k = opDay(o.endTime); return k >= a && k <= b && (!ST.driver || o.driverName === ST.driver) && (!ST.zone || (o.zone || ZONES[0]) === ST.zone); });
}
async function fetchRange(a, b) {
  const st = cairoStart(a), en = cairoStart(addDay(b, 1)) - 1;
  const snap = await getDocs(query(collection(DB, 'deliv_orders'), where('endTime', '>=', st), where('endTime', '<=', en), limit(5000)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadHist(hk) {
  const c = HC.get(hk);
  try {
    if (c && Date.now() - c.at < 600000) HIST = c.rows;
    else { const [a, b] = hk.split('|'); const rows = await fetchRange(a, b); HC.set(hk, { at: Date.now(), rows }); HIST = rows; }
  } catch (e) { toast('مقدرتش أحمّل الفترة: ' + (e.code || e.message)); HIST = []; }
  ST.histKey = hk; ST.loading = false; safeRender();
}
function commEnsure() {   // عمولة يوم غير النهارده: بنسحبه عند الطلب
  const day = ST.cday || opDay(Date.now());
  if (day === opDay(Date.now())) return;
  const k = day + '|' + day, c = HC.get(k);
  if ((c && Date.now() - c.at < 600000) || ST.commLoading === k) return;
  ST.commLoading = k;
  fetchRange(day, day).then(rows => HC.set(k, { at: Date.now(), rows })).catch(e => { toast('عمولة اليوم: ' + (e.code || e.message)); HC.set(k, { at: Date.now(), rows: [] }); })
    .finally(() => { ST.commLoading = ''; safeRender(); });
}

function driverStats(list, bm) {
  const mk = n => ({ n, c: 0, tms: 0, rn: 0, rms: 0, val: 0, out: 0, outVal: 0, comm: 0, b: [0, 0, 0, 0, 0] });
  const m = new Map();
  drvList().forEach(d => m.set(d, mk(d)));
  list.forEach(o => {
    const x = m.get(o.driverName) || (m.set(o.driverName, mk(o.driverName)), m.get(o.driverName));
    const t = totMs(o) / MIN;
    x.c++; x.tms += totMs(o); x.val += o.orderValue || 0;
    if (endSrc(o) === 'app') { x.rn++; x.rms += rideMs(o, bm.get(o.id)); }   // وقت الخروج→التسليم من ضغطة التطبيق بس
    if (isOut(o)) { x.out++; x.outVal += o.orderValue || 0; x.comm += commOf(o); }
    x.b[t < 10 ? 0 : t < 15 ? 1 : t < 20 ? 2 : t <= 30 ? 3 : 4]++;
  });
  return [...m.values()].sort((a, b) => b.c - a.c);
}

/* ---------- العرض ---------- */
function render() {
  if (!ROOT) return;
  const act = active(), tabs = [['live', '🛵 شغّال دلوقتي', act.length]];
  if (seeStats()) tabs.push(['stats', '📊 الطيارين'], ['log', '📋 السجل'], ['audit', '🧾 سجل التغييرات']);
  if (!tabs.some(t => t[0] === ST.view)) ST.view = 'live';
  const hk = periodRange().join('|'), hist = seeStats() && (ST.view === 'stats' || ST.view === 'log');
  if (hist && ST.histKey !== hk && !ST.loading) { ST.loading = true; loadHist(hk); }
  if (ST.commOpen) commEnsure();
  if (ST.view === 'audit' && seeStats()) audEnsure();
  const body = !READY ? '<p class="sub">جاري التحميل…</p>' : ST.view === 'live' ? liveHtml(act) : ST.view === 'audit' ? audHtml()
    : (ST.loading || ST.histKey !== hk) ? `${filterBar()}<div class="empty">⏳ جاري تحميل أوردرات الفترة…</div>` : ST.view === 'stats' ? statsHtml() : logHtml();
  ROOT.innerHTML = `<div class="dbar">${tabs.map(t => `<button class="${ST.view === t[0] ? 'on' : ''}" data-v="${t[0]}">${t[1]}${t[2] != null ? `<span class="n">${t[2]}</span>` : ''}</button>`).join('')}
</div>
    ${body}${ST.ask ? askHtml() : ''}`;
  ROOT.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ST.view = b.dataset.v; EDIT = null; render(); });
  ROOT.querySelectorAll('[data-hid]').forEach(b => b.onclick = () => { const d = b.dataset.hid; HID.has(d) ? HID.delete(d) : HID.add(d); try { localStorage.setItem('delHid', JSON.stringify([...HID])); } catch (e) { } render(); });
  ROOT.querySelectorAll('[data-mute]').forEach(b => b.onclick = () => { if (!ST.mute && !audioOn()) { armAudio(); beep(880, 2); setTimeout(render, 300); return; } ST.mute = !ST.mute; render(); });
  bind();
}

// «مين بيعمل ده؟» — للحذف والتعديل: الجهاز مشترك فبنسجّل الاسم في deliv_log
function askWho(text) { return new Promise(res => { ST.ask = { text, res, sel: localStorage.getItem('del_emp') || '' }; render(); }); }
function askHtml() {
  return `<div class="mback" data-ask style="z-index:90"><div class="mdl"><div class="dform"><h3>${esc(ST.ask.text)}</h3>
    <div class="fld"><label>مين اللي بيعمل ده؟ (بيتسجل)</label><select id="whoSel"><option value="">-- اختر اسمك --</option>${EMPLOYEES.map(x => `<option ${x === ST.ask.sel ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
    <button class="go" data-whook>تأكيد</button><button class="go ghost" data-whono>إلغاء</button></div></div></div>`;
}
async function logAct(act, o, extra) {   // سجل بيتكتب بس (deliv_log) — فشله مبيوقفش الشغل
  try {
    await addDoc(collection(DB, 'deliv_log'), { at: serverTimestamp(), act, oid: o ? o.id : '', by: UID, who: (extra && extra.who) || '',
      full: o ? JSON.stringify(o) : '', d: extra && extra.d ? JSON.stringify(extra.d) : '' });
  } catch (e) { }
}

function formHtml() {
  const e = EDIT ? findOrder(EDIT) : null, drs = drvList(), lock = !!(e && e.driverName && !isAdm());
  const d = e ? { emp: e.employeeName || '', drv: e.driverName, cus: e.customerName || '', zone: e.zone || '', val: e.orderValue, chg: e.changeGiven || '', visa: !!e.isVisa, voda: !!e.isVodafoneCash, note: e.notes || '' }
    : { emp: DR.emp !== undefined ? DR.emp : (localStorage.getItem('del_emp') || ''), drv: DR.drv || '', cus: DR.cus || '', zone: DR.zone || '', val: DR.val || '', chg: DR.chg || '', visa: !!DR.visa, voda: !!DR.voda, note: DR.note || '' };
  return `<div class="dform ${e ? 'edit' : ''}" id="dForm"><h3>${e ? '✏️ تعديل الأوردر' : '🚀 تسجيل طلب جديد'}</h3>
  ${e ? '' : '<p class="hint2">فواتير التوصيل بتنزل هنا لوحدها من فارما فلاي — سجّل بإيدك بس الأوردر اللي ملوش فاتورة، علشان ميتكررش.</p>'}
  <div class="fld emp"><label>الموظف المسئول <span class="req">* (إجباري)</span></label>
    <select id="dEmp"><option value="">-- اختر الموظف المسئول (إجباري) --</option>${EMPLOYEES.map(x => `<option ${x === d.emp ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
  <div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><label style="margin:0">اسم المندوب</label>${canDrv() ? '<button type="button" class="lnk" data-adddrv>+ إضافة مندوب جديد</button>' : ''}</div>
    <div class="row2"><select id="dDrv">${drs.length ? '' : '<option value="">لا يوجد مناديب مسجلين</option>'}${drs.map(x => `<option ${d.drv === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      ${ROLE === 'admin' ? '<button type="button" class="trash" data-deldrv title="حذف المندوب">🗑</button>' : ''}</div></div>
  <div class="fld"><label>اسم العميل (اختياري)</label><input id="dCus" placeholder="مثال: محمد أحمد" value="${esc(d.cus)}"></div>
  <div class="fld"><label class="lbl b">المنطقة والنطاق <span class="req">* (إجباري — لازم تختار واحدة)</span></label>
    ${lock ? '<p class="hint2">القيمة والمنطقة اتقفلوا بعد تأكيد المندوب — لو غلط اطلب من الأدمن يعدّلهم.</p>' : ''}
    <div class="zones" id="dZone">
      <button type="button" ${lock ? 'disabled' : ''} data-z="${ZONES[0]}" class="in ${d.zone === ZONES[0] ? 'on' : ''}"><span class="ic">📍</span><span><b>داخل المعمورة الشاطئ</b><small>من غير عمولة</small></span></button>
      <button type="button" ${lock ? 'disabled' : ''} data-z="${ZONES[1]}" class="out ${d.zone === ZONES[1] ? 'on' : ''}"><span class="ic">🧭</span><span><b>خارج المعمورة</b><small>عمولة الدليفري ${COMM_OUT} ج</small></span></button></div></div>
  <div class="fld g2"><div><label class="lbl">قيمة الطلب</label><input id="dVal" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" ${lock ? 'disabled' : ''} value="${d.val}"></div>
    <div><label class="lbl">فكة إضافية للطلب</label><input id="dChg" type="number" inputmode="decimal" min="0" step="0.5" placeholder="0.00" value="${d.chg}"></div></div>
  <div class="fld"><label class="lbl">طريقة الدفع الخاصة بالطلب</label><div class="pays">
    <label class="pay visa ${d.visa ? 'on' : ''}"><span><i class="ic">💳</i><span><b>فيزا</b><small>دفع بالفيزا</small></span></span><input type="checkbox" id="dVisa" ${d.visa ? 'checked' : ''}></label>
    <label class="pay voda ${d.voda ? 'on' : ''}"><span><i class="ic">📱</i><span><b>فودافون كاش</b><small>محفظة إلكترونية</small></span></span><input type="checkbox" id="dVoda" ${d.voda ? 'checked' : ''}></label></div></div>
  <div class="fld"><label>ملاحظات (للتذكرة)</label><input id="dNote" placeholder="مثال: تسليم عند الباب الخلفي..." value="${esc(d.note)}"></div>
  <button class="go" id="dGo">${e ? 'حفظ التعديل' : 'بدء التوصيل'}</button>
  ${e ? '<button class="go ghost" id="dCancel">إلغاء التعديل</button>' : ''}<div class="err" id="dErr"></div></div>`;
}

const muteLbl = () => ST.mute ? '🔇 الصوت مكتوم' : audioOn() ? '🔊 الصوت مفعل' : '🔈 اضغط هنا لتفعيل الصوت';
function liveHtml(act) {
  const now = Date.now(), bm = batchMap(ORDERS.filter(o => o.driverName && now - t0(o) < 36 * 3600e3), now);
  const needN = act.filter(o => !o.driverName).length;
  const lateN = act.filter(o => o.driverName && !isOut(o) && now - o.startTime >= PROMISE).length;
  const cardArr = act.map(o => {
    if (!o.driverName) return asgCard(o, now);
    const b = bm.get(o.id) || { batch: false, size: 1, idx: 1 }, out = isOut(o);
    const late = !out && now - o.startTime >= PROMISE, min = Math.floor((now - o.startTime) / MIN), ride = Math.floor((now - t0(o)) / MIN), warn = min >= 20;
    const cls = late ? 'late' : out ? 'outz' : b.batch ? 'batch' : '';
    const tot = (o.orderValue || 0) + (o.changeGiven || 0);
    return `<div class="oc tile ${cls}" data-id="${o.id}" data-start="${o.startTime}" data-bs="${o.startTime}" data-th="${PROMISE}" data-as="${t0(o)}" data-out="${out ? 1 : 0}" data-batch="${b.batch ? 1 : 0}">
      <div class="th"><b class="dn">${esc(nm(o.driverName))}</b>${b.batch ? `<span class="bg bat" title="طلعة مجمعة: أوردر ${b.idx} من ${b.size}">🔗 ${b.idx}/${b.size}</span>` : ''}</div>
      <div class="tt"><span class="bd ${late ? 'late' : out ? 'out' : warn ? 'warn' : ''}" data-bd>🕒 ${min} د</span><span data-lt class="${late ? 'bg red' : ''}">${late ? '⚠ متأخر' : ''}</span></div>
      <div class="rd" data-rd>خرج من ${ride} د</div>
      <div class="tc" title="${esc(o.customerName || '')}">${o.customerName ? '👤 ' + esc(o.customerName) : '&nbsp;'}</div>
      <div class="tm2"><b>${M(tot)}</b>${o.changeGiven ? `<small>قيمة ${N(o.orderValue)} + فكة ${N(o.changeGiven)}</small>` : '<small>&nbsp;</small>'}</div>
      <div class="tb"><span class="bg ${out ? 'zout' : 'zin'}">${out ? `🧭 خارج · 💰${COMM_OUT}` : '📍 داخل'}</span>${o.isVisa ? '<span class="pb v" title="فيزا">💳</span>' : ''}${o.isVodafoneCash ? '<span class="pb f" title="فودافون كاش">📱</span>' : ''}${o.notes ? `<span class="nt" title="${esc(o.notes)}">📝</span>` : ''}${o.posEndTime ? '<span class="nt" title="اتقفل في السيستم">✅</span>' : ''}</div>
      ${canWrite() ? `<div class="tbtn"><button class="fin" data-fin="${o.id}">✔ تسليم</button><div class="ib"><button class="prn" data-rc="${o.id}" title="طباعة ريسيت">🖨</button><button class="edt" data-ed="${o.id}" title="تعديل">✏️</button><button class="del" data-rm="${o.id}" title="حذف">🗑</button></div></div>` : ''}</div>`;
  });
  const outCards = [], needCards = [];
  act.forEach((o, n) => (o.driverName ? outCards : needCards).push(cardArr[n]));
  return `<div class="topbar">${canWrite() ? `<button type="button" class="newbar" data-new><span>➕ تسجيل أوردر جديد</span><small>للأوردر اللي ملوش فاتورة</small></button>` : ''}<button type="button" class="newbar comm" data-comm><span>💰 عمولة الدليفري</span><small>اضغط لعرض عمولة كل مندوب</small></button></div>
    <div class="lhead"><div><h2 style="display:inline">الأوردرات النشطة حالياً</h2><span class="pill">${act.length - needN} جاري توصيلها</span>${needN ? `<span class="pill am" data-goneed style="cursor:pointer">🧾 ${needN} محتاج مندوب ↓</span>` : ''}${lateN ? `<span class="pill red">⚠ ${lateN} عدّى 30 دقيقة من الفاتورة</span>` : ''}<span class="pill sys" data-sys>⚪ …</span></div>
      <button class="sndb ${ST.mute ? 'off' : ''}" data-mute>${muteLbl()}</button></div>
    <div class="split">
      <div class="pane need" id="needSec"><h3><span>🧾 مستنية تأكيد المندوب (${needN})</span></h3>
        ${needN ? `<div class="stack">${needCards.join('')}</div>` : '<div class="empty">مفيش أوردرات مستنية</div>'}</div>
      <div class="pane"><h3><span>🛵 جاري توصيلها (${outCards.length})</span></h3>
        ${outGroups(act, cardArr) || '<div class="empty">مفيش أوردر جاري توصيله دلوقتي</div>'}</div>
    </div>
    ${ST.commOpen ? `<div class="mback" data-mback2><div class="mdl"><button type="button" class="mclose" data-closecomm title="إغلاق">✕</button>${commHtml()}</div></div>` : ''}
    ${canWrite() && (ST.formOpen || EDIT) ? `<div class="mback" data-mback><div class="mdl"><button type="button" class="mclose" data-closeform title="إغلاق">✕</button>${formHtml()}</div></div>` : ''}`;
}

/* (7/11، طلبه) الجاري توصيلها متقسمة بكل مندوب + زرار إخفاء/إظهار لكل مندوب (بيتحفظ على الجهاز) */
const HID = (() => { try { return new Set(JSON.parse(localStorage.getItem('delHid') || '[]')); } catch (e) { return new Set(); } })();
function outGroups(act, cardArr) {
  const g = new Map();
  act.forEach((o, n) => { if (o.driverName) { if (!g.has(o.driverName)) g.set(o.driverName, []); g.get(o.driverName).push(cardArr[n]); } });
  return [...g.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0]), 'ar')).map(([d, cs]) => {
    const h = HID.has(d);
    return `<div class="dgrp"><button type="button" class="dgh" data-hid="${esc(d)}"><b>🛵 ${esc(nm(d))}</b> <span class="pill">${cs.length}</span><span class="dgt">${h ? '👁 إظهار' : '🙈 إخفاء'}</span></button>${h ? '' : `<div class="tiles">${cs.join('')}</div>`}</div>`;
  }).join('');
}

function asgCard(o, now) {
  const a = ASG[o.id] || {}, min = Math.floor((now - o.startTime) / MIN), drs = drvList(), sug = suggestZone(o.district), zsel = a.zone !== undefined ? a.zone : sug;
  return `<div class="oc asg" data-id="${o.id}" data-start="${o.startTime}" data-bs="${o.startTime}" data-th="${LATE_SINGLE}" data-out="0" data-batch="0">
    <div class="top"><div class="who"><div class="av">🧾</div><div>
      <h4>${esc(nm(o.customerName) || 'عميل بدون اسم')}<span class="bg bat">من السيستم #${o.posId || ''}</span></h4>
      <div class="chips">${o.district ? `<span class="cu">🏠 ${esc(o.district)}</span>` : ''}${o.employeeName ? `<span class="bg emp">الكاشير: ${esc(nm(o.employeeName))}</span>` : ''}${o.posEndTime ? `<span class="bg cm">✅ اتقفل في السيستم ${timeStr(o.posEndTime)}</span>` : ''}${o.importedAt ? `<span class="cu" title="الوقت من حفظ الفاتورة لحد نزولها هنا">⏱ نزل بعد ${Math.max(0, Math.round((o.importedAt - o.startTime) / 1000))} ث</span>` : ''}</div></div></div>
      <div class="tms"><span class="bd" data-bd>🕒 منذ ${min} د</span><div class="dt"><span>📅 ${dateStr(o.startTime)}</span><span>الفاتورة: ${timeStr(o.startTime)}</span></div></div></div>
    <div class="dgrid"><div><small>قيمة الطلب</small><b>${M(o.orderValue)}</b></div><div><small>الحالة</small><b style="color:#b45309">محتاج مندوب ومنطقة</b></div></div>
    ${canWrite() ? `<div class="asgbox">${canDrv() ? '<div><button type="button" class="lnk" data-adddrv>+ إضافة مندوب جديد</button></div>' : ''}<select data-asd="${o.id}"><option value="">-- اختر المندوب (إجباري) --</option>${drs.map(x => `<option ${a.drv === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      ${sug && a.zone === undefined ? `<div class="sugh">💡 المنطقة اتحدّدت من العنوان «${esc(o.district)}» — غيّرها لو غلط</div>` : ''}
      <div class="zones" data-asz="${o.id}">
        <button type="button" data-az="${ZONES[0]}" class="in ${zsel === ZONES[0] ? 'on' : ''}"><span class="ic">📍</span><span><b>داخل المعمورة الشاطئ</b><small>من غير عمولة</small></span></button>
        <button type="button" data-az="${ZONES[1]}" class="out ${zsel === ZONES[1] ? 'on' : ''}"><span class="ic">🧭</span><span><b>خارج المعمورة</b><small>عمولة الدليفري ${COMM_OUT} ج</small></span></button></div>
      <div class="btns"><button class="fin" data-asgo="${o.id}">🛵 تأكيد وبدء التوصيل</button><button class="del" data-rm="${o.id}">🗑 حذف</button></div></div>` : ''}</div>`;
}

async function assign(id) {
  const o = findOrder(id); if (!o) return;
  const a = ASG[id] || {}, sug = suggestZone(o.district), zone = a.zone !== undefined ? a.zone : sug;
  if (!a.drv) { toast('اختار المندوب الأول'); return; }
  if (!zone) { toast('لازم تختار المنطقة: داخل أو خارج المعمورة'); const z = ROOT.querySelector(`[data-asz="${id}"]`); if (z) z.classList.add('miss'); return; }
  const data = { driverName: a.drv, zone, assignedAt: Date.now(), zoneSug: sug };   // assignedAt = لحظة خروج المندوب · zoneSug = اللي اقترحه البرنامج (لقياس دقته)
  if (o.posEndTime) Object.assign(data, { status: 'COMPLETED', endTime: o.posEndTime, endSource: 'pos', comm: commFor(zone) });   // الكاشير قفل التوصيل في السيستم قبل ما نحدد المندوب
  try {
    await updateDoc(doc(DB, 'deliv_orders', id), data); delete ASG[id]; beep(660, 1); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); render();
    logAct('assign', { ...o, ...data }, { who: isAdm() ? 'admin' : (localStorage.getItem('del_emp') || '') });
    toast(o.posEndTime ? 'اتسجّل واتقفل (اتقفل في السيستم) ✔' : 'الأوردر بدأ 🛵');
  } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}

// عمولة الدليفري باليوم: الأوردرات اللي اتسلّمت خارج المعمورة في اليوم ده، لكل مندوب (المبلغ = comm المتخزن على كل أوردر)
function commHtml() {
  const today = opDay(Date.now()), day = ST.cday || today, per = new Map();
  drvList().forEach(n => per.set(n, { c: 0, m: 0 }));
  const k = day + '|' + day, c = HC.get(k);
  const rows = day === today ? ORDERS.filter(o => o.status === 'COMPLETED') : ((c && c.rows) || []);
  const loading = day !== today && !c;
  rows.forEach(o => { if (o.endTime && o.driverName && isOut(o) && opDay(o.endTime) === day) { const x = per.get(o.driverName) || { c: 0, m: 0 }; x.c++; x.m += commOf(o); per.set(o.driverName, x); } });
  const list = [...per.entries()].sort((a, b) => b[1].c - a[1].c), tc = list.reduce((s, r) => s + r[1].c, 0), tm = list.reduce((s, r) => s + r[1].m, 0);
  return `<div class="cmm"><div class="lhead" style="border:0;margin-bottom:8px"><h2>💰 عمولة الدليفري — يوم ${+day.slice(8)}/${+day.slice(5, 7)} <small style="font-size:12px;color:#64748b;font-weight:600">(من 9 ص لـ 9 ص)</small></h2>
    <div class="cd"><label for="cDay">اليوم:</label><input type="date" id="cDay" value="${day}"></div></div>
  ${loading ? '<div class="empty">⏳ جاري تحميل اليوم…</div>' : `<div class="tw" style="margin:0"><table><tr><th class="l">المندوب</th><th>أوردرات خارج المعمورة اتسلّمت</th><th>العمولة</th></tr>
  ${list.map(([n, x]) => `<tr><td class="l"><b style="color:#1e293b;font-size:14px">${esc(nm(n))}</b></td><td>${x.c}</td><td><b>${M(x.m)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="empty">مفيش مناديب</td></tr>'}
  ${list.length > 1 ? `<tr><td class="l"><b style="color:#1e293b">الإجمالي</b></td><td><b style="color:#1e293b">${tc}</b></td><td><b>${M(tm)}</b></td></tr>` : ''}</table></div>`}
  <p class="hint">بتتحسب على الأوردرات اللي اتسلّمت خارج المعمورة في اليوم ده، والمبلغ متخزن على كل أوردر وقت التسليم (${COMM_OUT} ج دلوقتي). اليوم بيبدأ 9 الصبح وبيخلص 9 الصبح اللي بعده، فالشيفت اللي بيعدّي نص الليل عمولته كلها في يوم واحد.</p></div>`;
}

const rideCell = (o, b) => { const v = rideMs(o, b); return endSrc(o) === 'app' ? `<b>${durMin(v)}</b>` : `<span style="color:#94a3b8" title="اتقفل من السيستم — الوقت مش موثوق">${durMin(v)}*</span>`; };

function statsHtml() {
  const list = filtered(), bm = batchMap(pool(), Date.now()), ds = driverStats(list, bm);
  const tot = list.length, tsum = list.reduce((s, o) => s + totMs(o), 0), late = list.filter(o => totMs(o) > PROMISE).length;
  const val = list.reduce((s, o) => s + (o.orderValue || 0), 0), out = list.filter(isOut), comm = out.reduce((s, o) => s + commOf(o), 0);
  const zs = list.filter(o => o.zoneSug), w = list.filter(o => o.source === 'pos' && o.assignedAt), wavg = w.length ? w.reduce((s, o) => s + (o.assignedAt - o.startTime), 0) / w.length : null;
  const days = {}; list.forEach(o => { const k = opDay(o.endTime); (days[k] = days[k] || []).push(o); });
  const rank = ds.filter(d => d.rn >= 3).sort((a, b) => a.rms / a.rn - b.rms / b.rn), few = ds.filter(d => d.rn > 0 && d.rn < 3);
  return `${filterBar()}
  <div class="dk"><div><div class="l">أوردرات اتسلّمت</div><div class="v">${N(tot)}</div></div>
    <div><div class="l">متوسط الوقت من الفاتورة (اللي العميل شافه)</div><div class="v">${tot ? durMin(tsum / tot) : '—'}</div></div>
    <div class="${late ? 'bad' : ''}"><div class="l">عدّى 30 دقيقة من الفاتورة</div><div class="v">${N(late)}${tot ? ` <small>(${Math.round(late / tot * 100)}%)</small>` : ''}</div></div>
    <div><div class="l">متوسط انتظار المندوب (من الفاتورة لحد الخروج)</div><div class="v">${wavg == null ? '—' : durMin(wavg)}</div><div class="l">${w.length ? N(w.length) + ' أوردر من السيستم' : 'لسه مفيش بيانات'}</div></div>
    <div><div class="l">قيمة الأوردرات</div><div class="v">${M(val)}</div></div>
    <div><div class="l">دقة اقتراح المنطقة من العنوان</div><div class="v">${zs.length ? Math.round(zs.filter(o => o.zone === o.zoneSug).length / zs.length * 100) + '%' : '—'}</div><div class="l">${zs.length ? `${zs.filter(o => o.zone === o.zoneSug).length} من ${zs.length} صح` : 'لسه بنجرب'}</div></div>
    <div style="border-inline-start-color:#f59e0b"><div class="l">خارج المعمورة · عمولة الدليفري</div><div class="v">${N(out.length)} · ${M(comm)}</div></div></div>
  <h3 class="sec">الطيارين</h3><div class="tw"><table><tr><th class="l">الطيار</th><th>أوردرات</th><th>متوسط من الفاتورة</th><th>متوسط من الخروج (مؤكد)</th><th>&lt;10</th><th>10–15</th><th>15–20</th><th>20–30</th><th>&gt;30</th><th>خارج المعمورة</th><th>عمولة الدليفري</th><th>القيمة</th></tr>
  ${ds.map(d => `<tr><td class="l"><b>${esc(nm(d.n))}</b></td><td>${d.c}</td><td>${d.c ? durMin(d.tms / d.c) : '—'}</td><td>${d.rn ? `${durMin(d.rms / d.rn)} <small style="color:#94a3b8">(${d.rn})</small>` : '—'}</td>${d.b.map((x, i) => `<td ${i === 4 && x ? 'style="color:#C0392B;font-weight:800"' : ''}>${x}</td>`).join('')}<td>${d.out}${d.out ? ` (${M(d.outVal)})` : ''}</td><td><b style="color:#b45309">${M(d.comm)}</b></td><td>${M(d.val)}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">مفيش بيانات في الفترة دي</td></tr>'}</table></div>
  <p class="sub">الأرقام بين القوسين = عدد الأوردرات اللي اتقفلت بضغطة «تسليم» من التطبيق. اللي اتقفل من فارما فلاي وقته مش موثوق فمبيدخلش في «من الخروج» ولا في الترتيب.</p>
  <h3 class="sec">🏆 ترتيب المناديب (الأسرع من الخروج للتسليم)</h3><div class="tw"><table><tr><th>#</th><th class="l">المندوب</th><th>تسليمات مؤكدة</th><th>متوسط من الخروج</th><th>عدّى 30 د من الفاتورة</th></tr>
  ${rank.map((d, i) => `<tr><td>${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="l"><b>${esc(nm(d.n))}</b></td><td>${d.rn}</td><td><b>${durMin(d.rms / d.rn)}</b></td><td ${d.b[4] ? 'style="color:#dc2626;font-weight:800"' : ''}>${d.b[4]} (${Math.round(d.b[4] / d.c * 100)}%)</td></tr>`).join('') || '<tr><td colspan="5" class="empty">محتاج 3 تسليمات مؤكدة (ضغطة «تسليم») على الأقل لكل مندوب علشان يدخل الترتيب</td></tr>'}</table></div>
  ${few.length ? `<p class="sub">ناقصهم تسليمات مؤكدة: ${few.map(d => `${esc(nm(d.n))} (${d.rn})`).join('، ')}</p>` : ''}
  <h3 class="sec">يوم بيوم</h3><div class="tw"><table><tr><th class="l">اليوم</th><th>أوردرات</th><th>متوسط من الفاتورة</th><th>&gt;30 د</th><th>خارج المعمورة</th><th>عمولة الدليفري</th><th>القيمة</th></tr>
  ${Object.keys(days).sort().reverse().map(k => { const a = days[k], t = a.reduce((s, o) => s + totMs(o), 0), ou = a.filter(isOut); return `<tr><td class="l">${k.slice(8)}/${k.slice(5, 7)}</td><td>${a.length}</td><td>${durMin(t / a.length)}</td><td>${a.filter(o => totMs(o) > PROMISE).length}</td><td>${ou.length}</td><td><b style="color:#b45309">${M(ou.reduce((s, o) => s + commOf(o), 0))}</b></td><td>${M(a.reduce((s, o) => s + (o.orderValue || 0), 0))}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">—</td></tr>'}</table></div>
  <div class="ctl"><button class="ghost" data-xl>📥 تنزيل إكسل (السجل + الطيارين)</button><button class="ghost" data-rep>📋 نسخ تقرير للواتساب</button><button class="ghost" data-reload>🔄 تحديث الأرقام</button></div>
  <p class="sub">اتحمّل ${N(HIST.length)} أوردر للفترة دي (بيتحفظوا 10 دقايق، والتحديث بيقرا من جديد).</p>`;
}

function logHtml() {
  const list = filtered().sort((a, b) => b.endTime - a.endTime), bm = batchMap(pool(), Date.now()), shown = list.slice(0, ST.shown);
  return `${filterBar()}<div class="tw"><table><tr><th class="l">اليوم</th><th>الفاتورة</th><th>خرج</th><th>وصل</th><th>من الفاتورة</th><th>من الخروج</th><th class="l">الطيار</th><th class="l">العميل</th><th>المنطقة</th><th>عمولة</th><th>القيمة</th><th>الدفع</th><th class="l">سجّله</th>${isAdm() ? '<th></th>' : ''}</tr>
  ${shown.map(o => { const b = bm.get(o.id), t = totMs(o), late = t > PROMISE;
    return `<tr class="${late ? 'late' : ''}"><td class="l">${dayLbl(o.endTime)}</td><td>${timeStr(o.startTime)}</td><td>${o.assignedAt ? timeStr(o.assignedAt) : '—'}</td><td>${timeStr(o.endTime)}${endSrc(o) === 'pos' ? '*' : ''}</td><td><b>${durMin(t)}</b></td><td>${rideCell(o, b)}${b && b.batch ? ` <span class="tag b">طلعة ${b.size}</span>` : ''}</td><td class="l">${esc(nm(o.driverName))}</td><td class="l">${esc(o.customerName || '—')}${o.notes ? ' 📝' : ''}</td><td>${isOut(o) ? '<span class="tag o">خارج المعمورة</span>' : '<span class="tag i">داخل المعمورة</span>'}</td><td>${isOut(o) ? M(commOf(o)) : '—'}</td><td>${M(o.orderValue)}</td><td>${o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون' : 'كاش'}</td><td class="l">${esc(nm(o.employeeName) || '—')}</td>${isAdm() ? `<td><button class="ghost sm" data-ed="${o.id}">✏️</button> <button class="ghost sm" data-rc="${o.id}">🧾</button> <button class="ghost sm" data-rm="${o.id}">🗑️</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="14" class="empty">مفيش أوردرات في الفترة دي</td></tr>`}</table></div>
  ${list.length > ST.shown ? `<button class="ghost" data-more>عرض المزيد (${list.length - ST.shown})</button>` : ''}<p class="sub">${N(list.length)} أوردر في الفترة · الصف الأحمر = عدّى 30 دقيقة من الفاتورة · * = اتقفل من فارما فلاي (الوقت مش موثوق).</p>`;
}

function filterBar() {
  const P = [['today', 'النهارده'], ['yest', 'إمبارح'], ['7', 'آخر 7 أيام'], ['month', 'الشهر ده'], ['all', 'آخر 90 يوم'], ['custom', 'من – إلى']];
  return `<div class="ctl chips">${P.map(p => `<button class="chip ${ST.period === p[0] ? 'on' : ''}" data-p="${p[0]}">${p[1]}</button>`).join('')}</div>
  <p class="sub" style="margin:0 0 8px">اليوم = من 9 الصبح لـ 9 الصبح اللي بعده.</p>
  <div class="ctl">${ST.period === 'custom' ? `<input type="date" id="fFrom" value="${ST.from}"><input type="date" id="fTo" value="${ST.to}">` : ''}
    <select id="fDrv"><option value="">كل الطيارين</option>${drvList().map(d => `<option ${ST.driver === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
    <select id="fZone"><option value="">كل المناطق</option>${ZONES.map(z => `<option ${ST.zone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>`;
}

/* ---------- سجل التغييرات (deliv_log) — للأدمن وصاحب الصيدلية، بيتسحب عند الفتح بس (150 سطر) ---------- */
let AUD = null;
const AUD_ACT = { assign: 'تعيين مندوب', edit: 'تعديل', delete: 'حذف' }, AUD_F = { driverName: 'المندوب', zone: 'المنطقة', orderValue: 'القيمة', customerName: 'العميل', notes: 'ملاحظات', isVisa: 'فيزا', isVodafoneCash: 'فودافون كاش', changeGiven: 'الفكة', employeeName: 'الموظف', comm: 'العمولة', assignedAt: 'خروج المندوب' };
function audEnsure() {
  if (ST.audLoading || (AUD && Date.now() - AUD.at < 120000)) return;
  ST.audLoading = true;
  getDocs(query(collection(DB, 'deliv_log'), orderBy('at', 'desc'), limit(150)))
    .then(s => { AUD = { at: Date.now(), rows: s.docs.map(d => ({ id: d.id, ...d.data() })) }; })
    .catch(e => { toast('سجل التغييرات: ' + (e.code || e.message)); AUD = { at: Date.now(), rows: [], err: 1 }; })
    .finally(() => { ST.audLoading = false; safeRender(); });
}
function audHtml() {
  const f = ST.audAct || '', rows = ((AUD && AUD.rows) || []).filter(r => !f || r.act === f);
  const chips = [['', 'الكل'], ['assign', 'تعيين'], ['edit', 'تعديل'], ['delete', 'حذف']].map(c => `<button class="chip ${f === c[0] ? 'on' : ''}" data-aa="${c[0]}">${c[1]}</button>`).join('');
  if (!AUD) return `<div class="ctl chips">${chips}</div><div class="empty">⏳ جاري تحميل السجل…</div>`;
  const tms = r => { const a = r.at; const t = a && a.toMillis ? a.toMillis() : (a && a.seconds ? a.seconds * 1000 : 0); return t; };
  const val = v => v === true ? 'نعم' : v === false ? 'لا' : v == null || v === '' ? '—' : (typeof v === 'number' && v > 1e12) ? timeStr(v) : String(v);
  return `<div class="ctl chips">${chips}<button class="chip" data-aref>🔄 تحديث</button></div>
  <div class="tw"><table><tr><th class="l">الوقت</th><th>العملية</th><th class="l">مين عملها</th><th class="l">الأوردر</th><th class="l">التفاصيل</th></tr>
  ${rows.map(r => {
    let o = {}, d = {}; try { o = r.full ? JSON.parse(r.full) : {}; } catch (e) { } try { d = r.d ? JSON.parse(r.d) : {}; } catch (e) { }
    const t = tms(r), open = ST.audOpen && ST.audOpen[r.id];
    const det = r.act === 'edit' ? Object.keys(d).map(k => `${AUD_F[k] || k}: ${val(d[k][0])} ← <b>${val(d[k][1])}</b>`).join('<br>') || '—'
      : r.act === 'assign' ? `${esc(nm(o.driverName))} · ${esc(o.zone || '')}${o.endSource === 'pos' ? ' · اتقفل من السيستم' : ''}`
      : `<button class="chip" data-ao="${r.id}">${open ? 'إخفاء' : 'نسخة المحذوف'}</button>${open ? `<pre dir="ltr" style="white-space:pre-wrap;text-align:left;font-size:11px;margin:6px 0 0">${esc(JSON.stringify(o, null, 1))}</pre>` : ''}`;
    return `<tr${r.act === 'delete' ? ' class="late"' : ''}><td class="l">${t ? dateStr(t) + ' ' + timeStr(t) : '—'}</td><td><span class="tag ${r.act === 'delete' ? 'o' : r.act === 'edit' ? 'b' : 'i'}">${AUD_ACT[r.act] || esc(r.act)}</span></td><td class="l">${esc(r.who || '—')}</td><td class="l">${esc(nm(o.driverName) || '—')} ← ${esc(o.customerName || 'عميل')} · ${M(o.orderValue)}${o.posId ? ` <span class="cu">#${o.posId}</span>` : ''}</td><td class="l" style="white-space:normal;min-width:200px">${det}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">مفيش تغييرات متسجلة لسه</td></tr>'}</table></div>
  <p class="sub">آخر ${N(((AUD && AUD.rows) || []).length)} حركة (بتتحمّل عند فتح التبويب بس). الحذف بيحفظ نسخة كاملة من الأوردر هنا. التسليم العادي مش بيتسجل هنا (موجود في السجل).</p>`;
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
  ROOT.querySelectorAll('[data-aa]').forEach(b => b.onclick = () => { ST.audAct = b.dataset.aa; render(); });
  const ar = $('[data-aref]', ROOT); if (ar) ar.onclick = () => { AUD = null; render(); };
  ROOT.querySelectorAll('[data-ao]').forEach(b => b.onclick = () => { ST.audOpen = ST.audOpen || {}; ST.audOpen[b.dataset.ao] = !ST.audOpen[b.dataset.ao]; render(); });
  const rl = $('[data-reload]', ROOT); if (rl) rl.onclick = () => { HC.delete(periodRange().join('|')); ST.histKey = ''; render(); };
  const ws = $('#whoSel', ROOT); if (ws) ws.onchange = () => { ST.ask.sel = ws.value; };
  const wo = $('[data-whook]', ROOT); if (wo) wo.onclick = () => { const v = ($('#whoSel', ROOT).value || '').trim(); if (!v) { toast('اختار اسمك الأول'); return; } localStorage.setItem('del_emp', v); const a = ST.ask; ST.ask = null; render(); a.res(v); };
  const wn = $('[data-whono]', ROOT); if (wn) wn.onclick = () => { const a = ST.ask; ST.ask = null; render(); a.res(null); };
  const cd = $('#cDay', ROOT); if (cd) cd.onchange = () => { ST.cday = cd.value; render(); };
  const more = $('[data-more]', ROOT); if (more) more.onclick = () => { ST.shown += 100; render(); };
  const xl = $('[data-xl]', ROOT); if (xl) xl.onclick = exportXl;
  const rp = $('[data-rep]', ROOT); if (rp) rp.onclick = copyReport;
  ROOT.querySelectorAll('[data-fin]').forEach(b => b.onclick = () => finish(b.dataset.fin));
  ROOT.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => receipt(b.dataset.rc));
  ROOT.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { EDIT = b.dataset.ed; ST.formOpen = true; ST.view = 'live'; render(); });
  const nb = $('[data-new]', ROOT); if (nb) nb.onclick = () => { EDIT = null; ST.formOpen = true; render(); setTimeout(() => { const e = $('#dEmp', ROOT); if (e) e.focus(); }, 50); };
  const gn = $('[data-goneed]', ROOT); if (gn) gn.onclick = () => { const e = $('#needSec', ROOT); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const closeForm = () => { ST.formOpen = false; EDIT = null; render(); };
  const mb = $('[data-mback]', ROOT); if (mb) mb.onclick = e => { if (e.target === mb) closeForm(); };
  const cf = $('[data-closeform]', ROOT); if (cf) cf.onclick = closeForm;
  const cb = $('[data-comm]', ROOT); if (cb) cb.onclick = () => { ST.commOpen = true; render(); };
  const closeComm = () => { ST.commOpen = false; render(); };
  const mb2 = $('[data-mback2]', ROOT); if (mb2) mb2.onclick = e => { if (e.target === mb2) closeComm(); };
  const cc = $('[data-closecomm]', ROOT); if (cc) cc.onclick = closeComm;
  ROOT.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => remove(b.dataset.rm));
  ROOT.querySelectorAll('[data-adddrv]').forEach(b => b.onclick = addDrv);
  const f = $('#dForm', ROOT); if (!f) return;
  f.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { f.querySelectorAll('[data-z]').forEach(x => x.classList.remove('on')); b.classList.add('on'); $('#dZone', f).classList.remove('miss'); draft(); });
  f.addEventListener('input', draft); f.addEventListener('change', draft);
  f.querySelectorAll('.pay input').forEach(i => i.onchange = () => i.closest('.pay').classList.toggle('on', i.checked));
  $('#dGo', f).onclick = save;
  const c = $('#dCancel', f); if (c) c.onclick = closeForm;
  const dd = $('[data-deldrv]', f); if (dd) dd.onclick = delDrv;
}

function draft() {
  if (EDIT) return;
  const g = id => { const e = $('#' + id, ROOT); return e ? e : { value: '', checked: false }; }, z = ROOT.querySelector('[data-z].on');
  DR = { emp: g('dEmp').value, drv: g('dDrv').value, cus: g('dCus').value, zone: z ? z.dataset.z : '', val: g('dVal').value, chg: g('dChg').value, visa: g('dVisa').checked, voda: g('dVoda').checked, note: g('dNote').value };
}

async function save() {
  const err = $('#dErr'), g = id => $('#' + id, ROOT), emp = g('dEmp').value, drv = g('dDrv').value;
  const e0 = EDIT ? findOrder(EDIT) : null, lock = !!(e0 && e0.driverName && !isAdm());
  const z = lock ? { dataset: { z: e0.zone } } : ROOT.querySelector('[data-z].on');
  err.textContent = '';
  if (!emp) { err.textContent = 'اختار الموظف اللي سجّل الأوردر'; return; }
  if (!drv) { err.textContent = 'مفيش طيار — ضيف طيار الأول'; return; }
  if (!z) { err.textContent = 'لازم تختار المنطقة: داخل المعمورة ولا خارج المعمورة'; $('#dZone', ROOT).classList.add('miss'); $('#dZone', ROOT).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const val = lock ? e0.orderValue : (parseFloat(g('dVal').value) || 0), chg = parseFloat(g('dChg').value) || 0;
  if (val < 0 || val >= 100000 || chg < 0) { err.textContent = 'راجع القيمة'; return; }
  const data = { driverName: drv, customerName: g('dCus').value.trim(), employeeName: emp, zone: z.dataset.z, orderValue: val, changeGiven: chg,
    isVisa: g('dVisa').checked, isVodafoneCash: g('dVoda').checked, notes: g('dNote').value.trim() };
  try {
    localStorage.setItem('del_emp', emp);
    if (EDIT) {
      if (e0 && e0.status === 'COMPLETED') data.comm = commFor(data.zone);                       // أدمن بيعدّل أوردر اتسلّم ← العمولة تتظبط مع المنطقة
      if (e0 && !e0.assignedAt && e0.driverName === '' && drv) data.assignedAt = Date.now();      // أوردر من السيستم اتحدد له مندوب من التعديل
      const nz = (k, v) => (k === 'isVisa' || k === 'isVodafoneCash') ? !!v : (v ?? ''), d = {}; Object.keys(data).forEach(k => { if (e0 && String(nz(k, e0[k])) !== String(nz(k, data[k]))) d[k] = [nz(k, e0[k]) === '' ? null : nz(k, e0[k]), data[k]]; });
      await updateDoc(doc(DB, 'deliv_orders', EDIT), data); logAct('edit', e0, { who: isAdm() ? 'admin' : emp, d }); patchLocal(EDIT, data);
      EDIT = null; ST.formOpen = false; toast('اتعدّل ✔');
    } else {
      const now = Date.now(), ref = doc(collection(DB, 'deliv_orders'));
      await setDoc(ref, { ...data, startTime: now, assignedAt: now, createdAt: serverTimestamp(), endTime: null, status: 'PENDING', source: 'manual', by: UID });
      beep(660, 1); toast('الأوردر بدأ 🛵'); DR = {}; ST.formOpen = false;
    }
    render();
  } catch (e) { err.textContent = 'مقدرتش أحفظ: ' + (e.code || e.message); }
}
function patchLocal(id, data) {   // أوردر في الفترة المحمّلة (مش في الاستماع الحي) ← نحدّثه محلياً
  const apply = o => o.id === id ? { ...o, ...data } : o;
  HIST = HIST.map(apply); HC.forEach(c => { c.rows = c.rows.map(apply); });
}
async function finish(id) {
  const o = findOrder(id); if (!o) return;
  try {
    await updateDoc(doc(DB, 'deliv_orders', id), { status: 'COMPLETED', endTime: Date.now(), endSource: 'app', comm: commFor(o.zone) });
    beep(990, 2); toast('تم التسليم ✔'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); render();
  } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}
async function remove(id) {
  const o = findOrder(id); if (!o) return;
  let who = 'admin';
  if (!isAdm()) { who = await askWho(`حذف أوردر ${nm(o.driverName) || 'من غير مندوب'} ← ${o.customerName || 'عميل'} (${M(o.orderValue)})`); if (!who) return; }
  else if (!confirm(`تمسح الأوردر ده نهائي؟\n${nm(o.driverName)} ← ${o.customerName || 'عميل'} (${M(o.orderValue)})`)) return;
  try {
    await logAct('delete', o, { who });                      // نسخة كاملة في deliv_log قبل المسح
    await deleteDoc(doc(DB, 'deliv_orders', id));
    HIST = HIST.filter(x => x.id !== id); HC.forEach(c => { c.rows = c.rows.filter(x => x.id !== id); });
    toast('اتمسح'); render();
  } catch (e) { toast('مقدرتش أمسح: ' + (e.code || e.message) + (e.code === 'permission-denied' ? ' — بعد تأكيد المندوب الحذف من الأدمن' : '')); }
}
async function addDrv() {
  const n = (prompt('اسم الطيار الجديد:') || '').trim(); if (!n) return;
  if (drvList().includes(n)) { toast('الطيار ده موجود'); return; }
  try { const r = await addDoc(collection(DB, 'deliv_drivers'), { name: n }); DRIVERS.push({ id: r.id, name: n }); toast('اتضاف ✔'); render(); } catch (e) { toast('مقدرتش أضيف المندوب: ' + (e.code || e.message)); }
}
async function delDrv() {
  const n = $('#dDrv', ROOT).value, d = DRIVERS.find(x => x.name === n);
  if (!d) { toast('الطيار ده مش في القايمة (متسجل على أوردرات قديمة بس)'); return; }
  if (!confirm(`تشيل الطيار «${n}» من القايمة؟ أوردراته القديمة هتفضل في السجل.`)) return;
  try { await deleteDoc(doc(DB, 'deliv_drivers', d.id)); DRIVERS = DRIVERS.filter(x => x.id !== d.id); toast('اتشال'); render(); } catch (e) { toast('مقدرتش: ' + (e.code || e.message)); }
}

function receipt(id) {
  const o = findOrder(id); if (!o) return;
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
  const list = filtered(), bm = batchMap(pool(), Date.now()), ds = driverStats(list, bm).filter(d => d.c), [a, b] = periodRange();
  const tot = list.length, tsum = list.reduce((x, o) => x + totMs(o), 0), late = list.filter(o => totMs(o) > PROMISE).length;
  const lbl = k => `${+k.slice(8)}/${+k.slice(5, 7)}`, per = a === b ? `يوم ${lbl(a)}` : `من ${lbl(a)} لـ ${lbl(b)}`;
  const t = [`📋 تقرير الدليفري — ${per} (9ص–9ص)`, `✅ اتسلّم ${tot} أوردر · متوسط الوقت من الفاتورة ${tot ? durMin(tsum / tot) : '—'} · عدّى 30 دقيقة: ${late}`, `💵 قيمة الأوردرات: ${M(list.reduce((x, o) => x + (o.orderValue || 0), 0))}`, '',
    '🛵 المناديب:', ...ds.map(d => `• ${nm(d.n)}: ${d.c} أوردر (${d.out} خارج المعمورة) · متوسط ${durMin(d.tms / d.c)} · عمولة ${M(d.comm)}`),
    '', `💰 إجمالي عمولة الدليفري: ${M(list.filter(isOut).reduce((x, o) => x + commOf(o), 0))}`].join('\n');
  (navigator.clipboard ? navigator.clipboard.writeText(t).then(() => toast('اتنسخ — الصقه في الواتساب ✔')) : Promise.reject()).catch(() => prompt('انسخ التقرير:', t));
}

function exportXl() {
  if (!window.XLSX) { toast('مكتبة الإكسل مش محملة'); return; }
  const list = filtered().sort((a, b) => a.endTime - b.endTime), bm = batchMap(pool(), Date.now());
  const log = [['اليوم التشغيلي (9ص–9ص)', 'وقت الفاتورة/التسجيل', 'خروج المندوب', 'وقت التسليم', 'مصدر وقت التسليم', 'من الفاتورة (دقيقة)', 'من الخروج (دقيقة)', 'طلعة مجمعة (عدد)', 'الطيار', 'العميل', 'المنطقة', 'القيمة', 'الفكة', 'الدفع', 'عمولة الدليفري', 'سجّله', 'ملاحظات']]
    .concat(list.map(o => { const b = bm.get(o.id); return [opDay(o.endTime), timeStr(o.startTime), o.assignedAt ? timeStr(o.assignedAt) : '', timeStr(o.endTime), endSrc(o) === 'app' ? 'تطبيق' : 'فارما فلاي', +(totMs(o) / MIN).toFixed(1), +(rideMs(o, b) / MIN).toFixed(1), b && b.batch ? b.size : 1, o.driverName, o.customerName, o.zone || ZONES[0], o.orderValue, o.changeGiven, o.isVisa ? 'فيزا' : o.isVodafoneCash ? 'فودافون كاش' : 'كاش', commOf(o), o.employeeName, o.notes]; }));
  const drv = [['الطيار', 'أوردرات', 'متوسط من الفاتورة (دقيقة)', 'تسليمات مؤكدة', 'متوسط من الخروج (دقيقة، مؤكد)', 'أقل من 10', '10–15', '15–20', '20–30', 'أكتر من 30', 'خارج المعمورة (عدد)', 'خارج المعمورة (قيمة)', 'عمولة الدليفري', 'القيمة']]
    .concat(driverStats(list, bm).map(d => [d.n, d.c, d.c ? +(d.tms / d.c / MIN).toFixed(1) : 0, d.rn, d.rn ? +(d.rms / d.rn / MIN).toFixed(1) : '', ...d.b, d.out, d.outVal, d.comm, d.val]));
  const how = [['طريقة الحساب'],
    ['من الفاتورة = وقت التسليم − وقت الفاتورة (أو التسجيل اليدوي). ده اللي العميل شافه، وعليه وعد الـ30 دقيقة.'],
    ['من الخروج = وقت التسليم − وقت تأكيد المندوب (خروجه). بيتحسب بس للأوردرات اللي اتقفلت بضغطة «تسليم» من التطبيق، لأن وقت «إتمام التوصيل» في فارما فلاي مش موثوق.'],
    ['الطلعة المجمعة: أوردرات نفس المندوب اتأكدت في خلال 5 دقايق = طلعة واحدة، ونصيب كل أوردر من وقت الخروج = وقت الطلعة ÷ عدد الأوردرات.'],
    ['مثال: مندوب اتأكد له أوردرين 3:00 و3:02 ورجع 3:40 → 40 دقيقة ÷ 2 = 20 دقيقة لكل أوردر.'],
    ['"أكتر من 30" = الأوردر اللي عدّى وعد التوصيل (30 دقيقة من الفاتورة).'],
    ['عمولة الدليفري = المتخزن على الأوردر وقت التسليم (' + COMM_OUT + ' ج لكل أوردر اتسلّم خارج المعمورة). مثال: 8 أوردرات خارج المعمورة = 8 × ' + COMM_OUT + ' = ' + (8 * COMM_OUT) + ' ج.'],
    ['الفترة: ' + periodRange().join(' → ')], ['اليوم التشغيلي بيبدأ 9 الصبح وبيخلص 9 الصبح اللي بعده.']];
  const wb = XLSX.utils.book_new();
  [['طريقة الحساب', how], ['الطيارين', drv], ['السجل', log]].forEach(([n, r]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(r), n));
  XLSX.writeFile(wb, `دليفري_${opDay(Date.now())}.xlsx`);
}

/* ---------- تايمر ---------- */
function tick() {
  const now = Date.now();
  const sy = ROOT.querySelector('[data-sys]');
  if (sy) {
    if (!SYS || !SYS.at) { sy.textContent = '⚪ لسه مفيش إشارة من سيرفر الفواتير'; sy.className = 'pill sys'; }
    else { const ag = Math.max(0, Math.round((now - SYS.at) / 1000));
      if (ag < 150) { sy.textContent = `🟢 سيرفر الفواتير شغال (آخر فحص من ${ag < 90 ? ag + ' ث' : Math.round(ag / 60) + ' د'})${SYS.src ? ' · ' + (SYS.src === 'task' ? 'مهمة مستقلة' : 'نسخة احتياطية') : ''}`; sy.className = 'pill sys ok'; sy.title = SYS.started ? `اللوب شغال من ${dateStr(SYS.started)} ${timeStr(SYS.started)}` : ''; }
      else { sy.textContent = `🔴 سيرفر الفواتير واقف من ${Math.round(ag / 60)} دقيقة — الفواتير مش بتنزل`; sy.className = 'pill sys bad'; } }
  }
  const mb = ROOT.querySelector('[data-mute]'); if (mb) { const l = muteLbl(); if (mb.textContent !== l) mb.textContent = l; }
  ROOT.querySelectorAll('.oc[data-start]').forEach(c => {
    const out = c.dataset.out === '1', min = Math.floor((now - +c.dataset.start) / MIN);
    const late = !out && now - +c.dataset.bs >= +c.dataset.th, warn = min >= 20;
    const bd = c.querySelector('[data-bd]'); if (bd) { bd.textContent = c.classList.contains('tile') ? `🕒 ${min} د` : `🕒 منذ ${min} د${out ? ' · بدون إنذار' : ''}`; bd.className = 'bd ' + (late ? 'late' : out ? 'out' : warn ? 'warn' : ''); }
    const rd = c.querySelector('[data-rd]'); if (rd && c.dataset.as) rd.textContent = `خرج من ${Math.floor((now - +c.dataset.as) / MIN)} د`;
    if (late !== c.classList.contains('late')) {
      c.classList.toggle('late', late);
      const lt = c.querySelector('[data-lt]'); if (lt) { lt.className = late ? 'bg red' : ''; lt.textContent = late ? (c.classList.contains('tile') ? '⚠ متأخر' : `⚠ متأخر (+${+c.dataset.th / MIN} د)`) : ''; }
    }
    if (late && !ALARMED.has(c.dataset.id)) { ALARMED.add(c.dataset.id); beep(1200, 4); }
  });
}

function subDone() {   // اللي اتسلّم من 9 الصبح (اليوم التشغيلي الحالي) — بيتجدد لما اليوم يتغير
  if (UDONE) UDONE();
  ST.liveDay = opDay(Date.now());
  UDONE = onSnapshot(query(collection(DB, 'deliv_orders'), where('endTime', '>=', cairoStart(ST.liveDay))), s => {
    DONE = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); rebuild(); safeRender();
  }, e => toast('أوردرات النهارده: ' + (e.code || e.message)));
}

export async function mountDelivery(root, role) {
  ROOT = root; ROLE = role; css(); SEEN = null;
  ROOT.id = ROOT.id || 'delRoot'; ROOT.classList.add('delwrap');
  const app = getApp(); DB = getFirestore(app); UID = getAuth(app).currentUser ? getAuth(app).currentUser.uid : '';
  UNSUB.forEach(u => u()); UNSUB = []; if (UDONE) { UDONE(); UDONE = null; } clearInterval(TICK); clearInterval(REFRESH);
  const fail = e => { ROOT.innerHTML = `<div class="banner bad">مقدرتش أقرا الدليفري: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; };
  UNSUB.push(onSnapshot(query(collection(DB, 'deliv_orders'), where('status', '==', 'PENDING')), s => {
    OPEN = new Map(s.docs.map(d => [d.id, { id: d.id, ...d.data() }])); READY = 1; checkNew(); rebuild(); safeRender();
  }, fail));
  subDone();
  UNSUB.push(onSnapshot(doc(DB, 'deliv_sys', 'sync'), s => { SYS = s.exists() ? s.data() : null; }, () => { SYS = null; }));
  if (!ROOT._wired) { ROOT._wired = 1; ROOT.addEventListener('input', () => { LAST_UI = Date.now(); }); document.addEventListener('pointerdown', armAudio, true); }
  UNSUB.push(onSnapshot(collection(DB, 'deliv_drivers'), s => {
    DRIVERS = s.docs.map(d => ({ id: d.id, ...d.data() }));
    safeRender();
  }, e => toast('قايمة المناديب: ' + (e.code || e.message))));
  TICK = setInterval(() => { if (ROOT.isConnected) tick(); }, 1000);
  REFRESH = setInterval(() => { if (!ROOT.isConnected) return; if (ST.liveDay !== opDay(Date.now())) subDone(); if (ST.view === 'live') safeRender(); }, 30000);
  render();
}
