"""SMTI-MANAS Care Portal - local web server.

    py server.py            then open http://localhost:8000
    py server.py --demo     same, with demo data loaded on first run

Needs only Python 3.9+. Optional extras (see README.md):
    py -m pip install -r requirements.txt   -> lets Sangi use Claude
    config.env                               -> Bhashini + Claude keys
"""
import argparse
import base64
import binascii
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if value and key not in os.environ:
                os.environ[key] = value


load_env(os.path.join(ROOT, "config.env"))

from services import demo, telemetry  # noqa: E402
from services.bhashini import Bhashini, BhashiniError  # noqa: E402
from services.sangi import LANGUAGE_NAMES, Sangi  # noqa: E402
from services.store import Store  # noqa: E402

PUBLIC = os.path.join(ROOT, "public")
DATA = os.path.join(ROOT, "data")
UPLOADS = os.path.join(DATA, "uploads")
GAME_FOLDERS = {"haat": "haat-bazaar", "tator": "tator-gatha"}
COLLECTION_RX = "(patients|checkins|family|memories|cards|sessions)"
CARD_FRONTS = {"person": "Who is this?", "place": "Where is this?", "object": "What is this?",
               "routine": "What do we do now?", "event": "Do you remember this day?"}
MAX_BODY = 25 * 1024 * 1024
UPLOAD_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
                "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
                "audio/mpeg": "mp3", "audio/mp4": "m4a"}
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".json": "application/json", ".wasm": "application/wasm", ".pck": "application/octet-stream",
        ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".webm": "audio/webm",
        ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".md": "text/plain; charset=utf-8", ".gd": "text/plain; charset=utf-8"}

store = Store(os.path.join(DATA, "db.json"))
bhashini = Bhashini(os.environ.get("BHASHINI_USER_ID"), os.environ.get("BHASHINI_API_KEY"),
                    os.environ.get("BHASHINI_PIPELINE_ID"))
sangi = Sangi(os.environ.get("CLAUDE_MODEL"), os.environ.get("CLAUDE_EFFORT"))


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


ROUTES = []


def route(method, pattern):
    def register(fn):
        ROUTES.append((method, re.compile(f"^{pattern}$"), fn))
        return fn
    return register


def need_patient(patient_id):
    patient = store.get("patients", patient_id or "")
    if not patient:
        raise ApiError(404, "Patient not found.")
    return patient


def need_text(body, key, label):
    value = str(body.get(key) or "").strip()
    if not value:
        raise ApiError(400, f"{label} is required.")
    return value


def upload_urls(value):
    """Every /uploads/... path mentioned anywhere inside value."""
    found, stack = set(), [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, str) and item.startswith("/uploads/"):
            found.add(item)
    return found


def remove_unused_uploads(candidates):
    """Deletes photos/voice notes that belonged to deleted rows and nothing else still uses.
    Only candidates are considered, so an upload that isn't saved to a record yet is never touched."""
    in_use = upload_urls(store.snapshot())
    for url in candidates - in_use:
        path = os.path.join(UPLOADS, os.path.basename(url))
        if os.path.isfile(path):
            os.remove(path)


def people_for(patient):
    """'Name - your relation' strings, from family members and person cue cards."""
    if not patient:
        return []
    seen, people = set(), []
    rows = store.list("family", patient["id"]) + [
        {"name": c.get("title"), "relation": c.get("relation")}
        for c in store.list("cards", patient["id"]) if c.get("category") == "person"]
    for row in rows:
        name, relation = (row.get("name") or "").strip(), (row.get("relation") or "").strip().lower()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            people.append(f"{name} - your {relation}" if relation else f"{name} - someone you know")
    return people


# ------------------------------------------------------------------ routes

@route("GET", "/api/status")
def status(body, query):
    return {
        "bhashini": bhashini.configured,
        "claude": sangi.configured,
        "claudeSdk": sangi.sdk_installed,
        "claudeModel": sangi.model,
        "games": {key: os.path.isfile(os.path.join(PUBLIC, "games", folder, "index.html"))
                  for key, folder in GAME_FOLDERS.items()},
        "hasDemo": any(p.get("demo") for p in store.list("patients")),
        "languages": LANGUAGE_NAMES,
    }


@route("GET", f"/api/{COLLECTION_RX}")
def list_rows(body, query, collection):
    return store.list(collection, query.get("patientId"))


@route("POST", f"/api/{COLLECTION_RX}")
def create_row(body, query, collection):
    body.pop("id", None)
    if collection == "patients":
        need_text(body, "name", "Name")
    else:
        need_patient(body.get("patientId"))
    return store.insert(collection, body)


@route("PUT", f"/api/{COLLECTION_RX}/([\\w-]+)")
def update_row(body, query, collection, row_id):
    row = store.update(collection, row_id, body)
    if not row:
        raise ApiError(404, "Not found.")
    return row


@route("DELETE", f"/api/{COLLECTION_RX}/([\\w-]+)")
def delete_row(body, query, collection, row_id):
    data = store.snapshot()
    doomed = [r for r in data[collection] if r["id"] == row_id]
    if collection == "patients":
        doomed += [r for name, rows in data.items() if name != "patients" for r in rows if r.get("patientId") == row_id]
    if not store.delete(collection, row_id):
        raise ApiError(404, "Not found.")
    remove_unused_uploads(upload_urls(doomed))
    return {"ok": True}


@route("POST", "/api/upload")
def upload(body, query):
    match = re.match(r"^data:([^;,]+)((?:;[^;,]*)*);base64,(.+)$", body.get("dataUrl") or "", re.S)
    if not match:
        raise ApiError(400, "Upload must be a base64 data URL.")
    mime = match.group(1).lower()
    ext = UPLOAD_TYPES.get(mime)
    if not ext:
        raise ApiError(415, "Please upload a photo (JPG, PNG, WebP) or a voice note.")
    try:
        raw = base64.b64decode(match.group(3), validate=False)
    except (binascii.Error, ValueError):
        raise ApiError(400, "The file could not be read.")
    if len(raw) > 15 * 1024 * 1024:
        raise ApiError(413, "That file is too big (limit 15 MB).")
    os.makedirs(UPLOADS, exist_ok=True)
    name = f"{Store.new_id('up')}.{ext}"
    with open(os.path.join(UPLOADS, name), "wb") as f:
        f.write(raw)
    return {"url": f"/uploads/{name}"}


@route("POST", "/api/cue/suggest")
def cue_suggest(body, query):
    patient = store.get("patients", body.get("patientId") or "")
    cue, source = sangi.suggest_cue(body, patient)
    return {"cue": cue, "source": source}


@route("POST", "/api/cards/from-memory")
def card_from_memory(body, query):
    memory = store.get("memories", body.get("memoryId") or "")
    if not memory:
        raise ApiError(404, "Memory not found.")
    patient = need_patient(memory.get("patientId"))
    cue, source = sangi.suggest_cue(memory, patient)
    cue_local, note, language = "", None, patient.get("language") or "en"
    if language != "en" and bhashini.configured:
        try:
            cue_local = bhashini.translate(cue, "en", language)
        except BhashiniError as e:
            note = f"Card made in English only: {e}"
    category = memory.get("category") if memory.get("category") in CARD_FRONTS else "person"
    card = store.insert("cards", {
        "patientId": patient["id"], "memoryId": memory["id"], "category": category,
        "photo": memory.get("photo"), "voiceNote": memory.get("voiceNote"),
        "title": memory.get("personName") or memory.get("caption") or "Memory",
        "relation": memory.get("relation", ""), "front": CARD_FRONTS[category],
        "cue": cue, "cueLocal": cue_local, "cueSource": source,
        "stats": {"shown": 0, "remembered": 0, "notYet": 0, "lastShown": None},
    })
    store.update("memories", memory["id"], {"cardId": card["id"]})
    return {"card": card, "note": note}


@route("POST", "/api/cards/([\\w-]+)/review")
def review_card(body, query, card_id):
    card = store.get("cards", card_id)
    if not card:
        raise ApiError(404, "Card not found.")
    stats = {"shown": 0, "remembered": 0, "notYet": 0, **(card.get("stats") or {})}
    stats["shown"] += 1
    stats["remembered" if body.get("result") == "remembered" else "notYet"] += 1
    stats["lastShown"] = int(time.time() * 1000)
    return store.update("cards", card_id, {"stats": stats})


@route("POST", "/api/games/results")
def game_results(body, query):
    patient = need_patient(body.get("patientId"))
    records = body.get("records")
    if not isinstance(records, list):
        records = telemetry.parse_records(str(body.get("text") or ""))
    source = "portal" if body.get("source") == "portal" else "import"
    game, sessions = telemetry.to_sessions(records, patient["id"], source, body.get("game"))
    if not game:
        raise ApiError(400, "This file doesn't look like Haat Bazaar or Tator Gatha results.")
    known = {s.get("fingerprint") for s in store.list("sessions", patient["id"])}
    fresh = [s for s in sessions if s["fingerprint"] not in known]
    if fresh:
        store.insert_many("sessions", fresh)
    return {"game": game, "added": len(fresh), "skipped": len(sessions) - len(fresh)}


@route("POST", "/api/bhashini/asr")
def bhashini_asr(body, query):
    return {"text": bhashini.asr(need_text(body, "audio", "Audio"), body.get("language") or "hi")}


@route("POST", "/api/bhashini/translate")
def bhashini_translate(body, query):
    text = need_text(body, "text", "Text")
    return {"text": bhashini.translate(text, body.get("source") or "en", body.get("target") or "hi")}


@route("POST", "/api/bhashini/tts")
def bhashini_tts(body, query):
    text = need_text(body, "text", "Text")
    gender = "male" if body.get("gender") == "male" else "female"
    return {"audio": bhashini.tts(text, body.get("language") or "hi", gender)}


@route("POST", "/api/sangi/chat")
def sangi_chat(body, query):
    patient = store.get("patients", body.get("patientId") or "")
    mode = "companion" if body.get("mode") == "companion" else "caregiver"
    language = body.get("language") if body.get("language") in LANGUAGE_NAMES else "en"
    messages = [m for m in (body.get("messages") or []) if isinstance(m, dict)]
    people = people_for(patient)

    # Local language + Bhashini: translate in, think in English, translate the reply back.
    note = None
    if language != "en" and bhashini.configured:
        try:
            history = [{"role": m.get("role"),
                        "content": m.get("contentEn") or bhashini.translate(str(m.get("content", "")), language, "en")}
                       for m in messages]
        except BhashiniError as e:
            history, note = None, f"Bhashini could not translate ({e}); answering without it."
        if history is not None:
            result = sangi.chat(history, patient, people, mode, reply_language="en")
            extra = {"replyEn": result["reply"], "userEn": history[-1]["content"] if history else ""}
            try:
                return {**result, **extra, "translatedBy": "bhashini",
                        "reply": bhashini.translate(result["reply"], "en", language)}
            except BhashiniError as e:
                return {**result, **extra, "note": f"Could not translate the reply ({e}); showing English."}

    result = sangi.chat(messages, patient, people, mode, reply_language=language)
    english = result["reply"] if language == "en" or result["source"] == "offline" else None
    return {**result, "replyEn": english, "note": note or result.get("note")}


@route("GET", "/api/backup")
def backup(body, query):
    return store.snapshot()


@route("POST", "/api/backup")
def restore(body, query):
    data = body.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("patients"), list):
        raise ApiError(400, "That doesn't look like a portal backup file.")
    store.replace_all(data)
    return {"ok": True}


@route("POST", "/api/demo/seed")
def demo_seed(body, query):
    existing = [p for p in store.list("patients") if p.get("demo")]
    return {"patient": existing[0] if existing else demo.seed(store, UPLOADS)}


@route("POST", "/api/demo/remove")
def demo_remove(body, query):
    demo.remove_demo(store, UPLOADS)
    return {"ok": True}


# ------------------------------------------------------------------ HTTP plumbing

class Handler(BaseHTTPRequestHandler):
    server_version = "MANASPortal/1.0"
    protocol_version = "HTTP/1.1"  # keep-alive; every response sets Content-Length

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") or (len(args) > 1 and str(args[1])[:1] in "45"):
            print(f"  {self.command} {self.path.split('?')[0]} -> {args[1] if len(args) > 1 else ''}")

    def dispatch(self, method):
        # Always consume the body first, so a kept-alive connection never sees leftover bytes.
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            return self.send_json({"error": "That is too big to send (limit 25 MB)."}, 413)
        self.raw_body = self.rfile.read(length) if length > 0 else b""
        url = urlparse(self.path)
        path = unquote(url.path)
        if path.startswith("/api/"):
            self.handle_api(method, path, {k: v[0] for k, v in parse_qs(url.query).items()})
        elif method == "GET":
            self.serve_static(path)
        else:
            self.send_json({"error": "Not found."}, 404)

    def handle_api(self, method, path, query):
        for route_method, pattern, fn in ROUTES:
            match = pattern.match(path)
            if route_method != method or not match:
                continue
            try:
                body = self.read_json() if method in ("POST", "PUT") else {}
                return self.send_json(fn(body, query, *match.groups()))
            except ApiError as e:
                return self.send_json({"error": e.message}, e.status)
            except BhashiniError as e:
                return self.send_json({"error": str(e)}, 502)
            except Exception:
                traceback.print_exc()
                return self.send_json({"error": "Something went wrong on the server."}, 500)
        self.send_json({"error": "Not found."}, 404)

    def read_json(self):
        if not self.raw_body:
            return {}
        try:
            data = json.loads(self.raw_body.decode("utf-8"))
        except ValueError:
            raise ApiError(400, "Invalid JSON.")
        if not isinstance(data, dict):
            raise ApiError(400, "Expected a JSON object.")
        return data

    def common_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        # Cross-origin isolation lets Godot web exports that use threads run inside the portal.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")

    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, path):
        if path.startswith("/uploads/"):
            base, rel = UPLOADS, path[len("/uploads/"):]
        else:
            base, rel = PUBLIC, path.lstrip("/")
        base_real = os.path.realpath(base)
        full = os.path.realpath(os.path.join(base_real, rel))
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not (full == base_real or full.startswith(base_real + os.sep)) or not os.path.isfile(full):
            return self.send_json({"error": "Not found."}, 404)

        ext = os.path.splitext(full)[1].lower()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(full)))
        self.send_header("Cache-Control", "no-cache")
        if base is UPLOADS:
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        self.common_headers()
        self.end_headers()
        with open(full, "rb") as f:
            while chunk := f.read(64 * 1024):
                self.wfile.write(chunk)


class PortalServer(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR lets a second copy of the portal silently share the port, and the
    # two copies would overwrite each other's data file. Without it the second copy is refused.
    # (Restarting straight after closing still works on Windows; TIME_WAIT doesn't block the bind.)
    allow_reuse_address = os.name != "nt"


class PortalServerV6(PortalServer):
    address_family = socket.AF_INET6


def main():
    parser = argparse.ArgumentParser(description="SMTI-MANAS Care Portal")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                        help="use 0.0.0.0 to open the portal to phones on the same Wi-Fi")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--demo", action="store_true", help="load demo data if there is none")
    args = parser.parse_args()

    if args.demo and not any(p.get("demo") for p in store.list("patients")):
        demo.seed(store, UPLOADS)
        print("  Demo data loaded.")

    try:
        server = PortalServer((args.host, args.port), Handler)
    except OSError as e:
        print(f"\n  Could not start the portal on port {args.port}: {e.strerror or e}")
        print("  It may already be running in another window. Close that window,")
        print(f"  or start a second copy on another port:  py server.py --port {args.port + 1}\n")
        sys.exit(1)
    if args.host == "127.0.0.1" and socket.has_ipv6:
        # Browsers try "localhost" over IPv6 first; without this every request waits ~300 ms on Windows.
        try:
            threading.Thread(target=PortalServerV6(("::1", args.port), Handler).serve_forever, daemon=True).start()
        except OSError:
            pass
    shown_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    print("\n  SMTI-MANAS Care Portal")
    print(f"  Open  http://{shown_host}:{args.port}")
    print(f"  Bhashini : {'ready' if bhashini.configured else 'not set up (typed input still works)'}")
    if sangi.configured:
        print(f"  Sangi AI : Claude ({sangi.model})")
    else:
        print("  Sangi AI : offline replies" + ("" if sangi.sdk_installed else " (anthropic package not installed)"))
    print("  Press Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()
