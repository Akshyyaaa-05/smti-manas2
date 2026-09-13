import { api } from './api.js';
import { clear, h, load, save, toast } from './ui.js';
import { setVoiceStatus } from './voice.js';

const VIEWS = {
  home: () => import('./views/home.js'),
  me: () => import('./views/me.js'),
  dashboard: () => import('./views/dashboard.js'),
  patient: () => import('./views/patient.js'),
  care: () => import('./views/care.js'),
  family: () => import('./views/family.js'),
  cards: () => import('./views/cards.js'),
  games: () => import('./views/games.js'),
  sangi: () => import('./views/sangi.js'),
  settings: () => import('./views/settings.js'),
};

const NAV = {
  caregiver: [
    ['dashboard', '🏠', 'Dashboard'], ['patient', '🧓', 'Patient'], ['care', '📝', 'Daily care'],
    ['family', '👪', 'Family'], ['cards', '🃏', 'Cue cards'], ['games', '🎮', 'Games'],
    ['sangi', '💬', 'Sangi AI'], ['settings', '⚙️', 'Settings'],
  ],
  family: [
    ['family', '👪', 'Share memories'], ['cards', '🃏', 'Cue cards'], ['patient', '🧓', 'About'],
    ['sangi', '💬', 'Ask Sangi'], ['games', '🎮', 'Games'], ['settings', '⚙️', 'Settings'],
  ],
};
const HOME_FOR = { caregiver: 'dashboard', family: 'family', patient: 'me' };
const PATIENT_VIEWS = new Set(['me', 'cards', 'games', 'sangi']);
const NO_PATIENT_NEEDED = new Set(['home', 'patient', 'settings']);
export const LANGUAGES = [
  ['en', 'English'], ['as', 'অসমীয়া · Assamese'], ['bn', 'বাংলা · Bengali'], ['hi', 'हिन्दी · Hindi'],
  ['mni', 'মণিপুরী · Manipuri'], ['ne', 'नेपाली · Nepali'], ['or', 'ଓଡ଼ିଆ · Odia'],
];

export const ctx = {
  state: {
    role: load('role', null),
    patientId: load('patientId', null),
    language: load('language', 'en'),
    patients: [],
    status: {},
  },
  get patient() {
    return this.state.patients.find((p) => p.id === this.state.patientId) || null;
  },
  get isCaregiver() { return this.state.role === 'caregiver'; },
  navigate(path) {
    if (location.hash === `#/${path}`) route(); else location.hash = `#/${path}`;
  },
  async refreshPatients() {
    this.state.patients = await api.get('/api/patients');
    if (!this.patient) this.setPatient(this.state.patients[0]?.id ?? null);
  },
  async refreshStatus() {
    this.state.status = await api.get('/api/status');
    setVoiceStatus(this.state.status);
  },
  setRole(role) { this.state.role = role; save('role', role); },
  setPatient(id) { this.state.patientId = id; save('patientId', id); },
  setLanguage(lang) { this.state.language = lang; save('language', lang); },
  homePath() { return HOME_FOR[this.state.role] || 'home'; },
  rerender: () => route(),
};

function renderNav(active) {
  const nav = clear(document.getElementById('nav'));
  for (const [key, icon, label] of NAV[ctx.state.role] || []) {
    nav.append(h('a', { href: `#/${key}`, class: key === active ? 'active' : '', 'aria-current': key === active ? 'page' : null },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, icon), label));
  }
}

function holdToExitButton() {
  let timer = null;
  const fill = h('span', { class: 'fill' });
  const btn = h('button', { type: 'button', class: 'btn small hold-exit', title: 'Caregivers: press and hold to leave patient mode' }, fill, '🔒 Hold to exit');
  const cancel = () => { clearTimeout(timer); fill.style.transition = 'none'; fill.style.transform = 'scaleX(0)'; };
  const start = (e) => {
    e.preventDefault();
    fill.style.transition = 'transform 1.5s linear';
    fill.style.transform = 'scaleX(1)';
    timer = setTimeout(() => { ctx.setRole(null); ctx.navigate('home'); }, 1500);
  };
  btn.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, cancel));
  return btn;
}

function renderTopbar(view) {
  const tools = clear(document.getElementById('topbar-tools'));
  const { role, patients } = ctx.state;
  if (role === 'patient' && view !== 'home') {
    tools.append(holdToExitButton());
    return;
  }
  if (view === 'home' || !role) return;

  const langSelect = h('select', { 'aria-label': 'Language for voice and Sangi', style: { minHeight: '40px', width: 'auto' },
    onchange: (e) => ctx.setLanguage(e.target.value) },
  LANGUAGES.map(([v, label]) => h('option', { value: v, selected: v === ctx.state.language }, label)));
  tools.append(h('span', { class: 'small muted', 'aria-hidden': 'true' }, '🗣'), langSelect);

  if (patients.length > 1) {
    tools.append(h('select', { 'aria-label': 'Patient', style: { minHeight: '40px', width: 'auto' },
      onchange: (e) => { ctx.setPatient(e.target.value); route(); } },
    patients.map((p) => h('option', { value: p.id, selected: p.id === ctx.state.patientId }, p.name))));
  } else if (ctx.patient) {
    tools.append(h('span', { class: 'chip' }, ctx.patient.name));
  }
  tools.append(h('button', { type: 'button', class: 'btn small', onclick: () => { ctx.setRole(null); ctx.navigate('home'); } },
    `${role === 'caregiver' ? '🩺' : '👪'} ${role === 'caregiver' ? 'Caregiver' : 'Family'} · switch`));
}

let renderToken = 0;
let cleanup = null;

async function route() {
  const [requested = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const { role } = ctx.state;
  let view = VIEWS[requested] ? requested : 'home';
  if (!role && view !== 'settings') view = 'home';
  if (!ctx.patient && !NO_PATIENT_NEEDED.has(view)) view = 'home';
  if (role === 'patient' && !PATIENT_VIEWS.has(view)) view = ctx.patient ? 'me' : 'home';

  document.body.classList.toggle('patient-mode', role === 'patient' && view !== 'home');
  document.body.classList.toggle('no-nav', view === 'home' || !NAV[role]);
  renderNav(view);
  renderTopbar(view);

  const token = ++renderToken;
  const root = document.getElementById('view');
  cleanup?.();
  cleanup = null;
  const container = h('div');
  try {
    const mod = await VIEWS[view]();
    const result = await mod.render(container, ctx, params);
    if (token !== renderToken) { if (typeof result === 'function') result(); return; }
    if (typeof result === 'function') cleanup = result;
  } catch (e) {
    console.error(e);
    if (token !== renderToken) return;
    clear(container).append(h('div', { class: 'panel' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message),
      h('button', { class: 'btn', onclick: () => route() }, 'Try again')));
  }
  clear(root).append(container);
  window.scrollTo(0, 0);
  root.focus({ preventScroll: true });
}

async function boot() {
  try {
    await Promise.all([ctx.refreshStatus(), ctx.refreshPatients()]);
  } catch {
    toast('Could not reach the portal server. Is server.py running?', 'error', 10000);
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
