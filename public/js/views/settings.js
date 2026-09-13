import { api, readText } from '../api.js';
import { confirmDialog, h, toast, todayStr } from '../ui.js';
import { GAMES } from './games.js';

function statusChip(ok, okText, notText) {
  return h('span', { class: `chip ${ok ? 'green' : 'amber'}` }, ok ? `✓ ${okText}` : notText);
}

function busy(fn) {
  return async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await fn(e); } finally { btn.disabled = false; }
  };
}

export async function render(root, ctx) {
  await ctx.refreshStatus();
  const s = ctx.state.status;
  const patient = ctx.patient;

  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'), h('p', {}, 'Connections, games and your data.'))));

  const bhashiniOut = h('p', { class: 'small' });
  const sangiOut = h('p', { class: 'small' });

  root.append(h('div', { class: 'grid two' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Bhashini'), statusChip(s.bhashini, 'Connected', 'Not set up')),
      h('p', {}, 'Listens and speaks in Assamese, Bengali, Hindi and other Indian languages, and translates cue cards and Sangi replies.'),
      s.bhashini ? null : h('ol', {},
        h('li', {}, 'Register on ', h('a', { href: 'https://bhashini.gov.in', target: '_blank', rel: 'noopener' }, 'bhashini.gov.in'), ' and generate a ULCA API key from your profile.'),
        h('li', {}, 'In the ', h('code', {}, 'manas-portal'), ' folder, copy ', h('code', {}, 'config.example.env'), ' to ', h('code', {}, 'config.env'), '.'),
        h('li', {}, 'Fill in ', h('code', {}, 'BHASHINI_USER_ID'), ' and ', h('code', {}, 'BHASHINI_API_KEY'), ', then restart the server.')),
      h('button', {
        class: 'btn', disabled: !s.bhashini,
        onclick: busy(async () => {
          const target = patient?.language && patient.language !== 'en' ? patient.language : 'as';
          try {
            const res = await api.post('/api/bhashini/translate', { text: 'Good morning. Did you sleep well?', source: 'en', target });
            bhashiniOut.textContent = `✓ ${res.text}`;
          } catch (err) { bhashiniOut.textContent = `✗ ${err.message}`; }
        }),
      }, 'Test translation'),
      bhashiniOut,
      h('p', { class: 'small muted' }, "Without Bhashini, the 🎤 buttons use the browser's own speech recognition where it exists (Chrome sends that audio to Google).")),

    h('section', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Sangi AI'),
        statusChip(s.claude, `Claude · ${s.claudeModel}`, s.claudeSdk ? 'Needs an API key' : 'Offline replies')),
      h('p', {}, 'Sangi answers caregiver questions and talks gently with the patient. Without Claude it uses a small set of built-in offline answers.'),
      s.claude ? null : h('ol', {},
        s.claudeSdk ? null : h('li', {}, 'Install the Claude library: ', h('code', {}, 'py -m pip install -r requirements.txt')),
        h('li', {}, 'Add ', h('code', {}, 'ANTHROPIC_API_KEY=…'), ' to ', h('code', {}, 'config.env'), ' (keys come from console.anthropic.com).'),
        h('li', {}, 'Restart the server.')),
      h('button', {
        class: 'btn', disabled: !patient,
        onclick: busy(async () => {
          try {
            const res = await api.post('/api/sangi/chat', {
              patientId: patient.id, mode: 'caregiver', language: 'en',
              messages: [{ role: 'user', content: 'Please say hello to the caregiver in one short sentence.' }],
            });
            sangiOut.textContent = `${res.source === 'claude' ? '✓ Claude' : 'Offline'}: ${res.reply}${res.note ? ` · ${res.note}` : ''}`;
          } catch (err) { sangiOut.textContent = `✗ ${err.message}`; }
        }),
      }, 'Test Sangi'),
      sangiOut,
      h('p', { class: 'small muted' }, "When Claude is on, chat messages and a short summary of the patient's profile are sent to Anthropic to write the replies.")),

    h('section', { class: 'panel stack' },
      h('div', { class: 'row between' }, h('h2', { style: { margin: 0 } }, 'Games'), h('a', { href: '#/games' }, 'Open games')),
      GAMES.map((g) => h('div', { class: 'row between' }, h('span', {}, `${g.art} ${g.title}`),
        statusChip(s.games?.[g.key], 'Installed', `Not installed · public/games/${g.folder}/`)))),

    h('section', { class: 'panel stack' },
      h('h2', {}, 'Your data'),
      h('p', {}, 'Everything is stored on this computer, in ', h('code', {}, 'manas-portal/data/'), '.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn',
          onclick: busy(async () => {
            const data = await api.get('/api/backup');
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
            const a = h('a', { href: url, download: `manas-backup-${todayStr()}.json` });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }),
        }, '⬇ Download backup'),
        (() => {
          const input = h('input', {
            type: 'file', accept: '.json', hidden: true,
            onchange: async () => {
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              try {
                const data = JSON.parse(await readText(file));
                if (!(await confirmDialog('Replace ALL current portal data with this backup?', { okLabel: 'Replace', danger: true }))) return;
                await api.post('/api/backup', { data });
                await ctx.refreshPatients();
                toast('Backup restored.', 'success');
                ctx.navigate('home');
              } catch (err) { toast(err instanceof SyntaxError ? 'That file is not a portal backup.' : err.message, 'error'); }
            },
          });
          return [h('button', { class: 'btn', onclick: () => input.click() }, '⬆ Restore backup'), input];
        })()),
      h('p', { class: 'small muted' }, 'The backup holds the records. Photos and voice messages live in data/uploads/ — copy that folder too.'),
      h('div', { class: 'row' }, s.hasDemo
        ? h('button', {
          class: 'btn danger',
          onclick: busy(async () => {
            if (!(await confirmDialog('Remove the demo family and everything attached to it? Real patients are not touched.', { okLabel: 'Remove demo', danger: true }))) return;
            await api.post('/api/demo/remove');
            await Promise.all([ctx.refreshPatients(), ctx.refreshStatus()]);
            toast('Demo data removed.');
            ctx.navigate('home');
          }),
        }, 'Remove demo data')
        : h('button', {
          class: 'btn gold',
          onclick: busy(async () => {
            await api.post('/api/demo/seed');
            await Promise.all([ctx.refreshPatients(), ctx.refreshStatus()]);
            toast('Demo family loaded.', 'success');
            ctx.rerender();
          }),
        }, 'Load demo data'))),

    h('section', { class: 'panel stack' },
      h('h2', {}, 'Sharing and safety'),
      h('p', {}, 'The portal has no login yet, so by default it only opens on this computer.'),
      h('p', {}, 'To let family on the same Wi-Fi use it, start it with ', h('code', {}, 'py server.py --host 0.0.0.0'), ' and open this computer’s address on their phone. Only do this on a network you trust.'),
      h('p', {}, 'Phones joining this way can share photos and stories, but browsers only allow the microphone on localhost or HTTPS, so voice works on this computer only.'),
      h('p', { class: 'small muted' }, 'SMTI-MANAS is a prototype for engagement and monitoring. It is not a medical device and does not diagnose.'))));
}
