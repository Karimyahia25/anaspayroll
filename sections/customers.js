// قسم متابعة العملاء (21/10) — بيتحمّل أول ما تفتح تبويب "العملاء".
// القوايم بيحسبها سيرفر الصيدلية كل يوم 6 الصبح (الجرعة + عادة العميل) وبيكتبها في crm/meta + crm/list_N + crm/visits.
// (23/10، قرار د. يحيى) مفيش توزيع: كل موظف بيفتح القوايم من حسابه ويحط اسمه على العميل اللي هيتابعه ← crm_claim/{كود العميل}
// (فيه نسخة من الكارت). العميل اللي عليه اسم حد بيختفي من قوايم الباقيين 14 يوم.
// التواصل بيتسجل في crm_log. "اشترى" بيتعرف لوحده: فاتورة للعميل بعد يوم التواصل بـ 14 يوم أو أقل (من crm/visits).
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, collection, addDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { pickTip, tipText } from "./tips.js?v=4";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const M = n => N(n) + ' ج';
const D = s => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d}/${+m}`; };
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);       // تاريخ القاهرة
// 1 يوم · يومين · 3 أيام · 15 يوم
const days = n => n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوم`;
const nm = n => String(n).replace(/\*/g, '').replace(/\s+/g, ' ').trim();   // النجمة ملهاش معنى
const addDays = (s, n) => { const t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const LISTS = [['قرّب', '⏰ ميعاده قرّب', 'ابعتله قبل ما يخلص — ومعاه التوصيل في 30 دقيقة'],
               ['اتأخر', '⚠️ اتأخر', 'عدّى ميعاده ومجاش — يمكن جاب من برا أو نسي'],
               ['بعد', '💔 بعد عننا', 'مجاش خالص من أكتر من شهرين — رسالة الاسترجاع']];
const GRP = { lapsed: ['كان بيشتري وبطّل', '#8E5A2B'], med: ['دوا', '#0B8577'], diaper: ['حفاضات', '#2A6FB0'], milk: ['لبن أطفال', '#6B5BA8'], adult: ['كبار السن', '#7F8C8D'], cosmo: ['تجميل', '#C2417A'], soc: ['سوشيال', '#C2417A'], vit: ['فيتامينات', '#E08A00'] };
const RES = [['تم', '✅ اتكلمنا', 'ok'], ['بعتنا واتس', '💬 بعتنا واتس', 'wa'], ['مردش', '📵 مردش', 'nr'], ['مش مهتم', '🙅 مش مهتم', 'no']];   // (17/11، طلبه) «رقم غلط» اتشال، و«بعتنا واتس» اتضاف
const WINDOW = 14;            // اشترى خلال 14 يوم من التواصل = نجاح
const RETRY_NR = 2;           // مردش: يرجع يظهر بعد يومين

let ROOT, ROLE, DB = null, LOCAL = null, META = {}, CARDS = [], VIS = {}, LOG = [];
let ST = { tab: 'قرّب', q: '', grp: '', leak: false, deliv: false, hideDone: true, shown: 40 };
let H = null, HS = { q: '', sel: null, months: 0, shown: 60 };   // بحث بصنف
let CLAIM = {}, MY = { uid: '', name: '' };                    // مين حاطط اسمه على العميل {كود العميل: {uid, name, at, d}}
const LOG_DAYS = 35;           // سجل التواصل اللي بيتحمّل (الأقدم موجود في Firebase بس مبيتقراش)
const CLAIM_DAYS = 14;        // الاسم بيفضل على العميل 14 يوم وبعدها يرجع متاح للكل

/* ---------- ستايل ---------- */
function css() {
  if ($('#crmCss')) return;
  const s = document.createElement('style'); s.id = 'crmCss';
  s.textContent = `
#crmRoot .cbar{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px 0 12px;padding:8px;position:sticky;top:8px;z-index:4;border-radius:18px;background:linear-gradient(135deg,#0F1B2D,#0A6B60)}
#crmRoot .cbar::-webkit-scrollbar{display:none}
@media(max-width:899px){#crmRoot .cbar{top:58px}}
#crmRoot .cbar button{flex:0 0 auto;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 15px;font-size:13.5px;font-weight:700;min-height:44px}
#crmRoot .cbar button.on{background:#FFC83D;color:#10202E;border-color:transparent}
#crmRoot .cbar .n{display:inline-block;margin-inline-start:6px;background:rgba(0,0,0,.18);border-radius:99px;padding:1px 8px;font-size:12px}
#crmRoot .ck{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:12px}
#crmRoot .ck>div{background:var(--card);border-radius:16px;padding:12px 14px;box-shadow:var(--shadow);border-inline-start:4px solid var(--green)}
#crmRoot .ck .l{font-size:12px;color:var(--muted)}#crmRoot .ck .v{font-family:Alexandria,sans-serif;font-size:21px;font-weight:700}
#crmRoot .ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
#crmRoot .ctl input[type=search]{flex:1;min-width:180px}
#crmRoot .ctl.chips{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}#crmRoot .ctl.chips::-webkit-scrollbar{display:none}#crmRoot .ctl.chips>*{flex:0 0 auto}
#crmRoot .chip{display:inline-flex;align-items:center;gap:5px;min-height:40px;padding:6px 12px;border-radius:99px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:13px;cursor:pointer;font-weight:600}
#crmRoot .chip.on{background:var(--green);color:var(--on-green);border-color:var(--green)}
#crmRoot .chip input{width:auto;margin:0}
#crmRoot .cc{background:var(--card);border-radius:18px;padding:14px;margin-bottom:10px;box-shadow:var(--shadow);border-inline-start:5px solid var(--g,#0B8577)}
#crmRoot .cc.done{opacity:.62}
#crmRoot .cc .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}
#crmRoot .cc h4{margin:0;font-size:16px}
#crmRoot .cc .meta{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.7}
#crmRoot .cc .when{font-size:14.5px;font-weight:700;color:var(--ink);margin-top:6px}
#crmRoot .cc .val{font-family:Alexandria,sans-serif;font-weight:700;font-size:15px;white-space:nowrap}
#crmRoot .bd{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:700;color:#fff;margin-inline-end:4px}
#crmRoot .bd.lk{background:#B0761F}#crmRoot .bd.dl{background:#2A6FB0}#crmRoot .bd.ok{background:#1B7F3B}
#crmRoot .its{margin:10px 0 8px;padding:0;list-style:none;font-size:13.5px;line-height:1.8}
#crmRoot .its li{border-top:1px dashed var(--line);padding:3px 0;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
#crmRoot .its .s{color:var(--muted);font-size:12px}
#crmRoot .ph{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
#crmRoot .cupd{font-size:13px;font-weight:700;padding:7px 12px;border-radius:12px;background:var(--green-soft);color:var(--green-deep);white-space:nowrap}
#crmRoot .cupd.old{background:#FDECEA;color:#A32E1E}
#crmRoot .addr{font-size:13px;font-weight:600;margin-top:3px;color:var(--ink);line-height:1.6}
#crmRoot .ph{align-items:center}
#crmRoot .ph .cpn{min-height:44px;min-width:44px;padding:6px 10px;border-radius:10px;font-size:16px;background:var(--card);color:var(--green-deep);border:1px solid var(--line);margin-inline-start:-2px}
#crmRoot .ph a{display:inline-flex;align-items:center;min-height:44px;padding:6px 14px;border-radius:10px;background:var(--green-soft);color:var(--green-deep);font-weight:700;text-decoration:none;direction:ltr}
#crmRoot .act{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
#crmRoot .act button{min-height:44px;font-size:13.5px;padding:8px 12px}
#crmRoot .act button.r-wa{background:#128C7E}#crmRoot .act button.r-ok{background:#1B7F3B}#crmRoot .act button.r-nr{background:#B0761F}#crmRoot .act button.r-no{background:#7F8C8D}#crmRoot .act button.r-bad{background:#A32E1E}
#crmRoot .last{font-size:12.5px;margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--paper)}
#crmRoot .last.win{background:color-mix(in srgb,#1B7F3B 14%,var(--card));color:var(--ink);font-weight:600}
#crmRoot details.msg{margin-top:6px}#crmRoot details.msg summary{cursor:pointer;color:var(--green);font-size:13px;font-weight:700}
#crmRoot details.msg pre{white-space:pre-wrap;font-family:inherit;font-size:13px;background:var(--paper);padding:10px;border-radius:10px;margin:6px 0 0;line-height:1.8}
#crmRoot #crefresh{min-height:44px;padding:8px 14px;font-weight:700}#crmRoot #crefresh:disabled{opacity:.6}
#crmRoot .tip{margin-top:8px;padding:9px 11px;border-radius:10px;background:var(--green-soft);color:var(--green-deep);font-size:13px;line-height:1.8}
#crmRoot .more{display:block;margin:12px auto;min-width:200px}
#crmRoot .why{font-size:13px;color:var(--muted);margin:0 0 10px;line-height:1.7}
#crmRoot table{width:100%;border-collapse:collapse;font-size:13px}#crmRoot th,#crmRoot td{padding:8px;border-top:1px solid var(--line);text-align:right}
#crmRoot th{color:var(--muted);font-size:12px}
#crmRoot .tw{overflow-x:auto}
#crmRoot .hc{background:var(--card);border-radius:18px;padding:14px;margin-bottom:10px;box-shadow:var(--shadow)}
#crmRoot .hr{border-top:1px solid var(--line);padding:10px 0}#crmRoot .hr:first-child{border-top:0}
#crmRoot .hn{font-weight:700;font-size:15px}#crmRoot .hs{font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.7}
#crmRoot .asg{margin-top:8px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}#crmRoot .asg select{width:auto;min-height:40px;padding:6px 10px}
#crmRoot .bulk{background:var(--card);border-radius:14px;padding:10px;box-shadow:var(--shadow);font-size:13.5px}#crmRoot .bulk select{width:auto;min-height:40px;padding:6px 10px}
#crmRoot .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0F1B2D;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
`;
  document.head.appendChild(s);
}

/* ---------- بيانات ---------- */
async function load() {
  if (LOCAL) { ({ meta: META, cards: CARDS, visits: VIS, log: LOG } = LOCAL); dropSocial(); return true; }
  const m = await getDoc(doc(DB, 'crm', 'meta'));
  if (!m.exists()) return false;
  META = JSON.parse(m.data().d); const n = m.data().chunks; CARDS = [];
  for (let i = 0; i < n; i++) { const c = await getDoc(doc(DB, 'crm', 'list_' + i)); if (c.exists()) CARDS.push(...JSON.parse(c.data().d)); }
  const v = await getDoc(doc(DB, 'crm', 'visits')); VIS = v.exists() ? JSON.parse(v.data().d) : {};
  LOG = ROLE === 'emp' && !MY.dev                          // الموظف بيقرا تسجيلاته هو بس (القواعد) — الجهاز المشترك بيقرا الكل
    ? (await getDocs(query(collection(DB, 'crm_log'), where('by', '==', MY.uid)))).docs.map(d => ({ _id: d.id, ...d.data() }))
    /* (9/11) آخر LOG_DAYS بس — الحسابات كلها محتاجة 30 يوم بالكتير، والقراية الكاملة كانت بتكبر كل يوم (حد Firebase المجاني) */
    : (await getDocs(query(collection(DB, 'crm_log'), where('day', '>=', addDays(today(), -LOG_DAYS))))).docs.map(d => ({ _id: d.id, ...d.data() }));
  CLAIM = {}; (await getDocs(query(collection(DB, 'crm_claim'), where('at', '>=', addDays(today(), -CLAIM_DAYS))))).docs.forEach(d => { CLAIM[d.id] = d.data(); });
  dropSocial();
  return true;
}
// (12/11، قراره) عملاء السوشيال في تبويبهم بس — بيتشالوا من كل القوايم التانية (قرّب/اتأخر/بعد عننا). الأرقام اللي فوق بتتحسب من اللي فاضل.
let SOCREM = [];
function dropSocial() { SOCREM = CARDS.filter(c => SOC_RX.test(c.name || '')); CARDS = CARDS.filter(c => !SOC_RX.test(c.name || '')); }
// مين حاطط اسمه على العميل ده (آخر 14 يوم)
function owner(id) {
  const c = CLAIM[id];
  return c && c.at >= addDays(today(), -CLAIM_DAYS) ? c : null;
}
// الجهاز المشترك (crm): uid واحد للكل فالملكية بالاسم؛ حساب الموظف الفردي بالـ uid
const isMe = o => !!o && (MY.dev ? o.name === MY.name : o.uid === MY.uid);
const mine = id => isMe(owner(id));
const SNAP = ['id', 'name', 'phones', 'status', 'grp', 'items', 'due', 'late', 'visit', 'leak', 'monthly', 'deliv', 'area', 'msg', 'camp', 'last', 'v90', 'tk'];
async function claim(id) {
  const c = cardFor(id), snap = {}; SNAP.forEach(k => { if (c[k] !== undefined) snap[k] = c[k]; });
  const rec = { uid: MY.uid, name: MY.name, at: today(), d: JSON.stringify(snap) };
  if (!LOCAL) await setDoc(doc(DB, 'crm_claim', String(id)), { ...rec, ts: serverTimestamp() });
  CLAIM[id] = rec;
}
async function unclaim(id) {
  if (!LOCAL) await deleteDoc(doc(DB, 'crm_claim', String(id)));
  delete CLAIM[id];
}
async function saveLog(rec) {
  if (LOCAL) { rec._id = 'L' + Date.now(); LOG.push(rec); return; }
  const r = await addDoc(collection(DB, 'crm_log'), rec); rec._id = r.id; LOG.push(rec);
}
async function delLog(id) {
  if (!LOCAL) await deleteDoc(doc(DB, 'crm_log', id));
  LOG = LOG.filter(x => x._id !== id);
}

// علامة d/D في اسم العميل = ليه خصم عندنا (مش متسجل في السيستم، في الاسم بس): "علاء d" · "D MANAR" · "*Dايمان"
const hasDisc = n => /(^|[^A-Za-zء-ي])[dD](?![A-Za-z])/.test(n) || /^\*?\s*[dD](?=[ء-ي])/.test(n);
const logsOf = id => LOG.filter(x => x.cust === id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
// اشترى بعد التواصل: أول فاتورة من يوم التواصل لحد 14 يوم بعده
function boughtAfter(rec) {
  const v = VIS[String(rec.cust)] || [], end = addDays(rec.day, WINDOW);
  const hit = v.filter(([d]) => d >= rec.day && d <= end);
  return hit.length ? { day: hit[0][0], amt: hit.reduce((a, x) => a + x[1], 0) } : null;
}
function contactedRecently(c) {
  const L = logsOf(c.id)[0]; if (!L) return false;
  if (L.result === 'مردش') return L.day > addDays(today(), -RETRY_NR);
  return L.day > addDays(today(), -WINDOW);
}

/* ---------- عرض ---------- */
function shell() {
  ROOT.innerHTML = `
  <div class="card" style="margin-bottom:12px"><div class="hdr" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
    <div><h2 style="margin:0">متابعة العملاء</h2><p class="sub" id="cmeta" style="margin:4px 0 0"></p></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div id="cupd" class="cupd"></div>
      ${ROLE === 'admin' || ROLE === 'emp' ? '<button type="button" class="ghost" id="crefresh">🔄 تحديث</button>' : ''}</div>
    <div class="meta" id="cstat" style="width:100%;margin-top:6px">يتحدّث لوحده الساعة 12 ظهراً · 5 مساءً · 8 مساءً${ROLE === 'admin' || ROLE === 'emp' ? ' — أو دوس «تحديث» لو عايز أحدث أرقام (بياخد ~5 دقايق).' : '.'}</div>
  </div></div>
  <div class="ck" id="ckpi"></div>
  <div class="cbar" id="cbar"></div>
  <div id="cbody"></div>`;
}
function kpis() {
  if (ROLE === 'emp') {                                   // عدّاد الموظف: تسجيلاته هو بس — كلّم كام عميل (النهارده / 7 / 30 يوم)
    const mineLog = LOG.filter(x => x.byName === MY.name), cnt = d => new Set(results(d, mineLog).recs.map(x => x.cust)).size;
    const R7 = results(7, mineLog), ok7 = R7.recs.filter(x => x.result === 'تم').length;
    $('#ckpi', ROOT).innerHTML = `
      <div><div class="l">كلّمت النهارده</div><div class="v">${N(cnt(0))}</div><div class="l">عميل</div></div>
      <div><div class="l">آخر 7 أيام</div><div class="v">${N(cnt(7))}</div><div class="l">عميل · اتكلمت مع ${N(ok7)}</div></div>
      <div><div class="l">آخر 30 يوم</div><div class="v">${N(cnt(30))}</div><div class="l">عميل</div></div>
      <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد ما كلّمتهم (7 أيام)</div><div class="v">${N(R7.won.length)}</div><div class="l">${M(R7.rev)}</div></div>`;
    $('#cmeta', ROOT).textContent = `حط اسمك على العميل اللي هتكلمه — بيختفي من قوايم زمايلك ${CLAIM_DAYS} يوم.`; return; }
  // الأرقام من القوايم اللي فاضلة بعد فصل السوشيال (مش من ملخص السيرفر)
  const n = {}, v = {}, wk = results(7);
  for (const c of CARDS) { n[c.status] = (n[c.status] || 0) + 1; v[c.status] = (v[c.status] || 0) + (c.monthly || 0); }
  const tracked = (META.tracked || 0) - SOCREM.filter(c => c.status !== 'بعد').length;
  $('#ckpi', ROOT).innerHTML = `
    <div><div class="l">عملاء متابعين</div><div class="v">${N(tracked)}</div></div>
    <div style="border-color:#2A6FB0"><div class="l">ميعادهم قرّب</div><div class="v">${N(n['قرّب'])}</div><div class="l">${M(v['قرّب'])}/شهر</div></div>
    <div style="border-color:#B0761F"><div class="l">اتأخروا</div><div class="v">${N(n['اتأخر'])}</div><div class="l">${M(v['اتأخر'])}/شهر</div></div>
    <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد التواصل (7 أيام)</div><div class="v">${N(wk.won.length)}</div><div class="l">${M(wk.rev)}</div></div>`;
  $('#cmeta', ROOT).textContent = `آخر تحديث من السيرفر: ${META.at || '—'} · الأرقام على مشتريات لحد ${D(META.ref)}`;
}
const campBtns = () => `<button class="${ST.tab === 'baby' ? 'on' : ''}" data-tab="baby">🍼 حفاضات ولبن</button><button class="${ST.tab === 'soc' ? 'on' : ''}" data-tab="soc">📣 عملاء السوشيال</button><button class="${ST.tab === 'vit' ? 'on' : ''}" data-tab="vit">💊 فيتامينات</button>`;
function bar() {
  const cnt = s => CARDS.filter(c => c.status === s && !(ST.hideDone && contactedRecently(c)) && !(ROLE === 'emp' && owner(c.id))).length;
  if (ROLE === 'emp') {
    const n = myCards().filter(c => !contactedRecently(c)).length;
    $('#cbar', ROOT).innerHTML = `<button class="${ST.tab === 'mine' ? 'on' : ''}" data-tab="mine">👤 عملائي<span class="n">${n}</span></button>`
      + LISTS.map(([k, t]) => `<button class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${t}<span class="n">${cnt(k)}</span></button>`).join('')
      + campBtns() + `<button class="${ST.tab === 'find' ? 'on' : ''}" data-tab="find">🔎 بحث بصنف</button>`;
    $('#cbar', ROOT).querySelectorAll('button').forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.shown = 40; render(); });
    return;
  }
  $('#cbar', ROOT).innerHTML = LISTS.map(([k, t]) => `<button class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${t}<span class="n">${cnt(k)}</span></button>`).join('')
    + campBtns()
    + `<button class="${ST.tab === 'find' ? 'on' : ''}" data-tab="find">🔎 بحث بصنف</button>`
    + `<button class="${ST.tab === 'res' ? 'on' : ''}" data-tab="res">📈 النتايج</button>`
    + `<button class="${ST.tab === 'log' ? 'on' : ''}" data-tab="log">🗂️ سجل التواصل<span class="n">${LOG.length}</span></button>`;
  $('#cbar', ROOT).querySelectorAll('button').forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.shown = 40; render(); });
}
function filtered() {
  const q = ST.q.trim().toLowerCase();
  return CARDS.filter(c => c.status === ST.tab
    && !(ROLE === 'emp' && owner(c.id))                   // الموظف: اللي عليه اسم (بتاعه أو بتاع زميله) مش في القايمة
    && (!ST.grp || c.grp.includes(ST.grp))
    && !(ST.hideDone && contactedRecently(c))
    && (!q || c.name.toLowerCase().includes(q) || c.phones.join(' ').includes(q) || c.items.some(i => String(i[0]).toLowerCase().includes(q))));
}
// (12/11، طلبه) «ا/» قبل اسم العميل في كل الرسايل. رسايل القوايم الأساسية جاية جاهزة من السيرفر فبنظبطها هنا؛
// اللي اسمه دكتور/د. أو فيه «ا/» أصلاً أو «حضرتك» (من غير اسم) بيتساب زي ما هو.
const msgOf = c => socFix(c, String(c.msg || '')
  .replace(/^(أهلاً)\s+(?!ا\/|حضرتك|د[./\s]|دكتور|dr\b)/i, '$1 ا/ ')
  .replace(/^(السلام عليكم ورحمة الله)\s+(?!ا\/|حضرتك|د[./\s]|دكتور|dr\b)/i, '$1 ا/ '));
/* (17/11، طلبه) أي رسالة لعميل «سوشيال»: سطر الخصم بخط عريض في أول الرسالة + لينك الموقع (www). بيتظبط هنا علشان يغطي كمان الكروت المحجوزة قبل كده. */
const SOC_LINE = '*🔥 يوجد خصومات على العلاج الشهري تصل لـ 15% 🔥*';
function socFix(c, m) {
  if (!SOC_RX.test(c.name || '')) return m;
  if (!m.includes('15%')) { const L = m.split('\n'); L.splice(Math.min(1, L.length), 0, SOC_LINE); m = L.join('\n'); }
  m = m.replace(/(?<!www\.)anasnehila\.com/g, 'www.anasnehila.com');
  return /anasnehila\.com/.test(m) ? m : m + '\n🌐 www.anasnehila.com';
}
const greetA = n => { const g = greet(n); return g === 'حضرتك' ? g : (/^(ا\/|د[./\s]|دكتور|dr\b)/i.test(g) ? g : 'ا/ ' + g); };
/* (17/11، طلبه) النصيحة في أي تبويب ومع أي عميل بيشتري حفاضات / لبن / فيتامينات (من مجموعات الكارت وأصنافه، أو من مشترياته لو كارت حملة) */
function tkFromCard(c) {
  const g = c.grp || [], names = (c.items || []).map(i => String(i[0]));
  return (g.includes('diaper') ? 'd' : '') + (g.includes('milk') ? 'm' : '') + (names.some(n => VIT_RX.test(n)) ? 'v' : '');
}
const tkOf = c => c.tk || tkFromCard(c);
function tkOfCust(id) {
  histIndex(); const lim = addDays(today(), -365); let d = '', m = '', v = '';
  for (const x of BYC[id] || []) { if (x[1] < lim) continue; if (x[2] === 'd') d = 'd'; if (x[2] === 'm') m = 'm'; if (VIT_RX.test(x[0])) v = 'v'; }
  return d + m + v;
}
function card(c) {
  const g = GRP[c.grp[0]] || GRP.med, L = logsOf(c.id)[0], won = L && boughtAfter(L), edit = ROLE === 'admin' || ROLE === 'emp';
  const ow = owner(c.id), me = ROLE === 'emp' && isMe(ow);
  const when = c.camp ? `🛒 آخر ${c.camp === 'soc' ? 'زيارة' : 'شراء'} من ${days(ago(c.last))}` : c.status === 'قرّب' ? (c.late === 0 ? '⏰ محتاج يشتري النهارده' : `⏰ محتاج يشتري بعد ${days(-c.late)}`)
             : c.status === 'اتأخر' ? `⚠️ كان المفروض يشتري من ${days(c.late)}` : `💔 مجاش الصيدلية من ${days(c.visit || c.late)}`;
  const seen = c.visit == null ? '' : c.visit === 0 ? '🛒 جه الصيدلية النهارده' : `🛒 آخر مرة جه الصيدلية: من ${days(c.visit)}`;
  const its = c.items.map(([lb, ev, src, dose, due, lk]) => ev == null ? `<li><span>${esc(lb)}</span><span class="s">${esc(src)} · آخر مرة ${String(due).slice(0, 10).split('-').reverse().map(Number).join('/')}</span></li>` : `<li><span>${esc(lb)}${lk ? ' <span class="bd lk">من برا؟</span>' : ''}</span>
      <span class="s">كل ${ev} يوم (${esc(src)})${src === 'عادته' && dose ? ` · الجرعة ${dose}` : ''} · <b>يخلص حوالي ${D(due)}</b></span></li>`).join('');
  const last = L ? `<div class="last ${won ? 'win' : ''}">${won ? `✅ اشترى بعد التواصل: ${M(won.amt)} يوم ${D(won.day)} — ` : ''}
      آخر تواصل: ${esc(L.result)} يوم ${D(L.day)}${L.byName ? ' (' + esc(L.byName) + ')' : ''}${L.note ? ' — ' + esc(L.note) : ''}</div>` : '';
  return `<div class="cc ${contactedRecently(c) ? 'done' : ''}" style="--g:${g[1]}" data-id="${c.id}">
    <div class="top"><div><h4>${esc(nm(c.name))}</h4>
      <div class="meta">${c.grp.map(x => `<span class="bd" style="background:${(GRP[x] || GRP.med)[1]}">${(GRP[x] || GRP.med)[0]}</span>`).join('')}
        ${c.deliv ? '<span class="bd dl">عميل توصيل</span>' : ''}${hasDisc(c.name) ? '<span class="bd" style="background:#C2417A">عميل خصم</span>' : ''}${c.leak ? '<span class="bd lk">غالباً بيجيب جزء من برا</span>' : ''}
        <div class="when">${when}</div>${c.status !== 'بعد' && seen ? `<div>${seen}</div>` : ''}${c.area && c.area !== 'مش متسجل' ? `<div>📍 ${esc(c.area)}</div>` : ''}</div></div>
      ${c.camp ? (c.v90 ? `<div class="val">${M(c.v90)}<div class="meta" style="text-align:left">آخر 90 يوم</div></div>` : '')
        : `<div class="val">${M(c.monthly)}<div class="meta" style="text-align:left">${c.grp[0] === 'lapsed' ? 'كان بيدفع في الشهر' : 'في الشهر'}</div></div>`}</div>
    <ul class="its">${its}</ul>
    <div class="ph">${c.phones.length ? c.phones.map(phBtn).join('') : '<span class="meta">مفيش رقم متسجل</span>'}</div>
    <details class="msg"><summary>الرسالة</summary><pre>${esc(msgOf(c))}</pre>${tkOf(c) ? (x => `<div class="tip">${esc(x.t)}<br><b>❓ ${esc(x.q)}</b></div>`)(pickTip(c.id, tkOf(c))) : ''}</details>
    <div class="act"><button class="ghost" data-copy="${c.id}">📋 نسخ الرسالة</button>
      ${tkOf(c) ? `<button class="ghost" data-tip="${c.id}">💡 نسخ النصيحة</button>` : ''}
      ${ROLE === 'emp' && !ow ? `<button data-claim="${c.id}">✋ أنا هتابعه</button>` : ''}
      ${edit && (ROLE !== 'emp' || me) ? RES.map(([k, t, cl]) => `<button class="r-${cl}" data-res="${k}" data-id="${c.id}">${t}</button>`).join('') : ''}</div>
    ${ow ? `<div class="asg">👤 ${me ? 'معاك' : `مع <b>${esc(ow.name)}</b>`} من ${ow.at === today() ? 'النهارده' : D(ow.at)}
        ${ROLE === 'admin' || me ? `<button class="ghost sm" data-unclaim="${c.id}">${me ? 'سيبه لحد تاني' : 'شيل الاسم'}</button>` : ''}</div>` : ''}
    ${last}</div>`;
}
function listView() {
  const L = LISTS.find(x => x[0] === ST.tab), rows = filtered();
  const grps = Object.entries(GRP).map(([k, [t]]) => `<button class="chip ${ST.grp === k ? 'on' : ''}" data-grp="${k}">${t}</button>`).join('');
  $('#cbody', ROOT).innerHTML = `<p class="why"><b>${L[1]}</b> — ${L[2]}. مترتبين بقيمة العميل في الشهر.</p>
    <div class="ctl"><input type="search" id="cq" placeholder="دوّر في القايمة دي: اسم العميل أو التليفون أو الصنف" value="${esc(ST.q)}"></div>
    <div class="ctl chips"><button class="chip ${!ST.grp ? 'on' : ''}" data-grp="">الكل</button>${grps}</div>
    <div id="clist">${rows.slice(0, ST.shown).map(card).join('') || '<div class="banner">مفيش حد في القايمة دي بالفلاتر دي.</div>'}</div>
    ${rows.length > ST.shown ? `<button class="ghost more" id="cmore">عرض المزيد (${rows.length - ST.shown})</button>` : ''}`;
  const b = $('#cbody', ROOT);
  $('#cq', b).oninput = e => { ST.q = e.target.value; ST.shown = 40; const p = e.target.selectionStart; listView(); const i = $('#cq', ROOT); i.focus(); i.setSelectionRange(p, p); };
  b.querySelectorAll('[data-grp]').forEach(x => x.onclick = () => { ST.grp = x.dataset.grp; ST.shown = 40; listView(); });
  if ($('#cmore', b)) $('#cmore', b).onclick = () => { ST.shown += 40; listView(); };
  hooks(b);
}
// رقم التليفون + زرار نسخ جنبه
const phBtn = p => `<a href="tel:${p}">📞 ${p}</a><button type="button" class="ghost cpn" data-cpn="${p}" aria-label="نسخ الرقم" title="نسخ الرقم">📋</button>`;
const wireCpn = b => b.querySelectorAll('[data-cpn]').forEach(x => x.onclick = () => copy(x.dataset.cpn, 'الرقم اتنسخ ✓'));
// أزرار الكارت (القوايم + عملائي)
function hooks(b) {
  b.querySelectorAll('[data-copy]').forEach(x => x.onclick = () => copy(msgOf(cardFor(+x.dataset.copy))));
  b.querySelectorAll('[data-tip]').forEach(x => x.onclick = () => { const c = cardFor(+x.dataset.tip); copy(tipText(c.id, tkOf(c)), 'النصيحة اتنسخت ✓'); });
  // على الكمبيوتر مفيش تليفون يتصل: الدوسة على الرقم بتنسخه بدل ما تفتح برنامج اتصال
  if (!matchMedia('(pointer:coarse)').matches) b.querySelectorAll('.ph a').forEach(x => x.onclick = e => { e.preventDefault(); copy(x.href.replace('tel:', ''), 'الرقم اتنسخ ✓'); });
  wireCpn(b);
  b.querySelectorAll('[data-res]').forEach(x => x.onclick = () => record(+x.dataset.id, x.dataset.res, x));
  b.querySelectorAll('[data-claim]').forEach(x => x.onclick = async () => {
    x.disabled = true;
    try { await claim(+x.dataset.claim); toast('العميل ده بقى معاك ✓ — تلاقيه في «عملائي»'); render(); }
    catch (e) { x.disabled = false; toast(e.code === 'permission-denied' ? 'زميلك سبقك عليه' : 'متسجلش: ' + (e.code || e.message)); }
  });
  b.querySelectorAll('[data-unclaim]').forEach(x => x.onclick = async () => {
    try { await unclaim(+x.dataset.unclaim); toast('اتشال الاسم'); render(); } catch (e) { toast('متشالش: ' + (e.code || e.message)); }
  });
}
// الكارت من قايمة النهارده، ولو العميل خرج منها: النسخة اللي اتحفظت لما الموظف حط اسمه
const CUSTOM = {};                                        // كروت تبويبات الحملات (حفاضات ولبن / سوشيال) — مش في القوايم اليومية
const cardFor = id => ((ST.tab === 'baby' || ST.tab === 'soc' || ST.tab === 'vit') && CUSTOM[id]) || cardOf(id);
const cardOf = id => CARDS.find(c => c.id === id) || (CLAIM[id] && CLAIM[id].d ? JSON.parse(CLAIM[id].d) : null);
function myCards() {
  return Object.keys(CLAIM).filter(id => mine(+id)).map(id => cardOf(+id)).filter(Boolean);
}
function mineView() {
  const all = myCards(), todo = all.filter(c => !contactedRecently(c)).sort((a, b) => String(a.due).localeCompare(String(b.due))), fin = all.filter(c => contactedRecently(c));
  $('#cbody', ROOT).innerHTML = `<p class="why">${all.length ? `فاضل <b>${todo.length}</b> من ${all.length} · ابعت الرسالة واتصل، وبعدين دوس النتيجة` : 'لسه محطتش اسمك على حد — افتح «ميعاده قرّب» أو «اتأخر» أو «بعد عننا» ودوس «✋ أنا هتابعه».'}</p>
    <div id="clist">${todo.map(card).join('')}${fin.length ? `<h3 style="margin:16px 4px 8px">خلصتهم (${fin.length})</h3>${fin.map(card).join('')}` : ''}</div>`;
  hooks($('#cbody', ROOT));
}
async function record(id, result, btn) {
  const c = cardFor(id); let note = '';
  if (result === 'تم') note = (prompt('ملاحظة (اختياري) — مثلاً: هيعدّي بكرة / عايز توصيل', '') || '').trim();
  const me = LOCAL ? { uid: 'local' } : getAuth(getApp()).currentUser;
  const rec = { cust: id, name: c.name, result, note, list: c.status, monthly: c.monthly, day: today(), at: new Date().toISOString(),
                by: me.uid, byName: ROLE === 'emp' ? MY.name : 'مدير الفرع' };
  btn.disabled = true;
  try { await saveLog(rec); toast('اتسجّل: ' + result); render(); }
  catch (e) { btn.disabled = false; toast('متسجلش: ' + (e.code || e.message)); }
}
function results(days, src = LOG) {
  const from = addDays(today(), -days), recs = src.filter(x => x.day >= from);
  const won = [], seen = new Set();
  for (const r of recs.filter(x => x.result === 'تم' || x.result === 'بعتنا واتس').sort((a, b) => a.day.localeCompare(b.day))) {
    if (seen.has(r.cust)) continue; const w = boughtAfter(r); if (w) { won.push({ ...r, w }); seen.add(r.cust); }
  }
  return { recs, won, rev: won.reduce((a, x) => a + x.w.amt, 0) };
}
function resView() {
  const blocks = [7, 30].map(d => {
    const R = results(d), by = k => R.recs.filter(x => x.result === k).length;
    return `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">آخر ${d} يوم</h3>
      <div class="ck"><div><div class="l">تواصل</div><div class="v">${N(R.recs.length)}</div><div class="l">اتكلمنا ${by('تم')} · واتس ${by('بعتنا واتس')} · مردش ${by('مردش')} · مش مهتم ${by('مش مهتم')}</div></div>
        <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد التواصل</div><div class="v">${N(R.won.length)}</div><div class="l">من ${by('تم') + by('بعتنا واتس')} اتكلمنا/بعتنا لهم</div></div>
        <div style="border-color:#1B7F3B"><div class="l">مبيعاتهم بعد التواصل</div><div class="v">${M(R.rev)}</div><div class="l">خلال ${WINDOW} يوم من المكالمة</div></div></div>
      ${R.won.length ? `<div class="tw"><table><tr><th>العميل</th><th>اتكلمنا</th><th>اشترى</th><th>بكام</th><th>القايمة</th></tr>
        ${R.won.map(x => `<tr><td>${esc(x.name)}</td><td>${D(x.day)}</td><td>${D(x.w.day)}</td><td>${M(x.w.amt)}</td><td>${esc(x.list)}</td></tr>`).join('')}</table></div>` : ''}</div>`;
  }).join('');
  // (12/11، طلبه) تقرير كل موظف: كلّم كام عميل النهارده / 7 / 30 يوم (عملاء مختلفين) + اشتروا بعدها
  const R30 = results(30), people = {};
  const P = k => people[k] || (people[k] = { d0: new Set(), d7: new Set(), d30: new Set(), ok: 0, won: 0, rev: 0 });
  const t0 = today(), t7 = addDays(t0, -7);
  for (const r of R30.recs) {
    const p = P(r.byName || '—'); p.d30.add(r.cust); if (r.day >= t7) p.d7.add(r.cust); if (r.day >= t0) p.d0.add(r.cust);
    if (r.result === 'تم') p.ok++;
  }
  for (const w of R30.won) { const p = people[w.byName || '—']; if (p) { p.won++; p.rev += w.w.amt; } }
  const byEmp = Object.keys(people).length ? `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">تقرير الموظفين — كلّم كام عميل</h3><div class="tw"><table>
      <tr><th>الموظف</th><th>النهارده</th><th>آخر 7 أيام</th><th>آخر 30 يوم</th><th>اتكلم معاهم (30)</th><th>اشتروا بعدها</th><th>مبيعاتهم</th></tr>
      ${Object.entries(people).sort((a, b) => b[1].d30.size - a[1].d30.size).map(([k, p]) => `<tr><td>${esc(k)}</td><td>${p.d0.size}</td><td>${p.d7.size}</td><td><b>${p.d30.size}</b></td><td>${p.ok}</td><td>${p.won}</td><td>${M(p.rev)}</td></tr>`).join('')}
      </table></div><p class="why" style="margin:8px 0 0">الأرقام = عدد العملاء المختلفين اللي الموظف سجّل معاهم تواصل (أي نتيجة). «اتكلم معاهم» = اللي ردّوا.</p></div>` : '';
  $('#cbody', ROOT).innerHTML = `<p class="why">"اشترى بعد التواصل" بيتحسب لوحده: أي فاتورة للعميل من يوم المكالمة لحد ${WINDOW} يوم بعدها (من السيستم، مش بالزرار).
    الفلوس = كل اللي اشتراه في الفترة دي.</p>${byEmp}<div id="wonBox" class="card" style="margin-bottom:12px"><p class="sub">جاري تحميل تقرير «اتكلمنا واشتروا»…</p></div>${blocks}`;
  loadWon();
}
/* ---------- «اتكلمنا واشتروا» (17/11، طلبه — للمدير وصاحب الصيدلية بس) ----------
   السيرفر بيحسبه مع كل تحديث للقوايم ويرفعه على reports/crm_won (القواعد: الأدمن وصاحب الصيدلية بس). لكل عميل: مين كلّمه وإمتى،
   اشترى إمتى وبكام، وأصنافه مقارنةً بعادته (120 يوم قبل): نفس الأصناف (زادت/قلّت كميتها) · أصناف جديدة · أصناف كان بيشتريها ومجاش بيها. */
const WON = { rows: null, at: '', q: '', shown: 30 };
async function loadWon() {
  const box = $('#wonBox', ROOT); if (!box) return;
  if (LOCAL) { if (LOCAL.won) { WON.rows = LOCAL.won; WON.at = 'تجربة'; wonView(); } else box.innerHTML = ''; return; }
  if (!WON.rows) {
    try {
      const d = await getDoc(doc(DB, 'reports', 'crm_won'));
      if (!d.exists()) { box.innerHTML = '<p class="sub">تقرير «اتكلمنا واشتروا» لسه مترفعش — هيظهر بعد أول تحديث للقوايم من السيرفر.</p>'; return; }
      const j = JSON.parse(d.data().d); WON.rows = j.rows || []; WON.at = j.at || '';
    } catch (e) { box.innerHTML = `<p class="sub">مقدرتش أحمّل التقرير: ${esc(e.code || e.message)}</p>`; return; }
  }
  wonView();
}
function wonView() {
  const box = $('#wonBox', ROOT); if (!box) return;
  const q = WON.q.trim().toLowerCase(), rows = WON.rows.filter(r => !q || String(r.name).toLowerCase().includes(q) || String(r.by).toLowerCase().includes(q) || (r.ph || []).join(' ').includes(q));
  const tot = rows.reduce((a, r) => a + (r.amt || 0), 0);
  const qtxt = x => x == null ? '' : (Math.round(x * 100) / 100).toString();
  const sameLi = x => `${esc(x.n)} <span class="s">× ${qtxt(x.q)}${x.w === 'زاد' ? ` · ⬆️ زاد (عادته ${qtxt(x.b)})` : x.w === 'قلّ' ? ` · ⬇️ قلّ (عادته ${qtxt(x.b)})` : ' · نفس كميته'}</span>`;
  box.innerHTML = `<h3 style="margin:0 0 6px">✅ اتكلمنا واشتروا — التفاصيل</h3>
    <p class="why">كل عميل اتسجل إننا كلمناه (اتكلمنا / بعتنا واتس) واشترى خلال ${WINDOW} يوم بعدها — آخر ${'30'} يوم. المقارنة بعادة العميل في 120 يوم قبل التواصل.
      آخر حساب: ${esc(WON.at)}. <b>${N(rows.length)}</b> عميل · ${M(tot)}.</p>
    <div class="ctl"><input type="search" id="wq" placeholder="دوّر: اسم العميل أو التليفون أو الموظف" value="${esc(WON.q)}"></div>
    <div>${rows.slice(0, WON.shown).map(r => `<div class="hr">
      <div class="hn">${esc(nm(r.name))} ${(r.ph || []).map(p => `<a class="bd dl" href="tel:${p}" style="text-decoration:none">${p}</a>`).join(' ')}</div>
      <div class="hs">👤 كلّمه <b>${esc(r.by)}</b> يوم ${D(r.cd)} (${esc(r.res === 'تم' ? 'اتكلمنا' : r.res)})${r.note ? ' — ' + esc(r.note) : ''}</div>
      <div class="hs">🛒 اشترى يوم <b>${D(r.pd)}</b> (${r.after ? 'بعدها بـ ' + days(r.after) : 'نفس يوم التواصل'}) بـ <b>${M(r.amt)}</b>${r.more ? ` · + ${r.more} زيارة تانية في الفترة` : ''}</div>
      ${r.first ? '<div class="hs">🆕 مفيش مشتريات قبلها في آخر 120 يوم — مفيش عادة نقارن بيها.</div>' : ''}
      ${r.same && r.same.length ? `<div class="hs">✔ <b>نفس أصنافه:</b><ul class="its" style="margin:4px 0">${r.same.map(x => `<li>${sameLi(x)}</li>`).join('')}</ul></div>` : ''}
      ${r.added && r.added.length ? `<div class="hs">➕ <b>أصناف جديدة عليه:</b> ${r.added.map(x => esc(x.n) + ' × ' + qtxt(x.q)).join(' · ')}</div>` : ''}
      ${r.missing && r.missing.length ? `<div class="hs">⬇️ <b>كان بيشتريها ومجاش بيها المرة دي:</b> ${r.missing.map(x => esc(x.n)).join(' · ')}</div>` : ''}
    </div>`).join('') || '<div class="banner">مفيش عملاء بالبحث ده.</div>'}</div>
    ${rows.length > WON.shown ? `<button class="ghost more" id="wmore">عرض المزيد (${rows.length - WON.shown})</button>` : ''}`;
  $('#wq', box).oninput = e => { WON.q = e.target.value; WON.shown = 30; const p = e.target.selectionStart; wonView(); const i = $('#wq', ROOT); i.focus(); i.setSelectionRange(p, p); };
  if ($('#wmore', box)) $('#wmore', box).onclick = () => { WON.shown += 30; wonView(); };
}
function logView() {
  const rows = [...LOG].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  $('#cbody', ROOT).innerHTML = `<p class="why">كل تواصل اتسجل. لو اتسجل غلط، امسحه.</p><div class="card tw"><table>
    <tr><th>اليوم</th><th>العميل</th><th>النتيجة</th><th>ملاحظة</th><th>اشترى بعدها؟</th><th></th></tr>
    ${rows.map(r => { const w = boughtAfter(r); return `<tr><td>${D(r.day)}</td><td>${esc(r.name)}</td><td>${esc(r.result)}</td><td>${esc(r.note || '')}</td>
      <td>${w ? '✅ ' + M(w.amt) : ''}</td><td>${ROLE === 'admin' ? `<button class="ghost sm" data-del="${r._id}">مسح</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="6">لسه مفيش تواصل متسجل.</td></tr>'}</table></div>`;
  $('#cbody', ROOT).querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('تمسح التسجيل ده؟')) return;
    try { await delLog(b.dataset.del); render(); } catch (e) { toast('متمسحش: ' + (e.code || e.message)); }
  });
}
/* ---------- بحث بصنف: مين اشترى صنف معين (أي صنف) من أول 2024 ---------- */
async function loadHist() {
  if (H) return;
  let raw;
  if (LOCAL) raw = LOCAL.hist;
  else {
    const m = await getDoc(doc(DB, 'crm_hist', 'meta'));
    if (!m.exists()) { H = { none: true }; return; }
    const k = JSON.parse(m.data().d), buys = [], cust = {};
    for (let i = 0; i < k.buys; i++) { const c = await getDoc(doc(DB, 'crm_hist', 'buys_' + i)); buys.push(...JSON.parse(c.data().d)); }
    for (let i = 0; i < k.cust; i++) { const c = await getDoc(doc(DB, 'crm_hist', 'cust_' + i)); Object.assign(cust, JSON.parse(c.data().d)); }
    const it = await getDoc(doc(DB, 'crm_hist', 'items'));
    raw = { buys, cust, items: JSON.parse(it.data().d), at: k.at };
  }
  const byItem = {};
  for (const b of raw.buys) (byItem[b[1]] = byItem[b[1]] || []).push(b);
  const list = Object.entries(raw.items).map(([id, n]) => [+id, n, (byItem[id] || []).length]).filter(x => x[2]);
  H = { ...raw, byItem, list };
}
const since = m => m ? addDays(today(), -30 * m) : '';
const times = n => n === 1 ? 'مرة' : n === 2 ? 'مرتين' : n <= 10 ? `${n} مرات` : `${n} مرة`;
function custsFor(ids, from) {
  const per = {};
  for (const id of ids) for (const [c, , n, last] of (H.byItem[id] || [])) {
    if (last < from) continue;
    const p = per[c] || (per[c] = { c, n: 0, last: '', items: new Set() });
    p.n += n; if (last > p.last) p.last = last; p.items.add(H.items[id]);
  }
  return Object.values(per).sort((a, b) => b.last.localeCompare(a.last));
}
function findView() {
  const body = $('#cbody', ROOT);
  if (!H) {
    body.innerHTML = '<div class="card"><p class="sub">جاري تحميل مشتريات العملاء…</p></div>';
    loadHist().then(findView).catch(e => { body.innerHTML = `<div class="banner bad">مقدرتش أحمّل المشتريات: ${esc(e.code || e.message)}</div>`; });
    return;
  }
  if (H.none) { body.innerHTML = '<div class="banner">لسه السيرفر مرفعش سجل المشتريات — هيظهر بعد أول تشغيل بعد التحديث.</div>'; return; }
  const q = HS.q.trim().toLowerCase();
  const hits = q.length < 2 ? [] : H.list.filter(x => x[1].toLowerCase().includes(q)).sort((a, b) => b[2] - a[2]);
  const ids = HS.sel === '*' ? hits.map(x => x[0]) : (HS.sel ? [HS.sel] : []);
  let res = '';
  if (HS.sel) {
    const rows = custsFor(ids, since(HS.months));
    const title = HS.sel === '*' ? `كل الأصناف اللي فيها «${esc(HS.q)}» (${ids.length} صنف)` : esc(H.items[HS.sel]);
    const allPh = rows.map(r => ((H.cust[r.c] || [])[1] || [])[0]).filter(Boolean);
    res = `<div class="hc" style="margin-top:10px"><h3 style="margin:0 0 6px">${title}</h3>
      <p class="why">${N(rows.length)} عميل اشتروه${HS.months ? ` في آخر ${HS.months} شهور` : ' من أول 2024'} — الأحدث الأول.</p>
      <div class="ctl chips">${[[0, 'الكل'], [3, 'آخر 3 شهور'], [6, 'آخر 6 شهور'], [12, 'آخر سنة']].map(([m, t]) =>
        `<button class="chip ${HS.months === m ? 'on' : ''}" data-m="${m}">${t}</button>`).join('')}
        ${allPh.length ? `<button class="chip" id="hcopy">📋 نسخ كل الأرقام (${allPh.length})</button>` : ''}</div>
      <div class="hl">${rows.slice(0, HS.shown).map(r => {
        const [name, ph, vis, dl] = H.cust[r.c] || ['', [], null, false];
        return `<div class="hr"><div class="hn">${esc(nm(name))}${dl ? ' <span class="bd dl">توصيل</span>' : ''}${hasDisc(name) ? ' <span class="bd" style="background:#C2417A">خصم</span>' : ''}</div>
          ${HS.sel === '*' ? `<div class="hs">${esc([...r.items].slice(0, 3).join(' · '))}</div>` : ''}
          <div class="ph">${(ph || []).map(phBtn).join('') || '<span class="hs">مفيش رقم</span>'}</div>
          <div class="hs">اشترى ${times(r.n)} · آخر مرة ${D(r.last)} · آخر زيارة للصيدلية ${D(vis)}</div></div>`;
      }).join('')}
      </div>${rows.length > HS.shown ? `<button class="ghost more" id="hmore">عرض المزيد (${rows.length - HS.shown})</button>` : ''}</div>`;
  }
  body.innerHTML = `<p class="why">اكتب اسم أي صنف (دوا أو تجميل أو أي حاجة) وتطلعلك كل العملاء المسجلين اللي اشتروه من أول 2024 بأرقامهم — مفيد للعروض.
      آخر تحديث: ${esc(H.at || META.at || '')}.</p>
    <div class="ctl"><input type="search" id="hq" placeholder="اسم الصنف أو جزء منه — مثلاً NEBULA أو MOLFIX" value="${esc(HS.q)}"></div>
    ${!HS.sel && q.length >= 2 ? `<div class="hc">${hits.length ? `
      ${hits.length > 1 ? `<button class="ghost" data-sel="*" style="margin-bottom:8px">كل الأصناف اللي فيها «${esc(HS.q)}» — ${hits.length} صنف</button>` : ''}
      <div class="tw"><table>${hits.slice(0, 25).map(([id, n, k]) => `<tr data-sel="${id}" style="cursor:pointer"><td>${esc(n)}</td><td>${N(k)} عميل</td></tr>`).join('')}</table></div>`
      : '<p class="sub">مفيش صنف بالاسم ده اتباع لعميل مسجل.</p>'}</div>` : ''}
    ${HS.sel ? `<button class="ghost sm" id="hback">← بحث تاني</button>` : ''}${res}`;
  $('#hq', body).oninput = e => { HS.q = e.target.value; HS.sel = null; HS.shown = 60; const p = e.target.selectionStart; findView(); const j = $('#hq', ROOT); j.focus(); j.setSelectionRange(p, p); };
  body.querySelectorAll('[data-sel]').forEach(x => x.onclick = () => { HS.sel = x.dataset.sel === '*' ? '*' : +x.dataset.sel; HS.shown = 60; findView(); });
  body.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { HS.months = +x.dataset.m; findView(); });
  if ($('#hback', body)) $('#hback', body).onclick = () => { HS.sel = null; findView(); };
  if ($('#hmore', body)) $('#hmore', body).onclick = () => { HS.shown += 60; findView(); };
  if ($('#hcopy', body)) $('#hcopy', body).onclick = () => {
    const seen = custsFor(ids, since(HS.months)).map(r => ((H.cust[r.c] || [])[1] || [])[0]).filter(Boolean);
    copy(seen.join('\n'), 'الأرقام اتنسخت ✓');
  };
  if (!matchMedia('(pointer:coarse)').matches) body.querySelectorAll('.ph a').forEach(x => x.onclick = e => { e.preventDefault(); copy(x.href.replace('tel:', ''), 'الرقم اتنسخ ✓'); });
  wireCpn(body);
}


/* ---------- تبويبات الحملات (4/11): حفاضات ولبن + عملاء السوشيال — من نفس بيانات "بحث بصنف" ---------- */
const DIA_RX = /حفاض|PAMPERS|MOLFIX|BABY ?JOY|DIAPER|\bPANTS\b/i, WIPE_RX = /WIP|WET|مناديل|منديل|TISSUE/i, ADULT_RX = /SANI|ADULT|كبار|TENA/i;
const MILK_RX = /\bNAN\b|S-?26|NIDO|NESTOGEN|APTAMIL|BEBELAC|HERO ?BABY|NUTRASENSE|NUTRADEFENSE|SIMILAC|ENFAMIL|CERELAC|LACTOGEN|NUTRILON|ALFAMINO|NEOCATE|ISOMIL|MILUPA|FARLEY|لبن اطفال|لبن أطفال/i;
const FOOD_RX = /CERELAC|فواك|فاكه|خضار|خضروات|مشكل|PUREE|FRUIT/i;     // سيريلاك وبرطمانات الفاكهة أكل مش لبن
const kindOf = n => WIPE_RX.test(n) || ADULT_RX.test(n) ? '' : DIA_RX.test(n) ? 'd' : MILK_RX.test(n) && !FOOD_RX.test(n) ? 'm' : '';
const SOC_RX = /سوشيال|social/i;
let BB = { q: '', kind: '', from: '2026-09-26', shown: 40 }, SO = { q: '', from: '2026-09-01', shown: 40 };
const ago = d => d ? Math.max(0, Math.round((new Date(today() + 'T12:00:00Z') - new Date(String(d).slice(0, 10) + 'T12:00:00Z')) / 864e5)) : null;
// اسم التحية: من غير علامات السيستم وكلمة سوشيال
function greet(name) {
  const s = String(name).replace(/[*•.]/g, ' ').replace(/(خصم|اجل|آجل|نقدي|مؤجل|فيزا)\s*\d*/g, ' ').replace(/سوشيال|social/ig, ' ')
    .replace(/(?<![A-Za-zء-ي])[dDoO](?![A-Za-z])/g, ' ').replace(/^\s*[dDoO](?=[ء-ي])/, '').replace(/\d+/g, ' ');
  return s.replace(/\s+/g, ' ').trim() || 'حضرتك';
}
let IK = null, BYC = null;
function histIndex() {
  if (BYC) return;
  IK = {}; BYC = {};
  for (const [c, it, , last] of H.buys) {
    const nmI = H.items[it] || ''; if (!(it in IK)) IK[it] = kindOf(nmI);
    (BYC[c] = BYC[c] || []).push([nmI, last, IK[it]]);
  }
}
function babyRows() {
  histIndex(); const rows = [];
  for (const [c, arr] of Object.entries(BYC)) {
    const keep = arr.filter(x => x[2] && x[1] >= BB.from); if (!keep.length) continue;
    const hasD = keep.some(x => x[2] === 'd'), hasM = keep.some(x => x[2] === 'm');
    if (BB.kind === 'd' && !hasD || BB.kind === 'm' && !hasM || BB.kind === 'dm' && !(hasD && hasM)) continue;
    const info = H.cust[c] || ['', [], null, false], name = nm(info[0]);
    if (!name || SOC_RX.test(info[0] || '')) continue;            // السوشيال في تبويبهم بس
    if (ROLE === 'emp' && owner(c)) continue;                      // عليه اسم موظف (بتاعه في «عملائي»)
    const q = BB.q.trim().toLowerCase();
    if (q && !name.toLowerCase().includes(q) && !(info[1] || []).join(' ').includes(q)) continue;
    keep.sort((a, b) => b[1].localeCompare(a[1]));
    rows.push({ c: +c, name, ph: info[1] || [], deliv: info[3], keep, hasD, hasM, last: keep[0][1], area: info[4] || '', street: info[5] || '' });
  }
  return rows.sort((a, b) => a.last.localeCompare(b.last));         // الأقدم الأول
}
function lastBox(id) {
  const L = logsOf(id)[0], won = L && boughtAfter(L); if (!L) return '';
  return `<div class="last ${won ? 'win' : ''}">${won ? `✅ اشترى بعد التواصل: ${M(won.amt)} يوم ${D(won.day)} — ` : ''}
    آخر تواصل: ${esc(L.result)} يوم ${D(L.day)}${L.byName ? ' (' + esc(L.byName) + ')' : ''}${L.note ? ' — ' + esc(L.note) : ''}</div>`;
}
// (12/11) كروت الحملات بقت نفس الكارت الأساسي (card): زرار «أنا هتابعه»، «عملائي»، النصيحة، وتسجيل النتيجة بعد الحجز.
// camp: 'baby' | 'soc' · grp: مفاتيح GRP · tk: أنواع النصايح ('d' حفاضات / 'm' لبن) · الكارت بيتحفظ كنسخة لما الموظف يحجزه.
function campCard(r, camp, grp, msg, tk) {
  const tk2 = tkOfCust(r.c) || tk || '';
  CUSTOM[r.c] = { id: r.c, name: r.name, status: camp === 'soc' ? 'سوشيال' : camp === 'vit' ? 'فيتامينات' : 'حفاضات ولبن', monthly: 0, msg, camp, grp, tk: tk2 || undefined,
    phones: r.ph || [], deliv: !!r.deliv, last: r.last, v90: r.v90 || 0, visit: null, late: 0,
    area: [r.area, r.street].filter(Boolean).join(' — '),
    items: r.keep.slice(0, 5).map(x => [x[0], null, 'آخر شراء', null, x[1], null]) };
  return card(CUSTOM[r.c]);
}
function campShell(html, ctl) {
  $('#cbody', ROOT).innerHTML = html;
  const b = $('#cbody', ROOT); ctl(b); hooks(b);
}
function histGate(then) {
  const body = $('#cbody', ROOT);
  if (!H) {
    body.innerHTML = '<div class="card"><p class="sub">جاري تحميل مشتريات العملاء…</p></div>';
    loadHist().then(then).catch(e => { body.innerHTML = `<div class="banner bad">مقدرتش أحمّل المشتريات: ${esc(e.code || e.message)}</div>`; });
    return false;
  }
  if (H.none) { body.innerHTML = '<div class="banner">لسه السيرفر مرفعش سجل المشتريات.</div>'; return false; }
  return true;
}
function babyView() {
  if (!histGate(babyView)) return;
  const rows = babyRows();
  const kinds = [['', 'الكل'], ['d', 'حفاضات'], ['m', 'لبن'], ['dm', 'الاتنين']].map(([k, t]) => `<button class="chip ${BB.kind === k ? 'on' : ''}" data-kind="${k}">${t}</button>`).join('');
  const html = `<p class="why"><b>🍼 حفاضات ولبن</b> — كل عميل مسجل اشترى حفاضات أو لبن أطفال من <b>${D(BB.from)}</b>، الأقدم شراءً الأول (مفيش حد مخفي). المناديل مش محسوبة. <b>${N(rows.length)}</b> عميل.</p>
    <div class="ctl"><input type="search" id="bq" placeholder="اسم العميل أو التليفون" value="${esc(BB.q)}">
      <label class="chip">من <input type="date" id="bfrom" value="${BB.from}" style="width:auto;min-height:0"></label></div>
    <div class="ctl chips">${kinds}</div>
    <div id="clist">${rows.slice(0, BB.shown).map(r => {
      const grp = [r.hasD && 'diaper', r.hasM && 'milk'].filter(Boolean), tk = (r.hasD ? 'd' : '') + (r.hasM ? 'm' : '');
      const its = r.keep.slice(0, 3).map(x => '• ' + nm(x[0])).join('\n');
      const msg = `أهلاً ${greetA(r.name)} 🌿\nمعاك صيدلية أنس نحيلة، بنطمن على حضرتك وعلى البيبي.\n\nحسب آخر مرة، الظاهر إن دول قربوا يخلصوا:\n${its}\n\nمتوفرين عندنا بكل المقاسات، ولو تحب نوصلهملك البيت قولنا.\nوأي حاجة تانية تحتاجها، إحنا موجودين 💚`;
      return campCard(r, 'baby', grp, msg, tk);
    }).join('') || '<div class="banner">مفيش عملاء بالفلاتر دي.</div>'}</div>
    ${rows.length > BB.shown ? `<button class="ghost more" id="bmore">عرض المزيد (${rows.length - BB.shown})</button>` : ''}`;
  campShell(html, b => {
    $('#bq', b).oninput = e => { BB.q = e.target.value; BB.shown = 40; const p = e.target.selectionStart; babyView(); const i = $('#bq', ROOT); i.focus(); i.setSelectionRange(p, p); };
    $('#bfrom', b).onchange = e => { if (e.target.value) { BB.from = e.target.value; BB.shown = 40; babyView(); } };
    b.querySelectorAll('[data-kind]').forEach(x => x.onclick = () => { BB.kind = x.dataset.kind; BB.shown = 40; babyView(); });
    if ($('#bmore', b)) $('#bmore', b).onclick = () => { BB.shown += 40; babyView(); };
  });
}
function socRows() {
  histIndex(); const rows = [];
  for (const [c, info] of Object.entries(H.cust)) {
    if (!SOC_RX.test(info[0] || '')) continue;
    if (ROLE === 'emp' && owner(c)) continue;                      // عليه اسم موظف (بتاعه في «عملائي»)
    const last = info[2]; if (!last || last < SO.from) continue;
    const q = SO.q.trim().toLowerCase(), name = nm(info[0]);
    if (q && !name.toLowerCase().includes(q) && !(info[1] || []).join(' ').includes(q)) continue;
    const keep = [...(BYC[c] || [])].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 4);
    const v90 = (VIS[c] || []).reduce((a, x) => a + x[1], 0);
    rows.push({ c: +c, name, ph: info[1] || [], deliv: info[3], keep, last, v90, area: info[4] || '', street: info[5] || '' });
  }
  return rows.sort((a, b) => a.last.localeCompare(b.last));         // الأقدم الأول
}
function socView() {
  if (!histGate(socView)) return;
  const rows = socRows();
  const html = `<p class="why"><b>📣 عملاء السوشيال</b> — العملاء اللي اسمهم فيه «سوشيال» (جُم من الإعلانات)، من آخر زيارة <b>${D(SO.from)}</b>، الأقدم الأول. <b>${N(rows.length)}</b> عميل.</p>
    <div class="ctl"><input type="search" id="sq" placeholder="اسم العميل أو التليفون" value="${esc(SO.q)}">
      <label class="chip">من <input type="date" id="sfrom" value="${SO.from}" style="width:auto;min-height:0"></label>
      <button class="chip" id="sall">كل الوقت</button></div>
    <div id="clist">${rows.slice(0, SO.shown).map(r => {
      const msg = `أهلاً ${greetA(r.name)} 🌿 معاك صيدلية أنس نحيلة.\n${SOC_LINE}\nبنطمن على حضرتك، وحابين نفكرك إننا موجودين 24 ساعة والتوصيل لحد البيت.\nوعندنا كمان خصومات على مستحضرات التجميل.\nلو محتاج حاجة قولنا، وعروضنا على www.anasnehila.com 💚`;
      return campCard(r, 'soc', ['soc'], msg);
    }).join('') || '<div class="banner">مفيش عملاء بالفلاتر دي.</div>'}</div>
    ${rows.length > SO.shown ? `<button class="ghost more" id="smore">عرض المزيد (${rows.length - SO.shown})</button>` : ''}`;
  campShell(html, b => {
    $('#sq', b).oninput = e => { SO.q = e.target.value; SO.shown = 40; const p = e.target.selectionStart; socView(); const i = $('#sq', ROOT); i.focus(); i.setSelectionRange(p, p); };
    $('#sfrom', b).onchange = e => { if (e.target.value) { SO.from = e.target.value; SO.shown = 40; socView(); } };
    $('#sall', b).onclick = () => { SO.from = '2000-01-01'; SO.shown = 40; socView(); };
    if ($('#smore', b)) $('#smore', b).onclick = () => { SO.shown += 40; socView(); };
  });
}

/* ---------- تبويب الفيتامينات (17/11، طلبه): LIMITLESS بأنواعه + فيتامينات تانية معروفة — بنصايح فيتامينات وسؤال للعميل ---------- */
const LIM_RX = /LIMITL[A-Z]SS/i;
const VIT_RX = /LIMITL[A-Z]SS|CENTRUM|SUPRADYN|BEROCCA|REVITAL|SEVEN ?SEAS|VITAMIN|فيتامين/i;
let VT = { q: '', kind: '', from: '2026-09-01', shown: 40 };
function vitRows() {
  histIndex(); const rows = [];
  for (const [c, arr] of Object.entries(BYC)) {
    const keep = arr.filter(x => VIT_RX.test(x[0]) && x[1] >= VT.from); if (!keep.length) continue;
    const hasL = keep.some(x => LIM_RX.test(x[0]));
    if (VT.kind === 'l' && !hasL || VT.kind === 'o' && keep.every(x => LIM_RX.test(x[0]))) continue;
    const info = H.cust[c] || ['', [], null, false], name = nm(info[0]);
    if (!name || SOC_RX.test(info[0] || '')) continue;
    if (ROLE === 'emp' && owner(c)) continue;
    const q = VT.q.trim().toLowerCase();
    if (q && !name.toLowerCase().includes(q) && !(info[1] || []).join(' ').includes(q)) continue;
    keep.sort((a, b) => b[1].localeCompare(a[1]));
    rows.push({ c: +c, name, ph: info[1] || [], deliv: info[3], keep, last: keep[0][1], area: info[4] || '', street: info[5] || '' });
  }
  return rows.sort((a, b) => a.last.localeCompare(b.last));         // الأقدم الأول
}
function vitView() {
  if (!histGate(vitView)) return;
  const rows = vitRows();
  const kinds = [['', 'الكل'], ['l', 'ليميت ليس'], ['o', 'فيتامينات تانية']].map(([k, t]) => `<button class="chip ${VT.kind === k ? 'on' : ''}" data-kind="${k}">${t}</button>`).join('');
  const html = `<p class="why"><b>💊 فيتامينات</b> — كل عميل مسجل اشترى LIMITLESS بأنواعه أو فيتامينات معروفة (Centrum وغيره) من <b>${D(VT.from)}</b>، الأقدم شراءً الأول. الرسالة فيها زرار نصيحة + سؤال يخلّي العميل يرد. <b>${N(rows.length)}</b> عميل.</p>
    <div class="ctl"><input type="search" id="vq" placeholder="اسم العميل أو التليفون" value="${esc(VT.q)}">
      <label class="chip">من <input type="date" id="vfrom" value="${VT.from}" style="width:auto;min-height:0"></label></div>
    <div class="ctl chips">${kinds}</div>
    <div id="clist">${rows.slice(0, VT.shown).map(r => {
      const its = r.keep.slice(0, 3).map(x => '• ' + nm(x[0])).join('\n');
      const msg = `أهلاً ${greetA(r.name)} 🌿\nمعاك صيدلية أنس نحيلة، بنطمن على حضرتك.\n\nآخر مرة أخدت عندنا:\n${its}\n\nمتوفرين عندنا، ولو قرّب يخلص نوصّله لحد باب بيتك، قولنا بس.\nوأي سؤال عن المكمّلات إحنا موجودين 💚`;
      return campCard(r, 'vit', ['vit'], msg, 'v');
    }).join('') || '<div class="banner">مفيش عملاء بالفلاتر دي.</div>'}</div>
    ${rows.length > VT.shown ? `<button class="ghost more" id="vmore">عرض المزيد (${rows.length - VT.shown})</button>` : ''}`;
  campShell(html, b => {
    $('#vq', b).oninput = e => { VT.q = e.target.value; VT.shown = 40; const p = e.target.selectionStart; vitView(); const i = $('#vq', ROOT); i.focus(); i.setSelectionRange(p, p); };
    $('#vfrom', b).onchange = e => { if (e.target.value) { VT.from = e.target.value; VT.shown = 40; vitView(); } };
    b.querySelectorAll('[data-kind]').forEach(x => x.onclick = () => { VT.kind = x.dataset.kind; VT.shown = 40; vitView(); });
    if ($('#vmore', b)) $('#vmore', b).onclick = () => { VT.shown += 40; vitView(); };
  });
}

// آخر تحديث لبيانات العملاء من السيرفر (زي صفحة الطلبية) — أحمر لو أقدم من يوم ونص
function updBadge() {
  const el = $('#cupd', ROOT); if (!el) return;
  const at = META.at || '', day = at.slice(0, 10), hm = at.slice(11, 16);
  if (!day) { el.textContent = ''; return; }
  const t = today(), diff = ago(day);
  const when = day === t ? 'النهارده' : diff === 1 ? 'امبارح' : D(day);
  el.className = 'cupd' + (diff >= 2 ? ' old' : '');
  el.textContent = `${diff >= 2 ? '⚠️' : '🔄'} آخر تحديث: ${when} ${hm}${META.ref ? ' · مشتريات لحد ' + D(META.ref) : ''}`;
}
/* (17/11، طلبه) زرار «🔄 تحديث»: بيكتب crm_sys/refresh_req والسيرفر (watch.py) بيرفع القوايم (~5 دقايق) — بنستنى crm/meta.at يتغيّر
   ونعيد التحميل. كمان السيرفر بيحدّث لوحده 12ظ و5م و8م. القراية وقت الانتظار: مستندين كل 10 ثواني، ومفيش ضغطة جديدة قبل ما الأولى تخلص. */
const REFR = { busy: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function reloadAll() {
  H = null; BYC = null; IK = null; WON.rows = null; Object.keys(CUSTOM).forEach(k => delete CUSTOM[k]);
  await load(); ST.shown = 40; render();
}
async function requestRefresh() {
  if (REFR.busy) return;
  const btn = $('#crefresh', ROOT), st = $('#cstat', ROOT); if (!btn) return;
  REFR.busy = true; btn.disabled = true;
  const before = META.at, id = String(Date.now()), by = ROLE === 'emp' ? MY.name : 'مدير الفرع';
  const say = t => { const e = $('#cstat', ROOT); if (e) e.textContent = t; };
  try {
    if (LOCAL) { say('تجربة محلية — مفيش سيرفر'); return; }
    try { await setDoc(doc(DB, 'crm_sys', 'refresh_req'), { id, by }); }
    catch (e) { say('⚠️ الطلب متبعتش: ' + (e.code === 'permission-denied' ? 'القواعد الجديدة لسه متنشرتش' : (e.code || e.message))); return; }
    say('⏳ طلبت التحديث — السيرفر بيحسب القوايم (حوالي 5 دقايق)… متقفلش الصفحة');
    const t0 = Date.now();
    while (Date.now() - t0 < 12 * 60e3) {
      await sleep(20000);
      try {
        const m = await getDoc(doc(DB, 'crm', 'meta'));
        if (m.exists() && JSON.parse(m.data().d).at !== before) { await reloadAll(); say('✅ اتحدّثت القوايم — ' + (META.at || '')); return; }
        const s = await getDoc(doc(DB, 'crm_sys', 'refresh_status')), v = s.exists() ? s.data() : null;
        if (v && v.req === id) {
          if (v.state === 'error') { say('⚠️ التحديث فشل على السيرفر — جرّب تاني بعد شوية، أو كلّم د. يحيى'); return; }
          if (v.state === 'expired') { say('الطلب اتأخر قوي، دوس «تحديث» تاني'); return; }
          if (v.state === 'recent') { await reloadAll(); say('✅ القوايم محدّثة من دقيقتين — ' + (META.at || '')); return; }
          if (v.state === 'busy') say('⏳ فيه تحديث شغال دلوقتي على السيرفر — هيظهر لوحده أول ما يخلص');
          if (v.state === 'done') { await reloadAll(); say('✅ اتحدّثت القوايم — ' + (META.at || '')); return; }
        }
      } catch (e) { /* نحاول تاني بعد 10 ثواني */ }
    }
    say('⌛ السيرفر اتأخر — القوايم هتتحدّث أول ما يخلص، اعمل تحديث للصفحة بعد شوية');
  } finally { REFR.busy = false; const b = $('#crefresh', ROOT); if (b) b.disabled = false; }
}
const wireRefresh = () => { const b = $('#crefresh', ROOT); if (b) b.onclick = requestRefresh; };
function render() { kpis(); updBadge(); bar(); if (ST.tab === 'mine') mineView(); else if (ST.tab === 'baby') babyView(); else if (ST.tab === 'soc') socView(); else if (ST.tab === 'vit') vitView(); else if (ST.tab === 'find') findView(); else if (ST.tab === 'res') resView(); else if (ST.tab === 'log') logView(); else listView(); }

/* ---------- أدوات ---------- */
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
async function copy(t, ok_ = 'الرسالة اتنسخت ✓') {
  try { await navigator.clipboard.writeText(t); toast(ok_); return; } catch (e) { /* متصفح جوه واتساب/فيسبوك */ }
  const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* */ }
  a.remove(); if (ok) { toast(ok_); return; }
  prompt('انسخ الرسالة من هنا:', t);
}

export async function mountCustomers(root, role) {
  ROOT = root; ROLE = role; DB = getFirestore(getApp()); LOCAL = null; css(); root.id = 'crmRoot';
  root.innerHTML = '<div class="card"><p class="sub">جاري تحميل العملاء…</p></div>';
  let ok = false;
  try { ok = await load(); } catch (e) {
    root.innerHTML = `<div class="banner bad">مقدرتش أقرا قوايم العملاء: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; return;
  }
  if (!ok) { root.innerHTML = '<div class="banner">لسه مفيش قوايم — هتظهر بعد أول تشغيل للسيرفر (6 الصبح) بعد التحديث.</div>'; return; }
  shell(); wireRefresh(); render();
}
/* ---------- الموظف: نفس القوايم من حسابه + «عملائي» ---------- */
export async function mountEmployee(root, uid, name, dev = false) {
  ROOT = root; ROLE = 'emp'; DB = getFirestore(getApp()); LOCAL = null; MY = { uid, name, dev }; css(); root.id = 'crmRoot';
  root.innerHTML = '<div class="card"><p class="sub">جاري تحميل العملاء…</p></div>';
  let ok = false;
  try { ok = await load(); } catch (e) {
    root.innerHTML = `<div class="banner bad">مقدرتش أحمّل العملاء: ${esc(e.code || e.message)}</div>`; return;
  }
  if (!ok) { root.innerHTML = '<div class="banner">لسه مفيش قوايم.</div>'; return; }
  ST.tab = 'mine'; shell(); wireRefresh(); render();
}

// للتجربة المحلية من غير Firestore
export function mountLocal(root, data, role = 'admin', me = { uid: 'local', name: 'موظف تجربة' }) {
  ROOT = root; ROLE = role; LOCAL = data; MY = me; CLAIM = data.claim || {}; css(); root.id = 'crmRoot'; load(); if (role === 'emp') ST.tab = 'mine'; shell(); wireRefresh(); render();
}
