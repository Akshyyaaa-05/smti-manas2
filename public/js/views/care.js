import { api } from '../api.js';
import { lineChart } from '../charts.js';
import { DAY_MS, empty, field, fmtDay, h, load, save, segmented, toast, todayStr } from '../ui.js';
import { withMic } from '../voice.js';
import { MOOD } from './dashboard.js';

function checkinForm(ctx, checkins, date, onSaved) {
  const patient = ctx.patient;
  const meds = (patient.medications || []).map((m) => m.name).filter(Boolean);
  const existing = checkins.find((c) => c.date === date);
  const state = {
    mood: existing?.mood ?? null,
    meals: existing?.meals ?? null,
  };
  const dateInput = h('input', { type: 'date', value: date, max: todayStr(), onchange: (e) => onSaved(e.target.value) });
  const sleep = h('input', { type: 'number', min: 0, max: 24, step: 'any', inputmode: 'decimal', value: existing?.sleepHours ?? '', placeholder: 'e.g. 7' });
  const medChecks = meds.map((m) => h('input', { type: 'checkbox', value: m, checked: existing ? (existing.medsTaken || []).includes(m) : false }));
  const flag = (key) => h('input', { type: 'checkbox', checked: Boolean(existing?.[key]) });
  const flags = { agitation: flag('agitation'), wandering: flag('wandering'), fall: flag('fall') };
  const notes = h('textarea', { placeholder: 'How was the day? Anything the doctor should know?', value: existing?.notes || '' });
  const by = h('input', { type: 'text', value: existing?.by || load('checkinBy', ''), placeholder: 'Your name' });

  const submit = async (e) => {
    e.preventDefault();
    if (!state.mood) { toast('Please choose a mood.', 'error'); return; }
    const data = {
      patientId: patient.id, date: dateInput.value, mood: state.mood, meals: state.meals,
      sleepHours: sleep.value ? Number(sleep.value) : null,
      medsTaken: medChecks.filter((c) => c.checked).map((c) => c.value),
      agitation: flags.agitation.checked, wandering: flags.wandering.checked, fall: flags.fall.checked,
      notes: notes.value.trim(), by: by.value.trim(),
    };
    save('checkinBy', data.by);
    try {
      if (existing) await api.put(`/api/checkins/${existing.id}`, data); else await api.post('/api/checkins', data);
      toast(data.fall ? 'Saved. Please tell the doctor about the fall.' : 'Check-in saved.', data.fall ? 'error' : 'success', 5000);
      onSaved(data.date);
    } catch (err) { toast(err.message, 'error'); }
  };

  return h('form', { class: 'panel form', onsubmit: submit },
    h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, existing ? 'Update check-in' : 'Daily check-in'), field('Date', dateInput)),
    field('Mood', segmented(Object.entries(MOOD).map(([v, e]) => [Number(v), e, ['', 'Very low', 'Low', 'Okay', 'Good', 'Very good'][v]]), state.mood, (v) => { state.mood = v; }, 'emoji')),
    h('div', { class: 'cols' },
      field('Hours of sleep', sleep),
      field('Meals eaten', segmented([[0, '0'], [1, '1'], [2, '2'], [3, '3']], state.meals, (v) => { state.meals = v; }))),
    field('Medicines taken', meds.length
      ? h('div', {}, medChecks.map((c, i) => h('label', { class: 'check' }, c, `${meds[i]} ${patient.medications.find((m) => m.name === meds[i])?.time ? `(${patient.medications.find((m) => m.name === meds[i]).time})` : ''}`)))
      : h('p', { class: 'muted' }, 'No medicines on record. ', h('a', { href: '#/patient/edit' }, 'Add them to the profile.'))),
    field('Anything happen today?', h('div', {},
      h('label', { class: 'check' }, flags.agitation, 'Restless, angry or agitated'),
      h('label', { class: 'check' }, flags.wandering, 'Wandered or tried to leave'),
      h('label', { class: 'check' }, flags.fall, 'Had a fall'))),
    field('Notes', withMic(notes, () => ctx.state.language)),
    field('Filled in by', by),
    h('div', {}, h('button', { type: 'submit', class: 'btn primary' }, existing ? 'Update check-in' : 'Save check-in')));
}

export async function render(root, ctx, params) {
  const patient = ctx.patient;
  const checkins = (await api.get(`/api/checkins?patientId=${patient.id}`)).sort((a, b) => b.date.localeCompare(a.date));
  const date = params[0] && /^\d{4}-\d{2}-\d{2}$/.test(params[0]) ? params[0] : todayStr();
  const name = patient.preferredName || patient.name;

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Daily care'),
    h('p', {}, `A two-minute check-in for ${name} each evening builds a picture the doctor can use.`))));

  const days = Array.from({ length: 14 }, (_, i) => todayStr(Date.now() - (13 - i) * DAY_MS));
  const byDate = Object.fromEntries(checkins.map((c) => [c.date, c]));
  const label = (d) => fmtDay(d, { day: 'numeric', month: 'short' });

  root.append(h('div', { class: 'grid two' },
    checkinForm(ctx, checkins, date, (d) => ctx.navigate(`care/${d}`)),
    h('div', { class: 'stack' },
      h('section', { class: 'panel' }, h('h2', {}, 'Mood, last 14 days'), lineChart({
        title: 'Mood', yMin: 1, yMax: 5, ticks: [1, 3, 5], formatY: (v) => MOOD[Math.round(v)] || v,
        points: days.map((d) => ({ label: label(d), y: byDate[d]?.mood ?? null })),
      })),
      h('section', { class: 'panel' }, h('h2', {}, 'Sleep, last 14 days'), lineChart({
        title: 'Hours of sleep', yMin: 0, yMax: 10, ticks: [0, 5, 10], color: '#2c6e8f', formatY: (v) => `${v}h`,
        points: days.map((d) => ({ label: label(d), y: byDate[d]?.sleepHours ?? null })),
      })))));

  const meds = (patient.medications || []).map((m) => m.name).filter(Boolean);
  root.append(h('section', { class: 'panel', style: { marginTop: '1rem' } }, h('h2', {}, 'History'),
    checkins.length ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'Mood', 'Sleep', 'Meals', 'Medicines', 'Events', 'Notes', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, checkins.slice(0, 30).map((c) => {
        const missed = meds.filter((m) => !(c.medsTaken || []).includes(m));
        return h('tr', {},
          h('td', {}, fmtDay(c.date)),
          h('td', { title: `Mood ${c.mood} of 5` }, MOOD[c.mood] || '–'),
          h('td', {}, c.sleepHours ? `${c.sleepHours}h` : '–'),
          h('td', {}, c.meals ?? '–'),
          h('td', {}, !meds.length ? '–' : missed.length ? h('span', { class: 'chip red' }, `Missed ${missed.join(', ')}`) : h('span', { class: 'chip green' }, 'All taken')),
          h('td', {}, h('div', { class: 'row' }, c.agitation ? h('span', { class: 'chip amber' }, 'Agitated') : null,
            c.wandering ? h('span', { class: 'chip red' }, 'Wandered') : null, c.fall ? h('span', { class: 'chip red' }, 'Fall') : null)),
          h('td', { class: 'small' }, c.notes || ''),
          h('td', {}, h('button', { class: 'btn small', onclick: () => ctx.navigate(`care/${c.date}`) }, 'Edit')));
      }))))
      : empty('📝', 'No check-ins yet. The first one takes about two minutes.')));
}
