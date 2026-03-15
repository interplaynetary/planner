#!/usr/bin/env python3
"""
rns_bridge.py — HTTP sidecar that bridges TypeScript StoreRegistry to Reticulum.

Endpoints (localhost only):
  POST /announce  { scopeId, records }  → { ok: true }
  POST /resolve   { scopeId, recordId } → ResolvedRecord | {}

Usage:
  pip install rns
  python scripts/rns_bridge.py [--port 7733]
"""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import RNS

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_NAME        = "plan_registry"
RESOLVE_TIMEOUT = 7.0   # seconds: path discovery + link handshake + resource transfer


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _scope_to_aspect(scope_id: str) -> str:
    """Sanitize a scopeId to a valid RNS aspect (alphanumeric + underscore, max 64 chars)."""
    sanitized = re.sub(r"[^a-zA-Z0-9_]", "_", scope_id)
    return sanitized[:64]


def _find_record(records: dict, record_id: str) -> dict:
    """Search a ScopeSnapshot dict for a record by ID."""
    for plan in records.get("plans", []):
        if plan.get("id") == record_id:
            return {"plan": plan}
    for commitment in records.get("commitments", []):
        if commitment.get("id") == record_id:
            return {"commitment": commitment}
    for intent in records.get("intents", []):
        if intent.get("id") == record_id:
            return {"intent": intent}
    return {}


# ---------------------------------------------------------------------------
# Global state (protected by _lock)
# ---------------------------------------------------------------------------

_lock        = threading.Lock()
_local_store: dict[str, dict] = {}       # scopeId → ScopeSnapshot
_destinations: dict[str, RNS.Destination] = {}   # scopeId → Destination


# ---------------------------------------------------------------------------
# RNS incoming-link handling (Node B side)
# ---------------------------------------------------------------------------

def _on_link_established(link: RNS.Link) -> None:
    """Called when a remote node opens a link to one of our destinations."""
    link.set_resource_concluded_callback(_on_resource_concluded)


def _on_resource_concluded(resource: RNS.Resource) -> None:
    """Receive a query from a remote node, respond with the matching record."""
    if not resource.status == RNS.Resource.COMPLETE:
        return
    try:
        payload = json.loads(resource.data.read())
        scope_id  = payload.get("scopeId", "")
        record_id = payload.get("recordId", "")
        with _lock:
            records = _local_store.get(scope_id, {})
        result = _find_record(records, record_id)
        response_bytes = json.dumps(result).encode()
        RNS.Resource(response_bytes, resource.link)
    except Exception as exc:
        RNS.log(f"[rns_bridge] error in _on_resource_concluded: {exc}", RNS.LOG_ERROR)


# ---------------------------------------------------------------------------
# Remote resolution (Node A side — requester)
# ---------------------------------------------------------------------------

def _resolve_remote(scope_id: str, record_id: str) -> dict:
    """Open an RNS Link to the peer that owns scope_id and fetch the record."""
    aspect = _scope_to_aspect(scope_id)
    dest_hash = RNS.Destination.hash_from_name_and_identity(None, APP_NAME, aspect)

    # Path discovery
    if not RNS.Transport.has_path(dest_hash):
        RNS.Transport.request_path(dest_hash)
        deadline = time.time() + RESOLVE_TIMEOUT
        while not RNS.Transport.has_path(dest_hash):
            if time.time() > deadline:
                RNS.log(f"[rns_bridge] path timeout for scope '{scope_id}'", RNS.LOG_WARNING)
                return {}
            time.sleep(0.1)

    remote_dest = RNS.Destination.recall(dest_hash)
    result_container: list[dict] = []
    event = threading.Event()

    def _on_link_ready(link: RNS.Link) -> None:
        def _on_response(resource: RNS.Resource) -> None:
            if resource.status == RNS.Resource.COMPLETE:
                try:
                    result_container.append(json.loads(resource.data.read()))
                except Exception:
                    result_container.append({})
            else:
                result_container.append({})
            event.set()

        link.set_resource_concluded_callback(_on_response)
        query = json.dumps({"scopeId": scope_id, "recordId": record_id}).encode()
        RNS.Resource(query, link)

    RNS.Link(remote_dest, established_callback=_on_link_ready)

    if not event.wait(timeout=RESOLVE_TIMEOUT):
        RNS.log(f"[rns_bridge] link/resource timeout for scope '{scope_id}'", RNS.LOG_WARNING)
        return {}

    return result_container[0] if result_container else {}


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # silence default access log
        pass

    def _read_json(self) -> dict | None:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return None

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/announce":
            self._handle_announce()
        elif self.path == "/resolve":
            self._handle_resolve()
        else:
            self._send_json(404, {"error": "not found"})

    def _handle_announce(self) -> None:
        payload = self._read_json()
        if not payload:
            self._send_json(400, {"error": "bad json"})
            return

        scope_id = payload.get("scopeId", "")
        records  = payload.get("records", {})
        aspect   = _scope_to_aspect(scope_id)

        with _lock:
            is_new = scope_id not in _local_store
            _local_store[scope_id] = records

            if is_new:
                dest = RNS.Destination(
                    None,
                    RNS.Destination.IN,
                    RNS.Destination.PLAIN,
                    APP_NAME,
                    aspect,
                )
                dest.set_link_established_callback(_on_link_established)
                _destinations[scope_id] = dest
                dest.announce()
                RNS.log(f"[rns_bridge] announced scope '{scope_id}' as {APP_NAME}.{aspect}", RNS.LOG_INFO)

        self._send_json(200, {"ok": True})

    def _handle_resolve(self) -> None:
        payload = self._read_json()
        if not payload:
            self._send_json(400, {"error": "bad json"})
            return

        scope_id  = payload.get("scopeId", "")
        record_id = payload.get("recordId", "")

        with _lock:
            local_records = _local_store.get(scope_id)

        if local_records is not None:
            result = _find_record(local_records, record_id)
        else:
            result = _resolve_remote(scope_id, record_id)

        self._send_json(200, result)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="RNS HTTP bridge for StoreRegistry")
    parser.add_argument("--port", type=int, default=7733, help="Local HTTP port (default 7733)")
    args = parser.parse_args()

    RNS.Reticulum()  # connect to rnsd or start embedded instance

    server = ThreadingHTTPServer(("127.0.0.1", args.port), _Handler)
    RNS.log(f"[rns_bridge] listening on http://127.0.0.1:{args.port}", RNS.LOG_INFO)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        RNS.log("[rns_bridge] shutting down", RNS.LOG_INFO)


if __name__ == "__main__":
    main()
