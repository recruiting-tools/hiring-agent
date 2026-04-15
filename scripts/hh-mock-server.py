#!/usr/bin/env python3
"""
hh.ru mock API for sandbox iteration.

This server provides deterministic fixtures for:
- GET /api/hh/vacancies/<vacancy_id>/responses
- GET /api/hh/negotiations/<negotiation_id>
- GET /api/hh/negotiations/<negotiation_id>/messages
- POST /api/hh/negotiations/<negotiation_id>/messages

It is intentionally small and focused on test repeatability:
- stable ordering
- pagination
- dry-run send
- idempotency for POST sends
"""

from __future__ import annotations

import argparse
import json
import os
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse


def parse_ts(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class HHMock:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.negotiations_dir = data_dir / "negotiations"
        self.responses_file = data_dir / "vacancy_132102233_responses.json"
        self.sent_messages: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self.idempotency_index: Dict[str, Dict[str, str]] = {}
        self._load()

    def _load(self) -> None:
        self.responses_by_vacancy = {}
        if self.responses_file.exists():
            with self.responses_file.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
                self.responses_by_vacancy[payload["vacancy_id"]] = payload

        self.negotiations: Dict[str, Dict[str, Any]] = {}
        sources: List[Path] = []
        if self.negotiations_dir.exists():
            sources.extend(self.negotiations_dir.glob("negotiation_*.json"))
        sources.extend(self.data_dir.glob("negotiation_*.json"))
        if not sources:
            return
        for path in sorted(set(sources)):
            with path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            self.negotiations[data["negotiation_id"]] = data

    def list_vacancy_responses(
        self, vacancy_id: str, collection: str | None = None
    ) -> List[Dict[str, Any]]:
        payload = self.responses_by_vacancy.get(vacancy_id)
        if not payload:
            return []
        items = list(payload.get("items", []))
        if collection:
            items = [item for item in items if item.get("collection") == collection]
        return sorted(
            items,
            key=lambda item: (parse_ts(item["last_activity_at"]), item["negotiation_id"]),
            reverse=True,
        )

    def get_negotiation(self, negotiation_id: str) -> Dict[str, Any] | None:
        data = self.negotiations.get(negotiation_id)
        if not data:
            return None
        merged = dict(data)
        messages = merged.get("messages", [])
        outgoing = self.sent_messages.get(negotiation_id, [])
        merged = dict(merged)
        merged["messages"] = [*messages, *outgoing]
        merged["messages"] = sorted(
            merged["messages"],
            key=lambda message: parse_ts(message["created_at"]),
        )
        return merged

    def get_messages(self, negotiation_id: str) -> List[Dict[str, Any]]:
        data = self.get_negotiation(negotiation_id)
        if not data:
            return []
        return data["messages"]

    def send_message(
        self,
        negotiation_id: str,
        payload: Dict[str, Any],
        idempotency_key: str | None,
        dry_run: bool,
    ) -> Dict[str, Any]:
        if dry_run:
            return {
                "status": "preview",
                "negotiation_id": negotiation_id,
                "preview_text": payload.get("text", ""),
                "idempotency_key": idempotency_key,
            }

        if not payload.get("text"):
            return {"status": "error", "error": "text is required"}

        if not self.negotiations.get(negotiation_id):
            return {"status": "not_found", "error": "negotiation not found"}

        map_key = idempotency_key or "-"
        by_key = self.idempotency_index.setdefault(map_key, {})
        if idempotency_key and negotiation_id in by_key:
            return {
                "status": "duplicate_suppressed",
                "negotiation_id": negotiation_id,
                "message_id": by_key[negotiation_id],
            }

        msg_id = f"{uuid.uuid4().hex[:20]}"
        message = {
            "id": msg_id,
            "hh_message_id": msg_id,
            "text": payload["text"],
            "created_at": now_iso(),
            "author": {"participant_type": "employer"},
        }
        self.sent_messages[negotiation_id].append(message)

        if idempotency_key:
            by_key[negotiation_id] = msg_id

        return {
            "status": "sent",
            "negotiation_id": negotiation_id,
            "message_id": msg_id,
            "sent_at": message["created_at"],
        }


class HHMockHandler(BaseHTTPRequestHandler):
    server_version = "hh-mock/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/health":
            self._json({"status": "ok"})
            return

        m = re.match(r"^/api/hh/vacancies/([^/]+)/responses$", path)
        if m:
            self._handle_responses(m.group(1), query)
            return

        m = re.match(r"^/api/hh/negotiations/([^/]+)$", path)
        if m:
            self._handle_negotiation(m.group(1))
            return

        m = re.match(r"^/api/hh/negotiations/([^/]+)/messages$", path)
        if m:
            self._handle_messages_list(m.group(1))
            return

        self._error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        m = re.match(r"^/api/hh/negotiations/([^/]+)/messages$", path)
        if not m:
            self._error(404, "Not found")
            return
        payload = self._read_json()
        if payload is None:
            return
        negotiation_id = m.group(1)
        idempotency_key = self.headers.get("x-idempotency-key")
        dry_run = query.get("dry_run", ["false"])[0].lower() in {"1", "true", "yes"}
        if self.headers.get("x-dry-run", "false").lower() in {"1", "true", "yes"}:
            dry_run = True
        resp = self.server.mock.send_message(
            negotiation_id=negotiation_id,
            payload=payload,
            idempotency_key=idempotency_key,
            dry_run=dry_run,
        )
        status = 201 if resp.get("status") == "sent" else 200
        if resp.get("status") == "not_found":
            status = 404
        if resp.get("status") == "error":
            status = 400
        self._json(resp, status)

    def _handle_responses(self, vacancy_id: str, query: Dict[str, List[str]]):
        collection = query.get("collection", [None])[0]
        page = int(query.get("page", [1])[0] or 1)
        per_page = min(int(query.get("per_page", [50])[0] or 50), 200)
        if page < 1:
            page = 1
        if per_page < 1:
            per_page = 1

        items = self.server.mock.list_vacancy_responses(vacancy_id, collection)
        start = (page - 1) * per_page
        end = start + per_page
        chunk = items[start:end]

        payload = self.server.mock.responses_by_vacancy.get(vacancy_id, {})
        self._json(
            {
                "vacancy_id": vacancy_id,
                "collection": collection,
                "items": chunk,
                "page": page,
                "per_page": per_page,
                "has_more": end < len(items),
                "source_synced_at": payload.get("source_synced_at", now_iso()),
            }
        )

    def _handle_negotiation(self, negotiation_id: str):
        negotiation = self.server.mock.get_negotiation(negotiation_id)
        if not negotiation:
            self._error(404, "Negotiation not found")
            return
        self._json(negotiation)

    def _handle_messages_list(self, negotiation_id: str):
        messages = self.server.mock.get_messages(negotiation_id)
        if not messages and negotiation_id not in self.server.mock.negotiations:
            self._error(404, "Negotiation not found")
            return
        self._json({"items": messages})

    def _read_json(self) -> Dict[str, Any] | None:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0:
            self._error(400, "Empty payload")
            return None
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self._error(400, "Invalid json")
            return None
        return payload

    def _json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Request-Id", str(uuid.uuid4()))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._json({"error": message}, status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run local HH mock server")
    parser.add_argument("--host", default=os.getenv("HH_MOCK_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("HH_MOCK_PORT", "19090")))
    parser.add_argument(
        "--data-dir",
        default=os.getenv("HH_MOCK_DATA_DIR", str(Path(__file__).resolve().parent / "hh-mock-data")),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    mock = HHMock(Path(args.data_dir))
    server = ThreadingHTTPServer((args.host, args.port), HHMockHandler)
    server.mock = mock
    print(f"hh-mock listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
