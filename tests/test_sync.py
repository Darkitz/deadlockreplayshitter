# python3 -m unittest discover tests
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import sync  # noqa: E402

HEROES = [
    {"id": 64, "name": "Drifter", "class_name": "hero_drifter"},
    {"id": 7, "name": "Lady Geist", "class_name": "hero_ghost"},
]


class SyncHelpers(unittest.TestCase):
    def test_account_id_from_steamid64_or_account(self):
        self.assertEqual(sync.to_account_id("76561198037066283"), 76800555)
        self.assertEqual(sync.to_account_id("76800555"), 76800555)

    def test_resolve_heroes(self):
        self.assertEqual(sync.resolve_heroes(HEROES, ["drifter"]), {64})
        self.assertEqual(sync.resolve_heroes(HEROES, ["Lady Geist", "64"]), {7, 64})
        self.assertEqual(sync.resolve_heroes(HEROES, ["ghost"]), {7})
        self.assertIsNone(sync.resolve_heroes(HEROES, ["all"]))
        with self.assertRaises(SystemExit):
            sync.resolve_heroes(HEROES, ["nobody"])

    def test_local_demos_picks_numeric_dem_files(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            (d / "123.dem").write_bytes(b"x")
            (d / "456.dem.partial").write_bytes(b"x")
            (d / "empty.dem").write_bytes(b"x")
            (d / "789.dem").write_bytes(b"")
            old = (sync.DEMOS, sync.GAME_REPLAYS)
            sync.DEMOS, sync.GAME_REPLAYS = d, d / "missing"
            try:
                self.assertEqual(set(sync.local_demos()), {123})
            finally:
                sync.DEMOS, sync.GAME_REPLAYS = old


if __name__ == "__main__":
    unittest.main()
