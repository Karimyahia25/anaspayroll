// طلبية النواقص اليومية (23/10) — سيرفر الصيدلية بيحسبها من الداتا بيز (pharma fly/app/order.py) ويكتبها في orders/<التاريخ>.
// مقسمة بالمورد (أحسن خصم). «تم الطلب» = دوسة واحدة، بتتحفظ فوراً في orders/<التاريخ>_done وبتظهر عند الكل لايف.
// الأدمن ومسؤول المشتريات بيعلّموا، وصاحب الصيدلية بيشوف بس.
// «حفظ الطلبية» (23/10) = صورة نهائية باللي اتطلب (الكود + الكمية + المورد) في orders/<التاريخ>_done.saved —
// دي اللي بتتقارن باللي وصل الفرع فعلاً من فواتير الشرا: السيرفر بيكتب orders/<التاريخ>_recv (6 الصبح لطلبية امبارح +
// أمر «وصل» في البوت)، والصفحة بتحط على كل صنف ✅ وصل · ⚠️ ناقص · 🔄 مورد تاني · ❌ موصلش — نفس قواعد receive.py.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const P = n => (n == null || isNaN(n)) ? '—' : (+n).toFixed(1);
const GRP_COLORS = ['#FFE8A3', '#C9F0E4', '#FFD6D6', '#D6E4FF', '#E9D8FD', '#FFE0C2', '#D2F4FA', '#E2F0CB'];
const SHEETS = [['meds', '💊 الأدوية'], ['supply', '🧴 المستلزمات والتجميل']];

let LOCAL = false, ROOT, DB, ROLE, WHO, DATE = '', AT = '', ROWS = [], DONE = {}, SAVED = null, SAVING = false, ST = { sheet: 'meds', hide: false, miss: false, exp: false, open: {} }, UNSUB = null,
  RECV = null, RECV_TO = '', LATEST = '', LATEST_AT = '';
// (25/10، قراره) المقارنة باللي وصل مستخبية لحد ما يعدّي أسبوع طلب — true = ترجع تظهر (السيرفر لسه بيكتب _recv)
const SHOW_RECV = false;
// نواقص السوق — اسأل عليها (26/10): السيرفر بيكتب orders/market، والنتيجة بتتحفظ في orders/market_done {t: {كود: {res, by, at, d}}}
let MARKET = [], MDONE = {}, MUNSUB = null;
// تعديل المورد والكمية لكل صنف (26/10، طلبه — موردين أجل ونقدي): orders/<التاريخ>_done.ov {كود: {sup?, need?, by, at}}.
// الأصل محفوظ في r._s0 / r._n0، والتعديل بيتطبق على r.sup / r.need ← التجميع والحفظ والإكسل بياخدوه لوحدهم.
let OV = {}, SPOPEN = null;
// تحديث الطلبية من الصفحة (29/10، طلبه): الزرار بيكتب orders/refresh_req_done، والسيرفر (المراقب) بيحسب الطلبية من الرصيد دلوقتي
// ويكتب orders/refresh_status {req, state, at}. العلامات والتعديلات محفوظة (merge_order على السيرفر) — مفيش حاجة بتضيع.
let RSTAT = null, MYREQ = null, MYREQ_T = 0, RUNSEEN = '', RUNUNSUB = null;
const RF_WAIT = 4 * 60 * 1000;      // لو السيرفر مردّش في 4 دقايق: الزرار يرجع ونقول جرّب تاني أو ابعت «طلبية» للبوت
const MRES = { none: '❌ مش موجود في السوق', found: '✅ لقيناه واتطلب', stop: '⛔ اتوقف / اتغير كوده' };   // RECV = اللي وصل من فواتير الشرا (السيرفر بيكتبه في orders/<التاريخ>_recv)

function css() {
  if ($('#ordCss')) return;
  const s = document.createElement('style'); s.id = 'ordCss';
  s.textContent = `
#ordRoot .ohd{background:linear-gradient(135deg,#0E9AA7,#0A6B60);color:#fff;border-radius:18px;padding:14px 16px;margin-bottom:10px;box-shadow:var(--shadow)}
#ordRoot .ohd h2{margin:0;color:#fff;font-size:18px}#ordRoot .ohd h2::before{display:none}
#ordRoot .ohd .s{font-size:13px;opacity:.9;margin-top:4px}
#ordRoot .bar{height:10px;border-radius:99px;background:rgba(255,255,255,.25);margin-top:10px;overflow:hidden}
#ordRoot .bar i{display:block;height:100%;background:#FFC83D;border-radius:99px;transition:width .3s}
#ordRoot .tabs2{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap;align-items:center}
#ordRoot .tabs2 button{min-height:44px;border-radius:99px;padding:8px 16px;background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:700}
#ordRoot .tabs2 button.on{background:#1F2A44;color:#fff;border-color:#1F2A44}
#ordRoot .tabs2 label{display:inline-flex;gap:6px;align-items:center;font-size:13.5px;margin-inline-start:auto}#ordRoot .tabs2 label input{width:auto;margin:0}
#ordRoot .grp{border-radius:16px;margin-bottom:10px;overflow:hidden;box-shadow:var(--shadow);background:var(--card)}
#ordRoot .gh{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 14px;cursor:pointer;color:#1F2A44;font-weight:700}
#ordRoot .gh .n{font-size:12.5px;font-weight:600;opacity:.85}
#ordRoot .gh .done{background:#1B7F3B;color:#fff;border-radius:99px;padding:2px 10px;font-size:12px}
#ordRoot .row{display:grid;grid-template-columns:52px 1fr auto;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--line)}
#ordRoot .row.ok{background:color-mix(in srgb,#1B7F3B 13%,var(--card))}
#ordRoot .row.ok .nm{text-decoration:line-through;opacity:.75}
#ordRoot .chk{width:44px;height:44px;border-radius:12px;border:2px solid #9AA6B2;background:var(--card);display:flex;align-items:center;justify-content:center;
  font-size:26px;color:#fff;cursor:pointer;padding:0;min-height:44px}
#ordRoot .chk.on{background:#1B7F3B;border-color:#1B7F3B}
#ordRoot .chk[disabled]{cursor:default;opacity:.8}
#ordRoot .sd{color:#C2410C;background:#FFEDD5;font-weight:800;font-size:16px;padding:1px 8px;border-radius:8px}
#ordRoot .sea{color:#B45309;font-weight:700}
#ordRoot .nm{font-weight:700;font-size:14.5px;direction:ltr;text-align:right;word-break:break-word}
#ordRoot .mt{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.8}
#ordRoot .mt b{color:var(--ink)}
#ordRoot .abc{display:inline-block;min-width:22px;text-align:center;border-radius:6px;color:#fff;font-weight:700;font-size:11.5px;padding:1px 6px;margin-inline-end:6px}
#ordRoot .abc.A{background:#1B7F3B}#ordRoot .abc.B{background:#2A6FB0}#ordRoot .abc.C{background:#8A94A6}
#ordRoot .oos{color:#A32E1E;font-weight:700}
#ordRoot .yel{background:#FFF4C2;color:#7A5A00;border-radius:6px;padding:0 6px;font-weight:700}
#ordRoot .up{color:#B0761F;font-weight:700}
#ordRoot .need{text-align:center;min-width:64px}
#ordRoot .need .v{font-family:Alexandria,sans-serif;font-size:24px;font-weight:700;color:#0E6F78;line-height:1}
#ordRoot .need .l{font-size:11px;color:var(--muted)}
#ordRoot .by{font-size:11.5px;color:#1B7F3B;font-weight:700}
#ordRoot .save{min-height:52px;border-radius:14px;padding:10px 22px;background:#C2410C;color:#fff;border:0;font-weight:800;font-size:16.5px;cursor:pointer;box-shadow:var(--shadow)}
#ordRoot .save.ok{background:#1B7F3B}#ordRoot .save[disabled]{opacity:.6;cursor:default}
#ordRoot .savedat{font-size:12px;color:var(--muted);width:100%;text-align:end}
#ordRoot .nav{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}#ordRoot .nav button{min-height:40px;border-radius:99px;padding:6px 14px;border:0;background:rgba(255,255,255,.2);color:#fff;font-weight:700;cursor:pointer}
#ordRoot .rsum{background:#fff;color:#1F2A44;border-radius:12px;padding:8px 12px;margin-top:10px;font-size:14px;font-weight:700;line-height:1.9}
#ordRoot .rc{display:inline-block;border-radius:8px;padding:1px 8px;font-weight:800;font-size:13px}
#ordRoot .rc.ok{background:#DCF5E3;color:#1B7F3B}#ordRoot .rc.part{background:#FFF1B8;color:#7A5A00}#ordRoot .rc.other{background:#E0E9FF;color:#2A4FB0}#ordRoot .rc.none{background:#FDE2E1;color:#A32E1E}#ordRoot .rc.extra{background:#EEF1F5;color:#475467}
#ordRoot .xbtn{min-height:52px;border-radius:14px;padding:10px 18px;background:#1F2A44;color:#fff;border:0;font-weight:800;font-size:15.5px;cursor:pointer;box-shadow:var(--shadow)}
#ordRoot .xmenu{display:flex;gap:6px;width:100%;justify-content:flex-end;flex-wrap:wrap}
#ordRoot .xmenu button{min-height:46px;border-radius:12px;padding:8px 16px;border:2px solid #1F2A44;background:var(--card);color:var(--ink);font-weight:800;cursor:pointer}
#ordRoot .pend{background:#FFF1B8;color:#7A5A00;border-radius:8px;padding:1px 8px;font-weight:800}
#ordRoot .kept{background:#EEF1F5;color:#475467;border-radius:8px;padding:1px 8px;font-weight:700}
#ordRoot .sib{background:#E0E9FF;color:#2A4FB0;border-radius:8px;padding:1px 8px;font-weight:800}
#ordRoot .sibs{color:#2A4FB0;font-weight:700}
#ordRoot .cust{background:#FCE7F3;color:#9D174D;border-radius:8px;padding:1px 8px;font-weight:800}
#ordRoot .row.cu{border-inline-start:4px solid #DB2777}
#ordRoot .tabs2 button.mk{border-color:#C2410C;color:#C2410C}#ordRoot .tabs2 button.mk.on{background:#C2410C;color:#fff}
#ordRoot .mkb label{display:inline-flex;gap:6px;align-items:center;font-weight:700;margin-top:6px}#ordRoot .mkb label input{width:auto;margin:0}
#ordRoot .mkb{background:#FFF7ED;border:1px solid #FED7AA;color:#7C2D12;line-height:1.8}
#ordRoot .mrow{grid-template-columns:4px 1fr auto}
#ordRoot .mres{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}#ordRoot .mres button{min-height:40px;border-radius:10px;padding:6px 10px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:700;font-size:12.5px;cursor:pointer}#ordRoot .mres button.on{background:#1F2A44;color:#fff;border-color:#1F2A44}
#ordRoot .nq{width:64px;min-height:44px;text-align:center;font-family:Alexandria,sans-serif;font-size:22px;font-weight:700;color:#0E6F78;border:2px solid #9AD8D0;border-radius:12px;background:var(--card);padding:2px}
#ordRoot .nq.chgd{border-color:#C2410C;color:#C2410C}
#ordRoot .spb{min-height:34px;border-radius:10px;padding:4px 10px;border:1px solid #FDBA74;background:#FFEDD5;color:#9A3412;font-weight:700;font-size:12px;cursor:pointer;margin-inline-start:4px}
#ordRoot .sps{min-height:40px;border-radius:10px;padding:4px 8px;font-size:14px;max-width:100%;background:#FFF7ED;border:2px solid #FDBA74;color:#7C2D12;font-weight:700}
#ordRoot .chg{background:#FFEDD5;color:#9A3412;border-radius:8px;padding:1px 8px;font-weight:800}
#ordRoot .rf{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
#ordRoot .rfb{min-height:48px;border-radius:14px;padding:8px 18px;border:0;background:#fff;color:#0A6B60;font-weight:800;font-size:16px;cursor:pointer;box-shadow:var(--shadow)}#ordRoot .rfb[disabled]{opacity:.7;cursor:default}
#ordRoot .rft{font-size:13px;opacity:.95;line-height:1.7;flex:1;min-width:200px}
#ordRoot .barw{display:flex;align-items:center;gap:10px;margin-top:10px}#ordRoot .barw .bar{flex:1;margin-top:0;height:14px;position:relative;overflow:visible}
#ordRoot .barw b{font:800 14px Alexandria,sans-serif;min-width:40px;text-align:start}
#ordRoot .bar i{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.28) 0 8px,rgba(255,255,255,0) 8px 16px);background-size:22px 22px;animation:ordStripe 1.1s linear infinite;transition:width .6s cubic-bezier(.2,.8,.2,1)}
#ordRoot .bar i{position:relative}#ordRoot .bar i::after{content:'🛒';position:absolute;top:-8px;left:-6px;font-size:16px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
@keyframes ordStripe{to{background-position:22px 0}}
@keyframes ordEnt{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
#ordRoot .grp.ent{animation:ordEnt .45s ease-out backwards}
@keyframes ordPop{0%{transform:scale(.7)}55%{transform:scale(1.28)}100%{transform:scale(1)}}
#ordRoot .chk.pop{animation:ordPop .42s cubic-bezier(.3,1.6,.5,1)}
@keyframes ordFlash{0%{background:#FFF1B8}100%{background:color-mix(in srgb,#1B7F3B 13%,var(--card))}}
#ordRoot .row.just{animation:ordFlash 1s ease-out}
#ordRoot .chk{transition:transform .12s,background .2s,border-color .2s}#ordRoot .chk:not([disabled]):hover{transform:scale(1.08);border-color:#0E9AA7}
#ordRoot .row{transition:background .25s}#ordRoot .row:hover{background:color-mix(in srgb,#0E9AA7 5%,var(--card))}
#ordRoot .gh .done{animation:ordPulse 1.8s ease-in-out infinite}
@keyframes ordPulse{50%{transform:scale(1.08);box-shadow:0 0 0 5px rgba(27,127,59,.18)}}
#ordRoot .spin{display:inline-block;animation:ordSpin 1s linear infinite}@keyframes ordSpin{to{transform:rotate(360deg)}}
#ordRoot .rfb:not([disabled]):hover{transform:translateY(-2px)}#ordRoot .rfb{transition:transform .15s}
#ordRoot .fxt{min-height:40px;border-radius:12px;padding:4px 12px;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.18);color:#fff;font-weight:700;font-size:13px;cursor:pointer}
#ordFx{position:fixed;inset:0;pointer-events:none;z-index:95;overflow:hidden}
#ordFx .fxb{position:absolute;transform:translate(-50%,0);background:#fff;color:#0A6B60;border:2px solid #0E9AA7;border-radius:22px;padding:7px 15px;font:800 14.5px/1.4 Alexandria,'IBM Plex Sans Arabic',sans-serif;white-space:nowrap;box-shadow:0 6px 18px rgba(14,154,167,.28)}
#ordFx .fxb::after{content:'';position:absolute;bottom:-8px;left:50%;margin-left:-7px;border:7px solid transparent;border-top-color:#0E9AA7;border-bottom:0}
#ordFx .fxb.big{background:linear-gradient(135deg,#FFE79A,#FFC83D);color:#1F2A44;border-color:#F4A900;font-size:16px;padding:10px 20px;box-shadow:0 8px 24px rgba(244,169,0,.4)}
#ordFx .fxb.big::after{border-top-color:#F4A900}
#ordFx .fxd,#ordFx .fxs{position:absolute;border-radius:50%;background:rgba(14,154,167,.25);border:1.5px solid #0E9AA7}
#ordFx .fxd{background:#7FD6CC;border:0}
#ordFx .fxc{position:absolute;border-radius:2px}
@media (prefers-reduced-motion:reduce){#ordRoot *,#ordFx *{animation:none!important;transition:none!important}}
#ordRoot .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0F1B2D;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
`;
  document.head.appendChild(s);
}

const canEdit = () => ROLE === 'admin' || ROLE === 'buyer';
const doneRef = () => doc(DB, 'orders', DATE + '_done');
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2000); }
const nowCairo = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(11, 16);

const rfWaited = () => !!MYREQ && Date.now() - MYREQ_T >= RF_WAIT;
const rfMine = () => !!(MYREQ && RSTAT && RSTAT.req === MYREQ);
const rfBusy = () => !!MYREQ && !rfWaited() && !(rfMine() && ['done', 'error', 'expired'].includes(RSTAT.state));
function rfText() {
  const s = RSTAT;
  if (rfMine()) {
    if (s.state === 'running') return '⚙️ السيرفر بيحسب الطلبية من الرصيد دلوقتي… (حوالي دقيقة)';
    if (s.state === 'done') return `✅ اتحدّثت الساعة ${esc(s.at)}`;
    if (s.state === 'error') return '⚠️ التحديث فشل — جرّب تاني أو ابعت «طلبية» للبوت';
    if (s.state === 'expired') return '⚠️ الطلب كان قديم — دوس تاني';
  }
  if (MYREQ) return rfWaited() ? '⚠️ السيرفر مردّش — جرّب تاني بعد شوية، أو ابعت «طلبية» للبوت' : '⏳ الطلب وصل للسيرفر — هيبدأ خلال ثواني (التحديث بياخد حوالي دقيقتين)';
  if (s && s.state === 'running') return `⚙️ ${esc(s.by || 'حد')} بيحدّث الطلبية دلوقتي…`;
  if (s && s.state === 'done') return `آخر تحديث بالزرار الساعة ${esc(s.at)}${s.by ? ' — ' + esc(s.by) : ''}`;
  return '';
}
async function requestRefresh() {
  if (!canEdit() || rfBusy()) return;
  const id = String(Date.now());
  MYREQ = id; MYREQ_T = Date.now();
  if (LOCAL) {                                              // تجربة محلية: نحاكي السيرفر
    RSTAT = { req: id, state: 'queued' }; render();
    setTimeout(() => { RSTAT = { req: id, state: 'running', at: nowCairo() }; render(); }, 800);
    setTimeout(() => { RSTAT = { req: id, state: 'done', at: nowCairo(), by: WHO }; toast('✅ الطلبية اتحدّثت'); render(); }, 2200);
    return;
  }
  try {
    await setDoc(doc(DB, 'orders', 'refresh_req_done'), { id, by: WHO, at: nowCairo() });
    RSTAT = { req: id, state: 'queued' }; render();
    toast('الطلب اتبعت للسيرفر — هيتحدّث خلال دقيقتين تقريباً');
    setTimeout(render, RF_WAIT + 500);                     // يرجّع الزرار لو السيرفر مردّش
  } catch (e) { MYREQ = null; toast('مقدرتش أبعت الطلب: ' + (e.code || e.message)); render(); }
}
// أي حد (أنا أو زميل) لما التحديث يخلص: نعيد تحميل الطلبية من غير ما نقفل الصفحة (ولو بتتفرج على يوم قديم منخطفكش)
async function reloadLatest() {
  try {
    const wasLatest = DATE === LATEST;
    const L = await getDoc(doc(DB, 'orders', 'latest'));
    if (!L.exists()) return;
    LATEST = L.data().date; LATEST_AT = (L.data().at || '') + (L.data().ver ? ' · نسخة ' + L.data().ver : '');
    if (!wasLatest) { render(); return; }
    if (await loadDate(LATEST)) {
      try { const m = await getDoc(doc(DB, 'orders', 'market')); MARKET = m.exists() ? JSON.parse(m.data().d || '[]') : MARKET; } catch (e) {}
      CAT = null; CAT_LOADING = null;                       // البحث بالصنف يتحمّل من جديد
      toast('✅ الطلبية اتحدّثت'); render();
    }
  } catch (e) { toast('الطلبية اتحدّثت — اقفل الصفحة وافتحها تاني: ' + (e.code || e.message)); }
}
function watchRefresh() {
  if (RUNUNSUB) RUNUNSUB();
  let first = true;
  RUNUNSUB = onSnapshot(doc(DB, 'orders', 'refresh_status'), s => {
    RSTAT = s.exists() ? s.data() : RSTAT;
    const done = RSTAT && RSTAT.state === 'done' ? RSTAT.req : '';
    const fresh = !first && done && done !== RUNSEEN;
    first = false; if (done) RUNSEEN = done;
    if (fresh) reloadLatest(); else render();
  }, () => {});
}

// ===================== مؤثرات وروح الصفحة (31/10، طلبه) =====================
// صوت خفيف (WebAudio من غير ملفات) + بابل تشجيع بتفرقع برزاز خفيف + كومبو + احتفال لما مورد/قسم/الطلبية كلها تخلص.
// كله على طبقة fixed برا الصفحة (#ordFx) علشان إعادة الرسم ما تقتلهوش، وبيقف مع prefers-reduced-motion. زرار 🔔 في الصفحة بيقفل/يفتح.
// المؤثرات بتشتغل لدوسة اللي قدامك بس — مش لما زميل يعلّم من موبايله.
let FX_ON = true, LASTTICK = null, ANIM_IN = true, LAST_POP = 0, COMBO = { n: 0, t: 0 }, ACTX = null;
try { FX_ON = localStorage.getItem('ord_fx') !== '0'; } catch (e) {}
const REDUCED = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const PICK = a => a[Math.floor(Math.random() * a.length)];
const CHEERS = ['عاش يا بطل 👏', 'كمّل كده! 💪', 'ولا غلطة 🎯', 'شغل نضيف ✨', 'ربنا يفتحها عليك 🌿', 'واحدة وراها واحدة 🚀', 'تمام التمام ✔️', 'إنت جامد! 🔥', 'يلا يلا قربنا 🏁', 'بالسرعة دي هنخلّص بدري ⚡'];
const FX_COLORS = ['#0E9AA7', '#FFC83D', '#E4572E', '#1F2A44', '#7FD6CC'];

function fxLayer() {
  let l = document.getElementById('ordFx');
  if (!l) { l = document.createElement('div'); l.id = 'ordFx'; document.body.appendChild(l); }
  return l;
}
function tone(freq, t0, dur, vol, type = 'sine', slideTo = null) {
  if (!ACTX) return;
  const o = ACTX.createOscillator(), g = ACTX.createGain(), t = ACTX.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ACTX.destination); o.start(t); o.stop(t + dur + 0.02);
}
function sound(kind) {
  if (!FX_ON) return;
  try {
    ACTX = ACTX || new (window.AudioContext || window.webkitAudioContext)();
    if (ACTX.state === 'suspended') ACTX.resume();
    if (kind === 'pop') { tone(480, 0, 0.09, 0.09, 'sine', 900); tone(1250, 0.05, 0.05, 0.03, 'triangle'); }
    else if (kind === 'off') tone(520, 0, 0.08, 0.05, 'sine', 330);
    else if (kind === 'chime') { tone(784, 0, 0.14, 0.08); tone(1175, 0.11, 0.22, 0.08); }
    else if (kind === 'fan') [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.26, 0.085, 'triangle'));
  } catch (e) {}
}
// بابل بتطلع فوق الصنف، تكبر وتفرقع برزاز
function say(text, x, y, big) {
  if (!FX_ON || REDUCED()) return;
  const l = fxLayer(), el = document.createElement('div'), W = innerWidth;
  el.className = 'fxb' + (big ? ' big' : ''); el.textContent = text;
  const cx = Math.min(Math.max(x, 110), W - 110), cy = Math.max(70, y - 46);
  el.style.left = cx + 'px'; el.style.top = cy + 'px'; l.appendChild(el);
  const D = big ? 2800 : 1800;
  const a = el.animate([
    { transform: 'translate(-50%,0) scale(.35)', opacity: 0 },
    { transform: 'translate(-50%,-8px) scale(1.08)', opacity: 1, offset: .16 },
    { transform: 'translate(-50%,-30px) scale(1)', opacity: 1, offset: .72 },
    { transform: 'translate(-50%,-44px) scale(1.28)', opacity: 0 }], { duration: D, easing: 'ease-out' });
  a.onfinish = () => el.remove();
  setTimeout(() => splash(cx, cy - 44, big ? 12 : 7), D * .72);
}
function splash(x, y, n) {                                    // رزاز البابل لما تفرقع
  const l = fxLayer();
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i'), ang = (Math.PI * 2 * i) / n + Math.random() * .5, r = 22 + Math.random() * 26, s = 4 + Math.random() * 5;
    d.className = 'fxd'; d.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px`; l.appendChild(d);
    d.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: .9 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * r}px),calc(-50% + ${Math.sin(ang) * r}px)) scale(.3)`, opacity: 0 }],
      { duration: 480 + Math.random() * 220, easing: 'ease-out' }).onfinish = () => d.remove();
  }
}
function spray(x, y, n) {                                     // فقاقيع صغيرة بتطلع من المربع
  if (!FX_ON || REDUCED()) return;
  const l = fxLayer();
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i'), s = 6 + Math.random() * 9, dx = (Math.random() - .5) * 70;
    b.className = 'fxs'; b.style.cssText = `left:${x}px;top:${y}px;width:${s}px;height:${s}px`; l.appendChild(b);
    b.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * .4}px),-${22 + Math.random() * 20}px) scale(1)`, opacity: .85, offset: .3 },
      { transform: `translate(calc(-50% + ${dx}px),-${60 + Math.random() * 50}px) scale(.9)`, opacity: 0 }],
      { duration: 800 + Math.random() * 600, delay: i * 40, easing: 'ease-out', fill: 'backwards' }).onfinish = () => b.remove();
  }
}
function confetti() {
  if (!FX_ON || REDUCED()) return;
  const l = fxLayer();
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i'), s = 6 + Math.random() * 6;
    c.className = 'fxc'; c.style.cssText = `left:${Math.random() * 100}%;top:-12px;width:${s}px;height:${s * (Math.random() > .5 ? 1 : 1.8)}px;background:${PICK(FX_COLORS)}`; l.appendChild(c);
    c.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 },
      { transform: `translate(${(Math.random() - .5) * 120}px,${innerHeight + 30}px) rotate(${360 + Math.random() * 540}deg)`, opacity: .9 }],
      { duration: 1800 + Math.random() * 1400, delay: Math.random() * 500, easing: 'cubic-bezier(.2,.6,.3,1)' }).onfinish = () => c.remove();
  }
}
// بتتنده بعد كل دوسة «تم الطلب» (من اللي قدامك بس)
function cheer(k) {
  const r = ROWS.find(x => String(x.code) === k), b = document.querySelector(`[data-code="${k}"]`);
  if (!r) return;
  const rc = b ? b.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }, x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
  const all = ROWS.length, done = ROWS.filter(z => DONE[z.code]).length, pct = n => Math.floor(100 * n / all);
  const mile = [100, 75, 50, 25].find(m => pct(done) >= m && pct(done - 1) < m);
  const grpDone = ROWS.filter(z => z.sheet === r.sheet && z.sup === r.sup).every(z => DONE[z.code]);
  const sheetDone = ROWS.filter(z => z.sheet === r.sheet).every(z => DONE[z.code]);
  const now = Date.now(); COMBO = { n: now - COMBO.t < 25000 ? COMBO.n + 1 : 1, t: now };
  spray(x, y, 8);
  if (done === all) { sound('fan'); say('الطلبية كلها خلصت! تسلم إيدك 🎉', x, y, true); confetti(); return; }
  if (sheetDone) { sound('fan'); say(r.sheet === 'meds' ? 'الأدوية كلها خلصت 💊🎉' : 'المستلزمات خلصت 🧴🎉', x, y, true); confetti(); return; }
  if (mile) { sound('chime'); say({ 25: 'ربع الطلبية خلص 🎈', 50: 'نص الطلبية! كمّل 🔥', 75: 'فاضل شوية صغيرين 🏃' }[mile], x, y, true); return; }
  if (grpDone) { sound('chime'); say(`خلصنا ${r.sup} ✔️🎉`, x, y, true); return; }
  sound('pop');
  if (COMBO.n >= 3 && [3, 5, 8, 12, 16, 20].includes(COMBO.n)) say(`🔥 كومبو ×${COMBO.n}`, x, y, false);
  else if (Math.random() < .5) say(PICK(CHEERS), x, y, false);
}
// بوب أب ترحيب لما طلبية الأدوية تتفتح (مرة كل 10 دقايق على الأكتر)
function welcomePop() {
  if (!FX_ON || REDUCED() || !canEdit() || ST.sheet !== 'meds' || Date.now() - LAST_POP < 600000) return;
  const left = ROWS.filter(r => r.sheet === 'meds' && !DONE[r.code]).length;
  if (!left) return;
  LAST_POP = Date.now();
  setTimeout(() => {
    const h = new Date(Date.now() + 2 * 3600e3).getUTCHours(), hi = h < 12 ? 'صباح الخير' : h < 18 ? 'نهارك سعيد' : 'مساء الخير';
    say(`${hi} 👋 فاضل ${left} صنف دوا — يلا نخلّصهم 💪`, innerWidth / 2, 330, true);
    sound('chime');
  }, 900);
}
function toggleFx() {
  FX_ON = !FX_ON; try { localStorage.setItem('ord_fx', FX_ON ? '1' : '0'); } catch (e) {}
  if (FX_ON) sound('chime'); render();
}

function applyOV() {
  ROWS.forEach(r => {
    if (r._s0 === undefined) { r._s0 = r.sup; r._n0 = r.need; }
    const o = OV[r.code] || {};
    r.sup = o.sup || r._s0;
    r.need = o.need != null ? o.need : r._n0;
  });
}
// الموردين: الرئيسيين الأول (3 أصناف+ في طلبية النهارده، الأكتر الأول) وبعدين الباقي أبجدي (من آخر شرا ونواقص السوق)
function supList() {
  const n = {};
  ROWS.forEach(r => { if (r._s0 && r._s0 !== 'مورد مش محدد') n[r._s0] = (n[r._s0] || 0) + 1; });
  const main = Object.keys(n).filter(s => n[s] >= 3).sort((a, b) => n[b] - n[a]);
  const rest = new Set();
  ROWS.forEach(r => { [r._s0, r.lsup].forEach(s => { if (s && s !== 'مورد مش محدد' && !main.includes(s)) rest.add(s); }); });
  MARKET.forEach(m => { if (m.ls && !main.includes(m.ls)) rest.add(m.ls); });
  Object.values(OV).forEach(o => { if (o.sup && !main.includes(o.sup)) rest.add(o.sup); });
  return [main, [...rest].filter(s => !/outting|doctor anas|دكتور انس/i.test(s)).sort((a, b) => a.localeCompare(b, 'ar'))];
}
async function setOV(code, patch) {
  if (!canEdit()) return;
  const k = String(code), r = ROWS.find(x => String(x.code) === k);
  if (!r) return;
  const o = { ...(OV[k] || {}), ...patch, by: WHO, at: nowCairo() };
  if (o.sup === r._s0) delete o.sup;
  if (o.need === r._n0) delete o.need;
  const was = OV[k];
  if (o.sup == null && o.need == null) delete OV[k]; else OV[k] = o;
  applyOV(); render();
  if (LOCAL) return;
  try {
    if (!OV[k]) await updateDoc(doneRef(), { ['ov.' + k]: deleteField() });
    else await setDoc(doneRef(), { ov: { [k]: OV[k] } }, { merge: true });
  } catch (e) { if (was) OV[k] = was; else delete OV[k]; applyOV(); render(); toast('متحفظش: ' + (e.code || e.message)); }
}

async function tick(code) {
  if (!canEdit()) return;
  const k = String(code), was = !!DONE[k];
  if (was) delete DONE[k]; else DONE[k] = { by: WHO, at: nowCairo() };      // يبان فوراً، والحفظ في الخلفية
  LASTTICK = was ? null : k;
  render();
  if (was) sound('off'); else { cheer(k); setTimeout(() => { if (LASTTICK === k) LASTTICK = null; }, 1300); }
  if (LOCAL) return;
  try {
    if (was) await updateDoc(doneRef(), { ['t.' + k]: deleteField() });
    else await setDoc(doneRef(), { t: { [k]: DONE[k] } }, { merge: true });
  } catch (e) {
    if (was) DONE[k] = { by: WHO, at: '' }; else delete DONE[k];
    render(); toast('متحفظش: ' + (e.code || e.message));
  }
}

// الأصناف اللي عليها صح دلوقتي ومختلفة عن آخر حفظ
function unsaved() {
  const s = (SAVED && SAVED.items) || {}, d = Object.keys(DONE);
  const changed = d.filter(k => { const r = s[k], x = ROWS.find(y => String(y.code) === k); return r && x && (r.need !== x.need || r.sup !== x.sup); });
  return d.filter(k => !s[k]).length + Object.keys(s).filter(k => !DONE[k]).length + changed.length;
}

async function saveOrder() {
  if (!canEdit() || SAVING) return;
  const items = {};
  ROWS.filter(r => DONE[r.code]).forEach(r => items[r.code] = { need: r.need, sup: r.sup, name: r.name, sd: r.sd ?? null, by: DONE[r.code].by || '' });
  const n = Object.keys(items).length;
  if (!n) { toast('علّم على الأصناف اللي اتطلبت الأول'); return; }
  if (!confirm(`حفظ الطلبية: ${n} صنف اتطلب من ${ROWS.length}؟`)) return;
  const saved = { at: nowCairo(), by: WHO, n, total: ROWS.length, items, ts: Date.now() };
  SAVING = true; render();
  try {
    if (!LOCAL) await setDoc(doneRef(), { saved }, { merge: true });
    SAVED = saved; toast(`✔ اتحفظت الطلبية — ${n} صنف`);
  } catch (e) { toast('متحفظتش: ' + (e.code || e.message)); }
  SAVING = false; render();
}

// حالة الاستلام — نفس compare() في receive.py: المرجع «حفظ الطلبية» ولو متحفظتش = العلامات
const RC = { ok: '✅ وصل كامل', part: '⚠️ وصل ناقص', other: '🔄 من مورد تاني', none: '❌ موصلش' };
function recvOf(r) {
  if (!RECV) return null;
  const ord = SAVED && SAVED.items ? SAVED.items[r.code] : (DONE[r.code] ? r : null);
  const x = RECV[r.code], q = x ? x.q : 0, sups = x ? [...new Set(x.s.map(s => s[0]))] : [];
  if (!ord) return q > 0 ? { st: 'extra', q, sups } : null;           // وصل من غير ما يتعلّم عليه
  const need = ord.need || 1, sup = ord.sup || '';
  const st = q <= 0 ? 'none' : (sup && sup !== 'مورد مش محدد' && !sups.includes(sup)) ? 'other' : q + 1e-9 < need ? 'part' : 'ok';
  // الخصم اللي اتشرى بيه (البونص محسوب) قصاد «خصم المورد ده» — نفس receive.py (25/10)
  const bd = x && x.r ? Math.round((1 - x.c / x.r) * 1000) / 10 : null, sd = ord.sd ?? null;
  const gain = bd != null && sd != null ? Math.round(x.r * (bd - sd) / 100) : null;
  return { st, q, sups, need, bd, sd, gain };
}

async function loadDate(d) {
  const o = await getDoc(doc(DB, 'orders', d));
  if (!o.exists()) { toast('مفيش طلبية يوم ' + d.split('-').reverse().join('/')); return false; }
  DATE = d; ROWS = JSON.parse(o.data().d || '[]'); ANIM_IN = true;
  AT = d === LATEST ? LATEST_AT : String(o.data().at || '').slice(11);
  RECV = null; RECV_TO = '';
  if (SHOW_RECV) try { const r = await getDoc(doc(DB, 'orders', d + '_recv')); if (r.exists()) { RECV = JSON.parse(r.data().d || '{}'); RECV_TO = r.data().to || ''; } } catch (e) {}
  if (UNSUB) UNSUB();
  OV = {}; applyOV();
  UNSUB = onSnapshot(doneRef(), s => { DONE = (s.exists() && s.data().t) || {}; SAVED = (s.exists() && s.data().saved) || null;
    OV = (s.exists() && s.data().ov) || {}; applyOV(); render(); }, () => render());
  return true;
}
const shiftDay = (d, k) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

// تصدير إكسل (24/10): «اللي اتطلب» أو «اللي متطلبش» — اللي متطلبش = أصناف مش عند موردها، نسأل عليها في أماكن تانية.
// شيت لكل قسم، مترتب بالمورد زي الصفحة.
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('مقدرتش أحمّل مكتبة الإكسل')); document.head.appendChild(s); });
}
async function exportXl(done) {
  const pick = ROWS.filter(r => !!DONE[r.code] === done);
  if (!pick.length) { toast(done ? 'مفيش أصناف متعلّم عليها لسه' : 'كل الأصناف اتطلبت 🎉'); return; }
  try { await loadXlsx(); } catch (e) { toast(e.message); return; }
  const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  const head = ['المورد', 'الكود', 'الصنف', 'ABC', 'الرصيد', 'المطلوب (علب)', 'خصم المورد ده %', 'آخر شرا', 'آخر مورد', 'خصمه %', 'ملاحظة',
    ...(done ? ['اتطلب بواسطة', 'الساعة'] : []), ...(RECV ? ['الاستلام'] : [])];
  const title = done ? 'اللي اتطلب' : 'اللي متطلبش';
  SHEETS.forEach(([k, nm]) => {
    const rows = pick.filter(r => r.sheet === k);
    if (!rows.length) return;
    const n = {}; rows.forEach(r => n[r.sup] = (n[r.sup] || 0) + 1);
    rows.sort((a, b) => (a.sup === 'مورد مش محدد') - (b.sup === 'مورد مش محدد') || n[b.sup] - n[a.sup] || a.sup.localeCompare(b.sup) || a.name.localeCompare(b.name));
    const aoa = [[`طلبية النواقص ${DATE.split('-').reverse().join('/')} — ${title} — ${rows.length} صنف`], [], head, ...rows.map(r => {
      const D = DONE[r.code], R = recvOf(r);
      const note = [r.up ? 'السعر زاد' : '', r.sea ? 'صيفي — بمعدل آخر 30 يوم' : '', r.moved || '',
        r.kept ? 'اتعلّم عليه قبل التحديث' : '', r.cust ? custTxt(r) : '', r.sup !== r._s0 ? `المورد اتغير من ${r._s0}` : '', r.need !== r._n0 ? `الكمية اتغيرت من ${r._n0}` : '', r.pend ? `اتطلب امبارح ولسه موصلش ${String(Math.round(r.pend * 100) / 100)} علبة${r.pend_sup ? ' من ' + r.pend_sup : ''}` : ''].filter(Boolean).join(' · ');
      return [r.sup, r.code, r.name, r.abc, r.stock, r.need, r.sd ?? '', r.last || '', r.lsup || '', r.ld ?? '', note,
        ...(done ? [D.by || '', D.at || ''] : []), ...(RECV ? [R ? (R.st === 'extra' ? 'وصل من غير علامة' : RC[R.st]) + (R.q > 0 ? ' ' + Math.round(R.q * 100) / 100 + ' من ' + R.sups.join('، ') : '') : ''] : [])];
    })];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [18, 9, 40, 6, 10, 11, 12, 10, 18, 8, 26, 14, 8, 30].slice(0, head.length).map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: head.length - 1 } }];
    ws['!views'] = [{ RTL: true }];
    XLSX.utils.book_append_sheet(wb, ws, nm.replace(/[^\u0600-\u06FF a-zA-Z]/g, '').trim().slice(0, 31));
  });
  XLSX.writeFile(wb, `طلبية_${DATE}_${title.replace(/ /g, '_')}.xlsx`);
  ST.exp = false; render();
}

function marketHtml() {
  // اللي اتبدّل بعدد أقراص تاني وبيتباع (rep) واللي اتعلّم «اتوقف/اتغير كوده» مستخبيين — زرار يظهرهم (26/10)
  const gone = m => (m.rep && m.rep.length) || (MDONE[m.c] && MDONE[m.c].res === 'stop');
  const nGone = MARKET.filter(gone).length;
  const list = MARKET.filter(m => !(ST.hide && MDONE[m.c]) && (ST.mgone || !gone(m)));
  return `<div class="banner mkb">🔍 <b>نواقص السوق — اسأل عليها</b>: رصيدها صفر ومتباعتش خالص آخر 90 يوم، بس كانت بتتباع كويس قبل كده.
      مش بتدخل الطلبية بكمية — اسأل عليها الموردين مرة في الأسبوع وسجّل النتيجة. مترتبة بقيمة البيع اللي ضايعة في الشهر.
      ${nGone ? `<br><label><input type="checkbox" id="mgone" ${ST.mgone ? 'checked' : ''}> اعرض اللي اتبدّل بكارتة تانية أو اتوقف (${nGone})</label>` : ''}</div>
    <div class="grp">${list.map(m => {
      const D = MDONE[m.c];
      return `<div class="row mrow ${D ? 'ok' : ''}"><div></div>
        <div><div class="nm">${esc(m.n)}</div>
          <div class="mt">كود ${m.c} · ${m.sh === 'supply' ? 'مستلزمات وتجميل' : 'أدوية'} · كان بيتباع ~${P(m.m)} علبة/شهر (${m.inv} فاتورة) · آخر بيع ${esc(m.last)}
            ${m.ls ? `<br>آخر شرا ${esc(m.lb)} من <b>${esc(m.ls)}</b>` : ''}
            ${m.rep ? `<br><span class="sib">🔁 اتبدّل بـ ${m.rep.map(esc).join('، ')} (بيتباع)</span>` : sibLine(m.sb)}
            ${!m.rep && m.may ? `<br><span class="sibs">❓ ممكن يكون اتبدّل بـ ${m.may.map(esc).join('، ')} — لو كده دوس ⛔</span>` : ''}
            ${D ? `<br><span class="by">${MRES[D.res] || ''} — ${esc(D.by || '')} ${esc(D.d || '')}</span>` : ''}
            ${canEdit() ? `<div class="mres">${Object.keys(MRES).map(k => `<button class="${D && D.res === k ? 'on' : ''}" data-mc="${m.c}" data-mr="${k}">${MRES[k]}</button>`).join('')}</div>` : ''}</div></div>
        <div class="need"><div class="v">${N(m.v)}</div><div class="l">ج/شهر</div></div></div>`;
    }).join('') || '<div class="banner">مفيش 🎉</div>'}</div>`;
}

async function markRes(code, res) {
  if (!canEdit()) return;
  const k = String(code), was = MDONE[k];
  if (was && was.res === res) delete MDONE[k];
  else MDONE[k] = { res, by: WHO, at: nowCairo(), d: new Date().toLocaleDateString('en-GB').slice(0, 5) };
  render();
  if (LOCAL) return;
  try {
    if (!MDONE[k]) await updateDoc(doc(DB, 'orders', 'market_done'), { ['t.' + k]: deleteField() });
    else await setDoc(doc(DB, 'orders', 'market_done'), { t: { [k]: MDONE[k] } }, { merge: true });
  } catch (e) { if (was) MDONE[k] = was; else delete MDONE[k]; render(); toast('متحفظش: ' + (e.code || e.message)); }
}

function render() {
  const all = ROWS.length, done = ROWS.filter(r => DONE[r.code]).length;
  const rows = ROWS.filter(r => r.sheet === ST.sheet);
  const animIn = ANIM_IN; ANIM_IN = false;
  const rs = {}; let gain = 0, gn = 0, gl = 0;
  ROWS.forEach(r => { const x = recvOf(r); if (!x) return; rs[x.st] = (rs[x.st] || 0) + 1; if (x.gain != null) { gain += x.gain; gn++; if (x.gain < 0) gl++; } });
  const keep = r => !(ST.hide && DONE[r.code]) && !(ST.miss && !['none', 'part', 'other'].includes((recvOf(r) || {}).st));
  // الموردين: الأكتر أصناف الأول، و"مورد مش محدد" في الآخر — نفس ترتيب الإكسل
  const g = {};
  rows.forEach(r => (g[r.sup] ||= []).push(r));
  const sups = Object.keys(g).sort((a, b) => (a === 'مورد مش محدد') - (b === 'مورد مش محدد') || g[b].length - g[a].length);
  const cnt = k => ROWS.filter(r => r.sheet === k).length, cntDone = k => ROWS.filter(r => r.sheet === k && DONE[r.code]).length;
  ROOT.innerHTML = `
    <div class="ohd"><h2>🛒 طلبية النواقص — ${esc(DATE.split('-').reverse().join('/'))}</h2>
      <div class="s">اتعملت من رصيد السيستم الساعة ${esc(AT)} · اتطلب <b>${done}</b> من ${all} صنف${canEdit() ? ' · علّم على اللي اتطلب، وفي الآخر دوس «حفظ الطلبية»' : ''}</div>
      ${ROWS.some(r => r.cust) ? `<div class="s">🧍 <b>${ROWS.filter(r => r.cust).length}</b> صنف عليه طلب عميل مستني (من شيت طلبات العملاء) — أول حاجة في كل مورد</div>` : ''}
      <div class="barw"><div class="bar"><i style="width:${all ? (100 * done / all).toFixed(1) : 0}%"></i></div><b>${all ? Math.round(100 * done / all) : 0}%</b></div>
      ${RECV ? `<div class="rsum">📦 اللي وصل لحد ${esc(RECV_TO.slice(11))} ${esc(RECV_TO.slice(8, 10) + '/' + RECV_TO.slice(5, 7))}${SAVED ? '' : ' <small>(الطلبية متحفظتش — بالعلامات)</small>'}:
        ${Object.keys(RC).map(k => `<span class="rc ${k}">${RC[k]} ${rs[k] || 0}</span>`).join(' ')}${rs.extra ? ` <span class="rc extra">📦 وصل من غير علامة ${rs.extra}</span>` : ''}
        ${gn ? `<br>💰 الخصم (${gn} صنف وصل): <span class="rc ${gain >= 0 ? 'ok' : 'none'}">${gain >= 0 ? 'كسبنا' : 'خسرنا'} ${N(Math.abs(gain))} ج عن المقترح</span> · ${gl} صنف اتشرى بخصم أقل` : ''}</div>` : ''}
      ${canEdit() && DATE === LATEST ? `<div class="rf"><button class="rfb" id="orf" ${rfBusy() ? 'disabled' : ''}>${rfBusy() ? '<span class="spin">🔄</span> بيتحدّث…' : '🔄 حدّث الطلبية دلوقتي'}</button>
        <button class="fxt" id="ofx" title="صوت وتشجيع">${FX_ON ? '🔔 مؤثرات' : '🔕 مؤثرات'}</button>
        <span class="rft">${rfText() || 'لو حاجة اتباعت أو نقصت: دوس يحسبها من الرصيد الحالي — علاماتك وتعديلاتك مش بتضيع'}</span></div>` : ''}
      ${LOCAL ? '' : `<div class="nav"><button data-day="-1">‹ طلبية اليوم اللي قبله</button>${DATE < LATEST ? '<button data-day="1">اليوم اللي بعده ›</button>' : ''}</div>`}</div>
    <div class="tabs2">${SHEETS.map(([k, t]) => `<button class="${ST.sheet === k ? 'on' : ''}" data-sh="${k}">${t} <small>(${cntDone(k)}/${cnt(k)})</small></button>`).join('')}
      ${MARKET.length ? `<button class="mk ${ST.sheet === 'market' ? 'on' : ''}" data-sh="market">🔍 نواقص السوق <small>(${MARKET.filter(m => MDONE[m.c] && !(m.rep && m.rep.length)).length}/${MARKET.filter(m => !(m.rep && m.rep.length)).length})</small></button>` : ''}
      <label><input type="checkbox" id="ohide" ${ST.hide ? 'checked' : ''}> خبّي اللي اتطلب</label>
      ${RECV ? `<label><input type="checkbox" id="omiss" ${ST.miss ? 'checked' : ''}> اللي موصلش أو فيه مشكلة بس</label>` : ''}
      ${canEdit() ? (() => { const u = unsaved(), ok = SAVED && !u;
        return `<button class="save ${ok ? 'ok' : ''}" id="osave" ${SAVING ? 'disabled' : ''}>${SAVING ? 'جاري الحفظ…' : ok ? '✔ الطلبية محفوظة' : SAVED ? `💾 حفظ التعديلات (${u})` : '💾 حفظ الطلبية'}</button>`; })() : ''}
      <button class="xbtn" id="oexp">📥 تصدير إكسل</button>
      ${ST.exp ? `<div class="xmenu"><button data-x="1">✔ اللي اتطلب (${done})</button><button data-x="0">✖ اللي متطلبش (${all - done})</button></div>` : ''}
      ${SAVED ? `<div class="savedat">آخر حفظ الساعة ${esc(SAVED.at)}${SAVED.by ? ' — ' + esc(SAVED.by) : ''} · ${SAVED.n} صنف</div>` : ''}</div>
    ${ST.sheet === 'market' ? marketHtml() : sups.map((s, i) => {
      const list = g[s], d = list.filter(r => DONE[r.code]).length, cost = list.reduce((a, r) => a + (r.cost || 0), 0);
      const shown = list.filter(keep).sort((a, b) => !!b.cust - !!a.cust);      // 🧍 طلب العميل الأول في المورد
      const closed = ST.open[s] === false;
      return `<div class="grp ${animIn ? 'ent' : ''}" style="animation-delay:${Math.min(i, 8) * 70}ms"><div class="gh" data-g="${esc(s)}" style="background:${GRP_COLORS[i % GRP_COLORS.length]}">
          <span>🏷️ ${esc(s)} <span class="n">— ${list.length} صنف · حوالي ${N(cost)} ج</span></span>
          <span>${d === list.length ? '<span class="done">✔ خلص</span>' : `<span class="n">${d}/${list.length}</span>`} ${closed ? '▸' : '▾'}</span></div>
        ${closed ? '' : shown.map(row).join('')}</div>`;
    }).join('') || '<div class="banner">مفيش نواقص في القسم ده 🎉</div>'}`;
  ROOT.querySelectorAll('[data-mr]').forEach(b => b.onclick = () => markRes(+b.dataset.mc, b.dataset.mr));
  if ($('#mgone', ROOT)) $('#mgone', ROOT).onchange = e => { ST.mgone = e.target.checked; render(); };
  ROOT.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ST.sheet = b.dataset.sh; ANIM_IN = true; render(); });
  if ($('#osave', ROOT)) $('#osave', ROOT).onclick = saveOrder;
  $('#oexp', ROOT).onclick = () => { ST.exp = !ST.exp; render(); };
  if ($('#orf', ROOT)) $('#orf', ROOT).onclick = requestRefresh;
  if ($('#ofx', ROOT)) $('#ofx', ROOT).onclick = toggleFx;
  welcomePop();
  ROOT.querySelectorAll('[data-x]').forEach(b => b.onclick = () => exportXl(b.dataset.x === '1'));
  $('#ohide', ROOT).onchange = e => { ST.hide = e.target.checked; render(); };
  if ($('#omiss', ROOT)) $('#omiss', ROOT).onchange = e => { ST.miss = e.target.checked; render(); };
  ROOT.querySelectorAll('[data-day]').forEach(b => b.onclick = async () => { if (await loadDate(shiftDay(DATE, +b.dataset.day))) render(); });
  ROOT.querySelectorAll('[data-g]').forEach(h => h.onclick = () => { const k = h.dataset.g; ST.open[k] = ST.open[k] === false; render(); });
  ROOT.querySelectorAll('[data-code]').forEach(b => b.onclick = () => tick(+b.dataset.code));
  ROOT.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { SPOPEN = +b.dataset.sp; render(); });
  ROOT.querySelectorAll('[data-spx]').forEach(b => b.onclick = () => { SPOPEN = null; render(); });
  ROOT.querySelectorAll('[data-sps]').forEach(s => s.onchange = () => {
    let v = s.value; if (!v) return;
    if (v === '__new') { v = (prompt('اسم المورد:') || '').trim(); if (!v) return; }
    SPOPEN = null; setOV(+s.dataset.sps, { sup: v });
  });
  ROOT.querySelectorAll('[data-nq]').forEach(i => i.onchange = () => {
    const v = Math.max(0, Math.round(+i.value || 0)); setOV(+i.dataset.nq, { need: v });
  });
}

function supSelect(r) {
  const [main, rest] = supList(), opt = s => `<option value="${esc(s)}" ${s === r.sup ? 'selected' : ''}>${esc(s)}${s === r._s0 ? ' (المقترح)' : ''}</option>`;
  return `<select class="sps" data-sps="${r.code}"><option value="">— اختار المورد —</option>
    <optgroup label="الموردين الرئيسيين">${main.map(opt).join('')}</optgroup>
    <optgroup label="موردين تانيين">${rest.map(opt).join('')}</optgroup>
    <option value="__new">✏️ مورد مش في القايمة…</option></select> <button class="spb" data-spx="1">إلغاء</button>`;
}

// 🧍 طلب عميل (27/10): السيرفر بيقرا شيت طلبات العملاء — صنف عليه طلب مفتوح ومش في الفرع (r.cust)، ولو مكانش في الطلبية بيتضاف (r.cadd)
const custTxt = r => `${r.cadd ? 'اتضاف علشان ' : ''}طلب عميل: ` + r.cust.map(c => `${c.n}${c.q && c.q !== '1' ? ' (' + c.q + ')' : ''} يوم ${c.t}${c.e ? ' — ' + c.e : ''}`).join('، ');
function row(r) {
  const D = DONE[r.code], R = recvOf(r), qq = n => String(Math.round(n * 100) / 100);
  const rc = !R ? '' : `<br><span class="rc ${R.st}">${R.st === 'extra' ? '📦 وصل من غير علامة' : RC[R.st]}${R.q > 0 ? ` — ${qq(R.q)}${R.need ? ' من ' + R.need : ''} من ${esc(R.sups.join('، '))}` : ''}</span>`
    + (R.gain == null ? '' : ` <span class="rc ${R.gain >= 0 ? 'ok' : 'none'}">خصم ${P(R.bd)}% بدل ${P(R.sd)}% (${R.gain >= 0 ? '+' : '−'}${N(Math.abs(R.gain))} ج)</span>`);
  return `<div class="row ${D ? 'ok' : ''} ${r.cust ? 'cu' : ''} ${LASTTICK === String(r.code) ? 'just' : ''}">
    <button class="chk ${D ? 'on' : ''} ${LASTTICK === String(r.code) ? 'pop' : ''}" data-code="${r.code}" ${canEdit() ? '' : 'disabled'} aria-label="تم الطلب">${D ? '✓' : ''}</button>
    <div><div class="nm">${esc(r.name)}</div>
      <div class="mt"><span class="abc ${r.abc}">${r.abc}</span>كود ${r.code} · الرصيد <span class="${r.oos ? 'oos' : ''}">${esc(r.stock)}</span>
        ${r.sup === r._s0 ? ` · خصم المورد ده <b class="sd">${P(r.sd)}%</b>` : ` · <span class="chg">🔄 اتطلب من ${esc(r.sup)} بدل ${esc(r._s0)} (خصمه كان ${P(r.sd)}%)</span>`}
        ${canEdit() ? (SPOPEN === r.code ? supSelect(r) : ` <button class="spb" data-sp="${r.code}">🔄 غيّر المورد</button>`) : ''}
        ${r.lsup ? `<br>آخر شرا ${esc(r.last)} من <span class="${r.gap != null ? 'yel' : ''}">${esc(r.lsup)} ${P(r.ld)}%</span>${r.gap != null ? ` <span class="yel">أقل بـ ${P(r.gap)}</span>` : ''}` : ''}
        ${r.up ? ' · <span class="up">⚠ السعر زاد</span>' : ''}${r.sea ? ' · <span class="sea">☀️ صيفي — بمعدل آخر 30 يوم</span>' : ''}
        ${r.pend ? `<br><span class="pend">⏳ اتطلب امبارح ولسه موصلش ${String(Math.round(r.pend * 100) / 100)} علبة${r.pend_sup ? ' من ' + esc(r.pend_sup) : ''} — ${r.need ? `اتخصموا: كان ${r.need0} بقى ${r.need}` : 'مستنيين يوصل، متطلبوش تاني'}</span>` : ''}
        ${r.kept ? '<br><span class="kept">📌 اتعلّم عليه قبل تحديث الطلبية — رصيده بقى كويس بعد اللي وصل</span>' : ''}
        ${r.pend_sib ? `<br><span class="sib">🔁 وصل بدله: ${r.pend_sib.map(s => esc(s[0]) + ' (' + String(Math.round(s[1] * 100) / 100) + ' علبة)').join('، ')} — اتأكد إن ده المقصود</span>` : ''}
        ${r.cust ? `<br><span class="cust">🧍 ${esc(custTxt(r))}${r.cust.some(c => c.m) ? ' · ❓ الاسم في الشيت مش زي السيستم — اتأكد' : ''}</span>` : ''}
        ${sibLine(r.sib)}
        ${D ? `<br><span class="by">✔ اتطلب${D.by ? ' — ' + esc(D.by) : ''}${D.at ? ' الساعة ' + esc(D.at) : ''}</span>` : ''}${rc}</div></div>
    <div class="need">${canEdit() ? `<input class="nq ${r.need !== r._n0 ? 'chgd' : ''}" type="number" min="0" step="1" inputmode="numeric" value="${r.need}" data-nq="${r.code}" aria-label="الكمية">`
      : `<div class="v">${r.need}</div>`}<div class="l">${r.need !== r._n0 ? `كان ${r._n0}` : r.pend && !r.need ? 'مستني' : 'علبة'}</div></div></div>`;
}

// ---- البحث بالصنف (24/10، طلب د. يحيى): أي صنف — التصنيف، الرصيد، يكفي كام يوم، آخر شرا، أحسن مورد، وأطلب ولا لأ.
// السيرفر بيكتب orders/catalog {date, at, parts} + orders/catalog_<i> (كل صنف اتباع آخر 90 يوم أو عليه رصيد) — نفس أرقام الطلبية.
let CAT = null, CAT_AT = '', CAT_LOADING = null;
const norm = t => String(t || '').toUpperCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
async function loadCat() {
  if (CAT || LOCAL) return;
  CAT_LOADING ||= (async () => {
    const m = await getDoc(doc(DB, 'orders', 'catalog'));
    if (!m.exists()) { CAT = []; return; }
    const parts = await Promise.all([...Array(m.data().parts || 0).keys()].map(i => getDoc(doc(DB, 'orders', 'catalog_' + i))));
    CAT = parts.flatMap(p => p.exists() ? JSON.parse(p.data().d || '[]') : []);
    CAT.forEach(x => x._n = norm(x.n));
    CAT_AT = `${m.data().date.split('-').reverse().join('/')} الساعة ${m.data().at}`;
  })();
  await CAT_LOADING;
}
function srchCss() {
  if ($('#srchCss')) return;
  const s = document.createElement('style'); s.id = 'srchCss';
  s.textContent = `
#ordRoot .srch{margin:0 0 14px}
#ordRoot .sbox{position:relative}
#ordRoot .sbox svg{position:absolute;inset-inline-start:18px;top:50%;transform:translateY(-50%);width:22px;height:22px;color:#1F2A44;pointer-events:none}
#ordRoot .srch input{width:100%;min-height:56px;margin:0;box-sizing:border-box;font-size:16.5px;font-weight:700;color:#1F2A44;
  background:linear-gradient(135deg,#FFE58A,#FFC83D);border:2px solid #F0A800;border-radius:99px;padding:12px 20px;padding-inline-start:54px;
  box-shadow:0 6px 18px -8px rgba(240,168,0,.7);transition:border-color .2s,box-shadow .2s}
#ordRoot .srch input::placeholder{color:#6B4E00;font-weight:600;opacity:1}
#ordRoot .srch input:focus{outline:none;border-color:#1F2A44;box-shadow:0 0 0 4px rgba(255,200,61,.45),0 6px 18px -8px rgba(240,168,0,.7)}
#ordRoot .sres{background:var(--card);border-radius:18px;box-shadow:var(--shadow);margin-top:8px;padding:4px 16px 6px;max-height:70vh;overflow:auto}
#ordRoot .sres:empty{display:none}
#ordRoot .sres .hint{font-size:12px;color:var(--muted);padding:8px 0}
#ordRoot .hit{border-top:1px solid var(--line);padding:12px 0}
#ordRoot .hint+.hit{border-top:0}
#ordRoot .hit .why{display:inline-block;margin-top:6px;border-radius:10px;padding:4px 10px;font-weight:800;font-size:13.5px;background:#EEF1F5;color:#344054}
#ordRoot .hit .why.go{background:#DCF5E3;color:#1B7F3B}#ordRoot .hit .why.out{background:#FDE2E1;color:#A32E1E}
#ordRoot .hit .cv{font-weight:800}`;
  document.head.appendChild(s);
}
// نفس الصنف بكارتة تانية (عدد أقراص/علبة مختلف) — 26/10، طلبه بعد BIOLEGAM 8TAB / 12TAB
function sibLine(sb) {
  return sb && sb.length ? `<br><span class="sibs">🔁 نفس الصنف بكارتة تانية: ${sb.map(s => `${esc(s[1])} <small>(كود ${s[0]} · رصيد ${esc(s[2])})</small>`).join(' · ')}</span>` : '';
}
function hit(x) {
  const cls = x.w.startsWith('🛒') ? 'go' : x.o ? 'out' : '';
  const D = DONE[x.c];
  return `<div class="hit"><div class="nm">${esc(x.n)}</div>
    <div class="mt">${x.a !== '-' ? `<span class="abc ${x.a}">${x.a}</span>` : ''}كود ${x.c}${x.k ? ' · ' + esc(x.k) : ''} · ${x.sh === 'supply' ? 'مستلزمات وتجميل' : 'أدوية'}
      <br>الرصيد <span class="${x.o ? 'oos' : ''}">${esc(x.st)}</span>${x.cv != null ? ` · يكفي <span class="cv">${x.cv} يوم</span>` : ''}${x.m ? ` · بيتباع ~${P(x.m)} علبة/شهر` : ''}${x.se ? ' · <span class="sea">☀️ صيفي</span>' : ''}
      <br>أحسن مورد: <b>${esc(x.s)}</b>${x.sd != null ? ` <b class="sd">${P(x.sd)}%</b>` : ''}
      ${x.ls ? `<br>آخر شرا ${esc(x.l)} من ${esc(x.ls)}${x.ld != null ? ' ' + P(x.ld) + '%' : ''}` : '<br>مفيش شرا آخر سنة'}
      ${sibLine(x.sb)}
      <br><span class="why ${cls}">${esc(x.w)}</span>${D ? ` <span class="by">✔ اتطلب${D.by ? ' — ' + esc(D.by) : ''}</span>` : ''}</div></div>`;
}
function mountSearch(box) {
  srchCss();
  box.className = 'srch';
  box.innerHTML = `<div class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="oq" type="search" placeholder="دوّر على صنف بالاسم أو الكود" autocomplete="off" aria-label="بحث بالصنف"></div><div class="sres" id="oqr"></div>`;
  const q = $('#oq', box), res = $('#oqr', box);
  let t;
  q.oninput = q.onkeyup = () => { clearTimeout(t); t = setTimeout(go, 200); };
  async function go() {
    const v = norm(q.value);
    if (v.length < 2) { res.innerHTML = ''; return; }
    if (!CAT) { res.innerHTML = '<div class="hint">جاري تحميل الأصناف…</div>'; try { await loadCat(); } catch (e) { res.innerHTML = `<div class="hint">مقدرتش أحمّل الأصناف: ${esc(e.code || e.message)}</div>`; CAT_LOADING = null; return; } }
    if (!CAT.length) { CAT = null; CAT_LOADING = null; res.innerHTML = '<div class="hint">الأصناف لسه مترفعتش</div>'; return; }
    const words = v.split(' ');
    const m = /^\d+$/.test(v) ? CAT.filter(x => String(x.c) === v) : [];
    const list = m.length ? m : CAT.filter(x => words.every(w => x._n.includes(w)))
      .sort((a, b) => (b.m || 0) - (a.m || 0));
    res.innerHTML = !list.length ? '<div class="hint">مفيش صنف بالاسم ده اتباع آخر 90 يوم أو عليه رصيد</div>'
      : `<div class="hint">${list.length} صنف · أرقام ${esc(CAT_AT)}</div>` + list.slice(0, 25).map(hit).join('')
        + (list.length > 25 ? `<div class="hint">و${list.length - 25} صنف كمان — اكتب أكتر علشان تقلل</div>` : '');
  }
}

export async function mountOrder(root, role, who) {
  ROLE = role; WHO = who || (role === 'admin' ? 'المدير' : 'المشتريات'); DB = getFirestore(getApp()); css(); root.id = 'ordRoot';
  root.innerHTML = '<div></div><div><div class="card"><p class="sub">جاري تحميل الطلبية…</p></div></div>';
  mountSearch(root.children[0]);
  ROOT = root.children[1];
  try {
    const L = await getDoc(doc(DB, 'orders', 'latest'));
    if (!L.exists()) { ROOT.innerHTML = '<div class="banner">لسه مفيش طلبية — ابعت للبوت «طلبية» وهتظهر هنا.</div>'; return; }
    LATEST = L.data().date; LATEST_AT = (L.data().at || '') + (L.data().ver ? ' · نسخة ' + L.data().ver : '');
    if (!(await loadDate(LATEST))) ROWS = [];
    watchRefresh();
    try {                                               // نواقص السوق — لو مش موجودة لسه التبويب مبيظهرش
      const m = await getDoc(doc(DB, 'orders', 'market'));
      MARKET = m.exists() ? JSON.parse(m.data().d || '[]') : [];
      if (MUNSUB) MUNSUB();
      MUNSUB = onSnapshot(doc(DB, 'orders', 'market_done'), s => { MDONE = (s.exists() && s.data().t) || {}; render(); }, () => {});
    } catch (e) {}
  } catch (e) {
    ROOT.innerHTML = `<div class="banner bad">مقدرتش أقرا الطلبية: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; return;
  }
  render();
}

// تجربة محلية (_crmtest/order.html) — من غير Firebase
export function mountOrderLocal(root, rows, role = 'admin', recv = null, cat = null, market = null) {
  MARKET = market || []; MDONE = {};
  LOCAL = true; ROLE = role; WHO = 'تجربة'; ROWS = rows; DATE = LATEST = '2026-10-23'; AT = '14:05'; DONE = {}; SAVED = null; OV = {}; applyOV();
  RECV = recv; RECV_TO = '2026-10-24 06:00'; css(); root.id = 'ordRoot';
  root.innerHTML = '<div></div><div></div>';
  CAT = cat || []; CAT.forEach(x => x._n = norm(x.n)); CAT_AT = '20/10 الساعة 06:00';
  mountSearch(root.children[0]); ROOT = root.children[1]; render();
}
