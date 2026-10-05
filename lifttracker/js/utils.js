// Small, dependency-free helpers shared across the app.

export const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
export const by = (key, dir = 1) => (a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const num = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));

// ---------- Units ----------
export const LB_PER_KG = 2.2046226218;
export function convert(v, from, to) {
  if (!isNum(v) || from === to) return v;
  const out = from === 'kg' ? v * LB_PER_KG : v / LB_PER_KG;
  return Math.round(out * 100) / 100;
}
/** Round a converted weight to a plate-friendly step (0.5 kg / 1 lb) for display. */
export function roundWeight(v, unit) {
  if (!isNum(v)) return v;
  const step = unit === 'kg' ? 0.5 : 1;
  const r = Math.round(v / step) * step;
  return Math.abs(r - v) < 0.26 ? r : Math.round(v * 10) / 10;
}
export const fmtW = (v, unit) => {
  if (!isNum(v)) return '–';
  const r = roundWeight(v, unit);
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/\.0$/, '');
};
export const fmtVol = (v) => (v >= 1_000_000 ? (v / 1_000_000).toFixed(2) + 'M' : v >= 10_000 ? (v / 1000).toFixed(1) + 'k' : v >= 1000 ? (v / 1000).toFixed(2) + 'k' : String(Math.round(v)));

// ---------- Strength math ----------
/** Epley estimated one-rep max. */
export function e1rm(weight, reps) {
  if (!isNum(weight) || !isNum(reps) || reps < 1 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

// ---------- Dates ----------
const DAY = 86_400_000;
export const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const startOfWeek = (t, weekStartsMonday = true) => {
  const d = new Date(startOfDay(t));
  const dow = d.getDay(); // 0 = Sun
  const diff = weekStartsMonday ? (dow + 6) % 7 : dow;
  d.setDate(d.getDate() - diff);
  return d.getTime();
};
export const addDays = (t, n) => t + n * DAY;
export const sameDay = (a, b) => startOfDay(a) === startOfDay(b);
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function fmtDate(t, opts = {}) {
  const d = new Date(t);
  const now = Date.now();
  if (opts.relative !== false) {
    if (sameDay(d, now)) return 'Today';
    if (sameDay(d, now - DAY)) return 'Yesterday';
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { weekday: opts.weekday ? 'short' : undefined, month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}
export const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export function fmtDuration(ms, { long = false } = {}) {
  if (!isNum(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (long) return h > 0 ? `${h}h ${m}m` : `${m}m`;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;
export function timeAgo(t) {
  const diff = Date.now() - t;
  const d = Math.floor(diff / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Night owl' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
export function defaultWorkoutName() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning Workout' : h < 17 ? 'Afternoon Workout' : 'Evening Workout';
}

// ---------- Storage ----------
export const ls = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage write failed', e); } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/** Recursively drop undefined values (Firestore rejects them). */
export function sanitize(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = sanitize(v);
  return out;
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

export function pickFile(accept = 'application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => { const f = input.files?.[0]; if (!f) return resolve(null); const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(f); };
    input.click();
  });
}

export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms); } catch {} };

export function csvRow(arr) {
  return arr.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',');
}
