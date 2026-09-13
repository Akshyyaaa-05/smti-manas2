import { api, readText } from '../api.js';
import { lineChart } from '../charts.js';
import { empty, fmtDay, fmtTime, h, pct, toast } from '../ui.js';

export const GAMES = [
  {
    key: 'haat', folder: 'haat-bazaar', title: 'Haat Bazaar', subtitle: 'Market memory game', art: '🧺',
    about: 'Remember a short shopping list, visit the right stalls (vegetables, grocery, fish, craft and handloom) and pick things like King Chilli, Assam Tea and a Gamosa.',
    trains: 'Working memory · attention', project: 'Dimentia_Memory_Game', log: 'market_telemetry.jsonl',
  },
  {
    key: 'tator', folder: 'tator-gatha', title: 'Tator Gatha', subtitle: 'Loom pattern game', art: '🧵',
    about: 'Copy the colour pattern on the loom, one thread at a time.',
    trains: 'Sequencing · visual memory', project: 'Tator Gatha', log: 'loom_telemetry.jsonl',
  },
];

function playGame(ctx, game) {
  const patient = ctx.patient;
  const quiet = ctx.state.role === 'patient';
  let buffered = [];
  const url = '/api/games/results';
  const payload = (records) => ({ patientId: patient.id, game: game.key, records, source: 'portal' });
  const frame = h('iframe', { src: `/games/${game.folder}/index.html`, title: game.title, allow: 'autoplay; fullscreen; microphone; cross-origin-isolated' });

  // Games talk to the portal with window.parent.postMessage (see public/games/portal_bridge.gd).
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.source !== 'manas-game') return;
    if (msg.type === 'session') {
      api.post(url, payload([msg.payload])).catch((err) => toast(err.message, 'error'));
    } else if (msg.type === 'event') {
      buffered.push(msg.payload);
    }
  };
  const flushOnExit = () => {
    if (buffered.length) navigator.sendBeacon(url, new Blob([JSON.stringify(payload(buffered))], { type: 'application/json' }));
    buffered = [];
  };
  const close = async () => {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('pagehide', flushOnExit);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    overlay.remove();
    if (buffered.length) {
      try {
        const res = await api.post(url, payload(buffered));
        if (!quiet) toast(`Saved ${res.added} ${game.title} session${res.added === 1 ? '' : 's'}.`, 'success');
      } catch (err) { toast(err.message, 'error'); }
    }
    ctx.rerender();
  };
  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', flushOnExit);

  const overlay = h('div', { class: 'game-overlay', role: 'dialog', 'aria-label': game.title },
    h('div', { class: 'bar' }, h('strong', {}, `${game.art} ${game.title}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => overlay.requestFullscreen?.().catch(() => {}) }, '⛶ Full screen'),
        h('button', { class: 'btn small', onclick: close }, '✕ Close'))),
    frame);
  document.body.append(overlay);
  frame.focus();
}

function importButton(ctx) {
  const input = h('input', {
    type: 'file', accept: '.json,.jsonl,.txt', multiple: true, hidden: true,
    onchange: async () => {
      for (const file of input.files) {
        try {
          const res = await api.post('/api/games/results', { patientId: ctx.patient.id, text: await readText(file) });
          const title = GAMES.find((g) => g.key === res.game)?.title || res.game;
          toast(`${file.name}: added ${res.added} ${title} session${res.added === 1 ? '' : 's'}${res.skipped ? ` (${res.skipped} already imported)` : ''}.`, 'success', 6000);
        } catch (e) { toast(`${file.name}: ${e.message}`, 'error', 6000); }
      }
      input.value = '';
      ctx.rerender();
    },
  });
  return [h('button', { class: 'btn', onclick: () => input.click() }, '⬆ Import results file'), input];
}

const SOURCE = { portal: ['Played here', 'green'], import: ['Imported', 'blue'], demo: ['Demo', 'gold'] };
const duration = (ms) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '–');

function progress(game, sessions) {
  const mine = sessions.filter((s) => s.game === game.key).sort((a, b) => a.startedAt - b.startedAt);
  if (!mine.length) return h('p', { class: 'muted' }, 'No sessions yet.');
  const last = mine.slice(-12);
  return h('div', { class: 'stack' },
    lineChart({
      title: `${game.title} accuracy`, yMin: 0, yMax: 1, ticks: [0, 0.5, 1], color: '#2f7a4f', formatY: (v) => pct(v), width: 760, height: 190,
      points: last.map((s) => ({ label: fmtDay(s.startedAt, { day: 'numeric', month: 'short' }), y: s.accuracy ?? null })),
    }),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['When', 'Source', 'Time taken', 'Right / wrong', 'Accuracy', 'Avg. response', 'Finished'].map((t) => h('th', {}, t)))),
      h('tbody', {}, [...mine].reverse().slice(0, 10).map((s) => h('tr', {},
        h('td', {}, `${fmtDay(s.startedAt)} ${fmtTime(s.startedAt)}`),
        h('td', {}, h('span', { class: `chip ${(SOURCE[s.source] || SOURCE.import)[1]}` }, (SOURCE[s.source] || SOURCE.import)[0])),
        h('td', {}, duration(s.durationMs)),
        h('td', {}, `${s.correct ?? '–'} / ${s.wrong ?? '–'}`),
        h('td', {}, pct(s.accuracy)),
        h('td', {}, s.meanReactionMs ? `${(s.meanReactionMs / 1000).toFixed(1)} s` : '–'),
        h('td', {}, s.completed ? '✓' : '–')))))));
}

function setupGuide() {
  return h('section', { class: 'panel', style: { marginTop: '1rem' } },
    h('h2', {}, 'Adding the games'),
    h('p', {}, 'The portal plays each game from ', h('code', {}, 'public/games/<folder>/index.html'), '. Both games are Godot projects, so export them for the Web once:'),
    h('details', { class: 'steps' }, h('summary', {}, 'Export a Godot game into the portal'),
      h('ol', {},
        h('li', {}, 'Open the project in Godot 4.'),
        h('li', {}, 'Switch the renderer to ', h('strong', {}, 'Compatibility'), ' (top-right of the editor). Browsers cannot run Forward+.'),
        h('li', {}, h('strong', {}, 'Editor → Manage Export Templates → Download and Install'), ' (only once).'),
        h('li', {}, h('strong', {}, 'Project → Export → Add… → Web'), ', then Export Project into ', h('code', {}, 'manas-portal/public/games/haat-bazaar/'), ' or ', h('code', {}, 'tator-gatha/'), ' and name the file ', h('code', {}, 'index.html'), '.'),
        h('li', {}, 'Optional: to send results here automatically, add ', h('a', { href: '/games/portal_bridge.gd', target: '_blank' }, 'portal_bridge.gd'), ' as an Autoload called PortalBridge. The ', h('a', { href: '/games/README.md', target: '_blank' }, 'games README'), ' shows the one line to add to each game.'),
        h('li', {}, 'Refresh this page and press Play.'))),
    h('details', { class: 'steps' }, h('summary', {}, 'Import results from games played on a computer'),
      h('p', {}, 'When the games run on Windows they save results here. Use “Import results file” above:'),
      h('ul', {},
        h('li', {}, h('code', {}, '%APPDATA%\\Godot\\app_userdata\\Dimentia_Memory_Game\\market_telemetry.jsonl')),
        h('li', {}, h('code', {}, '%APPDATA%\\Godot\\app_userdata\\Tator Gatha\\loom_telemetry.jsonl'))),
      h('p', { class: 'small muted' }, 'Haat Bazaar logs game time rather than clock time, so its sessions are dated when they reach the portal.')));
}

export async function render(root, ctx) {
  const isPatient = ctx.state.role === 'patient';
  await ctx.refreshStatus();
  const installed = ctx.state.status.games || {};

  if (isPatient) {
    root.append(h('div', { class: 'me-greeting' }, h('h1', {}, 'Choose a game')),
      h('div', { class: 'me-buttons' }, GAMES.map((g) => installed[g.key]
        ? h('button', { class: 'me-button play', onclick: () => playGame(ctx, g) }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, g.art), g.title)
        : h('div', { class: 'me-button', style: { background: 'var(--surface-2)' } }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, g.art), g.title,
          h('span', { class: 'small muted' }, 'Coming soon')))));
    return;
  }

  const sessions = await api.get(`/api/sessions?patientId=${ctx.patient.id}`);
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Games'), h('p', {}, 'Two culturally familiar games. Results come back to this page for the care team.')),
    h('div', { class: 'row' }, importButton(ctx))));

  root.append(h('div', { class: 'stack' }, GAMES.map((g) => h('section', { class: 'panel stack' },
    h('div', { class: 'game-tile' },
      h('div', { class: `game-art ${g.key}`, 'aria-hidden': 'true' }, g.art),
      h('div', {},
        h('h2', { style: { marginBottom: '.1rem' } }, g.title), h('p', { class: 'muted' }, g.subtitle),
        h('p', {}, g.about),
        h('div', { class: 'row' }, h('span', { class: 'chip blue' }, g.trains),
          installed[g.key] ? h('span', { class: 'chip green' }, 'Installed') : h('span', { class: 'chip amber' }, 'Not installed yet')),
        h('div', { class: 'row', style: { marginTop: '.8rem' } }, installed[g.key]
          ? h('button', { class: 'btn primary', onclick: () => playGame(ctx, g) }, '▶ Play')
          : h('span', { class: 'small muted' }, `Export "${g.project}" to public/games/${g.folder}/`)))),
    h('h3', {}, 'Progress'),
    progress(g, sessions)))));

  if (ctx.isCaregiver) root.append(setupGuide());
  if (!sessions.length) root.append(empty('🎮', 'No results yet. Play a game here, or import a results file.'));
}
