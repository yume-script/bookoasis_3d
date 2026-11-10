"""웹 서버를 실제로 띄워서: 로그인 전 차단, 첫 관리자·로그인, 관람자 권한, 배달 이벤트 토큰, 정적 화면."""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
TMP = tempfile.mkdtemp(prefix="boa3d_test_")
DB = os.path.join(TMP, "bo_general.db")
os.environ.update({"DATA_DIR": os.path.join(TMP, "data"), "BOOKOASIS_DB_URL": "sqlite:///" + DB, "BOOKOASIS_DB_TYPES": "general",
                   "LIB3D_EVENT_TOKEN": "evt-token", "UPDATE_CHECK_URL": "", "BOA3D_ENV_FILE": os.path.join(TMP, ".env")})

from boa3d import auth, lib3d_events, web  # noqa: E402


def _db():
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE libraries (id INTEGER PRIMARY KEY, name TEXT, path TEXT);
        CREATE TABLE books (id INTEGER PRIMARY KEY, library_id INT, file_path TEXT, series_name TEXT, is_deleted INT,
                            cover_image TEXT, title TEXT, file_format TEXT);
        INSERT INTO libraries VALUES (1, '만화', '/x');
        INSERT INTO books (id, library_id, file_path, series_name, is_deleted, title, file_format)
            VALUES (1, 1, '/x/1.zip', '드래곤 라자', 0, '1권', 'zip');
    """)
    con.commit()
    con.close()


class Client:
    def __init__(self, base):
        self.base, self.cookie = base, ""

    def req(self, path, body=None, headers=None):
        h = dict(headers or {})
        if self.cookie:
            h["Cookie"] = self.cookie
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        r = urllib.request.Request(self.base + path, data=data, headers=h, method="POST" if body is not None else "GET")

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            resp = urllib.request.build_opener(NoRedirect).open(r, timeout=10)
        except urllib.error.HTTPError as e:
            resp = e
        sc = resp.headers.get("Set-Cookie")
        if sc:
            self.cookie = sc.split(";")[0]
        raw = resp.read()
        try:
            return resp.status if hasattr(resp, "status") else resp.code, json.loads(raw)
        except ValueError:
            return resp.status if hasattr(resp, "status") else resp.code, raw


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _db()
        cls.server = web.make_server("127.0.0.1", 0)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(TMP, ignore_errors=True)

    def test_flow(self):
        c = Client(self.base)
        code, body = c.req("/api/lib3d/data")
        self.assertEqual(code, 401)
        code, _ = c.req("/library3d")
        self.assertEqual(code, 302)
        self.assertTrue(c.req("/api/auth/state")[1]["setup"])
        code, body = c.req("/api/auth/setup", {"username": "admin", "password": "secret123"})
        self.assertEqual(code, 200, body)
        self.assertTrue(c.cookie.startswith("boa3d_session="))
        code, mods = c.req("/api/modules")
        self.assertEqual((mods["lib3d"], mods["role"]), (True, "admin"))
        code, data = c.req("/api/lib3d/data")
        self.assertEqual(code, 200)
        self.assertEqual([lib["name"] for lib in data["libraries"]], ["만화"])
        code, page = c.req("/library3d")
        self.assertEqual(code, 200)
        self.assertIn(b"library3d/app.js", page)
        # 관람자
        self.assertEqual(c.req("/api/users", {"username": "guest", "password": "secret123", "role": "viewer"})[0], 200)
        v = Client(self.base)
        self.assertEqual(v.req("/api/auth/login", {"username": "guest", "password": "secret123"})[0], 200)
        self.assertEqual(v.req("/api/lib3d/data")[0], 200)
        self.assertEqual(v.req("/api/lib3d/agents")[0], 403)
        self.assertEqual(v.req("/api/users")[0], 403)
        self.assertEqual(v.req("/api/lib3d/settings", {"libraries": None})[0], 403)

    def test_events(self):
        c = Client(self.base)
        body = {"type": "delivery", "source": "webtoon", "items": [{"title": "웹툰", "kind": "webtoon"}], "from": "무시"}
        self.assertEqual(c.req("/api/lib3d/events", body, {"Authorization": "Bearer nope"})[0], 401)
        code, out = c.req("/api/lib3d/events", body, {"Authorization": "Bearer evt-token"})
        self.assertEqual(code, 200, out)
        row = [r for r in lib3d_events._rows() if r["id"] == out["id"]][0]
        self.assertEqual((row["src"], row["from"]), ("webtoon", ""))
        self.assertEqual(c.req("/api/lib3d/events", {"type": "nope"}, {"Authorization": "Bearer evt-token"})[0], 400)

    def test_cookie_name(self):
        self.assertEqual(auth.COOKIE, "boa3d_session")


if __name__ == "__main__":
    unittest.main()
