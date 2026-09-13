"""Tiny JSON-file store. One file, one lock, whole-file rewrites.

Good for a single care home or a family demo (thousands of rows). Swap for
SQLite (the SMTI-MANAS schema) before real multi-site use.
"""
import json
import os
import threading
import time
import uuid

COLLECTIONS = ("patients", "checkins", "family", "memories", "cards", "sessions")


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.data = self._load()

    def _load(self):
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
        else:
            data = {}
        for name in COLLECTIONS:
            data.setdefault(name, [])
        return data

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    @staticmethod
    def new_id(prefix):
        return f"{prefix}_{uuid.uuid4().hex[:10]}"

    def list(self, collection, patient_id=None):
        with self.lock:
            rows = self.data[collection]
            if patient_id and collection != "patients":
                rows = [r for r in rows if r.get("patientId") == patient_id]
            return [dict(r) for r in rows]

    def get(self, collection, row_id):
        with self.lock:
            for r in self.data[collection]:
                if r["id"] == row_id:
                    return dict(r)
        return None

    def insert(self, collection, row):
        with self.lock:
            row = dict(row)
            row.setdefault("id", self.new_id(collection[:3]))
            row.setdefault("createdAt", int(time.time() * 1000))
            self.data[collection].append(row)
            self._save()
            return dict(row)

    def insert_many(self, collection, rows):
        with self.lock:
            out = []
            for row in rows:
                row = dict(row)
                row.setdefault("id", self.new_id(collection[:3]))
                row.setdefault("createdAt", int(time.time() * 1000))
                self.data[collection].append(row)
                out.append(row)
            self._save()
            return out

    def update(self, collection, row_id, changes):
        with self.lock:
            for r in self.data[collection]:
                if r["id"] == row_id:
                    changes = {k: v for k, v in changes.items() if k not in ("id", "createdAt")}
                    r.update(changes)
                    r["updatedAt"] = int(time.time() * 1000)
                    self._save()
                    return dict(r)
        return None

    def delete(self, collection, row_id):
        with self.lock:
            before = len(self.data[collection])
            self.data[collection] = [r for r in self.data[collection] if r["id"] != row_id]
            removed = len(self.data[collection]) != before
            if collection == "patients" and removed:
                for name in COLLECTIONS[1:]:
                    self.data[name] = [r for r in self.data[name] if r.get("patientId") != row_id]
            if removed:
                self._save()
            return removed

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps(self.data))

    def replace_all(self, data):
        with self.lock:
            self.data = {name: list(data.get(name, [])) for name in COLLECTIONS}
            self._save()
