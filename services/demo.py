"""Demo data so the portal can be shown before real families use it.

Everything created here is fictional and tagged demo=True / source="demo".
Pictures are simple generated drawings, not photos of real people.
"""
import os
import random
import time

DAY_MS = 24 * 60 * 60 * 1000


def _portrait(path, bg, skin, hair, shirt, long_hair=False):
    hair_back = '<rect x="118" y="150" width="164" height="150" rx="60" fill="{0}"/>'.format(hair) if long_hair else ""
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" fill="{bg}"/>
{hair_back}
<path d="M60 400 Q70 268 200 258 Q330 268 340 400Z" fill="{shirt}"/>
<rect x="178" y="222" width="44" height="50" rx="14" fill="{skin}"/>
<circle cx="200" cy="170" r="78" fill="{skin}"/>
<path d="M122 160 Q124 84 200 82 Q276 84 278 160 Q256 118 200 116 Q144 118 122 160Z" fill="{hair}"/>
<circle cx="172" cy="175" r="7" fill="#2b2118"/><circle cx="228" cy="175" r="7" fill="#2b2118"/>
<path d="M172 208 Q200 230 228 208" stroke="#2b2118" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)


def _scene(path, top, bottom, emoji):
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<text x="200" y="250" font-size="170" text-anchor="middle">{emoji}</text>
</svg>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(svg)


def seed(store, uploads_dir):
    rng = random.Random(7)
    now = int(time.time() * 1000)
    os.makedirs(uploads_dir, exist_ok=True)

    def pic(name, maker, *args, **kwargs):
        maker(os.path.join(uploads_dir, name), *args, **kwargs)
        return f"/uploads/{name}"

    patient = store.insert("patients", {
        "demo": True,
        "name": "Hemanta Bora",
        "preferredName": "Hemanta",
        "age": 74,
        "gender": "Male",
        "region": "Jorhat, Assam",
        "language": "as",
        "photo": pic("demo_hemanta.svg", _portrait, "#f3e3c3", "#c99a6b", "#e8e8e8", "#7a2e2e"),
        "diagnosis": "Alzheimer's disease",
        "stage": "early to moderate",
        "doctor": "Dr. R. Saikia (demo)",
        "doctorPhone": "+91 90000 00009",
        "medications": [
            {"name": "Amlodipine", "dose": "5 mg", "time": "8:00 AM"},
            {"name": "Donepezil", "dose": "5 mg", "time": "9:00 PM"},
        ],
        "allergies": "None known",
        "emergencyContacts": [{"name": "Anil Bora", "relation": "Son", "phone": "+91 90000 00001"}],
        "likes": "Assam tea, Bihu songs, his lemon tree, cricket on the radio",
        "dislikes": "Loud TV, being rushed, crowded places",
        "lifeStory": ("Worked 32 years in a tea estate office near Jorhat. Married to Anjali for 45 years. "
                      "Loves looking after his garden and sings Bihu songs at every family gathering."),
        "notes": "Most settled in the mornings. Gets restless after 6 PM.",
    })
    pid = patient["id"]

    family = store.insert_many("family", [
        {"demo": True, "patientId": pid, "name": "Anil Bora", "relation": "Son", "phone": "+91 90000 00001",
         "photo": pic("demo_anil.svg", _portrait, "#d9ecf2", "#b98158", "#1f1a17", "#2f6f8f")},
        {"demo": True, "patientId": pid, "name": "Priya Bora", "relation": "Granddaughter", "phone": "+91 90000 00002",
         "photo": pic("demo_priya.svg", _portrait, "#fbe0e6", "#c28a5f", "#221a16", "#b03a5b", long_hair=True)},
        {"demo": True, "patientId": pid, "name": "Anjali Bora", "relation": "Wife", "phone": "+91 90000 00003",
         "photo": pic("demo_anjali.svg", _portrait, "#e7f0dc", "#b5835c", "#9a9a9a", "#c8a13a", long_hair=True)},
    ])
    by_name = {f["name"]: f for f in family}

    memories = [
        {"category": "person", "personName": "Priya Bora", "relation": "granddaughter", "caption": "Priya at Bihu",
         "story": "Priya studies in Guwahati and comes home every Bihu to dance with you.", "uploadedBy": "Priya Bora"},
        {"category": "person", "personName": "Anjali Bora", "relation": "wife", "caption": "Anjali",
         "story": "Anjali makes your favourite til pitha. You have been married for 45 years.", "uploadedBy": "Anil Bora"},
        {"category": "person", "personName": "Anil Bora", "relation": "son", "caption": "Anil",
         "story": "Anil lives with you and takes you to the market every Sunday.", "uploadedBy": "Anil Bora"},
        {"category": "place", "caption": "Your home in Jorhat",
         "story": "The house with the lemon tree you planted.", "uploadedBy": "Anil Bora",
         "photo": pic("demo_home.svg", _scene, "#bfe3f5", "#9fd18b", "\U0001F3E1")},
        {"category": "routine", "caption": "Drink your morning tea",
         "story": "Assam tea with a little milk, in your blue cup.", "uploadedBy": "Anjali Bora",
         "photo": pic("demo_tea.svg", _scene, "#fff1d6", "#e2b77a", "\U0001F375")},
        {"category": "object", "caption": "Your gamosa",
         "story": "Anjali wove this gamosa for you.", "uploadedBy": "Anjali Bora",
         "photo": pic("demo_gamosa.svg", _scene, "#fdf6ec", "#e9d3b5", "\U0001F9E3")},
    ]
    from .sangi import template_cue
    fronts = {"person": "Who is this?", "place": "Where is this?", "object": "What is this?",
              "routine": "What do we do now?", "event": "Do you remember this day?"}
    for i, m in enumerate(memories):
        m.update({"demo": True, "patientId": pid})
        if m["category"] == "person":
            m["photo"] = by_name[m["personName"]]["photo"]
            m["familyId"] = by_name[m["personName"]]["id"]
        mem = store.insert("memories", m)
        shown = rng.randint(4, 12)
        remembered = rng.randint(1, shown)
        card = store.insert("cards", {
            "demo": True, "patientId": pid, "memoryId": mem["id"], "category": m["category"],
            "photo": m["photo"], "title": m.get("personName") or m["caption"],
            "relation": m.get("relation", ""), "front": fronts[m["category"]],
            "cue": template_cue(m), "cueLocal": "", "cueSource": "template",
            "stats": {"shown": shown, "remembered": remembered, "notYet": shown - remembered,
                      "lastShown": now - rng.randint(0, 3) * DAY_MS},
        })
        store.update("memories", mem["id"], {"cardId": card["id"]})

    checkins = []
    for day in range(13, -1, -1):
        evening_trouble = rng.random() < 0.35
        checkins.append({
            "demo": True, "patientId": pid,
            "date": time.strftime("%Y-%m-%d", time.localtime((now - day * DAY_MS) / 1000)),
            "mood": max(1, min(5, round(rng.gauss(3.6, 0.8)) - (1 if evening_trouble else 0))),
            "sleepHours": round(rng.uniform(5, 8) * 2) / 2,
            "meals": rng.choice([2, 3, 3, 3]),
            "medsTaken": ["Amlodipine", "Donepezil"] if rng.random() > 0.12 else ["Amlodipine"],
            "agitation": evening_trouble,
            "wandering": rng.random() < 0.07,
            "fall": False,
            "notes": "Restless after sunset, calmer with Bihu songs." if evening_trouble else "",
            "by": "Anil Bora",
        })
    store.insert_many("checkins", checkins)

    sessions = []
    for i, day in enumerate((13, 11, 9, 6, 4, 1)):
        acc = min(0.95, 0.62 + i * 0.05 + rng.uniform(-0.04, 0.04))
        sessions.append({
            "demo": True, "patientId": pid, "game": "haat", "source": "demo",
            "startedAt": now - day * DAY_MS, "durationMs": rng.randint(70, 140) * 1000, "completed": True,
            "correct": 2, "wrong": round(2 / acc) - 2, "accuracy": round(acc, 2),
            "meanReactionMs": rng.randint(3300, 4600) - i * 120,
            "details": {"shoppingList": ["Assam Tea", "Local Greens"], "stallVisits": rng.randint(2, 5)},
        })
    for i, day in enumerate((12, 10, 7, 5, 2)):
        acc = min(0.95, 0.55 + i * 0.06 + rng.uniform(-0.05, 0.05))
        sessions.append({
            "demo": True, "patientId": pid, "game": "tator", "source": "demo",
            "startedAt": now - day * DAY_MS, "durationMs": rng.randint(60, 180) * 1000, "completed": True,
            "correct": 12 + i * 2, "wrong": max(1, round((12 + i * 2) * (1 - acc) / acc)),
            "accuracy": round(acc, 2), "meanReactionMs": rng.randint(1700, 2600) - i * 90,
            "details": {"patternsCompleted": 2 + i},
        })
    store.insert_many("sessions", sessions)
    return patient


def remove_demo(store, uploads_dir):
    """Removes demo rows (and anything attached to the demo patient) plus demo_* pictures.
    Real families' records and uploads are left alone."""
    data = store.snapshot()
    demo_patients = {p["id"] for p in data["patients"] if p.get("demo")}
    cleaned = {name: [r for r in rows if not r.get("demo") and r.get("patientId") not in demo_patients]
               for name, rows in data.items()}
    cleaned["patients"] = [p for p in data["patients"] if not p.get("demo")]
    store.replace_all(cleaned)
    if os.path.isdir(uploads_dir):
        for name in os.listdir(uploads_dir):
            if name.startswith("demo_"):
                os.remove(os.path.join(uploads_dir, name))
