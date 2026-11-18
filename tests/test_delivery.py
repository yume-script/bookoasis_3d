"""배달 차례: 길 건너 사무실에서 걸어와(입구) → 데스크 → 사무실로 돌아감 (배달 로봇이 걸을 시간)."""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="boa3d_dlv_"))

from boa3d import lib3d_events as ev  # noqa: E402


class DeliveryTimelineTest(unittest.TestCase):
    def test_phases(self):
        orig = ev.schedule
        self.addCleanup(setattr, ev, "schedule", orig)
        ev.schedule = lambda now=None: [{"id": "1", "src": "api", "from": "", "note": "", "start": 1000,
                                         "items": [{"title": "드래곤 라자", "kind": "book"}]}]
        at = lambda t: ev.active(now=1000 + t)   # noqa: E731
        self.assertEqual(at(5)["target"], "entrance")             # 사무실에서 걸어오는 중
        self.assertEqual(at(ev.ARRIVE - 1)["say"], "")
        self.assertEqual(at(ev.ARRIVE + 1)["target"], "desk")
        self.assertIn("드래곤 라자", at(ev.ARRIVE + 5)["say"])      # 데스크에서 말함
        self.assertEqual(at(ev.LEAVE + 1)["target"], "entrance")  # 돌아감
        self.assertIsNone(at(ev.DUR + 1))
        self.assertTrue(ev.ARRIVE < ev.LEAVE < ev.DUR)


if __name__ == "__main__":
    unittest.main()
