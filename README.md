# MANAS Care Portal

A simple web portal for **SMTI-MANAS**: one place for the person living with dementia,
their caregivers and their family.

- **Patient profile**: details, medicines, emergency contacts, life story, likes and dislikes.
- **Caregiver monitoring**: a two-minute daily check-in (mood, sleep, meals, medicines,
  agitation, wandering, falls), 14-day charts, and a dashboard that flags what needs attention.
- **Family**: family members, and "share a memory" with a photo, story and optional voice message.
- **Cue cards**: made automatically from shared photos. Flip-card practice, read aloud, print.
- **Games**: slots for *Haat Bazaar* and *Tator Gatha*, with their results shown as progress.
- **Bhashini**: speak instead of typing, hear cards read aloud, and translate, in Assamese,
  Bengali, Hindi and more.
- **Sangi AI**: a helper that answers caregiver questions, or talks gently with the patient.
  Uses Claude when a key is set, and built-in offline answers otherwise.
- **Three ways in**: Caregiver, Family member, or Patient mode (big buttons, no scores,
  press-and-hold to exit).

## Run it

Needs Python 3.9 or newer. Nothing to install. From the `manas-portal` folder:

```
py server.py
```

Then open http://localhost:8000. On Windows you can also double-click `start.bat`.
To stop it, press Ctrl+C in that window (or close it).
Choose **Explore with demo data** to see every screen with a fictional family, or **Add a patient**.

## Switch on the extras

Copy `config.example.env` to `config.env`, fill in keys, restart.

| Feature | Needs |
|---|---|
| Bhashini voice + translation | `BHASHINI_USER_ID`, `BHASHINI_API_KEY` from bhashini.gov.in |
| Sangi on Claude | `py -m pip install -r requirements.txt` and `ANTHROPIC_API_KEY` |

Sangi uses `claude-opus-5` at low effort (short, quick replies) with Anthropic's server-side
refusal fallback turned on. Change it with `CLAUDE_MODEL` / `CLAUDE_EFFORT`.

Without Bhashini keys, the 🎤 buttons fall back to the browser's own speech recognition where
available (Chrome), and reading aloud uses the browser's voices.

**Language flow with Bhashini:** speech (Bhashini ASR) → translate to English (Bhashini) →
Sangi → translate back (Bhashini) → read aloud (Bhashini TTS).

## Adding the games

See [`public/games/README.md`](public/games/README.md). In short: fix three small bugs in the
Godot projects, switch them to the Compatibility renderer, export for Web into
`public/games/haat-bazaar/` and `public/games/tator-gatha/`, and optionally add
`portal_bridge.gd` so results flow back automatically. Results from games played on a computer
can also be imported from their `.jsonl` log files.

## Folders

```
server.py              web server + JSON API (Python standard library only)
services/
  store.py             JSON file storage (data/db.json)
  bhashini.py          Bhashini ULCA pipeline client (ASR, translation, TTS)
  sangi.py             Sangi: Claude via the anthropic SDK, with offline answers
  telemetry.py         reads Haat Bazaar / Tator Gatha logs into sessions
  demo.py              fictional demo family
public/                the web app (plain HTML, CSS, JavaScript modules)
  games/               game exports go here, plus the bridge script
data/                  created on first run: db.json and uploads/ (photos, voice notes)
```

## Good to know

- **No login yet.** The server only listens on this computer unless started with
  `--host 0.0.0.0`. Add authentication before real patients' data leaves one trusted machine.
- **Voice needs localhost.** Browsers only allow the microphone on `http://localhost` or HTTPS, so
  phones joining over Wi-Fi can share photos and text but not record voice.
- **Data stays local** in `data/`, except: voice clips and text sent for translation go to
  Bhashini, and Sangi chats (plus a short profile summary) go to Anthropic when Claude is on.
- **Machine translation** of cue cards is marked for review. A native speaker should check
  anything shown to the patient.
- **Not a medical device.** Game accuracy and check-in trends are for conversations with the
  health worker, not diagnosis.
- JSON storage suits a family or a single care centre. Move to the SMTI-MANAS SQLite schema for
  anything larger.
