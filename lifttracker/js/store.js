// Central state store: holds app state, persists to localStorage, mirrors to Firestore
// when signed in, and exposes all domain actions (workouts, routines, PRs, settings).
import { uuid, ls, convert, roundWeight, e1rm, isNum, sum, startOfWeek, startOfDay, addDays, defaultWorkoutName, debounce, dayKey } from './utils.js';
import { cloud } from './cloud.js';
import { defaultTemplates } from './data/templates.js';

const K = {
  templates: 'lt_templates', history: 'lt_history', active: 'lt_active', custom: 'lt_custom',
  favorites: 'lt_favorites', settings: 'lt_settings', profile: 'lt_profile', bodyweight: 'lt_bodyweight',
  minimized: 'lt_minimized', cloudUser: 'lt_cloud_user', draft: 'lt_routine_draft', seeded: 'lt_seeded',
  migrated: (uid) => `lt_migrated_${uid}`,
};

export const DEFAULT_SETTINGS = {
  unit: 'lbs', theme: 'system', restDefault: 90, restSound: true, restVibrate: true, autoRest: true,
  barWeightKg: 20, barWeightLb: 45, weeklyGoal: 3, weekStartsMonday: true, updatedAt: 0,
};

const listeners = new Set();
let persistTimer = null;

export const state = {
  booted: false,
  route: 'home',
  library: [],
  custom: ls.get(K.custom, []),
  favorites: ls.get(K.favorites, []),
  templates: ls.get(K.templates, []),
  history: ls.get(K.history, []),
  active: ls.get(K.active, null),
  minimized: ls.get(K.minimized, false),
  rest: null,
  settings: { ...DEFAULT_SETTINGS, ...(ls.get(K.settings, {}) || {}) },
  profile: ls.get(K.profile, { name: '', photoUrl: '' }),
  bodyweight: ls.get(K.bodyweight, []),
  user: null,
  cloud: cloud.enabled ? 'off' : 'disabled', // off | connecting | syncing | ok | error | disabled
  authReady: !cloud.enabled,
  lastError: null,
};

// ---------- Subscription ----------
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(reason = 'change', detail = null) { for (const fn of listeners) { try { fn(reason, detail); } catch (e) { console.error(e); } } }

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    ls.set(K.templates, state.templates);
    ls.set(K.history, state.history);
    if (state.active) ls.set(K.active, state.active); else ls.del(K.active);
    ls.set(K.custom, state.custom);
    ls.set(K.favorites, state.favorites);
    ls.set(K.settings, state.settings);
    ls.set(K.profile, state.profile);
    ls.set(K.bodyweight, state.bodyweight);
    ls.set(K.minimized, state.minimized);
  }, 40);
}

// ---------- Boot ----------
export async function boot() {
  applyTheme();
  if (!state.templates.length && !ls.get(K.seeded)) seedDefaults('anonymous');
  // Library (3k+ exercises) loads async; the UI renders without it and fills in.
  fetch('./data/exercises.json').then((r) => r.json()).then((rows) => {
    state.library = rows.map(([id, name, muscleGroup]) => ({ id, name, muscleGroup }));
    emit('library');
  }).catch((e) => console.warn('library load failed', e));

  if (cloud.enabled && ls.get(K.cloudUser)) {
    // Returning user: restore the Firebase session in the background.
    connectCloud().catch((e) => { console.warn(e); state.cloud = 'error'; state.authReady = true; emit('auth'); });
  } else {
    state.authReady = true;
  }
  state.booted = true;
  emit('boot');
}

function seedDefaults(userId) {
  const now = Date.now();
  state.templates = defaultTemplates.map((t, i) => ({
    id: uuid(), userId, name: t.name, order: i, updatedAt: now, seeded: true,
    exercises: t.exercises.map((ex) => ({ id: uuid(), exercise: { ...ex.exercise }, restTime: ex.restTime, sets: ex.sets.map((s) => ({ id: uuid(), ...s })) })),
  }));
  ls.set(K.seeded, now);
  persist();
}

// ---------- Theme ----------
const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
mq?.addEventListener?.('change', () => applyTheme());
export function applyTheme() {
  const pref = state.settings.theme || 'system';
  const dark = pref === 'dark' || (pref === 'system' && mq?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d100f' : '#f3f4f1');
}

// ---------- Exercises ----------
export const allExercises = () => state.custom.concat(state.library);
export const findExercise = (id) => allExercises().find((e) => e.id === id);
export const findExerciseByName = (name) => allExercises().find((e) => e.name.toLowerCase() === String(name).toLowerCase());
export const isFav = (id) => state.favorites.includes(id);
export function muscleGroups() {
  const counts = new Map();
  for (const e of allExercises()) counts.set(e.muscleGroup, (counts.get(e.muscleGroup) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

export function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(id);
  persist(); pushUserDoc(); emit('favorites');
  return i < 0;
}

export async function createCustomExercise(name, muscleGroup) {
  const ex = { id: `custom-${Date.now()}`, name: name.trim(), muscleGroup: muscleGroup.trim() || 'Other', custom: true, createdAt: Date.now() };
  state.custom.unshift(ex);
  persist(); emit('library');
  if (state.user) cloud.set(`custom_exercises/${ex.id}`, { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup, userId: state.user.id, createdAt: ex.createdAt }).catch(logCloudErr);
  return ex;
}
export function deleteCustomExercise(id) {
  state.custom = state.custom.filter((e) => e.id !== id);
  persist(); emit('library');
  if (state.user) cloud.del(`custom_exercises/${id}`).catch(logCloudErr);
}

// ---------- Settings & profile ----------
export function setSetting(key, value) {
  if (key === 'unit' && value !== state.settings.unit) return setUnit(value);
  state.settings[key] = value;
  state.settings.updatedAt = Date.now();
  if (key === 'theme') applyTheme();
  persist(); pushUserDoc(); emit('settings', key);
}

/** Switching units converts routine + in-progress weights so numbers stay meaningful. */
export function setUnit(unit) {
  const from = state.settings.unit;
  if (unit === from) return;
  const conv = (w) => (isNum(w) ? roundWeight(convert(w, from, unit), unit) : w);
  const convEx = (ex) => ({ ...ex, sets: ex.sets.map((s) => ({ ...s, weight: conv(s.weight) })) });
  state.templates = state.templates.map((t) => ({ ...t, exercises: t.exercises.map(convEx), updatedAt: Date.now() }));
  if (state.active) state.active = { ...state.active, unit, exercises: state.active.exercises.map(convEx), updatedAt: Date.now() };
  state.settings.unit = unit;
  state.settings.updatedAt = Date.now();
  persist(); pushUserDoc(); emit('settings', 'unit');
  if (state.user) {
    cloud.batch(state.templates.map((t) => ({ path: `workout_templates/${t.id}`, data: { ...t, userId: state.user.id } }))).catch(logCloudErr);
    pushActive();
  }
}

export function updateProfile({ name, photoUrl }) {
  if (state.user) { state.user = { ...state.user, name: name ?? state.user.name, photoUrl: photoUrl ?? state.user.photoUrl }; }
  state.profile = { name: name ?? state.profile.name, photoUrl: photoUrl ?? state.profile.photoUrl };
  state.settings.updatedAt = Date.now();
  persist(); pushUserDoc(); emit('profile');
}
export const displayName = () => (state.user?.name || state.profile.name || '').trim() || 'Lifter';
export const photoUrl = () => state.profile.photoUrl || state.user?.photoUrl || '';

// ---------- Body weight ----------
export function addBodyweight(value, unit = state.settings.unit, t = Date.now()) {
  const kg = unit === 'kg' ? value : convert(value, 'lbs', 'kg');
  state.bodyweight = state.bodyweight.filter((b) => dayKey(b.t) !== dayKey(t)).concat({ t, kg: Math.round(kg * 100) / 100 }).sort((a, b) => a.t - b.t);
  state.settings.updatedAt = Date.now();
  persist(); pushUserDoc(); emit('bodyweight');
}
export function deleteBodyweight(t) {
  state.bodyweight = state.bodyweight.filter((b) => b.t !== t);
  state.settings.updatedAt = Date.now();
  persist(); pushUserDoc(); emit('bodyweight');
}

// ---------- Templates (routines) ----------
const normalizeSet = (s) => ({ id: s.id || uuid(), weight: isNum(s.weight) ? s.weight : (s.weight === '' || s.weight == null ? '' : Number(s.weight) || ''), reps: isNum(s.reps) ? s.reps : (s.reps === '' || s.reps == null ? '' : Number(s.reps) || ''), completed: false, ...(s.type ? { type: s.type } : {}) });
const normalizeWE = (we) => ({ id: we.id || uuid(), exercise: { id: we.exercise.id, name: we.exercise.name, muscleGroup: we.exercise.muscleGroup || 'Other' }, sets: (we.sets || []).map(normalizeSet), ...(isNum(we.restTime) ? { restTime: we.restTime } : {}), ...(we.notes ? { notes: we.notes } : {}) });

export function createTemplate({ name, exercises }) {
  const t = { id: uuid(), userId: state.user?.id || 'anonymous', name: name.trim() || 'Routine', exercises: exercises.map(normalizeWE), order: state.templates.length, updatedAt: Date.now() };
  state.templates.push(t);
  persist(); saveTemplateCloud(t); emit('templates');
  return t;
}
export function updateTemplate(id, patch) {
  const i = state.templates.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const t = { ...state.templates[i], ...patch, updatedAt: Date.now() };
  if (patch.exercises) t.exercises = patch.exercises.map(normalizeWE);
  if (patch.name !== undefined) t.name = patch.name.trim() || t.name;
  delete t.seeded;
  state.templates[i] = t;
  persist(); saveTemplateCloud(t); emit('templates');
  return t;
}
export function deleteTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  state.templates = state.templates.filter((x) => x.id !== id);
  persist(); emit('templates');
  if (state.user) cloud.del(`workout_templates/${id}`).catch(logCloudErr);
  return t;
}
export function restoreTemplate(t) {
  if (!t || state.templates.some((x) => x.id === t.id)) return;
  state.templates.splice(Math.min(t.order ?? state.templates.length, state.templates.length), 0, t);
  persist(); saveTemplateCloud(t); emit('templates');
}
export function duplicateTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  return createTemplate({ name: `${t.name} copy`, exercises: t.exercises.map((we) => ({ ...we, id: uuid(), sets: we.sets.map((s) => ({ ...s, id: uuid() })) })) });
}
export function reorderTemplates(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const arr = [...state.templates];
  const [m] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, m);
  const now = Date.now();
  state.templates = arr.map((t, i) => ({ ...t, order: i, updatedAt: now }));
  persist(); emit('templates');
  if (state.user) cloud.batch(state.templates.map((t) => ({ path: `workout_templates/${t.id}`, data: { order: t.order, updatedAt: now }, merge: true }))).catch(logCloudErr);
}
export function importTemplates(list) {
  let n = 0;
  for (const raw of list) {
    if (!raw || !raw.name || !Array.isArray(raw.exercises)) continue;
    const exercises = raw.exercises.filter((we) => we && (we.exercise || we.name)).map((we) => we.exercise ? we : ({ exercise: we, sets: [{ weight: '', reps: '' }] }));
    createTemplate({ name: raw.name, exercises });
    n++;
  }
  return n;
}
function saveTemplateCloud(t) {
  if (!state.user) return;
  cloud.set(`workout_templates/${t.id}`, { ...t, userId: state.user.id }).catch(logCloudErr);
}

// Routine editor draft (local only — survives accidental closes/reloads)
export const getDraft = () => ls.get(K.draft, null);
export const saveDraft = (d) => ls.set(K.draft, d);
export const clearDraft = () => ls.del(K.draft);

// ---------- History analytics ----------
const sessionUnit = (s) => s.unit || 'lbs';
const toUnit = (w, from) => (isNum(w) ? convert(w, from, state.settings.unit) : w);
const working = (s) => s.completed !== false && s.type !== 'W' && isNum(s.weight) && isNum(s.reps) && s.reps > 0;

/** Most recent logged sets for an exercise (converted to the current unit). */
export function prevPerformance(name, excludeSessionId = null) {
  const key = String(name).toLowerCase();
  for (const s of state.history) {
    if (s.id === excludeSessionId) continue;
    const we = (s.exercises || []).find((x) => x?.exercise?.name?.toLowerCase() === key);
    if (we && we.sets?.length) {
      const u = sessionUnit(s);
      return { date: s.startTime, sessionName: s.name, sets: we.sets.map((x) => ({ weight: toUnit(x.weight, u), reps: x.reps, type: x.type })) };
    }
  }
  return null;
}

/** Best weight / e1RM / single-set volume on record for an exercise (current unit). */
export function bests(name, { excludeSessionId = null } = {}) {
  const key = String(name).toLowerCase();
  const b = { weight: 0, e1rm: 0, volume: 0, reps: 0, count: 0 };
  for (const s of state.history) {
    if (s.id === excludeSessionId) continue;
    const u = sessionUnit(s);
    for (const we of s.exercises || []) {
      if (we?.exercise?.name?.toLowerCase() !== key) continue;
      for (const st of we.sets || []) {
        if (!working(st)) continue;
        const w = toUnit(st.weight, u);
        b.count++;
        b.weight = Math.max(b.weight, w);
        b.e1rm = Math.max(b.e1rm, e1rm(w, st.reps));
        b.volume = Math.max(b.volume, w * st.reps);
        b.reps = Math.max(b.reps, st.reps);
      }
    }
  }
  return b;
}

/** Per-session points for an exercise: [{t, top, e1rm, volume, sets}] oldest → newest. */
export function exerciseHistory(name) {
  const key = String(name).toLowerCase();
  const pts = [];
  for (const s of state.history) {
    const u = sessionUnit(s);
    const we = (s.exercises || []).find((x) => x?.exercise?.name?.toLowerCase() === key);
    if (!we) continue;
    const sets = (we.sets || []).map((x) => ({ ...x, weight: toUnit(x.weight, u) }));
    const w = sets.filter(working);
    if (!w.length) continue;
    pts.push({ t: s.startTime, sessionId: s.id, sessionName: s.name, sets, top: Math.max(...w.map((x) => x.weight)), e1rm: Math.max(...w.map((x) => e1rm(x.weight, x.reps))), volume: sum(w, (x) => x.weight * x.reps) });
  }
  return pts.reverse();
}

export const sessionVolume = (s) => { const u = sessionUnit(s); return sum((s.exercises || []).flatMap((we) => we?.sets || []).filter(working), (st) => toUnit(st.weight, u) * st.reps); };
export const sessionSets = (s) => sum((s.exercises || []), (we) => (we?.sets || []).filter((x) => x.completed !== false).length);

export function weekStats() {
  const { weeklyGoal, weekStartsMonday } = state.settings;
  const now = Date.now();
  const w0 = startOfWeek(now, weekStartsMonday), w1 = addDays(w0, -7);
  const inRange = (s, a, b) => s.startTime >= a && s.startTime < b;
  const thisWeek = state.history.filter((s) => inRange(s, w0, addDays(w0, 7)));
  const lastWeek = state.history.filter((s) => inRange(s, w1, w0));
  const vol = (arr) => sum(arr, sessionVolume);
  // Streak: consecutive weeks (ending this or last week) with at least one workout
  const weeks = new Set(state.history.map((s) => startOfWeek(s.startTime, weekStartsMonday)));
  let streak = 0, cursor = weeks.has(w0) ? w0 : w1;
  while (weeks.has(cursor)) { streak++; cursor = addDays(cursor, -7); }
  const days = Array.from({ length: 7 }, (_, i) => { const d = addDays(w0, i); return { t: d, done: state.history.some((s) => startOfDay(s.startTime) === d), future: d > now }; });
  const prs30 = sum(state.history.filter((s) => s.startTime > now - 30 * 86400000), (s) => s.records || 0);
  return { count: thisWeek.length, lastCount: lastWeek.length, goal: weeklyGoal, volume: vol(thisWeek), lastVolume: vol(lastWeek), streak, days, prs30 };
}

/** Weekly volume for the last n weeks → [{t, volume, count}]. */
export function weeklySeries(n = 12) {
  const { weekStartsMonday } = state.settings;
  const w0 = startOfWeek(Date.now(), weekStartsMonday);
  const out = Array.from({ length: n }, (_, i) => ({ t: addDays(w0, -7 * (n - 1 - i)), volume: 0, count: 0 }));
  for (const s of state.history) {
    const ws = startOfWeek(s.startTime, weekStartsMonday);
    const idx = Math.round((ws - out[0].t) / (7 * 86400000));
    if (idx >= 0 && idx < n) { out[idx].volume += sessionVolume(s); out[idx].count++; }
  }
  return out;
}

/** Personal-record leaderboard across all exercises. */
export function prBoard(limit = 12) {
  const names = new Map();
  for (const s of state.history) for (const we of s.exercises || []) if (we?.exercise?.name) names.set(we.exercise.name, (names.get(we.exercise.name) || 0) + 1);
  return [...names.entries()].map(([name, sessions]) => ({ name, sessions, ...bests(name) })).filter((b) => b.e1rm > 0).sort((a, b) => b.e1rm - a.e1rm).slice(0, limit);
}

// ---------- Active workout ----------
const touchActive = () => { if (state.active) state.active.updatedAt = Date.now(); persist(); pushActiveDebounced(); };

export function startWorkout(template = null, { exercises = null, name = null } = {}) {
  const src = template ? template.exercises : (exercises || []);
  state.active = {
    id: uuid(), userId: state.user?.id || 'anonymous', name: name || template?.name || defaultWorkoutName(),
    startTime: Date.now(), templateId: template?.id || null, unit: state.settings.unit, updatedAt: Date.now(),
    exercises: src.map((we) => {
      const prev = prevPerformance(we.exercise.name);
      return {
        id: uuid(), exercise: { ...we.exercise }, ...(isNum(we.restTime) ? { restTime: we.restTime } : {}), ...(we.notes ? { notes: we.notes } : {}),
        sets: (we.sets?.length ? we.sets : [{ weight: '', reps: '' }]).map((s, i) => ({
          id: uuid(), weight: isNum(s.weight) ? s.weight : (prev?.sets[i]?.weight ?? ''), reps: isNum(s.reps) ? s.reps : (prev?.sets[i]?.reps ?? ''), completed: false, ...(s.type ? { type: s.type } : {}),
        })),
      };
    }),
  };
  state.minimized = false;
  state.rest = null;
  touchActive(); emit('active');
  return state.active;
}

export function addExercisesToWorkout(list) {
  if (!state.active) return;
  for (const ex of list) {
    const prev = prevPerformance(ex.name);
    const sets = prev ? prev.sets.filter((s) => s.type !== 'W').slice(0, 6).map((s) => ({ id: uuid(), weight: s.weight, reps: s.reps, completed: false })) : [1, 2, 3].map(() => ({ id: uuid(), weight: '', reps: '', completed: false }));
    state.active.exercises.push({ id: uuid(), exercise: { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup }, sets: sets.length ? sets : [{ id: uuid(), weight: '', reps: '', completed: false }] });
  }
  touchActive(); emit('active');
}
export function removeExerciseFromWorkout(weId) {
  if (!state.active) return;
  state.active.exercises = state.active.exercises.filter((we) => we.id !== weId);
  touchActive(); emit('active');
}
export function moveExercise(weId, dir) {
  const arr = state.active?.exercises; if (!arr) return;
  const i = arr.findIndex((we) => we.id === weId), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  touchActive(); emit('active');
}
export function replaceExercise(weId, ex) {
  const we = state.active?.exercises.find((x) => x.id === weId); if (!we) return;
  we.exercise = { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup };
  const prev = prevPerformance(ex.name);
  we.sets = we.sets.map((s, i) => ({ ...s, completed: false, pr: undefined, weight: prev?.sets[i]?.weight ?? '', reps: prev?.sets[i]?.reps ?? '' }));
  touchActive(); emit('active');
}
export function setExerciseField(weId, patch) {
  const we = state.active?.exercises.find((x) => x.id === weId); if (!we) return;
  Object.assign(we, patch);
  for (const k of Object.keys(patch)) if (patch[k] === undefined || patch[k] === null) delete we[k];
  touchActive(); emit('active', { silent: patch.notes !== undefined });
}
export function addSet(weId) {
  const we = state.active?.exercises.find((x) => x.id === weId); if (!we) return;
  const last = [...we.sets].reverse().find((s) => s.type !== 'W') || we.sets[we.sets.length - 1];
  we.sets.push({ id: uuid(), weight: last?.weight ?? '', reps: last?.reps ?? '', completed: false });
  touchActive(); emit('active');
}
export function removeSet(weId, setId) {
  const we = state.active?.exercises.find((x) => x.id === weId); if (!we || we.sets.length <= 1) return;
  we.sets = we.sets.filter((s) => s.id !== setId);
  touchActive(); emit('active');
}
/** Field edit from an input: persists without re-rendering (keeps the keyboard open). */
export function updateSet(weId, setId, patch) {
  const we = state.active?.exercises.find((x) => x.id === weId); const s = we?.sets.find((x) => x.id === setId);
  if (!s) return;
  Object.assign(s, patch);
  if ('weight' in patch || 'reps' in patch) { s.completed = false; delete s.pr; }
  touchActive(); emit('active', { silent: true });
}
export function cycleSetType(weId, setId) {
  const we = state.active?.exercises.find((x) => x.id === weId); const s = we?.sets.find((x) => x.id === setId);
  if (!s) return;
  const order = [undefined, 'W', 'D', 'F'];
  const next = order[(order.indexOf(s.type) + 1) % order.length];
  if (next) s.type = next; else delete s.type;
  touchActive(); emit('active');
}
/** Generates a warm-up ramp from the first working weight (40/60/80%). */
export function addWarmups(weId) {
  const we = state.active?.exercises.find((x) => x.id === weId); if (!we) return false;
  const top = we.sets.find((s) => s.type !== 'W' && isNum(s.weight) && s.weight > 0);
  if (!top) return false;
  const unit = state.settings.unit;
  const bar = unit === 'kg' ? state.settings.barWeightKg : state.settings.barWeightLb;
  const ramp = [[0.4, 8], [0.6, 5], [0.8, 3]].map(([p, r]) => ({ id: uuid(), weight: Math.max(bar, roundWeight(top.weight * p, unit)), reps: r, completed: false, type: 'W' })).filter((w, i, a) => a.findIndex((x) => x.weight === w.weight) === i && w.weight < top.weight);
  we.sets = ramp.concat(we.sets.filter((s) => s.type !== 'W'));
  touchActive(); emit('active');
  return ramp.length > 0;
}

/** Toggle completion. Returns {completed, pr, rest} so the view can animate / start rest. */
export function toggleSet(weId, setId) {
  const we = state.active?.exercises.find((x) => x.id === weId); const s = we?.sets.find((x) => x.id === setId);
  if (!s) return null;
  if (!s.completed && (!isNum(s.weight) || !isNum(s.reps))) return { error: 'missing' };
  s.completed = !s.completed;
  delete s.pr;
  let pr = null;
  if (s.completed && s.type !== 'W' && s.reps > 0 && s.weight > 0) {
    const b = bests(we.exercise.name);
    // also account for earlier completed sets in this workout
    for (const o of we.sets) { if (o === s) break; if (o.completed && working(o)) { b.weight = Math.max(b.weight, o.weight); b.e1rm = Math.max(b.e1rm, e1rm(o.weight, o.reps)); b.volume = Math.max(b.volume, o.weight * o.reps); } }
    const kinds = [];
    if (s.weight > b.weight) kinds.push('weight');
    if (e1rm(s.weight, s.reps) > b.e1rm + 0.01) kinds.push('e1rm');
    if (s.weight * s.reps > b.volume) kinds.push('volume');
    if (kinds.length && b.count > 0) { s.pr = kinds; pr = kinds; }
  }
  touchActive(); emit('active', { silent: true });
  const rest = s.completed && state.settings.autoRest ? (isNum(we.restTime) ? we.restTime : state.settings.restDefault) : 0;
  return { completed: s.completed, pr, rest };
}
export function updateWorkoutName(name) { if (!state.active) return; state.active.name = name; touchActive(); emit('active', { silent: true }); }

export function cancelWorkout() {
  const id = state.active?.id;
  state.active = null; state.rest = null; state.minimized = false;
  persist(); emit('active');
  if (state.user && id) cloud.del(`active_workouts/${state.user.id}`).catch(logCloudErr);
}
export const minimizeWorkout = () => { state.minimized = true; persist(); emit('active'); };
export const maximizeWorkout = () => { state.minimized = false; persist(); emit('active'); };

/** Finish: builds the session, logs PRs, syncs the routine, clears the active workout. */
export function finishWorkout() {
  const a = state.active; if (!a) return null;
  const done = a.exercises.map((we) => ({ ...we, sets: we.sets.filter((s) => s.completed && isNum(s.weight) && isNum(s.reps)) })).filter((we) => we.sets.length);
  if (!done.length) return null;
  const endTime = Date.now();
  const prs = [];
  for (const we of done) for (const s of we.sets) if (s.pr?.length) prs.push({ exercise: we.exercise.name, kinds: s.pr, weight: s.weight, reps: s.reps });
  const session = {
    id: a.id, name: (a.name || '').trim() || defaultWorkoutName(), userId: state.user?.id || 'anonymous', startTime: a.startTime, endTime,
    exercises: done.map((we) => ({ id: we.id, exercise: we.exercise, sets: we.sets.map((s) => ({ id: s.id, weight: s.weight, reps: s.reps, completed: true, ...(s.type ? { type: s.type } : {}), ...(s.rpe ? { rpe: s.rpe } : {}), ...(s.pr ? { pr: s.pr } : {}) })), ...(we.notes ? { notes: we.notes } : {}), ...(isNum(we.restTime) ? { restTime: we.restTime } : {}) })),
    volume: sum(done.flatMap((we) => we.sets).filter((s) => s.type !== 'W'), (s) => s.weight * s.reps),
    records: prs.length, prs, unit: a.unit || state.settings.unit, templateId: a.templateId || null, updatedAt: endTime,
  };
  state.history.unshift(session);
  state.history.sort((x, y) => y.startTime - x.startTime);

  // Sync the routine with what was actually performed (keeps unperformed exercises).
  if (a.templateId) {
    const t = state.templates.find((x) => x.id === a.templateId);
    if (t) {
      const byName = new Map(done.map((we) => [we.exercise.name.toLowerCase(), we]));
      const merged = t.exercises.map((te) => {
        const d = byName.get(te.exercise.name.toLowerCase());
        if (!d) return te;
        byName.delete(te.exercise.name.toLowerCase());
        return { ...te, sets: d.sets.filter((s) => s.type !== 'W').map((s) => ({ id: uuid(), weight: s.weight, reps: s.reps, completed: false })), ...(d.notes ? { notes: d.notes } : {}) };
      });
      for (const d of byName.values()) merged.push({ id: uuid(), exercise: d.exercise, sets: d.sets.filter((s) => s.type !== 'W').map((s) => ({ id: uuid(), weight: s.weight, reps: s.reps, completed: false })), ...(d.notes ? { notes: d.notes } : {}) });
      updateTemplate(t.id, { exercises: merged, lastPerformed: endTime });
    }
  }
  state.active = null; state.rest = null; state.minimized = false;
  persist(); emit('active'); emit('history');
  if (state.user) {
    cloud.set(`workout_history/${session.id}`, { ...session, userId: state.user.id }).catch(logCloudErr);
    cloud.del(`active_workouts/${state.user.id}`).catch(logCloudErr);
  }
  return { session, prs, duration: endTime - a.startTime };
}

// ---------- History edits ----------
export function updateSession(session) {
  const i = state.history.findIndex((s) => s.id === session.id); if (i < 0) return;
  const s = { ...session, updatedAt: Date.now() };
  s.volume = sum(s.exercises.flatMap((we) => we.sets).filter((x) => working(x)), (x) => x.weight * x.reps);
  state.history[i] = s;
  state.history.sort((x, y) => y.startTime - x.startTime);
  persist(); emit('history');
  if (state.user) cloud.set(`workout_history/${s.id}`, { ...s, userId: state.user.id }).catch(logCloudErr);
}
export function deleteSession(id) {
  const s = state.history.find((x) => x.id === id);
  state.history = state.history.filter((x) => x.id !== id);
  persist(); emit('history');
  if (state.user) cloud.del(`workout_history/${id}`).catch(logCloudErr);
  return s;
}
export function restoreSession(s) {
  if (!s || state.history.some((x) => x.id === s.id)) return;
  state.history.push(s); state.history.sort((x, y) => y.startTime - x.startTime);
  persist(); emit('history');
  if (state.user) cloud.set(`workout_history/${s.id}`, { ...s, userId: state.user.id }).catch(logCloudErr);
}

// ---------- Importing history / backups ----------
const normalizeSession = (s) => ({
  id: typeof s.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(s.id) ? s.id : uuid(),
  name: String(s.name || 'Workout').slice(0, 99), userId: state.user?.id || 'anonymous',
  startTime: s.startTime, endTime: isNum(s.endTime) && s.endTime > s.startTime ? s.endTime : s.startTime,
  unit: s.unit === 'kg' ? 'kg' : 'lbs', templateId: s.templateId || null, updatedAt: Date.now(),
  exercises: (s.exercises || []).filter((we) => we?.exercise?.name && Array.isArray(we.sets)).slice(0, 49).map((we) => {
    const lib = findExerciseByName(we.exercise.name);
    return {
      id: we.id || uuid(), exercise: { id: lib?.id || we.exercise.id || `name:${we.exercise.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name: we.exercise.name, muscleGroup: lib?.muscleGroup || we.exercise.muscleGroup || 'Other' },
      sets: we.sets.filter((x) => isNum(Number(x.weight)) && isNum(Number(x.reps)) && x.completed !== false).map((x) => ({ id: x.id || uuid(), weight: Number(x.weight), reps: Number(x.reps), completed: true, ...(x.type ? { type: x.type } : {}), ...(x.rpe ? { rpe: x.rpe } : {}) })),
      ...(we.notes ? { notes: we.notes } : {}), ...(isNum(we.restTime) ? { restTime: we.restTime } : {}),
    };
  }).filter((we) => we.sets.length),
  ...(s.notes ? { notes: s.notes } : {}),
});

/** Merge sessions into history (skips duplicates by id or same start-minute + name). → { added, skipped } */
export function importHistory(sessions, { recompute = true } = {}) {
  const ids = new Set(state.history.map((s) => s.id));
  const keys = new Set(state.history.map((s) => `${Math.floor(s.startTime / 60000)}|${(s.name || '').toLowerCase()}`));
  const added = [];
  for (const raw of sessions) {
    if (!raw || !isNum(raw.startTime)) continue;
    const s = normalizeSession(raw);
    if (!s.exercises.length) continue;
    const key = `${Math.floor(s.startTime / 60000)}|${s.name.toLowerCase()}`;
    if (ids.has(s.id) || keys.has(key)) continue;
    s.volume = sum(s.exercises.flatMap((we) => we.sets).filter((x) => x.type !== 'W'), (x) => x.weight * x.reps);
    s.records = 0; s.prs = [];
    ids.add(s.id); keys.add(key); added.push(s);
  }
  if (!added.length) return { added: 0, skipped: sessions.length };
  state.history = state.history.concat(added).sort((x, y) => y.startTime - x.startTime);
  const changed = recompute ? recomputeRecords() : [];
  persist(); emit('history');
  if (state.user) {
    const touched = new Map(added.map((s) => [s.id, s]));
    for (const s of changed) touched.set(s.id, s);
    cloud.batch([...touched.values()].map((s) => ({ path: `workout_history/${s.id}`, data: { ...s, userId: state.user.id } }))).catch(logCloudErr);
  }
  return { added: added.length, skipped: sessions.length - added.length };
}

/**
 * Walks history oldest → newest and re-derives per-set PR flags, `records` and `prs`
 * so imported sessions slot into the timeline correctly. Returns sessions whose flags changed.
 */
export function recomputeRecords() {
  const best = new Map(); // name → {weight, e1rm, volume, count}
  const changed = [];
  const u = state.settings.unit;
  for (const s of [...state.history].reverse()) {
    const su = sessionUnit(s);
    const before = JSON.stringify([s.records || 0, (s.exercises || []).map((we) => (we.sets || []).map((x) => x.pr || null))]);
    const prs = [];
    for (const we of s.exercises || []) {
      const name = we?.exercise?.name?.toLowerCase(); if (!name) continue;
      const b = best.get(name) || { weight: 0, e1rm: 0, volume: 0, count: 0 };
      for (const st of we.sets || []) {
        delete st.pr;
        if (!working(st)) continue;
        const w = convert(st.weight, su, u);
        const kinds = [];
        if (b.count > 0) { if (w > b.weight) kinds.push('weight'); if (e1rm(w, st.reps) > b.e1rm + 0.01) kinds.push('e1rm'); if (w * st.reps > b.volume) kinds.push('volume'); }
        if (kinds.length) { st.pr = kinds; prs.push({ exercise: we.exercise.name, kinds, weight: st.weight, reps: st.reps }); }
        b.count++; b.weight = Math.max(b.weight, w); b.e1rm = Math.max(b.e1rm, e1rm(w, st.reps)); b.volume = Math.max(b.volume, w * st.reps);
      }
      best.set(name, b);
    }
    s.records = prs.length; s.prs = prs;
    const after = JSON.stringify([s.records, (s.exercises || []).map((we) => (we.sets || []).map((x) => x.pr || null))]);
    if (before !== after) { s.updatedAt = Date.now(); changed.push(s); }
  }
  return changed;
}

/** Restore a full backup: routines (skipping same-name duplicates), history, custom exercises, favorites, body weight. */
export function importBackup(b) {
  const out = { templates: 0, history: 0, custom: 0, bodyweight: 0 };
  const names = new Set(state.templates.map((t) => t.name.toLowerCase()));
  for (const t of b.templates || []) { if (!t?.name || !Array.isArray(t.exercises) || names.has(t.name.toLowerCase())) continue; createTemplate({ name: t.name, exercises: t.exercises }); names.add(t.name.toLowerCase()); out.templates++; }
  if (b.custom?.length) {
    const have = new Set(allExercises().map((e) => e.name.toLowerCase()));
    for (const c of b.custom) { if (!c?.name || have.has(c.name.toLowerCase())) continue; const ex = { id: /^[a-zA-Z0-9_-]+$/.test(c.id || '') ? c.id : `custom-${Date.now()}-${out.custom}`, name: c.name, muscleGroup: c.muscleGroup || 'Other', custom: true, createdAt: c.createdAt || Date.now() }; state.custom.unshift(ex); have.add(ex.name.toLowerCase()); out.custom++; if (state.user) cloud.set(`custom_exercises/${ex.id}`, { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup, userId: state.user.id, createdAt: ex.createdAt }).catch(logCloudErr); }
    emit('library');
  }
  if (b.favorites?.length) { for (const id of b.favorites) if (typeof id === 'string' && !state.favorites.includes(id)) state.favorites.push(id); emit('favorites'); }
  if (b.bodyweight?.length) {
    const days = new Set(state.bodyweight.map((x) => dayKey(x.t)));
    for (const x of b.bodyweight) { if (!isNum(x?.t) || !isNum(x?.kg) || days.has(dayKey(x.t))) continue; state.bodyweight.push({ t: x.t, kg: x.kg }); days.add(dayKey(x.t)); out.bodyweight++; }
    state.bodyweight.sort((a, c) => a.t - c.t); emit('bodyweight');
  }
  if (b.history?.length) out.history = importHistory(b.history).added;
  state.settings.updatedAt = Date.now();
  persist(); pushUserDoc();
  return out;
}

// ---------- Rest timer ----------
let restTick = null;
export function startRest(seconds, label = '') {
  if (!seconds || seconds <= 0) return;
  state.rest = { endsAt: Date.now() + seconds * 1000, total: seconds, label, done: false, startedAt: Date.now() };
  clearInterval(restTick);
  restTick = setInterval(tickRest, 250);
  emit('rest');
}
export function adjustRest(delta) {
  if (!state.rest) return;
  state.rest.endsAt = Math.max(Date.now() + 1000, state.rest.endsAt + delta * 1000);
  state.rest.total = Math.max(1, state.rest.total + delta);
  state.rest.done = false;
  emit('rest');
}
export function stopRest() { clearInterval(restTick); restTick = null; state.rest = null; emit('rest'); }
export const restRemaining = () => (state.rest ? Math.max(0, Math.ceil((state.rest.endsAt - Date.now()) / 1000)) : 0);
function tickRest() {
  if (!state.rest) return clearInterval(restTick);
  const left = restRemaining();
  if (left <= 0 && !state.rest.done) { state.rest.done = true; emit('rest', { finished: true }); setTimeout(() => { if (state.rest?.done) stopRest(); }, 12000); }
  else emit('rest-tick');
}

// ---------- Export ----------
export function exportAll() {
  return JSON.stringify({ app: 'LiftTracker', version: 2, exportedAt: new Date().toISOString(), unit: state.settings.unit, templates: state.templates, history: state.history, custom: state.custom, favorites: state.favorites, bodyweight: state.bodyweight, settings: state.settings }, null, 2);
}
export function clearLocalData() {
  for (const k of Object.values(K)) if (typeof k === 'string') ls.del(k);
  for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('lt_')) localStorage.removeItem(k); }
}

// ---------- Cloud sync ----------
let unsubs = [];
let activeSeenInCloud = false;
const logCloudErr = (e) => { console.warn('cloud write failed', e); state.cloud = 'error'; state.lastError = e?.message || String(e); emit('cloud'); };

export async function signIn() {
  state.cloud = 'connecting'; emit('cloud');
  try { await connectCloud(true); } catch (e) { state.cloud = 'error'; state.lastError = e?.message || String(e); emit('cloud'); throw e; }
}
export async function signOut() {
  await cloud.signOut().catch(() => {});
  ls.del(K.cloudUser);
}

async function connectCloud(interactive = false) {
  await cloud.init();
  if (interactive) await cloud.signIn();
  if (!connectCloud.listening) {
    connectCloud.listening = true;
    await cloud.onAuth((u) => onAuthChange(u));
  }
}
connectCloud.listening = false;

async function onAuthChange(u) {
  state.authReady = true;
  for (const f of unsubs) f(); unsubs = [];
  activeSeenInCloud = false;
  if (!u) {
    const wasUser = state.user;
    state.user = null;
    ls.del(K.cloudUser);
    state.cloud = 'off';
    if (wasUser) {
      // Leave cloud-owned data behind on this device; start fresh locally.
      state.templates = []; state.history = []; state.custom = []; state.active = null; state.rest = null;
      state.favorites = []; state.bodyweight = [];
      seedDefaults('anonymous');
      persist(); emit('templates'); emit('history'); emit('active');
    }
    emit('auth'); return;
  }
  const prevUid = ls.get(K.cloudUser)?.id;
  state.user = { id: u.uid, name: u.displayName || '', email: u.email || '', photoUrl: u.photoURL || '' };
  ls.set(K.cloudUser, { id: u.uid, email: u.email });
  if (prevUid && prevUid !== u.uid) { state.templates = []; state.history = []; state.custom = []; state.active = null; state.favorites = []; state.bodyweight = []; persist(); }
  state.cloud = 'syncing'; emit('auth');
  try {
    await adoptUserDoc(u.uid);
    await migrateLocal(u.uid);
    attachWatchers(u.uid);
    state.cloud = 'ok';
  } catch (e) {
    console.warn('cloud sync setup failed', e);
    state.cloud = 'error'; state.lastError = e?.message || String(e);
  }
  emit('cloud');
}

async function adoptUserDoc(uid) {
  const remote = await cloud.get(`users/${uid}`).catch(() => null);
  if (remote && (remote.updatedAt || 0) > (state.settings.updatedAt || 0)) applyRemoteUser(remote);
  else await pushUserDocNow();
}
function applyRemoteUser(r) {
  if (r.unit && r.unit !== state.settings.unit) { state.settings.unit = r.unit; }
  if (r.theme) state.settings.theme = r.theme;
  if (r.settings) Object.assign(state.settings, r.settings);
  if (Array.isArray(r.favorites)) state.favorites = r.favorites;
  if (Array.isArray(r.bodyweight)) state.bodyweight = r.bodyweight;
  if (r.name || r.photoUrl) state.profile = { name: r.name || state.profile.name, photoUrl: r.photoUrl ?? state.profile.photoUrl };
  state.settings.updatedAt = r.updatedAt || Date.now();
  applyTheme(); persist(); emit('settings');
}
function userDocPayload() {
  const u = state.user;
  const { updatedAt, ...settings } = state.settings;
  return { id: u.id, name: displayName(), email: u.email || '', photoUrl: photoUrl() || '', unit: state.settings.unit, theme: state.settings.theme === 'system' ? undefined : state.settings.theme, favorites: state.favorites, bodyweight: state.bodyweight, settings, updatedAt: state.settings.updatedAt || Date.now() };
}
async function pushUserDocNow() { if (!state.user) return; return cloud.set(`users/${state.user.id}`, userDocPayload(), true).catch(logCloudErr); }
const pushUserDoc = debounce(pushUserDocNow, 600);

function pushActive() {
  if (!state.user) return;
  if (state.active) cloud.set(`active_workouts/${state.user.id}`, { ...state.active, userId: state.user.id }).catch(logCloudErr);
}
const pushActiveDebounced = debounce(pushActive, 700);

async function migrateLocal(uid) {
  if (ls.get(K.migrated(uid))) return;
  const [cloudT, cloudH] = await Promise.all([cloud.listWhere('workout_templates', 'userId', uid), cloud.listWhere('workout_history', 'userId', uid)]);
  const ops = [];
  const tIds = new Set(cloudT.map((t) => t.id)), tNames = new Set(cloudT.map((t) => t.name?.toLowerCase()));
  const hIds = new Set(cloudH.map((h) => h.id));
  let order = cloudT.length;
  for (const t of state.templates) {
    if (t.userId && !['anonymous', 'default'].includes(t.userId)) continue;
    if (tIds.has(t.id)) continue;
    if (t.seeded && (cloudT.length > 0 || tNames.has(t.name.toLowerCase()))) continue;
    const { seeded, ...rest } = t;
    ops.push({ path: `workout_templates/${t.id}`, data: { ...rest, userId: uid, order: order++ } });
  }
  for (const s of state.history) if ((!s.userId || s.userId === 'anonymous') && !hIds.has(s.id)) ops.push({ path: `workout_history/${s.id}`, data: { ...s, userId: uid, endTime: s.endTime || s.startTime } });
  for (const c of state.custom) ops.push({ path: `custom_exercises/${c.id}`, data: { id: c.id, name: c.name, muscleGroup: c.muscleGroup, userId: uid, createdAt: c.createdAt || Date.now() } });
  if (state.active && (!state.active.userId || state.active.userId === 'anonymous')) { state.active.userId = uid; pushActive(); }
  if (ops.length) await cloud.batch(ops);
  ls.set(K.migrated(uid), Date.now());
}

function attachWatchers(uid) {
  unsubs.push(cloud.watchWhere('workout_templates', 'userId', uid, (docs, meta) => {
    if (meta.pending) return;
    state.templates = docs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.updatedAt || 0) - (b.updatedAt || 0));
    persist(); emit('templates');
  }, () => { state.cloud = 'error'; emit('cloud'); }));
  unsubs.push(cloud.watchWhere('workout_history', 'userId', uid, (docs, meta) => {
    if (meta.pending) return;
    state.history = docs.sort((a, b) => b.startTime - a.startTime);
    persist(); emit('history');
  }, () => { state.cloud = 'error'; emit('cloud'); }));
  unsubs.push(cloud.watchWhere('custom_exercises', 'userId', uid, (docs, meta) => {
    if (meta.pending) return;
    state.custom = docs.map((d) => ({ ...d, custom: true }));
    persist(); emit('library');
  }));
  unsubs.push(cloud.watchDoc(`users/${uid}`, (doc, meta) => {
    if (meta.pending || !doc) return;
    if ((doc.updatedAt || 0) > (state.settings.updatedAt || 0)) applyRemoteUser(doc);
  }));
  unsubs.push(cloud.watchDoc(`active_workouts/${uid}`, (doc, meta) => {
    if (meta.pending) return;
    if (doc) {
      activeSeenInCloud = true;
      if (!state.active || (doc.updatedAt || 0) > (state.active.updatedAt || 0)) { state.active = doc; persist(); emit('active'); }
    } else if (activeSeenInCloud && state.active && state.active.userId === uid) {
      // Finished / cancelled on another device.
      state.active = null; state.rest = null; persist(); emit('active');
    }
  }));
}

export async function resync() {
  if (!state.user) return;
  state.cloud = 'syncing'; emit('cloud');
  try {
    const uid = state.user.id;
    ls.del(K.migrated(uid));
    await migrateLocal(uid);
    await pushUserDocNow();
    for (const t of state.templates) if (t.userId !== uid) await cloud.set(`workout_templates/${t.id}`, { ...t, userId: uid });
    state.cloud = 'ok';
  } catch (e) { state.cloud = 'error'; state.lastError = e?.message || String(e); }
  emit('cloud');
}
