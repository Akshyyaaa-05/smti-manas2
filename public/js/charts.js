// Minimal SVG line chart. No library, works offline.
const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * points: [{ label, y }] in time order (y may be null for a gap)
 * yMin/yMax: axis range; ticks: values to draw gridlines at
 */
export function lineChart({ points, yMin = 0, yMax, ticks, formatY = (v) => v, color = '#a4262c', title = 'Chart', width = 400, height = 170 }) {
  const pad = { l: 46, r: 12, t: 12, b: 28 };
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': title });
  const values = points.map((p) => p.y).filter((v) => v !== null && v !== undefined);
  if (!values.length) {
    svg.append(s('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: '#6b5d52', 'font-size': 16 }, 'No data yet'));
    return svg;
  }
  const top = yMax ?? Math.max(...values) * 1.15;
  const bottom = yMin ?? Math.min(...values);
  const span = top - bottom || 1;
  const x = (i) => pad.l + (points.length === 1 ? (width - pad.l - pad.r) / 2 : (i * (width - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (1 - (v - bottom) / span) * (height - pad.t - pad.b);

  for (const t of ticks || [bottom, bottom + span / 2, top]) {
    svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: y(t), y2: y(t), stroke: '#e6dccd', 'stroke-width': 1 }));
    svg.append(s('text', { x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end', fill: '#6b5d52', 'font-size': 14 }, formatY(t)));
  }
  const labelIdx = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  points.forEach((p, i) => {
    if (!labelIdx.has(i)) return;
    const anchor = points.length > 1 && i === 0 ? 'start' : points.length > 1 && i === points.length - 1 ? 'end' : 'middle';
    const xPos = anchor === 'start' ? x(i) - 4 : anchor === 'end' ? x(i) + 4 : x(i);
    svg.append(s('text', { x: xPos, y: height - 8, 'text-anchor': anchor, fill: '#6b5d52', 'font-size': 13 }, p.label));
  });

  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.y === null || p.y === undefined) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)} `;
    pen = true;
  });
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  points.forEach((p, i) => {
    if (p.y === null || p.y === undefined) return;
    const dot = s('circle', { cx: x(i), cy: y(p.y), r: 4.5, fill: '#fff', stroke: color, 'stroke-width': 2.5 });
    dot.append(s('title', {}, `${p.label}: ${formatY(p.y)}`));
    svg.append(dot);
  });
  return svg;
}
