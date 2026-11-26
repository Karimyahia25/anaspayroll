/* عدّاد قراءات Firestore (26/11) — بيعرف أي شاشة بتستهلك حصة الـ 50 ألف قراية.
   بيغلّف getDoc/getDocs/onSnapshot: كل مستند راجع = قراية. بيشتغل في الخلفية من غير أي أثر على الشاشات.
   يظهر شريط صغير تحت على الشمال لو فتحت الموقع مرة بـ ?rc=1 (بيتحفظ على الجهاز؛ ?rc=0 يقفله).
   الأرقام لكل جهاز ولكل يوم (localStorage 'rc_v1'). مش بيحسب فحوصات القواعد (exists/get) — دي إضافية على الرقم ده. */
import { getDoc as _getDoc, getDocs as _getDocs, onSnapshot as _onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const K = 'rc_v1';
const day = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let S = { day: day(), t: 0, by: {} }, SESSION = 0, timer = null, pill = null, open = false;
try { const o = JSON.parse(localStorage.getItem(K) || 'null'); if (o && o.day === S.day) S = o; } catch (e) {}
try { const q = new URLSearchParams(location.search).get('rc'); if (q === '1') localStorage.setItem('rc_on', '1'); if (q === '0') localStorage.removeItem('rc_on'); } catch (e) {}
const ON = () => { try { return localStorage.getItem('rc_on') === '1'; } catch (e) { return false; } };

function label(x, kind) {
  try {
    if (x && x._query) {   // استعلام: المسار + أسماء الحقول اللي بيفلتر بيها
      const f = (x._query.filters || []).map(f => f.field && f.field.canonicalString ? f.field.canonicalString() : '').filter(Boolean).join('+');
      return kind + ' ' + x._query.path.canonicalString() + (f ? ' [' + f + ']' : '');
    }
    if (x && x.path) return kind + ' ' + String(x.path).replace(/\d+/g, '#');
  } catch (e) {}
  return kind + ' ?';
}

function paint() {
  if (!ON()) { if (pill) { pill.remove(); pill = null; } return; }
  if (!pill) {
    pill = document.createElement('div');
    pill.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#0f172a;color:#fff;font:12px/1.5 monospace;padding:6px 10px;border-radius:10px;direction:ltr;max-width:92vw;cursor:pointer;opacity:.92';
    pill.onclick = () => { open = !open; paint(); };
    document.body.appendChild(pill);
  }
  const rows = Object.entries(S.by).sort((a, b) => b[1] - a[1]);
  pill.innerHTML = '📖 reads: <b>' + S.t.toLocaleString() + '</b> today · ' + SESSION.toLocaleString() + ' this page' +
    (open ? '<div style="margin-top:6px;max-height:50vh;overflow:auto">' + rows.slice(0, 25).map(r => '<div>' + r[1].toLocaleString() + ' &nbsp;' + r[0] + '</div>').join('') +
      '<div style="margin-top:6px"><u data-z>reset</u></div></div>' : '');
  const z = pill.querySelector('[data-z]'); if (z) z.onclick = e => { e.stopPropagation(); S = { day: day(), t: 0, by: {} }; SESSION = 0; save(); paint(); };
}
function save() { try { localStorage.setItem(K, JSON.stringify(S)); } catch (e) {} }
function count(lab, n) {
  if (!n) return;
  if (S.day !== day()) S = { day: day(), t: 0, by: {} };
  S.t += n; SESSION += n; S.by[lab] = (S.by[lab] || 0) + n;
  if (!timer) timer = setTimeout(() => { timer = null; save(); paint(); }, 1500);
}
if (document.readyState !== 'loading') setTimeout(paint, 500); else document.addEventListener('DOMContentLoaded', () => setTimeout(paint, 500));

export async function getDoc(ref) { const s = await _getDoc(ref); count(label(ref, 'get'), 1); return s; }
export async function getDocs(q) { const s = await _getDocs(q); count(label(q, 'getDocs'), s.size || 1); return s; }
export function onSnapshot(q, a, b, c) {
  if (typeof a !== 'function') return _onSnapshot(q, a, b, c);
  const lab = label(q, 'listen');
  return _onSnapshot(q, s => { count(lab, typeof s.docChanges === 'function' ? s.docChanges().length : 1); a(s); }, b);
}
