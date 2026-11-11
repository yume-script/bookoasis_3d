"""픽시브 랭킹 전시관: 설정(건물·랭킹·보일 사람·쿠키), 랭킹 걸러 내기(R-18·수위), 그림 주소 제한."""
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="boa3d_px_"))

from boa3d import config, lib3d, lib3d_pixiv as px  # noqa: E402

RANK = {"contents": [
    {"illust_id": 1, "rank": 1, "title": "하늘", "user_name": "작가A", "url": "https://i.pximg.net/c/240x480/img-master/img/2026/11/01/00/00/00/1_p0_master1200.jpg",
     "tags": ["風景"], "illust_content_type": {"sexual": 0}, "width": 800, "height": 1200},
    {"illust_id": 2, "rank": 2, "title": "수위", "user_name": "작가B", "url": "https://i.pximg.net/c/240x480/img-master/img/2026/11/01/00/00/00/2_p0_master1200.jpg",
     "tags": ["水着"], "illust_content_type": {"sexual": 1}},
    {"illust_id": 3, "rank": 3, "title": "성인", "user_name": "작가C", "url": "https://i.pximg.net/c/240x480/img-master/img/2026/11/01/00/00/00/3_p0_master1200.jpg",
     "tags": ["R-18"], "illust_content_type": {"sexual": 2}},
    {"illust_id": 4, "rank": 4, "title": "다른 곳", "user_name": "작가D", "url": "https://evil.example.com/x.jpg", "tags": []}]}


class PixivTest(unittest.TestCase):
    def setUp(self):
        self.env = os.path.join(tempfile.mkdtemp(prefix="boa3d_pxenv_"), ".env")
        self.addCleanup(setattr, config, "ENV_PATH", config.ENV_PATH)
        config.ENV_PATH = self.env
        os.environ.pop("LIB3D_PIXIV_PHPSESSID", None)
        self.addCleanup(os.environ.pop, "LIB3D_PIXIV_PHPSESSID", None)
        lib3d.save_setting("pixiv", {})
        self.addCleanup(lib3d.save_setting, "pixiv", {})
        px._LIST.clear()
        px._IMG.clear()
        self.calls = []

        def fake(url, timeout=12, limit=0):
            self.calls.append(url)
            if "ranking.php" in url:
                return json.dumps(RANK).encode(), "application/json"
            return b"\xff\xd8jpeg", "image/jpeg"
        self.addCleanup(setattr, px, "_fetch", px._fetch)
        px._fetch = fake

    def test_settings_and_visibility(self):
        self.assertFalse(px.allowed(True))                                  # 기본은 꺼짐
        self.assertEqual(px.public(False)["enabled"], False)
        out = px.save({"enabled": True, "building": "STUDIO", "content": "illust", "mode": "weekly", "limit": 99, "phpsessid": "12345_abcdefgh"})
        self.assertEqual((out["on"], out["building"], out["mode"], out["limit"], out["cookie_set"]), (True, "STUDIO", "weekly", 40, True))
        self.assertNotIn("12345_abcdefgh", json.dumps(out))                  # 쿠키 값은 돌려주지 않는다
        self.assertIn("LIB3D_PIXIV_PHPSESSID", open(self.env, encoding="utf-8").read())
        self.assertTrue(px.allowed(True))
        self.assertFalse(px.allowed(False))                                 # 관람자는 허용해야
        self.assertEqual(px.public(False), dict(px.public(False), enabled=False))
        px.save({"viewers": True})
        self.assertTrue(px.allowed(False) and px.public(False)["enabled"])
        self.assertNotIn("cookie_set", px.public(False))
        with self.assertRaises(ValueError):
            px.save({"content": "ugoira", "mode": "monthly"})               # 없는 조합
        with self.assertRaises(ValueError):
            px.save({"mode": "daily_r18"})                                  # 성인 랭킹은 고를 수 없다
        with self.assertRaises(ValueError):
            px.save({"building": lib3d.street()["gallery"]})                # 이미 쓰는 건물
        self.assertFalse(px.save({"clear_cookie": True})["cookie_set"])

    def test_ranking_filter_and_image(self):
        with self.assertRaises(ValueError):
            px.ranking()                                                    # 쿠키 없음
        px.save({"enabled": True, "phpsessid": "12345_abcdefgh"})
        items = px.ranking()
        self.assertEqual([i["title"] for i in items], ["하늘"])               # 수위·R-18·다른 서버 그림은 빠진다
        self.assertEqual(items[0]["url"], "https://www.pixiv.net/artworks/1")
        self.assertIn("mode=daily", self.calls[0])
        px.ranking()
        self.assertEqual(len(self.calls), 1)                                # 30분 보관
        px.save({"safe": False})
        self.assertEqual([i["title"] for i in px.ranking()], ["하늘", "수위"])   # 수위 거르기를 꺼도 R-18은 빠진다
        raw, ctype = px.image(items[0]["thumb"])
        self.assertEqual(ctype, "image/jpeg")
        for bad in ("https://evil.example.com/a.jpg", "http://i.pximg.net/a.jpg", "https://i.pximg.net/../etc/passwd", ""):
            with self.assertRaises(ValueError):
                px.image(bad)


if __name__ == "__main__":
    unittest.main()
