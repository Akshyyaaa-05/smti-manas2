import { api, uploadBlob } from '../api.js';
import { confirmDialog, empty, field, h, load, modal, relTime, save, segmented, select, toast } from '../ui.js';
import { startRecording, withMic } from '../voice.js';
import { photoPicker } from './patient.js';

const CATEGORIES = [['person', '🧑 Person'], ['place', '🏡 Place'], ['object', '🧣 Object'], ['routine', '🍵 Daily routine'], ['event', '🎉 Special day']];

function voiceNoteRecorder() {
  let url = '';
  let session = null;
  const status = h('span', { class: 'small muted' }, 'Optional: record a short message in your own voice.');
  const player = h('audio', { controls: true, hidden: true, style: { width: '100%' } });
  const btn = h('button', { type: 'button', class: 'btn' }, '⏺ Record voice message');
  btn.addEventListener('click', async () => {
    if (!session) {
      try { session = await startRecording(); } catch (e) { toast(e.message, 'error', 7000); return; }
      btn.classList.add('recording');
      btn.textContent = '■ Stop recording';
      status.textContent = 'Recording… speak slowly and warmly.';
      return;
    }
    const current = session;
    session = null;
    btn.classList.remove('recording');
    btn.disabled = true;
    status.textContent = 'Saving…';
    try {
      url = await uploadBlob(await current.stop());
      player.src = url;
      player.hidden = false;
      status.textContent = 'Voice message saved. It will play on the cue card.';
      btn.textContent = '⏺ Record again';
    } catch (e) {
      toast(e.message, 'error');
      status.textContent = 'Could not save the recording.';
      btn.textContent = '⏺ Record voice message';
    } finally { btn.disabled = false; }
  });
  return { el: h('div', { class: 'stack' }, h('div', { class: 'row' }, btn, status), player), get url() { return url; }, cancel: () => session?.cancel() };
}

function memoryForm(ctx, family, onDone) {
  const patient = ctx.patient;
  const lang = () => ctx.state.language;
  const state = { category: 'person' };
  const photo = photoPicker('', 'Tap to add a photo');
  const who = select([['', 'Choose a family member…'], ...family.map((f) => [f.id, `${f.name} (${f.relation})`]), ['other', 'Someone else']], '');
  const personName = h('input', { type: 'text', placeholder: 'Their name' });
  const relation = h('input', { type: 'text', placeholder: `e.g. granddaughter, neighbour` });
  const personFields = h('div', { class: 'cols' }, field('Who is in the photo?', who), field('Name', personName), field(`Relation to ${patient.preferredName || patient.name}`, relation));
  who.addEventListener('change', () => {
    const member = family.find((f) => f.id === who.value);
    if (member) { personName.value = member.name; relation.value = (member.relation || '').toLowerCase(); }
  });
  const caption = h('input', { type: 'text', placeholder: 'A short title, e.g. "Priya at Bihu"' });
  const story = h('textarea', { placeholder: 'Tell the story in a few simple sentences. A happy detail helps the most.' });
  const uploadedBy = h('input', { type: 'text', value: load('sharedBy', ''), placeholder: 'Your name' });
  const makeCard = h('input', { type: 'checkbox', checked: true });
  const voice = voiceNoteRecorder();

  const submit = async (e) => {
    e.preventDefault();
    if (!photo.url) { toast('Please add a photo first.', 'error'); return; }
    if (state.category === 'person' && !personName.value.trim()) { toast("Please add the person's name.", 'error'); return; }
    const button = e.submitter;
    if (button) button.disabled = true;
    save('sharedBy', uploadedBy.value.trim());
    try {
      const memory = await api.post('/api/memories', {
        patientId: patient.id, category: state.category, photo: photo.url, voiceNote: voice.url || null,
        personName: state.category === 'person' ? personName.value.trim() : '',
        relation: state.category === 'person' ? relation.value.trim() : '',
        familyId: state.category === 'person' && family.some((f) => f.id === who.value) ? who.value : null,
        caption: caption.value.trim(), story: story.value.trim(), uploadedBy: uploadedBy.value.trim(),
      });
      if (makeCard.checked) {
        const { card, note } = await api.post('/api/cards/from-memory', { memoryId: memory.id });
        toast(`Cue card ready: "${card.cue}"`, 'success', 6000);
        if (note) toast(note, 'error', 6000);
      } else {
        toast('Memory shared. Thank you!', 'success');
      }
      onDone();
    } catch (err) {
      toast(err.message, 'error');
    } finally { if (button) button.disabled = false; }
  };

  return h('form', { class: 'panel form', onsubmit: submit },
    h('h2', {}, `Share a memory with ${patient.preferredName || patient.name}`),
    h('p', { class: 'muted' }, 'Photos of familiar people, places and routines become cue cards they can look at every day.'),
    h('div', { class: 'cols' }, photo.el, h('div', { class: 'form' },
      field('What is it?', segmented(CATEGORIES, state.category, (v) => { state.category = v; personFields.hidden = v !== 'person'; })),
      field('Title', caption))),
    personFields,
    field('The story', withMic(story, lang), 'Tap 🎤 to speak in your language.'),
    field('Voice message', voice.el),
    h('div', { class: 'cols' }, field('Shared by', uploadedBy),
      h('label', { class: 'check', style: { alignSelf: 'end' } }, makeCard, 'Make a cue card now')),
    h('div', {}, h('button', { type: 'submit', class: 'btn primary' }, 'Share memory')));
}

function memberModal(ctx, member, onDone) {
  const photo = photoPicker(member?.photo, 'Add their photo');
  const name = h('input', { type: 'text', value: member?.name || '' });
  const relation = h('input', { type: 'text', value: member?.relation || '', placeholder: 'e.g. Son, Granddaughter' });
  const phone = h('input', { type: 'tel', value: member?.phone || '' });
  modal({
    title: member ? `Edit ${member.name}` : 'Add a family member',
    content: h('div', { class: 'form' }, h('div', { class: 'cols' }, photo.el, h('div', { class: 'form' }, field('Name', name), field('Relation', relation), field('Phone', phone)))),
    actions: [
      member && ctx.isCaregiver ? {
        label: 'Remove', class: 'danger',
        onClick: async () => {
          if (!(await confirmDialog(`Remove ${member.name} from the family list? Their shared memories and cue cards stay.`, { okLabel: 'Remove', danger: true }))) return false;
          try {
            await api.del(`/api/family/${member.id}`);
            onDone();
            return true;
          } catch (e) { toast(e.message, 'error'); return false; }
        },
      } : null,
      { label: 'Cancel' },
      {
        label: 'Save', class: 'primary',
        onClick: async () => {
          if (!name.value.trim()) { toast('Please enter a name.', 'error'); return false; }
          const data = { patientId: ctx.patient.id, name: name.value.trim(), relation: relation.value.trim(), phone: phone.value.trim(), photo: photo.url };
          try {
            if (member) await api.put(`/api/family/${member.id}`, data); else await api.post('/api/family', data);
            onDone();
            return true;
          } catch (e) { toast(e.message, 'error'); return false; }
        },
      },
    ],
  });
}

export async function render(root, ctx) {
  const patient = ctx.patient;
  const q = `?patientId=${patient.id}`;
  const [family, memories] = await Promise.all([api.get(`/api/family${q}`), api.get(`/api/memories${q}`)]);
  const refresh = () => ctx.rerender();

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Family & memories'),
    h('p', {}, 'Everyone who loves them can add photos, stories and voice messages.'))));

  root.append(memoryForm(ctx, family, refresh));

  root.append(h('section', { class: 'panel', style: { marginTop: '1rem' } },
    h('div', { class: 'row between' }, h('h2', {}, 'Family members'),
      h('button', { class: 'btn small', onclick: () => memberModal(ctx, null, refresh) }, '＋ Add member')),
    family.length ? h('div', { class: 'grid three' }, family.map((m) => h('div', { class: 'person' },
      m.photo ? h('img', { class: 'avatar', src: m.photo, alt: '' }) : h('div', { class: 'avatar', 'aria-hidden': 'true' }),
      h('div', {}, h('strong', {}, m.name), h('div', { class: 'small muted' }, m.relation),
        m.phone ? h('a', { class: 'small', href: `tel:${m.phone}` }, m.phone) : null,
        h('div', {}, h('button', { class: 'btn ghost small', onclick: () => memberModal(ctx, m, refresh) }, 'Edit'))))))
      : h('p', { class: 'muted' }, 'Add the people they see most often.')));

  const sorted = [...memories].sort((a, b) => b.createdAt - a.createdAt);
  root.append(h('section', { class: 'panel', style: { marginTop: '1rem' } }, h('h2', {}, `Shared memories (${memories.length})`),
    sorted.length ? h('div', { class: 'gallery' }, sorted.map((m) => h('figure', {},
      m.photo ? h('img', { src: m.photo, alt: m.caption || m.personName || 'Memory' }) : null,
      h('figcaption', { class: 'stack' },
        h('div', {}, h('strong', {}, m.personName || m.caption || 'Memory'), h('br'),
          h('span', { class: 'muted small' }, `${m.uploadedBy ? `from ${m.uploadedBy} · ` : ''}${relTime(m.createdAt)}`)),
        m.voiceNote ? h('audio', { controls: true, src: m.voiceNote, style: { width: '100%' } }) : null,
        h('div', { class: 'row' },
          m.cardId ? h('a', { class: 'chip green', href: '#/cards' }, '✓ Cue card') : h('button', {
            class: 'btn small gold',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const { card, note } = await api.post('/api/cards/from-memory', { memoryId: m.id });
                toast(`Cue card ready: "${card.cue}"`, 'success', 6000);
                if (note) toast(note, 'error', 6000);
                refresh();
              } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
            },
          }, 'Make cue card'),
          ctx.isCaregiver ? h('button', {
            class: 'btn small ghost', 'aria-label': 'Delete memory',
            onclick: async () => {
              if (!(await confirmDialog('Delete this memory? Its cue card (if any) stays.', { okLabel: 'Delete', danger: true }))) return;
              try { await api.del(`/api/memories/${m.id}`); refresh(); } catch (err) { toast(err.message, 'error'); }
            },
          }, '🗑') : null)))))
      : empty('🖼️', 'No memories yet. Share the first photo above.')));
}
