// Exercise picker sheet: search, muscle filters, favorites, multi-select, create custom.
import { I } from '../icons.js';
import { esc } from '../utils.js';
import { openModal, toast } from '../ui.js';
import { state, allExercises, muscleGroups, isFav, toggleFavorite, createCustomExercise, subscribe } from '../store.js';

const LIMIT = 120;

export function filterExercises({ q = '', muscle = null, favorites = false } = {}) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = allExercises();
  if (favorites) list = list.filter((e) => isFav(e.id));
  if (muscle) list = list.filter((e) => e.muscleGroup === muscle);
  if (terms.length) {
    list = list.filter((e) => { const hay = `${e.name} ${e.muscleGroup}`.toLowerCase(); return terms.every((t) => hay.includes(t)); });
    // Rank: name starts with query > word starts with > contains
    const q0 = terms[0];
    list.sort((a, b) => score(b, q0) - score(a, q0) || a.name.length - b.name.length);
  } else if (!favorites && !muscle) {
    // Default: favorites, then recently used, then classics (short names) first
    const recent = recentNames();
    list = [...list].sort((a, b) => (isFav(b.id) - isFav(a.id)) || ((recent.has(b.name) ? 1 : 0) - (recent.has(a.name) ? 1 : 0)) || (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || a.name.length - b.name.length);
  }
  return list;
}
function score(e, q) { const n = e.name.toLowerCase(); return n.startsWith(q) ? 3 : n.includes(` ${q}`) ? 2 : n.includes(q) ? 1 : 0; }
function recentNames() {
  const s = new Set();
  for (const h of state.history.slice(0, 15)) for (const we of h.exercises || []) if (we?.exercise?.name) s.add(we.exercise.name);
  return s;
}

export function exerciseRow(e, { selected = false, showStar = true, showTile = true } = {}) {
  const fav = isFav(e.id);
  return `<div class="picker-item" data-ex="${esc(e.id)}" role="option" aria-selected="${selected}">
    ${showTile ? `<div class="avatar-letter ${selected ? 'on' : ''}">${selected ? I.check : esc(e.name.charAt(0))}</div>` : ''}
    <div class="t"><h4>${esc(e.name)}</h4><p>${esc(e.muscleGroup)}${e.custom ? ' · Custom' : ''}</p></div>
    ${showStar ? `<button class="star ${fav ? 'on' : ''}" data-star="${esc(e.id)}" aria-label="${fav ? 'Unfavorite' : 'Favorite'}">${fav ? I.starFill : I.star}</button>` : ''}
  </div>`;
}

export function filterBarHtml({ q = '', muscle = null, favorites = false, groups = muscleGroups() }) {
  return `
    <div class="row" style="gap:8px">
      <div class="search" style="flex:1">${I.search}<input class="input" data-q placeholder="Search ${allExercises().length.toLocaleString()} exercises" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
        <button class="btn btn-icon btn-sm btn-ghost clear ${q ? '' : 'hidden'}" data-clear aria-label="Clear">${I.x}</button></div>
      <button class="btn btn-icon" data-new title="Create custom exercise">${I.plus}</button>
    </div>
    <div class="chips scroll-x" style="margin-top:10px">
      <button class="chip chip-accent ${favorites ? 'on' : ''}" data-fav>${favorites ? I.starFill : I.star} Favorites</button>
      <button class="chip ${!muscle ? 'on' : ''}" data-muscle="">All</button>
      ${groups.map((m) => `<button class="chip ${muscle === m ? 'on' : ''}" data-muscle="${esc(m)}">${esc(m)}</button>`).join('')}
    </div>`;
}

/**
 * Opens the picker. opts: { title, multi, exclude: Set<name>, onPick(list) }
 */
export function openPicker(opts = {}) {
  const sel = new Map();
  const f = { q: '', muscle: null, favorites: false };
  let unsub = null;
  const h = openModal({
    title: opts.title || 'Add exercise',
    full: true,
    headActions: opts.multi !== false ? `<button class="btn btn-primary btn-sm hidden" data-add>Add</button>` : '',
    html: `<div data-bar></div><div class="picker-list" data-list role="listbox"></div>`,
    onMount(h) {
      const bar = h.body.querySelector('[data-bar]'), list = h.body.querySelector('[data-list]');
      const addBtn = h.el.querySelector('[data-add]');
      const renderBar = () => { bar.innerHTML = filterBarHtml(f); bar.querySelector('[data-q]').focus({ preventScroll: true }); };
      const renderList = () => {
        const all = filterExercises(f);
        const shown = all.slice(0, LIMIT);
        const groups = new Map();
        const grouped = !f.q && !f.favorites;
        for (const e of shown) { const g = grouped ? e.muscleGroup : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
        list.innerHTML = shown.length ? [...groups.entries()].map(([g, items]) => `${g ? `<div class="picker-group eyebrow">${esc(g)}</div>` : ''}${items.map((e) => exerciseRow(e, { selected: sel.has(e.id) })).join('')}`).join('') +
          (all.length > LIMIT ? `<p class="muted" style="text-align:center;padding:14px;font-size:13px">Showing ${LIMIT} of ${all.length.toLocaleString()} — refine your search</p>` : '')
          : `<div class="empty"><div class="ico">${I.search}</div><h3>No matches</h3><p>Try a different spelling, or create “${esc(f.q)}” as a custom exercise.</p>${f.q ? `<button class="btn btn-primary" data-create-q>${I.plus} Create “${esc(f.q.slice(0, 30))}”</button>` : ''}</div>`;
        if (addBtn) { addBtn.classList.toggle('hidden', sel.size === 0); addBtn.textContent = `Add ${sel.size}`; }
      };
      renderBar(); renderList();
      unsub = subscribe((r) => { if (r === 'library' || r === 'favorites') renderList(); });

      bar.addEventListener('input', (e) => {
        if (e.target.matches('[data-q]')) { f.q = e.target.value; bar.querySelector('[data-clear]').classList.toggle('hidden', !f.q); renderList(); }
      });
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.matches('[data-clear]')) { f.q = ''; renderBar(); renderList(); }
        else if (b.matches('[data-fav]')) { f.favorites = !f.favorites; renderBar(); renderList(); }
        else if (b.matches('[data-muscle]')) { f.muscle = b.dataset.muscle || null; renderBar(); renderList(); }
        else if (b.matches('[data-new]')) openCreateExercise({ muscle: f.muscle, name: f.q }).then((ex) => { if (ex) pick(ex); });
      });
      list.addEventListener('click', (e) => {
        const star = e.target.closest('[data-star]');
        if (star) { e.stopPropagation(); const on = toggleFavorite(star.dataset.star); star.classList.toggle('on', on); star.innerHTML = on ? I.starFill : I.star; return; }
        if (e.target.closest('[data-create-q]')) { openCreateExercise({ muscle: f.muscle, name: f.q }).then((ex) => { if (ex) pick(ex); }); return; }
        const row = e.target.closest('[data-ex]'); if (!row) return;
        const ex = allExercises().find((x) => x.id === row.dataset.ex); if (!ex) return;
        pick(ex);
      });
      function pick(ex) {
        if (opts.multi === false) { h.close([ex]); return; }
        if (sel.has(ex.id)) sel.delete(ex.id); else sel.set(ex.id, ex);
        renderList();
      }
      addBtn?.addEventListener('click', () => h.close([...sel.values()]));
      bar.querySelector('[data-q]').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = list.querySelector('[data-ex]'); if (first && opts.multi === false) first.click(); }
      });
    },
    onClose(list) { unsub?.(); if (Array.isArray(list) && list.length) opts.onPick?.(list); },
  });
  return h;
}

/** Create-custom-exercise dialog → Promise<exercise|null> */
export function openCreateExercise({ name = '', muscle = '' } = {}) {
  return new Promise((resolve) => {
    const groups = muscleGroups();
    openModal({
      title: 'New exercise',
      html: `<div class="stack">
        <div class="field"><label>Name</label><input class="input" data-name placeholder="e.g. Incline Bench Press" value="${esc(name)}"></div>
        <div class="field"><label>Muscle group</label><input class="input" data-muscle list="mg-list" placeholder="e.g. Chest" value="${esc(muscle || '')}"><datalist id="mg-list">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="chips scroll-x">${groups.slice(0, 10).map((g) => `<button class="chip" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
      </div>`,
      foot: `<button class="btn btn-lg" data-close>Cancel</button><button class="btn btn-lg btn-primary" data-ok>Create</button>`,
      onMount(h) {
        const nameIn = h.body.querySelector('[data-name]'), musIn = h.body.querySelector('[data-muscle]');
        h.body.addEventListener('click', (e) => { const g = e.target.closest('[data-g]'); if (g) { musIn.value = g.dataset.g; } });
        const ok = async () => {
          const n = nameIn.value.trim();
          if (!n) { nameIn.focus(); return; }
          if (allExercises().some((x) => x.name.toLowerCase() === n.toLowerCase())) { toast('That exercise already exists'); return; }
          const ex = await createCustomExercise(n, musIn.value.trim() || 'Other');
          toast(`Created ${esc(ex.name)}`);
          h.close(ex);
        };
        h.foot.querySelector('[data-ok]').onclick = ok;
        h.body.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
        setTimeout(() => (name ? musIn : nameIn).focus(), 60);
      },
      onClose: (r) => resolve(r || null),
    });
  });
}
