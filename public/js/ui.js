// Small DOM helpers. h() builds elements with textContent, so text typed by
// families is never interpreted as HTML.

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'multiple', 'hidden', 'indeterminate']);

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  appendChildren(el, children);
  return el;
}

export function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function toast(message, type = 'info', ms = 4000) {
  const el = h('div', { class: `toast ${type}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function modal({ title, content, actions = [], wide = false }) {
  const root = document.getElementById('modal-root');
  const previous = document.activeElement;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const buttons = actions.filter(Boolean).map((a) => h('button', {
    type: 'button', class: `btn ${a.class || ''}`,
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { if ((await a.onClick?.()) !== false) close(); } finally { btn.disabled = false; }
    },
  }, a.label));
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: wide ? { width: 'min(960px, 100%)' } : null },
    h('div', { class: 'row between' }, h('h2', {}, title),
      h('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Close', onclick: close }, '✕')),
    content,
    actions.length ? h('div', { class: 'modal-actions' }, buttons) : null);
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, dialog);
  root.append(backdrop);
  document.addEventListener('keydown', onKey);
  // First visible field, else the first action (e.g. Cancel), never a hidden file input.
  const firstVisible = (selector) => [...dialog.querySelectorAll(selector)].find((el) => !el.disabled && el.getClientRects().length);
  (firstVisible('input, select, textarea') || firstVisible('.modal-actions button') || firstVisible('button'))?.focus();
  return { close, dialog };
}

export function confirmDialog(message, { okLabel = 'Yes', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = modal({
      title: 'Please confirm',
      content: h('p', {}, message),
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, class: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.dialog)) { observer.disconnect(); if (!answered) resolve(false); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

// A <label> only wraps a single input; groups of buttons/checkboxes get a div so that
// clicking the label text doesn't press the first button inside.
export function field(label, control, hint) {
  const single = control instanceof HTMLElement && (control.matches('input, select, textarea') || control.classList.contains('input-with-mic'));
  return h(single ? 'label' : 'div', { class: 'field', role: single ? null : 'group', 'aria-label': single ? null : label },
    h('span', {}, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
}

export function segmented(options, value, onChange, cls = '') {
  const wrap = h('div', { class: `segmented ${cls}`, role: 'group' });
  const buttons = options.map(([v, label, title]) => h('button', {
    type: 'button', 'aria-pressed': String(v === value), title: title || null,
    onclick: () => { buttons.forEach((b) => b.setAttribute('aria-pressed', 'false')); btn(v).setAttribute('aria-pressed', 'true'); onChange(v); },
  }, label));
  const btn = (v) => buttons[options.findIndex((o) => o[0] === v)];
  wrap.append(...buttons);
  return wrap;
}

export function empty(emoji, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'big-emoji', 'aria-hidden': 'true' }, emoji), h('p', {}, text), action || null);
}

// ---------- dates ----------
export const DAY_MS = 86400000;

export function todayStr(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtDay(value, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return d.toLocaleDateString('en-IN', opts);
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function relTime(ms) {
  if (!ms) return 'never';
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function pct(x) {
  return x === null || x === undefined || Number.isNaN(x) ? '–' : `${Math.round(x * 100)}%`;
}

// Night hours get a neutral "Hello": "Good morning" at 3 am can tell someone with dementia it's time to get up.
export function isNight(date = new Date()) {
  const hr = date.getHours();
  return hr >= 21 || hr < 5;
}

export function greeting(date = new Date()) {
  const hr = date.getHours();
  if (isNight(date)) return 'Hello';
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

// ---------- per-browser preferences ----------
export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(`manas:${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(`manas:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
