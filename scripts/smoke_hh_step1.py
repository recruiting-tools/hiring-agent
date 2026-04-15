#!/usr/bin/env python3
"""
Deterministic smoke check for step-1 HH fixtures or any hh-mock endpoint.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlencode


@dataclass
class SmokeError(Exception):
    message: str


def _request(url: str, method: str = "GET", payload: str | None = None, headers=None):
    req = Request(url=url, method=method, data=payload.encode("utf-8") if payload else None)
    headers = headers or {}
    req.headers.update(headers)
    if payload:
        req.headers["Content-Type"] = "application/json"
    with urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        return resp.getcode(), json.loads(body or "{}")


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def run_smoke(base_url: str, vacancy_id: str) -> None:
    responses_url = f"{base_url}/api/hh/vacancies/{vacancy_id}/responses"
    status, payload = _request(responses_url)
    _require(status == 200, f"responses endpoint returned {status}")
    _require(isinstance(payload.get("items"), list), "responses payload missing items list")
    _require("has_more" in payload, "responses payload missing has_more")
    _require("source_synced_at" in payload, "responses payload missing source_synced_at")

    items = payload["items"]
    if not items:
        print("STEP1_SMOKE_OK: vacancy has no active responses in mock")
        return

    negotiation_id = items[0]["negotiation_id"]
    detail_url = f"{base_url}/api/hh/negotiations/{negotiation_id}"
    status, negotiation = _request(detail_url)
    _require(status == 200, f"negotiation endpoint returned {status}")
    _require(
        negotiation.get("negotiation_id") == negotiation_id,
        "negotiation payload negotiation_id mismatch",
    )
    _require(
        "messages" in negotiation,
        "negotiation payload missing messages",
    )

    messages_url = f"{base_url}/api/hh/negotiations/{negotiation_id}/messages"
    status, messages_payload = _request(messages_url)
    _require(status == 200, f"messages endpoint returned {status}")
    _require(isinstance(messages_payload.get("items"), list), "messages payload missing items")

    send_url = f"{messages_url}?{urlencode({'dry_run': 'true'})}"
    status, send_payload = _request(
        send_url,
        method="POST",
        payload=json.dumps({"text": "Smoke test from sandbox"}),
        headers={"x-idempotency-key": "step1-smoke"},
    )
    _require(status == 200, f"message preview endpoint returned {status}")
    _require(send_payload.get("status") == "preview", "preview status mismatch")

    print("STEP1_SMOKE_OK")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="Base URL for hh endpoints")
    parser.add_argument("--vacancy", required=True, help="HH vacancy id")
    args = parser.parse_args()

    try:
        run_smoke(args.base_url.rstrip("/"), args.vacancy)
    except (SmokeError, HTTPError, URLError) as exc:
        raise SystemExit(f"STEP1_SMOKE_FAIL: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
