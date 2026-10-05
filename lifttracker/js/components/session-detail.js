// Session detail sheet: view / edit a logged workout, update a routine from it, delete it.
import { I } from '../icons.js';
import { esc, uuid, isNum, fmtW, fmtVol, fmtDate, fmtTime, fmtDuration } from '../utils.js';
import { openModal, confirm, prompt, toast, menu, numField, parseNum } from '../ui.js';
import { openPicker } from './picker.js';
import { state, sessionVolume, sessionSets, updateSession, deleteSession, restoreSession, updateTemplate, createTemplate, startWorkout } from '../store.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const TYPE = { W: 'Warm-up', D: 'Drop set', F: 'Failure' };

export function openSessionDetail(sessionId) {
  const original = state.history.find((s) => s.id === sessionId);
  if (!original) return;
  let s = clone(original);
  const unit = s.unit || 'lbs';
  let editing = false;

  const h = openModal({
    title: fmtDate(s.startTime, { weekday: true }),
    full: true,
    headActions: `<button class="btn btn-sm hidden" data-cancel>Cancel</button><button class="btn btn-primary btn-sm hidden" data-save>Save</button><button class="btn btn-icon btn-ghost" data-more aria-label="More">${I.moreH}</button>`,
    html: `<div data-body></div>`,
    onMount(h) {
      const body = h.body.querySelector('[data-body]');
      const saveBtn = h.el.querySelector('[data-save]'), cancelBtn = h.el.querySelector('[data-cancel]'), moreBtn = h.el.querySelector('[data-more]');
      const setMode = (on) => { editing = on; saveBtn.classList.toggle('hidden', !on); cancelBtn.classList.toggle('hidden', !on); moreBtn.classList.toggle('hidden', on); render(); };

      const render = () => {
        const dur = (s.endTime || s.startTime) - s.startTime;
        body.innerHTML = `
          ${editing ? `<input class="title-input" data-name value="${esc(s.name)}" placeholder="Workout name">` : `<h1 style="font-size:24px">${esc(s.name)}</h1>`}
          <div class="meta" style="margin:8px 0 16px"><span>${I.clock} ${fmtTime(s.startTime)} · ${fmtDuration(dur, { long: true })}</span><span>${I.trending} ${fmtVol(sessionVolume(s))} ${state.settings.unit}</span><span>${I.list} ${sessionSets(s)} sets</span>${s.records ? `<span class="pr">${I.trophy} ${s.records} PR${s.records > 1 ? 's' : ''}</span>` : ''}</div>
          <div class="stack">
            ${s.exercises.map((we, i) => `<div class="ex-card" data-we="${we.id}">
              <div class="ex-head"><div style="flex:1;min-width:0"><h3>${esc(we.exercise.name)}</h3><div class="sub"><span>${esc(we.exercise.muscleGroup)}</span>${we.notes && !editing ? `<span>· ${esc(we.notes)}</span>` : ''}</div></div>${editing ? `<button class="btn btn-icon btn-ghost btn-sm" data-rm-ex aria-label="Remove exercise">${I.trash}</button>` : ''}</div>
              <div class="set-grid header" style="grid-template-columns:44px 1fr 1fr ${editing ? '30px' : '48px'}"><span>Set</span><span>${unit}</span><span>Reps</span><span></span></div>
              ${we.sets.map((st, j) => editing
                ? `<div class="set-row" data-set="${st.id}"><div class="set-grid" style="grid-template-columns:44px 1fr 1fr 30px"><div class="set-no ${(st.type || '').toLowerCase()}">${st.type || j + 1}</div>${numField({ value: st.weight, compact: true, attrs: 'data-f="weight"' })}${numField({ value: st.reps, compact: true, inputmode: 'numeric', attrs: 'data-f="reps"' })}<button class="set-del" data-rm-set aria-label="Remove set">${I.x}</button></div></div>`
                : `<div class="set-row ${st.pr?.length ? 'pr' : ''}"><div class="set-grid" style="grid-template-columns:44px 1fr 1fr 48px"><div class="set-no ${(st.type || '').toLowerCase()}" title="${TYPE[st.type] || 'Working set'}">${st.type || j + 1}</div><div class="num" style="text-align:center;font-weight:700">${fmtW(st.weight, unit)}</div><div class="num" style="text-align:center;font-weight:700">${st.reps}</div><div style="text-align:center">${st.pr?.length ? `<span class="pr-badge">${I.trophy}PR</span>` : ''}</div></div></div>`).join('')}
              ${editing ? `<div class="ex-foot"><button class="btn btn-sm" data-add-set>${I.plus} Add set</button></div>` : ''}
            </div>`).join('')}
          </div>
          ${editing ? `<button class="btn btn-lg btn-block" data-add-ex style="margin-top:14px">${I.plus} Add exercise</button>` : `<div class="wk-actions"><button class="btn btn-lg btn-block" data-repeat>${I.play} Repeat this workout</button></div>`}`;
      };
      render();

      const find = (el) => { const we = s.exercises.find((x) => x.id === el.closest('[data-we]')?.dataset.we); const st = we?.sets.find((x) => x.id === el.closest('[data-set]')?.dataset.set); return { we, st }; };
      body.addEventListener('input', (e) => {
        const t = e.target;
        if (t.matches('[data-name]')) { s.name = t.value; return; }
        const { st } = find(t); if (st && t.dataset.f) st[t.dataset.f] = parseNum(t.value);
      });
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.matches('[data-repeat]')) { startWorkout(null, { name: s.name, exercises: s.exercises.map((we) => ({ exercise: we.exercise, sets: we.sets.filter((x) => x.type !== 'W').map((x) => ({ weight: '', reps: '' })), ...(we.restTime ? { restTime: we.restTime } : {}) })) }); h.close(); return; }
        if (b.matches('[data-add-ex]')) { openPicker({ title: 'Add exercise', onPick: (list) => { for (const ex of list) s.exercises.push({ id: uuid(), exercise: { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup }, sets: [{ id: uuid(), weight: '', reps: '', completed: true }] }); render(); } }); return; }
        const { we, st } = find(b); if (!we) return;
        if (b.matches('[data-rm-ex]')) { s.exercises = s.exercises.filter((x) => x !== we); render(); }
        else if (b.matches('[data-add-set]')) { const last = we.sets[we.sets.length - 1]; we.sets.push({ id: uuid(), weight: last?.weight ?? '', reps: last?.reps ?? '', completed: true }); render(); }
        else if (b.matches('[data-rm-set]') && st) { we.sets = we.sets.filter((x) => x !== st); if (!we.sets.length) s.exercises = s.exercises.filter((x) => x !== we); render(); }
      });

      saveBtn.onclick = () => {
        s.exercises = s.exercises.map((we) => ({ ...we, sets: we.sets.filter((x) => isNum(x.weight) && isNum(x.reps)) })).filter((we) => we.sets.length);
        if (!s.exercises.length) { toast('A workout needs at least one completed set'); return; }
        s.name = (s.name || '').trim() || original.name;
        updateSession(s); toast('Workout updated'); setMode(false);
      };
      cancelBtn.onclick = () => { s = clone(state.history.find((x) => x.id === sessionId) || original); setMode(false); };
      moreBtn.onclick = () => menu(moreBtn, [
        { label: 'Edit workout', icon: I.edit, onClick: () => setMode(true) },
        { label: 'Update routine from this', icon: I.refresh, onClick: () => updateRoutineFrom(s) },
        '-',
        { label: 'Delete workout', icon: I.trash, danger: true, onClick: async () => {
          if (!await confirm({ title: 'Delete this workout?', text: 'It will be removed from your history and stats.' })) return;
          const removed = deleteSession(s.id); h.close();
          toast('Workout deleted', { action: 'Undo', onAction: () => restoreSession(removed), duration: 6000 });
        } },
      ]);
    },
  });
  return h;
}

/** Pushes a session's performed sets into an existing routine or a new one. */
export function updateRoutineFrom(s) {
  const toTemplateEx = (we) => ({ id: uuid(), exercise: we.exercise, sets: we.sets.filter((x) => x.type !== 'W').map((x) => ({ id: uuid(), weight: x.weight, reps: x.reps, completed: false })), ...(we.restTime ? { restTime: we.restTime } : {}), ...(we.notes ? { notes: we.notes } : {}) });
  const h = openModal({
    title: 'Update routine',
    html: `<p class="muted" style="font-size:14px;margin-bottom:14px">Choose a routine to receive the weights and reps from <b>${esc(s.name)}</b>. Exercises not in this workout are kept as they are.</p>
      <div class="list">${state.templates.map((t) => `<div class="list-item click" data-t="${t.id}"><div class="avatar-letter">${I.list}</div><div style="flex:1"><b>${esc(t.name)}</b><div class="muted" style="font-size:12.5px">${t.exercises.length} exercises${s.templateId === t.id ? ' · source routine' : ''}</div></div>${I.chevronRight}</div>`).join('')}
      <div class="list-item click" data-new><div class="avatar-letter on">${I.plus}</div><div style="flex:1"><b>New routine from this workout</b></div></div></div>`,
    onMount(h) {
      h.body.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-t],[data-new]'); if (!row) return;
        if (row.matches('[data-new]')) {
          const name = await prompt({ title: 'Routine name', value: s.name, confirmText: 'Create' });
          if (name === null) return;
          createTemplate({ name: name || s.name, exercises: s.exercises.map(toTemplateEx) }); toast('Routine created'); h.close(); return;
        }
        const t = state.templates.find((x) => x.id === row.dataset.t); if (!t) return;
        const byName = new Map(s.exercises.map((we) => [we.exercise.name.toLowerCase(), we]));
        const merged = t.exercises.map((te) => { const d = byName.get(te.exercise.name.toLowerCase()); if (!d) return te; byName.delete(te.exercise.name.toLowerCase()); return { ...toTemplateEx(d), id: te.id, restTime: te.restTime ?? d.restTime }; });
        for (const d of byName.values()) merged.push(toTemplateEx(d));
        updateTemplate(t.id, { exercises: merged, lastPerformed: Math.max(t.lastPerformed || 0, s.startTime) });
        toast(`Updated ${esc(t.name)}`); h.close();
      });
    },
  });
  return h;
}
