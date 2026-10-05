// UI primitives: modals / bottom sheets, confirm dialogs, toasts, popover menus, numeric steppers.
import { I } from './icons.js';
import { esc, haptic } from './utils.js';

const modalStack = [];

/**
 * Opens a modal/bottom-sheet. Returns a handle: { el, body, close(result), onClose }.
 * opts: { title, html, foot, full, onMount(handle), onClose(result), noHead }
 */
export function openModal(opts = {}) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `
    <div class="scrim" data-close></div>
    <div class="modal ${opts.full ? 'full' : ''}" role="dialog" aria-modal="true" ${opts.title ? `aria-label="${esc(opts.title)}"` : ''}>
      <div class="grabber"></div>
      ${opts.noHead ? '' : `<div class="modal-head"><h2>${esc(opts.title || '')}</h2><div class="row" data-head-actions>${opts.headActions || ''}<button class="btn btn-icon btn-ghost" data-close aria-label="Close">${I.x}</button></div></div>`}
      <div class="modal-body">${opts.html || ''}</div>
      ${opts.foot ? `<div class="modal-foot">${opts.foot}</div>` : ''}
    </div>`;
  document.body.appendChild(root);
  document.body.style.overflow = 'hidden';
  let resolved = false;
  const handle = {
    el: root,
    modal: root.querySelector('.modal'),
    body: root.querySelector('.modal-body'),
    foot: root.querySelector('.modal-foot'),
    result: undefined,
    close(result) {
      if (resolved) return; resolved = true;
      handle.result = result;
      root.style.animation = 'fade-in 140ms reverse forwards';
      setTimeout(() => { root.remove(); if (!modalStack.length) document.body.style.overflow = ''; }, 130);
      const i = modalStack.indexOf(handle); if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.style.overflow = '';
      opts.onClose?.(result);
    },
  };
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) handle.close(); });
  modalStack.push(handle);
  opts.onMount?.(handle);
  return handle;
}
export const closeTopModal = () => modalStack[modalStack.length - 1]?.close();
export const closeAllModals = () => { for (const h of [...modalStack].reverse()) h.close(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) { e.preventDefault(); closeTopModal(); } });

/** Promise-based confirm. opts: { title, text, confirmText, danger, icon } → boolean */
export function confirm(opts) {
  return new Promise((resolve) => {
    openModal({
      noHead: true,
      html: `<div class="confirm"><div class="ico ${opts.danger === false ? 'ok' : ''}">${opts.icon || I.alert}</div><h2>${esc(opts.title)}</h2>${opts.text ? `<p>${esc(opts.text)}</p>` : ''}</div>`,
      foot: `<button class="btn btn-lg" data-close>${esc(opts.cancelText || 'Cancel')}</button><button class="btn btn-lg ${opts.danger === false ? 'btn-primary' : 'btn-danger-solid'}" data-ok>${esc(opts.confirmText || 'Delete')}</button>`,
      onMount: (h) => { h.foot.querySelector('[data-ok]').onclick = () => h.close(true); setTimeout(() => h.foot.querySelector('[data-ok]').focus(), 50); },
      onClose: (r) => resolve(!!r),
    });
  });
}

/** Promise-based text prompt → string | null */
export function prompt(opts) {
  return new Promise((resolve) => {
    openModal({
      title: opts.title,
      html: `<div class="field"><label>${esc(opts.label || '')}</label><input class="input" data-in value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}" ${opts.type ? `type="${opts.type}" inputmode="decimal"` : ''}></div>${opts.hint ? `<p class="muted" style="font-size:13px;margin-top:10px">${esc(opts.hint)}</p>` : ''}`,
      foot: `<button class="btn btn-lg" data-close>Cancel</button><button class="btn btn-lg btn-primary" data-ok>${esc(opts.confirmText || 'Save')}</button>`,
      onMount: (h) => {
        const inp = h.body.querySelector('[data-in]');
        const ok = () => h.close(inp.value);
        h.foot.querySelector('[data-ok]').onclick = ok;
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
        setTimeout(() => { inp.focus(); inp.select(); }, 60);
      },
      onClose: (r) => resolve(r === undefined ? null : r),
    });
  });
}

// ---------- Toasts ----------
let toastRoot;
export function toast(message, { action, onAction, duration = 3200, kind = '' } = {}) {
  if (!toastRoot) { toastRoot = document.createElement('div'); toastRoot.className = 'toasts'; document.body.appendChild(toastRoot); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span>${message}</span>${action ? `<button class="btn">${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { onAction?.(); remove(); };
  toastRoot.appendChild(el);
  while (toastRoot.children.length > 3) toastRoot.firstChild.remove();
  let t = setTimeout(remove, duration);
  function remove() { clearTimeout(t); el.style.transition = 'opacity 160ms, transform 160ms'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 170); }
  return remove;
}

// ---------- Popover menu ----------
/** items: [{label, icon, danger, onClick}] anchored to `anchor` element. */
export function menu(anchor, items) {
  document.querySelector('.popmenu')?.remove();
  const m = document.createElement('div');
  m.className = 'popmenu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="divider"></div>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = Math.min(r.right - w, window.innerWidth - w - 8); left = Math.max(8, left);
  let top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
  m.style.left = `${left}px`; m.style.top = `${top}px`;
  const kill = () => { m.remove(); document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey, true); };
  const onDoc = (e) => { if (!m.contains(e.target)) kill(); };
  const onKey = (e) => { if (e.key === 'Escape') kill(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey, true); }, 0);
  m.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; kill(); items[+b.dataset.i]?.onClick?.(); });
}

// ---------- Numeric stepper ----------
/** Markup for a +/- numeric field. attrs are extra data-* attributes on the input. */
export function numField({ value = '', step = 1, min = 0, placeholder = '', compact = false, attrs = '', inputmode = 'decimal', cls = '' }) {
  return `<div class="numfield ${compact ? 'compact' : ''} ${cls}" data-step="${step}" data-min="${min}">
    <button type="button" tabindex="-1" data-nf="-" aria-label="Decrease">${I.minus}</button>
    <input type="text" inputmode="${inputmode}" autocomplete="off" enterkeyhint="next" value="${value === '' || value == null ? '' : esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>
    <button type="button" tabindex="-1" data-nf="+" aria-label="Increase">${I.plus}</button>
  </div>`;
}
/** Global handler for stepper buttons — dispatches an `input` event so views pick it up. */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-nf]'); if (!b) return;
  const nf = b.closest('.numfield'); const inp = nf.querySelector('input');
  const step = parseFloat(nf.dataset.step) || 1, min = parseFloat(nf.dataset.min) || 0;
  const cur = parseFloat(inp.value);
  let v = (Number.isFinite(cur) ? cur : (b.dataset.nf === '+' ? 0 : step)) + (b.dataset.nf === '+' ? step : -step);
  v = Math.max(min, Math.round(v * 100) / 100);
  inp.value = String(v);
  haptic(6);
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});
export const parseNum = (v) => { const s = String(v).trim().replace(',', '.'); if (s === '') return ''; const n = Number(s); return Number.isFinite(n) ? n : ''; };

// ---------- Misc ----------
export function flash(el, cls = 'error', ms = 400) { el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }
export const ringSvg = (pct, size = 46, stroke = 4) => {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${size} ${size}"><circle class="bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, pct)))}"/></svg>`;
};

// Popmenu styles (kept here so the component is self-contained)
const style = document.createElement('style');
style.textContent = `
.popmenu{position:fixed;z-index:300;min-width:200px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow-2);padding:6px;animation:pop-in 140ms var(--ease)}
.popmenu button{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border-radius:10px;font-weight:600;font-size:14px;text-align:left}
.popmenu button:hover{background:var(--surface-2)}
.popmenu button.danger{color:var(--danger)}
.popmenu button svg{width:18px;height:18px;flex:none;color:var(--muted)}
.popmenu button.danger svg{color:var(--danger)}
.popmenu .divider{margin:4px 6px}`;
document.head.appendChild(style);
