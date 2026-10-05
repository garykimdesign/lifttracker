// App entry: shell, routing, store subscription → view rendering, PWA bits.
import { I } from './icons.js';
import { state, subscribe, boot, applyTheme } from './store.js';
import * as home from './views/home.js';
import * as train from './views/train.js';
import * as library from './views/library.js';
import * as progress from './views/progress.js';
import { openSettings } from './views/settings.js';
import { renderWorkout, renderMiniBar, renderRest } from './views/workout.js';
import { onInstallChange } from './install.js';
import { closeAllModals } from './ui.js';

const VIEWS = { home, train, library, progress };
const TABS = [
  { id: 'home', label: 'Home', icon: I.home },
  { id: 'train', label: 'Train', icon: I.dumbbell },
  { id: 'library', label: 'Library', icon: I.list },
  { id: 'progress', label: 'Progress', icon: I.chart },
];

const app = document.getElementById('app');
app.innerHTML = `
  <div class="shell">
    <nav class="rail" aria-label="Primary">
      <div class="brand"><img src="icons/icon-192.png" alt="">LiftTracker</div>
      ${TABS.map((t) => `<a class="tab" href="#/${t.id}" data-tab="${t.id}"><span class="ico">${t.icon}</span><span>${t.label}</span></a>`).join('')}
      <div class="spacer"></div>
      <button class="tab" data-settings><span class="ico">${I.settings}</span><span>Settings</span></button>
    </nav>
    <main id="view" class="view" tabindex="-1"></main>
  </div>
  <nav class="tabbar" aria-label="Primary">${TABS.map((t) => `<a class="tab" href="#/${t.id}" data-tab="${t.id}"><span class="ico">${t.icon}</span><span>${t.label}</span></a>`).join('')}</nav>
  <div id="mini-root"></div>
  <div id="rest-root"></div>
  <div id="workout-root"></div>`;

const viewEl = document.getElementById('view');
const roots = { mini: document.getElementById('mini-root'), rest: document.getElementById('rest-root'), workout: document.getElementById('workout-root') };
app.querySelectorAll('[data-settings]').forEach((b) => (b.onclick = () => openSettings()));

// ---------- Routing ----------
const routeFromHash = () => { const r = location.hash.replace(/^#\/?/, '').split('/')[0]; return VIEWS[r] ? r : 'home'; };
export function navigate(route) { if (routeFromHash() === route) renderView(); else location.hash = `#/${route}`; }
const scrollMemo = {};
function renderView() {
  const prev = state.route;
  if (prev) scrollMemo[prev] = window.scrollY;
  const route = routeFromHash();
  state.route = route;
  document.querySelectorAll('[data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === route) || (a.dataset.tab === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  VIEWS[route].render(viewEl, { navigate });
  window.scrollTo({ top: prev === route ? window.scrollY : scrollMemo[route] || 0, behavior: 'instant' });
  document.title = route === 'home' ? 'LiftTracker' : `${TABS.find((t) => t.id === route).label} · LiftTracker`;
}
window.addEventListener('hashchange', () => { closeAllModals(); renderView(); });

// Same-route re-render without losing scroll (data changes).
let raf = 0;
const rerender = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const y = window.scrollY; VIEWS[state.route].render(viewEl, { navigate }); window.scrollTo({ top: y, behavior: 'instant' }); }); };

// ---------- Store → UI ----------
subscribe((reason, detail) => {
  if (detail?.silent) return;
  if (reason === 'rest' || reason === 'rest-tick') { renderRest(roots.rest, detail); if (reason === 'rest') renderMiniBar(roots.mini); return; }
  if (reason === 'active') { renderWorkout(roots.workout); renderMiniBar(roots.mini); if (!state.active) renderRest(roots.rest); }
  if (reason === 'boot') { renderView(); renderWorkout(roots.workout); renderMiniBar(roots.mini); return; }
  if (['templates', 'history', 'library', 'favorites', 'settings', 'profile', 'auth', 'cloud', 'bodyweight', 'active'].includes(reason)) rerender();
});
onInstallChange(rerender);

// ---------- Boot ----------
applyTheme();
boot().then(() => {
  const splash = document.getElementById('splash');
  if (splash) { splash.classList.add('out'); setTimeout(() => splash.remove(), 300); }
});

// Service worker (production + localhost). Skip on file:// to keep local previews simple.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)));
}

// Reduced motion
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) document.body.dataset.motion = 'reduce';

// Keyboard shortcuts: 1-4 switch tabs when not typing.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const i = ['1', '2', '3', '4'].indexOf(e.key);
  if (i >= 0 && !state.active) navigate(TABS[i].id);
});
