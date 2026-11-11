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
        self.assertEqual({g["target"] for g in later}, {"lounge"})
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


if __name__ == "__main__":
    unittest.main()
