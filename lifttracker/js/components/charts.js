// Tiny inline-SVG charts: line (with PR dots), weekly bars, sparkline, calendar heatmap.
import { esc, fmtVol, startOfDay, addDays, dayKey } from '../utils.js';

const W = 600;

/** Line chart. pts: [{t, v, pr?}] ; opts: {h, unit, fmt} */
export function lineChart(pts, { h = 200, fmt = (v) => String(Math.round(v)), label = '' } = {}) {
  if (pts.length < 2) {
    return `<div class="empty" style="padding:28px 16px"><p style="margin:0">Log this exercise ${pts.length ? 'once more' : 'twice'} to see a trend.</p></div>`;
  }
  const padL = 44, padR = 16, padT = 16, padB = 28;
  const xs = pts.map((p) => p.t), ys = pts.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y1 - y0 || Math.max(1, y1 * 0.1);
  y0 = Math.max(0, y0 - span * 0.25); y1 = y1 + span * 0.25;
  const X = (t) => padL + ((t - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - y0) / (y1 - y0 || 1)) * (h - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${X(pts[pts.length - 1].t).toFixed(1)},${(h - padB).toFixed(1)} L${X(pts[0].t).toFixed(1)},${(h - padB).toFixed(1)} Z`;
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => { const v = y0 + ((y1 - y0) * i) / ticks; const y = Y(v); return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text x="${padL - 8}" y="${y + 3}" text-anchor="end" class="axis-t">${esc(fmt(v))}</text>`; }).join('');
  const dateLbl = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const xl = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]].filter((p, i, a) => a.indexOf(p) === i);
  const xlabels = xl.map((p, i) => `<text x="${X(p.t)}" y="${h - 8}" text-anchor="${i === 0 ? 'start' : i === xl.length - 1 ? 'end' : 'middle'}">${dateLbl(p.t)}</text>`).join('');
  const dots = pts.map((p) => `<circle class="dot ${p.pr ? 'pr' : ''}" cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${p.pr ? 5 : 3.5}"><title>${dateLbl(p.t)}: ${esc(fmt(p.v))}${p.pr ? ' · PR' : ''}</title></circle>`).join('');
  const last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}">
    <defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <g class="grid axis">${grid}</g>
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    ${dots}
    <text class="lbl" x="${Math.min(X(last.t), W - padR - 30)}" y="${Y(last.v) - 10}" text-anchor="end">${esc(fmt(last.v))}</text>
    <g class="axis">${xlabels}</g>
  </svg>`;
}

/** Weekly bars. data: [{t, volume, count}] */
export function barChart(data, { h = 160, key = 'volume', fmt = fmtVol } = {}) {
  const padL = 8, padR = 8, padT = 22, padB = 22;
  const max = Math.max(1, ...data.map((d) => d[key]));
  const n = data.length, gap = 6;
  const bw = (W - padL - padR - gap * (n - 1)) / n;
  const bars = data.map((d, i) => {
    const v = d[key]; const bh = Math.max(v > 0 ? 4 : 0, ((h - padT - padB) * v) / max);
    const x = padL + i * (bw + gap), y = h - padB - bh;
    const cls = i === n - 1 ? 'now' : v === 0 ? 'dim' : '';
    const label = new Date(d.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<rect class="bar ${cls}" x="${x.toFixed(1)}" y="${(v === 0 ? h - padB - 4 : y).toFixed(1)}" width="${bw.toFixed(1)}" height="${(v === 0 ? 4 : bh).toFixed(1)}"><title>Week of ${label}: ${fmt(v)} · ${d.count} workout${d.count === 1 ? '' : 's'}</title></rect>
      ${v > 0 && (i === n - 1 || v === max) ? `<text class="lbl" x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${fmt(v)}</text>` : ''}
      ${i % 4 === n % 4 || i === n - 1 ? `<text class="axis-t" x="${(x + bw / 2).toFixed(1)}" y="${h - 6}" text-anchor="middle" style="fill:var(--muted);font-size:10px;font-weight:700">${i === n - 1 ? 'Now' : new Date(d.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Weekly volume">${bars}</svg>`;
}

export function sparkline(values, { h = 36, w = 160 } = {}) {
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}"/></svg>`;
}

/** Calendar heatmap for the last `weeks` weeks. sessions: history list. */
export function heatmap(sessions, { weeks = 16, weekStartsMonday = true } = {}) {
  const counts = new Map();
  for (const s of sessions) counts.set(dayKey(s.startTime), (counts.get(dayKey(s.startTime)) || 0) + 1);
  const today = startOfDay(Date.now());
  const dow = new Date(today).getDay();
  const offset = weekStartsMonday ? (dow + 6) % 7 : dow;
  const start = addDays(today, -(weeks * 7 - 1) - (6 - offset) + 0);
  // Align start to week start
  const first = addDays(start, -(((new Date(start).getDay() + (weekStartsMonday ? 6 : 0)) % 7)));
  const cells = [];
  for (let t = first; t <= addDays(today, 6 - offset); t = addDays(t, 1)) {
    const c = counts.get(dayKey(t)) || 0;
    const future = t > today;
    const lvl = c === 0 ? '' : c === 1 ? 'l2' : 'l3';
    cells.push(`<div class="c ${future ? '' : lvl} ${t === today ? 'today' : ''}" style="${future ? 'opacity:.35' : ''}" title="${new Date(t).toLocaleDateString()}${c ? ` · ${c} workout${c > 1 ? 's' : ''}` : ''}"></div>`);
  }
  return `<div class="heat" aria-label="Workout calendar">${cells.join('')}</div>`;
}
