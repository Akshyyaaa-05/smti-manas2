import { api } from '../api.js';
import { LANGUAGES } from '../app.js';
import { confirmDialog, h, load, save, segmented, select, toast } from '../ui.js';
import { micButton, speak } from '../voice.js';

function suggestionsFor(mode, firstPerson) {
  return mode === 'companion'
    ? [firstPerson ? `Who is ${firstPerson}?` : 'Who is in my family?', 'What day is it today?', 'I feel a bit lonely.', 'Hello Sangi!']
    : ['He gets restless every evening. What can I do?', 'How do I help with medicines?', 'She keeps asking the same question.', 'I feel exhausted looking after him.'];
}

export async function render(root, ctx) {
  const patient = ctx.patient;
  const status = ctx.state.status;
  const isPatient = ctx.state.role === 'patient';
  const mode = isPatient ? 'companion' : load('sangiMode', 'caregiver');
  const name = patient.preferredName || patient.name.split(' ')[0];
  const cards = await api.get(`/api/cards?patientId=${patient.id}`).catch(() => []);
  const firstPerson = cards.find((c) => c.category === 'person')?.title?.split(' ')[0];

  const storeKey = `chat:${patient.id}:${mode}`;
  let history = load(storeKey, []);
  let busy = false;

  const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
  const suggestions = h('div', { class: 'suggestions' });
  const input = h('textarea', {
    rows: 1, 'aria-label': 'Message to Sangi',
    placeholder: mode === 'companion' ? 'Say something to Sangi…' : `Ask about caring for ${name}…`,
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
  });
  const sendBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Send');

  const intro = mode === 'companion'
    ? `Namaskar, ${name}! I'm Sangi. I'm happy to talk with you.`
    : `Namaskar! I'm Sangi. Ask me about caring for ${name}: sleep, meals, restlessness, medicines, or how you are coping.`;

  function bubble(m) {
    if (m.role === 'user') {
      return h('div', { class: 'bubble user' }, m.content,
        !isPatient && m.contentEn && m.contentEn !== m.content ? h('div', { class: 'english' }, m.contentEn) : null);
    }
    return h('div', { class: 'bubble bot' }, m.content,
      !isPatient && m.contentEn && m.contentEn !== m.content ? h('details', { class: 'english' }, h('summary', {}, 'In English'), m.contentEn) : null,
      h('div', { class: 'meta' },
        h('button', { type: 'button', class: 'btn small', 'aria-label': 'Read aloud', onclick: () => speak(m.content, m.lang || 'en') }, '🔊'),
        !isPatient && m.source ? h('span', { class: `chip ${m.source === 'claude' ? 'blue' : 'gold'}` }, m.source === 'claude' ? 'Claude' : 'Offline') : null,
        !isPatient && m.translatedBy ? h('span', { class: 'chip green' }, 'Bhashini') : null),
      !isPatient && m.note ? h('div', { class: 'small muted', style: { marginTop: '.3rem' } }, m.note) : null);
  }

  function draw() {
    log.replaceChildren(bubble({ role: 'assistant', content: intro, lang: 'en' }), ...history.map(bubble));
    suggestions.replaceChildren(...(history.length ? [] : suggestionsFor(mode, firstPerson)
      .map((text) => h('button', { type: 'button', class: 'btn small', onclick: () => send(text) }, text))));
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  async function send(preset) {
    const text = (preset ?? input.value).trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    const language = ctx.state.language;
    history.push({ role: 'user', content: text });
    draw();
    const typing = h('div', { class: 'bubble bot typing', 'aria-label': 'Sangi is typing' }, h('span'), h('span'), h('span'));
    log.append(typing);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await api.post('/api/sangi/chat', {
        patientId: patient.id, mode, language,
        messages: history.map(({ role, content, contentEn }) => ({ role, content, contentEn })),
      });
      if (res.userEn) history[history.length - 1].contentEn = res.userEn;
      const replyLang = res.translatedBy || res.source === 'claude' ? language : 'en';
      history.push({ role: 'assistant', content: res.reply, contentEn: res.replyEn, source: res.source, note: res.note, translatedBy: res.translatedBy, lang: replyLang });
      history = history.slice(-40);
      save(storeKey, history);
      draw();
      if (isPatient) speak(res.reply, replyLang);
    } catch (e) {
      history.pop();
      input.value = text;
      draw();
      toast(e.message, 'error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  const statusLine = [
    status.claude ? `Answers from Claude (${status.claudeModel})` : 'Offline answers. Add a Claude key in Settings for fuller replies',
    ctx.state.language === 'en' ? null
      : status.bhashini ? 'Bhashini translates in and out'
        : status.claude ? 'Claude replies in your language' : 'Replies stay in English until Bhashini or Claude is set up',
  ].filter(Boolean).join(' · ');

  const composer = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(); } },
    input,
    micButton({
      getLanguage: () => ctx.state.language,
      onText: (t) => { input.value = input.value ? `${input.value} ${t}` : t; if (isPatient) send(); else input.focus(); },
    }),
    sendBtn);

  root.append(h('div', { class: 'chat' },
    h('div', {},
      h('div', { class: 'page-head', style: { marginBottom: '.4rem' } },
        h('div', {}, h('h1', {}, isPatient ? 'Talk with Sangi' : 'Sangi'), isPatient ? null : h('p', { class: 'small' }, statusLine)),
        h('div', { class: 'row' },
          isPatient ? null : segmented([['caregiver', '🩺 Caregiver help'], ['companion', '🌼 Companion']], mode,
            (v) => { save('sangiMode', v); ctx.rerender(); }),
          select(LANGUAGES, ctx.state.language, { 'aria-label': 'Language', style: { width: 'auto' }, onchange: (e) => { ctx.setLanguage(e.target.value); ctx.rerender(); } }),
          h('button', {
            type: 'button', class: 'btn small',
            onclick: async () => {
              if (!(await confirmDialog('Clear this conversation?', { okLabel: 'Clear' }))) return;
              history = [];
              save(storeKey, history);
              draw();
            },
          }, 'Clear'))),
      !isPatient && mode === 'caregiver' ? h('p', { class: 'small muted', style: { margin: 0 } }, 'General care tips, not medical advice. In an emergency call 108 or 112.') : null,
      !isPatient && mode === 'companion' ? h('p', { class: 'small muted', style: { margin: 0 } }, `Try it the way ${name} would talk. In patient mode, replies are read aloud.`) : null),
    log,
    h('div', {}, suggestions, composer)));
  draw();
}
