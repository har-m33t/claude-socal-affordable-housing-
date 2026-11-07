#!/usr/bin/env python3
"""agentbus: GitHub Issues as an async message broker for agent teams.

Reference client for docs/agent-protocol.md. Standard library only; talks to
GitHub through the `gh` CLI, so each device just needs `gh auth login`.

Environment:
  AGENTBUS_AGENT   this agent's ID, e.g. "laptop/lead" (required for sending)
  AGENTBUS_REPO    owner/repo (overrides .agentbus.json)
  AGENTBUS_STATE   path to the local state file (default ~/.agentbus/state.json)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROTOCOL_VERSION = 1
ENVELOPE_RE = re.compile(r"\A\s*<!--\s*agentbus\s*\n(.*?)\n\s*-->", re.DOTALL)
AGENT_ID_RE = re.compile(r"^[a-z0-9-]+/[a-z0-9-]+$")
STOP_RE = re.compile(r"^\s*/agentbus\s+stop\b", re.MULTILINE)
MAX_ENVELOPE_BYTES = 4096
CLOCK_SKEW = timedelta(minutes=5)
POLL_OVERLAP = timedelta(minutes=1)

MESSAGE_TYPES = {
    "task", "claim", "yield", "ack", "progress", "heartbeat", "question",
    "answer", "handoff", "result", "review", "close",
}
STATUS_LABELS = {
    "status:open": "0e8a16",
    "status:claimed": "fbca04",
    "status:blocked": "d93f0b",
    "status:review": "1d76db",
    "status:done": "5319e7",
}
OTHER_LABELS = {
    "agent:task": "c5def5",
    "agent:channel": "bfdadc",
}
# Status label to set after sending a given message type (None = unchanged).
STATUS_AFTER = {
    "task": "status:open",
    "claim": "status:claimed",
    "yield": "status:open",
    "question": "status:blocked",
    "answer": "status:claimed",
    "result": "status:review",
    "close": "status:done",
}

DEFAULT_CONFIG = {"trusted_authors": [], "lease_minutes": 60, "poll_seconds": 60}


# --------------------------------------------------------------------------- #
# Pure protocol logic (no network) — covered by tests/test_agentbus.py
# --------------------------------------------------------------------------- #

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def new_message_id(agent: str) -> str:
    return f"{int(time.time() * 1000)}-{agent.replace('/', '-')}-{secrets.token_hex(2)}"


def validate_agent_id(agent: str) -> str:
    if not AGENT_ID_RE.match(agent or ""):
        raise ValueError(f"invalid agent id {agent!r}; expected <device>/<role>, lowercase [a-z0-9-]")
    return agent


def build_envelope(*, type: str, sender: str, to: str, task: int, reply_to: str | None = None,
                   lease_until: datetime | None = None, data: dict | None = None,
                   msg_id: str | None = None, ts: datetime | None = None) -> dict:
    if type not in MESSAGE_TYPES:
        raise ValueError(f"unknown message type {type!r}")
    env = {
        "v": PROTOCOL_VERSION,
        "id": msg_id or new_message_id(sender),
        "type": type,
        "from": validate_agent_id(sender),
        "to": to,
        "task": int(task),
        "reply_to": reply_to,
        "ts": iso(ts or utcnow()),
    }
    if lease_until is not None:
        env["lease_until"] = iso(lease_until)
    if data:
        env["data"] = data
    return env


def render_message(env: dict, text: str) -> str:
    payload = json.dumps(env, separators=(",", ":"), sort_keys=False)
    if len(payload.encode()) > MAX_ENVELOPE_BYTES:
        raise ValueError("envelope exceeds 4 KB; put large payloads in the body or a file")
    header = f"**[{env['type']}]** `{env['from']}` → `{env['to']}`"
    if env.get("reply_to"):
        header += f" (re: `{env['reply_to']}`)"
    parts = [f"<!-- agentbus\n{payload}\n-->", header]
    if text.strip():
        parts.append(text.strip())
    parts.append(f"<sub>— sent by agentbus ({env['from']})</sub>")
    return "\n\n".join(parts) + "\n"


def parse_envelope(body: str | None) -> dict | None:
    """Return the envelope dict from a comment body, or None if it isn't a valid message."""
    if not body:
        return None
    m = ENVELOPE_RE.match(body)
    if not m:
        return None
    raw = m.group(1).strip()
    if len(raw.encode()) > MAX_ENVELOPE_BYTES:
        return None
    try:
        env = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(env, dict) or env.get("v") != PROTOCOL_VERSION:
        return None
    required = ("id", "type", "from", "to", "task", "ts")
    if any(k not in env for k in required) or env["type"] not in MESSAGE_TYPES:
        return None
    if not AGENT_ID_RE.match(str(env["from"])):
        return None
    return env


def message_text(body: str) -> str:
    """Human-readable part of a message (envelope, header and footer stripped)."""
    rest = ENVELOPE_RE.sub("", body, count=1).strip()
    lines = rest.splitlines()
    if lines and lines[0].startswith("**["):
        lines = lines[1:]
    if lines and lines[-1].startswith("<sub>— sent by agentbus"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def is_trusted(item: dict, trusted_authors: list[str]) -> bool:
    login = ((item.get("user") or {}).get("login") or "").lower()
    return login in {a.lower() for a in trusted_authors}


def decode_thread(items: list[dict], trusted_authors: list[str]) -> list[dict]:
    """Turn raw GitHub comments/issue into trusted, de-duplicated messages ordered by comment id."""
    out, seen = [], set()
    for item in sorted(items, key=lambda c: c["id"]):
        if not is_trusted(item, trusted_authors):
            continue
        env = parse_envelope(item.get("body"))
        if env is None or env["id"] in seen:
            continue
        seen.add(env["id"])
        out.append({
            "envelope": env,
            "text": message_text(item["body"]),
            "comment_id": item["id"],
            "created_at": item["created_at"],
            "author": item["user"]["login"],
            "url": item.get("html_url"),
        })
    return out


def stop_requested(items: list[dict], trusted_authors: list[str]) -> bool:
    return any(is_trusted(c, trusted_authors) and parse_envelope(c.get("body")) is None
               and STOP_RE.search(c.get("body") or "") for c in items)


def active_claim(messages: list[dict], now: datetime | None = None) -> dict | None:
    """Apply §4.1–4.3: return the message holding the current claim, or None.

    `messages` must be decoded and ordered by comment id (decode_thread output).
    """
    now = now or utcnow()
    holder: dict | None = None           # current winning claim message
    pending_handoff: dict | None = None  # handoff envelope awaiting acceptance
    for m in messages:
        env = m["envelope"]
        t, sender = env["type"], env["from"]

        if holder is not None and _expired(holder, m["created_at"]):
            holder, pending_handoff = None, None

        if t == "claim":
            accepts_handoff = (pending_handoff is not None
                               and env.get("reply_to") == pending_handoff["id"]
                               and sender == pending_handoff["to"])
            if holder is None or accepts_handoff:
                holder, pending_handoff = m, None
        elif t == "heartbeat" and holder and sender == holder["envelope"]["from"]:
            lease = env.get("lease_until")
            if lease:
                holder = {**holder, "lease_until": lease}
        elif t in ("yield", "result") and holder and sender == holder["envelope"]["from"]:
            holder, pending_handoff = None, None
        elif t == "handoff" and holder and sender == holder["envelope"]["from"]:
            pending_handoff = env
        elif t == "close":
            holder, pending_handoff = None, None

    if holder is not None and _expired(holder, iso(now)):
        return None
    return holder


def _expired(claim_msg: dict, at: str) -> bool:
    lease = claim_msg.get("lease_until") or claim_msg["envelope"].get("lease_until")
    if not lease:
        return False
    return parse_ts(at) > parse_ts(lease) + CLOCK_SKEW


def addressed_to(env: dict, agent: str) -> bool:
    to = env.get("to", "")
    role = agent.split("/", 1)[1] if "/" in agent else agent
    return to in ("*", agent, f"role:{role}") and env.get("from") != agent


# --------------------------------------------------------------------------- #
# GitHub I/O via the gh CLI
# --------------------------------------------------------------------------- #

def gh_api(path: str, method: str = "GET", fields: dict | None = None,
           paginate: bool = False) -> object:
    cmd = ["gh", "api", "-X", method, path, "-H", "Accept: application/vnd.github+json"]
    if paginate:
        cmd += ["--paginate", "--slurp"]
    stdin = None
    if fields is not None:
        cmd += ["--input", "-"]
        stdin = json.dumps(fields)
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"gh api {method} {path} failed: {res.stderr.strip()}")
    if not res.stdout.strip():
        return None
    data = json.loads(res.stdout)
    if paginate and isinstance(data, list) and data and isinstance(data[0], list):
        data = [x for page in data for x in page]
    return data


class Bus:
    def __init__(self, repo: str, agent: str | None, config: dict, state_path: Path):
        self.repo, self.agent, self.config, self.state_path = repo, agent, config, state_path
        self.trusted = config.get("trusted_authors") or []
        if not self.trusted:
            sys.exit("agentbus: .agentbus.json has no trusted_authors; refusing to read messages")

    # -- state -------------------------------------------------------------
    def load_state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def save_state(self, state: dict) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        tmp.replace(self.state_path)

    def _require_agent(self) -> str:
        if not self.agent:
            sys.exit("agentbus: set AGENTBUS_AGENT=<device>/<role> to send messages")
        return validate_agent_id(self.agent)

    # -- reading -----------------------------------------------------------
    def thread_items(self, task: int) -> list[dict]:
        issue = gh_api(f"repos/{self.repo}/issues/{task}")
        comments = gh_api(f"repos/{self.repo}/issues/{task}/comments?per_page=100", paginate=True)
        # Treat the issue body as comment id 0 so it sorts first.
        issue_item = {**issue, "id": 0}
        return [issue_item, *(comments or [])]

    def thread(self, task: int) -> list[dict]:
        return decode_thread(self.thread_items(task), self.trusted)

    def poll(self, include_all: bool = False) -> list[dict]:
        agent = self._require_agent()
        key = f"{self.repo}::{agent}"
        state = self.load_state()
        st = state.get(key, {})
        since = st.get("since") or iso(utcnow() - timedelta(days=7))
        seen = set(st.get("seen", []))
        q = f"since={iso(parse_ts(since) - POLL_OVERLAP)}&sort=updated&direction=asc&per_page=100"
        comments = gh_api(f"repos/{self.repo}/issues/comments?{q}", paginate=True) or []
        issues = gh_api(f"repos/{self.repo}/issues?labels=agent:task&state=all&{q}", paginate=True) or []
        items = []
        for c in comments:
            m = re.search(r"/issues/(\d+)$", c.get("issue_url", ""))
            items.append({**c, "_task": int(m.group(1)) if m else None})
        for i in issues:
            if "pull_request" not in i:
                items.append({**i, "id": 0, "_task": i["number"], "_sort": i["created_at"]})

        out, newest = [], since
        for item in sorted(items, key=lambda c: (c.get("_sort") or c["created_at"], c["id"])):
            newest = max(newest, item.get("updated_at") or item["created_at"])
            if not is_trusted(item, self.trusted):
                continue
            env = parse_envelope(item.get("body"))
            if env is None or env["id"] in seen:
                continue
            seen.add(env["id"])
            if env["task"] != item["_task"]:
                continue  # envelope claims a different issue than where it was posted
            if include_all or addressed_to(env, agent):
                out.append({"envelope": env, "text": message_text(item["body"]),
                            "comment_id": item["id"], "created_at": item["created_at"],
                            "author": item["user"]["login"], "url": item.get("html_url")})
        st["since"] = newest
        st["seen"] = list(seen)[-5000:]
        state[key] = st
        self.save_state(state)
        return out

    # -- writing -----------------------------------------------------------
    def set_status(self, task: int, status: str) -> None:
        issue = gh_api(f"repos/{self.repo}/issues/{task}")
        for label in issue.get("labels", []):
            name = label["name"]
            if name.startswith("status:") and name != status:
                gh_api(f"repos/{self.repo}/issues/{task}/labels/{name}", method="DELETE")
        gh_api(f"repos/{self.repo}/issues/{task}/labels", method="POST", fields={"labels": [status]})

    def send(self, task: int, type: str, text: str, to: str = "*", reply_to: str | None = None,
             data: dict | None = None, lease: bool = False) -> dict:
        agent = self._require_agent()
        if stop_requested(self.thread_items(task), self.trusted):
            sys.exit(f"agentbus: a trusted human requested /agentbus stop on #{task}; not sending")
        lease_until = utcnow() + timedelta(minutes=self.config["lease_minutes"]) if lease else None
        env = build_envelope(type=type, sender=agent, to=to, task=task, reply_to=reply_to,
                             lease_until=lease_until, data=data)
        comment = gh_api(f"repos/{self.repo}/issues/{task}/comments", method="POST",
                         fields={"body": render_message(env, text)})
        status = STATUS_AFTER.get(type)
        if type == "review" and (data or {}).get("verdict") == "changes":
            status = "status:claimed"
        if status:
            self.set_status(task, status)
        if type == "close":
            gh_api(f"repos/{self.repo}/issues/{task}", method="PATCH", fields={"state": "closed"})
        return {"envelope": env, "comment_id": comment["id"], "url": comment["html_url"]}

    def create_task(self, title: str, text: str, to: str, data: dict | None, channel: bool) -> dict:
        agent = self._require_agent()
        issue = gh_api(f"repos/{self.repo}/issues", method="POST",
                       fields={"title": title, "body": "(pending)",
                               "labels": ["agent:channel" if channel else "agent:task", "status:open"]})
        env = build_envelope(type="task", sender=agent, to=to, task=issue["number"], data=data)
        gh_api(f"repos/{self.repo}/issues/{issue['number']}", method="PATCH",
               fields={"body": render_message(env, text)})
        return {"envelope": env, "number": issue["number"], "url": issue["html_url"]}

    def claim(self, task: int, reply_to: str | None = None) -> bool:
        agent = self._require_agent()
        msgs = self.thread(task)
        current = active_claim(msgs)
        if current and current["envelope"]["from"] == agent:
            print(f"already holding claim on #{task}")
            return True
        if current and not reply_to:
            print(f"#{task} is held by {current['envelope']['from']}; not claiming")
            return False
        sent = self.send(task, "claim", "Claiming this task.", reply_to=reply_to, lease=True)
        winner = active_claim(self.thread(task))
        if winner and winner["envelope"]["id"] == sent["envelope"]["id"]:
            print(f"claimed #{task}")
            return True
        holder = winner["envelope"]["from"] if winner else "nobody"
        self.send(task, "yield", f"Lost claim race to `{holder}`.", reply_to=sent["envelope"]["id"])
        print(f"lost claim on #{task} to {holder}")
        return False

    def init_labels(self) -> None:
        existing = {l["name"] for l in gh_api(f"repos/{self.repo}/labels?per_page=100", paginate=True)}
        for name, color in {**STATUS_LABELS, **OTHER_LABELS}.items():
            if name not in existing:
                gh_api(f"repos/{self.repo}/labels", method="POST", fields={"name": name, "color": color})
                print(f"created label {name}")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def load_config() -> dict:
    root = Path(__file__).resolve().parent.parent
    cfg = dict(DEFAULT_CONFIG)
    path = root / ".agentbus.json"
    if path.exists():
        cfg.update(json.loads(path.read_text()))
    if os.environ.get("AGENTBUS_REPO"):
        cfg["repo"] = os.environ["AGENTBUS_REPO"]
    if not cfg.get("repo"):
        sys.exit("agentbus: no repo configured (.agentbus.json or AGENTBUS_REPO)")
    return cfg


def read_text(args) -> str:
    if getattr(args, "body_file", None):
        return Path(args.body_file).read_text()
    return getattr(args, "text", "") or ""


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agentbus", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init-labels", help="create protocol labels in the repo")

    t = sub.add_parser("task", help="open a new task issue")
    t.add_argument("title")
    t.add_argument("text", nargs="?", default="")
    t.add_argument("--body-file")
    t.add_argument("--to", default="*")
    t.add_argument("--data")
    t.add_argument("--channel", action="store_true", help="long-lived channel instead of a task")

    s = sub.add_parser("send", help="post a message to a task")
    s.add_argument("task", type=int)
    s.add_argument("type", choices=sorted(MESSAGE_TYPES - {"task", "claim", "heartbeat"}))
    s.add_argument("text", nargs="?", default="")
    s.add_argument("--body-file")
    s.add_argument("--to", default="*")
    s.add_argument("--reply-to")
    s.add_argument("--data", help="JSON object")

    c = sub.add_parser("claim", help="claim a task and resolve races")
    c.add_argument("task", type=int)
    c.add_argument("--reply-to", help="handoff message id being accepted")

    h = sub.add_parser("heartbeat", help="renew your claim lease")
    h.add_argument("task", type=int)

    po = sub.add_parser("poll", help="print new messages for this agent as JSON lines")
    po.add_argument("--all", action="store_true", help="include messages not addressed to me")
    po.add_argument("--watch", action="store_true", help="keep polling every poll_seconds")

    th = sub.add_parser("thread", help="print a task's decoded message history")
    th.add_argument("task", type=int)

    args = p.parse_args(argv)
    cfg = load_config()
    state_path = Path(os.environ.get("AGENTBUS_STATE", Path.home() / ".agentbus" / "state.json"))
    bus = Bus(cfg["repo"], os.environ.get("AGENTBUS_AGENT"), cfg, state_path)

    if args.cmd == "init-labels":
        bus.init_labels()
    elif args.cmd == "task":
        data = json.loads(args.data) if args.data else None
        r = bus.create_task(args.title, read_text(args), args.to, data, args.channel)
        print(json.dumps({"number": r["number"], "url": r["url"], "id": r["envelope"]["id"]}))
    elif args.cmd == "send":
        data = json.loads(args.data) if args.data else None
        r = bus.send(args.task, args.type, read_text(args), to=args.to,
                     reply_to=args.reply_to, data=data)
        print(json.dumps({"url": r["url"], "id": r["envelope"]["id"]}))
    elif args.cmd == "claim":
        return 0 if bus.claim(args.task, args.reply_to) else 1
    elif args.cmd == "heartbeat":
        current = active_claim(bus.thread(args.task))
        if not current or current["envelope"]["from"] != bus.agent:
            sys.exit(f"agentbus: you don't hold the claim on #{args.task}")
        r = bus.send(args.task, "heartbeat", "", lease=True)
        print(json.dumps({"lease_until": r["envelope"]["lease_until"]}))
    elif args.cmd == "poll":
        while True:
            for m in bus.poll(include_all=args.all):
                print(json.dumps(m), flush=True)
            if not args.watch:
                break
            time.sleep(max(60, int(cfg["poll_seconds"])))
    elif args.cmd == "thread":
        for m in bus.thread(args.task):
            print(json.dumps(m))
    return 0


if __name__ == "__main__":
    sys.exit(main())
