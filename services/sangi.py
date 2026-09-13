"""Sangi - the portal's AI helper.

Two modes:
  caregiver  - practical daily-care answers for family and caregivers
  companion  - very short, gentle conversation with the person themself

Uses Claude through the official `anthropic` SDK when it is installed and
ANTHROPIC_API_KEY is set. Otherwise (or if the call fails) it answers from a
small offline rulebook, so the portal still works with no internet.
"""
import os
import re
from datetime import datetime

try:
    import anthropic
except ImportError:  # the portal runs without it; Sangi just stays offline
    anthropic = None

LANGUAGE_NAMES = {
    "en": "English", "as": "Assamese", "bn": "Bengali", "hi": "Hindi",
    "mni": "Manipuri", "ne": "Nepali", "or": "Odia",
}

CAREGIVER_PROMPT = """You are Sangi, a helper inside the SMTI-MANAS care portal. You support family members and caregivers looking after an older person living with dementia in Northeast India.

How to answer:
- Keep it short: at most five sentences, or up to five short bullet points. No headings.
- Give practical, everyday care suggestions in plain, warm language.
- You are not a doctor. Do not diagnose, and never suggest starting, stopping or changing a medicine or dose - say to ask their doctor.
- If anything sounds like an emergency (a fall with injury, chest pain, trouble breathing, not waking up, sudden weakness or confusion), tell them first to call 108 for an ambulance or 112.
- If the caregiver sounds exhausted or distressed, acknowledge it and mention Tele-MANAS, the free 24x7 mental health helpline: 14416.
- Use the patient details below when they help. Never invent facts about the patient or the family."""

COMPANION_PROMPT = """You are Sangi, a gentle companion talking directly with an older person living with dementia.

How to talk:
- One or two short, simple sentences per reply. One idea at a time.
- Be warm and patient. Never quiz or test them, and never say things like "you forgot" or "I already told you".
- If they seem unsure about the day or where they are, reassure them calmly using the details below.
- If they mention pain, a fall, feeling unwell or being scared, kindly ask them to call their caregiver now.
- Talk about the people, places and things they love, using the details below. Never invent memories or people."""

CUE_PROMPT = """Write the back of a memory cue card for an older person living with dementia.
Rules: one or two short sentences, 25 words at most, present tense, warm and simple. Say who or what it is and add one happy detail from the notes. Do not ask questions or test their memory. Reply with the card text only."""


def _patient_context(patient, people, mode):
    if not patient:
        return "No patient profile has been filled in yet."
    now = datetime.now()
    lines = [
        f"Name: {patient.get('preferredName') or patient.get('name', 'unknown')}",
        f"Today: {now.strftime('%A, %d %B %Y')}, {now.strftime('%I:%M %p').lstrip('0')}",
    ]
    for label, key in (("Age", "age"), ("Lives in", "region"), ("Likes", "likes"),
                       ("Dislikes or upsets them", "dislikes")):
        if patient.get(key):
            lines.append(f"{label}: {patient[key]}")
    if patient.get("lifeStory"):
        lines.append(f"Life story: {patient['lifeStory'][:600]}")
    if people:
        lines.append("People and things on their cue cards: " + "; ".join(people[:15]))
    contacts = patient.get("emergencyContacts") or []
    if contacts:
        c = contacts[0]
        lines.append(f"Main caregiver contact: {c.get('name', '')} ({c.get('relation', '')}) {c.get('phone', '')}")
    if mode == "caregiver":
        if patient.get("diagnosis"):
            lines.append(f"Diagnosis noted by family: {patient['diagnosis']} {patient.get('stage', '')}".strip())
        meds = patient.get("medications") or []
        if meds:
            lines.append("Medicines on record: " + "; ".join(
                f"{m.get('name', '')} {m.get('dose', '')} at {m.get('time', '')}".strip() for m in meds))
    return "\n".join(lines)


def _clean_history(messages):
    cleaned = []
    for m in messages[-16:]:
        role, content = m.get("role"), str(m.get("content", "")).strip()[:2000]
        if role in ("user", "assistant") and content:
            cleaned.append({"role": role, "content": content})
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)
    return cleaned


class Sangi:
    def __init__(self, model=None, effort=None):
        self.model = model or "claude-opus-5"
        self.effort = effort or "low"
        self._client = None

    @property
    def sdk_installed(self):
        return anthropic is not None

    @property
    def configured(self):
        has_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        return bool(self.sdk_installed and has_key)

    def _claude(self, system, messages):
        """Returns (text, note). Raises nothing; on failure text is None and note says why."""
        if not self.configured:
            if not self.sdk_installed:
                return None, "Offline replies (install the anthropic package to use Claude)."
            return None, "Offline replies (add ANTHROPIC_API_KEY to config.env to use Claude)."
        if self._client is None:
            self._client = anthropic.Anthropic()
        try:
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": self.effort},
                system=system,
                messages=messages,
            )
        except anthropic.AuthenticationError:
            return None, "Claude rejected the API key - using offline replies."
        except anthropic.PermissionDeniedError:
            return None, "This API key cannot use that model - using offline replies."
        except anthropic.NotFoundError:
            return None, f"Model '{self.model}' was not found - check CLAUDE_MODEL. Using offline replies."
        except anthropic.RateLimitError:
            return None, "Claude is busy (rate limited) - using offline replies for now."
        except anthropic.BadRequestError as e:
            return None, f"Claude could not process that ({e.message}) - using offline replies."
        except anthropic.APIStatusError as e:
            return None, f"Claude had a problem ({e.status_code}) - using offline replies."
        except anthropic.APIConnectionError:
            return None, "Could not reach Claude (no internet?) - using offline replies."

        if response.stop_reason == "refusal":
            return "I'm not able to help with that one. Could you ask it another way?", None
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return (text or None), (None if text else "Claude sent an empty reply - using offline replies.")

    def chat(self, messages, patient, people, mode="caregiver", reply_language="en"):
        """Returns {reply, source, note}. `reply_language` is the language Claude should answer in."""
        history = _clean_history(messages)
        if not history:
            return {"reply": "Namaskar! How can I help?", "source": "offline", "note": None}
        base = COMPANION_PROMPT if mode == "companion" else CAREGIVER_PROMPT
        system = f"{base}\n\nPatient details:\n{_patient_context(patient, people, mode)}"
        if reply_language != "en":
            system += f"\n\nReply in {LANGUAGE_NAMES.get(reply_language, reply_language)}, using simple everyday words."
        text, note = self._claude(system, history)
        if text:
            return {"reply": text, "source": "claude", "note": note}
        return {"reply": offline_reply(history[-1]["content"], patient, people, mode),
                "source": "offline", "note": note}

    def suggest_cue(self, memory, patient):
        """Returns (cue_text, source)."""
        facts = {
            "Category": memory.get("category"),
            "Name": memory.get("personName"),
            "Relation to the person": memory.get("relation"),
            "Caption": memory.get("caption"),
            "Notes from family": memory.get("story"),
            "Card is for": (patient or {}).get("preferredName") or (patient or {}).get("name"),
        }
        notes = "\n".join(f"{k}: {v}" for k, v in facts.items() if v)
        text, _ = self._claude(CUE_PROMPT, [{"role": "user", "content": notes}])
        if text:
            return text.strip().strip('"'), "claude"
        return template_cue(memory), "template"


def _mid_sentence(text, always=False):
    """'Your gamosa' -> 'your gamosa' so it reads well after 'This is'; names keep their capitals."""
    words = text.split(" ", 1)
    if words[0] and (always or words[0].lower() in ("your", "the", "our", "my", "a", "an", "his", "her", "their")):
        return words[0].lower() + (" " + words[1] if len(words) > 1 else "")
    return text


def template_cue(memory):
    name = (memory.get("personName") or "").strip()
    relation = (memory.get("relation") or "").strip()
    caption = (memory.get("caption") or "").strip().rstrip(".")
    story = (memory.get("story") or "").strip()
    first = re.split(r"(?<=[.!?])\s+", story)[0].rstrip(".") if story else ""
    category = memory.get("category") or "person"
    if category == "person" and name:
        base = f"This is {name}, your {relation}." if relation else f"This is {name}."
    elif category == "routine":
        base = f"Now it is time to {_mid_sentence(caption, always=True) or 'rest'}."
    else:
        base = f"This is {_mid_sentence(caption or name) or 'a happy memory'}."
    return f"{base} {first}.".strip() if first else base


# ----------------------------------------------------------------- offline rulebook

def _has(text, *words):
    return any(re.search(rf"\b{w}", text) for w in words)


def _find_person(text, people_rows):
    for row in people_rows:
        name = (row.get("name") or "").lower().split()
        if name and re.search(rf"\b{re.escape(name[0])}\b", text):
            return row
    return None


def offline_reply(message, patient, people, mode):
    text = message.lower()
    p = patient or {}
    name = p.get("preferredName") or p.get("name") or "friend"
    contacts = p.get("emergencyContacts") or []
    helper = contacts[0].get("name") if contacts else "your caregiver"
    rows = [dict(zip(("name", "detail"), s.split(" - ", 1))) for s in people if " - " in s]
    now = datetime.now()

    if _has(text, "fell", "fallen", "had a fall", "chest pain", "can't breathe", "cannot breathe",
            "trouble breathing", "not breathing", "unconscious", "not waking", "stroke", "bleeding", "seizure"):
        if mode == "companion":
            return f"I am sorry you are hurting, {name}. Please call {helper} right now. You are not alone."
        return ("This could be an emergency. Call 108 for an ambulance (or 112) now. "
                "Stay with them, keep them still if they fell, and don't give food or drink until help arrives.")

    person = _find_person(text, rows)
    if person and (mode == "companion" or _has(text, "who", "remember")):
        return f"{person['name']} is {person['detail']}."

    if mode == "companion":
        if _has(text, "day", "date", "time", "today", "where am i", "where is this"):
            place = f" You are at home in {p['region']}." if p.get("region") else ""
            return f"Today is {now.strftime('%A, %d %B')}.{place} You are safe."
        if _has(text, "pain", "hurt", "scared", "afraid", "unwell", "sick", "dizzy"):
            return f"I am sorry, {name}. Let's call {helper} now so they can help you."
        if _has(text, "family", "my people", "children", "grandchild") and rows:
            names = " ".join(f"{r['name']} is {r['detail']}." for r in rows[:3])
            return f"Your family loves you very much. {names}"
        if _has(text, "sad", "lonely", "alone", "miss"):
            family = ", ".join(r["name"] for r in rows[:2])
            extra = f" {family} love you very much." if family else ""
            return f"I am here with you, {name}.{extra} Shall we look at your photos together?"
        if _has(text, "hello", "hi", "namaskar", "namaste", "good morning", "good evening"):
            return f"Namaskar, {name}! It is lovely to talk with you. How are you feeling today?"
        if _has(text, "thank"):
            return "You are most welcome. I am happy to be with you."
        if _has(text, "bored", "nothing to do", "play", "game"):
            return "Would you like to play the market game, or the loom game?"
        likes = (p.get("likes") or "").split(",")[0].strip()
        if likes:
            return f"I am here with you. Shall we talk about {likes}?"
        return "I am here with you. Would you like to look at photos of your family?"

    if _has(text, "tired", "exhausted", "stress", "burn", "overwhelm", "can't cope", "cannot cope",
            "depress", "cry", "alone"):
        return ("Caring every day is hard, and feeling worn out is common. Try to take a short break "
                "daily and ask one family member to share a task. If it feels like too much, call Tele-MANAS "
                "on 14416 - free, 24x7, in your language.")
    if _has(text, "medicine", "medication", "tablet", "pill", "dose", "dawai", "dawa"):
        meds = p.get("medications") or []
        listing = "; ".join(f"{m.get('name')} at {m.get('time')}" for m in meds if m.get("name"))
        start = f"On record: {listing}. " if listing else ""
        return (start + "Give medicines at the same time each day and tick them in Daily Care. "
                "Never change or stop a dose without the doctor.")
    if _has(text, "agitat", "angry", "aggress", "shout", "sundown", "restless", "upset", "irritat"):
        return ("Stay calm and speak slowly; don't argue or correct. Check for simple causes - pain, hunger, "
                "toilet, noise or tiredness. Evenings are often harder: keep lights on, reduce noise, and "
                "try familiar music or a cup of tea together.")
    if _has(text, "wander", "lost", "walks out", "leave the house", "run away", "door"):
        return ("Keep a recent photo and an ID card with a phone number on them. Put a simple bell on the door, "
                "go for a daily walk together, and tell trusted neighbours. If they go missing, call 112 at once.")
    if _has(text, "sleep", "night", "awake", "insomnia"):
        return ("Keep the same wake and bed times, get daylight in the morning, and limit tea after 3 pm. "
                "A short evening routine helps. Log sleep in Daily Care so you can spot patterns.")
    if _has(text, "eat", "food", "meal", "appetite", "swallow", "drink", "water", "thirst"):
        return ("Offer small, soft meals they already like, one dish at a time, and sit and eat together. "
                "Offer water often. Coughing while swallowing or weight loss should go to the doctor.")
    if _has(text, "repeat", "same question", "again and again", "keeps asking"):
        return ("Answer calmly, as if it's the first time - they aren't doing it on purpose. A simple written note "
                "or a cue card with the answer can help, and so can gently changing the activity.")
    if _has(text, "bath", "wash", "hygiene", "toilet", "incontinen"):
        return ("Keep the bathroom warm and private, explain one step at a time, and let them do what they can. "
                "A regular toilet schedule every 2-3 hours reduces accidents.")
    if _has(text, "activity", "bored", "engage", "game", "exercise"):
        return ("Short, familiar activities work best: the Haat Bazaar or Tator Gatha games, looking at cue cards, "
                "folding a gamosa, songs they know, or a walk. Stop before they tire.")
    if _has(text, "hello", "hi", "namaskar", "namaste"):
        return f"Namaskar! I can help with caring for {name}. What would you like to talk about?"
    return ("I can help with sleep, eating, agitation, wandering, medicines, bathing, activities and caregiver "
            "stress. Tell me a little about what's happening today.")
