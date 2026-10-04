"""mitmdump addon: logs flows to SQLite, enforcing scope at the proxy layer.

Second independent check alongside scope-gate.ts, not a replacement.
Run: mitmdump -s ./mitm_addon.py --set traffic_db=... --set scope_config=... --set program_id=...
"""

import json
import sqlite3

from mitmproxy import ctx


class TrafficLogger:
    def load(self, loader):
        loader.add_option("traffic_db", str, "", "SQLite path")
        loader.add_option("scope_config", str, "", "Shared scope JSON path")
        loader.add_option("program_id", str, "", "Program ID")

    def _scope(self):
        with open(ctx.options.scope_config) as f:
            return json.load(f)

    @staticmethod
    def _host_matches(pattern, host):
        if pattern.startswith("*."):
            suffix = pattern[1:]
            return host.endswith(suffix) or host == pattern[2:]
        return host == pattern

    def response(self, flow):
        try:
            scope = self._scope()
        except Exception:
            return
        host = flow.request.pretty_host
        if any(self._host_matches(p, host) for p in scope.get("outOfScope", [])):
            return
        if not any(self._host_matches(p, host) for p in scope.get("inScope", [])):
            return
        conn = sqlite3.connect(ctx.options.traffic_db)
        try:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS flows (
                    flow_id TEXT PRIMARY KEY, program_id TEXT, url TEXT,
                    method TEXT, status INTEGER, headers TEXT, body TEXT,
                    host TEXT, created_at INTEGER)"""
            )
            conn.execute(
                "INSERT OR REPLACE INTO flows VALUES (?,?,?,?,?,?,?,?)",
                (
                    flow.id,
                    ctx.options.program_id,
                    flow.request.pretty_url,
                    flow.request.method,
                    flow.response.status_code,
                    json.dumps(dict(flow.request.headers)),
                    flow.request.get_text() or "",
                    host,
                ),
            )
            conn.commit()
        finally:
            conn.close()


addons = [TrafficLogger()]
