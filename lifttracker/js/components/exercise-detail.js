// Exercise detail sheet: personal bests, e1RM trend, recent sessions, favorite / add actions.
import { I } from '../icons.js';
import { esc, fmtW, fmtVol, fmtDate, e1rm } from '../utils.js';
import { openModal, confirm, toast, menu } from '../ui.js';
import { lineChart } from './charts.js';
import { state, bests, exerciseHistory, isFav, toggleFavorite, deleteCustomExercise, addExercisesToWorkout, startWorkout, maximizeWorkout } from '../store.js';

export function openExerciseDetail(ex, { onAdd } = {}) {
  const unit = state.settings.unit;
  const b = bests(ex.name);
  const hist = exerciseHistory(ex.name);
  let best = 0;
  const pts = hist.map((p) => { const pr = p.e1rm > best + 0.01; best = Math.max(best, p.e1rm); return { t: p.t, v: p.e1rm, pr }; });
  const recent = hist.slice(-6).reverse();
  const h = openModal({
    title: ex.name,
    full: true,
    headActions: `<button class="btn btn-icon btn-ghost star ${isFav(ex.id) ? 'on' : ''}" data-fav aria-label="Favorite">${isFav(ex.id) ? I.starFill : I.star}</button>${ex.custom ? `<button class="btn btn-icon btn-ghost" data-more>${I.moreH}</button>` : ''}`,
    html: `
      <div class="row" style="gap:6px;margin-bottom:16px"><span class="pill">${esc(ex.muscleGroup)}</span>${ex.custom ? '<span class="pill pill-accent">Custom</span>' : ''}${b.count ? `<span class="pill">${hist.length} session${hist.length === 1 ? '' : 's'}</span>` : ''}</div>
      ${b.count ? `
      <div class="grid-3">
        <div class="card stat"><div class="val num">${fmtW(b.weight, unit)}<small>${unit}</small></div><div class="lbl">Heaviest</div></div>
        <div class="card stat"><div class="val num">${fmtW(b.e1rm, unit)}<small>${unit}</small></div><div class="lbl">Est. 1RM</div></div>
        <div class="card stat"><div class="val num">${fmtVol(b.volume)}</div><div class="lbl">Best set vol.</div></div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Estimated 1RM</h2><span class="muted" style="font-size:12px;font-weight:700">Epley · ${unit}</span></div>
        <div class="card card-pad">${lineChart(pts, { h: 200, fmt: (v) => fmtW(v, unit), label: 'Estimated one-rep max over time' })}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Recent</h2></div>
        <div class="card" style="padding:4px 14px">
          ${recent.map((p) => `<div class="list-item"><div class="date-tile"><span class="m">${new Date(p.t).toLocaleDateString(undefined, { month: 'short' })}</span><span class="d">${new Date(p.t).getDate()}</span></div><div style="flex:1;min-width:0"><b>${esc(p.sessionName || 'Workout')}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${p.sets.map((s) => `<span class="num">${fmtW(s.weight, unit)}×${s.reps}</span>${s.type === 'W' ? '<sup style="color:var(--warn)">w</sup>' : ''}`).join(' · ')}</div></div><div class="num" style="font-weight:700;font-size:13px;text-align:right">${fmtW(p.e1rm, unit)}<div class="muted" style="font-size:10px;font-weight:800;letter-spacing:.08em">E1RM</div></div></div>`).join('')}
        </div>
      </div>` : `<div class="empty"><div class="ico">${I.trending}</div><h3>No history yet</h3><p>Log this exercise in a workout and your bests and 1RM trend will show up here.</p></div>`}
      <div class="section">
        <div class="section-head"><h2>Rep max table</h2><span class="muted" style="font-size:12px;font-weight:700">from best e1RM</span></div>
        ${b.e1rm ? `<div class="card" style="padding:10px 14px"><div class="grid-3" style="gap:6px 12px">${[1, 2, 3, 5, 8, 10, 12, 15].map((r) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="muted" style="font-weight:700;font-size:13px">${r} rep${r > 1 ? 's' : ''}</span><b class="num">${fmtW(b.e1rm / (1 + r / 30), unit)}</b></div>`).join('')}</div></div>` : '<p class="muted" style="font-size:13px">Available once you have a logged set.</p>'}
      </div>`,
    foot: state.active
      ? `<button class="btn btn-lg btn-primary" data-add>${I.plus} Add to current workout</button>`
      : `<button class="btn btn-lg btn-primary" data-start>${I.play} Start workout with this</button>`,
    onMount(h) {
      h.el.querySelector('[data-fav]').onclick = (e) => { const on = toggleFavorite(ex.id); e.currentTarget.classList.toggle('on', on); e.currentTarget.innerHTML = on ? I.starFill : I.star; };
      h.el.querySelector('[data-more]')?.addEventListener('click', (e) => menu(e.currentTarget, [
        { label: 'Delete custom exercise', icon: I.trash, danger: true, onClick: async () => { if (await confirm({ title: `Delete ${ex.name}?`, text: 'Past workouts keep their logged sets.' })) { deleteCustomExercise(ex.id); toast('Exercise deleted'); h.close(); } } },
      ]));
      h.foot.querySelector('[data-add]')?.addEventListener('click', () => { addExercisesToWorkout([ex]); maximizeWorkout(); toast(`Added ${esc(ex.name)}`); h.close(); onAdd?.(ex); });
      h.foot.querySelector('[data-start]')?.addEventListener('click', () => { startWorkout(null, { exercises: [{ exercise: ex, sets: [{ weight: '', reps: '' }, { weight: '', reps: '' }, { weight: '', reps: '' }] }], name: ex.name }); h.close(); });
    },
  });
  return h;
}
