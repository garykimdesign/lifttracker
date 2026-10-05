// Home: greeting, weekly goal ring, headline stats, quick start and recent activity.
import { I } from '../icons.js';
import { esc, fmtVol, fmtDuration, fmtDate, timeAgo, greeting } from '../utils.js';
import { ringSvg } from '../ui.js';
import { state, weekStats, displayName, photoUrl, startWorkout, maximizeWorkout, sessionSets } from '../store.js';
import { openSessionDetail } from '../components/session-detail.js';
import { openSettings } from './settings.js';
import { installState, promptInstall } from '../install.js';

const DOW = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'narrow' });

export function render(root, { navigate }) {
  const ws = weekStats();
  const unit = state.settings.unit;
  const name = displayName();
  const photo = photoUrl();
  const recent = state.history.slice(0, 5);
  // Suggest the routine that hasn't been done for the longest.
  const next = [...state.templates].sort((a, b) => (a.lastPerformed || 0) - (b.lastPerformed || 0))[0];
  const pct = Math.min(1, ws.count / Math.max(1, ws.goal));
  const delta = (cur, prev, fmt = (v) => v) => prev === 0 && cur === 0 ? '' : cur === prev ? `<div class="delta down">=<span>same as last week</span></div>` : `<div class="delta ${cur < prev ? 'down' : ''}">${cur > prev ? '↑' : '↓'}${fmt(Math.abs(cur - prev))}<span>vs last week</span></div>`;

  root.innerHTML = `
    <div class="view-head">
      <div><div class="kicker">${greeting()}</div><h1>${esc(name)}</h1></div>
      <button class="avatar" data-settings aria-label="Settings">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : esc(name.charAt(0).toUpperCase())}</button>
    </div>
    ${installState.canInstall ? `<div class="install"><img src="icons/icon-192.png" alt=""><div class="t"><b>Install LiftTracker</b>Full-screen, offline, on your home screen.</div><button class="btn btn-sm btn-primary" data-install>Install</button></div>` : ''}

    <div class="card card-pad" style="display:flex;align-items:center;gap:18px">
      <div class="ring-goal">${ringSvg(pct, 64, 6)}<div class="t">${ws.count}/${ws.goal}</div></div>
      <div style="flex:1;min-width:0">
        <h3>${ws.count >= ws.goal ? 'Weekly goal hit' : ws.count === 0 ? 'Fresh week' : `${ws.goal - ws.count} more to hit your goal`}</h3>
        <p class="muted" style="font-size:13px;margin-top:2px">${ws.streak ? `${ws.streak}-week streak${ws.streak >= 4 ? ' 🔥' : ''}` : 'Start a streak this week'}</p>
        <div class="row" style="gap:6px;margin-top:10px">${ws.days.map((d) => `<div title="${fmtDate(d.t)}" style="flex:1;text-align:center"><div style="height:8px;border-radius:99px;background:${d.done ? 'var(--accent)' : 'var(--surface-3)'};opacity:${d.future ? 0.45 : 1}"></div><div class="muted" style="font-size:10px;font-weight:800;margin-top:4px">${DOW(d.t)}</div></div>`).join('')}</div>
      </div>
    </div>

    <div class="grid-3" style="margin-top:12px">
      <div class="card stat"><div class="val num">${ws.count}</div><div class="lbl">Workouts</div>${delta(ws.count, ws.lastCount)}</div>
      <div class="card stat"><div class="val num">${fmtVol(ws.volume)}</div><div class="lbl">Volume · ${unit}</div>${delta(ws.volume, ws.lastVolume, fmtVol)}</div>
      <div class="card stat"><div class="val num">${ws.prs30}</div><div class="lbl">PRs · 30d</div></div>
    </div>

    <div class="section">
      <div class="section-head"><h2>Start</h2><button class="link" data-nav="train">All routines</button></div>
      ${state.active ? `<div class="card card-pad card-click" data-resume style="border-color:var(--accent);display:flex;align-items:center;gap:14px"><div class="avatar-letter on">${I.play}</div><div style="flex:1"><b>Resume ${esc(state.active.name)}</b><div class="muted" style="font-size:12.5px">Started ${timeAgo(state.active.startTime)} · ${state.active.exercises.length} exercises</div></div>${I.chevronRight}</div>`
      : `<div class="grid-2">
          ${next ? `<button class="card card-pad card-click" data-start="${next.id}" style="text-align:left;display:flex;flex-direction:column;gap:10px;background:var(--accent);color:var(--on-accent);border:0"><div class="kicker" style="color:inherit;opacity:.8">Up next</div><h3 style="font-size:18px">${esc(next.name)}</h3><div style="font-size:12.5px;opacity:.85">${next.exercises.length} exercises · ${next.lastPerformed ? `last ${timeAgo(next.lastPerformed)}` : 'never done'}</div><div class="row" style="margin-top:auto;font-weight:800;font-size:13px">${I.play} Start</div></button>` : ''}
          <button class="card card-pad card-click" data-empty style="text-align:left;display:flex;flex-direction:column;gap:10px"><div class="kicker">Freestyle</div><h3 style="font-size:18px">Empty workout</h3><div class="muted" style="font-size:12.5px">Add exercises as you go</div><div class="row" style="margin-top:auto;font-weight:800;font-size:13px;color:var(--accent-strong)">${I.plus} Begin</div></button>
        </div>`}
    </div>

    <div class="section">
      <div class="section-head"><h2>Recent</h2>${state.history.length > 5 ? '<button class="link" data-nav="progress">History</button>' : ''}</div>
      ${recent.length ? `<div class="card" style="padding:4px 14px">${recent.map((s) => `<div class="list-item click" data-session="${s.id}">
          <div class="date-tile"><span class="m">${new Date(s.startTime).toLocaleDateString(undefined, { month: 'short' })}</span><span class="d">${new Date(s.startTime).getDate()}</span></div>
          <div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</b><div class="meta" style="margin-top:3px"><span>${fmtDuration((s.endTime || s.startTime) - s.startTime, { long: true })}</span><span>${fmtVol(s.volume || 0)} ${s.unit || unit}</span><span>${sessionSets(s)} sets</span>${s.records ? `<span class="pr">${I.trophy}${s.records}</span>` : ''}</div></div>
          ${I.chevronRight}</div>`).join('')}</div>`
      : `<div class="empty"><div class="ico">${I.dumbbell}</div><h3>No workouts yet</h3><p>Start a routine above — your history, volume and records will build up here.</p></div>`}
    </div>`;

  root.onclick = (e) => {
    const t = e.target.closest('[data-settings],[data-install],[data-nav],[data-start],[data-empty],[data-resume],[data-session]');
    if (!t) return;
    if (t.dataset.settings !== undefined) openSettings();
    else if (t.dataset.install !== undefined) promptInstall();
    else if (t.dataset.nav) navigate(t.dataset.nav);
    else if (t.dataset.start) { const tpl = state.templates.find((x) => x.id === t.dataset.start); if (tpl) startWorkout(tpl); }
    else if (t.dataset.empty !== undefined) startWorkout(null);
    else if (t.dataset.resume !== undefined) maximizeWorkout();
    else if (t.dataset.session) openSessionDetail(t.dataset.session);
  };
}
