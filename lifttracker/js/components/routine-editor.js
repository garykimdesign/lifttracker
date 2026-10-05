// Routine editor: build or edit a template (name, exercises, target sets, rest, notes).
// Autosaves a local draft so an accidental close/refresh never loses work.
import { I } from '../icons.js';
import { esc, uuid, isNum, timeAgo } from '../utils.js';
import { openModal, confirm, toast, menu, numField, parseNum } from '../ui.js';
import { openPicker } from './picker.js';
import { state, createTemplate, updateTemplate, getDraft, saveDraft, clearDraft, prevPerformance } from '../store.js';

const REST = [[0, 'Off'], [30, '30s'], [45, '45s'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [150, '2:30'], [180, '3:00'], [240, '4:00'], [300, '5:00']];
const blankSet = () => ({ id: uuid(), weight: '', reps: '' });
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * opts: { template (edit) | initialExercises, name } → resolves when closed.
 */
export function openRoutineEditor(opts = {}) {
  const editing = !!opts.template;
  let d = editing
    ? { templateId: opts.template.id, name: opts.template.name, exercises: clone(opts.template.exercises) }
    : { templateId: null, name: opts.name || '', exercises: clone(opts.initialExercises || []) };
  const draft = getDraft();
  const resumable = draft && draft.templateId === d.templateId && draft.exercises?.length && !opts.initialExercises;
  let dirty = false;
  const unit = state.settings.unit;
  const persist = () => { dirty = true; saveDraft({ ...d, t: Date.now() }); };

  const h = openModal({
    title: editing ? 'Edit routine' : 'New routine',
    full: true,
    headActions: `<button class="btn btn-primary btn-sm" data-save>Save</button>`,
    html: `<div data-body></div>`,
    onMount(h) {
      const body = h.body.querySelector('[data-body]');
      const render = () => {
        body.innerHTML = `
          ${resumable && !dirty ? `<div class="install" style="margin-bottom:14px"><div class="t"><b>Unsaved draft</b>From ${timeAgo(draft.t)} · ${draft.exercises.length} exercise${draft.exercises.length === 1 ? '' : 's'}</div><button class="btn btn-sm" data-discard-draft>Discard</button><button class="btn btn-sm btn-primary" data-resume>Resume</button></div>` : ''}
          <input class="title-input" data-name placeholder="Routine name" value="${esc(d.name)}" maxlength="80">
          <div class="muted" style="font-size:12.5px;margin:6px 0 18px">${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'} · ${d.exercises.reduce((a, e) => a + e.sets.length, 0)} sets · weights in ${unit}</div>
          <div class="stack" data-list>${d.exercises.map((we, i) => exHtml(we, i)).join('')}</div>
          <button class="btn btn-lg btn-block ${d.exercises.length ? '' : 'btn-primary'}" data-add style="margin-top:14px">${I.plus} Add exercises</button>
          ${d.exercises.length ? '' : `<p class="muted" style="text-align:center;font-size:13px;margin-top:14px">Tip: sets you enter here become the targets pre-filled when you start this routine.</p>`}`;
      };
      const exHtml = (we, i) => {
        const prev = prevPerformance(we.exercise.name);
        return `<div class="ex-card" data-we="${we.id}">
          <div class="ex-head">
            <div style="flex:1;min-width:0"><h3>${esc(we.exercise.name)}</h3><div class="sub"><span>${esc(we.exercise.muscleGroup)}</span>${prev ? `<span>· last ${prev.sets.filter((s) => s.type !== 'W').map((s) => `${s.weight}×${s.reps}`).slice(0, 4).join(', ')}</span>` : ''}</div></div>
            <div class="ex-menu"><button class="btn btn-icon btn-ghost btn-sm" data-up ${i === 0 ? 'disabled' : ''} aria-label="Move up">${I.chevronUp}</button><button class="btn btn-icon btn-ghost btn-sm" data-down ${i === d.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">${I.chevronDown}</button><button class="btn btn-icon btn-ghost btn-sm" data-menu aria-label="More">${I.moreH}</button></div>
          </div>
          <div class="set-grid header" style="grid-template-columns:44px 1fr 1fr 30px"><span>Set</span><span>${unit}</span><span>Reps</span><span></span></div>
          ${we.sets.map((s, j) => `<div class="set-row" data-set="${s.id}"><div class="set-grid" style="grid-template-columns:44px 1fr 1fr 30px"><div class="set-no">${j + 1}</div>${numField({ value: s.weight, compact: true, attrs: `data-f="weight"`, placeholder: '—' })}${numField({ value: s.reps, compact: true, inputmode: 'numeric', attrs: `data-f="reps"`, placeholder: '—' })}<button class="set-del" data-del aria-label="Remove set">${I.x}</button></div></div>`).join('')}
          <div class="ex-foot">
            <button class="btn btn-sm" data-addset>${I.plus} Add set</button>
            <label class="btn btn-sm" style="gap:6px;position:relative">${I.timer} Rest <select data-rest style="position:absolute;inset:0;opacity:0;width:100%">${REST.map(([v, l]) => `<option value="${v}" ${(isNum(we.restTime) ? we.restTime : -1) === v ? 'selected' : ''}>${l}</option>`).join('')}<option value="" ${!isNum(we.restTime) ? 'selected' : ''}>Default</option></select><span class="num">${isNum(we.restTime) ? (REST.find(([v]) => v === we.restTime)?.[1] || `${we.restTime}s`) : 'Default'}</span></label>
            <button class="btn btn-sm ${we.notes !== undefined ? 'hidden' : ''}" data-notes>${I.note} Notes</button>
          </div>
          <div class="ex-notes ${we.notes !== undefined ? '' : 'hidden'}"><textarea class="textarea" data-notes-in placeholder="Cues, tempo, machine settings…">${esc(we.notes || '')}</textarea></div>
        </div>`;
      };
      render();
      setTimeout(() => { if (!d.name && !d.exercises.length) body.querySelector('[data-name]')?.focus(); }, 120);

      const find = (el) => { const card = el.closest('[data-we]'); const we = d.exercises.find((x) => x.id === card?.dataset.we); const row = el.closest('[data-set]'); const set = we?.sets.find((s) => s.id === row?.dataset.set); return { we, set, card, idx: d.exercises.indexOf(we) }; };

      body.addEventListener('input', (e) => {
        const t = e.target;
        if (t.matches('[data-name]')) { d.name = t.value; persist(); return; }
        const { we, set } = find(t);
        if (!we) return;
        if (set && t.dataset.f) { set[t.dataset.f] = parseNum(t.value); persist(); }
        else if (t.matches('[data-notes-in]')) { we.notes = t.value; persist(); }
      });
      body.addEventListener('change', (e) => {
        if (e.target.matches('[data-rest]')) { const { we } = find(e.target); const v = e.target.value; if (v === '') delete we.restTime; else we.restTime = Number(v); persist(); render(); }
      });
      body.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.matches('[data-add]')) return openPicker({ title: 'Add to routine', onPick: (list) => { for (const ex of list) d.exercises.push({ id: uuid(), exercise: { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup }, sets: defaultSets(ex.name) }); persist(); render(); } });
        if (b.matches('[data-resume]')) { d = { templateId: draft.templateId, name: draft.name, exercises: draft.exercises }; dirty = true; render(); return; }
        if (b.matches('[data-discard-draft]')) { clearDraft(); dirty = true; render(); return; }
        const { we, set, idx } = find(b);
        if (!we) return;
        if (b.matches('[data-addset]')) { const last = we.sets[we.sets.length - 1]; we.sets.push({ id: uuid(), weight: last?.weight ?? '', reps: last?.reps ?? '' }); persist(); render(); }
        else if (b.matches('[data-del]') && set) { if (we.sets.length > 1) { we.sets = we.sets.filter((s) => s !== set); persist(); render(); } }
        else if (b.matches('[data-up]') || b.matches('[data-down]')) { const j = idx + (b.matches('[data-up]') ? -1 : 1); if (j < 0 || j >= d.exercises.length) return; [d.exercises[idx], d.exercises[j]] = [d.exercises[j], d.exercises[idx]]; persist(); render(); }
        else if (b.matches('[data-notes]')) { we.notes = ''; render(); setTimeout(() => body.querySelector(`[data-we="${we.id}"] [data-notes-in]`)?.focus(), 30); }
        else if (b.matches('[data-menu]')) menu(b, [
          { label: 'Replace exercise', icon: I.swap, onClick: () => openPicker({ title: 'Replace with', multi: false, onPick: ([ex]) => { we.exercise = { id: ex.id, name: ex.name, muscleGroup: ex.muscleGroup }; persist(); render(); } }) },
          { label: 'Remove notes', icon: I.note, onClick: () => { delete we.notes; persist(); render(); } },
          '-',
          { label: 'Remove exercise', icon: I.trash, danger: true, onClick: () => { d.exercises = d.exercises.filter((x) => x !== we); persist(); render(); } },
        ]);
      });

      h.el.querySelector('[data-save]').onclick = () => {
        const name = (d.name || '').trim();
        if (!name) { toast('Give your routine a name'); body.querySelector('[data-name]').focus(); return; }
        if (!d.exercises.length) { toast('Add at least one exercise'); return; }
        const payload = { name, exercises: d.exercises.map((we) => ({ ...we, notes: (we.notes || '').trim() || undefined })) };
        if (editing) updateTemplate(opts.template.id, payload); else createTemplate(payload);
        clearDraft(); dirty = false;
        toast(editing ? 'Routine updated' : 'Routine created');
        h.close('saved');
      };
    },
    async onClose(r) {
      if (r === 'saved') return;
      if (dirty) toast('Draft kept — reopen the editor to resume', { duration: 2600 });
    },
  });
  return h;
}

function defaultSets(name) {
  const prev = prevPerformance(name);
  const w = prev ? prev.sets.filter((s) => s.type !== 'W').slice(0, 5) : [];
  return (w.length ? w : [1, 2, 3]).map((s) => ({ id: uuid(), weight: isNum(s.weight) ? s.weight : '', reps: isNum(s.reps) ? s.reps : '' }));
}
