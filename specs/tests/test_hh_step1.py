from __future__ import annotations

import importlib.util
from pathlib import Path
from datetime import datetime
import json


REPO_ROOT = Path(__file__).resolve().parents[2]
MOCK_SERVER = REPO_ROOT / "scripts" / "hh-mock-server.py"


FIXTURES_DIR = Path(__file__).resolve().parents[2] / "scripts" / "hh-mock-data"
RESPONSES_FILE = FIXTURES_DIR / "vacancy_132102233_responses.json"
_MODULE = None


def _load_mock_server_module():
    global _MODULE
    if _MODULE is not None:
        return _MODULE
    spec = importlib.util.spec_from_file_location("hh_mock_server", str(MOCK_SERVER))
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    _MODULE = module
    return _MODULE


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


def test_negotiation_listing_contract_is_compatible():
    module = _load_mock_server_module()
    mock = module.HHMock(FIXTURES_DIR)

    payload = mock.list_negotiations("response", vacancy_id="132102233")
    assert payload["found"] >= 1
    if payload["pages"] == 1:
        assert payload["found"] == len(payload["items"])
    else:
        assert payload["found"] > len(payload["items"])
    assert payload["items"]

    first = payload["items"][0]
    assert isinstance(first["id"], str)
    assert first["state"]["id"] in {"response", "phone_interview"}
    assert first["resume"]["id"].startswith("resume-")
    assert first["vacancy"]["id"] == "132102233"

    resume_payload = mock.get_resume(first["resume"]["id"])
    assert resume_payload is not None
    assert resume_payload["id"] == first["resume"]["id"]
