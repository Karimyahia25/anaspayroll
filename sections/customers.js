// قسم متابعة العملاء (21/10) — بيتحمّل أول ما تفتح تبويب "العملاء".
// القوايم بيحسبها سيرفر الصيدلية كل يوم 6 الصبح (الجرعة + عادة العميل) وبيكتبها في crm/meta + crm/list_N + crm/visits.
// (23/10، قرار د. يحيى) مفيش توزيع: كل موظف بيفتح القوايم من حسابه ويحط اسمه على العميل اللي هيتابعه ← crm_claim/{كود العميل}
// (فيه نسخة من الكارت). العميل اللي عليه اسم حد بيختفي من قوايم الباقيين 14 يوم.
// التواصل بيتسجل في crm_log. "اشترى" بيتعرف لوحده: فاتورة للعميل بعد يوم التواصل بـ 14 يوم أو أقل (من crm/visits).
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, setDoc, collection, addDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const GRP = { lapsed: ['كان بيشتري وبطّل', '#8E5A2B'], med: ['دوا', '#0B8577'], diaper: ['حفاضات', '#2A6FB0'], milk: ['لبن أطفال', '#6B5BA8'], adult: ['كبار السن', '#7F8C8D'], cosmo: ['تجميل', '#C2417A'] };
const RES = [['تم', '✅ اتكلمنا', 'ok'], ['مردش', '📵 مردش', 'nr'], ['مش مهتم', '🙅 مش مهتم', 'no'], ['رقم غلط', '☎️ رقم غلط', 'bad']];
const WINDOW = 14;            // اشترى خلال 14 يوم من التواصل = نجاح
const RETRY_NR = 2;           // مردش: يرجع يظهر بعد يومين

let ROOT, ROLE, DB = null, LOCAL = null, META = {}, CARDS = [], VIS = {}, LOG = [];
let ST = { tab: 'قرّب', q: '', grp: '', leak: false, deliv: false, hideDone: true, shown: 40 };
let H = null, HS = { q: '', sel: null, months: 0, shown: 60 };   // بحث بصنف
let CLAIM = {}, MY = { uid: '', name: '' };                    // مين حاطط اسمه على العميل {كود العميل: {uid, name, at, d}}
const CLAIM_DAYS = 14;         // الاسم بيفضل على العميل 14 يوم وبعدها يرجع متاح للكل

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
#crmRoot .ph a{display:inline-flex;align-items:center;min-height:44px;padding:6px 14px;border-radius:10px;background:var(--green-soft);color:var(--green-deep);font-weight:700;text-decoration:none;direction:ltr}
#crmRoot .act{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
#crmRoot .act button{min-height:44px;font-size:13.5px;padding:8px 12px}
#crmRoot .act button.r-ok{background:#1B7F3B}#crmRoot .act button.r-nr{background:#B0761F}#crmRoot .act button.r-no{background:#7F8C8D}#crmRoot .act button.r-bad{background:#A32E1E}
#crmRoot .last{font-size:12.5px;margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--paper)}
#crmRoot .last.win{background:color-mix(in srgb,#1B7F3B 14%,var(--card));color:var(--ink);font-weight:600}
#crmRoot details.msg{margin-top:6px}#crmRoot details.msg summary{cursor:pointer;color:var(--green);font-size:13px;font-weight:700}
#crmRoot details.msg pre{white-space:pre-wrap;font-family:inherit;font-size:13px;background:var(--paper);padding:10px;border-radius:10px;margin:6px 0 0;line-height:1.8}
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
  if (LOCAL) { ({ meta: META, cards: CARDS, visits: VIS, log: LOG } = LOCAL); return true; }
  const m = await getDoc(doc(DB, 'crm', 'meta'));
  if (!m.exists()) return false;
  META = JSON.parse(m.data().d); const n = m.data().chunks; CARDS = [];
  for (let i = 0; i < n; i++) { const c = await getDoc(doc(DB, 'crm', 'list_' + i)); if (c.exists()) CARDS.push(...JSON.parse(c.data().d)); }
  const v = await getDoc(doc(DB, 'crm', 'visits')); VIS = v.exists() ? JSON.parse(v.data().d) : {};
  LOG = ROLE === 'emp' && !MY.dev                          // الموظف بيقرا تسجيلاته هو بس (القواعد) — الجهاز المشترك بيقرا الكل
    ? (await getDocs(query(collection(DB, 'crm_log'), where('by', '==', MY.uid)))).docs.map(d => ({ _id: d.id, ...d.data() }))
    : (await getDocs(collection(DB, 'crm_log'))).docs.map(d => ({ _id: d.id, ...d.data() }));
  CLAIM = {}; (await getDocs(collection(DB, 'crm_claim'))).docs.forEach(d => { CLAIM[d.id] = d.data(); });
  return true;
}
// مين حاطط اسمه على العميل ده (آخر 14 يوم)
function owner(id) {
  const c = CLAIM[id];
  return c && c.at >= addDays(today(), -CLAIM_DAYS) ? c : null;
}
// الجهاز المشترك (crm): uid واحد للكل فالملكية بالاسم؛ حساب الموظف الفردي بالـ uid
const isMe = o => !!o && (MY.dev ? o.name === MY.name : o.uid === MY.uid);
const mine = id => isMe(owner(id));
const SNAP = ['id', 'name', 'phones', 'status', 'grp', 'items', 'due', 'late', 'visit', 'leak', 'monthly', 'deliv', 'area', 'msg'];
async function claim(id) {
  const c = CARDS.find(x => x.id === id), snap = {}; SNAP.forEach(k => snap[k] = c[k]);
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
  </div></div>
  <div class="ck" id="ckpi"></div>
  <div class="cbar" id="cbar"></div>
  <div id="cbody"></div>`;
}
function kpis() {
  if (ROLE === 'emp') {                                   // عدّاد الموظف: تسجيلاته هو بس (آخر 7 أيام)
    const R = results(7, LOG.filter(x => x.byName === MY.name)), ok = R.recs.filter(x => x.result === 'تم').length;
    $('#ckpi', ROOT).innerHTML = `
      <div><div class="l">تواصلك — آخر 7 أيام</div><div class="v">${N(R.recs.length)}</div><div class="l">اتكلمت مع ${N(ok)}</div></div>
      <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد ما كلّمتهم</div><div class="v">${N(R.won.length)}</div><div class="l">${M(R.rev)}</div></div>`;
    $('#cmeta', ROOT).textContent = `حط اسمك على العميل اللي هتكلمه — بيختفي من قوايم زمايلك ${CLAIM_DAYS} يوم.`; return; }
  const n = META.n || {}, v = META.value || {}, wk = results(7);
  $('#ckpi', ROOT).innerHTML = `
    <div><div class="l">عملاء متابعين</div><div class="v">${N(META.tracked)}</div></div>
    <div style="border-color:#2A6FB0"><div class="l">ميعادهم قرّب</div><div class="v">${N(n['قرّب'])}</div><div class="l">${M(v['قرّب'])}/شهر</div></div>
    <div style="border-color:#B0761F"><div class="l">اتأخروا</div><div class="v">${N(n['اتأخر'])}</div><div class="l">${M(v['اتأخر'])}/شهر</div></div>
    <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد التواصل (7 أيام)</div><div class="v">${N(wk.won.length)}</div><div class="l">${M(wk.rev)}</div></div>`;
  $('#cmeta', ROOT).textContent = `آخر تحديث من السيرفر: ${META.at || '—'} · الأرقام على مشتريات لحد ${D(META.ref)}`;
}
function bar() {
  const cnt = s => CARDS.filter(c => c.status === s && !(ST.hideDone && contactedRecently(c)) && !(ROLE === 'emp' && owner(c.id))).length;
  if (ROLE === 'emp') {
    const n = myCards().filter(c => !contactedRecently(c)).length;
    $('#cbar', ROOT).innerHTML = `<button class="${ST.tab === 'mine' ? 'on' : ''}" data-tab="mine">👤 عملائي<span class="n">${n}</span></button>`
      + LISTS.map(([k, t]) => `<button class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${t}<span class="n">${cnt(k)}</span></button>`).join('')
      + `<button class="${ST.tab === 'find' ? 'on' : ''}" data-tab="find">🔎 بحث بصنف</button>`;
    $('#cbar', ROOT).querySelectorAll('button').forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.shown = 40; render(); });
    return;
  }
  $('#cbar', ROOT).innerHTML = LISTS.map(([k, t]) => `<button class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${t}<span class="n">${cnt(k)}</span></button>`).join('')
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
function card(c) {
  const g = GRP[c.grp[0]] || GRP.med, L = logsOf(c.id)[0], won = L && boughtAfter(L), edit = ROLE === 'admin' || ROLE === 'emp';
  const ow = owner(c.id), me = ROLE === 'emp' && isMe(ow);
  const when = c.status === 'قرّب' ? (c.late === 0 ? '⏰ محتاج يشتري النهارده' : `⏰ محتاج يشتري بعد ${days(-c.late)}`)
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
      <div class="val">${M(c.monthly)}<div class="meta" style="text-align:left">${c.grp[0] === 'lapsed' ? 'كان بيدفع في الشهر' : 'في الشهر'}</div></div></div>
    <ul class="its">${its}</ul>
    <div class="ph">${c.phones.length ? c.phones.map(p => `<a href="tel:${p}">📞 ${p}</a>`).join('') : '<span class="meta">مفيش رقم متسجل</span>'}</div>
    <details class="msg"><summary>الرسالة</summary><pre>${esc(c.msg)}</pre></details>
    <div class="act"><button class="ghost" data-copy="${c.id}">📋 نسخ الرسالة</button>
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
// أزرار الكارت (القوايم + عملائي)
function hooks(b) {
  b.querySelectorAll('[data-copy]').forEach(x => x.onclick = () => copy(cardOf(+x.dataset.copy).msg));
  // على الكمبيوتر مفيش تليفون يتصل: الدوسة على الرقم بتنسخه بدل ما تفتح برنامج اتصال
  if (!matchMedia('(pointer:coarse)').matches) b.querySelectorAll('.ph a').forEach(x => x.onclick = e => { e.preventDefault(); copy(x.href.replace('tel:', ''), 'الرقم اتنسخ ✓'); });
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
  const c = cardOf(id); let note = '';
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
  for (const r of recs.filter(x => x.result === 'تم').sort((a, b) => a.day.localeCompare(b.day))) {
    if (seen.has(r.cust)) continue; const w = boughtAfter(r); if (w) { won.push({ ...r, w }); seen.add(r.cust); }
  }
  return { recs, won, rev: won.reduce((a, x) => a + x.w.amt, 0) };
}
function resView() {
  const blocks = [7, 30].map(d => {
    const R = results(d), by = k => R.recs.filter(x => x.result === k).length;
    return `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">آخر ${d} يوم</h3>
      <div class="ck"><div><div class="l">تواصل</div><div class="v">${N(R.recs.length)}</div><div class="l">اتكلمنا ${by('تم')} · مردش ${by('مردش')} · مش مهتم ${by('مش مهتم')} · رقم غلط ${by('رقم غلط')}</div></div>
        <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد التواصل</div><div class="v">${N(R.won.length)}</div><div class="l">من ${by('تم')} اتكلمنا معاهم</div></div>
        <div style="border-color:#1B7F3B"><div class="l">مبيعاتهم بعد التواصل</div><div class="v">${M(R.rev)}</div><div class="l">خلال ${WINDOW} يوم من المكالمة</div></div></div>
      ${R.won.length ? `<div class="tw"><table><tr><th>العميل</th><th>اتكلمنا</th><th>اشترى</th><th>بكام</th><th>القايمة</th></tr>
        ${R.won.map(x => `<tr><td>${esc(x.name)}</td><td>${D(x.day)}</td><td>${D(x.w.day)}</td><td>${M(x.w.amt)}</td><td>${esc(x.list)}</td></tr>`).join('')}</table></div>` : ''}</div>`;
  }).join('');
  const R30 = results(30), people = {};
  for (const r of R30.recs) { const p = people[r.byName || '—'] || (people[r.byName || '—'] = { n: 0, ok: 0, won: 0, rev: 0 }); p.n++; if (r.result === 'تم') p.ok++; }
  for (const w of R30.won) { const p = people[w.byName || '—']; if (p) { p.won++; p.rev += w.w.amt; } }
  const byEmp = Object.keys(people).length ? `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 8px">حسب الموظف — آخر 30 يوم</h3><div class="tw"><table>
      <tr><th>الموظف</th><th>تواصل</th><th>اتكلم معاهم</th><th>اشتروا بعدها</th><th>مبيعاتهم</th></tr>
      ${Object.entries(people).sort((a, b) => b[1].rev - a[1].rev).map(([k, p]) => `<tr><td>${esc(k)}</td><td>${p.n}</td><td>${p.ok}</td><td>${p.won}</td><td>${M(p.rev)}</td></tr>`).join('')}
      </table></div></div>` : '';
  $('#cbody', ROOT).innerHTML = `<p class="why">"اشترى بعد التواصل" بيتحسب لوحده: أي فاتورة للعميل من يوم المكالمة لحد ${WINDOW} يوم بعدها (من السيستم، مش بالزرار).
    الفلوس = كل اللي اشتراه في الفترة دي.</p>${byEmp}${blocks}`;
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
          <div class="ph">${(ph || []).map(x => `<a href="tel:${x}">📞 ${x}</a>`).join('') || '<span class="hs">مفيش رقم</span>'}</div>
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
}

function render() { kpis(); bar(); if (ST.tab === 'mine') mineView(); else if (ST.tab === 'find') findView(); else if (ST.tab === 'res') resView(); else if (ST.tab === 'log') logView(); else listView(); }

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
  shell(); render();
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
  ST.tab = 'mine'; shell(); render();
}

// للتجربة المحلية من غير Firestore
export function mountLocal(root, data, role = 'admin', me = { uid: 'local', name: 'موظف تجربة' }) {
  ROOT = root; ROLE = role; LOCAL = data; MY = me; CLAIM = data.claim || {}; css(); root.id = 'crmRoot'; load(); if (role === 'emp') ST.tab = 'mine'; shell(); render();
}
