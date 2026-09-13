import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { DAY_MS, fmtDay, greeting, h, pct, relTime, todayStr } from '../ui.js';

export const MOOD = { 1: '😢', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function tile(label, value, sub) {
  return h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), h('div', { class: 'sub' }, sub));
}

export function buildAlerts(patient, checkins, sessions, memories) {
  const alerts = [];
  const today = todayStr();
  const weekAgo = todayStr(Date.now() - 6 * DAY_MS);
  const recent = checkins.filter((c) => c.date >= weekAgo);
  const meds = (patient.medications || []).map((m) => m.name).filter(Boolean);

  if (!checkins.some((c) => c.date === today)) {
    alerts.push({ level: 'amber', icon: '📝', text: "Today's check-in hasn't been filled in yet.", link: ['care', 'Fill it in'] });
  }
  for (const c of recent) {
    const missed = meds.filter((m) => !(c.medsTaken || []).includes(m));
    if (missed.length) alerts.push({ level: 'red', icon: '💊', text: `Missed ${missed.join(', ')} on ${fmtDay(c.date)}.` });
    if (c.fall) alerts.push({ level: 'red', icon: '⚠️', text: `A fall was reported on ${fmtDay(c.date)}. Make sure a doctor knows.` });
    if (c.wandering) alerts.push({ level: 'red', icon: '🚪', text: `Wandering was reported on ${fmtDay(c.date)}.`, link: ['sangi', 'Safety tips'] });
  }
  const agitated = recent.filter((c) => c.agitation).length;
  if (agitated >= 3) {
    alerts.push({ level: 'amber', icon: '🌆', text: `Restless or agitated on ${agitated} of the last 7 days.`, link: ['sangi', 'Ask Sangi for ideas'] });
  }
  const lastTwo = [...checkins].sort((a, b) => a.date.localeCompare(b.date)).slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((c) => c.mood <= 2)) {
    alerts.push({ level: 'amber', icon: '💭', text: 'Low mood on the last two check-ins.' });
  }
  const sleep = avg(recent.map((c) => Number(c.sleepHours)).filter((x) => x > 0));
  if (sleep !== null && sleep < 5.5) alerts.push({ level: 'amber', icon: '🌙', text: `Sleeping about ${sleep.toFixed(1)} hours a night this week.` });

  const lastGame = Math.max(0, ...sessions.map((s) => s.startedAt || 0));
  const idleDays = lastGame ? Math.floor((Date.now() - lastGame) / DAY_MS) : null;
  if (idleDays === null) alerts.push({ level: 'amber', icon: '🎮', text: 'No games played yet.', link: ['games', 'Open games'] });
  else if (idleDays >= 4) alerts.push({ level: 'amber', icon: '🎮', text: `No game played for ${idleDays} days.`, link: ['games', 'Open games'] });

  const waiting = memories.filter((m) => !m.cardId).length;
  if (waiting) alerts.push({ level: 'green', icon: '🖼️', text: `${waiting} family ${waiting === 1 ? 'memory is' : 'memories are'} waiting to become cue cards.`, link: ['family', 'Review'] });
  return alerts;
}

export async function render(root, ctx) {
  const patient = ctx.patient;
  const q = `?patientId=${patient.id}`;
  const [checkins, sessions, cards, memories] = await Promise.all([
    api.get(`/api/checkins${q}`), api.get(`/api/sessions${q}`), api.get(`/api/cards${q}`), api.get(`/api/memories${q}`),
  ]);
  const name = patient.preferredName || patient.name;
  const weekAgo = todayStr(Date.now() - 6 * DAY_MS);
  const recent = checkins.filter((c) => c.date >= weekAgo);
  const meds = (patient.medications || []).map((m) => m.name).filter(Boolean);

  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, `${greeting()}`), h('p', {}, `Here is how ${name} is doing this week.`)),
    patient.demo ? h('span', { class: 'chip gold' }, 'Demo data · fictional') : null));

  const mood = avg(recent.map((c) => c.mood).filter(Boolean));
  const sleep = avg(recent.map((c) => Number(c.sleepHours)).filter((x) => x > 0));
  const expected = recent.length * meds.length;
  const taken = recent.reduce((n, c) => n + (c.medsTaken || []).filter((m) => meds.includes(m)).length, 0);
  const weekSessions = sessions.filter((s) => s.startedAt >= Date.now() - 7 * DAY_MS);
  const accuracy = avg(weekSessions.map((s) => s.accuracy).filter((x) => x !== null && x !== undefined));
  const shown = cards.reduce((n, c) => n + (c.stats?.shown || 0), 0);
  const remembered = cards.reduce((n, c) => n + (c.stats?.remembered || 0), 0);

  root.append(h('div', { class: 'grid tiles' },
    tile('Mood (7 days)', mood ? `${MOOD[Math.round(mood)]} ${mood.toFixed(1)}` : '–', `${recent.length} check-ins`),
    tile('Sleep', sleep ? `${sleep.toFixed(1)} h` : '–', 'average per night'),
    tile('Medicines', expected ? pct(taken / expected) : '–', meds.length ? 'doses ticked this week' : 'none on record'),
    tile('Games', String(weekSessions.length), accuracy !== null ? `${pct(accuracy)} accuracy this week` : 'sessions this week'),
    tile('Cue cards', shown ? pct(remembered / shown) : '–', `${cards.length} cards · recognised when practised`)));

  const alerts = buildAlerts(patient, checkins, sessions, memories);
  const alertList = h('ul', { class: 'alerts' }, alerts.length
    ? alerts.map((a) => h('li', { class: a.level }, h('span', { 'aria-hidden': 'true' }, a.icon),
      h('span', {}, a.text, a.link ? [' ', h('a', { href: `#/${a.link[0]}` }, a.link[1])] : null)))
    : h('li', { class: 'green' }, '🌿', h('span', {}, 'All calm. Nothing needs attention right now.')));

  const days = Array.from({ length: 14 }, (_, i) => todayStr(Date.now() - (13 - i) * DAY_MS));
  const byDate = Object.fromEntries(checkins.map((c) => [c.date, c]));
  const moodChart = lineChart({
    title: 'Mood over 14 days', yMin: 1, yMax: 5, ticks: [1, 3, 5], formatY: (v) => MOOD[Math.round(v)] || v,
    points: days.map((d) => ({ label: fmtDay(d, { day: 'numeric', month: 'short' }), y: byDate[d]?.mood ?? null })),
  });
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt).slice(-12);
  const gameChart = lineChart({
    title: 'Game accuracy, last 12 sessions', yMin: 0, yMax: 1, ticks: [0, 0.5, 1], color: '#2f7a4f', formatY: (v) => pct(v),
    points: ordered.map((s) => ({ label: fmtDay(s.startedAt, { day: 'numeric', month: 'short' }), y: s.accuracy ?? null })),
  });

  root.append(h('div', { class: 'grid two', style: { marginTop: '1rem' } },
    h('section', { class: 'panel' }, h('h2', {}, 'Needs attention'), alertList),
    h('section', { class: 'panel' }, h('h2', {}, 'Mood'), moodChart),
    h('section', { class: 'panel' }, h('h2', {}, 'Game accuracy'), gameChart,
      h('p', { class: 'small muted' }, 'A trend to discuss with the health worker, not a diagnosis.')),
    h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', {}, 'From the family'), h('a', { href: '#/family' }, 'See all')),
      memories.length
        ? h('div', { class: 'gallery compact' }, [...memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map((m) => h('figure', {},
          m.photo ? h('img', { src: m.photo, alt: m.caption || m.personName || 'Memory' }) : null,
          h('figcaption', {}, h('strong', {}, m.personName || m.caption || 'Memory'), h('br'),
            h('span', { class: 'muted' }, `${m.uploadedBy ? `from ${m.uploadedBy} · ` : ''}${relTime(m.createdAt)}`)))))
        : h('p', { class: 'muted' }, 'No photos shared yet. Family members can add them from the Family page.'))));
}
