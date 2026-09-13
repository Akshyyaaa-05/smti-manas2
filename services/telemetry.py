"""Turns the log files the two Godot games already write into portal sessions.

Haat Bazaar (Dimentia_Memory_Game)  -> user://market_telemetry.jsonl  (one trip per line)
                                       user://trip_log.json          (single trip, TripManager)
Tator Gatha                          -> user://loom_telemetry.jsonl   (one colour tap per line)

On Windows, user:// is %APPDATA%/Godot/app_userdata/<project name>/
"""
import hashlib
import json
import time
from datetime import datetime

LOOM_SESSION_GAP_S = 10 * 60


def _fingerprint(obj):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def parse_records(text):
    """Accepts JSON (object or list) or JSONL. Returns a list of dicts."""
    text = text.strip()
    if not text:
        return []
    try:
        data = json.loads(text)
        return data if isinstance(data, list) else [data]
    except ValueError:
        rows = []
        for line in text.splitlines():
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
        return rows


def detect_game(records):
    for r in records:
        if isinstance(r, dict):
            if "shopping_list" in r or "trip_id" in r:
                return "haat"
            if "was_correct" in r and "button" in r:
                return "tator"
    return None


def market_sessions(trips, patient_id, source):
    trips = [t for t in trips if isinstance(t, dict)]
    now = int(time.time() * 1000)
    out = []
    for i, trip in enumerate(trips):
        events = trip.get("interactions", []) or []
        taps = [x.get("data", {}) for x in events if x.get("event_type") == "stall_item_tapped"]
        correct = [t for t in taps if t.get("on_list")]
        wrong = [t for t in taps if not t.get("on_list")]
        reactions = [t["reaction_ms"] for t in correct if isinstance(t.get("reaction_ms"), (int, float))]
        total = len(correct) + len(wrong)
        out.append({
            "patientId": patient_id,
            "game": "haat",
            "source": source,
            # Godot logs engine ticks, not wall-clock time, so trips are stamped when they arrive.
            "startedAt": now - (len(trips) - i) * 1000,
            "durationMs": max(trip.get("duration_ms", 0) or 0, 0),
            "completed": bool(trip.get("completed")),
            "correct": len(correct),
            "wrong": len(wrong),
            "accuracy": round(len(correct) / total, 3) if total else None,
            "meanReactionMs": round(sum(reactions) / len(reactions)) if reactions else None,
            "details": {
                "shoppingList": trip.get("shopping_list", []),
                "collected": trip.get("collected_items", []),
                "stallVisits": sum(1 for x in events if x.get("event_type") == "market_map_stall_selected"),
                "wrongItems": [t.get("item") for t in wrong],
            },
            "fingerprint": _fingerprint(trip),
        })
    return out


def _parse_ts(value):
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return None


def loom_sessions(taps, patient_id, source):
    taps = [t for t in taps if isinstance(t, dict) and "was_correct" in t]
    groups, current, last_ts = [], [], None
    for tap in taps:
        ts = _parse_ts(tap.get("timestamp"))
        if current and ts is not None and last_ts is not None and ts - last_ts > LOOM_SESSION_GAP_S:
            groups.append(current)
            current = []
        current.append(tap)
        if ts is not None:
            last_ts = ts
    if current:
        groups.append(current)

    out = []
    for group in groups:
        correct = [t for t in group if t.get("was_correct")]
        wrong = [t for t in group if not t.get("was_correct")]
        reactions = [t["reaction_time_seconds"] * 1000 for t in correct
                     if isinstance(t.get("reaction_time_seconds"), (int, float))]
        stamps = [s for s in (_parse_ts(t.get("timestamp")) for t in group) if s is not None]
        started = int(min(stamps) * 1000) if stamps else int(time.time() * 1000)
        ended = int(max(stamps) * 1000) if stamps else started
        # A correct tap logged at position 3 is the 4th slot, i.e. a finished pattern.
        finished = sum(1 for t in correct if t.get("current_position") == 3)
        out.append({
            "patientId": patient_id,
            "game": "tator",
            "source": source,
            "startedAt": started,
            "durationMs": ended - started,
            "completed": finished > 0,
            "correct": len(correct),
            "wrong": len(wrong),
            "accuracy": round(len(correct) / len(group), 3) if group else None,
            "meanReactionMs": round(sum(reactions) / len(reactions)) if reactions else None,
            "details": {
                "taps": len(group),
                "patternsCompleted": finished,
                "wrongByColour": {c: sum(1 for t in wrong if t.get("button") == c)
                                  for c in sorted({str(t.get("button")) for t in wrong})},
            },
            "fingerprint": _fingerprint(group),
        })
    return out


def to_sessions(records, patient_id, source, game=None):
    game = game or detect_game(records)
    if game == "haat":
        return game, market_sessions(records, patient_id, source)
    if game == "tator":
        return game, loom_sessions(records, patient_id, source)
    return None, []
