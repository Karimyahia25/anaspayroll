// طلبية النواقص اليومية (23/10) — سيرفر الصيدلية بيحسبها من الداتا بيز (pharma fly/app/order.py) ويكتبها في orders/<التاريخ>.
// مقسمة بالمورد (أحسن خصم). «تم الطلب» = دوسة واحدة، بتتحفظ فوراً في orders/<التاريخ>_done وبتظهر عند الكل لايف.
// الأدمن ومسؤول المشتريات بيعلّموا، وصاحب الصيدلية بيشوف بس.
// «حفظ الطلبية» (23/10) = صورة نهائية باللي اتطلب (الكود + الكمية + المورد) في orders/<التاريخ>_done.saved —
// دي اللي هتتقارن بعدين باللي وصل الفرع فعلاً من فواتير الشرا.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const P = n => (n == null || isNaN(n)) ? '—' : (+n).toFixed(1);
const GRP_COLORS = ['#FFE8A3', '#C9F0E4', '#FFD6D6', '#D6E4FF', '#E9D8FD', '#FFE0C2', '#D2F4FA', '#E2F0CB'];
const SHEETS = [['meds', '💊 الأدوية'], ['supply', '🧴 المستلزمات والتجميل']];

let LOCAL = false, ROOT, DB, ROLE, WHO, DATE = '', AT = '', ROWS = [], DONE = {}, SAVED = null, SAVING = false, ST = { sheet: 'meds', hide: false, open: {} }, UNSUB = null;

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

function render() {
  const all = ROWS.length, done = ROWS.filter(r => DONE[r.code]).length;
  const rows = ROWS.filter(r => r.sheet === ST.sheet);
  // الموردين: الأكتر أصناف الأول، و"مورد مش محدد" في الآخر — نفس ترتيب الإكسل
  const g = {};
  rows.forEach(r => (g[r.sup] ||= []).push(r));
  const sups = Object.keys(g).sort((a, b) => (a === 'مورد مش محدد') - (b === 'مورد مش محدد') || g[b].length - g[a].length);
  const cnt = k => ROWS.filter(r => r.sheet === k).length, cntDone = k => ROWS.filter(r => r.sheet === k && DONE[r.code]).length;
  ROOT.innerHTML = `
    <div class="ohd"><h2>🛒 طلبية النواقص — ${esc(DATE.split('-').reverse().join('/'))}</h2>
      <div class="s">اتعملت من رصيد السيستم الساعة ${esc(AT)} · اتطلب <b>${done}</b> من ${all} صنف${canEdit() ? ' · علّم على اللي اتطلب، وفي الآخر دوس «حفظ الطلبية»' : ''}</div>
      <div class="bar"><i style="width:${all ? (100 * done / all).toFixed(1) : 0}%"></i></div></div>
    <div class="tabs2">${SHEETS.map(([k, t]) => `<button class="${ST.sheet === k ? 'on' : ''}" data-sh="${k}">${t} <small>(${cntDone(k)}/${cnt(k)})</small></button>`).join('')}
      <label><input type="checkbox" id="ohide" ${ST.hide ? 'checked' : ''}> خبّي اللي اتطلب</label>
      ${canEdit() ? (() => { const u = unsaved(), ok = SAVED && !u;
        return `<button class="save ${ok ? 'ok' : ''}" id="osave" ${SAVING ? 'disabled' : ''}>${SAVING ? 'جاري الحفظ…' : ok ? '✔ الطلبية محفوظة' : SAVED ? `💾 حفظ التعديلات (${u})` : '💾 حفظ الطلبية'}</button>`; })() : ''}
      ${SAVED ? `<div class="savedat">آخر حفظ الساعة ${esc(SAVED.at)}${SAVED.by ? ' — ' + esc(SAVED.by) : ''} · ${SAVED.n} صنف</div>` : ''}</div>
    ${sups.map((s, i) => {
      const list = g[s], d = list.filter(r => DONE[r.code]).length, cost = list.reduce((a, r) => a + (r.cost || 0), 0);
      const shown = ST.hide ? list.filter(r => !DONE[r.code]) : list;
      const closed = ST.open[s] === false;
      return `<div class="grp"><div class="gh" data-g="${esc(s)}" style="background:${GRP_COLORS[i % GRP_COLORS.length]}">
          <span>🏷️ ${esc(s)} <span class="n">— ${list.length} صنف · حوالي ${N(cost)} ج</span></span>
          <span>${d === list.length ? '<span class="done">✔ خلص</span>' : `<span class="n">${d}/${list.length}</span>`} ${closed ? '▸' : '▾'}</span></div>
        ${closed ? '' : shown.map(row).join('')}</div>`;
    }).join('') || '<div class="banner">مفيش نواقص في القسم ده 🎉</div>'}`;
  ROOT.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ST.sheet = b.dataset.sh; render(); });
  if ($('#osave', ROOT)) $('#osave', ROOT).onclick = saveOrder;
  $('#ohide', ROOT).onchange = e => { ST.hide = e.target.checked; render(); };
  ROOT.querySelectorAll('[data-g]').forEach(h => h.onclick = () => { const k = h.dataset.g; ST.open[k] = ST.open[k] === false; render(); });
  ROOT.querySelectorAll('[data-code]').forEach(b => b.onclick = () => tick(+b.dataset.code));
}

function row(r) {
  const D = DONE[r.code];
  return `<div class="row ${D ? 'ok' : ''}">
    <button class="chk ${D ? 'on' : ''}" data-code="${r.code}" ${canEdit() ? '' : 'disabled'} aria-label="تم الطلب">${D ? '✓' : ''}</button>
    <div><div class="nm">${esc(r.name)}</div>
      <div class="mt"><span class="abc ${r.abc}">${r.abc}</span>كود ${r.code} · الرصيد <span class="${r.oos ? 'oos' : ''}">${esc(r.stock)}</span>
        · خصم المورد ده <b class="sd">${P(r.sd)}%</b>
        ${r.lsup ? `<br>آخر شرا ${esc(r.last)} من <span class="${r.gap != null ? 'yel' : ''}">${esc(r.lsup)} ${P(r.ld)}%</span>${r.gap != null ? ` <span class="yel">أقل بـ ${P(r.gap)}</span>` : ''}` : ''}
        ${r.up ? ' · <span class="up">⚠ السعر زاد</span>' : ''}${r.sea ? ' · <span class="sea">☀️ صيفي — بمعدل آخر 30 يوم</span>' : ''}
        ${D ? `<br><span class="by">✔ اتطلب${D.by ? ' — ' + esc(D.by) : ''}${D.at ? ' الساعة ' + esc(D.at) : ''}</span>` : ''}</div></div>
    <div class="need"><div class="v">${r.need}</div><div class="l">علبة</div></div></div>`;
}

export async function mountOrder(root, role, who) {
  ROOT = root; ROLE = role; WHO = who || (role === 'admin' ? 'المدير' : 'المشتريات'); DB = getFirestore(getApp()); css(); root.id = 'ordRoot';
  root.innerHTML = '<div class="card"><p class="sub">جاري تحميل الطلبية…</p></div>';
  try {
    const L = await getDoc(doc(DB, 'orders', 'latest'));
    if (!L.exists()) { root.innerHTML = '<div class="banner">لسه مفيش طلبية — ابعت للبوت «طلبية» وهتظهر هنا.</div>'; return; }
    DATE = L.data().date; AT = (L.data().at || '') + (L.data().ver ? ' · نسخة ' + L.data().ver : '');
    const o = await getDoc(doc(DB, 'orders', DATE));
    ROWS = o.exists() ? JSON.parse(o.data().d) : [];
    if (UNSUB) UNSUB();
    UNSUB = onSnapshot(doneRef(), s => { DONE = (s.exists() && s.data().t) || {}; SAVED = (s.exists() && s.data().saved) || null; render(); }, () => render());
  } catch (e) {
    root.innerHTML = `<div class="banner bad">مقدرتش أقرا الطلبية: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</div>`; return;
  }
  render();
}

// تجربة محلية (_crmtest/order.html) — من غير Firebase
export function mountOrderLocal(root, rows, role = 'admin') {
  LOCAL = true; ROOT = root; ROLE = role; WHO = 'تجربة'; ROWS = rows; DATE = '2026-10-23'; AT = '14:05'; DONE = {}; SAVED = null; css(); root.id = 'ordRoot'; render();
}
