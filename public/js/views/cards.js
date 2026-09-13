import { api } from '../api.js';
import { LANGUAGES } from '../app.js';
import { confirmDialog, empty, field, h, modal, pct, relTime, segmented, toast } from '../ui.js';
import { speak, withMic } from '../voice.js';

const CATEGORY = { person: '🧑 Person', place: '🏡 Place', object: '🧣 Object', routine: '🍵 Routine', event: '🎉 Special day' };
const langName = (code) => (LANGUAGES.find(([c]) => c === code) || [code, code])[1].split(' · ').pop();

function playCue(card, patient) {
  const lang = patient.language || 'en';
  return card.cueLocal && lang !== 'en' ? speak(card.cueLocal, lang) : speak(card.cue, 'en');
}

function playVoiceNote(url) {
  new Audio(url).play().catch(() => toast('Could not play the voice message.', 'error'));
}

function editCard(ctx, card, memory) {
  const patient = ctx.patient;
  const lang = patient.language || 'en';
  const micLang = () => ctx.state.language;
  const title = h('input', { type: 'text', value: card.title || '' });
  const relation = h('input', { type: 'text', value: card.relation || '' });
  const front = h('input', { type: 'text', value: card.front || '' });
  const cue = h('textarea', { value: card.cue || '' });
  const local = h('textarea', { value: card.cueLocal || '' });

  const rewrite = h('button', {
    type: 'button', class: 'btn small gold',
    onclick: async (e) => {
      const btn = e.currentTarget; // currentTarget is null again once the handler awaits
      btn.disabled = true;
      try {
        const res = await api.post('/api/cue/suggest', {
          patientId: patient.id, category: card.category, personName: card.category === 'person' ? title.value : '',
          relation: relation.value, caption: memory?.caption || title.value, story: memory?.story || cue.value,
        });
        cue.value = res.cue;
        toast(res.source === 'claude' ? 'Sangi rewrote the card.' : 'Used the offline template. Add a Claude key in Settings for warmer wording.');
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    },
  }, '✨ Rewrite with Sangi');

  const translate = h('button', {
    type: 'button', class: 'btn small',
    onclick: async (e) => {
      if (!ctx.state.status.bhashini) { toast('Translation needs Bhashini keys. See Settings.', 'error'); return; }
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.post('/api/bhashini/translate', { text: cue.value, source: 'en', target: lang });
        local.value = res.text;
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    },
  }, '🌐 Translate with Bhashini');

  modal({
    title: 'Edit cue card',
    content: h('div', { class: 'form' },
      h('div', { class: 'cols' }, field('Name or title', title), field('Relation', relation), field('Question on the front', front)),
      field('Card text (English)', withMic(cue, micLang)),
      h('div', { class: 'row' }, rewrite),
      lang !== 'en' ? [
        field(`Card text in ${langName(lang)}`, withMic(local, micLang),
          'Machine translation can sound wrong or cold. Please have someone who speaks the language check it.'),
        h('div', { class: 'row' }, translate),
      ] : null),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save', class: 'primary',
        onClick: async () => {
          try {
            await api.put(`/api/cards/${card.id}`, { title: title.value.trim(), relation: relation.value.trim(), front: front.value.trim(), cue: cue.value.trim(), cueLocal: local.value.trim() });
            toast('Card saved.', 'success');
            ctx.rerender();
            return true;
          } catch (err) { toast(err.message, 'error'); return false; }
        },
      },
    ],
  });
}

function printCards(cards) {
  const area = h('div', { class: 'print-area' }, cards.map((c) => h('div', { class: 'print-card' },
    c.photo ? h('img', { src: c.photo, alt: '' }) : null,
    h('div', {}, h('strong', {}, c.title), c.cue, c.cueLocal ? h('p', {}, c.cueLocal) : null))));
  document.body.append(area);
  const images = [...area.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })));
  // Some browsers return from print() before printing, so tidy up on afterprint instead.
  window.addEventListener('afterprint', () => area.remove(), { once: true });
  Promise.all(images).then(() => window.print());
}

function cardTile(ctx, card, memory) {
  const patient = ctx.patient;
  const role = ctx.state.role;
  const stats = card.stats || {};
  return h('article', { class: 'cue-card' },
    h('div', { class: 'pic' }, card.photo ? h('img', { src: card.photo, alt: card.title, loading: 'lazy' }) : null,
      h('span', { class: 'chip' }, CATEGORY[card.category] || 'Card')),
    h('div', { class: 'body' },
      h('div', { class: 'title' }, card.title),
      h('div', { class: 'cue' }, card.cue),
      card.cueLocal ? h('div', { class: 'local', lang: patient.language }, card.cueLocal) : null,
      role !== 'patient' && stats.shown ? h('div', { class: 'small muted' },
        h('div', { class: 'meter', title: `Remembered ${stats.remembered} of ${stats.shown}` }, h('span', { style: { width: pct(stats.remembered / stats.shown) } })),
        `Remembered ${stats.remembered} of ${stats.shown} · last shown ${relTime(stats.lastShown)}`) : null,
      role !== 'patient' && card.cueSource === 'claude' ? h('span', { class: 'chip blue' }, 'Written with Sangi') : null),
    h('div', { class: 'actions' },
      h('button', { class: 'btn small', onclick: () => playCue(card, patient) }, '🔊 Listen'),
      card.voiceNote ? h('button', { class: 'btn small', onclick: () => playVoiceNote(card.voiceNote) }, '▶ Voice message') : null,
      role !== 'patient' ? h('button', { class: 'btn small', onclick: () => editCard(ctx, card, memory) }, '✏️ Edit') : null,
      ctx.isCaregiver ? h('button', {
        class: 'btn small ghost', 'aria-label': `Delete card ${card.title}`,
        onclick: async () => {
          if (!(await confirmDialog(`Delete the cue card "${card.title}"? The shared photo stays in Family.`, { okLabel: 'Delete', danger: true }))) return;
          try {
            await api.del(`/api/cards/${card.id}`);
            if (card.memoryId) await api.put(`/api/memories/${card.memoryId}`, { cardId: null }).catch(() => {});
            ctx.rerender();
          } catch (e) { toast(e.message, 'error'); }
        },
      }, '🗑') : null));
}

function practice(root, ctx, cards) {
  const patient = ctx.patient;
  const name = patient.preferredName || patient.name.split(' ')[0];
  const isPatient = ctx.state.role === 'patient';
  const ratio = (c) => (c.stats?.shown ? c.stats.remembered / c.stats.shown : 0.5);
  const deck = [...cards].sort((a, b) => ratio(a) - ratio(b) || (a.stats?.lastShown || 0) - (b.stats?.lastShown || 0)).slice(0, 10);
  let index = 0;
  const counter = h('span', { class: 'chip' });
  const stage = h('div', { class: 'practice' });

  root.append(h('div', { class: 'row between', style: { marginBottom: '1rem' } },
    h('a', { class: 'btn', href: isPatient ? '#/me' : '#/cards' }, '← Back'), counter), stage);

  if (!deck.length) {
    stage.append(empty('🃏', 'There are no cue cards yet. Family members can make them by sharing photos.'));
    return;
  }

  const answer = (card, result) => {
    api.post(`/api/cards/${card.id}/review`, { result }).catch(() => {});
    index += 1;
    show();
  };

  function show() {
    counter.textContent = index < deck.length ? `${index + 1} of ${deck.length}` : 'Done';
    if (index >= deck.length) {
      stage.replaceChildren(h('div', { class: 'panel center stack' },
        h('div', { style: { fontSize: '4rem' }, 'aria-hidden': 'true' }, '🌼'),
        h('h1', {}, `That was lovely, ${name}!`),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn big primary', onclick: () => { index = 0; show(); } }, 'See them again'),
          h('a', { class: 'btn big', href: isPatient ? '#/me' : '#/cards' }, 'Finish'))));
      return;
    }
    const card = deck[index];
    const flip = h('div', { class: 'flip' }, h('div', { class: 'flip-inner' },
      h('div', { class: 'face front', role: 'button', tabindex: '0', 'aria-label': `${card.front}. Tap to see the answer.`, onclick: () => reveal() },
        card.photo ? h('img', { src: card.photo, alt: '' }) : null,
        h('div', { class: 'caption' }, card.front || 'Do you remember?')),
      h('div', { class: 'face back', 'aria-live': 'polite' },
        card.photo ? h('img', { src: card.photo, alt: '' }) : null,
        h('div', { class: 'name' }, card.title),
        h('div', { class: 'cue' }, card.cue),
        card.cueLocal ? h('div', { class: 'local', lang: patient.language }, card.cueLocal) : null)));

    const controls = h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '1.2rem' } },
      h('button', { class: 'btn big primary', onclick: () => reveal() }, 'Show me'));

    function reveal() {
      if (flip.classList.contains('revealed')) return;
      flip.classList.add('revealed');
      playCue(card, patient);
      controls.replaceChildren(...[
        h('button', { class: 'btn big', onclick: () => playCue(card, patient) }, '🔊 Hear again'),
        card.voiceNote ? h('button', { class: 'btn big', onclick: () => playVoiceNote(card.voiceNote) }, '▶ Voice message') : null,
        h('button', { class: 'btn big gold', onclick: () => answer(card, 'remembered') }, '😊 I remember'),
        h('button', { class: 'btn big', onclick: () => answer(card, 'notyet') }, '🙂 Not yet'),
      ].filter(Boolean));
    }
    flip.querySelector('.front').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
    stage.replaceChildren(flip, controls);
  }
  show();
}

export async function render(root, ctx, params) {
  const patient = ctx.patient;
  const q = `?patientId=${patient.id}`;
  const [cards, memories] = await Promise.all([api.get(`/api/cards${q}`), api.get(`/api/memories${q}`)]);
  if (params[0] === 'practice') return practice(root, ctx, cards);

  const isPatient = ctx.state.role === 'patient';
  const byMemory = Object.fromEntries(memories.map((m) => [m.id, m]));
  const sorted = [...cards].sort((a, b) => b.createdAt - a.createdAt);

  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, isPatient ? 'My people and places' : 'Cue cards'),
      isPatient ? null : h('p', {}, 'Made from family photos. Practise a few each day; stop while it is still enjoyable.')),
    h('div', { class: 'row' },
      cards.length ? h('a', { class: 'btn primary', href: '#/cards/practice' }, '▶ Practise') : null,
      !isPatient && cards.length ? h('button', { class: 'btn', onclick: () => printCards(sorted) }, '🖨 Print') : null,
      !isPatient ? h('a', { class: 'btn', href: '#/family' }, '＋ From a photo') : null)));

  if (!cards.length) {
    root.append(empty('🃏', 'No cue cards yet. Share a photo on the Family page and tick “Make a cue card”.',
      isPatient ? null : h('a', { class: 'btn primary', href: '#/family' }, 'Share a photo')));
    return;
  }

  const grid = h('div', { class: 'cards-grid' });
  const draw = (category) => grid.replaceChildren(...sorted.filter((c) => category === 'all' || c.category === category)
    .map((c) => cardTile(ctx, c, byMemory[c.memoryId])));
  const present = Object.keys(CATEGORY).filter((k) => cards.some((c) => c.category === k));
  if (present.length > 1) {
    root.append(h('div', { style: { marginBottom: '1rem' } },
      segmented([['all', 'All'], ...present.map((k) => [k, CATEGORY[k]])], 'all', draw)));
  }
  draw('all');
  root.append(grid);
}
