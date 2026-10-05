// Plate calculator: what to load on each side of the bar for a target weight.
import { I } from '../icons.js';
import { esc, fmtW, isNum } from '../utils.js';
import { openModal, numField, parseNum } from '../ui.js';
import { state, setSetting } from '../store.js';

const PLATES = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lbs: [45, 35, 25, 10, 5, 2.5] };
// Loosely follows competition colours; small plates are neutral.
const COLOR = { kg: { 25: '#d64545', 20: '#2f6fd6', 15: '#e2b007', 10: '#1f9d5b', 5: '#9aa39d', 2.5: '#5a615c', 1.25: '#3a403c' }, lbs: { 45: '#2f6fd6', 35: '#e2b007', 25: '#1f9d5b', 10: '#9aa39d', 5: '#5a615c', 2.5: '#3a403c' } };

export function barWeight(unit = state.settings.unit) { return unit === 'kg' ? state.settings.barWeightKg : state.settings.barWeightLb; }

/** → { perSide: [{w, n}], loaded, remainder } */
export function calcPlates(total, bar, unit) {
  const out = { perSide: [], loaded: bar, remainder: 0 };
  if (!isNum(total) || total <= bar) { out.remainder = Math.max(0, (total || 0) - bar); return out; }
  let side = (total - bar) / 2;
  for (const p of PLATES[unit]) {
    const n = Math.floor(side / p + 1e-9);
    if (n > 0) { out.perSide.push({ w: p, n }); side -= n * p; }
  }
  out.loaded = total - side * 2;
  out.remainder = Math.round(side * 2 * 100) / 100;
  return out;
}

function plateHtml(w, unit, max) {
  const idx = PLATES[unit].indexOf(w);
  const h = 96 - idx * 11;
  const width = w >= 10 ? 18 : 12;
  return `<div class="plate" style="height:${h}px;width:${width}px;background:${COLOR[unit][w]}" title="${w} ${unit}">${w >= 10 ? fmtW(w, unit) : ''}</div>`;
}

export function platesVisual(total, unit = state.settings.unit, bar = barWeight(unit)) {
  const r = calcPlates(total, bar, unit);
  const plates = r.perSide.flatMap(({ w, n }) => Array.from({ length: n }, () => plateHtml(w, unit)));
  return `
    <div class="plates" aria-label="Plates per side">
      <div class="bar" style="width:46px"></div><div class="sleeve"></div>${plates.join('') || '<div class="muted" style="font-size:12px;padding:0 8px;writing-mode:horizontal-tb">Just the bar</div>'}<div class="bar"></div>
    </div>
    <div class="plate-legend" style="margin-top:10px">
      ${r.perSide.map(({ w, n }) => `<span class="tag" style="display:inline-flex;align-items:center;gap:6px"><i style="width:10px;height:10px;border-radius:3px;background:${COLOR[unit][w]};display:inline-block"></i><b class="num">${n}×</b> ${fmtW(w, unit)}</span>`).join('')}
      ${r.remainder > 0 ? `<span class="tag" style="color:var(--warn)">${fmtW(r.remainder, unit)} ${unit} unloadable → ${fmtW(r.loaded, unit)}</span>` : ''}
    </div>`;
}

/** Opens the calculator sheet; optionally pre-filled with a weight. */
export function openPlates(weight = '') {
  const unit = state.settings.unit;
  let w = isNum(weight) ? weight : '';
  openModal({
    title: 'Plate calculator',
    html: `<div class="stack">
      <div class="grid-2">
        <div class="field"><label>Target (${unit})</label>${numField({ value: w, step: unit === 'kg' ? 2.5 : 5, attrs: 'data-w' })}</div>
        <div class="field"><label>Bar (${unit})</label>${numField({ value: barWeight(unit), step: unit === 'kg' ? 2.5 : 5, attrs: 'data-bar' })}</div>
      </div>
      <div data-vis>${platesVisual(w, unit)}</div>
      <p class="muted" style="font-size:12.5px">Per side, heaviest plates first. Change the bar weight here and it’s remembered.</p>
    </div>`,
    foot: `<button class="btn btn-lg btn-primary" data-close>Done</button>`,
    onMount(h) {
      const vis = h.body.querySelector('[data-vis]');
      const wIn = h.body.querySelector('[data-w]'), bIn = h.body.querySelector('[data-bar]');
      const update = () => {
        const bar = parseNum(bIn.value);
        if (isNum(bar) && bar !== barWeight(unit)) setSetting(unit === 'kg' ? 'barWeightKg' : 'barWeightLb', bar);
        vis.innerHTML = platesVisual(parseNum(wIn.value), unit, isNum(bar) ? bar : barWeight(unit));
      };
      h.body.addEventListener('input', update);
      setTimeout(() => { wIn.focus(); wIn.select(); }, 80);
    },
  });
}
