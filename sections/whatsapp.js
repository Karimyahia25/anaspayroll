// تبويب «💬 واتساب» (23/11، طلب د. يحيى) — للأدمن بس: تذكير الطلب الشهري من رقم الواتساب الرسمي (+20 10 50822954).
// القايمة: crm/wa_list (السيرفر بيحسبها كل يوم مع قوايم العملاء — سوشيال/مزمن/لبن/حفاضات/فيتامينات، قريبين، ميعادهم قرّب).
// البحث: كل العملاء المسجلين (crm_hist/cust_N) بالاسم أو الموبايل.
// الإرسال والردود: Worker anas-wa مباشرة (POST /send، GET /events، /stats) بمفتاح الأدمن — بيتحفظ على الجهاز ده بس (localStorage).
// الحمايات في الـ Worker نفسه: اللي داس «وقف التذكير» ميتبعتلوش · 20 يوم بين تذكيرين لنفس الرقم · حد يومي.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const WORKER = 'https://anas-wa.anasnehila.workers.dev';
const KEY_LS = 'wa_admin_key';
const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
             set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
const AR = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
const digits = s => AR(s).replace(/\D/g, '');
const dm = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/); return m ? `${+m[3]}/${+m[2]}${m[4] ? ' ' + m[4] : ''}` : (s || ''); };

let ROOT, DB = null, LOCAL = null, LIST = null, CUST = null, PHONE_IX = null;
let ST = { tab: 'list', soc: false, sel: new Set(), q: '', shown: 40, busy: false, res: {},
           open: { recent: false, hold: false, held: false, dis: false }, sentAt: null, sentT: 0 };   // open = أقسام «اتشالوا/اتبعتلهم…» تفضل مفتوحة بعد أي إعادة رسم

/* ---------- الاسم في الرسالة (نفس قواعد wa_remind.first_name على السيرفر) ---------- */
const TITLES = new Set(['ا', 'أ', 'د', 'م', 'ح', 'دكتور', 'دكتوره', 'دكتورة', 'مدام', 'استاذ', 'أستاذ', 'استاذة', 'أستاذة', 'الحاج', 'الحاجة', 'حاج', 'حاجة', 'سوشيال']);
const DOCTOR = new Set(['د', 'دكتور', 'دكتوره', 'دكتورة']);
const GENERIC = /زائر|زاءر|عميل|walk|^\s*$|^[\d\s+\-]+$|ا\/هاله|ا\/هالة/i;
export function firstName(raw) {
  let s = String(raw || '').split(' · ')[0];
  s = s.replace(/[*•.]/g, ' ').replace(/(خصم|اجل|آجل|نقدي|مؤجل|فيزا)\s*\d*/g, ' ').replace(/(^|[^A-Za-z])[dDoO](?![A-Za-z])/g, '$1 ');
  s = s.replace(/[\/\\\-_()]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = s.split(' ').filter(Boolean);
  if (GENERIC.test(raw || '')) return 'يا فندم';
  const kin = { 'ام': 'أم', 'أم': 'أم', 'ابو': 'أبو', 'أبو': 'أبو' };
  const ok = w => /^[ء-ي]{2,15}$/.test(w || '');
  if (parts.length >= 2 && kin[parts[0]] && ok(parts[1])) return `${kin[parts[0]]} ${parts[1]}`;
  const doc_ = parts.slice(0, 2).some(w => DOCTOR.has(w));
  const w = parts.find(x => !TITLES.has(x));
  return ok(w) ? `${doc_ ? 'د' : 'أ'}/ ${w}` : 'يا فندم';
}
const waNum = p => '20' + String(p).replace(/^0/, '');
const cairoDay = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const TEST_TO = new Set(['201004021342']);                // رقم د. يحيى — تجاربه مش بتتحسب في الأثر
// (26/11) قالب «اللي اشتروا مرة» (once_checkin_v1) اتقدم لميتا ومستني الموافقة + رفع الـ Worker الجديد — لحد ما الاتنين يحصلوا الإرسال له واقف (الـ Worker القديم كان هيبعت القالب الغلط)
const ONCE_READY = true;
const GAP_DAYS = 20;                                      // نفس حارس الـ Worker: مفيش تذكير لنفس الرقم قبل 20 يوم
const ECODE = { 131050: 'قفل رسايل التسويق من واتساب نفسه (اتحط في الإيقاف)', 131049: 'ميتا حدّت رسايل التسويق للعميل ده' };

/* ---------- Worker ---------- */
async function api(path, opt = {}) {
  const key = ls.get(KEY_LS);
  const r = await fetch(WORKER + path, { ...opt, headers: { 'x-key': key, 'content-type': 'application/json', ...(opt.headers || {}) } });
  if (r.status === 403) throw new Error('المفتاح غلط');
  if (!r.ok) throw new Error('السيرفر رد ' + r.status);
  return r.json();
}

/* ---------- الداتا ---------- */
async function loadList() {
  if (LIST) return LIST;
  if (LOCAL) return (LIST = LOCAL.list);
  const d = await getDoc(doc(DB, 'crm', 'wa_list'));
  LIST = d.exists() ? JSON.parse(d.data().d) : { rows: [], at: '' };
  return LIST;
}
let HOLD = null;
async function loadHold() {              // crm/wa_hold: مجموعة المقارنة {كود: أول يوم ظهر فيه} — السيرفر بيكتبها مع قايمة الواتساب
  if (HOLD) return HOLD;
  if (LOCAL) return (HOLD = LOCAL.hold || {});
  const d = await getDoc(doc(DB, 'crm', 'wa_hold'));
  return (HOLD = d.exists() ? JSON.parse(d.data().d) : {});
}
async function recentSent() {            // {كود: وقت آخر تذكير} آخر GAP_DAYS يوم — من سجل الـ Worker
  if (!ls.get(KEY_LS)) return {};
  try {
    const { events } = await api('/events?limit=300'); const m = {}, lim = Date.now() - GAP_DAYS * 86400e3;
    for (const e of events) if (e.dir === 'out' && e.t > lim && !TEST_TO.has(e.to) && e.code && e.kind !== 'intro') m[String(e.code)] = Math.max(m[String(e.code)] || 0, e.t);
    return m;
  } catch { return {}; }
}
let VIS = null;
async function loadVisits() {           // crm/visits: مشتريات كل عميل آخر 90 يوم {كود: [[يوم, قيمة]]} — بتتحدّث كل يوم الصبح
  if (VIS) return VIS;
  if (LOCAL) return (VIS = LOCAL.visits || {});
  const d = await getDoc(doc(DB, 'crm', 'visits'));
  return (VIS = d.exists() ? JSON.parse(d.data().d) : {});
}
const ROI_DAYS = 7;

/* ---------- (26/11، طلبه) شيل عميل من المتابعة 3 أسابيع ----------
   crm/wa_dismiss = {كود: وقت الشيل} — الأدمن بيكتبه (قاعدة crm الحالية: isAdmin يكتب) فبيظهر على كل أجهزته (موبايل/لابتوب). بعد 21 يوم بيرجع لوحده. */
const DISMISS_DAYS = 21;
let DIS = null;
async function loadDis() {
  if (DIS) return DIS;
  if (LOCAL) return (DIS = LOCAL.dis || {});
  const d = await getDoc(doc(DB, 'crm', 'wa_dismiss'));
  return (DIS = d.exists() ? JSON.parse(d.data().d) : {});
}
const isDis = c => !!(DIS && DIS[String(c)] && DIS[String(c)] > Date.now() - DISMISS_DAYS * 86400e3);
async function saveDis() {
  const cut = Date.now() - DISMISS_DAYS * 86400e3;
  for (const k of Object.keys(DIS)) if (DIS[k] < cut) delete DIS[k];                // اللي عدّى 3 أسابيع بيتشال من الملف
  if (!LOCAL) await setDoc(doc(DB, 'crm', 'wa_dismiss'), { d: JSON.stringify(DIS) });
}
const backIn = c => { const days = Math.ceil((DIS[String(c)] + DISMISS_DAYS * 86400e3 - Date.now()) / 86400e3); return Math.max(1, days); };

/* ---------- (26/11) نص الرسالة اللي هتتبعت — بيظهر تحت كل عميل وفي تأكيد الإرسال ----------
   النصوص دي هي نصوص القوالب المعتمدة عند ميتا (من ملفات القوالب)؛ قالب الفيتامينات نصه تقريبي (مبني على قالب الحفاضات). الإيموجي في بعض النسخ ممكن تختلف. */
function tplText(r) {
  const n = r['الاسم في الرسالة'] || 'يا فندم', d = r._date || '', w = r._what || '';
  const head = `السلام عليكم ${n} 👋\nمعاك صيدلية د/أنس نحيلة.\n`, tail = '\nدايماً في خدمتكم 💙';
  let b;
  if (r._kind === 'once') b = `شرفتنا من فترة، وحبينا نطمّن إن كل حاجة تمام مع حضرتك.
لو احتجت أي حاجة أو عايز تسأل صيدلي، إحنا فاتحين 24 ساعة ونوصلك لحد باب بيتك.`;
  else if (r._kind === 'baby') b = `حسب آخر مرة (يوم ${d})، معاد ${w} البيبي قرّب.\nتحب نجهزهوملك ونوصلهوملك لحد البيت؟\nولو محتاج مقاس أو نوع تاني، صيدلي متخصص هيرد على حضرتك.`;
  else if (r._kind === 'vitamins') b = `حسب آخر مرة (يوم ${d})، معاد ${w || 'الفيتامينات'} قرّب.\nتحب نجهزهالك ونوصلهالك لحد البيت؟\nولو حابب تستفسر أكتر، صيدلي متخصص هيرد على حضرتك.\n(نص تقريبي)`;
  else if (r._kind === 'chronic') b = `بنفكّر حضرتك إن معاد طلبك الشهري المعتاد قرّب — آخر مرة كانت يوم ${d}.\nتحب نجهزهولك ونوصلهولك لحد البيت؟\nولو حابب تستفسر أكتر، صيدلي متخصص هيرد على حضرتك.`;
  else b = `بنفكّر حضرتك إن معاد تجديد طلبك الشهري قرّب.\nتحب نجهزهولك ونوصلهولك لحد البيت؟\nولو حابب تستفسر أكتر، صيدلي متخصص هيرد على حضرتك.`;
  return `🖼 صورة واجهة الصيدلية\n${head}${b}${tail}\n— صيدلية د/أنس نحيلة · فاتحين 24 ساعة\n${r._kind === 'once' ? '[اطلب دلوقتي]' : '[جهزوا طلبي]'}  [اسأل الصيدلي]  [وقف التذكير]`;
}

async function getSent(force) {                      // (26/11) كان بيسأل الـ Worker مع كل علامة — دلوقتي مرة كل دقيقتين أو بعد إرسال
  if (!force && ST.sentAt && Date.now() - ST.sentT < 120000) return ST.sentAt;
  ST.sentAt = await recentSent(); ST.sentT = Date.now();
  return ST.sentAt;
}

async function loadCust() {
  if (CUST) return CUST;
  if (LOCAL) { CUST = LOCAL.cust; }
  else {
    const m = await getDoc(doc(DB, 'crm_hist', 'meta'));
    const k = m.exists() ? JSON.parse(m.data().d) : { cust: 0 };
    CUST = {};
    for (let i = 0; i < k.cust; i++) { const c = await getDoc(doc(DB, 'crm_hist', 'cust_' + i)); if (c.exists()) Object.assign(CUST, JSON.parse(c.data().d)); }
  }
  PHONE_IX = {};
  for (const [id, c] of Object.entries(CUST)) for (const p of (c[1] || [])) PHONE_IX[waNum(p)] = { id, name: c[0] };
  return CUST;
}

/* ---------- ستايل ---------- */
function css() {
  if ($('#waCss')) return;
  const s = document.createElement('style'); s.id = 'waCss';
  s.textContent = `
#waRoot .wtop{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:10px}
#waRoot .wstat{display:flex;gap:8px;flex-wrap:wrap}
#waRoot .wstat b{font-size:18px}
#waRoot .pill{background:var(--card);border-radius:999px;padding:8px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08);font-size:13px}
#waRoot .wtabs{display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap}
#waRoot .wtabs button{border-radius:999px;padding:10px 16px;min-height:44px;background:var(--card);color:var(--muted);border:0;box-shadow:0 1px 3px rgba(0,0,0,.08);font-weight:600}
#waRoot .wtabs button.on{background:var(--navy);color:#fff}
#waRoot .wrow{display:flex;gap:10px;align-items:flex-start;background:var(--card);border-radius:14px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
#waRoot .wrow.sel{outline:2px solid var(--green)}
#waRoot .wrow input[type=checkbox]{width:22px;height:22px;margin-top:3px;flex:0 0 auto}
#waRoot .wmain{flex:1;min-width:0}
#waRoot .wname{font-weight:700}
#waRoot .wsub{color:var(--muted);font-size:13px;margin-top:3px;line-height:1.6}
#waRoot .tag{display:inline-block;border-radius:6px;padding:1px 7px;font-size:12px;margin-inline-end:4px;background:#EEF6F4;color:#0B6E66}
#waRoot .tag.soc{background:#FFF4D6;color:#8A5A00}
#waRoot .tag.late{background:#FDECEC;color:#A12B2B}
#waRoot .res{font-size:13px;margin-top:4px}
#waRoot .bar{position:sticky;bottom:0;background:color-mix(in srgb,var(--paper,#f5f6f1) 92%,transparent);backdrop-filter:blur(8px);padding:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:3}
#waRoot .bar button{min-height:44px}
#waRoot input.wq{width:100%;min-height:44px;font-size:16px;border-radius:12px;padding:10px 12px;border:1px solid #d7dde0;background:var(--card)}
#waRoot .ev{display:flex;gap:10px;padding:10px 12px;background:var(--card);border-radius:12px;margin-bottom:6px;font-size:14px}
#waRoot .ev .t{color:var(--muted);font-size:12px;min-width:70px}
#waRoot .wmain label{display:block;cursor:pointer}
#waRoot .wact{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:6px}
#waRoot .wbtn{min-height:40px;border-radius:10px;padding:6px 12px;font-size:13px;background:var(--card);color:var(--muted);border:1px solid #d7dde0}
#waRoot details.wtpl{flex:1 1 100%}
#waRoot details.wtpl summary{cursor:pointer;color:var(--muted);font-size:13px;min-height:40px;display:flex;align-items:center}
#waRoot details.wtpl pre{white-space:pre-wrap;font:inherit;font-size:13px;line-height:1.7;background:#EAF7EE;border-radius:12px;padding:10px 12px;margin:4px 0 0}
#waRoot .msgname{width:130px;min-height:36px;border-radius:8px;border:1px solid #d7dde0;padding:4px 8px;font-size:14px}
`;
  document.head.appendChild(s);
}

/* ---------- الهيكل ---------- */
function shell() {
  ROOT.innerHTML = `
  <div class="card">
    <div class="wtop">
      <h2 style="margin:0">💬 تذكير واتساب</h2>
      <div class="wstat" id="waStat"><span class="pill">…</span></div>
    </div>
    <p class="sub" style="margin:0 0 6px">3 رسايل حسب العميل (مزمن · حفاضات/لبن · فيتامينات) فيها آخر مرة اشترى + زراير «جهزوا طلبي» و«اسأل الصيدلي» و«وقف التذكير».
      «جهزوا طلبي» بيفتح واتساب الفرع 012 وأصناف العميل مكتوبة في الرسالة (والفرع بيسجّله برقم موبايله). أي رد كتابي على الرقم ده بيتبلّغ لجروب الفرع. ~3.2 ج للرسالة.</p>
    <div id="waKey"></div>
    <div class="wtabs">
      <button data-t="list">📋 قايمة النهارده</button>
      <button data-t="search">🔎 بحث بالاسم أو الرقم</button>
      <button data-t="events">📥 الردود واللي اتبعت</button>
    </div>
    <div id="waBody"></div>
  </div>`;
  ROOT.querySelectorAll('.wtabs button').forEach(b => b.onclick = () => { ST.tab = b.dataset.t; render(); });
  keyBox();
}

function keyBox() {
  const box = $('#waKey', ROOT);
  if (ls.get(KEY_LS)) { box.innerHTML = `<p class="sub" style="font-size:12px">🔑 مفتاح الإرسال محفوظ على الجهاز ده · <a href="#" id="waKeyOff">شيله</a></p>`;
    $('#waKeyOff', ROOT).onclick = e => { e.preventDefault(); if (confirm('أشيل مفتاح الإرسال من الجهاز ده؟')) { ls.set(KEY_LS, ''); keyBox(); stats(); } };
    return; }
  box.innerHTML = `<div class="banner">🔑 علشان تبعت وتشوف الردود من الجهاز ده: الصق <b>مفتاح الإرسال</b> (من ملف admin_key.txt على اللابتوب) مرة واحدة.
    <div style="display:flex;gap:8px;margin-top:8px"><input id="waKeyIn" type="password" class="wq" placeholder="مفتاح الإرسال" autocomplete="off"><button id="waKeySave">حفظ</button></div></div>`;
  $('#waKeySave', ROOT).onclick = async () => {
    const v = $('#waKeyIn', ROOT).value.trim(); if (!v) return;
    ls.set(KEY_LS, v);
    try { await api('/stats'); keyBox(); stats(); }
    catch (e) { ls.set(KEY_LS, ''); alert('المفتاح ده مشتغلش: ' + e.message); }
  };
}

async function stats() {
  const el = $('#waStat', ROOT); if (!el) return;
  if (!ls.get(KEY_LS)) { el.innerHTML = ''; return; }
  try {
    const [s, h] = await Promise.all([api('/stats'), api('/health').catch(() => null)]);
    const Q = { GREEN: ['🟢', 'الرقم سليم'], YELLOW: ['🟡', 'صفرا — الإرسال واقف لوحده، ناس كتير عملت بلوك'], RED: ['🔴', 'حمرا — الإرسال واقف'],
                UNKNOWN: ['⚪', 'لسه بتتحسب (بعد أول رسايل)'] };
    const q = h ? (Q[h.quality] || ['⚪', h.quality]) : ['⚪', 'مقدرتش أجيب الجودة'];
    el.innerHTML = `<span class="pill" title="جودة الرقم عند ميتا">${q[0]} ${q[1]}</span>
      <span class="pill">النهارده <b>${s.sent}</b> من ${s.max}</span><span class="pill">الشهر <b>${s.month}</b> ≈ ${N(s.month * 3.2)} ج</span>`;
    ST.left = Math.max(0, (s.max || 30) - s.sent);
  } catch (e) { el.innerHTML = `<span class="pill">⚠️ ${esc(e.message)}</span>`; }
}

/* ---------- العرض ---------- */
async function render(quiet) {                    // quiet = إعادة رسم من غير «جاري التحميل» ومن غير ما الصفحة تقفز لفوق
  ROOT.querySelectorAll('.wtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === ST.tab));
  const body = $('#waBody', ROOT);
  const y = window.scrollY;
  if (!quiet) body.innerHTML = '<p class="sub">جاري التحميل…</p>';
  try {
    if (ST.tab === 'list') await renderList(body);
    else if (ST.tab === 'search') await renderSearch(body);
    else await renderEvents(body);
  } catch (e) { body.innerHTML = `<div class="banner bad">مقدرتش أحمّل: ${esc(e.code || e.message)}</div>`; }
  if (quiet) window.scrollTo(0, y);
}

function rowHtml(r, why, act) {     // why: لو متحدد، الصف مش قابل للاختيار (اتبعتله قريب / مجموعة المقارنة) — وده سببه
  // act: 'dis' = زرار «شيله 3 أسابيع» · 'undo' = «رجّعه» (القسم بتاع المشيلين)
  const late = /اتأخر/.test(r['الحالة'] || '');
  const res = ST.res[r['الكود']];
  const off = typeof why === 'string' && why.startsWith('!');
  const note = off ? why.slice(1) : (why || '');
  const c = r['الكود'], sel = ST.sel.has(c);
  const btn = act === 'dis' ? `<button type="button" class="wbtn" data-dis="${c}">✖ شيله من المتابعة 3 أسابيع</button>`
            : act === 'undo' ? `<button type="button" class="wbtn" data-undo="${c}">↩️ رجّعه (هيرجع تلقائي بعد ${backIn(c)} يوم)</button>` : '';
  const tpl = r._kind !== undefined ? `<details class="wtpl"><summary>👁 شوف الرسالة اللي هتتبعت</summary><pre>${esc(tplText(r))}</pre></details>` : '';
  return `<div class="wrow${sel ? ' sel' : ''}"${off ? ' style="opacity:.6"' : ''} data-row="${c}">
    <input type="checkbox" id="wc${c}" data-c="${c}" ${sel ? 'checked' : ''} ${off ? 'disabled' : ''}>
    <div class="wmain">
      <label for="wc${c}">
        <div class="wname">${esc(String(r['العميل']).replace(/\*/g, ''))} ${r['سوشيال'] ? '<span class="tag soc">سوشيال</span>' : ''}${note ? ` <span class="tag late">${esc(note)}</span>` : ''}</div>
        <div class="wsub">
          <span class="tag">${esc(r['المجموعة'])}</span><span class="tag ${late ? 'late' : ''}">${esc(r['الحالة'])}</span>
          <br>${esc(r['الأصناف'])}
          <br>📍 ${esc(r['المنطقة'])} · اشترى ${r['مرات الشرا']} مرة · ${r._kind === 'once' ? `فاتورته ~${N(r['قيمته في الشهر'])} ج` : `~${N(r['قيمته في الشهر'])} ج/شهر`} · الكود ${c}
          <br>في الرسالة: <b>${esc(r['الاسم في الرسالة'])}</b> · 📱 ${esc(r['الموبايل'])}
        </div>
      </label>
      ${res ? `<div class="res">${esc(res)}</div>` : ''}
      <div class="wact">${tpl}${btn}</div>
    </div></div>`;
}

function barUpdate(body) {                    // تحديث زرار الإرسال من غير إعادة رسم
  const n = ST.sel.size, s = $('#waSend', body), c = $('#waClr', body);
  if (s) { s.disabled = !n; s.textContent = `📤 ابعت للمحددين (${n})`; }
  if (c) c.disabled = !n;
}

async function renderList(body) {
  const L = await loadList();
  const sentAt = await getSent();                                       // {كود: وقت آخر تذكير} — آخر 20 يوم (متخزن دقيقتين)
  await loadDis();
  const flt = r => !ST.soc || r['سوشيال'];
  const isSent = r => !!sentAt[String(r['الكود'])];
  const all = (L.rows || []).filter(flt);
  const recent = all.filter(isSent);
  const dismissed = []; { const seen = new Set();                        // المشيلين 3 أسابيع (من القايمة الأساسية و«اتشالوا»)
    for (const r of [...(L.rows || []), ...(L.held || [])].filter(flt)) if (!seen.has(r['الكود']) && isDis(r['الكود']) && !isSent(r)) { seen.add(r['الكود']); dismissed.push(r); } }
  const live = r => !isSent(r) && !isDis(r['الكود']);
  const hold = all.filter(r => live(r) && r._hold);
  const rows = all.filter(r => live(r) && !r._hold);
  const held = (L.held || []).filter(flt).filter(live);
  const skip = Object.entries(L.skip || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');
  const when = r => dm(new Date(sentAt[String(r['الكود'])]).toISOString().slice(0, 10));
  const op = k => ST.open[k] ? ' open' : '';
  body.innerHTML = `
    <p class="sub">${L.at ? `اتحسبت ${esc(dm(L.at))} (آخر فاتورة ${esc(dm(L.ref))})` : 'لسه مفيش قايمة — بتتعمل مع قوايم العملاء كل يوم الصبح.'} — <b>${rows.length}</b> عميل جاهز${recent.length ? ` · ${recent.length} اتبعتلهم قريب` : ''}${dismissed.length ? ` · ${dismissed.length} مشيلين` : ''}${hold.length ? ` · ${hold.length} مجموعة مقارنة` : ''}${skip ? ` · اتشال: ${esc(skip)}` : ''}</p>
    <label style="display:inline-flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" id="waSoc" ${ST.soc ? 'checked' : ''}> سوشيال بس</label>
    <div id="waRows">${rows.slice(0, ST.shown).map(r => rowHtml(r, '', 'dis')).join('') || '<p class="sub">مفيش عملاء جاهزين دلوقتي بالشروط دي.</p>'}</div>
    ${rows.length > ST.shown ? `<button class="ghost" id="waMore">اعرض ${Math.min(40, rows.length - ST.shown)} كمان</button>` : ''}
    ${dismissed.length ? `<details data-k="dis" style="margin-top:10px"${op('dis')}><summary class="sub">⏸️ مشيلين من المتابعة (${dismissed.length}) — بيرجعوا لوحدهم بعد ${DISMISS_DAYS} يوم من الشيل</summary>${dismissed.map(r => rowHtml(r, '!مشيل', 'undo')).join('')}</details>` : ''}
    ${recent.length ? `<details data-k="recent" style="margin-top:10px"${op('recent')}><summary class="sub">✅ اتبعتلهم آخر ${GAP_DAYS} يوم (${recent.length}) — مش هيتبعتلهم تاني قبل ما تعدّي</summary>${recent.map(r => rowHtml(r, '!اتبعتله ' + when(r))).join('')}</details>` : ''}
    ${hold.length ? `<details data-k="hold" style="margin-top:10px"${op('hold')}><summary class="sub">🧪 مجموعة المقارنة (${hold.length}) — محدش بيبعتلهم الشهر ده علشان نقيس أثر التذكير بجد</summary>${hold.map(r => rowHtml(r, '!🧪 مقارنة')).join('')}</details>` : ''}
    ${held.length ? `<details data-k="held" style="margin-top:10px"${op('held')}><summary class="sub">📋 اتشالوا (${held.length}) — بعيد / عنوان مش متسجل / اشتروا مرة بس. <b>اختار منهم بإيدك</b> لو انت عارفهم</summary><p class="sub" style="font-size:12px">⚠️ اللي اشترى مرة بس: رسالة «معاد طلبك الشهري المعتاد» مش دقيقة معاه (مفيش «معتاد» لسه) — الأنسب ليه الحفاضات/اللبن أو الفيتامينات. وأي واحد عنوانه مش متسجل ممكن يكون بعيد.</p>${held.map(r => rowHtml(r, r['سبب الاستبعاد'], 'dis')).join('')}</details>` : ''}
    <div class="bar"><button id="waSend" ${ST.sel.size ? '' : 'disabled'}>📤 ابعت للمحددين (${ST.sel.size})</button>
      <button class="ghost" id="waClr" ${ST.sel.size ? '' : 'disabled'}>إلغاء التحديد</button>
      <span class="sub" id="waProg"></span></div>`;
  $('#waSoc', body).onchange = e => { ST.soc = e.target.checked; ST.shown = 40; render(true); };
  const more = $('#waMore', body); if (more) more.onclick = () => { ST.shown += 40; render(true); };
  // (26/11) العلامة بتتحدّث مكانها: من غير إعادة رسم ولا سؤال للسيرفر ولا قفل للأقسام ولا قفزة لفوق
  body.querySelectorAll('input[data-c]').forEach(cb => cb.onchange = () => {
    const c = +cb.dataset.c; cb.checked ? ST.sel.add(c) : ST.sel.delete(c);
    const row = cb.closest('.wrow'); if (row) row.classList.toggle('sel', cb.checked);
    barUpdate(body); });
  body.querySelectorAll('details[data-k]').forEach(d => d.addEventListener('toggle', () => { ST.open[d.dataset.k] = d.open; }));
  $('#waClr', body).onclick = () => { ST.sel.clear(); body.querySelectorAll('input[data-c]').forEach(cb => { cb.checked = false; const row = cb.closest('.wrow'); if (row) row.classList.remove('sel'); }); barUpdate(body); };
  body.querySelectorAll('button[data-dis]').forEach(b => b.onclick = async () => {      // شيله 3 أسابيع
    const c = b.dataset.dis; DIS[c] = Date.now(); ST.sel.delete(+c); b.disabled = true; b.textContent = '⏳…';
    try { await saveDis(); } catch (e) { delete DIS[c]; alert('مقدرتش أحفظ الشيل: ' + (e.code || e.message)); }
    render(true); });
  body.querySelectorAll('button[data-undo]').forEach(b => b.onclick = async () => {     // رجّعه
    const c = b.dataset.undo; const was = DIS[c]; delete DIS[c]; b.disabled = true; b.textContent = '⏳…';
    try { await saveDis(); } catch (e) { DIS[c] = was; alert('مقدرتش أحفظ: ' + (e.code || e.message)); }
    render(true); });
  const heldCodes = new Set((L.held || []).map(r => r['الكود']));
  const pick = new Map();                                              // الاسم القديم/الجديد لنفس الكود: الصف الأول يكسب (القايمة الأساسية قبل «اتشالوا»)
  for (const r of [...(L.rows || []), ...(L.held || [])]) if (!pick.has(r['الكود'])) pick.set(r['الكود'], r);
  $('#waSend', body).onclick = () => sendMany([...ST.sel].map(c => pick.get(c)).filter(r => r && !r._hold && !sentAt[String(r['الكود'])]).map(r => ({
    code: r['الكود'], label: String(r['العميل']).replace(/\*/g, ''), name: r['الاسم في الرسالة'], phone: r['الموبايل'],
    kind: r._kind, date: r._date, what: r._what, items: r._items, tpl: tplText(r), held: heldCodes.has(r['الكود']) && !(L.rows || []).some(x => x['الكود'] === r['الكود']) })));
}

async function sendMany(list) {
  if (!ls.get(KEY_LS)) { alert('حط مفتاح الإرسال الأول (فوق).'); return; }
  if (!ONCE_READY && list.some(x => x.kind === 'once')) { alert('رسالة «اللي اشتروا مرة» لسه مستنية موافقة ميتا ورفع الـ Worker — شيل الناس دي من التحديد وابعت الباقي.'); return; }
  if (!list.length || ST.busy) return;
  if (list.length > 20) { alert('الحد 20 عميل في المرة.'); return; }
  const cost = Math.round(list.length * 3.2);
  const nh = list.filter(x => x.held).length;
  const samples = []; const seenK = new Set();                          // نموذج الرسالة لكل نوع قالب في الدفعة
  for (const x of list) if (x.tpl && !seenK.has(x.kind || '')) { seenK.add(x.kind || ''); samples.push(x.tpl); }
  if (!confirm(`هبعت تذكير لـ ${list.length} عميل (≈ ${cost} ج):\n\n` + list.map(x => `• ${x.label} — «${x.name}»${x.held ? ' ⚠️ (من اللي اتشالوا)' : ''}`).join('\n') +
    (nh ? `\n\n⚠️ ${nh} منهم من قسم «اتشالوا» (بعيد / عنوان مجهول / اشترى مرة بس) — انت اللي اخترتهم بإيدك.` : '') +
    (samples.length ? '\n\n— الرسالة (نموذج' + (samples.length > 1 ? ' لكل نوع' : '') + ') —\n' + samples.join('\n\n———\n') : '') + '\n\nمتأكد؟')) return;
  ST.busy = true; let ok = 0;
  for (const [i, x] of list.entries()) {
    const p = $('#waProg', ROOT); if (p) p.textContent = `⏳ ${i + 1} من ${list.length}…`;
    try {
      // (24/11) القالبين الجداد: kind (chronic/baby) + date (آخر مرة d/m) + what (حفاضات/لبن) + items (بتظهر للفرع برقم عشوائي، مش في اللينك)
      const msg = { to: waNum(x.phone), name: x.name, code: String(x.code) };
      if (x.kind && x.date) Object.assign(msg, { kind: x.kind, date: x.date }, x.what ? { what: x.what } : {}, x.items && x.items.length ? { items: x.items } : {});
      const j = await api('/send', { method: 'POST', body: JSON.stringify(msg) });
      ST.res[x.code] = j.ok ? '✅ اتبعت' : '⚠️ ' + ({ optout: 'داس «وقف التذكير» قبل كده', 'recently reminded': 'اتبعتله تذكير من أقل من 20 يوم', 'bad input': 'الرقم أو الكود مش مظبوط', 'quality YELLOW': 'وقفت: جودة الرقم صفرا', 'quality RED': 'وقفت: جودة الرقم حمرا' }[j.error] || j.error);
      if (j.ok) { ok++; ST.sel.delete(x.code); }
    } catch (e) { ST.res[x.code] = '⚠️ ' + e.message; }
  }
  ST.busy = false;
  alert(`اتبعت ${ok} من ${list.length}. النتيجة جنب كل اسم.`);
  ST.sentAt = null;                                                   // اتبعت دلوقتي ← اسأل الـ Worker من جديد
  stats(); render(true);
}

async function renderSearch(body) {
  body.innerHTML = `<input class="wq" id="waQ" placeholder="اكتب اسم العميل أو رقم موبايله" value="${esc(ST.q)}" autocomplete="off">
    <p class="sub" id="waQInfo">بيدوّر في كل العملاء المسجلين اللي اشتروا من 2024.</p><div id="waQRes"></div>
    <div class="wrow" style="display:block;margin-top:14px">
      <div class="wname">📲 رقم مش مسجل عندنا (انت عارفه ووافق)</div>
      <p class="sub" style="font-size:12px;margin:4px 0 8px">بيتبعتله رسالة تعريف: «معاك صيدلية د/أنس نحيلة… فاتحين 24 ساعة ونوصلك لحد باب بيتك» + زراير اطلب / اسأل / وقف. ابعت بس لحد وافق إنك تبعتله — لو حد عمل بلوك جودة الرقم بتقع.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="wq" id="waNewPh" placeholder="الموبايل 01xxxxxxxxx" inputmode="numeric" style="max-width:190px" autocomplete="off">
        <input class="wq" id="waNewNm" placeholder="الاسم زي ما هيظهر: أ/ محمد" style="max-width:220px" autocomplete="off">
        <button id="waNewGo">📤 ابعت رسالة التعريف</button>
      </div>
      <div class="res" id="waNewRes"></div>
    </div>`;
  $('#waNewGo', body).onclick = async () => {
    const ph = digits($('#waNewPh', body).value), nm = $('#waNewNm', body).value.trim(), out = $('#waNewRes', body);
    if (!/^01[0125]\d{8}$/.test(ph)) { out.textContent = '⚠️ الموبايل لازم 11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015'; return; }
    if (!nm) { out.textContent = '⚠️ اكتب الاسم'; return; }
    if (!ls.get(KEY_LS)) { out.textContent = '⚠️ حط مفتاح الإرسال الأول (فوق)'; return; }
    if (!confirm(`هبعت رسالة تعريف لـ «${nm}» على ${ph} (≈ 3.2 ج).

متأكد إنه وافق يستقبل رسايل منك؟`)) return;
    out.textContent = '⏳…';
    try {
      const j = await api('/send', { method: 'POST', body: JSON.stringify({ to: waNum(ph), name: nm, code: '0', kind: 'intro' }) });
      out.textContent = j.ok ? '✅ اتبعتت' : '⚠️ ' + ({ optout: 'الرقم ده داس «وقف» قبل كده', 'recently reminded': 'اتبعتله من أقل من 20 يوم', 'bad input': 'الرقم أو الاسم مش مظبوط', 'quality YELLOW': 'وقفت: جودة الرقم صفرا', 'quality RED': 'وقفت: جودة الرقم حمرا' }[j.error] || j.error);
      if (j.ok) { $('#waNewPh', body).value = ''; $('#waNewNm', body).value = ''; stats(); }
    } catch (e) { out.textContent = '⚠️ ' + e.message; }
  };
  const q = $('#waQ', body);
  q.oninput = () => { ST.q = q.value; clearTimeout(q._t); q._t = setTimeout(search, 250); };
  q.focus();
  if (ST.q) search();
}

async function search() {
  const out = $('#waQRes', ROOT), info = $('#waQInfo', ROOT); if (!out) return;
  const raw = ST.q.trim();
  if (raw.length < 2) { out.innerHTML = ''; return; }
  info.textContent = 'جاري تحميل العملاء…';
  await loadCust();
  const dq = digits(raw), tq = AR(raw);
  const hits = [];
  for (const [id, c] of Object.entries(CUST)) {
    const phones = c[1] || [];
    const m = dq.length >= 4 ? phones.some(p => p.includes(dq.replace(/^20/, '0')) || p.includes(dq)) || id === dq
                             : AR(c[0]).includes(tq);
    if (m) hits.push([id, c]);
    if (hits.length >= 30) break;
  }
  info.textContent = hits.length ? `${hits.length >= 30 ? 'أول 30' : hits.length} نتيجة` : 'مفيش عميل بالاسم أو الرقم ده.';
  out.innerHTML = hits.map(([id, c]) => {
    const ph = (c[1] || [])[0], nm = firstName(c[0]), res = ST.res[id];
    return `<div class="wrow"><div class="wmain">
      <div class="wname">${esc(String(c[0]).replace(/\*/g, ''))}</div>
      <div class="wsub">📱 ${esc((c[1] || []).join(' / ') || 'مفيش موبايل')} · آخر زيارة ${esc(dm(c[2]) || '—')}${c[3] ? ' · عميل توصيل' : ''}${c[4] ? ' · 📍 ' + esc(c[4]) : ''} · الكود ${id}</div>
      ${ph ? `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <span class="sub">الاسم في الرسالة:</span><input class="msgname" data-n="${id}" value="${esc(nm)}">
        <button data-s="${id}">📤 ابعت تذكير</button></div>` : ''}
      ${res ? `<div class="res">${esc(res)}</div>` : ''}
    </div></div>`;
  }).join('');
  out.querySelectorAll('button[data-s]').forEach(b => b.onclick = () => {
    const id = b.dataset.s, c = CUST[id], name = $(`input[data-n="${id}"]`, out).value.trim() || 'يا فندم';
    const d = (dm(c[2]) || '').split(' ')[0];   // آخر زيارة d/m — للقالب الجديد
    sendMany([{ code: +id, label: String(c[0]).replace(/\*/g, ''), name, phone: c[1][0], kind: /^\d{1,2}\/\d{1,2}$/.test(d) ? 'chronic' : '', date: d }]).then(search);
  });
}

async function renderEvents(body) {
  if (!ls.get(KEY_LS)) { body.innerHTML = '<div class="banner">حط مفتاح الإرسال الأول (فوق) علشان تشوف الردود.</div>'; return; }
  const [{ events }] = await Promise.all([api('/events?limit=300'), loadCust().catch(() => null), loadVisits().catch(() => null)]);
  const who = n => { const x = PHONE_IX && PHONE_IX[n]; return x ? `${String(x.name).replace(/\*/g, '')} (${x.id})` : '0' + String(n).replace(/^20/, ''); };
  const st = {};
  for (const e of events) if (e.dir === 'st') { const rank = { sent: 1, delivered: 2, read: 3, failed: 9 }; if (!st[e.id] || rank[e.status] > rank[st[e.id].status]) st[e.id] = e; }
  const tm = t => new Date(t).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  const KIND = { stop: '🛑 وقف التذكير', start: '🔔 رجّع التذكير', other: '💬 رد' };
  const ST_AR = { sent: '✓ اتبعت', delivered: '✓✓ وصلت', read: '👁️ اتقرت', failed: '⚠️ موصلتش' };
  const rows = events.filter(e => e.dir !== 'st');
  const replies = rows.filter(e => e.dir === 'in').length, sent = rows.filter(e => e.dir === 'out' && !TEST_TO.has(e.to) && e.kind !== 'intro');   // تجارب د. يحيى على رقمه مش بتتحسب
  const read = sent.filter(e => st[e.id] && st[e.id].status === 'read').length;
  // اشترى بعد التذكير؟ فاتورة لنفس العميل من يوم الإرسال لحد ROI_DAYS يوم بعده (من crm/visits — بتتحدّث كل يوم الصبح)
  const day = cairoDay;
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const HOLDLOG = await loadHold().catch(() => ({}));
  const today = day(Date.now()), matureBy = plus(today, -(ROI_DAYS + 1));       // الأيام اللي استنينا فيها ROI_DAYS كاملة وفاتورة آخر يوم فيهم اتحدّثت
  const bought = {};
  for (const e of sent) {
    const d0 = day(e.t), d1 = plus(d0, ROI_DAYS);
    const v = ((VIS || {})[String(e.code)] || []).filter(([d]) => d >= d0 && d <= d1);
    if (v.length) bought[e.id || e.t] = v.reduce((a, x) => a + x[1], 0);
  }
  const nb = Object.keys(bought).length, rev = Object.values(bought).reduce((a, x) => a + x, 0), cost = sent.length * 3.2;
  // المقارنة: اللي اتبعتلهم (اتجاب بإيد د. يحيى) قصاد مجموعة المقارنة العشوائية (محدش بعتلهم). بس اللي استنينا لهم ROI_DAYS+1 يوم كاملين.
  const rate = (pairs) => {                       // pairs: [[كود، يوم البداية]] — كل عميل مرة واحدة
    const seen = new Map(); for (const [c, d0] of pairs) if (!seen.has(c) || d0 < seen.get(c)) seen.set(c, d0);
    let n = 0, b = 0, v = 0;
    for (const [c, d0] of seen) { if (d0 > matureBy) continue; n++;
      const hit = ((VIS || {})[String(c)] || []).filter(([d]) => d >= d0 && d <= plus(d0, ROI_DAYS)); if (hit.length) { b++; v += hit.reduce((a, x) => a + x[1], 0); } }
    return { n, b, v, p: n ? b / n : 0 };
  };
  const rs = rate(sent.filter(e => !TEST_TO.has(e.to) && e.code).map(e => [String(e.code), day(e.t)]));
  const rh = rate(Object.entries(HOLDLOG));
  const pc = x => Math.round(x * 100);
  let cmp = '';
  if (rs.n < 10 || rh.n < 10) {
    cmp = `<div class="sub" style="font-size:12px;margin-top:6px">🧪 المقارنة قصاد مجموعة محدش بعتلهم: لسه بدري — محتاجين 10 عملاء على الأقل في كل جهة، واستنى ${ROI_DAYS + 1} يوم بعد كل تذكير (دلوقتي: اتبعتلهم ${rs.n} · المقارنة ${rh.n}).</div>`;
  } else {
    const avgT = rs.b ? rs.v / rs.b : 0, extra = (rs.p - rh.p) * rs.n * avgT * 0.28 - rs.n * 3.2;
    cmp = `<div style="margin-top:8px">🧪 <b>الأثر الحقيقي:</b> اتبعتلهم: <b>${rs.b}</b> من ${rs.n} اشتروا (${pc(rs.p)}%) · مجموعة المقارنة (محدش بعتلهم): <b>${rh.b}</b> من ${rh.n} (${pc(rh.p)}%)
      → الفرق <b>${pc(rs.p - rh.p) >= 0 ? '+' : ''}${pc(rs.p - rh.p)}</b> نقطة · الربح الإضافي التقريبي بعد التكلفة ≈ <b>${N(extra)}</b> ج
      <div class="sub" style="font-size:12px">مؤشر مش دليل قاطع: اللي اتبعتلهم انت اخترتهم بإيدك (بتختار الأحسن)، ومجموعة المقارنة عشوائية.</div></div>`;
  }
  const roi = sent.length ? `<div class="banner" style="background:#EAF7F1">💰 مشتريات اللي اتبعتلهم: <b>${nb}</b> من ${sent.length} اشتروا خلال ${ROI_DAYS} أيام بـ <b>${N(rev)}</b> ج · التكلفة ≈ ${N(cost)} ج
      <div class="sub" style="font-size:12px">ده مش كله بسبب التذكير — جزء منهم كان هيشتري لوحده لأن ميعاده قرّب. المشتريات بتتحدّث كل يوم الصبح (فاتورة النهارده بتظهر بكره).</div>${cmp}</div>` : '';
  body.innerHTML = `<p class="sub">آخر 30 يوم: اتبعت <b>${sent.length}</b> · اتقرى <b>${read}</b> · ردود على الرقم <b>${replies}</b>.
    دوسة «جهزوا طلبي» بتفتح واتساب 012 والأصناف مكتوبة في رسالة العميل — بتوصل الفريق هناك ومش بتظهر هنا. والردود الكتابية على الرقم ده بتتبلّغ لجروب الفرع كمان.</p>${roi}
    ${rows.map(e => e.dir === 'in'
      ? `<div class="ev"><div class="t">${tm(e.t)}</div><div><b>${KIND[e.kind] || '💬'}</b> من ${esc(who(e.from))}${e.text && e.kind === 'other' ? `<div class="sub">«${esc(e.text)}»</div>` : ''}</div></div>`
      : `<div class="ev"><div class="t">${tm(e.t)}</div><div>📤 تذكير لـ ${esc(who(e.to))} «${esc(e.name)}» — ${esc(ST_AR[st[e.id] && st[e.id].status] || '✓ اتبعت')}${st[e.id] && (st[e.id].err || st[e.id].ecode) ? ` (${esc(ECODE[st[e.id].ecode] || st[e.id].err)})` : ''}${bought[e.id || e.t] ? ` · <b style="color:#0B6E66">🛒 اشترى بـ ${N(bought[e.id || e.t])} ج</b>` : ''}</div></div>`).join('') || '<p class="sub">لسه مفيش حاجة.</p>'}`;
}

/* ---------- الدخول ---------- */
export async function mountWhatsApp(root) {
  ROOT = root; root.id = 'waRoot'; DB = getFirestore(getApp()); LOCAL = null; css(); shell(); stats(); render();
}
// للتجربة المحلية من غير Firestore
export function mountLocal(root, data) {
  ROOT = root; root.id = 'waRoot'; LOCAL = data; css(); shell(); stats(); render();
}
