"""디스코드 연동: 보내기(웹후크 - 귓속말·성인 층·디스코드에서 온 말은 안 보냄, 멘션 막기), 받기(봇 토큰 - 기준점, 메아리 방지, [이름표] 손님)."""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="boa3d_dc_"))

from boa3d import lib3d_agents, lib3d_discord as dc, lib3d_presence as pr  # noqa: E402

HOOK = "https://discord.com/api/webhooks/111/tok-en_1"


class DiscordTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.inbox = []
        os.environ.update({"LIB3D_DISCORD_WEBHOOK_URL": HOOK, "LIB3D_DISCORD_BOT_TOKEN": "bot-token", "LIB3D_DISCORD_LABEL": "출판사",
                           "LIB3D_DISCORD_SEND": "chat,staff,delivery"})
        os.environ.pop("LIB3D_DISCORD_CHANNEL_ID", None)
        dc._STATE.update(channel="", last_id="", error="")
        dc._OUT.clear()
        dc._GUESTS.clear()
        lib3d_agents._ground_floor = lambda: "general"

        def fake(method, url, body=None, bot=False, timeout=15):
            self.calls.append((method, url, body, bot))
            if method == "GET" and url == HOOK:
                return 200, {"channel_id": "555"}
            if "messages?limit=1" in url:
                return 200, [{"id": "100"}]
            if "messages?after=" in url:
                out, self.inbox = self.inbox, []
                return 200, out
            return 204, None
        dc._req = fake
        dc.start()

    def test_send(self):
        pr.say("u1#a", "안녕하세요 @everyone", "general", "마루")
        pr.post("한서윤 (사서)", "이쪽 서가예요", "general")
        pr.post("한서윤 (사서)", "귓속말", "general", to="u1#a")
        pr.post("관리자", "성인 층 말", "adult")
        pr.post("[출판사] 애순이", "디스코드에서 온 말", "general", src="discord")
        dc._flush()
        posts = [c for c in self.calls if c[0] == "POST"]
        self.assertEqual([p[2]["content"] for p in posts], ["안녕하세요 @everyone", "이쪽 서가예요"])
        self.assertEqual(posts[0][2]["username"], "마루 (3D 서재)")
        self.assertEqual(posts[0][2]["allowed_mentions"], {"parse": []})
        self.assertFalse(posts[0][3])   # 웹후크는 봇 토큰 없이

    def test_send_kinds(self):
        os.environ["LIB3D_DISCORD_SEND"] = "chat"
        pr.post("한서윤 (사서)", "직원 말", "general")
        pr.say("u2#b", "사람 말", "general", "보리")
        dc._flush()
        self.assertEqual([c[2]["content"] for c in self.calls if c[0] == "POST"], ["사람 말"])

    def test_receive(self):
        dc._poll_once()   # 채널은 웹후크에서, 기준점 100 (지난 대화는 건너뜀)
        self.assertEqual((dc._STATE["channel"], dc._STATE["last_id"]), ("555", "100"))
        self.inbox = [
            {"id": "102", "type": 0, "content": "<@9> 오늘 신간 왔어요 <:book:77>", "author": {"id": "9", "username": "aesun", "global_name": "애순이"},
             "mentions": [{"id": "9", "username": "aesun", "global_name": "애순이"}]},
            {"id": "101", "type": 0, "content": "", "author": {"id": "8", "username": "sora"}, "attachments": [{"content_type": "image/png"}]},
            {"id": "103", "type": 0, "content": "메아리", "webhook_id": "111", "author": {"username": "마루 (3D 서재)"}},
            {"id": "104", "type": 0, "content": "인물 웹후크 글", "webhook_id": "999", "author": {"id": "999", "username": "위벨"}},
            {"id": "105", "type": 7, "content": "", "author": {"id": "7", "username": "새 멤버"}},
        ]
        before = pr._SEQ["chat"]
        dc._poll_once()
        self.assertEqual(dc._STATE["last_id"], "105")
        got = [(c["user"], c["text"]) for c in pr._CHAT if c["id"] > before]
        self.assertEqual(got, [("[출판사] sora", "(그림)"), ("[출판사] 애순이", "@애순이 오늘 신간 왔어요 :book:"), ("[출판사] 위벨", "인물 웹후크 글")])
        self.assertTrue(all(c.get("src") == "discord" for c in pr._CHAT if c["id"] > before))
        guests = dc.public()
        self.assertEqual(sorted(g["name"] for g in guests), sorted(["[출판사] sora", "[출판사] 위벨", "[출판사] 애순이"]))
        self.assertEqual({g["target"] for g in guests}, {"entrance"})   # 막 들어와 입구에서
        self.assertEqual(len({g["slot"] for g in guests}), 3)
        later = dc.public(now=dc._GUESTS["9"]["last"] + 10)
        self.assertEqual({g["target"] for g in later}, {"office"})
        self.assertEqual(dc.public(now=dc._GUESTS["9"]["last"] + dc.STAY_SEC + 5)[0]["target"], "entrance")   # 말이 끊기면 나감
        self.assertEqual(dc.public(now=dc._GUESTS["9"]["last"] + dc.STAY_SEC + dc.LEAVE_SEC + 5), [])
        dc._flush()
        self.assertFalse([c for c in self.calls if c[0] == "POST"])   # 받은 말은 다시 보내지 않음

    def test_off_by_default(self):
        for k in ("LIB3D_DISCORD_WEBHOOK_URL", "LIB3D_DISCORD_BOT_TOKEN"):
            os.environ.pop(k)
        self.assertFalse(dc.send_on() or dc.recv_on())
        pr.say("u3#c", "꺼져 있으면", "general", "누리")
        dc._flush()
        self.assertFalse(self.calls)
        os.environ["LIB3D_DISCORD_WEBHOOK_URL"] = "https://evil.example.com/api/webhooks/1/x"
        self.assertFalse(dc.send_on())

    def test_name_call_and_roam(self):
        from boa3d import lib3d_agents as ag
        a, q = ag.match_name("한서윤 씨 책 추천해 줘")
        self.assertEqual((a["id"], q), ("librarian", "책 추천해 줘"))
        self.assertEqual(ag.match_name("서윤아 어디야")[0]["id"], "librarian")
        self.assertEqual(ag.match_name("사서님 만화 찾아줘")[0]["id"], "librarian")
        self.assertEqual(ag.match_name("오늘 사서 봤어?"), (None, None))     # 직업은 글 맨 앞에서 부를 때만
        self.assertEqual(ag.match_name("@사서 추천"), (None, None))          # @는 귓속말 문답(match_call)
        self.assertEqual(ag.match_name("안녕", speaker="[출판사] 한서윤"), (None, None))
        called = []
        for obj, attr, fake in ((ag, "talk", lambda a, key, q, floor, admin, adult, display=None, public=False: called.append((a["id"], key, public))),
                                (ag.lib3d_ai, "flags", lambda: {"ask": True}), (ag.lib3d_ai, "configured", lambda: True),
                                (ag.lib3d_ai, "budget", lambda: {"limit": 0, "used": 0})):
            self.addCleanup(setattr, obj, attr, getattr(obj, attr))
            setattr(obj, attr, fake)
        ag.state()["agents"].pop("docent", None)
        dc._arrive("9", "애순이", "이도윤 씨 안내 좀", human=True)
        dc._arrive("b", "봇", "이도윤 씨 안내 좀", human=False)             # 봇 글에는 답하지 않는다
        dc._arrive("9", "애순이", "이도윤 씨 또 왔어요", human=True)         # 바로 다시 부르면 쉰다
        self.assertEqual(called, [("docent", "discord:9", True)])
        # 혼자 돌아다니기: 브런치 담당만 제자리, 나머지는 서재 안 다른 곳으로
        self.assertFalse(ag.roams({"id": "x", "job": "브런치 연재 관리"}))
        self.assertTrue(ag.roams({"id": "x", "job": "브런치 연재 관리", "roam": True}))
        import random
        places, ag._floor_places = ag._floor_places, lambda floor: list(ag.PLACES) + ["만화"]   # 시험에서는 DB를 읽지 않게
        self.addCleanup(setattr, ag, "_floor_places", places)
        for s0 in ag.state()["agents"].values():
            s0.pop("roam_next", None)
            s0["t"] = 0
        moved = ag.roam_tick(5000.0, random.Random(3))
        self.assertEqual(set(moved), {x["id"] for x in ag.staff()})
        self.assertTrue(all(ag.state()["agents"][i]["target"] for i in moved))
        self.assertEqual(ag.roam_tick(5005.0), [])                          # 머무는 동안은 그대로
        ag._WORKING.add("librarian")
        self.assertNotIn("librarian", ag.roam_tick(9000.0, random.Random(4)))   # 업무 중이면 안 움직인다
        ag._WORKING.discard("librarian")

    def test_weather_city(self):
        from boa3d import lib3d, lib3d_ai
        self.assertEqual(lib3d.weather_city(), "광주")                       # 기준값
        self.assertEqual(lib3d.save_outside({"weather": "auto", "city": " 부산 "})["city"], "부산")
        self.assertEqual(lib3d.weather_city(), "부산")
        asked = []

        def fake(url, timeout=15):
            asked.append(url)
            if "geocoding" in url:
                return {"results": [{"latitude": 35.1, "longitude": 129.0, "name": "부산", "country": "대한민국"}]} if "Busan" in url else {}
            return {"current": {"temperature_2m": 7.5, "weather_code": 63}, "daily": {"time": []}}
        self.addCleanup(setattr, lib3d_ai, "_get_json", lib3d_ai._get_json)
        lib3d_ai._get_json = fake
        lib3d_ai._CITY_W.clear()
        w = lib3d_ai.city_weather()
        self.assertEqual((w["city"], w["weather"], w["temp"]), ("부산", "rain", 7.5))
        n = len(asked)
        lib3d_ai.city_weather()
        self.assertEqual(len(asked), n)                                       # 15분 동안은 다시 묻지 않는다
        self.assertIn("부산", lib3d_ai._tool_weather({}))                     # AI 날씨 도구도 기준 도시로
        self.assertEqual([lib3d_ai._sky(c) for c in (0, 3, 61, 73)], ["clear", "cloudy", "rain", "snow"])
        self.assertEqual(lib3d_ai.city_weather("없는곳")["weather"], "")
        lib3d.save_outside({"weather": "clear"})
        self.assertEqual(lib3d.weather_city(), "광주")

    def test_thread_id_in_webhook_url(self):
        for tail in ("?thread_id=555", "&thread_id=555", "?wait=true&thread_id=555"):
            os.environ["LIB3D_DISCORD_WEBHOOK_URL"] = HOOK + tail
            self.assertEqual(dc.webhook(), ("111", HOOK))
            self.assertEqual(dc.thread_id(), "555")
        self.assertEqual(dc._resolve_channel(), "555")   # 받기도 그 스레드
        pr.say("u4#c", "스레드로", "general", "누리")
        dc._flush()
        post = [c for c in self.calls if c[0] == "POST"][-1]
        self.assertTrue(post[1].endswith("/webhooks/111/tok-en_1?wait=false&thread_id=555"))
        os.environ["LIB3D_DISCORD_WEBHOOK_URL"] = HOOK
        self.assertEqual(dc.thread_id(), "")
        os.environ["LIB3D_DISCORD_THREAD_ID"] = "777"
        self.assertEqual(dc.thread_id(), "777")
        os.environ.pop("LIB3D_DISCORD_THREAD_ID")


if __name__ == "__main__":
    unittest.main()
