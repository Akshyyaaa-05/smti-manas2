import { api } from '../api.js';
import { h, toast } from '../ui.js';

function roleCard(ctx, role, emoji, title, text) {
  return h('button', {
    type: 'button', class: 'role-card',
    onclick: () => { ctx.setRole(role); ctx.navigate(ctx.homePath()); },
  }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, emoji), h('strong', {}, title), h('span', { class: 'muted' }, text));
}

export async function render(root, ctx) {
  const { patients, status } = ctx.state;
  root.append(h('section', { class: 'hero' },
    h('h1', {}, 'Namaskar 🙏'),
    h('p', { class: 'muted' }, 'The SMTI-MANAS care portal brings the patient, their caregivers and their family into one place.')));

  if (!patients.length) {
    const loadDemo = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.post('/api/demo/seed');
        await Promise.all([ctx.refreshPatients(), ctx.refreshStatus()]);
        toast('Demo family loaded. Everything in it is fictional.', 'success');
        ctx.rerender();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    };
    root.append(h('div', { class: 'grid two' },
      h('div', { class: 'panel' },
        h('h2', {}, 'Start with your patient'),
        h('p', {}, 'Add the person you care for: their details, medicines, and the people and things they love.'),
        h('button', { class: 'btn primary', onclick: () => { ctx.setRole('caregiver'); ctx.navigate('patient/new'); } }, '＋ Add a patient')),
      h('div', { class: 'panel soft' },
        h('h2', {}, 'Just exploring?'),
        h('p', {}, 'Load a fictional demo family to try every screen, including cue cards and game progress.'),
        h('button', { class: 'btn gold', onclick: loadDemo }, 'Explore with demo data'))));
    return;
  }

  const patient = ctx.patient;
  const name = patient.preferredName || patient.name;
  if (patients.length > 1) {
    root.append(h('div', { class: 'panel soft', style: { marginBottom: '1rem' } },
      h('label', { class: 'field' }, 'Patient',
        h('select', { onchange: (e) => { ctx.setPatient(e.target.value); ctx.rerender(); } },
          patients.map((p) => h('option', { value: p.id, selected: p.id === patient.id }, p.name))))));
  }

  root.append(
    h('div', { class: 'person', style: { marginBottom: '1rem' } },
      patient.photo ? h('img', { class: 'avatar', src: patient.photo, alt: '' }) : null,
      h('h2', { style: { margin: 0 } }, `Who is using the portal for ${name}?`)),
    h('div', { class: 'grid three' },
      roleCard(ctx, 'caregiver', '🩺', 'Caregiver', 'Daily check-ins, medicines, alerts and game progress.'),
      roleCard(ctx, 'family', '👪', 'Family member', 'Share photos and memories. They become cue cards.'),
      roleCard(ctx, 'patient', '🌼', name, 'Big, simple buttons: my people, games, and talking with Sangi.')),
  );

  const games = Object.values(status.games || {}).filter(Boolean).length;
  root.append(h('p', { class: 'small muted', style: { marginTop: '1.5rem' } },
    `Bhashini: ${status.bhashini ? 'connected' : 'not set up'} · Sangi AI: ${status.claude ? 'Claude' : 'offline replies'} · Games installed: ${games} of 2 · `,
    h('a', { href: '#/settings' }, 'Settings')));
}
