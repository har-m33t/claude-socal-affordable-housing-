import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import agentbus as ab  # noqa: E402

T0 = datetime(2026, 11, 7, 18, 0, tzinfo=timezone.utc)
TRUSTED = ["har-m33t"]


def comment(cid, env_kwargs, minutes=0, author="har-m33t", text="hi"):
    env = ab.build_envelope(ts=T0 + timedelta(minutes=minutes), **env_kwargs)
    return {"id": cid, "body": ab.render_message(env, text), "user": {"login": author},
            "created_at": ab.iso(T0 + timedelta(minutes=minutes))}, env


def claim(cid, sender, minutes=0, lease=60, **kw):
    return comment(cid, dict(type="claim", sender=sender, to="*", task=1,
                             lease_until=T0 + timedelta(minutes=minutes + lease), **kw), minutes)


def msg(cid, type, sender, minutes=0, **kw):
    kw.setdefault("to", "*")
    return comment(cid, dict(type=type, sender=sender, task=1, **kw), minutes)


class EnvelopeTests(unittest.TestCase):
    def test_round_trip(self):
        env = ab.build_envelope(type="progress", sender="laptop/lead", to="role:writer", task=3,
                                data={"pr": 4})
        body = ab.render_message(env, "Pulled the data.")
        self.assertEqual(ab.parse_envelope(body), env)
        self.assertEqual(ab.message_text(body), "Pulled the data.")

    def test_rejects_invalid(self):
        self.assertIsNone(ab.parse_envelope("just a human comment"))
        self.assertIsNone(ab.parse_envelope("<!-- agentbus\n{not json}\n-->"))
        self.assertIsNone(ab.parse_envelope('<!-- agentbus\n{"v":2,"id":"x"}\n-->'))
        bad_type = ('<!-- agentbus\n{"v":1,"id":"x","type":"rm-rf","from":"a/b","to":"*",'
                    '"task":1,"ts":"2026-01-01T00:00:00Z"}\n-->')
        self.assertIsNone(ab.parse_envelope(bad_type))

    def test_envelope_must_be_at_start(self):
        env = ab.build_envelope(type="ack", sender="a/b", to="*", task=1)
        body = "quoted:\n" + ab.render_message(env, "")
        self.assertIsNone(ab.parse_envelope(body))

    def test_agent_id_validation(self):
        with self.assertRaises(ValueError):
            ab.build_envelope(type="ack", sender="Laptop Lead", to="*", task=1)

    def test_addressing(self):
        env = {"to": "role:writer", "from": "a/lead"}
        self.assertTrue(ab.addressed_to(env, "cloud/writer"))
        self.assertFalse(ab.addressed_to(env, "cloud/reviewer"))
        self.assertFalse(ab.addressed_to({"to": "*", "from": "a/lead"}, "a/lead"))


class TrustTests(unittest.TestCase):
    def test_untrusted_authors_dropped(self):
        c1, _ = claim(1, "evil/agent")
        c1["user"]["login"] = "stranger"
        c2, _ = claim(2, "laptop/lead", minutes=1)
        msgs = ab.decode_thread([c1, c2], TRUSTED)
        self.assertEqual([m["envelope"]["from"] for m in msgs], ["laptop/lead"])

    def test_duplicate_ids_dropped(self):
        c1, env = claim(1, "laptop/lead")
        c2 = {**c1, "id": 2}
        self.assertEqual(len(ab.decode_thread([c1, c2], TRUSTED)), 1)

    def test_stop(self):
        items = [{"id": 5, "body": "/agentbus stop", "user": {"login": "har-m33t"}}]
        self.assertTrue(ab.stop_requested(items, TRUSTED))
        items[0]["user"]["login"] = "stranger"
        self.assertFalse(ab.stop_requested(items, TRUSTED))


class ClaimTests(unittest.TestCase):
    def run_claims(self, items, now_minutes):
        msgs = ab.decode_thread([c for c, _ in items], TRUSTED)
        return ab.active_claim(msgs, now=T0 + timedelta(minutes=now_minutes))

    def holder(self, items, now_minutes=1):
        w = self.run_claims(items, now_minutes)
        return w["envelope"]["from"] if w else None

    def test_earliest_comment_id_wins_regardless_of_ts(self):
        # cloud's clock is behind, but its comment was posted second.
        a = claim(10, "laptop/lead", minutes=0)
        b = claim(11, "cloud/writer", minutes=-30)
        self.assertEqual(self.holder([b, a]), "laptop/lead")

    def test_yield_releases(self):
        items = [claim(1, "laptop/lead"), msg(2, "yield", "laptop/lead", 1), claim(3, "cloud/writer", 2)]
        self.assertEqual(self.holder(items, 3), "cloud/writer")

    def test_loser_yield_does_not_release_winner(self):
        items = [claim(1, "laptop/lead"), claim(2, "cloud/writer"), msg(3, "yield", "cloud/writer")]
        self.assertEqual(self.holder(items), "laptop/lead")

    def test_lease_expiry_with_grace(self):
        items = [claim(1, "laptop/lead", lease=60)]
        self.assertEqual(self.holder(items, 64), "laptop/lead")
        self.assertIsNone(self.holder(items, 66))

    def test_expired_claim_can_be_taken(self):
        items = [claim(1, "laptop/lead", lease=60), claim(2, "cloud/writer", minutes=70)]
        self.assertEqual(self.holder(items, 71), "cloud/writer")

    def test_heartbeat_extends(self):
        items = [claim(1, "laptop/lead", lease=60),
                 msg(2, "heartbeat", "laptop/lead", 30, lease_until=T0 + timedelta(minutes=90))]
        self.assertEqual(self.holder(items, 80), "laptop/lead")

    def test_heartbeat_from_non_holder_ignored(self):
        items = [claim(1, "laptop/lead", lease=60),
                 msg(2, "heartbeat", "cloud/writer", 30, lease_until=T0 + timedelta(minutes=200))]
        self.assertIsNone(self.holder(items, 80))

    def test_handoff(self):
        h = msg(2, "handoff", "laptop/lead", 5, to="cloud/writer")
        items = [claim(1, "laptop/lead"), h]
        self.assertEqual(self.holder(items, 6), "laptop/lead")  # not accepted yet
        accept = claim(3, "cloud/writer", minutes=7, reply_to=h[1]["id"])
        self.assertEqual(self.holder(items + [accept], 8), "cloud/writer")

    def test_handoff_cannot_be_hijacked(self):
        h = msg(2, "handoff", "laptop/lead", 5, to="cloud/writer")
        hijack = claim(3, "desktop/other", minutes=6, reply_to=h[1]["id"])
        self.assertEqual(self.holder([claim(1, "laptop/lead"), h, hijack], 7), "laptop/lead")

    def test_result_releases(self):
        items = [claim(1, "laptop/lead"), msg(2, "result", "laptop/lead", 5)]
        self.assertIsNone(self.holder(items, 6))


if __name__ == "__main__":
    unittest.main()
