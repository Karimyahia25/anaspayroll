// تبويب «💬 واتساب» (23/11، طلب د. يحيى) — للأدمن بس: تذكير الطلب الشهري من رقم الواتساب الرسمي (+20 10 50822954).
// القايمة: crm/wa_list (السيرفر بيحسبها كل يوم مع قوايم العملاء — سوشيال/مزمن/لبن/حفاضات/فيتامينات، قريبين، ميعادهم قرّب).
// البحث: كل العملاء المسجلين (crm_hist/cust_N) بالاسم أو الموبايل.
// الإرسال والردود: Worker anas-wa مباشرة (POST /send، GET /events، /stats) بمفتاح الأدمن — بيتحفظ على الجهاز ده بس (localStorage).
// الحمايات في الـ Worker نفسه: اللي داس «وقف التذكير» ميتبعتلوش · 20 يوم بين تذكيرين لنفس الرقم · حد يومي.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
let ST = { tab: 'list', soc: false, sel: new Set(), q: '', shown: 40, busy: false, res: {} };

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
    <p class="sub" style="margin:0 0 6px">الرسالة: «السلام عليكم <b>الاسم</b> 👋 … معاد تجديد طلبك الشهري قرّب. تحب نجهزهولك ونوصلهولك لحد البيت؟» + زراير «جهزوا طلبي» و«اسأل الصيدلي» (بيفتحوا واتساب 012 بكود العميل) و«وقف التذكير». ~3.2 ج للرسالة.</p>
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
    const s = await api('/stats');
    el.innerHTML = `<span class="pill">النهارده <b>${s.sent}</b> من ${s.max}</span><span class="pill">الشهر <b>${s.month}</b> ≈ ${N(s.month * 3.2)} ج</span>`;
    ST.left = Math.max(0, (s.max || 30) - s.sent);
  } catch (e) { el.innerHTML = `<span class="pill">⚠️ ${esc(e.message)}</span>`; }
}

/* ---------- العرض ---------- */
async function render() {
  ROOT.querySelectorAll('.wtabs button').forEach(b => b.classList.toggle('on', b.dataset.t === ST.tab));
  const body = $('#waBody', ROOT);
  body.innerHTML = '<p class="sub">جاري التحميل…</p>';
  try {
    if (ST.tab === 'list') await renderList(body);
    else if (ST.tab === 'search') await renderSearch(body);
    else await renderEvents(body);
  } catch (e) { body.innerHTML = `<div class="banner bad">مقدرتش أحمّل: ${esc(e.code || e.message)}</div>`; }
}

function rowHtml(r, i) {
  const late = /اتأخر/.test(r['الحالة'] || '');
  const res = ST.res[r['الكود']];
  return `<label class="wrow${ST.sel.has(r['الكود']) ? ' sel' : ''}">
    <input type="checkbox" data-c="${r['الكود']}" ${ST.sel.has(r['الكود']) ? 'checked' : ''}>
    <div class="wmain">
      <div class="wname">${esc(String(r['العميل']).replace(/\*/g, ''))} ${r['سوشيال'] ? '<span class="tag soc">سوشيال</span>' : ''}</div>
      <div class="wsub">
        <span class="tag">${esc(r['المجموعة'])}</span><span class="tag ${late ? 'late' : ''}">${esc(r['الحالة'])}</span>
        <br>${esc(r['الأصناف'])}
        <br>📍 ${esc(r['المنطقة'])} · اشترى ${r['مرات الشرا']} مرة · ~${N(r['قيمته في الشهر'])} ج/شهر · الكود ${r['الكود']}
        <br>في الرسالة: <b>${esc(r['الاسم في الرسالة'])}</b> · 📱 ${esc(r['الموبايل'])}
      </div>
      ${res ? `<div class="res">${esc(res)}</div>` : ''}
    </div></label>`;
}

async function renderList(body) {
  const L = await loadList();
  let rows = (L.rows || []).filter(r => !ST.soc || r['سوشيال']);
  const skip = Object.entries(L.skip || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');
  body.innerHTML = `
    <p class="sub">${L.at ? `اتحسبت ${esc(dm(L.at))} (آخر فاتورة ${esc(dm(L.ref))})` : 'لسه مفيش قايمة — بتتعمل مع قوايم العملاء كل يوم الصبح.'} — <b>${rows.length}</b> عميل${skip ? ` · اتشال: ${esc(skip)}` : ''}</p>
    <label style="display:inline-flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" id="waSoc" ${ST.soc ? 'checked' : ''}> سوشيال بس</label>
    <div id="waRows">${rows.slice(0, ST.shown).map(rowHtml).join('')}</div>
    ${rows.length > ST.shown ? `<button class="ghost" id="waMore">اعرض ${Math.min(40, rows.length - ST.shown)} كمان</button>` : ''}
    <div class="bar"><button id="waSend" ${ST.sel.size ? '' : 'disabled'}>📤 ابعت للمحددين (${ST.sel.size})</button>
      <button class="ghost" id="waClr" ${ST.sel.size ? '' : 'disabled'}>إلغاء التحديد</button>
      <span class="sub" id="waProg"></span></div>`;
  $('#waSoc', body).onchange = e => { ST.soc = e.target.checked; ST.shown = 40; render(); };
  const more = $('#waMore', body); if (more) more.onclick = () => { ST.shown += 40; render(); };
  body.querySelectorAll('input[data-c]').forEach(cb => cb.onchange = () => {
    const c = +cb.dataset.c; cb.checked ? ST.sel.add(c) : ST.sel.delete(c); render(); });
  $('#waClr', body).onclick = () => { ST.sel.clear(); render(); };
  $('#waSend', body).onclick = () => sendMany((L.rows || []).filter(r => ST.sel.has(r['الكود'])).map(r => ({
    code: r['الكود'], label: String(r['العميل']).replace(/\*/g, ''), name: r['الاسم في الرسالة'], phone: r['الموبايل'] })));
}

async function sendMany(list) {
  if (!ls.get(KEY_LS)) { alert('حط مفتاح الإرسال الأول (فوق).'); return; }
  if (!list.length || ST.busy) return;
  if (list.length > 20) { alert('الحد 20 عميل في المرة.'); return; }
  const cost = Math.round(list.length * 3.2);
  if (!confirm(`هبعت تذكير لـ ${list.length} عميل (≈ ${cost} ج):\n\n` + list.map(x => `• ${x.label} — «${x.name}»`).join('\n') + '\n\nمتأكد؟')) return;
  ST.busy = true; let ok = 0;
  for (const [i, x] of list.entries()) {
    const p = $('#waProg', ROOT); if (p) p.textContent = `⏳ ${i + 1} من ${list.length}…`;
    try {
      const j = await api('/send', { method: 'POST', body: JSON.stringify({ to: waNum(x.phone), name: x.name, code: String(x.code) }) });
      ST.res[x.code] = j.ok ? '✅ اتبعت' : '⚠️ ' + ({ optout: 'داس «وقف التذكير» قبل كده', 'recently reminded': 'اتبعتله تذكير من أقل من 20 يوم', 'bad input': 'الرقم أو الكود مش مظبوط' }[j.error] || j.error);
      if (j.ok) { ok++; ST.sel.delete(x.code); }
    } catch (e) { ST.res[x.code] = '⚠️ ' + e.message; }
  }
  ST.busy = false;
  alert(`اتبعت ${ok} من ${list.length}. النتيجة جنب كل اسم.`);
  stats(); render();
}

async function renderSearch(body) {
  body.innerHTML = `<input class="wq" id="waQ" placeholder="اكتب اسم العميل أو رقم موبايله" value="${esc(ST.q)}" autocomplete="off">
    <p class="sub" id="waQInfo">بيدوّر في كل العملاء المسجلين اللي اشتروا من 2024.</p><div id="waQRes"></div>`;
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
    sendMany([{ code: +id, label: String(c[0]).replace(/\*/g, ''), name, phone: c[1][0] }]).then(search);
  });
}

async function renderEvents(body) {
  if (!ls.get(KEY_LS)) { body.innerHTML = '<div class="banner">حط مفتاح الإرسال الأول (فوق) علشان تشوف الردود.</div>'; return; }
  const [{ events }] = await Promise.all([api('/events?limit=300'), loadCust().catch(() => null)]);
  const who = n => { const x = PHONE_IX && PHONE_IX[n]; return x ? `${String(x.name).replace(/\*/g, '')} (${x.id})` : '0' + String(n).replace(/^20/, ''); };
  const st = {};
  for (const e of events) if (e.dir === 'st') { const rank = { sent: 1, delivered: 2, read: 3, failed: 9 }; if (!st[e.id] || rank[e.status] > rank[st[e.id].status]) st[e.id] = e; }
  const tm = t => new Date(t).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' });
  const KIND = { stop: '🛑 وقف التذكير', start: '🔔 رجّع التذكير', other: '💬 رد' };
  const ST_AR = { sent: '✓ اتبعت', delivered: '✓✓ وصلت', read: '👁️ اتقرت', failed: '⚠️ موصلتش' };
  const rows = events.filter(e => e.dir !== 'st');
  const replies = rows.filter(e => e.dir === 'in').length, sent = rows.filter(e => e.dir === 'out');
  const read = sent.filter(e => st[e.id] && st[e.id].status === 'read').length;
  body.innerHTML = `<p class="sub">آخر 30 يوم: اتبعت <b>${sent.length}</b> · اتقرى <b>${read}</b> · ردود على الرقم <b>${replies}</b>.
    دوسة «جهزوا طلبي» بتفتح واتساب 012 — بتوصل الفريق هناك بالكود، ومش بتظهر هنا.</p>
    ${rows.map(e => e.dir === 'in'
      ? `<div class="ev"><div class="t">${tm(e.t)}</div><div><b>${KIND[e.kind] || '💬'}</b> من ${esc(who(e.from))}${e.text && e.kind === 'other' ? `<div class="sub">«${esc(e.text)}»</div>` : ''}</div></div>`
      : `<div class="ev"><div class="t">${tm(e.t)}</div><div>📤 تذكير لـ ${esc(who(e.to))} «${esc(e.name)}» — ${esc(ST_AR[st[e.id] && st[e.id].status] || '✓ اتبعت')}${st[e.id] && st[e.id].err ? ` (${esc(st[e.id].err)})` : ''}</div></div>`).join('') || '<p class="sub">لسه مفيش حاجة.</p>'}`;
}

/* ---------- الدخول ---------- */
export async function mountWhatsApp(root) {
  ROOT = root; root.id = 'waRoot'; DB = getFirestore(getApp()); LOCAL = null; css(); shell(); stats(); render();
}
// للتجربة المحلية من غير Firestore
export function mountLocal(root, data) {
  ROOT = root; root.id = 'waRoot'; LOCAL = data; css(); shell(); stats(); render();
}
