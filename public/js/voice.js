// Voice in and out.
// In:  mic -> MediaRecorder -> 16 kHz mono WAV -> /api/bhashini/asr (Bhashini).
//      Without Bhashini keys, falls back to the browser's own speech recognition if it has one.
// Out: /api/bhashini/tts for Indian languages, else the browser's speech synthesis.
import { api } from './api.js';
import { h, toast } from './ui.js';

let status = { bhashini: false };
export function setVoiceStatus(next) { status = next || status; }

const BROWSER_LANG = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', as: 'as-IN', mni: 'mni-IN', ne: 'ne-NP', or: 'or-IN' };

const INSECURE_MESSAGE = 'Voice only works when the portal is opened at http://localhost on this computer. Phones on Wi-Fi would need HTTPS.';

export async function startRecording() {
  if (!window.isSecureContext) throw new Error(INSECURE_MESSAGE);
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record audio.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error('Please allow the microphone to use voice.');
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () => new Promise((resolve) => {
      recorder.onstop = () => { release(); resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })); };
      recorder.stop();
    }),
    cancel: () => { try { recorder.stop(); } catch { /* already stopped */ } release(); },
  };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function blobToWavBase64(blob, rate = 16000) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close();
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytesToBase64(new Uint8Array(view.buffer));
}

function setIdle(btn) {
  btn.classList.remove('recording');
  btn.disabled = false;
  btn.textContent = '🎤';
  btn.title = 'Speak instead of typing';
}

function setRecording(btn) {
  btn.classList.add('recording');
  btn.textContent = '■';
  btn.title = 'Stop recording';
}

// A mic button. onText receives what was heard, in the chosen language.
export function micButton({ getLanguage, onText }) {
  const btn = h('button', { type: 'button', class: 'btn icon-only', 'aria-label': 'Speak instead of typing' });
  setIdle(btn);
  let session = null;
  let recognition = null;

  btn.addEventListener('click', async () => {
    if (!window.isSecureContext) { toast(INSECURE_MESSAGE, 'error', 7000); return; }
    if (status.bhashini) {
      if (!session) {
        try { session = await startRecording(); } catch (e) { toast(e.message, 'error', 6000); return; }
        setRecording(btn);
        return;
      }
      const current = session;
      session = null;
      btn.classList.remove('recording');
      btn.textContent = '…';
      btn.disabled = true;
      try {
        const audio = await blobToWavBase64(await current.stop());
        const { text } = await api.post('/api/bhashini/asr', { audio, language: getLanguage() });
        if (text) onText(text); else toast("I didn't catch that. Please try again.");
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setIdle(btn);
      }
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      toast('Voice input needs Bhashini keys (see Settings) or a browser with speech recognition, like Chrome.', 'error', 6000);
      return;
    }
    if (recognition) { recognition.stop(); return; }
    recognition = new Recognition();
    recognition.lang = BROWSER_LANG[getLanguage()] || 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    recognition.onerror = (e) => toast(
      e.error === 'not-allowed' ? 'Please allow the microphone to use voice.'
        : e.error === 'language-not-supported' ? "This browser can't listen in that language. Bhashini (see Settings) covers more Indian languages."
          : e.error === 'no-speech' ? "I didn't hear anything. Please try again." : `Voice input stopped (${e.error}).`,
      'error', 6000);
    recognition.onend = () => { recognition = null; setIdle(btn); };
    setRecording(btn);
    recognition.start();
  });
  return btn;
}

// Wraps an input/textarea with a mic button that appends what was heard.
export function withMic(control, getLanguage) {
  const mic = micButton({
    getLanguage,
    onText: (text) => {
      control.value = control.value ? `${control.value.trimEnd()} ${text}` : text;
      control.dispatchEvent(new Event('input', { bubbles: true }));
    },
  });
  return h('div', { class: 'input-with-mic' }, control, mic);
}

// Speaks English text in the person's own language when Bhashini can translate it.
export async function speakTranslated(text, language = 'en') {
  if (status.bhashini && language !== 'en') {
    try {
      const { text: translated } = await api.post('/api/bhashini/translate', { text, source: 'en', target: language });
      if (translated) return speak(translated, language);
    } catch (e) {
      toast(`Bhashini translation unavailable: ${e.message}`, 'error');
    }
  }
  return speak(text, 'en');
}

let currentAudio = null;

export async function speak(text, language = 'en') {
  if (!text) return;
  currentAudio?.pause();
  if (status.bhashini && language !== 'en') {
    try {
      const { audio } = await api.post('/api/bhashini/tts', { text, language });
      if (audio) {
        currentAudio = new Audio(`data:audio/wav;base64,${audio}`);
        await currentAudio.play();
        return;
      }
    } catch (e) {
      toast(`Bhashini voice unavailable: ${e.message}`, 'error');
    }
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = BROWSER_LANG[language] || 'en-IN';
    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
  } else {
    toast('Reading aloud is not available in this browser.', 'error');
  }
}
