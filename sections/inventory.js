// قسم المخزون — داشبورد قرارات (بيتحمّل أول ما تفتح التبويب). البيانات بتتنشر من ملف inventory_bundle.json
// على Firestore (inventory/bundle_meta + bundle_items_N) — الأدمن بس بيرفع، والأدمن وصاحب الصيدلية بيشوفوا.
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, documentId, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
const VIEWS = [['ov', '📊 نظرة عامة', '#FFC83D'], ['dc', '🎯 قرارات', '#FF8A5B'], ['it', '🔎 الأصناف', '#5BC0FF'], ['sp', '🏭 الموردين', '#C9A7FF'], ['or', '🛒 طلبية النواقص', '#4FD1C5'], ['pf', '💰 الربحية والتصنيف', '#7CE3A1'], ['ex', '⏳ الصلاحية', '#FF6F91'], ['mo', '📆 شهري', '#FFE066'], ['me', '📘 طريقة الحساب', '#E2E8F0']];

/* ---------- تحميل ---------- */
function css() {
  if ($('#invCss')) return;
  const s = document.createElement('style'); s.id = 'invCss';
  s.textContent = `
#invRoot .ivbar{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:4px 0 14px;padding:8px;position:sticky;top:8px;z-index:4;border-radius:18px;background:linear-gradient(135deg,#0F2C45 0%,#0B8577 100%);box-shadow:0 14px 28px -12px rgba(11,60,70,.65),0 0 0 1px rgba(255,255,255,.08) inset}
#invRoot .ivbar::-webkit-scrollbar{display:none}
@media(max-width:899px){#invRoot .ivbar{top:58px}}
#invRoot .ivbar button{flex:0 0 auto}
#ivtop{position:fixed;bottom:18px;inset-inline-start:16px;z-index:40;width:46px;height:46px;border-radius:50%;padding:0;font-size:20px;box-shadow:0 10px 20px -8px rgba(15,27,45,.6);display:none}
#ivtop.show{display:block}
#invRoot .ivbar button{background:rgba(255,255,255,.12);color:#fff;box-shadow:none;border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:700;border:1px solid rgba(255,255,255,.18);transition:background .2s,transform .2s,color .2s}
#invRoot .ivbar button:hover{background:rgba(255,255,255,.24);filter:none}
#invRoot .ivbar button.on{background:var(--c,#FFC83D);color:#10202E;border-color:transparent;transform:translateY(-1px) scale(1.04);box-shadow:0 6px 14px -4px rgba(0,0,0,.45)}
#invRoot .ivbar button.on:hover{background:var(--c,#FFC83D)}
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
#invRoot .tw{overflow-x:auto;overflow-y:visible;border:1px solid var(--line);border-radius:14px}
#invRoot table{width:100%;border-collapse:collapse;font-size:13px;min-width:600px}#invRoot th,#invRoot td{padding:8px 10px;text-align:center;white-space:nowrap}
#invRoot th{background:color-mix(in srgb,var(--paper) 70%,var(--card));color:var(--muted);cursor:pointer;user-select:none;font-size:12px}
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
    ${kpi('خصم شراء الدواء (آخر 3 شهور)', k.discMed + '%', 'كوزمو ومستلزمات ' + k.discCos + '% · الكل ' + k.discAvg + '%', 'p')}
    ${kpi('نير 6 شهور', M(k.expRisk), 'معرّض للانتهاء من ' + M(k.expCost), 'o')}
  </div>
  <h3 style="margin:18px 0 8px">قرارات النهارده <span class="note">(اضغط أي كارت تشوف التفاصيل)</span></h3>
  <div class="ivgrid">
    <div class="act a1" data-go="dc:short"><div class="t">⚠️ اطلب النهارده</div><div class="n">${ca.length} صنف A</div><div class="d">رصيدهم تحت الحد الآمن — بيتباع منهم ~${M(lost)} في اليوم</div></div>
    <div class="act a2" data-go="dc:stop"><div class="t">✋ وقّف الشراء</div><div class="n">${bought.length} صنف</div><div class="d">فائض واتشترى آخر 30 يوم — زيادتهم ${M(sum(bought, x => x.excess))}</div></div>
    <div class="act a3" data-go="dc:ret"><div class="t">↩️ رجّع للمورد / صفّي</div><div class="n">${M(sum(dead, x => x.cost) + k.expRisk)}</div><div class="d">${dead.length} صنف ميت + نير معرّض</div></div>
    <div class="act a4" data-go="sp"><div class="t">🤝 فاوض</div><div class="n">${M(savings().reduce((a, x) => a + x.save3, 0))}</div><div class="d">وفر واقعي (آخر 3 شهور) لو الموردين الكبار اللي خصمهم تحت متوسط مجموعتهم زادوا 3 نقاط بس</div></div>
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
const GRP = { med: 'دواء', cos: 'كوزمو ومستلزمات', milk: 'لبن' };
function savings() {
  const k = B.kpi, G = [['دواء', k.discMed, 60000, 'cm', 'rm', 'dm'], ['كوزمو ومستلزمات', k.discCos, 40000, 'cc', 'rc', 'dc']], out = [];
  B.suppliers.forEach(s => G.forEach(([n, bench, min, c, r, d]) => { if (s[c] >= min && s[d] != null && s[d] < bench - 2) { const gap = bench - s[d];
    out.push({ sup: s.sup, grp: n, cost: s[c], retail: s[r], disc: s[d], bench, gap, retPct: s.retPct, save: s[r] * gap / 100, save3: s[r] * Math.min(3, gap) / 100 }); } }));
  return out.sort((a, b) => b.save - a.save);
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
    head: ['المورد', 'المجموعة', 'مشتريات آخر 3 شهور (تكلفة)', 'قيمة بيعية', 'خصمه %', 'متوسط المجموعة %', 'مرتجع %', 'وفر واقعي لو زاد 3 نقاط (ج)', 'وفر لو وصل للمتوسط (ج)', NOTE],
    rows: savings().map(s => [s.sup, s.grp, s.cost, s.retail, s.disc, s.bench, s.retPct, Math.round(s.save3), Math.round(s.save), '']) }),
  suppliers: () => ({ name: 'كل الموردين', why: 'ترتيب كل الموردين بحجم الشراء والخصم المرجّح والمرتجع.',
    head: ['المورد', 'مشتريات آخر 3 شهور (تكلفة)', 'خصم الدواء %', 'خصم الكوزمو والمستلزمات %', 'الخصم الكلي %', 'خصم السنة كلها %', 'أصناف', 'مرتجع (ج)', 'مرتجع %'], rows: B.suppliers.filter(s => s.cost > 0).map(s => [s.sup, s.cost, s.dm, s.dc, s.disc, s.discY, s.items, s.ret, s.retPct]) }),
  season: () => ({ name: 'زوّد قبل الموسم', why: 'أصناف موسمية مبيعاتها الشتوية 2025 كبيرة وتغطيتها الحالية أقل من 25 يوم.',
    head: ['الكود', 'الصنف', 'الرصيد (عبوات)', 'التغطية (يوم)', 'مبيعات سبتمبر–ديسمبر 2025 (ج)', 'المورد', NOTE], rows: seasonLow().map(x => [x.id, x.name, x.packs, x.dsi, x.sv, x.sup, '']) }),
  watch: () => ({ name: 'تحت المراقبة', why: 'وقفت حركتهم آخر 90 يوم — تدخل قبل ما يتحولوا لميت.',
    head: ['الكود', 'الصنف', 'الرصيد (عبوات)', 'التكلفة (ج)', 'أيام من آخر بيع', 'المورد', NOTE], rows: byCls('تحت المراقبة').sort((a, b) => b.cost - a.cost).map(x => [x.id, x.name, x.packs, x.cost, x.idle, x.sup, '']) }),
  expiry: () => ({ name: 'نير 6 شهور', why: 'دفعات صلاحيتها خلال 6 شهور والمعرّض منها للانتهاء قبل البيع (تقدير من معدل بيع 90 يوم).',
    head: ['الكود', 'الصنف', 'الصلاحية', 'أيام متبقية', 'عبوات', 'مباع 90 يوم', 'عبوات معرّضة', 'تكلفة معرّضة (ج)', '% معرّض', 'المورد', NOTE],
    rows: [...B.expiry].sort((a, b) => (b.riskCost || 0) - (a.riskCost || 0)).map(e => [e.id, e.name, e.exp, e.days, e.qty, e.p90, e.risk, e.riskCost, e.riskPct, e.sup, '']) }),
  alts: () => ({ name: 'بدائل أرخص - ' + (ALT_CUR || ''), why: 'نفس الأصناف اتشرت من مورد تاني بخصم أعلى (فرصة توفير). الوفر = القيمة البيعية × فرق الخصم. اتأكد من توفر الصنف وموثوقية المورد البديل.',
    head: ['الكود', 'الصنف', 'المجموعة', 'اشتريناه من', 'قيمة بيعية (ج)', 'خصمه %', 'المورد البديل', 'خصم البديل %', 'فواتير البديل', 'الفرق (نقطة)', 'كنا هنوفر (ج)', 'أقرب صلاحية عند البديل', NOTE],
    rows: altRows().filter(a => a.frm === ALT_CUR).sort((a, b) => b.save - a.save).map(a => [a.id, a.name, GRP[a.grp] || a.grp, a.frm, a.fretail, a.fdisc, a.to, a.tdisc, a.tnl, a.gap, a.save, a.texp, '']) }),
  ex: () => ({ name: 'الأصناف (حسب الفلتر)', why: 'نتيجة البحث والفلاتر الحالية في شاشة الأصناف.',
    head: ['الكود', 'الصنف', 'المجموعة العلاجية', 'التصنيف', 'ABC', 'الرصيد (عبوات)', 'التكلفة (ج)', 'مبيعات 90 يوم (ج)', 'التغطية (يوم)', 'عبوات زيادة', 'اطلب (عبوات)', 'هامش %', 'خصم آخر 3 شهور %', 'آخر بيع', 'آخر شراء', 'المورد الحالي', NOTE],
    rows: filtered().map(x => [x.id, x.name, x.thc, x.cls, x.abc, x.packs, x.cost, x.n90, x.dsi, x.xPacks, x.nPacks, x.margin, x.disc, x.lastSale, x.lastBuy, x.sup3 || 'مفيش شراء حديث', '']) })
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
  ${sec('neg', '🤝 فاوض — موردين حجمهم كبير وخصمهم أقل من متوسط مجموعتهم', `آخر 3 شهور. متوسط خصم الدواء <b>${B.kpi.discMed}%</b> والكوزمو والمستلزمات <b>${B.kpi.discCos}%</b> (كل مورد بيتقارن بمتوسط مجموعته). لو الموردين دول زادوا الخصم 3 نقاط بس نوفر حوالي <b>${M(sum(sv, x => x.save3))}</b>، ولو وصلوا لمتوسط مجموعتهم حوالي <b>${M(sum(sv, x => x.save))}</b>. <b>الرقم الأول هو الواقعي</b> — ابدأ بالأكبر حجماً.`,
    table([['sup', 'المورد', 'nm'], ['grp', 'المجموعة'], ['cost', 'مشتريات (تكلفة)', 'm'], ['disc', 'خصمه %', 'p'], ['bench', 'متوسط المجموعة %', 'p'], ['save3', 'وفر واقعي (+3 نقاط)', 'm'], ['save', 'وفر لو وصل للمتوسط', 'm']], sv.slice(0, 10)))}
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
  const SORTS = [['n90', 'الأعلى مبيعاً 90 يوم'], ['cost', 'الأعلى تكلفة مخزون'], ['excess', 'الأعلى زيادة'], ['short', 'الأعلى نقص'], ['gp90', 'الأعلى ربحاً'], ['dsi', 'يكفي أطول فترة'], ['idle', 'أطول فترة من غير بيع'], ['disc', 'الأعلى خصم شراء']];
  const html = `<div class="ivcard"><h3>شاشة الأصناف — إزاي أستخدمها؟</h3>
  <ol class="note" style="margin:0 18px 8px 0;line-height:2.1"><li>اكتب <b>اسم أو كود</b> صنف في البحث، أو اختار تصنيف / مورد / مجموعة علاجية.</li><li>اضغط على <b>أي صنف</b> تفتح بطاقته: سبب تصنيفه ورسم مبيعاته شهر بشهر مقابل 2025.</li><li>لما توصل للقايمة اللي عايزها دوس <b>📥 تصدير</b> وابعتها للمشتريات.</li></ol>
  <p class="why"><b>معنى الأعمدة:</b> <b>رصيد</b> = العبوات الموجودة. <b>تكلفة</b> = قيمة الرصيد بسعر الشراء. <b>مبيعات 90</b> = مبيعات آخر 90 يوم. <b>يكفي (يوم)</b> = المخزون هيكفي كام يوم بسرعة البيع الحالية. <b>هامش</b> = نسبة الربح من سعر البيع. <b>خصم آخر 3 شهور</b> = الخصم اللي أخدناه من المورد في مشتريات يوليو–6 أكتوبر (لو مفيش شراء في الفترة بيظهر —). <b>ABC:</b> A = الأصناف الأهم (80% من المبيعات)، B متوسطة، C الأقل.</p>
  <p class="note" style="margin:6px 0 4px">اضغط على تصنيف تفلتر بيه:</p>
  <div id="chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><button class="sm ghost" data-chip="">الكل</button>${CLASSES.map(c => `<button class="sm" data-chip="${esc(c)}" style="background:${CLS_COL[c]};color:#fff">${esc(c)}</button>`).join('')}</div>
  <p class="note" id="chipHelp" style="margin:0"></p></div>
  <div class="ivcard"><div class="ctl">
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
        table([['id', 'الكود'], ['name', 'الصنف', 'nm'], [x => badge(x.cls), 'التصنيف', 'raw'], ['abc', 'ABC'], ['packs', 'رصيد', 'n'], ['cost', 'تكلفة', 'm'], ['n90', 'مبيعات 90', 'm'], ['dsi', 'يكفي (يوم)', 'n'], ['margin', 'هامش %', 'p'], ['disc', 'خصم آخر 3 شهور %', 'p'], [x => x.sup3 || 'مفيش شراء حديث', 'المورد الحالي', 'raw']], r.slice(EXPL.page * pg, EXPL.page * pg + pg), { click: 1 }) +
        `<div class="pg"><button class="sm ghost" id="pp"${EXPL.page ? '' : ' disabled'}>السابق</button><span>${EXPL.page + 1} / ${pages}</span><button class="sm ghost" id="pn"${EXPL.page < pages - 1 ? '' : ' disabled'}>التالي</button></div>`;
      sortable($('#elist', ROOT)); const pp = $('#pp', ROOT), pn = $('#pn', ROOT); if (pp) pp.onclick = () => { EXPL.page--; draw(); }; if (pn) pn.onclick = () => { EXPL.page++; draw(); }; };
    const helpTxt = () => { $('#chipHelp', ROOT).innerHTML = EXPL.cls ? `<b>${esc(EXPL.cls)}:</b> ${esc(CLS_HELP[EXPL.cls])}` : ''; ROOT.querySelectorAll('[data-chip]').forEach(b => { b.style.outline = b.dataset.chip === EXPL.cls ? '3px solid var(--navy)' : 'none'; }); };
    ROOT.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => { EXPL.cls = b.dataset.chip; EXPL.page = 0; $('#ecls', ROOT).value = EXPL.cls; helpTxt(); draw(); });
    $('#ecls', ROOT).addEventListener('change', helpTxt); helpTxt();
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
    <div class="ivgrid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">${kpi('الرصيد', N(x.packs) + ' عبوة', M(x.cost) + ' تكلفة')}${kpi('مبيعات 90 يوم', M(x.n90), N(x.p90) + ' عبوة')}${kpi('هامش / ربح 90', P1(x.margin), M(x.gp90))}${kpi('خصم الشراء (آخر 3 شهور)', x.disc == null ? '—' : P1(x.disc), x.sup3 || 'مفيش شراء حديث')}${kpi('آخر بيع', x.lastSale || '—', x.idle == null ? '' : 'من ' + N(x.idle) + ' يوم')}${kpi('آخر شراء', x.lastBuy || '—', x.sinceBuy == null ? '' : 'من ' + N(x.sinceBuy) + ' يوم')}</div>
    <div class="ch" style="margin-top:12px;height:230px"><canvas id="cIt"></canvas></div><p class="note">أعمدة = مبيعات 2026 الشهرية، خط = نفس الشهر 2025 (قبل المرتجع).</p></div>`;
  ROOT.appendChild(m); m.addEventListener('click', e => { if (e.target === m) closeItem(); }); $('#invX', m).onclick = closeItem;
  window.__itC = new Chart($('#cIt', m), { data: { labels: MN, datasets: [{ type: 'bar', label: '2026', data: x.m26.concat([null, null]), backgroundColor: '#0B8577', borderRadius: 5 }, { type: 'line', label: '2025', data: x.m25, borderColor: '#E0A526', tension: .3, pointRadius: 3 }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => K(v) } } } } });
}
function closeItem() { const m = $('#invMM'); if (m) { if (window.__itC) window.__itC.destroy(); m.remove(); } }

/* ---------- موردين ---------- */
let SPG = 'med';
function vSuppliers() {
  const k = B.kpi, G = { med: { n: 'دواء', bench: k.discMed, c: 'cm', d: 'dm', min: 60000 }, cos: { n: 'كوزمو ومستلزمات', bench: k.discCos, c: 'cc', d: 'dc', min: 40000 } };
  const g = G[SPG], S = B.suppliers.filter(x => x.cost > 0), sv = savings(), big = sv[0], tot3 = sum(sv, x => x.save3), totAll = sum(sv, x => x.save);
  const topBuy = [...S].sort((x, y) => y.cost - x.cost)[0], SG = S.filter(x => x[g.c] > 0);
  const LABELS = { id: 'supLabels', afterDatasetsDraw(ch) { const c = ch.ctx, m = ch.getDatasetMeta(0); c.save(); c.font = '600 11px Alexandria, sans-serif'; c.fillStyle = '#10202E'; c.textAlign = 'center';
    SG.forEach((x, i) => { if (x[g.c] >= g.min * 2) { const e = m.data[i]; if (e) c.fillText(x.sup.trim().slice(0, 18), e.x, e.y - e.options.radius - 4); } }); c.restore(); } };
  const html = `<div class="ivcard"><h3>الصفحة دي بتقول إيه؟ (بالبساطة)</h3>
  <p class="why">كل مورد بنشتري منه بيدّينا <b>خصم</b> عن سعر البيع للجمهور. مثال: علبة بتتباع بـ 100 ج وإحنا بنشتريها بـ 72 ج = خصم <b>28%</b>. كل ما الخصم أعلى كل ما كسبنا أكتر على نفس الصنف من غير ما نغيّر سعر البيع.<br>
  <b>الفترة: آخر 3 شهور (${esc(k.win3)})</b> — لأن مورد ممكن كان بيدّينا خصم كويس في أول السنة ومبقاش دلوقتي، فبنحكم على الوضع الحالي.<br>
  <b>مقسمين لمجموعات:</b> الكوزمو والمستلزمات خصمها أعلى بطبيعتها فكانت بتعلّي المتوسط. دلوقتي <b>الدواء ${k.discMed}%</b> (${k.shareMed}% من حجم الشراء) و<b>الكوزمو والمستلزمات ${k.discCos}%</b> (${k.shareCos}%)، واللبن ${k.discMilk}% (مسعّر جبرياً فمش داخل في أي مقارنة). المتوسط الكلي ${k.discAvg}%، لكن <b>كل مورد بيتقارن بمتوسط مجموعته</b>.<br>
  ⚠ الخصم ده <b>مش هامش الربح الكلي</b>؛ هو بس بيقول إحنا بنشتري بكام.</p>
  <div class="ivgrid">
    ${kpi('خصم الدواء', k.discMed + '%', 'من ' + K(k.purchases3) + ' ج مشتريات (كل المجموعات)', 'b')}
    ${kpi('خصم الكوزمو والمستلزمات', k.discCos + '%', 'مقارنة موردينه مع بعض بس', 'p')}
    ${kpi('أكبر مورد حجماً', esc(topBuy.sup), M(topBuy.cost) + ' — خصمه ' + topBuy.disc + '%')}
    ${kpi('موردين نفاوضهم', sv.length + ' (مورد × مجموعة)', 'حجمهم كبير وخصمهم تحت متوسط مجموعتهم', 'r')}
    ${kpi('وفر واقعي (+3 نقاط)', M(tot3), 'على مشتريات آخر 3 شهور', 'o')}
  </div></div>
  <div class="ivcard"><h3>حجم الشراء مقابل الخصم</h3>
  <div id="spg" style="display:flex;gap:6px;margin-bottom:8px"><button class="sm ${SPG === 'med' ? '' : 'ghost'}" data-spg="med">💊 دواء</button><button class="sm ${SPG === 'cos' ? '' : 'ghost'}" data-spg="cos">🧴 كوزمو ومستلزمات</button></div>
  <ol class="note" style="margin:0 18px 10px 0;line-height:2">
    <li>كل <b>دايرة = مورد</b> (في مجموعة <b>${g.n}</b>).</li><li>كل ما راحت <b>يمين</b> = بنشتري منه أكتر.</li><li>كل ما <b>طلعت فوق</b> = خصمه أعلى (أحسن لينا).</li><li><b>حجم</b> الدايرة = قيمة المرتجع.</li><li>الخط المتقطع = متوسط خصم ${g.n} (${g.bench}%).</li><li>🔴 <b>أحمر</b> = مورد كبير وتحت الخط = <b>نتفاوض معاه</b>. 🟢 أخضر = تمام.</li>
  </ol>
  <div class="ch tall"><canvas id="cSp"></canvas></div></div>
  <div class="ivcard"><h3>🎯 الخلاصة: نتفاوض مع مين وبكام؟</h3>
  <p class="why">${sv.length ? `مثال: <b>${esc(big.sup)}</b> في مجموعة <b>${esc(big.grp)}</b> اشترينا منه بـ <b>${M(big.cost)}</b> وخصمه <b>${big.disc.toFixed(1)}%</b> مقابل متوسط المجموعة ${big.bench}% (فرق ${big.gap.toFixed(1)} نقطة). لو زاد ${Math.min(3, big.gap).toFixed(0)} نقاط بس نوفر حوالي <b>${M(big.save3)}</b>، ولو وصل لمتوسط المجموعة حوالي <b>${M(big.save)}</b>.` : 'مفيش موردين كبار تحت المتوسط.'}</p>
  ${table([['sup', 'المورد', 'nm'], ['grp', 'المجموعة'], ['cost', 'بنشتري منه (تكلفة)', 'm'], ['disc', 'خصمه الحالي %', 'p'], ['bench', 'متوسط المجموعة %', 'p'], [x => x.gap.toFixed(1), 'الفرق (نقطة)', 'raw'], ['save3', 'وفر واقعي (+3 نقاط)', 'm'], ['save', 'وفر لو وصل للمتوسط', 'm']], sv)}
  <p class="note"><b>إزاي نقرا الأرقام:</b> "الفرق" = متوسط المجموعة − خصم المورد. "الوفر" = القيمة البيعية لمشترياتنا منه (في المجموعة دي) × الفرق. المستورد خصمه قليل بطبيعته، فالواقعي نطلب <b>زيادة 2 لـ 3 نقاط</b>. ابدأ بأكبر مورد حجماً.</p>
  <p style="margin:8px 0 0"><button class="sm ghost" data-xl="neg">📥 تصدير القايمة دي Excel للمشتريات</button></p></div>
  <div id="altBox"></div>
  <div class="ivcard"><h3>كل الموردين (آخر 3 شهور)</h3><p style="margin:0 0 8px"><button class="sm ghost" data-xl="suppliers">📥 تصدير Excel</button></p>${table([['sup', 'المورد', 'nm'], ['cost', 'مشتريات (تكلفة)', 'm'], ['dm', 'خصم الدواء %', 'p'], ['dc', 'خصم الكوزمو والمستلزمات %', 'p'], ['disc', 'الخصم الكلي %', 'p'], ['discY', 'خصم السنة كلها %', 'p'], ['items', 'أصناف', 'n'], ['ret', 'مرتجع', 'm'], ['retPct', 'مرتجع %', 'p']], S)}
  <p class="note">الخصم المرجّح = 1 − (تكلفة الفواتير بعد المرتجع ÷ قيمتها البيعية). عمود "خصم السنة كلها" للمقارنة بس: لو خصم المورد نزل عنه في آخر 3 شهور، يبقى فيه تغيير.</p></div>
  <div class="ivcard"><h3>الخصم حسب الشكل الدوائي (آخر 3 شهور)</h3><div class="ch"><canvas id="cCt"></canvas></div><p class="note">اللبن والمستلزمات مسعّرة جبرياً — خصمها المنخفض طبيعي ومش مادة تفاوض. الكوزمو خصمه أعلى بطبيعته.</p></div>`;
  return { html, after() {
    drawAlt();
    ROOT.querySelectorAll('[data-spg]').forEach(b => b.onclick = () => { SPG = b.dataset.spg; setView('sp'); });
    mk('cSp', { type: 'bubble', data: { datasets: [{ label: 'مورد', data: SG.map(x => ({ x: x[g.c], y: x[g.d], r: 4 + Math.sqrt(Math.max(x.ret, 0)) / 9, n: x.sup })), backgroundColor: SG.map(x => x[g.d] < g.bench - 2 && x[g.c] >= g.min ? 'rgba(192,57,43,.65)' : 'rgba(11,133,119,.55)') }] },
      options: { maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'مشتريات ' + g.n + ' — آخر 3 شهور (تكلفة)' }, ticks: { callback: v => K(v) } }, y: { title: { display: true, text: 'الخصم المرجّح %' }, suggestedMin: 10 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.raw.n}: ${M(c.raw.x)} · خصم ${c.raw.y.toFixed(1)}%` } } } },
      plugins: [LABELS, { id: 'avgLine', afterDraw(ch) { const y = ch.scales.y.getPixelForValue(g.bench), c = ch.ctx; c.save(); c.strokeStyle = '#999'; c.setLineDash([5, 4]); c.beginPath(); c.moveTo(ch.chartArea.left, y); c.lineTo(ch.chartArea.right, y); c.stroke(); c.restore(); } }] });
    mk('cCt', { type: 'bar', data: { labels: B.cats.map(c => c.cat), datasets: [{ data: B.cats.map(c => c.disc), backgroundColor: B.cats.map(c => c.disc < k.discMed - 5 ? '#E67E22' : '#0B8577'), borderRadius: 5 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: v => v + '%' } } } } });
  } };
}

/* ---------- لو اشترينا من مورد تاني ---------- */
let ALT_CUR = null;
const altRows = () => (B.alts || []).map(r => ({ id: r[0], name: r[1], frm: r[2], fretail: r[3], fdisc: r[4], to: r[5], tdisc: r[6], tnl: r[7], gap: r[8], save: r[9], texp: r[10], grp: r[11], small: r[12] }));
function drawAlt() {
  const box = $('#altBox', ROOT); if (!box) return; const A = altRows();
  if (!A.length) { box.innerHTML = '<div class="ivcard"><p class="sub">الميزة دي محتاجة تحديث ملف التحليل (inventory_bundle.json).</p></div>'; return; }
  const froms = [...new Set(A.map(a => a.frm))].map(f => ({ f, v: sum(A.filter(a => a.frm === f), a => a.save) })).sort((a, b) => b.v - a.v);
  const cur = ALT_CUR && froms.find(x => x.f === ALT_CUR) ? ALT_CUR : (froms.find(x => x.f === 'Pharmaoverseas') ? 'Pharmaoverseas' : froms[0].f); ALT_CUR = cur;
  const R = A.filter(a => a.frm === cur).sort((a, b) => b.save - a.save), tot = sum(R, a => a.save), base = sum(R, a => a.fretail), top = R[0];
  const to = {}; R.forEach(a => { const t = (to[a.to] = to[a.to] || { to: a.to, n: 0, save: 0, retail: 0 }); t.n++; t.save += a.save; t.retail += a.fretail; });
  const tr = Object.values(to).sort((a, b) => b.save - a.save);
  box.innerHTML = `<div class="ivcard"><h3>💡 لو كنا اشترينا نفس الأصناف من مورد تاني بخصم أعلى</h3>
  <p class="why">اختار المورد اللي عايز تقارنه: <select id="altSel" style="width:auto;display:inline-block;padding:6px 10px">${froms.map(x => `<option value="${esc(x.f)}"${x.f === cur ? ' selected' : ''}>${esc(x.f)} — وفر ${M(x.v)}</option>`).join('')}</select><br>
  بنقارن <b>نفس الصنف</b> اللي اشتريناه من <b>${esc(cur)}</b> بنفس الصنف اللي اشتريناه من موردين تانيين في <b>آخر 3 شهور</b> (${esc(B.kpi.win3)}) — يعني المورد البديل اشترينا منه فعلاً في الفترة دي. لقينا <b>${R.length} صنف</b> اتشرى من مورد تاني بخصم أعلى (على الأقل نقطتين، وبقيمة 500 ج بيعي على الأقل). اللبن مش داخل في المقارنة (مسعّر جبرياً). لو كنا اشتريناهم من الأرخص كنا هنوفر حوالي <b>${M(tot)}</b> من أصل <b>${M(base)}</b> (قيمة بيعية) اشتريناها من ${esc(cur)} في الأصناف دي.</p>
  ${top ? `<p class="why"><b>مثال:</b> ${esc(top.name)} — اشتريناه من ${esc(cur)} بخصم <b>${top.fdisc}%</b> (قيمة بيعية ${M(top.fretail)})، واتشرى من <b>${esc(top.to)}</b> بخصم <b>${top.tdisc}%</b>. الفرق ${top.gap} نقطة × ${M(top.fretail)} = <b>${M(top.save)}</b> كنا هنوفرهم.</p>` : ''}
  <h4 style="margin:10px 0 4px">كنا نشتري كام صنف من مين؟</h4>${table([['to', 'المورد البديل', 'nm'], ['n', 'عدد الأصناف', 'n'], ['retail', 'قيمة بيعية اشتريناها من ' + cur, 'm'], ['save', 'كنا هنوفر', 'm']], tr)}
  <h4 style="margin:14px 0 4px">أكبر الأصناف توفيراً</h4>${table([['name', 'الصنف', 'nm'], [x => GRP[x.grp] || x.grp, 'المجموعة', 'raw'], ['fretail', 'اشتريناه من ' + cur + ' (بيعي)', 'm'], ['fdisc', 'خصمه %', 'p'], ['to', 'البديل', 'nm'], ['tdisc', 'خصم البديل %', 'p'], ['gap', 'الفرق (نقطة)', 'n'], ['save', 'كنا هنوفر', 'm'], [x => x.small ? '⚠ فاتورة واحدة' : '', 'ملاحظة', 'raw']], R.slice(0, 25))}
  <p class="note"><b>إزاي اتحسب:</b> الوفر = القيمة البيعية اللي اشتريناها من ${esc(cur)} × (خصم البديل − خصمه). استبعدنا الدفعات قصيرة الصلاحية (أقل من تقريباً 9 شهور) عشان الخصم الكبير ساعتها بيبقى بسبب الصلاحية مش بسبب المورد، واستبعدنا مورد <b>outting</b> لأن خصوماته خاصة ومش دايمة.<br>
  <b>⚠ فاتورة واحدة</b> = خصم البديل جه من فاتورة واحدة بس في الفترة (عينة صغيرة) — اتأكد إنه خصمه الدايم.<br><b>قبل ما تقرر:</b> لازم تتأكد إن المورد البديل <b>بيوفّر الصنف دايماً وبنفس الكمية</b> وإن مصدره موثوق (خصوصاً لو الخصم كبير جداً زي 50%)، ولازم نراجع شروط الدفع والتوصيل. الأرقام دي بتوري الفرصة مش ضمان.</p>
  <p style="margin:8px 0 0"><button class="sm ghost" data-xl="alts">📥 تصدير قايمة ${esc(cur)} Excel للمشتريات</button></p></div>`;
  $('#altSel', box).onchange = e => { ALT_CUR = e.target.value; drawAlt(); };
  sortable(box);
}

/* ---------- الربحية والتصنيف العلاجي ---------- */
function vProfit() {
  const T = [...B.thc].sort((a, b) => b.sales - a.sales), top = IT.filter(x => x.n90 > 0).sort((a, b) => b.gp90 - a.gp90).slice(0, 20);
  const un = t => String(t.thc).startsWith('غير مصنف'), totS = sum(T, t => t.sales), totG = sum(T, t => t.gp), mg = totG / totS * 100;
  const byG = T.filter(t => !un(t)).sort((a, b) => b.gp - a.gp), t1 = byG[0], share3 = sum(byG.slice(0, 3), t => t.gp) / totG * 100;
  const lowM = T.filter(t => !un(t) && t.sales > totS * 0.03 && t.margin < mg - 5), heavy = T.filter(t => !un(t) && t.cover > 45 && t.margin < mg);
  const li = a => a.length ? a.map(t => `<b>${esc(t.thc)}</b> (هامش ${t.margin}%)`).join('، ') : 'مفيش';
  const html = `<div class="ivcard"><h3>الربحية — يعني إيه؟</h3>
  <p class="why">ربح أي صنف = <b>مبيعاته × هامشه</b>. الهامش = الفرق بين سعر البيع وسعر الشراء كنسبة من سعر البيع. <b>مثال:</b> صنف باع 10,000 ج وهامشه 25% = ربح 2,500 ج. كل الأرقام دي لآخر 90 يوم، والأصناف متقسمة لمجموعات علاجية (تصنيف مبدئي بالكلمات — لسه محتاج مراجعتك).</p>
  <div class="ivgrid">
    ${kpi('الربح الإجمالي (90 يوم)', M(totG), 'من مبيعات ' + M(totS))}
    ${kpi('متوسط الهامش', mg.toFixed(1) + '%', 'مقياس المقارنة تحت', 'b')}
    ${kpi('أكبر مجموعة ربحاً', esc(t1.thc), M(t1.gp) + ' = ' + (t1.gp / totG * 100).toFixed(0) + '% من الربح', 'p')}
    ${kpi('أكبر 3 مجموعات', share3.toFixed(0) + '% من الربح', 'التركيز في قليل من المجموعات', 'o')}
  </div></div>
  <div class="ivcard"><h3>المبيعات والربح لكل مجموعة</h3>
  <ol class="note" style="margin:0 18px 10px 0;line-height:2"><li>العمود <b>الأخضر</b> = مبيعات المجموعة.</li><li>العمود <b>الأصفر</b> = الربح اللي بتجيبه.</li><li>كل ما الأصفر <b>قريب من الأخضر</b> = هامش أعلى (أحسن).</li><li>الأخضر الطويل والأصفر القصير = بتبيع كتير وبتكسب قليل.</li></ol>
  <div class="ch tall"><canvas id="cTh"></canvas></div></div>
  <div class="ivcard"><h3>🎯 الخلاصة والقرار</h3><ul class="note" style="line-height:2.1;margin:0 18px 0 0">
    <li>أكبر مجموعة في الربح <b>${esc(t1.thc)}</b> (${(t1.gp / totG * 100).toFixed(0)}% من الربح كله) — دي مجموعة ما تسيبهاش تخلص.</li>
    <li>مجموعات مبيعاتها كبيرة لكن <b>هامشها أقل من المتوسط (${mg.toFixed(0)}%) بخمس نقاط أو أكتر:</b> ${li(lowM)} ← فاوض الموردين أو راجع السعر لو مش مسعّر جبرياً.</li>
    <li>مجموعات <b>مخزونها يكفي أكتر من 45 يوم وهامشها تحت المتوسط:</b> ${li(heavy)} ← فلوس واقفة بتكسب قليل، قلّل الشراء فيها.</li>
  </ul></div>
  <div class="ivcard"><h3>تفاصيل المجموعات</h3>${table([['thc', 'المجموعة', 'nm'], ['items', 'عدد الأصناف', 'n'], ['sales', 'المبيعات (90 يوم)', 'm'], ['gp', 'الربح (90 يوم)', 'm'], ['margin', 'الهامش %', 'p'], ['stock', 'تكلفة المخزون', 'm'], ['cover', 'المخزون يكفي (يوم)', 'n'], ['disc', 'خصم الشراء %', 'p']], T)}
  <p class="note"><b>إزاي نقرا الجدول:</b> "المخزون يكفي" = كام يوم هنبيع من اللي موجود. رقم عالي + هامش ضعيف = فلوس واقفة وربحها قليل. رقم صغير + هامش عالي = ركّز عليها وماتسيبهاش تخلص.</p></div>
  <div class="ivcard"><h3>أعلى 20 صنف ربحاً</h3><p class="why">الأصناف دي <b>ممنوع تخلص</b> ولازم نشتريها بأحسن خصم — اضغط على أي صنف تشوف تفاصيله.</p>${table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['n90', 'مبيعات 90', 'm'], ['margin', 'هامش %', 'p'], ['gp90', 'ربح 90', 'm'], [x => badge(x.cls), 'الحالة', 'raw'], ['dsi', 'يكفي (يوم)', 'n']], top, { click: 1 })}</div>`;
  return { html, after() {
    mk('cTh', { type: 'bar', data: { labels: T.map(t => t.thc), datasets: [{ label: 'مبيعات', data: T.map(t => t.sales), backgroundColor: '#0B8577', borderRadius: 4 }, { label: 'ربح', data: T.map(t => t.gp), backgroundColor: '#E0A526', borderRadius: 4 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.x)}` } } }, scales: { x: { ticks: { callback: v => K(v) } } } } });
  } };
}

/* ---------- الصلاحية ---------- */
function vExpiry() {
  const E = [...B.expiry].sort((a, b) => (b.riskCost || 0) - (a.riskCost || 0)), by = {}, bs = {};
  B.expiry.forEach(e => { const k = e.exp; (by[k] = by[k] || { c: 0, r: 0 }); by[k].c += e.cost || 0; by[k].r += e.riskCost || 0;
    if (e.riskCost > 0) { const q = (e.sup || '—').trim(); (bs[q] = bs[q] || { sup: q, n: 0, c: 0 }).n++; bs[q].c += e.riskCost; } });
  const ks = Object.keys(by).sort(), sr = Object.values(bs).sort((a, b) => b.c - a.c), ex = E[0], near = Math.min(...B.expiry.map(e => e.days)), riskN = B.expiry.filter(e => e.riskCost > 0.5).length;
  const sellable = ex ? (ex.p90 / 90) * ex.days : 0;
  const html = `<div class="ivcard"><h3>النير — يعني إيه؟</h3>
  <p class="why"><b>النير</b> = أصناف صلاحيتها هتخلص خلال 6 شهور. المشكلة مش إنها قربت تخلص، المشكلة إننا <b>مش هنلحق نبيعها كلها</b> قبل ما تنتهي. بنحسب كده: <b>بنضرب سرعة بيعنا اليومي للصنف × الأيام اللي فاضلة</b>، وأي كمية زيادة عن كده بنعتبرها <b>معرّضة للانتهاء</b> (يعني خسارة).${ex ? `<br><b>مثال حقيقي:</b> ${esc(ex.name)} — صلاحيته ${esc(ex.exp)} (فاضل ${N(ex.days)} يوم)، بنبيع منه حوالي ${(ex.p90 / 90).toFixed(2)} عبوة في اليوم يعني هنبيع تقريباً ${sellable.toFixed(1)} عبوة بس قبل الانتهاء، ومعانا ${N(ex.qty)} عبوة → <b>${N(ex.risk)} عبوة معرّضة (حوالي ${M(ex.riskCost)})</b>.` : ''}</p>
  <div class="ivgrid">
    ${kpi('دفعات صلاحيتها خلال 6 شهور', N(B.kpi.expN) + ' دفعة', 'تكلفتها ' + M(B.kpi.expCost), 'o')}
    ${kpi('معرّض للانتهاء (تقدير)', M(B.kpi.expRisk), (B.kpi.expRisk / B.kpi.expCost * 100).toFixed(0) + '% من تكلفة النير', 'r')}
    ${kpi('أصناف فيها كمية معرّضة', N(riskN) + ' صنف', 'من ' + N(B.kpi.expN) + ' دفعة')}
    ${kpi('أقرب دفعة بتنتهي', N(near) + ' يوم', 'ابدأ بيها', 'p')}
  </div></div>
  <div class="ivcard"><h3>إيه اللي المفروض نعمله؟</h3><ol class="note" style="margin:0 18px 0 0;line-height:2.1">
    <li><b>رجّعه للمورد</b> لو الكمية المعرّضة كبيرة — قبل ما تخلص مهلة المرتجع (مهلة كل مورد غير التانية، اسأل المشتريات).</li>
    <li>لو الكمية المعرّضة صغيرة: <b>اعمل عليه عرض أو خصم</b> أو حطه قدام الكاشير وفهّم البياعين يرشحوه.</li>
    <li>الأصناف اللي بتتباع بسرعة: <b>بيع الأقدم الأول</b> (FEFO) وماتعملش حاجة تانية.</li>
  </ol></div>
  <div class="ivcard"><h3>النير شهر بشهر</h3><ol class="note" style="margin:0 18px 10px 0;line-height:2"><li>كل عمود = شهر انتهاء الصلاحية.</li><li><b>الأخضر</b> = تكلفة كل الدفعات اللي بتنتهي في الشهر ده.</li><li><b>الأحمر</b> = الجزء اللي مش هنلحق نبيعه (الخسارة المتوقعة).</li></ol><div class="ch"><canvas id="cEx"></canvas></div></div>
  <div class="ivcard"><h3>نرجّع لمين؟ (مجمّعة بالمورد)</h3><p class="why">قايمة واحدة لكل مورد بالمعرّض للانتهاء عندنا — ابعتها للمشتريات.</p>${table([['sup', 'المورد', 'nm'], ['n', 'عدد الدفعات المعرّضة', 'n'], ['c', 'تكلفتها المعرّضة', 'm']], sr)}</div>
  <div class="ivcard"><h3>الأعلى خطراً (دفعة بدفعة)</h3><p style="margin:0 0 8px"><button class="sm ghost" data-xl="expiry">📥 تصدير Excel</button></p>${table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['exp', 'تنتهي'], ['days', 'فاضل (يوم)', 'n'], ['qty', 'العبوات', 'n'], [x => (x.p90 / 90).toFixed(2), 'بنبيع/يوم', 'raw'], ['risk', 'عبوات معرّضة', 'n'], ['riskCost', 'تكلفتها', 'm'], ['riskPct', '% معرّض', 'n'], ['sup', 'المورد']], E)}
  <p class="note">المعرّض = العبوات − (البيع اليومي × الأيام الفاضلة). الدفعات الأقرب للانتهاء بتتباع الأول. التقدير بيعتمد على سرعة بيع آخر 90 يوم، فلو الصنف موسمي ممكن يتغير.</p></div>`;
  return { html, after() {
    mk('cEx', { type: 'bar', data: { labels: ks, datasets: [{ label: 'تكلفة الدفعات', data: ks.map(k => by[k].c), backgroundColor: '#0B8577', borderRadius: 5 }, { label: 'معرّض للانتهاء', data: ks.map(k => by[k].r), backgroundColor: '#C0392B', borderRadius: 5 }] }, options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.y)}` } } } } });
  } };
}

/* ---------- شهري ---------- */
function vMonthly() {
  const m = B.monthly, full = m.filter(x => x.m < 10), last3 = full.slice(-3), first5 = full.slice(0, 5);
  const gr = a => (sum(a, x => x.net) / sum(a, x => x.n25) - 1) * 100, sg = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  const best = [...full].sort((a, b) => b.net - a.net)[0], top = [...full].sort((a, b) => b.net / b.n25 - a.net / a.n25)[0];
  const build = sum(full, x => x.buy - x.cogs), g3 = gr(last3), g5 = gr(first5);
  const html = `<div class="ivcard"><h3>الشهري — يعني إيه؟</h3>
  <p class="why">بنقارن كل شهر في 2026 بـ <b>نفس الشهر في 2025</b> عشان نعرف المبيعات بتكبر ولا بتصغر. "الصافي" = المبيعات بعد خصم المرتجع.<br>
  وفي الجزء التاني بنقارن <b>اللي اشتريناه</b> باللي <b>اتباع</b> (بتكلفته): <b>مثال:</b> لو اشترينا بضاعة بـ 1,000,000 ج وبعنا بضاعة تكلفتها 900,000 ج، يبقى المخزون كبر 100,000 ج (فلوس واقفة). لو عكس كده، المخزون بيصغر.</p>
  <div class="ivgrid">
    ${kpi('أحسن شهر مبيعاً', MN[best.m - 1], M(best.net) + ' صافي', 'b')}
    ${kpi('آخر 3 شهور عن 2025', sg(g3), MN[last3[0].m - 1] + ' – ' + MN[last3[2].m - 1], g3 >= 0 ? '' : 'r')}
    ${kpi('أول 5 شهور عن 2025', sg(g5), MN[0] + ' – ' + MN[4], g5 >= 0 ? '' : 'o')}
    ${kpi('المخزون كبر/صغر (تقدير)', M(build), 'مشتريات − تكلفة مبيع، يناير–سبتمبر', 'p')}
  </div></div>
  <div class="ivcard"><h3>🎯 الخلاصة</h3><ul class="note" style="line-height:2.1;margin:0 18px 0 0">
    <li>آخر 3 شهور المبيعات <b>${sg(g3)}</b> عن 2025، وأول 5 شهور <b>${sg(g5)}</b> — ${g3 > g5 ? 'يعني <b>الاتجاه بيتحسن</b>' : 'يعني الاتجاه بيضعف'}.</li>
    <li>أحسن شهر: <b>${MN[best.m - 1]}</b> بـ ${M(best.net)}. أعلى نمو عن 2025: <b>${MN[top.m - 1]}</b> (${sg((top.net / top.n25 - 1) * 100)}).</li>
    <li>المشتريات المقدّرة ${build >= 0 ? 'أعلى' : 'أقل'} من تكلفة المبيع بحوالي <b>${M(Math.abs(build))}</b> في 9 شهور (حوالي ${(Math.abs(build) / B.kpi.stockCost * 100).toFixed(0)}% من المخزون الحالي) — ${build >= 0 ? 'يعني المخزون بيكبر، فراقب الفائض' : 'يعني المخزون بيصغر'}.</li>
  </ul><p class="note"><b>تنبيه:</b> المشتريات من <b>يوليو فعلية</b> (من ملفات المشتريات الشهرية)، أما يناير–يونيو فـ <b>تقديرية</b> لأن تقرير السنة مفيهوش تاريخ — وبتظهر بخط منقّط في الرسم.</p></div>
  <div class="ivcard"><h3>المبيعات شهر بشهر مقابل 2025</h3><ol class="note" style="margin:0 18px 10px 0;line-height:2"><li><b>العمود الأخضر</b> = صافي مبيعات الشهر في 2026.</li><li><b>الخط الأصفر</b> = نفس الشهر في 2025.</li><li>لو العمود أعلى من الخط = الشهر ده أحسن من السنة اللي فاتت.</li><li>أكتوبر = أول 6 أيام بس (مقارنة بنفس الـ 6 أيام).</li></ol><div class="ch tall"><canvas id="cSm"></canvas></div></div>
  <div class="ivcard"><h3>اللي اشتريناه مقابل اللي اتباع</h3><ol class="note" style="margin:0 18px 10px 0;line-height:2"><li><b>الخط البرتقالي</b> = المشتريات (فعلية من يوليو، والمنقّط تقدير).</li><li><b>الخط الأخضر</b> = تكلفة البضاعة اللي اتباعت.</li><li>البرتقالي <b>فوق</b> الأخضر = بنشتري أكتر من اللي بنبيعه = المخزون بيكبر.</li></ol><div class="ch tall"><canvas id="cBc"></canvas></div></div>
  <div class="ivcard"><h3>جدول الشهور</h3>${table([[x => MN[x.m - 1] + (x.m === 10 ? ' (1–6)' : ''), 'الشهر', 'raw'], ['gross', 'المبيعات', 'm'], ['net', 'الصافي (بعد المرتجع)', 'm'], ['n25', 'نفس الشهر 2025 (تقدير)', 'm'], [x => (x.net / x.n25 - 1) * 100, 'النمو %', 'p'], ['inv', 'عدد الفواتير', 'n'], ['buy', 'اشتريناه', 'm'], [x => x.exact ? 'فعلي' : 'تقدير', 'النوع', 'raw'], ['cogs', 'تكلفة اللي اتباع', 'm'], [x => x.buy - x.cogs, 'المخزون كبر بـ (تقدير)', 'n']], m)}
  <p class="note">مرتجعات 2025 = ${M(-B.kpi.ret25)} موزعة على الشهور بالتناسب (الملف مفيهوش تواريخ)، فنمو كل شهر تقريبي.</p></div>`;
  return { html, after() {
    mk('cSm', { data: { labels: m.map(x => MN[x.m - 1] + (x.m === 10 ? ' (1–6)' : '')), datasets: [{ type: 'bar', label: '2026 صافي', data: m.map(x => x.net), backgroundColor: '#0B8577', borderRadius: 6 }, { type: 'line', label: '2025 (تقدير)', data: m.map(x => x.n25), borderColor: '#E0A526', backgroundColor: '#E0A526', tension: .3, pointRadius: 4 }] }, options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${M(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: v => K(v) } } } } });
    mk('cBc', { type: 'line', data: { labels: m.map(x => MN[x.m - 1]), datasets: [{ label: 'مشتريات (فعلي من يوليو)', data: m.map(x => x.buy), borderColor: '#E67E22', backgroundColor: '#E67E22', tension: .3, segment: { borderDash: c => (m[c.p1DataIndex].exact ? undefined : [6, 4]) } }, { label: 'تكلفة المبيع', data: m.map(x => x.cogs), borderColor: '#0B8577', backgroundColor: '#0B8577', tension: .3 }] }, options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: v => K(v) } } } } });
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
  <h4>خصم الشراء</h4><p>1 − (تكلفة الفواتير بعد المرتجع ÷ قيمتها البيعية). مرتجعات الموردين بتتحسب خصم من قيمة الفاتورة. <b>المقارنة والموردين على آخر 3 شهور فقط</b> (1 يوليو – 6 أكتوبر) من 4 ملفات مشتريات منفصلة، ومقسمة لمجموعات: دواء / كوزمو ومستلزمات / لبن — كل مورد بيتقارن بمتوسط مجموعته. البديل لازم يكون اشترى الصنف في الفترة، وبيتستبعد outting والدفعات قصيرة الصلاحية.</p>
  <h4>النير</h4><p>${s.nearMonths} شهور من تقرير الإكسبير. المعرّض = العبوات − (المباع يومياً × الأيام المتبقية)، الدفعات الأقرب تتباع الأول.</p>
  <h4>تحذيرات</h4><p>• التصنيف العلاجي مبدئي (كلمات في الاسم).<br>• المرتجعات في ملفات النظام سالبة أصلاً — بتتجمع.<br>• مرتجعات 2025 اتوزعت بالتناسب على الشهور.<br>• كل القيم بالتكلفة، والكميات بالعبوات.</p>
  <p class="note">تاريخ التحليل: ${esc(B.at)} — مرجع الحساب ${esc(B.kpi.refDate)}.</p></div>`, after() {} };
}

/* ---------- عرض: طلبية النواقص ---------- */
// اللوب اليومي: تقرير النواقص ← طلبية النهارده | تقرير مشتريات امبارح ← قياس طلبية امبارح + تحديث خصومات الموردين (سجل مشتريات بالتاريخ)
const ORD = { plan: null, log: null, buys: null, led: null, saved: false, name: '' };
const MINSW = 1.5, BUY_END = () => (B.kpi && B.kpi.buyEnd) || '2026-10-06';
const pctv = v => { const n = parseFloat(v); return isNaN(n) ? null : (Math.abs(n) <= 1 ? n * 100 : n); };
const iso = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const today = () => iso(new Date()), yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); };
const dmy = s => String(s).split('-').reverse().join('/');
const copyTxt = async t => { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); } };
async function readSheetRows(file, must) {
  await loadXlsx(); const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]];
  const a = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const hi = a.findIndex(r => must.every(h => r.some(c => String(c == null ? '' : c).trim() === h)));
  if (hi < 0) return null;
  const H = a[hi].map(c => String(c == null ? '' : c).trim());
  return a.slice(hi + 1).filter(r => r.some(c => c != null && c !== '')).map(r => { const o = {}; H.forEach((h, i) => { if (h && !(h in o)) o[h] = r[i]; }); return o; });
}
const SHORT_COLS = ['الكود', 'الاسم', 'المطلوب'], BUY_COLS = ['كود الصنف', 'المورد', 'اجمالى التكلفة', 'اجمالى القيمة البيعية'];

/* --- سجل المشتريات اليومي (Firestore: inventory/buys_YYYY-MM-DD) --- */
function parseBuys(rows, date) {
  const d = new Date(date + 'T00:00:00'); d.setMonth(d.getMonth() + 8); const good = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return rows.map(r => { const ex = r['تاريخ الصلاحية'] == null ? '' : String(r['تاريخ الصلاحية']).trim(), pk = r['العبوات'] == null ? 1 : +r['العبوات'];
    return [+r['كود الصنف'], String(r['المورد'] || '').trim(), Math.round((+r['اجمالى التكلفة'] || 0) * 100) / 100, Math.round((+r['اجمالى القيمة البيعية'] || 0) * 100) / 100, pk, (!ex || ex >= good) ? 1 : 0]; }).filter(x => x[0]);
}
async function loadBuys() {
  if (!DB) { ORD.buys = ORD.buys || []; buildLedger(); return; }
  const q = query(collection(DB, 'purchasing'), where(documentId(), '>=', 'buys_'), where(documentId(), '<', 'buys_')), sn = await getDocs(q);
  ORD.buys = sn.docs.map(d => { try { return JSON.parse(d.data().d); } catch (e) { return null; } }).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1); buildLedger();
}
async function saveBuys(date, rows) {
  if (!DB) throw new Error('الحفظ بيشتغل على الموقع الحقيقي بس');
  const rec = { date, rows }; await setDoc(doc(DB, 'purchasing', 'buys_' + date), { d: JSON.stringify(rec), at: date });
  ORD.buys = (ORD.buys || []).filter(b => b.date !== date); ORD.buys.push(rec); ORD.buys.sort((a, b) => a.date < b.date ? -1 : 1); buildLedger();
}
// خصومات الموردين المحدّثة: المشتريات اليومية اللي بعد نهاية تحليل البايثون (آخر 90 يوم) — متتحسبش مرتين لو التحليل الأسبوعي غطّاها
function buildLedger() {
  const from = new Date(); from.setDate(from.getDate() - 90); const f = iso(from), be = BUY_END(), grp = new Map(IT.map(x => [x.id, x.grp])), L = new Map();
  (ORD.buys || []).forEach(b => { if (b.date <= be || b.date < f) return; b.rows.forEach(r => { const [id, sup, c, rt, pk, ok] = r; if (pk <= 0 || !ok || rt <= 0 || c <= 0 || /outting/i.test(sup) || grp.get(id) === 'milk') return;
    const m = L.get(id) || new Map(), e = m.get(sup) || { c: 0, r: 0, n: new Set() }; e.c += c; e.r += rt; e.n.add(b.date); m.set(sup, e); L.set(id, m); }); });
  ORD.led = L;
}
function candsOf(it) {
  const base = (it && it.sd) || [], m = it && ORD.led && ORD.led.get(it.id); if (!m) return base;
  const out = new Map(base.map(c => [c[0], { sup: c[0], c: c[3] * (1 - c[1] / 100), r: c[3], nl: c[2] }]));
  m.forEach((e, sup) => { const o = out.get(sup) || { sup, c: 0, r: 0, nl: 0 }; o.c += e.c; o.r += e.r; o.nl += e.n.size; out.set(sup, o); });
  return [...out.values()].map(o => [o.sup, Math.round((1 - o.c / o.r) * 1000) / 10, o.nl, Math.round(o.r)]).sort((a, b) => b[1] - a[1]);
}

// بنحتفظ بآخر ملف نواقص النهارده على الجهاز نفسه، علشان الريفريش ميضيّعوش (بيتمسح تلقائي تاني يوم)
const STASH = 'ordStash';
function stashPlan(rows) { try { const keep = ['الكود', 'الاسم', 'المطلوب', 'السعر', 'الموجود', 'المورد', 'ملاحظات', 'اخر شراء', 'نسبة خصم اخر شراء'];
  localStorage.setItem(STASH, JSON.stringify({ date: today(), rows: rows.map(r => { const o = {}; keep.forEach(k => { if (r[k] != null) o[k] = r[k]; }); return o; }), ticks: [] })); } catch (e) {} }
function stashTicks() { try { const st = JSON.parse(localStorage.getItem(STASH) || 'null'); if (!st || !ORD.plan) return; st.ticks = ORD.plan.lines.filter(l => l.done).map(l => l.id); localStorage.setItem(STASH, JSON.stringify(st)); } catch (e) {} }
function restorePlan() { try { const st = JSON.parse(localStorage.getItem(STASH) || 'null'); if (!st || st.date !== today()) { localStorage.removeItem(STASH); return false; }
  ORD.name = dmy(today()); ORD.plan = planOrder(st.rows); const tk = new Set(st.ticks || []); ORD.plan.lines.forEach(l => { if (tk.has(l.id)) l.done = true; }); return true; } catch (e) { return false; } }
function groupLines(lines) {
  const groups = {}; lines.forEach(l => (groups[l.sup || '—'] = groups[l.sup || '—'] || []).push(l));
  return Object.entries(groups).map(([sup, ls]) => { const a = ls.filter(l => l.disc != null), dv = sum(a, l => l.val);
    return { sup, ls, val: sum(ls, l => l.val), disc: dv ? sum(a, l => l.val * l.disc) / dv : null }; }).sort((a, b) => ((a.sup === '—') - (b.sup === '—')) || b.val - a.val);
}
function planOrder(rows) {
  const byId = new Map(IT.map(x => [x.id, x])), votes = {}, map = {}, rev = {};
  Object.entries(B.sdx || {}).forEach(([k, v]) => { if (!byId.has(+k)) byId.set(+k, { id: +k, sup3: v[0], sd: v[1], name: v[2] }); });
  const abOf = r => { const a = String(r['اخر شراء'] == null ? '' : r['اخر شراء']).trim(); return a === '-' ? '' : a; };
  rows.forEach(r => { const ab = abOf(r), it = byId.get(+r['الكود']); if (!ab || !it || !it.sup3) return; const v = votes[ab] = votes[ab] || {}; v[it.sup3] = (v[it.sup3] || 0) + 1; });
  Object.entries(votes).forEach(([ab, v]) => { const e = Object.entries(v).sort((a, b) => b[1] - a[1]), tot = e.reduce((s, x) => s + x[1], 0);
    if (e[0][1] >= 2 && e[0][1] / tot >= .5) { map[ab] = e[0][0]; if (!rev[e[0][0]] || rev[e[0][0]][1] < e[0][1]) rev[e[0][0]] = [ab, e[0][1]]; } });
  const lines = [], ordered = [], unmapped = new Set(), doneToday = new Map();
  (ORD.log || []).filter(o => o.date === today()).forEach(o => o.lines.forEach(l => doneToday.set(l[0], l[4])));
  rows.forEach(r => {
    const id = +r['الكود']; if (!id) return;
    const it = byId.get(id), ab = abOf(r), lastKnown = !!(ab && map[ab]), last = ab ? (map[ab] || ab) : null; if (ab && !map[ab]) unmapped.add(ab);
    const req = +r['المطلوب'] || 1, qty = Math.max(1, Math.ceil(req - 1e-9)), price = +r['السعر'] || 0, ld = last ? pctv(r['نسبة خصم اخر شراء']) : null;
    const base = { id, name: String(r['الاسم'] || (it && it.name) || ''), qty, price, val: qty * price, last, ld, stock: r['الموجود'], note: String(r['ملاحظات'] || '').trim() };
    if (doneToday.has(id)) { ordered.push({ ...base, note: 'اتسجل في طلبية النهارده — ' + (doneToday.get(id) || '') }); return; }
    if (/طلب من/.test(base.note)) { ordered.push(base); return; }
    const cand = candsOf(it), best = cand.find(c => c[3] >= 500) || cand[0];
    let sup = null, disc = null, why = 'محتاج تحديد مورد', sw = false, save = 0, small = false;
    if (!best) { if (last) { sup = last; disc = ld; why = 'المورد الأخير (مفيش بديل مقارن)'; } }
    else {
      small = best[2] === 1 || best[3] < 500;
      if (!last) { sup = best[0]; disc = best[1]; why = 'أعلى خصم (مفيش مورد سابق)'; }
      else if (lastKnown && last === best[0]) { sup = last; disc = ld != null ? ld : best[1]; why = 'هو أعلى خصم'; small = false; }
      else if (ld != null && best[1] - ld < MINSW) { sup = last; disc = ld; why = 'المورد الأخير (الفرق أقل من ' + MINSW + ' نقطة)'; small = false; }
      else { sup = best[0]; disc = best[1]; sw = true; why = 'أعلى خصم' + (ld != null ? ` (+${(best[1] - ld).toFixed(1)} نقطة)` : ''); save = ld != null ? base.val * (best[1] - ld) / 100 : 0; }
    }
    lines.push({ ...base, sup, disc, why, sw, save, small });
  });
  const gl = groupLines(lines);
  return { lines, ordered, groups: gl, rev, unmapped: [...unmapped] };
}
const supLab = (P, s) => s === '—' ? 'محتاج تحديد مورد' : (P.rev[s] ? `${s} (${P.rev[s][0]})` : s);
const waText = (P, g) => `طلبية من ${supLab(P, g.sup)} — ${ORD.name}\n` + g.ls.map(l => `• ${l.name} × ${l.qty}`).join('\n');
function orderKpis(P) {
  const ls = P.lines, w = f => { const a = ls.filter(l => l[f] != null), v = sum(a, l => l.val); return v ? sum(a, l => l.val * l[f]) / v : null; };
  return { n: ls.length, val: sum(ls, l => l.val), dNew: w('disc'), dOld: w('ld'), sw: ls.filter(l => l.sw).length, save: sum(ls, l => l.save), unk: ls.filter(l => !l.sup).length };
}
function orderXl(P, only) {
  return loadXlsx().then(() => {
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    const head = ['الكود', 'الصنف', 'الكمية', 'السعر', 'الخصم المتوقع %', 'المورد الأخير', 'السبب'];
    const gs = only == null ? P.groups.filter(g => g.sup !== '—') : [P.groups[only]];
    if (only == null) {
      const K = orderKpis(P), s0 = XLSX.utils.aoa_to_sheet([['ملخص طلبية النواقص — ' + ORD.name], [], ['المورد', 'عدد الأصناف', 'قيمة بيعية', 'متوسط الخصم المتوقع %'], ...P.groups.map(g => [supLab(P, g.sup), g.ls.length, Math.round(g.val), g.disc == null ? '' : +g.disc.toFixed(1)]), [], ['الإجمالي', K.n, Math.round(K.val), K.dNew == null ? '' : +K.dNew.toFixed(1)], ['وفر متوقع مقابل المورد الأخير (ج)', Math.round(K.save)]]);
      s0['!cols'] = [{ wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 22 }]; XLSX.utils.book_append_sheet(wb, s0, 'ملخص');
    }
    gs.forEach((g, i) => {
      const aoa = [['طلبية من ' + supLab(P, g.sup) + ' — ' + ORD.name], [], head, ...g.ls.map(l => [l.id, l.name, l.qty, l.price, l.disc == null ? '' : +l.disc.toFixed(1), l.last || '', l.why + (l.small ? ' — ⚠ عينة صغيرة' : '')])];
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 9 }, { wch: 40 }, { wch: 8 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 34 }];
      XLSX.utils.book_append_sheet(wb, ws, supLab(P, g.sup).slice(0, 28).replace(/[\/\\?*\[\]:]/g, '-') || 'مورد' + i);
    });
    XLSX.writeFile(wb, (only == null ? 'طلبية_النواقص_' : 'طلبية_' + String(P.groups[only].sup).replace(/[^\w؀-ۿ]+/g, '_') + '_') + today() + '.xlsx');
  });
}
async function loadOrderLog() {
  if (!DB) { ORD.log = ORD.log || []; return; }
  const q = query(collection(DB, 'purchasing'), where(documentId(), '>=', 'order_'), where(documentId(), '<', 'order_')), sn = await getDocs(q);
  ORD.log = sn.docs.map(d => { try { return JSON.parse(d.data().d); } catch (e) { return null; } }).filter(Boolean).sort((a, b) => a.at < b.at ? -1 : 1);
}
async function saveOrder(P, ls) {
  const K = orderKpis({ lines: ls }), at = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', ''), rec = { at, date: today(), n: K.n, val: Math.round(K.val), dNew: K.dNew, dOld: K.dOld, sw: K.sw, save: Math.round(K.save),
    lines: ls.map(l => [l.id, l.name, l.qty, l.price, l.sup, l.disc == null ? null : +l.disc.toFixed(1), l.last, l.ld == null ? null : +l.ld.toFixed(1), l.sw ? 1 : 0]) };
  if (!DB) throw new Error('التسجيل بيشتغل على الموقع الحقيقي بس');
  await setDoc(doc(DB, 'purchasing', 'order_' + at), { d: JSON.stringify(rec), at }); (ORD.log = ORD.log || []).push(rec);
}
// قياس يوم: طلبيات اليوم ده مقابل مشتريات نفس اليوم
function dayStats(b) {
  const want = new Map(); (ORD.log || []).filter(o => o.date === b.date).forEach(o => o.lines.forEach(l => want.set(l[0], l)));
  const grp = new Map(IT.map(x => [x.id, x.grp])), tot = { med: [0, 0], cos: [0, 0], milk: [0, 0] }, got = new Map();
  b.rows.forEach(r => { const [id, sup, c, rt, pk] = r; const g = tot[grp.get(id)] || tot.med; if (pk > 0) { g[0] += c; g[1] += rt; }
    if (want.has(id) && pk > 0 && rt > 0) { const e = got.get(id) || { c: 0, r: 0, by: {} }; e.c += c; e.r += rt; e.by[sup] = (e.by[sup] || 0) + c; got.set(id, e); } });
  let rc = 0, cc = 0, wr = 0, eN = 0, eD = 0, oN = 0, oD = 0;
  got.forEach((e, id) => { const l = want.get(id); cc += e.c; wr += e.r; rc += (e.by[l[4]] || 0); if (l[5] != null) { eN += e.r; eD += e.r * l[5]; } if (l[7] != null) { oN += e.r; oD += e.r * l[7]; } });
  const dd = a => a[1] ? (1 - a[0] / a[1]) * 100 : null;
  return { date: b.date, ordered: want.size, bought: got.size, cc, rc, wr, act: wr ? (1 - cc / wr) * 100 : null, exp: eN ? eD / eN : null, old: oN ? oD / oN : null, eN, eD, oN, oD,
    comply: cc ? rc / cc * 100 : null, all: dd([tot.med[0] + tot.cos[0] + tot.milk[0], tot.med[1] + tot.cos[1] + tot.milk[1]]), med: dd(tot.med), cos: dd(tot.cos), cost: tot.med[0] + tot.cos[0] + tot.milk[0] };
}
function renderPlan() {
  const P = ORD.plan; if (!P) return '';
  const K = orderKpis(P);
  const cards = P.groups.map((g, i) => `<div class="ivcard" style="border-inline-start:5px solid ${g.sup === '—' ? '#C0392B' : '#1F9B76'}"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">${esc(supLab(P, g.sup))} <span class="sm" style="font-weight:400">· ${g.ls.length} صنف · ${M(g.val)}${g.disc != null ? ' · خصم متوقع ' + P1(g.disc) : ''}</span></h3>${g.sup === '—' ? '' : `<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="sm" data-ord="wa:${i}">📋 انسخ رسالة واتساب</button><button class="sm ghost" data-ord="xl:${i}">📥 Excel</button></span>`}</div>
    ${table([[l => `<input type="checkbox" class="ck" data-ck="${l.id}" ${l.done ? 'checked' : ''}>`, 'اتطلب ✓', 'raw'], ['id', 'الكود'], ['name', 'الصنف', 'nm'], ['qty', 'اطلب', 'n'], ['price', 'السعر', 'n'], [l => l.disc == null ? '—' : P1(l.disc), 'الخصم المتوقع', 'raw'], [l => l.last ? esc(supLab(P, l.last)) + (l.ld != null ? ' · ' + P1(l.ld) : '') : '—', 'المورد الأخير', 'raw'], [l => esc(l.why) + (l.small ? ' <b style="color:#C0392B">⚠ عينة صغيرة</b>' : ''), 'السبب', 'raw']], g.ls)}</div>`).join('');
  const od = P.ordered.length ? `<div class="ivcard"><h3>⏱ اتطلبت النهارده قبل كده (${P.ordered.length}) — مش داخلة في الطلبية</h3><p class="why">الأصناف دي إما اتحفظت في طلبية النهارده، أو الملف نفسه عليه ملاحظة "طلب من 0 يوم". استبعدتها علشان متتطلبش مرتين.</p>${table([['id', 'الكود'], ['name', 'الصنف', 'nm'], ['qty', 'مطلوب', 'n'], ['note', 'الملاحظة']], P.ordered)}</div>` : '';
  const un = P.unmapped.length ? `<p class="sm">أكواد موردين مقدرتش أربطها باسم مورد (بتظهر زي ما هي): <b>${esc(P.unmapped.join('، '))}</b></p>` : '';
  return `<div class="ivgrid">${kpi('أصناف الطلبية', N(K.n), `${N(P.groups.filter(g => g.sup !== '—').length)} مورد`)}${kpi('قيمة الطلبية (بيعي)', M(K.val), 'الكمية بعد التقريب لأعلى')}${kpi('متوسط الخصم المتوقع', P1(K.dNew), K.dOld != null ? 'المورد الأخير كان ' + P1(K.dOld) : '')}${kpi('وفر متوقع', M(K.save), `${N(K.sw)} صنف اتحولوا لمورد أعلى خصم`)}${kpi('محتاجة مورد', N(K.unk), 'مفيش سجل شراء ليها', K.unk ? 'r' : '')}</div>
  <p style="margin:10px 0"><button data-ord="xl:all">📥 كل الطلبية (Excel — شيت لكل مورد)</button> <button id="ordSaveBtn" data-ord="save" ${P.lines.some(l => l.done) ? '' : 'disabled'}>💾 حفظ الأصناف اللي اتطلبت (${P.lines.filter(l => l.done).length}) وشيلها من الطلبية</button> <span class="note" id="ordMsg"></span></p><p class="sm" style="margin:0 0 8px">علّم ✓ قدام كل صنف بعد ما تطلبه من المورد، وفي الآخر اضغط "حفظ" — الأصناف المعلّمة بتتشال، ويفضل قدامك اللي لسه متطلبش. لو رفعت ملف نواقص تاني النهارده، اللي اتحفظ مش هيرجع.</p>${un}${cards}${od}`;
}
function renderLog() {
  const bs = ORD.buys || [], L = ORD.log || [], days = bs.map(dayStats), orderDays = [...new Set(L.map(o => o.date))].sort();
  const missing = orderDays.filter(d => !bs.some(b => b.date === d));
  const T = days.reduce((a, d) => ({ ordered: a.ordered + d.ordered, bought: a.bought + d.bought, cc: a.cc + d.cc, rc: a.rc + d.rc, wr: a.wr + d.wr, cost: a.cost + d.cost, eN: a.eN + d.eN, eD: a.eD + d.eD, oN: a.oN + d.oN, oD: a.oD + d.oD, cd: a.cd + d.cc * 0 }), { ordered: 0, bought: 0, cc: 0, rc: 0, wr: 0, cost: 0, eN: 0, eD: 0, oN: 0, oD: 0, cd: 0 });
  const tAct = T.wr ? (1 - T.cc / T.wr) * 100 : null, tExp = T.eN ? T.eD / T.eN : null, tOld = T.oN ? T.oD / T.oN : null, tComp = T.cc ? T.rc / T.cc * 100 : null;
  const kp = days.length ? `<div class="ivgrid">${kpi('أيام اتقاست', N(days.length), `آخر يوم ${dmy(days[days.length - 1].date)}`)}${kpi('الالتزام بالمورد المقترح', P1(tComp), 'من قيمة شراء الأصناف المطلوبة', tComp != null && tComp >= 70 ? '' : 'r')}${kpi('الخصم الفعلي للأصناف المطلوبة', P1(tAct), `المتوقع ${P1(tExp)} · المورد القديم ${P1(tOld)}`)}${kpi('الفرق عن المورد القديم', tAct != null && tOld != null ? (tAct - tOld > 0 ? '+' : '') + (tAct - tOld).toFixed(1) + ' نقطة' : '—', 'موجب = الطلبية الجديدة أحسن')}</div>` : '';
  const rows = days.slice().reverse().map(d => ({ date: dmy(d.date), ordered: d.ordered, bought: d.bought, comply: d.comply, act: d.act, exp: d.exp, old: d.old, all: d.all, med: d.med, cos: d.cos }));
  return `<div class="ivcard" id="ordLog"><h3>📈 القياس اليومي — قبل وبعد</h3><p class="why">كل صبح ارفع تقرير مشتريات امبارح. بيتقارن بطلبية امبارح: اشترينا من المورد المقترح ولا لأ، والخصم الفعلي مقابل المتوقع ومقابل المورد القديم. وبيتقارن كمان بمتوسط آخر 3 شهور قبل البداية (الكل ${B.kpi.discAvg}% · دواء ${B.kpi.discMed}% · كوزمو ومستلزمات ${B.kpi.discCos}%).</p>
    ${kp}${rows.length ? table([['date', 'اليوم'], ['ordered', 'أصناف مطلوبة', 'n'], ['bought', 'اتشرى منها', 'n'], ['comply', 'التزام %', 'p'], ['act', 'خصم فعلي %', 'p'], ['exp', 'متوقع %', 'p'], ['old', 'مورد قديم %', 'p'], ['all', 'خصم الشراء الكلي %', 'p'], ['med', 'دواء %', 'p'], ['cos', 'كوزمو %', 'p']], rows) : '<p class="sm">لسه مفيش أيام متقاسة. سجّل طلبية النهارده، وبكره الصبح ارفع مشتريات النهارده.</p>'}
    ${missing.length ? `<p class="sm" style="color:#C0392B">طلبيات في أيام مفيش ليها مشتريات مرفوعة: ${esc(missing.map(dmy).join('، '))}</p>` : ''}</div>`;
}
function vOrders() {
  const html = `<div class="ivcard"><h3>🛒 الشغل اليومي — ارفع ملفات الصبح</h3><p class="why">ارفع <b>الملفين مع بعض</b>: تقرير النواقص (بيطلّع طلبية النهارده) وتقرير مشتريات امبارح (بيقيس طلبية امبارح ويحدّث خصومات الموردين). الموقع بيعرف نوع كل ملف لوحده. القاعدة: كل صنف عند المورد اللي <b>أعلى خصم</b> ليه في آخر 3 شهور (من غير outting والصلاحية القصيرة)، <b>بس لو الفرق عن المورد الأخير أقل من ${MINSW} نقطة بيفضل عنده</b>. الأصناف اللي عليها "طلب من 0 يوم" بتتستبعد.</p>
    <p style="margin:6px 0;display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label class="sm ghost" style="cursor:pointer;display:inline-block;border:1px solid var(--line);border-radius:999px;padding:9px 18px;font-size:14px;color:var(--green)">📤 ارفع ملفات الصبح (Excel)<input type="file" id="upAny" accept=".xlsx,.xls" multiple style="display:none"></label><label class="sm">تاريخ المشتريات <input type="date" id="buyDate" value="${yesterday()}"></label></p><div class="note" id="ordUpMsg"></div></div>
    ${ROLE === 'admin' ? '<div class="ivcard" id="buyerAcct"></div><div class="note" id="buyerSync" style="margin:-6px 4px 10px"></div>' : ''}
    <div id="ordPlan">${renderPlan()}</div><div id="ordLogBox">${renderLog()}</div>`;
  return { html, after() {
    if (ROLE === 'admin') { buyerAcct(); syncBuyerData(); }
    const c = $('#ivbody', ROOT), plan = () => { const e = $('#ordPlan', ROOT); e.innerHTML = renderPlan(); sortable(e); }, logBox = () => { const e = $('#ordLogBox', ROOT); e.innerHTML = renderLog(); sortable(e); };
    const back = () => { if (!ORD.plan && restorePlan()) { plan(); const m0 = $('#ordUpMsg', ROOT); if (m0) m0.textContent = 'رجّعت آخر ملف نواقص رفعته النهارده ✓'; } };
    if (ORD.log == null || ORD.buys == null) Promise.all([ORD.log == null ? loadOrderLog() : 0, ORD.buys == null ? loadBuys() : 0]).then(() => { if (VIEW === 'or') { logBox(); back(); } }).catch(() => { ORD.log = ORD.log || []; ORD.buys = ORD.buys || []; if (VIEW === 'or') back(); });
    else back();
    c.onclick = async e => {
      const b = e.target.closest('[data-ord]'); if (!b) return; const [k, v] = b.dataset.ord.split(':'), P = ORD.plan, msg = $('#ordMsg', ROOT);
      try {
        if (k === 'wa') { await copyTxt(waText(P, P.groups[+v])); const t = b.textContent; b.textContent = '✓ اتنسخت'; setTimeout(() => b.textContent = t, 1500); }
        else if (k === 'xl') await orderXl(P, v === 'all' ? null : +v);
        else if (k === 'save') { const ls = P.lines.filter(l => l.done); if (!ls.length) return; b.disabled = true; await saveOrder(P, ls); P.ordered.push(...ls.map(l => ({ ...l, note: 'اتسجل في طلبية النهارده — ' + (l.sup || '') }))); P.lines = P.lines.filter(l => !l.done); P.groups = groupLines(P.lines); stashTicks(); plan(); logBox(); const m2 = $('#ordMsg', ROOT); if (m2) m2.textContent = `✅ اتحفظ ${ls.length} صنف واتشالوا من الطلبية`; }
      } catch (err) { b.disabled = false; if (msg) msg.textContent = 'فشل: ' + (err.code || err.message); else alert('فشل: ' + (err.code || err.message)); }
    };
    c.onchange = async e => {
      const t = e.target;
      if (t.dataset && t.dataset.ck) { const l = ORD.plan && ORD.plan.lines.find(x => x.id === +t.dataset.ck); if (l) l.done = t.checked; const bt = $('#ordSaveBtn', ROOT), n = ORD.plan.lines.filter(x => x.done).length; stashTicks(); if (bt) { bt.disabled = !n; bt.textContent = `💾 حفظ الأصناف اللي اتطلبت (${n}) وشيلها من الطلبية`; } return; }
      if (t.id !== 'upAny' || !t.files.length) return; const m = $('#ordUpMsg', ROOT), out = [], files = [...t.files]; m.textContent = 'بيقرا الملفات…';
      if (ORD.buys == null) { try { await loadBuys(); } catch (err) { ORD.buys = []; } }
      if (ORD.log == null) { try { await loadOrderLog(); } catch (err) { ORD.log = []; } }
      for (const f of files) {
        try {
          const sh = await readSheetRows(f, SHORT_COLS);
          if (sh) { ORD.name = dmy(today()); ORD.plan = planOrder(sh); stashPlan(sh); out.push(`✅ ${f.name}: نواقص — ${N(sh.length)} صنف`); continue; }
          const by = await readSheetRows(f, BUY_COLS);
          if (by) { const date = $('#buyDate', ROOT).value || yesterday(), rows = parseBuys(by, date); await saveBuys(date, rows); out.push(`✅ ${f.name}: مشتريات ${dmy(date)} — ${N(rows.length)} سطر اتحفظوا`); continue; }
          out.push(`⚠ ${f.name}: مش نواقص ولا مشتريات (الأعمدة مش مطابقة)`);
        } catch (err) { out.push(`❌ ${f.name}: ${err.code || err.message}`); }
      }
      m.innerHTML = out.map(esc).join('<br>'); t.value = ''; plan(); logBox();
    };
  } };
}


/* ---------- مسؤول المشتريات: حساب + بيانات الطلبيات بس ---------- */
// بيانات خفيفة (أصناف + أحسن موردين) في purchasing/data_* — مسؤول المشتريات مبيقراش inventory خالص (تكلفة/ربح/مبيعات)
async function syncBuyerData() {
  const st = $('#buyerSync', ROOT); if (!DB || ROLE !== 'admin' || !st) return;
  try {
    const m = await getDoc(doc(DB, 'purchasing', 'data_meta'));
    if (m.exists() && m.data().at === B.at) { st.textContent = 'بيانات مسؤول المشتريات محدّثة ✓'; return; }
    st.textContent = 'بيحدّث بيانات مسؤول المشتريات…';
    const rows = IT.filter(x => x.sd || x.sup3).map(x => [x.id, x.name, x.sup3 || null, x.grp, x.sd || null]), per = 900, n = Math.ceil(rows.length / per);
    for (let i = 0; i < n; i++) await setDoc(doc(DB, 'purchasing', 'data_items_' + i), { d: JSON.stringify(rows.slice(i * per, (i + 1) * per)) });
    const k = B.kpi; await setDoc(doc(DB, 'purchasing', 'data_meta'), { d: JSON.stringify({ kpi: { discAvg: k.discAvg, discMed: k.discMed, discCos: k.discCos, buyEnd: k.buyEnd }, sdx: B.sdx || {} }), chunks: n, at: B.at });
    st.textContent = 'بيانات مسؤول المشتريات اتحدّثت ✓';
  } catch (e) { st.textContent = 'تحديث بيانات مسؤول المشتريات فشل: ' + (e.code || e.message) + (e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''); }
}
async function buyerAcct() {
  const b = $('#buyerAcct', ROOT); if (!b || ROLE !== 'admin' || !DB) return;
  let list = []; try { list = (await getDocs(collection(DB, 'buyers'))).docs; } catch (e) { b.innerHTML = `<p class="sm">حساب مسؤول المشتريات: ${esc(e.code || e.message)}${e.code === 'permission-denied' ? ' — حط قواعد Firebase الجديدة الأول' : ''}</p>`; return; }
  b.innerHTML = list.length ? `<p class="sm" style="margin:0"><b>حساب مسؤول المشتريات:</b> موجود ✔ — الدخول بـ <b>buyer</b> والرقم السري بتاعه، وبيشوف طلبية النواقص بس. لتغيير الرقم السري: Firebase Console ← Authentication ← buyer@anaspharmacy.com ← Reset password.</p>`
    : `<p class="sm" style="margin:0 0 8px"><b>حساب مسؤول المشتريات</b> — بيدخل بـ <b>buyer</b> وبيشوف طلبية النواقص بس (مبيشوفش مرتبات ولا مبيعات ولا تكلفة).</p><input id="byPass" type="text" autocomplete="off" placeholder="رقم سري (6 على الأقل)"> <button class="sm" id="byMake">إنشاء الحساب</button> <span class="note" id="byMsg"></span>`;
  const mk = $('#byMake', ROOT); if (!mk) return;
  mk.onclick = async () => {
    const pw = $('#byPass', ROOT).value, m = $('#byMsg', ROOT); if (!pw || pw.length < 6) { m.textContent = 'الرقم السري 6 حروف أو أرقام على الأقل'; return; }
    try {
      const app2 = getApps().find(a => a.name === 'buyerAcct') || initializeApp(getApp().options, 'buyerAcct'), a2 = getAuth(app2);
      const cr = await createUserWithEmailAndPassword(a2, 'buyer@anaspharmacy.com', pw); await signOut(a2);
      await setDoc(doc(DB, 'buyers', cr.user.uid), { username: 'buyer', at: Date.now() }); buyerAcct();
    } catch (e) { m.textContent = e.code === 'auth/email-already-in-use' ? 'الحساب buyer@anaspharmacy.com متعمل قبل كده. امسحه من Firebase Console ← Authentication وجرّب تاني.' : 'مشكلة: ' + (e.code || e.message); }
  };
}
export async function mountBuyer(root) {
  ROOT = root; ROLE = 'buyer'; DB = getFirestore(getApp()); css(); root.id = 'invRoot';
  root.innerHTML = '<div class="ivcard"><p class="sub">جاري التحميل…</p></div>';
  try {
    const m = await getDoc(doc(DB, 'purchasing', 'data_meta'));
    if (!m.exists()) { root.innerHTML = '<div class="banner">البيانات لسه متجهزتش. اطلب من مدير الفرع يفتح تبويب طلبية النواقص مرة واحدة.</div>'; return; }
    const meta = JSON.parse(m.data().d), parts = [];
    for (let i = 0; i < m.data().chunks; i++) { const c = await getDoc(doc(DB, 'purchasing', 'data_items_' + i)); parts.push(...JSON.parse(c.data().d)); }
    IT = parts.map(r => ({ id: r[0], name: r[1], sup3: r[2], grp: r[3], sd: r[4] })); B = { kpi: meta.kpi, sdx: meta.sdx, at: m.data().at };
  } catch (e) { root.innerHTML = `<div class="banner bad">مقدرتش أحمّل البيانات: ${esc(e.code || e.message)}</div>`; return; }
  root.innerHTML = '<div id="ivbody"></div>'; VIEW = 'or'; const r = vOrders(), c = $('#ivbody', root); c.innerHTML = r.html; sortable(c); r.after();
}

/* ---------- المحرك ---------- */
const RENDER = { ov: vOverview, dc: vDecisions, it: vItems, sp: vSuppliers, or: vOrders, pf: vProfit, ex: vExpiry, mo: vMonthly, me: vMethod };
function setView(v, focus, scroll) {
  kill(); closeItem(); VIEW = v; const bar = $('#ivbar', ROOT); bar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const r = RENDER[v](focus); const c = $('#ivbody', ROOT); c.innerHTML = r.html; sortable(c); r.after();
  if (scroll && !focus) ROOT.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function shell(adm) {
  ROOT.innerHTML = `<div class="ivcard" style="padding:14px 16px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center"><div><h2 style="margin:0 0 2px">📦 المخزون — لوحة القرارات</h2><p class="sub" id="ivmeta"></p></div>
    <button id="ivall" data-xl="all" style="border-radius:999px">📥 تصدير كل قوايم المشتريات (Excel)</button>${adm ? `<div><label class="sm ghost" style="cursor:pointer;display:inline-block;border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:13px;color:var(--green)">رفع نتيجة تحليل جديدة<input type="file" id="ivup" accept=".json" style="display:none"></label><div class="note" id="ivmsg"></div></div>` : ''}</div></div>
    <button id="ivtop" title="لأعلى" onclick="window.scrollTo({top:0,behavior:'smooth'})">⬆</button><div class="ivbar" id="ivbar">${VIEWS.map(v => `<button data-v="${v[0]}" style="--c:${v[2]}">${v[1]}</button>`).join('')}</div><div id="ivbody"></div>`;
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
export function mountLocal(root, bundle, role = 'admin') { window.__ORD = ORD; ROOT = root; ROLE = role; css(); root.id = 'invRoot'; return loadChart().then(() => { shell(false); hydrate(bundle); $('#ivmeta', root).textContent = metaTxt(); setView('ov'); }); }
