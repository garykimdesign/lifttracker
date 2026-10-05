// Import sheet: pick a LiftTracker backup (JSON) or a history CSV (LiftTracker / Strong / Hevy),
// preview what was detected, then merge into the store with duplicate skipping + PR back-fill.
import { I } from '../icons.js';
import { esc, fmtDate, fmtVol, pickFile } from '../utils.js';
import { openModal, toast } from '../ui.js';
import { parseBackup, parseHistoryCsv } from '../importers.js';
import { state, importBackup, importHistory } from '../store.js';

const FORMAT_NAME = { lifttracker: 'LiftTracker CSV', strong: 'Strong export', hevy: 'Hevy export', generic: 'Generic CSV', backup: 'LiftTracker backup', routines: 'LiftTracker routines' };

export function openImportSheet() {
  openModal({
    title: 'Import',
    html: `<div class="stack">
      <button class="card card-pad card-click" data-pick="json" style="text-align:left;display:flex;gap:14px;align-items:center;width:100%"><div class="avatar-letter">${I.upload}</div><div style="flex:1"><b>Restore a LiftTracker backup</b><div class="muted" style="font-size:12.5px;margin-top:2px">.json from Settings → Full backup: workouts, routines, body weight, custom exercises, favorites</div></div>${I.chevronRight}</button>
      <button class="card card-pad card-click" data-pick="csv" style="text-align:left;display:flex;gap:14px;align-items:center;width:100%"><div class="avatar-letter">${I.history}</div><div style="flex:1"><b>Import workout history (CSV)</b><div class="muted" style="font-size:12.5px;margin-top:2px">Strong, Hevy or LiftTracker CSV exports — or any CSV with date, exercise, weight and reps columns</div></div>${I.chevronRight}</button>
      <p class="muted" style="font-size:12.5px">Workouts already in your history (same start time and name) are skipped, so re-importing is safe. Personal records are recalculated across the whole timeline afterwards.</p>
    </div>`,
    onMount(h) {
      h.body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-pick]'); if (!b) return;
        const kind = b.dataset.pick;
        const txt = await pickFile(kind === 'json' ? 'application/json,.json' : 'text/csv,.csv,text/plain');
        if (!txt) return;
        try {
          if (kind === 'json') previewBackup(parseBackup(txt), h);
          else previewCsv(txt, h);
        } catch (err) { toast(esc(err.message || 'Import failed'), { duration: 5000 }); }
      });
    },
  });
}

export function previewBackup(b, parent = null) {
  const sets = b.history.reduce((a, s) => a + (s.exercises || []).reduce((x, we) => x + (we.sets || []).length, 0), 0);
  const range = b.history.length ? `${fmtDate(Math.min(...b.history.map((s) => s.startTime)), { relative: false })} → ${fmtDate(Math.max(...b.history.map((s) => s.startTime)), { relative: false })}` : '';
  openModal({
    title: 'Restore backup',
    html: `<div class="row" style="gap:6px;margin-bottom:14px"><span class="pill pill-accent">${FORMAT_NAME[b.kind]}</span>${b.unit ? `<span class="pill">${esc(b.unit)}</span>` : ''}</div>
      <div class="grid-2">
        ${tile(b.history.length, 'Workouts', range)}
        ${tile(sets, 'Sets')}
        ${tile(b.templates.length, 'Routines', 'same names skipped')}
        ${tile(b.bodyweight.length, 'Body-weight entries')}
        ${b.custom.length ? tile(b.custom.length, 'Custom exercises') : ''}
        ${b.favorites.length ? tile(b.favorites.length, 'Favorites') : ''}
      </div>`,
    foot: `<button class="btn btn-lg" data-close>Cancel</button><button class="btn btn-lg btn-primary" data-go>Restore</button>`,
    onMount(h) {
      h.foot.querySelector('[data-go]').onclick = () => {
        const r = importBackup(b);
        h.close(); parent?.close();
        toast(`Restored ${r.history} workout${r.history === 1 ? '' : 's'}, ${r.templates} routine${r.templates === 1 ? '' : 's'}${r.bodyweight ? `, ${r.bodyweight} weigh-ins` : ''}${r.custom ? `, ${r.custom} exercises` : ''}`, { duration: 5000 });
      };
    },
  });
}

export function previewCsv(txt, parent = null) {
  let unit = state.settings.unit;
  let res = parseHistoryCsv(txt, { unit });
  const h = openModal({
    title: 'Import history',
    html: `<div data-prev></div>`,
    foot: `<button class="btn btn-lg" data-close>Cancel</button><button class="btn btn-lg btn-primary" data-go>Import</button>`,
    onMount(h) {
      const prev = h.body.querySelector('[data-prev]');
      const render = () => {
        const sets = res.sessions.reduce((a, s) => a + s.exercises.reduce((x, we) => x + we.sets.length, 0), 0);
        const names = new Set(res.sessions.flatMap((s) => s.exercises.map((we) => we.exercise.name)));
        const range = res.sessions.length ? `${fmtDate(res.sessions[0].startTime, { relative: false })} → ${fmtDate(res.sessions[res.sessions.length - 1].startTime, { relative: false })}` : '';
        const dupes = res.sessions.filter((s) => state.history.some((x) => Math.floor(x.startTime / 60000) === Math.floor(s.startTime / 60000) && x.name.toLowerCase() === s.name.toLowerCase())).length;
        prev.innerHTML = `
          <div class="row" style="gap:6px;margin-bottom:14px;flex-wrap:wrap"><span class="pill pill-accent">${FORMAT_NAME[res.format]}</span><span class="pill">${res.unitFromFile ? `${res.unit} · from file` : `${res.unit} · assumed`}</span>${res.skipped ? `<span class="pill pill-warn">${res.skipped} rows skipped</span>` : ''}</div>
          ${res.unitFromFile ? '' : `<div class="setting-row" style="padding-top:0"><div><div class="t">Weights in this file are</div><div class="d">The export doesn’t say — pick the unit the app was set to.</div></div><div class="seg"><button class="${res.unit === 'lbs' ? 'on' : ''}" data-u="lbs">lbs</button><button class="${res.unit === 'kg' ? 'on' : ''}" data-u="kg">kg</button></div></div>`}
          <div class="grid-2" style="margin-top:12px">
            ${tile(res.sessions.length, 'Workouts', range)}
            ${tile(sets, 'Sets', `${names.size} exercises`)}
            ${tile(fmtVol(res.sessions.reduce((a, s) => a + s.volume, 0)), `Volume (${res.unit})`)}
            ${tile(dupes, 'Already imported', 'will be skipped')}
          </div>
          ${res.warnings.length ? `<div class="card card-pad" style="margin-top:12px;background:var(--warn-soft);border-color:transparent;font-size:13px">${res.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
          ${res.sessions.length ? `<details style="margin-top:14px"><summary class="muted" style="font-size:13px;font-weight:700;cursor:pointer">Preview first workouts</summary><div class="list" style="margin-top:6px">${res.sessions.slice(-5).reverse().map((s) => `<div class="list-item" style="padding:8px 4px"><div style="flex:1;min-width:0"><b>${esc(s.name)}</b> <span class="muted" style="font-size:12.5px">· ${fmtDate(s.startTime, { relative: false })}</span><div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.exercises.map((we) => `${esc(we.exercise.name)} ×${we.sets.length}`).join(' · ')}</div></div></div>`).join('')}</div></details>` : `<div class="empty" style="margin-top:12px"><h3>No workouts found</h3><p>Rows need a date, an exercise name and reps.</p></div>`}`;
        h.foot.querySelector('[data-go]').disabled = res.sessions.length === 0;
      };
      render();
      prev.addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; unit = b.dataset.u; res = parseHistoryCsv(txt, { unit }); render(); });
      h.foot.querySelector('[data-go]').onclick = () => {
        const r = importHistory(res.sessions);
        h.close(); parent?.close();
        toast(r.added ? `Imported ${r.added} workout${r.added === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} skipped as duplicates` : ''} — records recalculated` : 'Nothing new to import — those workouts were already here', { duration: 5000 });
      };
    },
  });
  return h;
}

const tile = (v, l, d = '') => `<div class="card stat"><div class="val num">${v}</div><div class="lbl">${esc(l)}</div>${d ? `<div class="muted" style="font-size:11.5px;font-weight:600">${esc(d)}</div>` : ''}</div>`;
