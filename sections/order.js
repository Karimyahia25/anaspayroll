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

let LOCAL = false, ROOT, DB, ROLE, WHO, DATE = '', AT = '', ROWS = [], DONE = {}, SAVED = null, SAVING = false, ST = { sheet: 'meds', hide: false, miss: false, open: {} }, UNSUB = null,
  RECV = null, RECV_TO = '', LATEST = '', LATEST_AT = '';   // RECV = اللي وصل من فواتير الشرا (السيرفر بيكتبه في orders/<التاريخ>_recv)

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
#ordRoot .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0F1B2D;color:#fff;padding:10px 18px;border-radius:12px;z-index:80;font-size:14px}
`;
  document.head.appendChild(s);
}

const canEdit = () => ROLE === 'admin' || ROLE === 'buyer';
const doneRef = () => doc(DB, 'orders', DATE + '_done');
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2000); }
const nowCairo = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(11, 16);

async function tick(code) {
  if (!canEdit()) return;
  const k = String(code), was = !!DONE[k];
  if (was) delete DONE[k]; else DONE[k] = { by: WHO, at: nowCairo() };      // يبان فوراً، والحفظ في الخلفية
  render();
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
  return d.filter(k => !s[k]).length + Object.keys(s).filter(k => !DONE[k]).length;
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
  return { st, q, sups, need };
}

async function loadDate(d) {
  const o = await getDoc(doc(DB, 'orders', d));
  if (!o.exists()) { toast('مفيش طلبية يوم ' + d.split('-').reverse().join('/')); return false; }
  DATE = d; ROWS = JSON.parse(o.data().d || '[]');
  AT = d === LATEST ? LATEST_AT : String(o.data().at || '').slice(11);
  RECV = null; RECV_TO = '';
  try { const r = await getDoc(doc(DB, 'orders', d + '_recv')); if (r.exists()) { RECV = JSON.parse(r.data().d || '{}'); RECV_TO = r.data().to || ''; } } catch (e) {}
  if (UNSUB) UNSUB();
  UNSUB = onSnapshot(doneRef(), s => { DONE = (s.exists() && s.data().t) || {}; SAVED = (s.exists() && s.data().saved) || null; render(); }, () => render());
  return true;
}
const shiftDay = (d, k) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };

function render() {
  const all = ROWS.length, done = ROWS.filter(r => DONE[r.code]).length;
  const rows = ROWS.filter(r => r.sheet === ST.sheet);
  const rs = {}; ROWS.forEach(r => { const x = recvOf(r); if (x) rs[x.st] = (rs[x.st] || 0) + 1; });
  const keep = r => !(ST.hide && DONE[r.code]) && !(ST.miss && !['none', 'part', 'other'].includes((recvOf(r) || {}).st));
  // الموردين: الأكتر أصناف الأول، و"مورد مش محدد" في الآخر — نفس ترتيب الإكسل
  const g = {};
  rows.forEach(r => (g[r.sup] ||= []).push(r));
  const sups = Object.keys(g).sort((a, b) => (a === 'مورد مش محدد') - (b === 'مورد مش محدد') || g[b].length - g[a].length);
  const cnt = k => ROWS.filter(r => r.sheet === k).length, cntDone = k => ROWS.filter(r => r.sheet === k && DONE[r.code]).length;
  ROOT.innerHTML = `
    <div class="ohd"><h2>🛒 طلبية النواقص — ${esc(DATE.split('-').reverse().join('/'))}</h2>
      <div class="s">اتعملت من رصيد السيستم الساعة ${esc(AT)} · اتطلب <b>${done}</b> من ${all} صنف${canEdit() ? ' · علّم على اللي اتطلب، وفي الآخر دوس «حفظ الطلبية»' : ''}</div>
      <div class="bar"><i style="width:${all ? (100 * done / all).toFixed(1) : 0}%"></i></div>
      ${RECV ? `<div class="rsum">📦 اللي وصل لحد ${esc(RECV_TO.slice(11))} ${esc(RECV_TO.slice(8, 10) + '/' + RECV_TO.slice(5, 7))}${SAVED ? '' : ' <small>(الطلبية متحفظتش — بالعلامات)</small>'}:
        ${Object.keys(RC).map(k => `<span class="rc ${k}">${RC[k]} ${rs[k] || 0}</span>`).join(' ')}${rs.extra ? ` <span class="rc extra">📦 وصل من غير علامة ${rs.extra}</span>` : ''}</div>` : ''}
      ${LOCAL ? '' : `<div class="nav"><button data-day="-1">‹ طلبية اليوم اللي قبله</button>${DATE < LATEST ? '<button data-day="1">اليوم اللي بعده ›</button>' : ''}</div>`}</div>
    <div class="tabs2">${SHEETS.map(([k, t]) => `<button class="${ST.sheet === k ? 'on' : ''}" data-sh="${k}">${t} <small>(${cntDone(k)}/${cnt(k)})</small></button>`).join('')}
      <label><input type="checkbox" id="ohide" ${ST.hide ? 'checked' : ''}> خبّي اللي اتطلب</label>
      ${RECV ? `<label><input type="checkbox" id="omiss" ${ST.miss ? 'checked' : ''}> اللي موصلش أو فيه مشكلة بس</label>` : ''}
      ${canEdit() ? (() => { const u = unsaved(), ok = SAVED && !u;
        return `<button class="save ${ok ? 'ok' : ''}" id="osave" ${SAVING ? 'disabled' : ''}>${SAVING ? 'جاري الحفظ…' : ok ? '✔ الطلبية محفوظة' : SAVED ? `💾 حفظ التعديلات (${u})` : '💾 حفظ الطلبية'}</button>`; })() : ''}
      ${SAVED ? `<div class="savedat">آخر حفظ الساعة ${esc(SAVED.at)}${SAVED.by ? ' — ' + esc(SAVED.by) : ''} · ${SAVED.n} صنف</div>` : ''}</div>
    ${sups.map((s, i) => {
      const list = g[s], d = list.filter(r => DONE[r.code]).length, cost = list.reduce((a, r) => a + (r.cost || 0), 0);
      const shown = list.filter(keep);
      const closed = ST.open[s] === false;
      return `<div class="grp"><div class="gh" data-g="${esc(s)}" style="background:${GRP_COLORS[i % GRP_COLORS.length]}">
          <span>🏷️ ${esc(s)} <span class="n">— ${list.length} صنف · حوالي ${N(cost)} ج</span></span>
          <span>${d === list.length ? '<span class="done">✔ خلص</span>' : `<span class="n">${d}/${list.length}</span>`} ${closed ? '▸' : '▾'}</span></div>
        ${closed ? '' : shown.map(row).join('')}</div>`;
    }).join('') || '<div class="banner">مفيش نواقص في القسم ده 🎉</div>'}`;
  ROOT.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ST.sheet = b.dataset.sh; render(); });
  if ($('#osave', ROOT)) $('#osave', ROOT).onclick = saveOrder;
  $('#ohide', ROOT).onchange = e => { ST.hide = e.target.checked; render(); };
  if ($('#omiss', ROOT)) $('#omiss', ROOT).onchange = e => { ST.miss = e.target.checked; render(); };
  ROOT.querySelectorAll('[data-day]').forEach(b => b.onclick = async () => { if (await loadDate(shiftDay(DATE, +b.dataset.day))) render(); });
  ROOT.querySelectorAll('[data-g]').forEach(h => h.onclick = () => { const k = h.dataset.g; ST.open[k] = ST.open[k] === false; render(); });
  ROOT.querySelectorAll('[data-code]').forEach(b => b.onclick = () => tick(+b.dataset.code));
}

function row(r) {
  const D = DONE[r.code], R = recvOf(r), qq = n => String(Math.round(n * 100) / 100);
  const rc = !R ? '' : `<br><span class="rc ${R.st}">${R.st === 'extra' ? '📦 وصل من غير علامة' : RC[R.st]}${R.q > 0 ? ` — ${qq(R.q)}${R.need ? ' من ' + R.need : ''} من ${esc(R.sups.join('، '))}` : ''}</span>`;
  return `<div class="row ${D ? 'ok' : ''}">
    <button class="chk ${D ? 'on' : ''}" data-code="${r.code}" ${canEdit() ? '' : 'disabled'} aria-label="تم الطلب">${D ? '✓' : ''}</button>
    <div><div class="nm">${esc(r.name)}</div>
      <div class="mt"><span class="abc ${r.abc}">${r.abc}</span>كود ${r.code} · الرصيد <span class="${r.oos ? 'oos' : ''}">${esc(r.stock)}</span>
        · خصم المورد ده <b class="sd">${P(r.sd)}%</b>
        ${r.lsup ? `<br>آخر شرا ${esc(r.last)} من <span class="${r.gap != null ? 'yel' : ''}">${esc(r.lsup)} ${P(r.ld)}%</span>${r.gap != null ? ` <span class="yel">أقل بـ ${P(r.gap)}</span>` : ''}` : ''}
        ${r.up ? ' · <span class="up">⚠ السعر زاد</span>' : ''}${r.sea ? ' · <span class="sea">☀️ صيفي — بمعدل آخر 30 يوم</span>' : ''}
        ${D ? `<br><span class="by">✔ اتطلب${D.by ? ' — ' + esc(D.by) : ''}${D.at ? ' الساعة ' + esc(D.at) : ''}</span>` : ''}${rc}</div></div>
    <div class="need"><div class="v">${r.need}</div><div class="l">علبة</div></div></div>`;
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
function hit(x) {
  const cls = x.w.startsWith('🛒') ? 'go' : x.o ? 'out' : '';
  const D = DONE[x.c];
  return `<div class="hit"><div class="nm">${esc(x.n)}</div>
    <div class="mt">${x.a !== '-' ? `<span class="abc ${x.a}">${x.a}</span>` : ''}كود ${x.c}${x.k ? ' · ' + esc(x.k) : ''} · ${x.sh === 'supply' ? 'مستلزمات وتجميل' : 'أدوية'}
      <br>الرصيد <span class="${x.o ? 'oos' : ''}">${esc(x.st)}</span>${x.cv != null ? ` · يكفي <span class="cv">${x.cv} يوم</span>` : ''}${x.m ? ` · بيتباع ~${P(x.m)} علبة/شهر` : ''}${x.se ? ' · <span class="sea">☀️ صيفي</span>' : ''}
      <br>أحسن مورد: <b>${esc(x.s)}</b>${x.sd != null ? ` <b class="sd">${P(x.sd)}%</b>` : ''}
      ${x.ls ? `<br>آخر شرا ${esc(x.l)} من ${esc(x.ls)}${x.ld != null ? ' ' + P(x.ld) + '%' : ''}` : '<br>مفيش شرا آخر سنة'}
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
  } catch (e) {
    ROOT.innerHTML = `<div class="banner bad">مقدرتش أقرا الطلبية: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; return;
  }
  render();
}

// تجربة محلية (_crmtest/order.html) — من غير Firebase
export function mountOrderLocal(root, rows, role = 'admin', recv = null, cat = null) {
  LOCAL = true; ROLE = role; WHO = 'تجربة'; ROWS = rows; DATE = LATEST = '2026-10-23'; AT = '14:05'; DONE = {}; SAVED = null;
  RECV = recv; RECV_TO = '2026-10-24 06:00'; css(); root.id = 'ordRoot';
  root.innerHTML = '<div></div><div></div>';
  CAT = cat || []; CAT.forEach(x => x._n = norm(x.n)); CAT_AT = '20/10 الساعة 06:00';
  mountSearch(root.children[0]); ROOT = root.children[1]; render();
}
