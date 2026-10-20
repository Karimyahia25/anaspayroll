// قسم متابعة العملاء (21/10) — بيتحمّل أول ما تفتح تبويب "العملاء".
// القوايم بيحسبها سيرفر الصيدلية كل يوم 6 الصبح (الجرعة + عادة العميل) وبيكتبها في crm/meta + crm/list_N + crm/visits.
// التواصل بيتسجل في crm_log. "اشترى" بيتعرف لوحده: فاتورة للعميل بعد يوم التواصل بـ 14 يوم أو أقل (من crm/visits).
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, collection, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const M = n => N(n) + ' ج';
const D = s => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${+d}/${+m}`; };
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);       // تاريخ القاهرة
const addDays = (s, n) => { const t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const LISTS = [['قرّب', '⏰ ميعاده قرّب', 'ابعتله قبل ما يخلص — ومعاه التوصيل في 30 دقيقة'],
               ['اتأخر', '⚠️ اتأخر', 'عدّى ميعاده ومجاش — يمكن جاب من برا أو نسي'],
               ['بعد', '💔 بعد عننا', 'مجاش خالص من أكتر من شهرين — رسالة الاسترجاع']];
const GRP = { med: ['دوا', '#0B8577'], diaper: ['حفاضات', '#2A6FB0'], milk: ['لبن أطفال', '#6B5BA8'], adult: ['كبار السن', '#7F8C8D'], cosmo: ['تجميل', '#C2417A'] };
const RES = [['تم', '✅ اتكلمنا', 'ok'], ['مردش', '📵 مردش', 'nr'], ['مش مهتم', '🙅 مش مهتم', 'no'], ['رقم غلط', '☎️ رقم غلط', 'bad']];
const WINDOW = 14;            // اشترى خلال 14 يوم من التواصل = نجاح
const RETRY_NR = 2;           // مردش: يرجع يظهر بعد يومين

let ROOT, ROLE, DB = null, LOCAL = null, META = {}, CARDS = [], VIS = {}, LOG = [];
let ST = { tab: 'قرّب', q: '', grp: '', leak: false, deliv: false, hideDone: true, shown: 40 };

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
  LOG = (await getDocs(collection(DB, 'crm_log'))).docs.map(d => ({ _id: d.id, ...d.data() }));
  return true;
}
async function saveLog(rec) {
  if (LOCAL) { rec._id = 'L' + Date.now(); LOG.push(rec); return; }
  const r = await addDoc(collection(DB, 'crm_log'), rec); rec._id = r.id; LOG.push(rec);
}
async function delLog(id) {
  if (!LOCAL) await deleteDoc(doc(DB, 'crm_log', id));
  LOG = LOG.filter(x => x._id !== id);
}

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
  const n = META.n || {}, v = META.value || {}, wk = results(7);
  $('#ckpi', ROOT).innerHTML = `
    <div><div class="l">عملاء متابعين</div><div class="v">${N(META.tracked)}</div></div>
    <div style="border-color:#2A6FB0"><div class="l">ميعادهم قرّب</div><div class="v">${N(n['قرّب'])}</div><div class="l">${M(v['قرّب'])}/شهر</div></div>
    <div style="border-color:#B0761F"><div class="l">اتأخروا</div><div class="v">${N(n['اتأخر'])}</div><div class="l">${M(v['اتأخر'])}/شهر</div></div>
    <div style="border-color:#1B7F3B"><div class="l">اشتروا بعد التواصل (7 أيام)</div><div class="v">${N(wk.won.length)}</div><div class="l">${M(wk.rev)}</div></div>`;
  $('#cmeta', ROOT).textContent = `آخر تحديث من السيرفر: ${META.at || '—'} · الأرقام على مشتريات لحد ${D(META.ref)}`;
}
function bar() {
  const cnt = s => CARDS.filter(c => c.status === s && !(ST.hideDone && contactedRecently(c))).length;
  $('#cbar', ROOT).innerHTML = LISTS.map(([k, t]) => `<button class="${ST.tab === k ? 'on' : ''}" data-tab="${k}">${t}<span class="n">${cnt(k)}</span></button>`).join('')
    + `<button class="${ST.tab === 'res' ? 'on' : ''}" data-tab="res">📈 النتايج</button>`
    + `<button class="${ST.tab === 'log' ? 'on' : ''}" data-tab="log">🗂️ سجل التواصل<span class="n">${LOG.length}</span></button>`;
  $('#cbar', ROOT).querySelectorAll('button').forEach(b => b.onclick = () => { ST.tab = b.dataset.tab; ST.shown = 40; render(); });
}
function filtered() {
  const q = ST.q.trim().toLowerCase();
  return CARDS.filter(c => c.status === ST.tab
    && (!ST.grp || c.grp.includes(ST.grp)) && (!ST.leak || c.leak) && (!ST.deliv || c.deliv)
    && !(ST.hideDone && contactedRecently(c))
    && (!q || c.name.toLowerCase().includes(q) || c.phones.join(' ').includes(q) || c.items.some(i => String(i[0]).toLowerCase().includes(q))));
}
function card(c) {
  const g = GRP[c.grp[0]] || GRP.med, L = logsOf(c.id)[0], won = L && boughtAfter(L), edit = ROLE === 'admin';
  const when = c.status === 'قرّب' ? (c.late === 0 ? 'ميعاده النهارده' : `باقي ${-c.late} يوم`) : `متأخر ${c.late} يوم`;
  const its = c.items.map(([lb, ev, src, dose, due, lk]) => `<li><span>${esc(lb)}${lk ? ' <span class="bd lk">من برا؟</span>' : ''}</span>
      <span class="s">كل ${ev} يوم (${esc(src)})${src === 'عادته' && dose ? ` · الجرعة ${dose}` : ''} · ${D(due)}</span></li>`).join('');
  const last = L ? `<div class="last ${won ? 'win' : ''}">${won ? `✅ اشترى بعد التواصل: ${M(won.amt)} يوم ${D(won.day)} — ` : ''}
      آخر تواصل: ${esc(L.result)} يوم ${D(L.day)}${L.byName ? ' (' + esc(L.byName) + ')' : ''}${L.note ? ' — ' + esc(L.note) : ''}</div>` : '';
  return `<div class="cc ${contactedRecently(c) ? 'done' : ''}" style="--g:${g[1]}" data-id="${c.id}">
    <div class="top"><div><h4>${esc(c.name)}</h4>
      <div class="meta">${c.grp.map(x => `<span class="bd" style="background:${(GRP[x] || GRP.med)[1]}">${(GRP[x] || GRP.med)[0]}</span>`).join('')}
        ${c.deliv ? '<span class="bd dl">عميل توصيل</span>' : ''}${c.leak ? '<span class="bd lk">غالباً بيجيب جزء من برا</span>' : ''}
        <br>${when} · آخر زيارة من ${c.visit == null ? '—' : c.visit + ' يوم'}${c.area && c.area !== 'مش متسجل' ? ' · ' + esc(c.area) : ''}</div></div>
      <div class="val">${M(c.monthly)}<div class="meta" style="text-align:left">في الشهر</div></div></div>
    <ul class="its">${its}</ul>
    <div class="ph">${c.phones.length ? c.phones.map(p => `<a href="tel:${p}">📞 ${p}</a>`).join('') : '<span class="meta">مفيش رقم متسجل</span>'}</div>
    <details class="msg"><summary>الرسالة</summary><pre>${esc(c.msg)}</pre></details>
    <div class="act"><button class="ghost" data-copy="${c.id}">📋 نسخ الرسالة</button>
      ${edit ? RES.map(([k, t, cl]) => `<button class="r-${cl}" data-res="${k}" data-id="${c.id}">${t}</button>`).join('') : ''}</div>
    ${last}</div>`;
}
function listView() {
  const L = LISTS.find(x => x[0] === ST.tab), rows = filtered();
  const grps = Object.entries(GRP).map(([k, [t]]) => `<button class="chip ${ST.grp === k ? 'on' : ''}" data-grp="${k}">${t}</button>`).join('');
  $('#cbody', ROOT).innerHTML = `<p class="why"><b>${L[1]}</b> — ${L[2]}. مترتبين بقيمة العميل في الشهر.</p>
    <div class="ctl"><input type="search" id="cq" placeholder="دوّر باسم العميل أو التليفون أو الصنف" value="${esc(ST.q)}"></div>
    <div class="ctl chips"><button class="chip ${!ST.grp ? 'on' : ''}" data-grp="">الكل</button>${grps}
      <label class="chip"><input type="checkbox" id="cleak" ${ST.leak ? 'checked' : ''}> بيجيب من برا</label>
      <label class="chip"><input type="checkbox" id="cdel" ${ST.deliv ? 'checked' : ''}> عملاء توصيل</label>
      <label class="chip"><input type="checkbox" id="chide" ${ST.hideDone ? 'checked' : ''}> خبّي اللي اتكلموا</label></div>
    <div id="clist">${rows.slice(0, ST.shown).map(card).join('') || '<div class="banner">مفيش حد في القايمة دي بالفلاتر دي.</div>'}</div>
    ${rows.length > ST.shown ? `<button class="ghost more" id="cmore">عرض المزيد (${rows.length - ST.shown})</button>` : ''}`;
  const b = $('#cbody', ROOT);
  $('#cq', b).oninput = e => { ST.q = e.target.value; ST.shown = 40; const p = e.target.selectionStart; listView(); const i = $('#cq', ROOT); i.focus(); i.setSelectionRange(p, p); };
  b.querySelectorAll('[data-grp]').forEach(x => x.onclick = () => { ST.grp = x.dataset.grp; ST.shown = 40; listView(); });
  $('#cleak', b).onchange = e => { ST.leak = e.target.checked; listView(); };
  $('#cdel', b).onchange = e => { ST.deliv = e.target.checked; listView(); };
  $('#chide', b).onchange = e => { ST.hideDone = e.target.checked; render(); };
  if ($('#cmore', b)) $('#cmore', b).onclick = () => { ST.shown += 40; listView(); };
  b.querySelectorAll('[data-copy]').forEach(x => x.onclick = () => copy(CARDS.find(c => c.id === +x.dataset.copy).msg));
  b.querySelectorAll('[data-res]').forEach(x => x.onclick = () => record(+x.dataset.id, x.dataset.res, x));
}
async function record(id, result, btn) {
  const c = CARDS.find(x => x.id === id); let note = '';
  if (result === 'تم') note = (prompt('ملاحظة (اختياري) — مثلاً: هيعدّي بكرة / عايز توصيل', '') || '').trim();
  const me = LOCAL ? { uid: 'local' } : getAuth(getApp()).currentUser;
  const rec = { cust: id, name: c.name, result, note, list: c.status, monthly: c.monthly, day: today(), at: new Date().toISOString(),
                by: me.uid, byName: 'مدير الفرع' };
  btn.disabled = true;
  try { await saveLog(rec); toast('اتسجّل: ' + result); render(); }
  catch (e) { btn.disabled = false; toast('متسجلش: ' + (e.code || e.message)); }
}
function results(days) {
  const from = addDays(today(), -days), recs = LOG.filter(x => x.day >= from);
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
  $('#cbody', ROOT).innerHTML = `<p class="why">"اشترى بعد التواصل" بيتحسب لوحده: أي فاتورة للعميل من يوم المكالمة لحد ${WINDOW} يوم بعدها (من السيستم، مش بالزرار).
    الفلوس = كل اللي اشتراه في الفترة دي.</p>${blocks}`;
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
function render() { kpis(); bar(); if (ST.tab === 'res') resView(); else if (ST.tab === 'log') logView(); else listView(); }

/* ---------- أدوات ---------- */
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
async function copy(t) {
  try { await navigator.clipboard.writeText(t); toast('الرسالة اتنسخت ✓'); return; } catch (e) { /* متصفح جوه واتساب/فيسبوك */ }
  const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* */ }
  a.remove(); if (ok) { toast('الرسالة اتنسخت ✓'); return; }
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
// للتجربة المحلية من غير Firestore
export function mountLocal(root, data, role = 'admin') { ROOT = root; ROLE = role; LOCAL = data; css(); root.id = 'crmRoot'; load(); shell(); render(); }
