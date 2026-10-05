// Importers: LiftTracker backup JSON, and workout-history CSVs (LiftTracker, Strong, Hevy, generic).
// Parsers are pure (no store access) and return { sessions, format, unit, warnings }.
import { uuid, isNum } from './utils.js';

// ---------- CSV ----------
export function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], records: [] };
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const records = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, records };
}

const num = (v) => { if (v === undefined || v === null) return ''; const s = String(v).trim().replace(',', '.'); if (s === '') return ''; const n = Number(s); return Number.isFinite(n) ? n : ''; };
const has = (headers, ...names) => names.every((n) => headers.includes(n));
const pick = (rec, ...names) => { for (const n of names) if (rec[n] !== undefined && rec[n] !== '') return rec[n]; return ''; };

function parseDate(s) {
  if (!s) return NaN;
  let t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  // "15 Jan 2024, 07:12" / "15 Jan 2024 07:12"
  const m = String(s).match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4}),?\s*(\d{1,2}):(\d{2})/);
  if (m) { t = Date.parse(`${m[2]} ${m[1]} ${m[3]} ${m[4]}:${m[5]}`); if (!Number.isNaN(t)) return t; }
  // "2024-01-15 07:12:00" with odd separators
  const m2 = String(s).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3], +(m2[4] || 0), +(m2[5] || 0), +(m2[6] || 0)).getTime();
  const m3 = String(s).match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/); // dd/mm/yyyy or mm/dd/yyyy (assume m/d)
  if (m3) return new Date(+m3[3], +m3[1] - 1, +m3[2], +(m3[4] || 0), +(m3[5] || 0)).getTime();
  return NaN;
}
function parseDuration(s) {
  if (!s) return 0;
  const str = String(s).toLowerCase();
  let ms = 0;
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/), m = str.match(/(\d+(?:\.\d+)?)\s*m(?!s)/), sec = str.match(/(\d+)\s*s/);
  if (h) ms += parseFloat(h[1]) * 3600000;
  if (m) ms += parseFloat(m[1]) * 60000;
  if (sec) ms += parseInt(sec[1], 10) * 1000;
  if (!ms && /^\d+:\d{2}(:\d{2})?$/.test(str)) { const p = str.split(':').map(Number); ms = p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 : (p[0] * 60 + p[1]) * 1000; }
  if (!ms && /^\d+$/.test(str)) ms = parseInt(str, 10) * 1000;
  return ms;
}
const setType = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('w') || s.includes('warm')) return 'W';
  if (s.startsWith('d') || s.includes('drop')) return 'D';
  if (s.startsWith('f') || s.includes('fail')) return 'F';
  return undefined;
};

export function detectFormat(headers) {
  if (has(headers, 'exercise_title', 'set_index') || has(headers, 'exercise_title', 'start_time')) return 'hevy';
  if (has(headers, 'exercise name', 'set order') || has(headers, 'workout name', 'exercise name')) return 'strong';
  if (has(headers, 'workout', 'exercise', 'weight', 'reps') && headers.includes('date')) return 'lifttracker';
  if (headers.some((h) => /exercise/.test(h)) && headers.some((h) => /weight|kg|lbs?/.test(h)) && headers.some((h) => /rep/.test(h))) return 'generic';
  return null;
}

/**
 * Parse a history CSV. opts.unit is the fallback unit when the file doesn't say.
 * → { format, unit, sessions: [{id,name,startTime,endTime,unit,exercises:[{id,exercise:{name,muscleGroup},sets:[{id,weight,reps,completed,type?,rpe?}],notes?}]}], skipped, warnings }
 */
export function parseHistoryCsv(text, { unit = 'lbs' } = {}) {
  const { headers, records } = parseCsv(text);
  const format = detectFormat(headers);
  if (!format) throw new Error(`Couldn't recognise the columns (${headers.slice(0, 6).join(', ')}…). Expected a LiftTracker, Strong or Hevy export.`);
  const warnings = [];
  const groups = new Map(); // key → session draft
  let skipped = 0, unitFromFile = null;

  for (const r of records) {
    let dateStr, name, exName, setOrder, weight, reps, w_unit, type, notes, endStr, durStr, rpe, muscle;
    if (format === 'hevy') {
      dateStr = pick(r, 'start_time'); endStr = pick(r, 'end_time'); name = pick(r, 'title') || 'Workout'; exName = pick(r, 'exercise_title');
      setOrder = pick(r, 'set_index'); type = setType(pick(r, 'set_type')); notes = pick(r, 'exercise_notes'); rpe = num(pick(r, 'rpe'));
      if (r.weight_kg !== undefined) { weight = num(r.weight_kg); w_unit = 'kg'; } else if (r.weight_lbs !== undefined) { weight = num(r.weight_lbs); w_unit = 'lbs'; } else { weight = num(pick(r, 'weight')); }
      reps = num(pick(r, 'reps'));
    } else if (format === 'strong') {
      dateStr = pick(r, 'date'); name = pick(r, 'workout name') || 'Workout'; exName = pick(r, 'exercise name'); durStr = pick(r, 'duration', 'workout duration');
      setOrder = pick(r, 'set order'); type = setType(/[a-z]/i.test(setOrder) ? setOrder : ''); notes = pick(r, 'notes'); rpe = num(pick(r, 'rpe'));
      weight = num(pick(r, 'weight')); reps = num(pick(r, 'reps'));
      const wu = pick(r, 'weight unit').toLowerCase(); w_unit = wu.startsWith('kg') ? 'kg' : wu.startsWith('lb') ? 'lbs' : null;
    } else if (format === 'lifttracker') {
      dateStr = `${pick(r, 'date')} ${pick(r, 'time') || '12:00'}`; name = pick(r, 'workout') || 'Workout'; exName = pick(r, 'exercise'); muscle = pick(r, 'muscle');
      setOrder = pick(r, 'set'); type = setType(pick(r, 'type')); weight = num(pick(r, 'weight')); reps = num(pick(r, 'reps'));
      const wu = pick(r, 'unit').toLowerCase(); w_unit = wu.startsWith('kg') ? 'kg' : wu.startsWith('lb') ? 'lbs' : null;
    } else {
      const hdr = (re) => headers.find((h) => re.test(h));
      dateStr = r[hdr(/date|time/)] || ''; name = r[hdr(/workout|title|routine|session/)] || 'Workout'; exName = r[hdr(/exercise/)] || '';
      const wh = hdr(/weight|kg|lbs?/); weight = num(r[wh]); reps = num(r[hdr(/rep/)]); setOrder = r[hdr(/set/)] || '';
      w_unit = /kg/.test(wh || '') ? 'kg' : /lb/.test(wh || '') ? 'lbs' : null; type = setType(r[hdr(/type/)]);
    }
    if (!exName) { skipped++; continue; }
    const t = parseDate(dateStr);
    if (Number.isNaN(t)) { skipped++; continue; }
    if (!isNum(reps) || reps <= 0) { skipped++; continue; } // timed/cardio rows are dropped
    if (!isNum(weight)) weight = 0;
    if (w_unit && !unitFromFile) unitFromFile = w_unit;

    const key = `${Math.floor(t / 60000)}|${name}`;
    let s = groups.get(key);
    if (!s) { s = { id: uuid(), name, startTime: t, endTime: endStr ? parseDate(endStr) : (durStr ? t + parseDuration(durStr) : 0), unit: w_unit, exercises: [], _ex: new Map() }; groups.set(key, s); }
    if (w_unit && s.unit && w_unit !== s.unit) warnings.push(`Mixed units inside “${name}” on ${new Date(t).toLocaleDateString()}; kept ${s.unit}.`);
    const exKey = exName.toLowerCase();
    let we = s._ex.get(exKey);
    if (!we) { we = { id: uuid(), exercise: { id: `name:${slug(exName)}`, name: exName, muscleGroup: muscle || 'Other' }, sets: [], ...(notes ? { notes } : {}) }; s._ex.set(exKey, we); s.exercises.push(we); }
    const set = { id: uuid(), weight: s.unit && w_unit && w_unit !== s.unit ? convertUnit(weight, w_unit, s.unit) : weight, reps, completed: true, ...(type ? { type } : {}), ...(isNum(rpe) && rpe > 0 ? { rpe } : {}), _order: num(String(setOrder).replace(/\D/g, '')) };
    we.sets.push(set);
  }

  const resolvedUnit = unitFromFile || unit;
  const sessions = [...groups.values()].map((s) => {
    for (const we of s.exercises) { we.sets.sort((a, b) => (a._order || 0) - (b._order || 0)); for (const st of we.sets) delete st._order; }
    delete s._ex;
    if (!s.unit) s.unit = resolvedUnit;
    if (!s.endTime || Number.isNaN(s.endTime) || s.endTime <= s.startTime) s.endTime = s.startTime + estimateDuration(s);
    s.volume = s.exercises.flatMap((we) => we.sets).filter((x) => x.type !== 'W').reduce((a, x) => a + x.weight * x.reps, 0);
    return s;
  }).filter((s) => s.exercises.length).sort((a, b) => a.startTime - b.startTime);
  return { format, unit: resolvedUnit, unitFromFile: !!unitFromFile, sessions, skipped, warnings: [...new Set(warnings)].slice(0, 5) };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
const convertUnit = (v, from, to) => (from === to ? v : Math.round((from === 'kg' ? v * 2.2046226218 : v / 2.2046226218) * 100) / 100);
const estimateDuration = (s) => Math.min(3 * 3600000, s.exercises.reduce((a, we) => a + we.sets.length, 0) * 150000 + 5 * 60000);

// ---------- Backup JSON ----------
/** Accepts the LiftTracker full backup (or a routines-only export). → { templates, history, custom, favorites, bodyweight } */
export function parseBackup(text) {
  let j;
  try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('That file isn’t valid JSON'); }
  if (Array.isArray(j)) return { templates: j, history: [], custom: [], favorites: [], bodyweight: [], kind: 'routines' };
  if (!j || typeof j !== 'object') throw new Error('Unrecognised backup file');
  const out = {
    templates: Array.isArray(j.templates) ? j.templates : Array.isArray(j.routines) ? j.routines : [],
    history: Array.isArray(j.history) ? j.history : Array.isArray(j.sessions) ? j.sessions : Array.isArray(j.workouts) ? j.workouts : [],
    custom: Array.isArray(j.custom) ? j.custom : Array.isArray(j.customExercises) ? j.customExercises : [],
    favorites: Array.isArray(j.favorites) ? j.favorites : [],
    bodyweight: Array.isArray(j.bodyweight) ? j.bodyweight : [],
    unit: j.unit,
  };
  out.history = out.history.filter((s) => s && isNum(s.startTime) && Array.isArray(s.exercises)).map((s) => ({ ...s, unit: s.unit || out.unit || 'lbs', endTime: isNum(s.endTime) ? s.endTime : s.startTime }));
  out.kind = out.history.length ? 'backup' : 'routines';
  if (!out.templates.length && !out.history.length && !out.custom.length && !out.bodyweight.length) throw new Error('Nothing importable in that file');
  return out;
}
