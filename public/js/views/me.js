// Patient mode home: three big buttons, today's date, no scores anywhere.
import { fmtTime, greeting, h, isNight } from '../ui.js';
import { speakTranslated } from '../voice.js';

export async function render(root, ctx) {
  const patient = ctx.patient;
  const name = patient.preferredName || patient.name.split(' ')[0];
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const night = isNight();
  const sentence = `${greeting()}, ${name}. Today is ${today}.${night ? ' It is night-time, time to rest.' : ''}`;

  root.append(
    h('div', { class: 'me-greeting' },
      patient.photo ? h('img', { class: 'avatar lg', src: patient.photo, alt: '', style: { margin: '0 auto 1rem' } }) : null,
      h('h1', {}, `${greeting()}, ${name}`),
      h('p', { class: 'today' }, `${today} · ${fmtTime(Date.now())}`),
      night ? h('p', { class: 'today' }, '🌙 It is night-time. Time to rest.') : null,
      h('button', { type: 'button', class: 'btn big', onclick: () => speakTranslated(sentence, patient.language || 'en') }, '🔊 Read aloud')),
    h('nav', { class: 'me-buttons', 'aria-label': 'Choose' },
      h('a', { class: 'me-button people', href: '#/cards/practice' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '👨‍👩‍👧'), 'My people'),
      h('a', { class: 'me-button play', href: '#/games' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '🧺'), 'Play a game'),
      h('a', { class: 'me-button talk', href: '#/sangi' }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, '💬'), 'Talk to Sangi')),
  );
}
