// Post-workout summary sheet: duration, volume, sets, PRs and a per-exercise recap.
import { I } from '../icons.js';
import { esc, fmtDuration, fmtVol, fmtW } from '../utils.js';
import { openModal, toast } from '../ui.js';
import { state, createTemplate, sessionSets } from '../store.js';

const KIND = { weight: 'Heaviest', e1rm: 'Est. 1RM', volume: 'Set volume' };

export function openSummary({ session, prs, duration }) {
  const unit = session.unit || state.settings.unit;
  const sets = sessionSets(session);
  const hasTemplate = !!session.templateId && state.templates.some((t) => t.id === session.templateId);
  openModal({
    noHead: true,
    html: `
      <div class="summary-hero">
        <div class="ico">${prs.length ? I.trophy : I.check}</div>
        <div class="kicker">${prs.length ? `${prs.length} personal record${prs.length > 1 ? 's' : ''}` : 'Workout complete'}</div>
        <h2 style="font-size:24px;margin-top:4px">${esc(session.name)}</h2>
        <div class="big num" style="margin-top:14px">${fmtDuration(duration)}</div>
        <div class="muted" style="font-size:13px;font-weight:700;margin-top:4px">duration</div>
      </div>
      <div class="grid-3" style="margin:18px 0">
        <div class="card stat"><div class="val num">${fmtVol(session.volume)}</div><div class="lbl">Volume · ${unit}</div></div>
        <div class="card stat"><div class="val num">${sets}</div><div class="lbl">Sets</div></div>
        <div class="card stat"><div class="val num">${session.exercises.length}</div><div class="lbl">Exercises</div></div>
      </div>
      ${prs.length ? `<div class="card card-pad" style="border-color:color-mix(in srgb,var(--warn) 40%,transparent);background:var(--warn-soft)">
        <div class="eyebrow" style="color:var(--warn)">New records</div>
        <div class="stack" style="gap:8px;margin-top:8px">${prs.map((p) => `<div class="row between"><b>${esc(p.exercise)}</b><span class="num" style="font-weight:700">${fmtW(p.weight, unit)} × ${p.reps}</span></div><div class="muted" style="font-size:12px;margin-top:-6px">${p.kinds.map((k) => KIND[k]).join(' · ')}</div>`).join('')}</div>
      </div>` : ''}
      <div class="list" style="margin-top:14px">
        ${session.exercises.map((we) => `<div class="list-item" style="padding:12px 2px"><div style="flex:1;min-width:0"><b>${esc(we.exercise.name)}</b><div class="muted" style="font-size:12.5px">${we.sets.map((s) => `${fmtW(s.weight, unit)}×${s.reps}`).join(', ')}</div></div></div>`).join('')}
      </div>`,
    foot: `${hasTemplate ? '' : `<button class="btn btn-lg" data-save>${I.list} Save as routine</button>`}<button class="btn btn-lg btn-primary" data-close>Done</button>`,
    onMount(h) {
      h.foot.querySelector('[data-save]')?.addEventListener('click', () => {
        createTemplate({ name: session.name, exercises: session.exercises.map((we) => ({ exercise: we.exercise, sets: we.sets.filter((s) => s.type !== 'W').map((s) => ({ weight: s.weight, reps: s.reps })), ...(we.restTime ? { restTime: we.restTime } : {}), ...(we.notes ? { notes: we.notes } : {}) })) });
        toast('Saved as a routine');
        h.close();
      });
    },
  });
}
