"""Unit tests for farmhand.py - run: python3 -m unittest test_farmhand -v"""

import json
import os
import unittest

import farmhand


class TestValidateAction(unittest.TestCase):
    def test_valid_full(self):
        a, err = farmhand.validate_action(
            {"task": "pick", "fruit": "apple", "filter": "ripe"}
        )
        self.assertIsNone(err)
        self.assertEqual(
            a, {"task": "pick", "fruit": "apple", "filter": "ripe", "zone": "any"}
        )

    def test_defaults_all_four_keys(self):
        a, err = farmhand.validate_action({"task": "stop"})
        self.assertIsNone(err)
        self.assertEqual(
            a, {"task": "stop", "fruit": "any", "filter": "any", "zone": "any"}
        )

    def test_zone_enum(self):
        for zone in ("any", "left", "right", "forward", "backward", "home"):
            a, err = farmhand.validate_action({"task": "drive", "zone": zone})
            self.assertIsNone(err)
            self.assertEqual(a["zone"], zone)

    def test_rejects_unknown_key(self):
        a, err = farmhand.validate_action({"task": "pick", "speed": 9000})
        self.assertIsNone(a)
        self.assertIn("unknown keys", err)

    def test_rejects_bad_enum(self):
        for bad in (
            {"task": "explode"},
            {"task": "pick", "fruit": "mango"},
            {"task": "pick", "filter": "rotten"},
        ):
            a, err = farmhand.validate_action(bad)
            self.assertIsNone(a, bad)

    def test_rejects_non_dict_and_bad_zone(self):
        for bad in (["pick"], "pick", None, 42,
                    {"task": "pick", "zone": 3},
                    {"task": "pick", "zone": ""},
                    {"task": "pick", "zone": "row 3"}):
            a, err = farmhand.validate_action(bad)
            self.assertIsNone(a, bad)


class TestMockModel(unittest.TestCase):
    def _action(self, text):
        env = farmhand.handle(text, url="")
        self.assertTrue(env["ok"], env)
        return env.get("action"), env.get("clarification")

    def test_pick_ripe_apples(self):
        a, _ = self._action("pick all ripe apples")
        self.assertEqual(
            a, {"task": "pick", "fruit": "apple", "filter": "ripe", "zone": "any"}
        )

    def test_slang_and_typos(self):
        a, _ = self._action("yo grab every unripe nana")
        self.assertEqual(
            a, {"task": "pick", "fruit": "banana", "filter": "unripe", "zone": "any"}
        )
        a, _ = self._action("get the aples that are green")
        self.assertEqual(a["fruit"], "apple")
        self.assertEqual(a["filter"], "unripe")

    def test_unripe_not_matched_as_ripe(self):
        a, _ = self._action("harvest unripe bananas")
        self.assertEqual(a["filter"], "unripe")

    def test_stop_wins(self):
        a, _ = self._action("stop picking apples right now!")
        self.assertEqual(a["task"], "stop")

    def test_sort(self):
        a, _ = self._action("sort the bananas")
        self.assertEqual(
            a, {"task": "sort", "fruit": "banana", "filter": "any", "zone": "any"}
        )

    def test_both_fruits(self):
        a, _ = self._action("pick apples and bananas")
        self.assertEqual(a["fruit"], "any")

    def test_ambiguous_fruit_asks_clarification(self):
        a, c = self._action("pick the fruit")
        self.assertIsNone(a)
        self.assertIn("apples", c.lower())

    def test_gibberish_asks_clarification(self):
        a, c = self._action("purple monkey dishwasher")
        self.assertIsNone(a)
        self.assertTrue(c)

    def test_drive_zones(self):
        a, _ = self._action("drive forward")
        self.assertEqual((a["task"], a["zone"]), ("drive", "forward"))
        a, _ = self._action("go back to home base")
        self.assertEqual((a["task"], a["zone"]), ("drive", "home"))
        a, _ = self._action("move left a bit")
        self.assertEqual((a["task"], a["zone"]), ("drive", "left"))

    def test_empty_rejected(self):
        env = farmhand.handle("   ", url="")
        self.assertFalse(env["ok"])


class TestParseModelBody(unittest.TestCase):
    def test_bare_json(self):
        self.assertEqual(
            farmhand.parse_model_body('{"task":"pick","fruit":"apple"}'),
            {"task": "pick", "fruit": "apple"},
        )

    def test_wrapped_output(self):
        body = json.dumps({"output": 'Sure! {"task":"pick","fruit":"banana","filter":"ripe"}'})
        self.assertEqual(farmhand.parse_model_body(body)["fruit"], "banana")

    def test_prose_with_embedded_json(self):
        self.assertEqual(
            farmhand.parse_model_body('here you go: {"task":"stop"} hope that helps')["task"],
            "stop",
        )

    def test_garbage(self):
        self.assertIsNone(farmhand.parse_model_body("total garbage, no json"))
        self.assertIsNone(farmhand.parse_model_body("[1,2,3]"))


class TestNormalize(unittest.TestCase):
    def test_clarification_shapes(self):
        for key in ("clarify", "clarification", "question"):
            kind, p = farmhand._normalize_model_output({key: "which fruit?"})
            self.assertEqual((kind, p), ("clarification", "which fruit?"))

    def test_action_wrapper(self):
        kind, p = farmhand._normalize_model_output({"action": {"task": "stop"}})
        self.assertEqual(kind, "action")
        self.assertEqual(p["task"], "stop")

    def test_invalid_never_passes(self):
        kind, p = farmhand._normalize_model_output({"task": "rm -rf /"})
        self.assertIsNone(kind)

    def test_clarification_punct_normalized(self):
        # trained model emits em dashes / smart quotes; UI strings must be ASCII
        kind, p = farmhand._normalize_model_output({"clarify": "Which fruit — apples…"})
        self.assertEqual(kind, "clarification")
        self.assertNotIn("—", p)
        self.assertNotIn("…", p)


class TestEndpointFallback(unittest.TestCase):
    """A dead endpoint must not break the NL box: fall back to mock, flag it."""

    def _dead(self, fallback):
        env = dict(os.environ)
        env.update(FARMHAND_URL="http://127.0.0.1:1/v1", FARMHAND_MODEL="x",
                   FARMHAND_TIMEOUT="1", FARMHAND_FALLBACK=fallback)
        old = os.environ.copy()
        os.environ.update(env)
        try:
            return farmhand.handle("pick all ripe apples")
        finally:
            os.environ.clear()
            os.environ.update(old)

    def test_fallback_on_keeps_working(self):
        e = self._dead("1")
        self.assertTrue(e["ok"])
        self.assertEqual(e["action"]["task"], "pick")
        self.assertIn("fallback", e)  # flagged honestly

    def test_fallback_off_returns_error(self):
        e = self._dead("0")
        self.assertFalse(e["ok"])
        self.assertIn("endpoint error", e["error"])


if __name__ == "__main__":
    unittest.main()
