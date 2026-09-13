import { api, uploadImage } from '../api.js';
import { LANGUAGES } from '../app.js';
import { confirmDialog, field, h, select, toast } from '../ui.js';
import { withMic } from '../voice.js';

const langName = (code) => (LANGUAGES.find(([c]) => c === code) || [code, code])[1];

export function photoPicker(initialUrl, label = 'Add a photo') {
  let url = initialUrl || '';
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const preview = h('div', { class: 'photo-drop', role: 'button', tabindex: '0', onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } });
  const show = () => preview.replaceChildren(url ? h('img', { src: url, alt: 'Chosen photo' }) : h('span', {}, '📷'), h('span', {}, url ? 'Change photo' : label));
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    preview.replaceChildren(h('span', {}, 'Uploading…'));
    try { url = await uploadImage(file); } catch (e) { toast(e.message, 'error'); }
    show();
  });
  show();
  return { el: h('div', {}, preview, input), get url() { return url; } };
}

export function listEditor(items, columns, addLabel) {
  const rows = h('div', { class: 'list-editor' });
  const addRow = (item = {}) => {
    const inputs = columns.map((c) => h('input', { type: c.type || 'text', placeholder: c.placeholder, value: item[c.key] || '', 'aria-label': c.placeholder, dataset: { key: c.key } }));
    const row = h('div', { class: 'item' }, inputs, h('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Remove', onclick: () => row.remove() }, '✕'));
    rows.append(row);
  };
  (items || []).forEach(addRow);
  return {
    el: h('div', {}, rows, h('button', { type: 'button', class: 'btn small', onclick: () => addRow() }, `＋ ${addLabel}`)),
    get items() {
      return [...rows.children].map((row) => Object.fromEntries([...row.querySelectorAll('input')].map((i) => [i.dataset.key, i.value.trim()])))
        .filter((item) => Object.values(item).some(Boolean));
    },
  };
}

function renderForm(root, ctx, patient) {
  const isNew = !patient;
  const p = patient || { language: ctx.state.language };
  const lang = () => ctx.state.language;
  const text = (key, attrs = {}) => h('input', { type: 'text', value: p[key] ?? '', ...attrs });
  const area = (key, placeholder) => h('textarea', { placeholder, value: p[key] ?? '' });

  const photo = photoPicker(p.photo, 'Add a clear photo of their face');
  const f = {
    name: text('name', { required: true }), preferredName: text('preferredName', { placeholder: 'What they like to be called' }),
    age: h('input', { type: 'number', min: 0, max: 130, value: p.age ?? '' }),
    gender: select([['', '—'], ['Female', 'Female'], ['Male', 'Male'], ['Other', 'Other']], p.gender || ''),
    region: text('region', { placeholder: 'e.g. Jorhat, Assam' }), language: select(LANGUAGES, p.language || 'en'),
    diagnosis: text('diagnosis', { placeholder: "e.g. Alzheimer's disease" }), stage: text('stage', { placeholder: 'e.g. early' }),
    doctor: text('doctor'), doctorPhone: h('input', { type: 'tel', value: p.doctorPhone ?? '' }), allergies: text('allergies'),
    likes: area('likes', 'Songs, food, places, hobbies…'), dislikes: area('dislikes', 'Things that upset or worry them'),
    lifeStory: area('lifeStory', 'Work, family, home town, proud moments…'), notes: area('notes', 'Anything else caregivers should know'),
  };
  const meds = listEditor(p.medications, [{ key: 'name', placeholder: 'Medicine' }, { key: 'dose', placeholder: 'Dose' }, { key: 'time', placeholder: 'Time' }], 'Add medicine');
  const contacts = listEditor(p.emergencyContacts, [{ key: 'name', placeholder: 'Name' }, { key: 'relation', placeholder: 'Relation' }, { key: 'phone', placeholder: 'Phone', type: 'tel' }], 'Add contact');

  const save = async (e) => {
    e.preventDefault();
    const data = {
      name: f.name.value.trim(), preferredName: f.preferredName.value.trim(), age: f.age.value ? Number(f.age.value) : null,
      gender: f.gender.value, region: f.region.value.trim(), language: f.language.value, photo: photo.url,
      diagnosis: f.diagnosis.value.trim(), stage: f.stage.value.trim(), doctor: f.doctor.value.trim(),
      doctorPhone: f.doctorPhone.value.trim(), allergies: f.allergies.value.trim(), medications: meds.items,
      emergencyContacts: contacts.items, likes: f.likes.value.trim(), dislikes: f.dislikes.value.trim(),
      lifeStory: f.lifeStory.value.trim(), notes: f.notes.value.trim(),
    };
    if (!data.name) { toast('Please enter a name.', 'error'); f.name.focus(); return; }
    try {
      const saved = isNew ? await api.post('/api/patients', data) : await api.put(`/api/patients/${patient.id}`, data);
      await ctx.refreshPatients();
      ctx.setPatient(saved.id);
      toast('Saved.', 'success');
      ctx.navigate('patient');
    } catch (err) { toast(err.message, 'error'); }
  };

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, isNew ? 'Add a patient' : `Edit ${p.name}`),
    h('p', {}, 'Only the name is required. Tap 🎤 to speak instead of typing.'))));
  root.append(h('form', { class: 'form', onsubmit: save },
    h('section', { class: 'panel form' }, h('h2', {}, 'About them'),
      h('div', { class: 'cols' }, photo.el, h('div', { class: 'form' }, field('Full name', f.name), field('Preferred name', f.preferredName))),
      h('div', { class: 'cols' }, field('Age', f.age), field('Gender', f.gender), field('Home', f.region), field('Language they speak', f.language))),
    h('section', { class: 'panel form' }, h('h2', {}, 'Health'),
      h('div', { class: 'cols' }, field('Diagnosis', f.diagnosis), field('Stage', f.stage), field('Allergies', f.allergies)),
      h('div', { class: 'cols' }, field('Doctor', f.doctor), field("Doctor's phone", f.doctorPhone)),
      field('Medicines', meds.el, 'Used for the daily medicine checklist.')),
    h('section', { class: 'panel form' }, h('h2', {}, 'Emergency contacts'), contacts.el),
    h('section', { class: 'panel form' }, h('h2', {}, 'Their story'),
      h('p', { class: 'muted small' }, 'Sangi and the cue cards use this to talk about what matters to them.'),
      field('Likes', withMic(f.likes, lang)), field('Dislikes', withMic(f.dislikes, lang)),
      field('Life story', withMic(f.lifeStory, lang)), field('Notes for caregivers', withMic(f.notes, lang))),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Add patient' : 'Save changes'),
      h('button', { type: 'button', class: 'btn', onclick: () => ctx.navigate(isNew ? 'home' : 'patient') }, 'Cancel'))));
}

function info(label, value) {
  return value ? h('div', {}, h('div', { class: 'small muted' }, label), h('div', {}, value)) : null;
}

export async function render(root, ctx, params) {
  const patient = ctx.patient;
  if (params[0] === 'new' || !patient) return renderForm(root, ctx, null);
  if (params[0] === 'edit' && ctx.isCaregiver) return renderForm(root, ctx, patient);

  const p = patient;
  root.append(h('div', { class: 'page-head' },
    h('div', { class: 'person' }, p.photo ? h('img', { class: 'avatar lg', src: p.photo, alt: '' }) : null,
      h('div', {}, h('h1', {}, p.name), h('p', {}, [p.age && `${p.age} years`, p.gender, p.region].filter(Boolean).join(' · ')),
        h('div', { class: 'row', style: { marginTop: '.4rem' } }, h('span', { class: 'chip blue' }, `Speaks ${langName(p.language || 'en')}`),
          p.demo ? h('span', { class: 'chip gold' }, 'Demo data · fictional') : null))),
    ctx.isCaregiver ? h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => ctx.navigate('patient/edit') }, '✏️ Edit'),
      h('button', { class: 'btn', onclick: () => ctx.navigate('patient/new') }, '＋ Another patient')) : null));

  const meds = p.medications || [];
  const contacts = p.emergencyContacts || [];
  root.append(h('div', { class: 'grid two' },
    h('section', { class: 'panel stack' }, h('h2', {}, 'Health'),
      info('Diagnosis', [p.diagnosis, p.stage].filter(Boolean).join(', ')), info('Allergies', p.allergies),
      info('Doctor', [p.doctor, p.doctorPhone].filter(Boolean).join(' · ')),
      !p.diagnosis && !p.doctor ? h('p', { class: 'muted' }, 'No health details yet.') : null),
    h('section', { class: 'panel' }, h('h2', {}, 'Medicines'),
      meds.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Medicine'), h('th', {}, 'Dose'), h('th', {}, 'Time'))),
        h('tbody', {}, meds.map((m) => h('tr', {}, h('td', {}, m.name), h('td', {}, m.dose), h('td', {}, m.time))))))
        : h('p', { class: 'muted' }, 'No medicines on record.')),
    h('section', { class: 'panel' }, h('h2', {}, 'Emergency contacts'),
      contacts.length ? contacts.map((c) => h('p', {}, h('strong', {}, c.name), ` (${c.relation || 'contact'}) `, c.phone ? h('a', { href: `tel:${c.phone}` }, c.phone) : null))
        : h('p', { class: 'muted' }, 'No contacts yet.'),
      h('p', { class: 'small muted' }, 'Emergency: call 108 for an ambulance, or 112.')),
    h('section', { class: 'panel stack' }, h('h2', {}, 'Their story'),
      info('Likes', p.likes), info('Dislikes', p.dislikes), info('Life story', p.lifeStory), info('Notes for caregivers', p.notes),
      !p.likes && !p.lifeStory ? h('p', { class: 'muted' }, 'Add their story so Sangi and the cue cards can talk about what they love.') : null)));

  if (ctx.isCaregiver) {
    root.append(h('div', { style: { marginTop: '1.5rem' } }, h('button', {
      class: 'btn danger small',
      onclick: async () => {
        if (!(await confirmDialog(`Delete ${p.name} and all their check-ins, family members, photos, voice messages, cue cards and game results? This cannot be undone.`, { okLabel: 'Delete', danger: true }))) return;
        try {
          await api.del(`/api/patients/${p.id}`);
          await ctx.refreshPatients();
          toast('Patient deleted.');
          ctx.navigate('home');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'Delete this patient')));
  }
}
