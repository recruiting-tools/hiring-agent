from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path


FIXTURES_DIR = Path(__file__).resolve().parents[2] / "scripts" / "hh-mock-data"
RESPONSES_FILE = FIXTURES_DIR / "vacancy_132102233_responses.json"


def test_responses_fixture_has_required_fields():
    payload = json.loads(RESPONSES_FILE.read_text(encoding="utf-8"))
    assert payload["vacancy_id"] == "132102233"
    assert isinstance(payload["items"], list)
    assert "source_synced_at" in payload


def _parse_ts(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def test_responses_sorted_by_timestamp_and_negotiation_id():
    payload = json.loads(RESPONSES_FILE.read_text(encoding="utf-8"))
    items = payload["items"]
    normalized = sorted(
        items,
        key=lambda item: (_parse_ts(item["last_activity_at"]), item["negotiation_id"]),
        reverse=True,
    )
    assert items == normalized


def test_fixture_negotiations_exist_for_all_items():
    payload = json.loads(RESPONSES_FILE.read_text(encoding="utf-8"))
    ids = [item["negotiation_id"] for item in payload["items"]]
    assert len(ids) == len(set(ids))
    for negotiation_id in ids:
        path = FIXTURES_DIR / f"negotiation_{negotiation_id}.json"
        assert path.exists()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["negotiation_id"] == negotiation_id
        assert "messages" in data
