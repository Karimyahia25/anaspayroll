// قسم المخزون — داشبورد قرارات (بيتحمّل أول ما تفتح التبويب). البيانات بتتنشر من ملف inventory_bundle.json
// على Firestore (inventory/bundle_meta + bundle_items_N) — الأدمن بس بيرفع، والأدمن وصاحب الصيدلية بيشوفوا.
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const M = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US') + ' ج';
const K = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + ' مليون' : Math.abs(n) >= 1e3 ? Math.round(n / 1e3).toLocaleString('en-US') + ' ألف' : Math.round(n);
const P1 = n => (n == null || isNaN(n)) ? '—' : (+n).toFixed(1) + '%';
const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const CLS_COL = { 'ميت': '#C0392B', 'تحت المراقبة': '#8E6BBF', 'بطيء شرعي': '#7F8C8D', 'موسمي': '#E0A526', 'فائض': '#E67E22', 'خطر نفاد': '#2A6FB0', 'صحي': '#1F9B76' };
const CLASSES = ['ميت', 'تحت المراقبة', 'بطيء شرعي', 'موسمي', 'فائض', 'خطر نفاد', 'صحي'];
const CLS_HELP = {
  'ميت': 'صفر مبيعات 180 يوم وأقل من 3 مبيعات في 2026 ومش موسمي — رأس مال واقف.',
  'تحت المراقبة': 'مبيعاتها وقفت آخر 90 يوم لكن باعت خلال 180 — إنذار مبكر.',
  'بطيء شرعي': 'ساكن لكن بيتباع 3 مرات أو أكتر — طلب فعلي نادر، ممنوع التصفية.',
  'موسمي': 'أكتر من 55% من مبيعاته 2025 في سبتمبر–ديسمبر — موسمه بيبدأ.',
  'فائض': 'التغطية أعلى من الحد الأعلى لفئته والزيادة عبوة كاملة على الأقل.',
  'خطر نفاد': 'التغطية أقل من الحد الأدنى لفئته (A=7، B=10، C=14 يوم).',
  'صحي': 'التغطية بين الحدين.'
};

let B = null, IT = [], ROLE = 'emp', ROOT = null, DB = null, VIEW = 'ov', CH = [], EXPL = { q: '', cls: '', abc: '', thc: '', sup: '', sort: 'n90', page: 0 };
const VIEWS = [['ov', '📊 نظرة عامة'], ['dc', '🎯 قرارات'], ['it', '🔎 الأصناف'], ['sp', '🏭 الموردين'], ['pf', '💰 الربحية والتصنيف'], ['ex', '⏳ الصلاحية'], ['mo', '📆 شهري'], ['me', '📘 طريقة الحساب']];

/* ---------- تحميل ---------- */
function css() {
  if ($('#invCss')) return;
  const s = document.createElement('style'); s.id = 'invCss';
  s.textContent = `
#invRoot .ivbar{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:4px -4px 14px;padding:6px 4px;position:sticky;top:0;z-index:4;background:color-mix(in srgb,var(--paper) 90%,transparent);backdrop-filter:blur(8px)}
#invRoot .ivbar::-webkit-scrollbar{display:none}
@media(max-width:899px){#invRoot .ivbar{top:52px}}
#invRoot .ivbar button{flex:0 0 auto}
#ivtop{position:fixed;bottom:18px;inset-inline-start:16px;z-index:40;width:46px;height:46px;border-radius:50%;padding:0;font-size:20px;box-shadow:0 10px 20px -8px rgba(15,27,45,.6);display:none}
#ivtop.show{display:block}
#invRoot .ivbar button{background:var(--card);color:var(--muted);box-shadow:0 1px 2px rgba(15,27,45,.08);border-radius:999px;padding:8px 15px;font-size:13px;font-weight:600}
#invRoot .ivbar button.on{background:var(--navy);color:#fff}
#invRoot .ivgrid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
#invRoot .ivk{background:var(--card);border-radius:18px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,27,45,.05),0 10px 24px -18px rgba(15,27,45,.35);border-inline-start:4px solid var(--green)}
#invRoot .ivk.r{border-inline-start-color:#C0392B}#invRoot .ivk.o{border-inline-start-color:#E67E22}#invRoot .ivk.b{border-inline-start-color:#2A6FB0}#invRoot .ivk.p{border-inline-start-color:#8E6BBF}
#invRoot .ivk .l{font-size:12px;color:var(--muted)}#invRoot .ivk .v{font-family:Alexandria,sans-serif;font-size:22px;font-weight:700;line-height:1.3}#invRoot .ivk .s{font-size:11.5px;color:var(--muted)}
#invRoot .ivcard{background:var(--card);border-radius:20px;padding:16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(15,27,45,.04),0 14px 34px -22px rgba(15,27,45,.28)}
#invRoot .ivcard h3{margin:0 0 4px;font-size:15px}#invRoot .ivcard .why{font-size:13px;color:var(--muted);margin:0 0 10px;line-height:1.7}
#invRoot .ivcard .why b{color:var(--ink)}
#invRoot .two{display:grid;gap:14px;grid-template-columns:1fr 1fr}@media(max-width:820px){#invRoot .two{grid-template-columns:1fr}}
#invRoot .ch{position:relative;height:260px}#invRoot .ch.tall{height:340px}
#invRoot .act{border-radius:20px;padding:16px;color:#fff;cursor:pointer;position:relative;overflow:hidden;box-shadow:0 18px 30px -20px rgba(15,27,45,.6);transition:transform .2s}
#invRoot .act:hover{transform:translateY(-3px)}#invRoot .act .t{font-size:13px;opacity:.9}#invRoot .act .n{font-family:Alexandria,sans-serif;font-size:26px;font-weight:700;margin:2px 0}#invRoot .act .d{font-size:12px;opacity:.9;line-height:1.6}
#invRoot .act.a1{background:linear-gradient(135deg,#0F2C45,#2A6FB0)}#invRoot .act.a2{background:linear-gradient(135deg,#7A3A00,#E67E22)}#invRoot .act.a3{background:linear-gradient(135deg,#6E1B14,#C0392B)}#invRoot .act.a4{background:linear-gradient(135deg,#0A6B60,#2DD4BF)}#invRoot .act.a5{background:linear-gradient(135deg,#5A3E00,#E0A526)}
#invRoot .tw{overflow:auto;max-height:480px;border:1px solid var(--line);border-radius:14px}
#invRoot table{width:100%;border-collapse:collapse;font-size:13px;min-width:600px}#invRoot th,#invRoot td{padding:8px 10px;text-align:center;white-space:nowrap}
#invRoot th{background:color-mix(in srgb,var(--paper) 70%,var(--card));color:var(--muted);cursor:pointer;position:sticky;top:0;user-select:none;font-size:12px}
#invRoot td{border-top:1px solid var(--line)}#invRoot td.nm{text-align:right;white-space:normal;min-width:180px}#invRoot tbody tr.cl{cursor:pointer}#invRoot tbody tr.cl:hover td{background:var(--green-soft)}
#invRoot .bd{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:700;color:#fff}
#invRoot .ctl{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}#invRoot .ctl input,#invRoot .ctl select{width:auto;flex:1;min-width:130px;padding:8px 11px;font-size:13px}
#invRoot .hm td{font-weight:600}
#invRoot .pg{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px;font-size:13px;color:var(--muted)}
#invRoot .mm{position:fixed;inset:0;z-index:60;background:rgba(7,13,24,.62);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}
#invRoot .mm>.bx{background:var(--card);width:min(720px,100%);max-height:94vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px;animation:slideup .3s both}
@media(min-width:760px){#invRoot .mm{align-items:center}#invRoot .mm>.bx{border-radius:24px}}
#invRoot .pill{display:inline-block;background:var(--green-soft);color:var(--green-deep);border-radius:99px;padding:3px 10px;font-size:12px;margin:2px}
#invRoot .note{font-size:12.5px;color:var(--muted);line-height:1.8;margin-top:8px}
#invRoot .mt p{margin:4px 0;font-size:13px;line-height:1.85}#invRoot .mt h4{margin:14px 0 4px;color:var(--green-deep)}
`;
  document.head.appendChild(s);
}
function loadChart() {
  if (window.Chart) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    s.onload = () => { Chart.defaults.font.family = 'Alexandria, "IBM Plex Sans Arabic", sans-serif'; Chart.defaults.color = '#66768A'; ok(); }; s.onerror = () => no(new Error('مقدرتش أحمّل مكتبة الرسوم')); document.head.appendChild(s); });
}
function hydrate(b) {
  B = b; const C = b.cols;
  IT = b.rows.map(r => { const o = {}; C.forEach((c, i) => o[c] = r[i]); o.sv = (o.m25 || []).slice(8, 12).reduce((a, x) => a + x, 0); o.daily = (o.n90 || 0) / 90; return o; });
}
async function fetchBundle() {
  const m = await getDoc(doc(DB, 'inventory', 'bundle_meta'));
  if (!m.exists()) return null;
  const meta = JSON.parse(m.data().d), n = m.data().chunks, parts = [];
  for (let i = 0; i < n; i++) { const c = await getDoc(doc(DB, 'inventory', 'bundle_items_' + i)); parts.push(...JSON.parse(c.data().d)); }
  meta.rows = parts; return meta;
}
async function uploadBundle(file, msg) {
  const txt = await file.text(); const b = JSON.parse(txt);
  if (!b.rows || !b.cols || !b.kpi) throw new Error('الملف مش ملف تحليل مخزون صالح');
  const rows = b.rows; delete b.rows; const per = 900, n = Math.ceil(rows.length / per);
  for (let i = 0; i < n; i++) { msg(`بيرفع الأصناف ${i + 1}/${n}…`); await setDoc(doc(DB, 'inventory', 'bundle_items_' + i), { d: JSON.stringify(rows.slice(i * per, (i + 1) * per)) }); }
  msg('بيرفع الملخص…'); await setDoc(doc(DB, 'inventory', 'bundle_meta'), { d: JSON.stringify(b), chunks: n, at: b.at });
  b.rows = rows; return b;
}

/* ---------- أدوات ---------- */
const badge = c => `<span class="bd" style="background:${CLS_COL[c] || '#888'}">${esc(c)}</span>`;
const kill = () => { CH.forEach(c => c.destroy()); CH = []; };
const mk = (id, cfg) => { const e = $('#' + id); if (!e) return; CH.push(new Chart(e, cfg)); };
const byCls = c => IT.filter(x => x.cls === c);
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
function table(cols, rows, o = {}) {
  const id = 't' + Math.random().toString(36).slice(2, 7);
  return `<div class="tw"><table id="${id}"><thead><tr>${cols.map((c, i) => `<th data-i="${i}">${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map((r, ri) =>
    `<tr${o.click ? ` class="cl" data-id="${r.id}"` : ''}>${cols.map(c => { const v = typeof c[0] === 'function' ? c[0](r) : r[c[0]]; const t = c[2] || '';
      return `<td${t === 'nm' ? ' class="nm"' : ''}>${t === 'm' ? N(v) : t === 'p' ? P1(v) : t === 'n' ? N(v) : t === 'raw' ? v : (v == null ? '—' : esc(v))}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function sortable(root) {
  root.querySelectorAll('table').forEach(t => { if (t.dataset.s) return; t.dataset.s = 1; let dir = 1, last = -1;
    t.querySelectorAll('th').forEach((th, i) => th.onclick = () => { dir = last === i ? -dir : 1; last = i; const tb = t.tBodies[0], rs = [...tb.rows];
      const val = r => { const x = r.cells[i].textContent.replace(/[,%\sج]/g, ''); const f = parseFloat(x); return isNaN(f) ? x : f; };
      rs.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * dir * -1; }); rs.forEach(r => tb.appendChild(r)); }); });
}
const kpi = (l, v, s, c = '') => `<div class="ivk ${c}"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
const goExplorer = f => { Object.assign(EXPL, { q: '', cls: '', abc: '', thc: '', sup: '', sort: 'n90', page: 0 }, f); setView('it'); };

/* ---------- عرض: نظرة عامة ---------- */
function vOverview() {
  const k = B.kpi, ca = byCls('خطر نفاد').filter(x => x.abc === 'A'), lost = sum(ca, x => x.daily), over = byCls('فائض'), dead = byCls('ميت');
  const bought = over.filter(x => x.sinceBuy != null && x.sinceBuy <= 30);
  const html = `
  <div class="ivgrid">
    ${kpi('المخزون (تكلفة)', M(k.stockCost), 'بسعر البيع ' + M(k.stockSale))}
    ${kpi('دوران / تغطية', k.turnover + ' مرة', k.cover + ' يوم تغطية', 'b')}
    ${kpi('رأس مال قابل للتحرير', M(k.freeCap), 'ميت + زيادة الفائض', 'r')}
    ${kpi('نمو 2026 عن 2025', (k.growthGross > 0 ? '+' : '') + k.growthGross + '%', 'نفس الفترة، صافي ' + (k.growthNet > 0 ? '+' : '') + k.growthNet + '%', 'b')}
    ${kpi('متوسط خصم الشراء', k.discAvg + '%', 'مشتريات 2026 ' + K(k.purchases) + ' ج', 'p')}
    ${kpi('نير 6 شهور', M(k.expRisk), 'معرّض للانتهاء من ' + M(k.expCost), 'o')}
  </div>
  <h3 style="margin:18px 0 8px">قرارات النهارده <span class="note">(اضغط أي كارت تشوف التفاصيل)</span></h3>
  <div class="ivgrid">
    <div class="act a1" data-go="dc:short"><div class="t">⚠️ اطلب النهارده</div><div class="n">${ca.length} صنف A</div><div class="d">رصيدهم تحت الحد الآمن — بيتباع منهم ~${M(lost)} في اليوم</div></div>
    <div class="act a2" data-go="dc:stop"><div class="t">✋ وقّف الشراء</div><div class="n">${bought.length} صنف</div><div class="d">فائض واتشترى آخر 30 يوم — زيادتهم ${M(sum(bought, x => x.excess))}</div></div>
    <div class="act a3" data-go="dc:ret"><div class="t">↩️ رجّع للمورد / صفّي</div><div class="n">${M(sum(dead, x => x.cost) + k.expRisk)}</div><div class="d">${dead.length} صنف ميت + نير معرّض</div></div>
    <div class="act a4" data-go="sp"><div class="t">🤝 فاوض</div><div class="n">${M(savings().reduce((a, x) => a + x.save, 0))}</div><div class="d">وفر تقديري على مشتريات 2026 لو الموردين الأضعف وصلوا لمتوسط الخصم (تقريبي)</div></div>
    <div class="act a5" data-go="dc:season"><div class="t">🍂 زوّد قبل الموسم</div><div class="n">${seasonLow().length} صنف</div><div class="d">موسميين وتغطيتهم قليلة والموسم بدأ</div></div>
  </div>
  <div class="two" style="margin-top:14px">
    <div class="ivcard"><h3>فلوس المخزون فين؟</h3><p class="why">توزيع <b>تكلفة المخزون</b> على التصنيفات. كل ما اللون غير الأخضر كبر = فلوس واقفة أو في خطر.</p><div class="ch"><canvas id="cDon"></canvas></div></div>
    <div class="ivcard"><h3>قاعدة الأصناف (Pareto)</h3><p class="why">أقل نسبة من الأصناف بتجيب معظم المبيعات: <b id="parTxt"></b></p><div class="ch"><canvas id="cPar"></canvas></div></div>
  </div>
  <div class="ivcard"><h3>المبيعات شهر بشهر مقابل 2025</h3><p class="why">أعمدة 2026 (صافي) وخط 2025 (صافي تقديري). <b>أغسطس وسبتمبر أعلى من 2025 بحوالي 20%</b> بينما أول 5 شهور كانت أقل — الاتجاه بيتحسن.</p><div class="ch tall"><canvas id="cMon"></canvas></div></div>
  <div class="ivcard"><h3>خريطة الأصناف: ABC × التصنيف (عدد الأصناف)</h3><p class="why">القلق الحقيقي في الخانات الحمرا اللي تحت <b>A</b> (أصناف مهمة ومشكلتها نفاد) وفي الخانات الكبيرة في <b>C</b> (أصناف قليلة المبيعات وماسكة فلوس).</p>${heat()}</div>`;
  return { html, after() {
    mk('cDon', { type: 'doughnut', data: { labels: CLASSES, datasets: [{ data: CLASSES.map(c => sum(byCls(c), x => x.cost)), backgroundColor: CLASSES.map(c => CLS_COL[c]), borderWidth: 0 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', rtl: true, labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: c => `${c.label}: ${M(c.parsed)}` } } } } });
    const s = IT.filter(x => x.n90 > 0).sort((a, b) => b.n90 - a.n90), tot = sum(s, x => x.n90); let cum = 0; const pts = s.map((x, i) => { cum += x.n90; return { x: (i + 1) / s.length * 100, y: cum / tot * 100 }; });
    const i80 = pts.findIndex(p => p.y >= 80); $('#parTxt', ROOT).textContent = `${i80 + 1} صنف (${pts[i80].x.toFixed(0)}% من الأصناف) = 80% من المبيعات`;
    mk('cPar', { type: 'line', data: { datasets: [{ data: pts.filter((_, i) => i % 8 === 0 || i === pts.length - 1), borderColor: '#0B8577', backgroundColor: 'rgba(11,133,119,.15)', fill: true, pointRadius: 0, tension: .2 }] },
      options: { maintainAspectRatio: false, parsing: false, scales: { x: { type: 'linear', min: 0, max: 100, title: { display: true, text: '% من الأصناف' } }, y: { min: 0, max: 100, title: { display: true, text: '% تراكمي من المبيعات' } } }, plugins: { legend: { display: false } } } });
    const m = B.monthly;
    mk('cMon', { data: { labels: m.map(x => MN[x.m - 1] + (x.m === 10 ? ' (1–6)' : '')), datasets: [
      { type: 'bar', label: '2026 صافي', data: m.map(x => x.net), backgroundColor: '#0B8577', borderRadius: 6 },
      { type: 'line', label: '2025 صافي (تقديري)', data: m.map(x => x.n25), borderColor: '#E0A526', backgroundColor: '#E0A526', tension: .3, pointRadius: 4 }] },
      options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: v => K(v) } } } } });
  } };
}
function heat() {
  const A = ['A', 'B', 'C', '—'], mx = Math.max(...CLASSES.flatMap(c => A.map(a => IT.filter(x => x.cls === c && x.abc === a).length)));
  return `<div class="tw"><table class="hm"><thead><tr><th>التصنيف</th>${A.map(a => `<th>${a === '—' ? 'بدون مبيعات' : a}</th>`).join('')}</tr></thead><tbody>${CLASSES.map(c => `<tr><td>${badge(c)}</td>${A.map(a => {
    const n = IT.filter(x => x.cls === c && x.abc === a).length, al = n / mx; const bad = (c === 'خطر نفاد' && a === 'A') ? '192,57,43' : (c === 'ميت' || c === 'فائض') ? '230,126,34' : '31,155,118';
    return `<td style="background:rgba(${bad},${(.08 + al * .6).toFixed(2)});cursor:pointer" data-cell="${esc(c)}|${a}">${n || ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function savings() {
  const avg = B.kpi.discAvg; return B.suppliers.filter(s => s.cost > 150000 && s.disc < avg - 2).map(s => ({ ...s, save: s.retail * (avg - s.disc) / 100 })).sort((a, b) => b.save - a.save);
}
function seasonLow() { return IT.filter(x => x.winter && x.sv > 800 && x.packs > 0 && (x.dsi == null || x.dsi < 25)).sort((a, b) => b.sv - a.sv); }

function retBySup() {
  const sup = {}; byCls('ميت').forEach(x => { const s = x.sup || '—'; (sup[s] = sup[s] || { sup: s, dn: 0, dc: 0, en: 0, ec: 0 }).dn++; sup[s].dc += x.cost; });
  B.expiry.forEach(e => { if (e.riskCost > 0) { const s = (e.sup || '—').trim(); (sup[s] = sup[s] || { sup: s, dn: 0, dc: 0, en: 0, ec: 0 }).en++; sup[s].ec += e.riskCost; } });
  return Object.values(sup).map(s => ({ ...s, tot: s.dc + s.ec })).sort((a, b) => b.tot - a.tot);
}

/* ---------- تصدير Excel (للمشتريات) ---------- */
const NOTE = 'ملاحظات المشتريات';
const LISTS = {
  short: () => ({ name: 'اطلب النهارده', why: 'أصناف رصيدها تحت الحد الآمن، الأهم (A) الأول. الموردين بيوصلوا يومياً.',
    head: ['الكود', 'الصنف', 'ABC', 'الرصيد (عبوات)', 'اطلب (عبوات)', 'التغطية (يوم)', 'مبيعات/يوم (ج)', 'المورد', NOTE],
    rows: byCls('خطر نفاد').sort((a, b) => (a.abc === b.abc ? b.n90 - a.n90 : a.abc < b.abc ? -1 : 1)).map(x => [x.id, x.name, x.abc, x.packs, x.nPacks, x.dsi, Math.round(x.daily), x.sup, '']) }),
  stop: () => ({ name: 'وقّف الشراء', why: 'أصناف فائض (تغطيتها أعلى من الحد) واتشترت آخر 30 يوم — مفيش شراء جديد لحد ما التغطية تنزل.',
    head: ['الكود', 'الصنف', 'عبوات زيادة', 'قيمة الزيادة (ج)', 'التغطية (يوم)', 'الحد الأعلى (يوم)', 'أيام من آخر شراء', 'المورد', NOTE],
    rows: byCls('فائض').filter(x => x.sinceBuy != null && x.sinceBuy <= 30).sort((a, b) => b.excess - a.excess).map(x => [x.id, x.name, x.xPacks, x.excess, x.dsi, x.max, x.sinceBuy, x.sup, '']) }),
  excess: () => ({ name: 'كل الفائض', why: 'كل أصناف الفائض مرتبة بقيمة الزيادة — للمرتجع أو العروض أو إيقاف الشراء.',
    head: ['الكود', 'الصنف', 'ABC', 'الرصيد (عبوات)', 'عبوات زيادة', 'قيمة الزيادة (ج)', 'التغطية (يوم)', 'أيام من آخر شراء', 'المورد', NOTE],
    rows: byCls('فائض').sort((a, b) => b.excess - a.excess).map(x => [x.id, x.name, x.abc, x.packs, x.xPacks, x.excess, x.dsi, x.sinceBuy, x.sup, '']) }),
  dead: () => ({ name: 'ميت - رجّع أو صفّي', why: 'أصناف واقفة (مفيش بيع 180 يوم) مرتبة بالمورد عشان قايمة مرتجع لكل مورد.',
    head: ['المورد', 'الكود', 'الصنف', 'الرصيد (عبوات)', 'التكلفة (ج)', 'أيام من آخر بيع', 'مرات البيع 2026', NOTE],
    rows: byCls('ميت').sort((a, b) => String(a.sup).localeCompare(String(b.sup), 'ar') || b.cost - a.cost).map(x => [x.sup, x.id, x.name, x.packs, x.cost, x.idle, x.freq, '']) }),
  ret: () => ({ name: 'ملخص المرتجع بالمورد', why: 'الميت والنير المعرّض لكل مورد — ابدأ بالأعلى قيمة.',
    head: ['المورد', 'أصناف ميتة', 'تكلفة الميت (ج)', 'دفعات نير معرّضة', 'تكلفة النير المعرّض (ج)', 'الإجمالي (ج)', NOTE],
    rows: retBySup().map(s => [s.sup, s.dn, s.dc, s.en, s.ec, s.tot, '']) }),
  neg: () => ({ name: 'تفاوض الموردين', why: 'موردين حجمهم كبير وخصمهم أقل من المتوسط. الوفر تقديري ومعظم المستورد واللبن خصمهم أقل بطبيعته.',
    head: ['المورد', 'مشتريات 2026 (تكلفة)', 'قيمة بيعية', 'الخصم %', 'مرتجع %', 'وفر تقديري لو وصل للمتوسط (ج)', NOTE],
    rows: savings().map(s => [s.sup, s.cost, s.retail, s.disc, s.retPct, Math.round(s.save), '']) }),
  suppliers: () => ({ name: 'كل الموردين', why: 'ترتيب كل الموردين بحجم الشراء والخصم المرجّح والمرتجع.',
    head: ['المورد', 'مشتريات (تكلفة)', 'قيمة بيعية', 'الخصم المرجّح %', 'أصناف', 'مرتجع (ج)', 'مرتجع %'], rows: B.suppliers.filter(s => s.cost > 0).map(s => [s.sup, s.cost, s.retail, s.disc, s.items, s.ret, s.retPct]) }),
  season: () => ({ name: 'زوّد قبل الموسم', why: 'أصناف موسمية مبيعاتها الشتوية 2025 كبيرة وتغطيتها الحالية أقل من 25 يوم.',
    head: ['الكود', 'الصنف', 'الرصيد (عبوات)', 'التغطية (يوم)', 'مبيعات سبتمبر–ديسمبر 2025 (ج)', 'المورد', NOTE], rows: seasonLow().map(x => [x.id, x.name, x.packs, x.dsi, x.sv, x.sup, '']) }),
  watch: () => ({ name: 'تحت المراقبة', why: 'وقفت حركتهم آخر 90 يوم — تدخل قبل ما يتحولوا لميت.',
    head: ['الكود', 'الصنف', 'الرصيد (عبوات)', 'التكلفة (ج)', 'أيام من آخر بيع', 'المورد', NOTE], rows: byCls('تحت المراقبة').sort((a, b) => b.cost - a.cost).map(x => [x.id, x.name, x.packs, x.cost, x.idle, x.sup, '']) }),
  expiry: () => ({ name: 'نير 6 شهور', why: 'دفعات صلاحيتها خلال 6 شهور والمعرّض منها للانتهاء قبل البيع (تقدير من معدل بيع 90 يوم).',
    head: ['الكود', 'الصنف', 'الصلاحية', 'أيام متبقية', 'عبوات', 'مباع 90 يوم', 'عبوات معرّضة', 'تكلفة معرّضة (ج)', '% معرّض', 'المورد', NOTE],
    rows: [...B.expiry].sort((a, b) => (b.riskCost || 0) - (a.riskCost || 0)).map(e => [e.id, e.name, e.exp, e.days, e.qty, e.p90, e.risk, e.riskCost, e.riskPct, e.sup, '']) }),
  ex: () => ({ name: 'الأصناف (حسب الفلتر)', why: 'نتيجة البحث والفلاتر الحالية في شاشة الأصناف.',
    head: ['الكود', 'الصنف', 'المجموعة العلاجية', 'التصنيف', 'ABC', 'الرصيد (عبوات)', 'التكلفة (ج)', 'مبيعات 90 يوم (ج)', 'التغطية (يوم)', 'عبوات زيادة', 'اطلب (عبوات)', 'هامش %', 'خصم الشراء %', 'آخر بيع', 'آخر شراء', 'المورد', NOTE],
    rows: filtered().map(x => [x.id, x.name, x.thc, x.cls, x.abc, x.packs, x.cost, x.n90, x.dsi, x.xPacks, x.nPacks, x.margin, x.disc, x.lastSale, x.lastBuy, x.sup, '']) })
};
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('مقدرتش أحمّل مكتبة الإكسل')); document.head.appendChild(s); });
}
const rnd = v => typeof v === 'number' ? Math.round(v * 10) / 10 : v;
function sheetOf(L) {
  const aoa = [[L.name], [L.why], ['تاريخ التحليل: ' + B.at + ' — لقطة المخزون ' + B.kpi.refDate], [], L.head, ...L.rows.map(r => r.map(rnd))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = L.head.map((h, i) => ({ wch: Math.min(46, Math.max(String(h).length + 2, ...L.rows.slice(0, 80).map(r => String(r[i] ?? '').length + 2), 9)) }));
  return ws;
}
async function exportXl(key) {
  await loadXlsx(); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
  const keys = key === 'all' ? ['short', 'stop', 'dead', 'ret', 'neg', 'season', 'watch', 'expiry'] : [key];
  keys.forEach(k => { const L = LISTS[k](); XLSX.utils.book_append_sheet(wb, sheetOf(L), L.name.slice(0, 31).replace(/[\/?*\[\]:]/g, '-')); });
  const nm = key === 'all' ? 'مخزون_للمشتريات' : LISTS[key]().name.replace(/[^\u0600-\u06FFA-Za-z0-9]+/g, '_');
  XLSX.writeFile(wb, `${nm}_${B.kpi.refDate}.xlsx`);
}

/* ---------- عرض: قرارات ---------- */
const COLS_IT = [['id', 'الكود'], ['name', 'الصنف', 'nm'], ['abc', 'ABC'], ['packs', 'رصيد', 'n']];
function vDecisions(focus) {
  const ca = byCls('خطر نفاد').sort((a, b) => b.n90 - a.n90), caA = ca.filter(x => x.abc === 'A'), over = byCls('فائض').filter(x => x.sinceBuy != null && x.sinceBuy <= 30).sort((a, b) => b.excess - a.excess);
  const dead = byCls('ميت'), watch = byCls('تحت المراقبة').sort((a, b) => b.cost - a.cost);
  const sr = retBySup();
  const sl = seasonLow(), sv = savings();
  const XLK = { short: 'short', stop: 'stop', ret: 'dead', neg: 'neg', season: 'season', watch: 'watch' };
  const sec = (id, title, why, body, go) => `<div class="ivcard" id="dc_${id}"><h3>${title}</h3><p class="why">${why}</p>${body}<p style="margin:10px 0 0;display:flex;gap:8px;flex-wrap:wrap">${go ? `<button class="sm ghost" data-ex='${esc(JSON.stringify(go))}'>افتح كل القايمة في الأصناف ←</button>` : ''}<button class="sm ghost" data-xl="${XLK[id]}">📥 تصدير Excel (القايمة كاملة)</button></p></div>`;
  const html = `
  ${sec('short', '⚠️ اطلب النهارده — أصناف مهمة قربت تخلص', `<b>${caA.length}</b> صنف من فئة A (اللي بتجيب 80% من المبيعات) رصيدهم تحت الحد الآمن. بيتباع منهم تقريباً <b>${M(sum(caA, x => x.daily))}</b> في اليوم، فكل يوم نفاد = مبيعات ضايعة. الموردين بيوصلوا يومياً فمفيش مبرر للنفاد.`,
    table([...COLS_IT, ['nPacks', 'اطلب (عبوات)', 'n'], ['dsi', 'تغطية (يوم)', 'n'], [x => Math.round(x.daily), 'مبيعات/يوم', 'n'], ['sup', 'المورد']], caA.slice(0, 15), { click: 1 }), { cls: 'خطر نفاد', abc: 'A' })}
  ${sec('stop', '✋ وقّف الشراء — فائض واتشترى حديثاً', `<b>${over.length}</b> صنف تغطيته أعلى من الحد وكمان اشتريناه آخر 30 يوم — يعني الشراء بيزوّد فوق الفائض. زيادتهم <b>${M(sum(over, x => x.excess))}</b>. راجع أوردرات الموردين دي قبل ما تتكرر.`,
    table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['xPacks', 'عبوات زيادة', 'n'], ['excess', 'قيمة الزيادة', 'm'], ['dsi', 'تغطية', 'n'], ['sinceBuy', 'أيام من آخر شراء', 'n'], ['sup', 'المورد']], over.slice(0, 15), { click: 1 }), { cls: 'فائض' })}
  ${sec('ret', '↩️ رجّع للمورد أو صفّي — مجمّعة بالمورد', `الميت (<b>${M(sum(dead, x => x.cost))}</b>) والنير المعرّض (<b>${M(B.kpi.expRisk)}</b>) مجمّعين على المورد عشان تبعت لكل مورد قايمة واحدة. ابدأ بالأعلى قيمة. <b>مهلة المرتجع حسب سياسة كل مورد</b> — متأخرش في النير.`,
    table([['sup', 'المورد', 'nm'], ['dn', 'أصناف ميتة', 'n'], ['dc', 'تكلفة الميت', 'm'], ['en', 'دفعات نير معرّضة', 'n'], ['ec', 'تكلفة النير المعرّض', 'm'], ['tot', 'الإجمالي', 'm']], sr.slice(0, 15)), { cls: 'ميت' })}
  ${sec('neg', '🤝 فاوض — موردين حجمهم كبير وخصمهم أقل من المتوسط', `متوسط الخصم ${B.kpi.discAvg}%. لو الموردين دول وصلوا للمتوسط التوفير التقديري عن نفس حجم الشراء <b>${M(sv.reduce((a, x) => a + x.save, 0))}</b> (على مشتريات 2026 لحد دلوقتي). <b>رقم تقريبي:</b> موردين المستورد واللبن خصمهم أقل بطبيعته، فالواقعي جزء منه — ابدأ بالأكبر حجماً.`,
    table([['sup', 'المورد', 'nm'], ['cost', 'مشتريات (تكلفة)', 'm'], ['disc', 'خصمه %', 'p'], ['retPct', 'مرتجع %', 'p'], ['save', 'وفر تقديري', 'm']], sv.slice(0, 10)))}
  ${sec('season', '🍂 زوّد قبل الموسم — موسميين تغطيتهم قليلة', `أصناف مبيعاتها الشتوية (سبتمبر–ديسمبر 2025) كبيرة ورصيدها الحالي أقل من 25 يوم. الموسم بدأ فعلاً.`,
    table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['packs', 'رصيد', 'n'], ['dsi', 'تغطية (يوم)', 'n'], ['sv', 'مبيعات سبتمبر–ديسمبر 2025', 'm'], ['sup', 'المورد']], sl.slice(0, 15), { click: 1 }), { })}
  ${sec('watch', '👁 تحت المراقبة — اتدخل قبل ما يموتوا', `<b>${watch.length}</b> صنف وقفت حركتهم آخر 90 يوم (<b>${M(sum(watch, x => x.cost))}</b>). لو فضلوا ساكنين هيتحولوا لميت — التدخل (عرض/تحويل) دلوقتي أرخص.`,
    table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['packs', 'رصيد', 'n'], ['cost', 'التكلفة', 'm'], ['idle', 'أيام من آخر بيع', 'n'], ['sup', 'المورد']], watch.slice(0, 12), { click: 1 }), { cls: 'تحت المراقبة' })}`;
  return { html, after() { if (focus) { const e = $('#dc_' + focus, ROOT); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } };
}

/* ---------- عرض: الأصناف ---------- */
function filtered() {
  const q = EXPL.q.trim().toLowerCase();
  let r = IT.filter(x => (!q || String(x.name).toLowerCase().includes(q) || String(x.id).includes(q)) && (!EXPL.cls || x.cls === EXPL.cls) && (!EXPL.abc || x.abc === EXPL.abc) && (!EXPL.thc || x.thc === EXPL.thc) && (!EXPL.sup || x.sup === EXPL.sup));
  const f = EXPL.sort; r.sort((a, b) => (b[f] ?? -1e12) - (a[f] ?? -1e12)); return r;
}
function vItems() {
  const sups = [...new Set(IT.map(x => x.sup).filter(Boolean))].sort(), thcs = [...new Set(IT.map(x => x.thc))].sort();
  const opt = (a, v) => a.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  const SORTS = [['n90', 'الأعلى مبيعاً 90 يوم'], ['cost', 'الأعلى تكلفة مخزون'], ['excess', 'الأعلى زيادة'], ['short', 'الأعلى نقص'], ['gp90', 'الأعلى ربحاً'], ['dsi', 'الأعلى تغطية'], ['idle', 'الأطول سكوناً'], ['disc', 'الأعلى خصم شراء']];
  const html = `<div class="ivcard"><div class="ctl">
    <input id="eq" placeholder="ابحث بالاسم أو الكود…" value="${esc(EXPL.q)}">
    <select id="ecls"><option value="">كل التصنيفات</option>${opt(CLASSES, EXPL.cls)}</select>
    <select id="eabc"><option value="">ABC</option>${opt(['A', 'B', 'C', '—'], EXPL.abc)}</select>
    <select id="ethc"><option value="">كل المجموعات العلاجية</option>${opt(thcs, EXPL.thc)}</select>
    <select id="esup"><option value="">كل الموردين</option>${opt(sups, EXPL.sup)}</select>
    <select id="esort">${SORTS.map(s => `<option value="${s[0]}"${EXPL.sort === s[0] ? ' selected' : ''}>${s[1]}</option>`).join('')}</select></div>
    <div id="elist"></div><p style="margin:10px 0 0"><button class="sm ghost" data-xl="ex">📥 تصدير القايمة دي Excel (كل النتائج مش الصفحة دي بس)</button></p></div>`;
  return { html, after() {
    const draw = () => { const r = filtered(), pg = 40, pages = Math.max(1, Math.ceil(r.length / pg)); EXPL.page = Math.min(EXPL.page, pages - 1);
      $('#elist', ROOT).innerHTML = `<p class="note" style="margin:0 0 8px">${N(r.length)} صنف · تكلفة مخزونهم ${M(sum(r, x => x.cost))} · مبيعات 90 يوم ${M(sum(r, x => x.n90))}</p>` +
        table([['id', 'الكود'], ['name', 'الصنف', 'nm'], [x => badge(x.cls), 'التصنيف', 'raw'], ['abc', 'ABC'], ['packs', 'رصيد', 'n'], ['cost', 'تكلفة', 'm'], ['n90', 'مبيعات 90', 'm'], ['dsi', 'تغطية', 'n'], ['margin', 'هامش %', 'p'], ['disc', 'خصم شراء %', 'p'], ['sup', 'المورد']], r.slice(EXPL.page * pg, EXPL.page * pg + pg), { click: 1 }) +
        `<div class="pg"><button class="sm ghost" id="pp"${EXPL.page ? '' : ' disabled'}>السابق</button><span>${EXPL.page + 1} / ${pages}</span><button class="sm ghost" id="pn"${EXPL.page < pages - 1 ? '' : ' disabled'}>التالي</button></div>`;
      sortable($('#elist', ROOT)); const pp = $('#pp', ROOT), pn = $('#pn', ROOT); if (pp) pp.onclick = () => { EXPL.page--; draw(); }; if (pn) pn.onclick = () => { EXPL.page++; draw(); }; };
    draw();
    [['eq', 'q'], ['ecls', 'cls'], ['eabc', 'abc'], ['ethc', 'thc'], ['esup', 'sup'], ['esort', 'sort']].forEach(([i, k]) => $('#' + i, ROOT).addEventListener(k === 'q' ? 'input' : 'change', e => { EXPL[k] = e.target.value; EXPL.page = 0; draw(); }));
  } };
}

/* ---------- تفاصيل صنف ---------- */
function why(x) {
  const mx = x.max, mn = x.min;
  switch (x.cls) {
    case 'فائض': return `تغطيته <b>${N(x.dsi)} يوم</b> والحد الأعلى لفئة ${x.abc}${x.deal ? ' (عرض)' : ''} هو <b>${mx} يوم</b> → زيادة <b>${N(x.xPacks)} عبوة</b> (${M(x.excess)}).`;
    case 'خطر نفاد': return `تغطيته <b>${N(x.dsi)} يوم</b> والحد الأدنى لفئة ${x.abc} هو <b>${mn} يوم</b> → اطلب <b>${N(x.nPacks)} عبوة</b>.`;
    case 'ميت': return `ساكن من <b>${x.idle == null ? 'بداية السنة' : N(x.idle) + ' يوم'}</b> وباع <b>${x.freq}</b> مرة بس في 2026 → رأس مال واقف ${M(x.cost)}.`;
    case 'تحت المراقبة': return `مبيعاته وقفت آخر 90 يوم، آخر بيع من <b>${N(x.idle)} يوم</b>.`;
    case 'بطيء شرعي': return `ساكن لكن اتباع <b>${x.freq}</b> مرات — طلب فعلي نادر. <b>متتصفّاش.</b>`;
    case 'موسمي': return `<b>${N(x.seasonPct)}%</b> من مبيعاته 2025 كانت في سبتمبر–ديسمبر.`;
    default: return `تغطيته <b>${N(x.dsi)} يوم</b> بين الحد الأدنى (${mn}) والأعلى (${mx}).`;
  }
}
function openItem(id) {
  const x = IT.find(i => i.id === id); if (!x) return; closeItem();
  const m = document.createElement('div'); m.className = 'mm'; m.id = 'invMM';
  m.innerHTML = `<div class="bx"><div class="hdr" style="display:flex;justify-content:space-between;gap:10px"><div><h3 style="margin:0">${esc(x.name)}</h3><div class="note" style="margin:2px 0">كود ${x.id} · ${esc(x.thc)} · ${esc(x.cat || '')}</div></div><button class="sm ghost" id="invX">إغلاق</button></div>
    <p style="margin:8px 0">${badge(x.cls)} <span class="pill">ABC: ${x.abc}</span>${x.deal ? '<span class="pill">صنف عرض</span>' : ''}${x.winter ? '<span class="pill">موسمي</span>' : ''}</p>
    <p class="why" style="font-size:13.5px;line-height:1.8">${why(x)}</p>
    <div class="ivgrid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${kpi('الرصيد', N(x.packs) + ' عبوة', M(x.cost) + ' تكلفة')}${kpi('مبيعات 90 يوم', M(x.n90), N(x.p90) + ' عبوة')}${kpi('هامش / ربح 90', P1(x.margin), M(x.gp90))}${kpi('خصم الشراء', x.disc == null ? '—' : P1(x.disc), x.sup || '')}${kpi('آخر بيع', x.lastSale || '—', x.idle == null ? '' : 'من ' + N(x.idle) + ' يوم')}${kpi('آخر شراء', x.lastBuy || '—', x.sinceBuy == null ? '' : 'من ' + N(x.sinceBuy) + ' يوم')}</div>
    <div class="ch" style="margin-top:12px;height:230px"><canvas id="cIt"></canvas></div><p class="note">أعمدة = مبيعات 2026 الشهرية، خط = نفس الشهر 2025 (قبل المرتجع).</p></div>`;
  ROOT.appendChild(m); m.addEventListener('click', e => { if (e.target === m) closeItem(); }); $('#invX', m).onclick = closeItem;
  window.__itC = new Chart($('#cIt', m), { data: { labels: MN, datasets: [{ type: 'bar', label: '2026', data: x.m26.concat([null, null]), backgroundColor: '#0B8577', borderRadius: 5 }, { type: 'line', label: '2025', data: x.m25, borderColor: '#E0A526', tension: .3, pointRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => K(v) } } } } });
}
function closeItem() { const m = $('#invMM'); if (m) { if (window.__itC) window.__itC.destroy(); m.remove(); } }

/* ---------- موردين ---------- */
function vSuppliers() {
  const avg = B.kpi.discAvg, S = B.suppliers.filter(s => s.cost > 0);
  const html = `<div class="ivcard"><h3>حجم الشراء مقابل الخصم</h3><p class="why">كل فقاعة = مورد (الحجم = قيمة المرتجع). المطلوب: موردين <b>على اليمين</b> (حجم كبير) <b>ومرتفعين</b> (خصم عالي). اللي على اليمين ومنخفضين هما فرصة التفاوض — الخط = متوسط الخصم ${avg}%.</p><div class="ch tall"><canvas id="cSp"></canvas></div></div>
  <div class="ivcard"><h3>كل الموردين</h3><p style="margin:0 0 8px"><button class="sm ghost" data-xl="suppliers">📥 تصدير Excel</button></p>${table([['sup', 'المورد', 'nm'], ['cost', 'مشتريات (تكلفة)', 'm'], ['retail', 'قيمة بيعية', 'm'], ['disc', 'الخصم المرجّح %', 'p'], [x => Math.round(x.retail * (avg - x.disc) / 100), 'فرق عن المتوسط (ج)', 'n'], ['items', 'أصناف', 'n'], ['ret', 'مرتجع', 'm'], ['retPct', 'مرتجع %', 'p']], S)}
  <p class="note">الخصم المرجّح = 1 − (تكلفة الفواتير بعد المرتجع ÷ قيمتها البيعية). "فرق عن المتوسط" موجب = المورد أقل من المتوسط (فرصة توفير).</p></div>
  <div class="ivcard"><h3>الخصم حسب الشكل الدوائي</h3><div class="ch"><canvas id="cCt"></canvas></div><p class="note">اللبن والمستلزمات مسعّرة جبرياً — خصمها المنخفض طبيعي ومش مادة تفاوض.</p></div>`;
  return { html, after() {
    mk('cSp', { type: 'bubble', data: { datasets: [{ label: 'مورد', data: S.map(s => ({ x: s.cost, y: s.disc, r: 4 + Math.sqrt(Math.max(s.ret, 0)) / 12, n: s.sup })), backgroundColor: S.map(s => s.disc < avg - 2 && s.cost > 150000 ? 'rgba(192,57,43,.65)' : 'rgba(11,133,119,.55)') }] },
      options: { maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'مشتريات 2026 (تكلفة)' }, ticks: { callback: v => K(v) } }, y: { title: { display: true, text: 'الخصم المرجّح %' }, suggestedMin: 10 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.n}: ${M(c.raw.x)} · خصم ${c.raw.y}%` } } } },
      plugins: [{ id: 'avgLine', afterDraw(ch) { const y = ch.scales.y.getPixelForValue(avg), c = ch.ctx; c.save(); c.strokeStyle = '#999'; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(ch.chartArea.left, y); c.lineTo(ch.chartArea.right, y); c.stroke(); c.restore(); } }] });
    mk('cCt', { type: 'bar', data: { labels: B.cats.map(c => c.cat), datasets: [{ data: B.cats.map(c => c.disc), backgroundColor: B.cats.map(c => c.disc < avg - 5 ? '#E67E22' : '#0B8577'), borderRadius: 5 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => v + '%' } } } } });
  } };
}

/* ---------- الربحية والتصنيف العلاجي ---------- */
function vProfit() {
  const T = [...B.thc].sort((a, b) => b.sales - a.sales), top = IT.filter(x => x.n90 > 0).sort((a, b) => b.gp90 - a.gp90).slice(0, 20);
  const html = `<div class="ivcard"><h3>المبيعات والربح لكل مجموعة علاجية</h3><p class="why">آخر 90 يوم. الفرق بين العمود الأخضر (مبيعات) والأصفر (ربح) = هامش المجموعة. <b>⚠ التصنيف مبدئي بالكلمات ومحتاج مراجعتك</b> — ${esc(T.find(t => String(t.thc).startsWith('غير مصنف')) ? 'في مجموعات "غير مصنف" لسه' : '')}.</p><div class="ch tall"><canvas id="cTh"></canvas></div></div>
  <div class="ivcard"><h3>تفاصيل المجموعات</h3>${table([['thc', 'المجموعة', 'nm'], ['items', 'أصناف', 'n'], ['sales', 'مبيعات 90', 'm'], ['gp', 'ربح 90', 'm'], ['margin', 'هامش %', 'p'], ['stock', 'تكلفة المخزون', 'm'], ['cover', 'تغطية (يوم)', 'n'], ['disc', 'خصم الشراء %', 'p']], T)}
  <p class="note">تغطية عالية + هامش ضعيف = مجموعة بتجمّد فلوس وبتكسب قليل. تغطية قليلة + هامش عالي = ركّز عليها وماتسيبهاش تخلص.</p></div>
  <div class="ivcard"><h3>أعلى 20 صنف ربحاً</h3><p class="why">دي الأصناف اللي لازم ما تخلصش أبداً، وتشتريها بأحسن خصم.</p>${table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['n90', 'مبيعات 90', 'm'], ['margin', 'هامش %', 'p'], ['gp90', 'ربح 90', 'm'], [x => badge(x.cls), 'الحالة', 'raw'], ['dsi', 'تغطية', 'n']], top, { click: 1 })}</div>`;
  return { html, after() {
    mk('cTh', { type: 'bar', data: { labels: T.map(t => t.thc), datasets: [{ label: 'مبيعات', data: T.map(t => t.sales), backgroundColor: '#0B8577', borderRadius: 4 }, { label: 'ربح', data: T.map(t => t.gp), backgroundColor: '#E0A526', borderRadius: 4 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.x)}` } } }, scales: { x: { ticks: { callback: v => K(v) } } } } });
  } };
}

/* ---------- الصلاحية ---------- */
function vExpiry() {
  const E = [...B.expiry].sort((a, b) => (b.riskCost || 0) - (a.riskCost || 0)), by = {};
  B.expiry.forEach(e => { const k = e.exp; (by[k] = by[k] || { c: 0, r: 0 }); by[k].c += e.cost || 0; by[k].r += e.riskCost || 0; });
  const ks = Object.keys(by).sort();
  const html = `<div class="ivcard"><h3>النير (ينتهي خلال 6 شهور)</h3><p class="why">${B.kpi.expN} دفعة تكلفتها <b>${M(B.kpi.expCost)}</b>، وتقديرنا إن <b>${M(B.kpi.expRisk)}</b> منها مش هيتباع قبل الانتهاء (حسب معدل بيع آخر 90 يوم). كل ما الشهر أقرب كل ما القرار أسرع.</p><div class="ch"><canvas id="cEx"></canvas></div></div>
  <div class="ivcard"><h3>الأعلى خطراً</h3><p style="margin:0 0 8px"><button class="sm ghost" data-xl="expiry">📥 تصدير Excel</button></p>${table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['exp', 'الصلاحية'], ['days', 'أيام متبقية', 'n'], ['qty', 'عبوات', 'n'], ['p90', 'مباع 90 يوم', 'n'], ['risk', 'عبوات معرّضة', 'n'], ['riskCost', 'تكلفة معرّضة', 'm'], ['riskPct', '% معرّض', 'n'], ['sup', 'المورد']], E)}
  <p class="note">المعرّض = العبوات − (المباع يومياً × الأيام المتبقية). التصرف: معرّض عالي ← رجّعه للمورد قبل المهلة أو اعمل عليه عرض. مبيعات سريعة ← بيع الأقدم الأول (FEFO).</p></div>`;
  return { html, after() {
    mk('cEx', { type: 'bar', data: { labels: ks, datasets: [{ label: 'تكلفة الدفعات', data: ks.map(k => by[k].c), backgroundColor: '#0B8577', borderRadius: 5 }, { label: 'معرّض للانتهاء', data: ks.map(k => by[k].r), backgroundColor: '#C0392B', borderRadius: 5 }] }, options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.y)}` } } } } });
  } };
}

/* ---------- شهري ---------- */
function vMonthly() {
  const m = B.monthly, html = `<div class="ivcard"><h3>مشتريات مقابل تكلفة المبيع</h3><p class="why">لو خط المشتريات فوق خط تكلفة المبيع شهر بعد شهر = بنكوّن مخزون. عشان كده الدوران بيتحسن لما الخطين يتقاربوا. <b>المشتريات الشهرية تقديرية</b> (القيمة البيعية من حركة الأصناف × (1 − متوسط الخصم)) لأن تقرير المشتريات مفيهوش تواريخ.</p><div class="ch tall"><canvas id="cBc"></canvas></div></div>
  <div class="ivcard"><h3>جدول الشهور</h3>${table([[x => MN[x.m - 1] + (x.m === 10 ? ' (1–6)' : ''), 'الشهر', 'raw'], ['gross', 'مبيعات إجمالي', 'm'], ['net', 'صافي', 'm'], ['n25', 'نفس الشهر 2025 (صافي تقديري)', 'm'], [x => (x.net / x.n25 - 1) * 100, 'نمو %', 'p'], ['inv', 'فواتير', 'n'], ['buy', 'مشتريات (تقدير)', 'm'], ['cogs', 'تكلفة المبيع', 'm'], [x => x.buy - x.cogs, 'تراكم مخزون (تقدير)', 'n']], m)}
  <p class="note">مرتجعات 2025 = ${M(-B.kpi.ret25)} موزعة بالتناسب على الشهور (الملف مفيهوش تواريخ)، فالنمو الشهري تقريبي.</p></div>`;
  return { html, after() {
    mk('cBc', { type: 'line', data: { labels: m.map(x => MN[x.m - 1]), datasets: [{ label: 'مشتريات (تقدير)', data: m.map(x => x.buy), borderColor: '#E67E22', backgroundColor: '#E67E22', tension: .3 }, { label: 'تكلفة المبيع', data: m.map(x => x.cogs), borderColor: '#0B8577', backgroundColor: '#0B8577', tension: .3 }] }, options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: v => K(v) } } } } });
  } };
}

/* ---------- طريقة الحساب ---------- */
function vMethod() {
  const s = B.settings;
  return { html: `<div class="ivcard mt"><h3>طريقة الحساب (مقفولة)</h3>
  <h4>معدل البيع</h4><p>آخر ${s.win} يوم فقط (${esc(B.kpi.window)}) صافي المرتجعات، بالتكلفة: <b>(صافي المبيعات ÷ ${s.win}) × (1 − نسبة المكسب)</b>. السبب: المبيعات في نمو فالمتوسط الطويل بيبخّس المعدل.</p>
  <h4>ABC</h4><p>ترتيب بمبيعات ${s.win} يوم: A أول ${s.abcA}% من المبيعات، B حتى ${s.abcB}%، C الباقي.</p>
  <h4>الحدود (بالأيام)</h4><p>حد أدنى (تحته خطر نفاد): A=${s.minA}، B=${s.minB}، C=${s.minC}. حد أعلى (فوقه فائض): A=${s.maxA}، B=${s.maxB}، C=${s.maxC}، وأصناف العروض ${s.dealDays}. الموردين بيوصلوا يومياً فالحد الأدنى صغير.</p>
  <h4>التصنيفات (كل صنف في واحد بس)</h4><p>${CLASSES.map(c => `${badge(c)} ${esc(CLS_HELP[c])}`).join('<br>')}</p>
  <h4>الميت</h4><p>صفر مبيعات ${s.dead} يوم + أقل من ${s.slowMin} مبيعات + مش موسمي. الموسمي: أكتر من ${s.seasonPct}% من مبيعات 2025 في سبتمبر–ديسمبر وإجمالي ≥ ${s.seasonMin} ج.</p>
  <h4>صنف العرض</h4><p>هامشه ≥ وسيط هامش فئته + ${s.dealGap} نقاط.</p>
  <h4>خصم الشراء</h4><p>1 − (تكلفة فواتير 2026 بعد المرتجع ÷ قيمتها البيعية). مرتجعات الموردين بتتحسب خصم من قيمة الفاتورة.</p>
  <h4>النير</h4><p>${s.nearMonths} شهور من تقرير الإكسبير. المعرّض = العبوات − (المباع يومياً × الأيام المتبقية)، الدفعات الأقرب تتباع الأول.</p>
  <h4>تحذيرات</h4><p>• التصنيف العلاجي مبدئي (كلمات في الاسم).<br>• المرتجعات في ملفات النظام سالبة أصلاً — بتتجمع.<br>• مرتجعات 2025 اتوزعت بالتناسب على الشهور.<br>• كل القيم بالتكلفة، والكميات بالعبوات.</p>
  <p class="note">تاريخ التحليل: ${esc(B.at)} — مرجع الحساب ${esc(B.kpi.refDate)}.</p></div>`, after() {} };
}

/* ---------- المحرك ---------- */
const RENDER = { ov: vOverview, dc: vDecisions, it: vItems, sp: vSuppliers, pf: vProfit, ex: vExpiry, mo: vMonthly, me: vMethod };
function setView(v, focus, scroll) {
  kill(); closeItem(); VIEW = v; const bar = $('#ivbar', ROOT); bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const r = RENDER[v](focus); const c = $('#ivbody', ROOT); c.innerHTML = r.html; sortable(c); r.after();
  if (scroll && !focus) ROOT.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function shell(adm) {
  ROOT.innerHTML = `<div class="ivcard" style="padding:14px 16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h2 style="margin:0 0 2px">📦 المخزون — لوحة القرارات</h2><p class="sub" id="ivmeta"></p></div>
    <button id="ivall" data-xl="all" style="border-radius:999px">📥 تصدير كل قوايم المشتريات (Excel)</button>${adm ? `<div><label class="sm ghost" style="cursor:pointer;display:inline-block;border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13px;color:var(--green)">رفع نتيجة تحليل جديدة<input type="file" id="ivup" accept=".json" style="display:none"></label><div class="note" id="ivmsg"></div></div>` : ''}</div></div>
    <button id="ivtop" title="لأعلى" onclick="window.scrollTo({top:0,behavior:'smooth'})">⬆</button><div class="ivbar" id="ivbar">${VIEWS.map(v => `<button data-v="${v[0]}">${v[1]}</button>`).join('')}</div><div id="ivbody"></div>`;
  $('#ivbar', ROOT).onclick = e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v, null, true); };
  if (!window.__ivScroll) { window.__ivScroll = 1; window.addEventListener('scroll', () => { const t = document.getElementById('ivtop'); if (t) t.classList.toggle('show', window.scrollY > 500 && ROOT && ROOT.offsetParent !== null); }, { passive: true }); }
  ROOT.addEventListener('click', e => {
    const row = e.target.closest('tr.cl'); if (row) { openItem(+row.dataset.id); return; }
    const a = e.target.closest('[data-go]'); if (a) { const [v, f] = a.dataset.go.split(':'); setView(v, f); return; }
    const xb = e.target.closest('[data-xl]'); if (xb) { const t = xb.textContent; xb.disabled = true; exportXl(xb.dataset.xl).catch(err => alert('فشل التصدير: ' + err.message)).finally(() => { xb.disabled = false; xb.textContent = t; }); return; }
    const x = e.target.closest('[data-ex]'); if (x) { goExplorer(JSON.parse(x.dataset.ex)); return; }
    const cell = e.target.closest('[data-cell]'); if (cell) { const [c, ab] = cell.dataset.cell.split('|'); goExplorer({ cls: c, abc: ab }); }
  });
  if (adm) $('#ivup', ROOT).onchange = async e => { const f = e.target.files[0]; if (!f) return; const msg = $('#ivmsg', ROOT);
    try { const b = await uploadBundle(f, t => msg.textContent = t); hydrate(b); msg.textContent = 'اتنشر ✓'; $('#ivmeta', ROOT).textContent = metaTxt(); setView(VIEW); } catch (err) { msg.textContent = 'فشل: ' + (err.code || err.message); } };
}
const metaTxt = () => `آخر تحليل: ${B.at} · لقطة المخزون ${B.kpi.refDate} · ${N(B.kpi.items)} صنف`;

export async function mountInventory(root, role) {
  ROOT = root; ROLE = role; DB = getFirestore(getApp()); css(); root.id = 'invRoot';
  root.innerHTML = '<div class="ivcard"><p class="sub">جاري تحميل المخزون…</p></div>';
  try { await loadChart(); } catch (e) { root.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return; }
  let b = null; try { b = await fetchBundle(); } catch (e) { root.innerHTML = `<div class="banner bad">مقدرتش أقرا التحليل: ${esc(e.code || e.message)}</div>`; return; }
  shell(role === 'admin');
  if (!b) { $('#ivbody', root).innerHTML = `<div class="banner">لسه مفيش تحليل منشور.${role === 'admin' ? ' ارفع ملف inventory_bundle.json من الزرار فوق.' : ' هيظهر أول ما مدير الفرع ينشره.'}</div>`; return; }
  hydrate(b); $('#ivmeta', root).textContent = metaTxt(); setView('ov');
}
// للتجربة المحلية بدون Firestore
export function mountLocal(root, bundle, role = 'admin') { ROOT = root; ROLE = role; css(); root.id = 'invRoot'; return loadChart().then(() => { shell(false); hydrate(bundle); $('#ivmeta', root).textContent = metaTxt(); setView('ov'); }); }
