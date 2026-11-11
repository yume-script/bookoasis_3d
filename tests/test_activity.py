"""서재 소식: 3D 서재 접속, BookOasis 읽기·듣기(진행 기록이 새로 바뀐 것만, 사용자 이름으로), Plex·YMPlayer 재생 시작."""
import os
import sqlite3
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="boa3d_act_"))

from boa3d import bookoasis_db, lib3d_activity as act, lib3d_presence as pr  # noqa: E402


class ActivityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="boa3d_actdb_")
        self.db = os.path.join(self.tmp, "bo.db")
        con = sqlite3.connect(self.db)
        con.executescript("""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
            CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT, series_name TEXT);
            CREATE TABLE user_progress (id INTEGER PRIMARY KEY, book_id INT, user_id INT, last_read_at TEXT);
            CREATE TABLE audiobooks (id INTEGER PRIMARY KEY, title TEXT);
            CREATE TABLE audiobook_progress (id INTEGER PRIMARY KEY, audiobook_id INT, user_id INT, last_listened_at TEXT);
            INSERT INTO users VALUES (1, 'admin'), (2, '누리');
            INSERT INTO books VALUES (1, '1권', '드래곤 라자'), (2, '단권', '');
            INSERT INTO audiobooks VALUES (1, '어린 왕자');
            INSERT INTO user_progress (book_id, user_id, last_read_at) VALUES (1, 1, '2026-11-11 09:00:00');
        """)
        con.commit()
        con.close()
        gw = bookoasis_db.Gateway("general", "sqlite:///" + self.db)
        for obj, attr, fake in ((bookoasis_db, "gateway", lambda t: gw), (bookoasis_db, "configured", lambda: True)):
            self.addCleanup(setattr, obj, attr, getattr(obj, attr))
            setattr(obj, attr, fake)
        old_types = os.environ.get("BOOKOASIS_DB_TYPES")
        self.addCleanup(lambda: os.environ.pop("BOOKOASIS_DB_TYPES", None) if old_types is None else os.environ.__setitem__("BOOKOASIS_DB_TYPES", old_types))
        os.environ.update({"LIB3D_ACTIVITY": "join,read,watch", "BOOKOASIS_DB_TYPES": "general,adult,audiobook"})
        self.addCleanup(os.environ.pop, "LIB3D_ACTIVITY", None)
        for d in (act._SEEN, act._TOLD, act._MARK):
            d.clear()
        act._PLEX["keys"] = act._YMP["keys"] = None
        self.before = pr._SEQ["chat"]

    def said(self):
        return [(c["user"], c["text"], c.get("src")) for c in pr._CHAT if c["id"] > self.before]

    def _sql(self, sql):
        con = sqlite3.connect(self.db)
        con.execute(sql)
        con.commit()
        con.close()

    def test_join_once(self):
        self.assertTrue(act.on_presence("누리", "general", now=1000))
        self.assertFalse(act.on_presence("누리", "general", now=1005))               # 계속 있는 동안은 조용히
        self.assertFalse(act.on_presence("누리", "general", now=1000 + act.JOIN_GAP - 5))
        self.assertTrue(act.on_presence("누리", "general", now=1000 + 3 * act.JOIN_GAP))   # 한참 뒤 다시 오면
        self.assertFalse(act.on_presence("몰래", "adult", now=5000))                  # 성인 층은 알리지 않는다
        self.assertEqual(self.said()[0], ("서재 소식", "누리님이 3D 서재에 들어왔어요.", "activity"))
        os.environ["LIB3D_ACTIVITY"] = "read"
        self.assertFalse(act.on_presence("새사람", "general", now=9000))

    def test_bookoasis_reading(self):
        self.assertEqual(act.poll_bookoasis(), 0)                                    # 처음에는 기준만
        self.assertEqual(self.said(), [])
        self._sql("INSERT INTO user_progress (book_id, user_id, last_read_at) VALUES (1, 2, '2026-11-11 10:00:00')")
        self._sql("INSERT INTO user_progress (book_id, user_id, last_read_at) VALUES (2, 1, '2026-11-11 10:01:00')")
        self._sql("INSERT INTO audiobook_progress (audiobook_id, user_id, last_listened_at) VALUES (1, 2, '2026-11-11 10:02:00')")
        self.assertEqual(act.poll_bookoasis(), 3)
        self.assertEqual([t for _u, t, _s in self.said()],
                         ["누리님이 「드래곤 라자」를 읽고 있어요", "admin님이 「단권」을 읽고 있어요", "누리님이 「어린 왕자」를 듣고 있어요"])
        self._sql("UPDATE user_progress SET last_read_at = '2026-11-11 10:05:00' WHERE user_id = 2")   # 같은 책을 계속 읽는 중
        self.assertEqual(act.poll_bookoasis(), 0)
        self.assertEqual(act.poll_bookoasis(), 0)

    def test_where_places(self):
        from boa3d import lib3d_discord as dc, lib3d_where as wh
        cases = {"ZEEPS 편집국": "book", "편집국 자리에서 원고 교정": "book", "영상팀 편집실": "video", "스튜디오": "video", "카페 오후세시": "cafe",
                 "솥뚜껑 주점": "eat", "회의실": "meeting", "영상팀 회의실": "meeting", "BookOasis 3D 서재": "library", "공원 산책": "street",
                 "집": "home", "집에서 쉬는 중": "home", "우리 집 거실": "home", "강가 캠핑장": "camp", "어딘가": "street"}
        for loc, want in cases.items():
            self.assertEqual(wh.place_of(loc), want, loc)
        self.assertEqual(wh.place_of("자리", company="ZEEPS 영상콘텐츠팀"), "video")      # 모르는 곳이면 소속으로
        self.assertEqual(wh.place_of("자리", company="ZEEPS 편집국"), "book")
        self.assertEqual(wh.place_of("편집국", state="자는 중"), "home")
        wh._PEOPLE.clear()
        dc._GUESTS.clear()
        self.assertEqual(wh.update([{"name": "애순이", "location": "ZEEPS 편집국", "activity": "원고 검토", "state": "일하는 중"},
                                    {"name": "소라", "location": "카페 오후세시", "activity": "커피 내리기"},
                                    {"name": "문하늘", "location": "집", "state": "자는 중"}, {"location": "이름 없음"}], now=1000), 3)
        os.environ["LIB3D_DISCORD_LABEL"] = "출판사"
        self.addCleanup(os.environ.pop, "LIB3D_DISCORD_LABEL", None)
        got = {g["name"]: (g["place"], g["job"], g["target"]) for g in dc.public(now=1010)}
        self.assertEqual(got, {"[출판사] 애순이": ("book", "원고 검토", "office"), "[출판사] 소라": ("cafe", "커피 내리기", "office")})   # 집에 있는 사람은 안 보인다
        self.assertEqual(dc.public(now=1000 + wh.KEEP_SEC + 5), [])                       # 오래된 소식은 믿지 않는다
        wh._PEOPLE.clear()

    def test_plex_and_ymp(self):
        os.environ.update({"LIB3D_PLEX_URL": "http://plex.test:32400", "LIB3D_PLEX_TOKEN": "tok", "LIB3D_YMPLAYER_URL": "http://ymp.test",
                           "LIB3D_YMPLAYER_MCP_TOKEN": "ymp_x"})
        for k in ("LIB3D_PLEX_URL", "LIB3D_PLEX_TOKEN", "LIB3D_YMPLAYER_URL", "LIB3D_YMPLAYER_MCP_TOKEN"):
            self.addCleanup(os.environ.pop, k, None)
        plex = {"MediaContainer": {"Metadata": []}}
        ymp = {"sessions": []}
        calls = []

        def fake(url, headers=None, data=None, timeout=8):
            calls.append((url, headers, data))
            if "plex.test" in url:
                return plex
            return {"jsonrpc": "2.0", "id": 1, "result": {"structuredContent": ymp}}
        self.addCleanup(setattr, act, "_get_json", act._get_json)
        act._get_json = fake
        self.assertEqual(act.poll_once(), 0)                                          # 기준
        plex["MediaContainer"]["Metadata"] = [
            {"type": "episode", "title": "3화", "grandparentTitle": "미생", "User": {"title": "누리"}, "Player": {"state": "playing"}},
            {"type": "movie", "title": "멈춘 영화", "User": {"title": "누리"}, "Player": {"state": "paused"}},
            {"type": "movie", "title": "청불 영화", "contentRating": "청소년관람불가", "User": {"title": "admin"}, "Player": {"state": "playing"}}]
        ymp["sessions"] = [{"user": "admin", "title": "재즈 라이브", "kind": "video"}, {"user": "admin", "title": "숨김", "adult": True}]
        self.assertEqual(act.poll_once(), 2)
        self.assertEqual([t for _u, t, _s in self.said()], ["누리님이 Plex에서 「미생」을 보고 있어요", "admin님이 YMPlayer에서 「재즈 라이브」를 보고 있어요"])
        self.assertEqual(act.poll_once(), 0)                                          # 계속 보는 중
        self.assertEqual(calls[0][1]["X-Plex-Token"], "tok")
        self.assertEqual(calls[1][2]["params"]["name"], "now_watching")
        self.assertEqual(calls[1][1]["Authorization"], "Bearer ymp_x")


if __name__ == "__main__":
    unittest.main()
