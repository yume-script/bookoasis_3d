"""BookOasis 3D 서재 ↔ 디스코드 채널 (기본 꺼짐 - .env에 값을 넣어야 켜짐)

보내기 (3D 서재 → 디스코드): 채널 웹후크 LIB3D_DISCORD_WEBHOOK_URL
  - 1층 등 일반 층의 함께 보기 채팅(chat), AI 직원·손님이 소리 내어 한 말(staff), 배달 도착(delivery) - LIB3D_DISCORD_SEND로 고름
  - 디스코드에는 "이름 (3D 서재)"로 보인다. 귓속말(@사서 문답)·성인 층은 보내지 않고, @everyone 같은 멘션은 막는다.
받기 (디스코드 → 3D 서재): 봇 토큰 LIB3D_DISCORD_BOT_TOKEN으로 그 채널의 새 메시지를 LIB3D_DISCORD_POLL_SEC(3초)마다 읽는다
  - 채널은 LIB3D_DISCORD_CHANNEL_ID, 비우면 웹후크가 걸린 채널 (스레드로 보내면 그 스레드)
  - 스레드로 보내려면 웹후크 주소 뒤에 ?thread_id=스레드ID 를 붙이거나 LIB3D_DISCORD_THREAD_ID에 적는다
  - 말한 사람은 "[LIB3D_DISCORD_LABEL] 이름"(예: [출판사] 애순이)으로 1층 채팅에 바로 보이고, 길 건너 사무실의 회의 탁자 의자에 앉아 말풍선을 띄운다 (사무실을 안 쓰면 1층 라운지)
    (말이 끊기고 STAY_SEC가 지나면 입구로 나간다)
  - 다른 봇·웹후크(예: 디스코드 봇의 인물들)가 쓴 글도 받는다. 이 서재가 웹후크로 보낸 글만 다시 받지 않는다(메아리 방지)
  - 봇은 디스코드 개발자 페이지에서 Message Content Intent를 켜야 내용을 읽을 수 있다. 채널 보기·메시지 기록 보기 권한 필요
바깥에서 이 서버로 들어오는 연결은 없다(봇이 읽으러 나간다) - 외부 주소를 열 필요 없음.
"""
import collections
import hashlib
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request

from . import config, lib3d_presence

log = logging.getLogger("boa3d.discord")
API = "https://discord.com/api/v10"
UA = "DiscordBot (https://github.com/yume-script/bookoasis_3d, 1.0)"
STAY_SEC = 180         # 디스코드 손님이 마지막으로 말한 뒤 서재에 머무는 시간
ENTER_SEC = 6          # 입구에서 라운지로 걸어 들어오는 동안
LEAVE_SEC = 20         # 입구로 걸어 나가는 동안
SAY_SEC = 12           # 말풍선이 떠 있는 시간
MAX_GUESTS = 8
MAX_PEOPLE = 16        # 화면에 세우는 사람 수 (말한 사람 + 위치를 아는 사람)
_WEBHOOK_RE = re.compile(r"^https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api(?:/v\d+)?/webhooks/(\d+)/([\w-]+)(?:[?&](.*))?$")
_THREAD_RE = re.compile(r"(?:^|&)thread_id=(\d+)(?:&|$)")
_LOCK = threading.Lock()
_OUT = collections.deque(maxlen=200)
_GUESTS = {}           # 디스코드 사용자 → {name, first, last, say, say_t, slot}
_STATE = {"started": False, "channel": "", "last_id": "", "error": "", "recv_at": 0.0, "sent_at": 0.0}
_WAKE = threading.Event()


def _env(k, d=""):
    return config.env(k, d).strip()


def webhook():
    """(웹후크 ID, 주소) - 주소 뒤에 붙은 ?thread_id=... (또는 &thread_id=...)는 떼어 낸다"""
    m = _WEBHOOK_RE.match(_env("LIB3D_DISCORD_WEBHOOK_URL"))
    return (m.group(1), m.group(0).split("?")[0].split("&")[0]) if m else (None, None)


def thread_id():
    """스레드(포럼 글 포함)로 보낼 때: 웹후크 주소 뒤의 thread_id 또는 LIB3D_DISCORD_THREAD_ID"""
    t = _env("LIB3D_DISCORD_THREAD_ID")
    if t.isdigit():
        return t
    m = _WEBHOOK_RE.match(_env("LIB3D_DISCORD_WEBHOOK_URL"))
    t = _THREAD_RE.search(m.group(3) or "") if m else None
    return t.group(1) if t else ""


def label():
    return _env("LIB3D_DISCORD_LABEL", "디스코드")[:12] or "디스코드"


def send_kinds():
    return {x.strip() for x in _env("LIB3D_DISCORD_SEND", "chat,staff").split(",") if x.strip()}


def send_on():
    return bool(webhook()[0]) and bool(send_kinds())


def recv_on():
    return bool(_env("LIB3D_DISCORD_BOT_TOKEN")) and bool(_env("LIB3D_DISCORD_CHANNEL_ID") or webhook()[0])


def status():
    bad = _env("LIB3D_DISCORD_WEBHOOK_URL") and not webhook()[0]
    return {"send": send_on(), "recv": recv_on(), "label": label(), "channel": _STATE["channel"],
            "error": "웹후크 주소 형식이 다릅니다 (https://discord.com/api/webhooks/숫자/토큰)" if bad else _STATE["error"],
            "recv_at": _STATE["recv_at"], "sent_at": _STATE["sent_at"], "kinds": sorted(send_kinds())}


# ── HTTP ──
def _req(method, url, body=None, bot=False, timeout=15):
    headers = {"User-Agent": UA}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if bot:
        headers["Authorization"] = "Bot " + _env("LIB3D_DISCORD_BOT_TOKEN")
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read() or b"{}"
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"message": raw[:200].decode("utf-8", "replace")}


def _wait_429(code, data):
    if code == 429:
        time.sleep(min(30.0, float((data or {}).get("retry_after") or 2)) + 0.2)
        return True
    return False


# ── 보내기: 채팅이 생기면 줄에 넣고, 보내는 스레드가 순서대로 (같은 사람이 연달아 말하면 한 번에) ──
def _username(name):
    n = re.sub(r"(?i)discord|clyde", "dc", str(name or "손님")).strip() or "손님"
    return (n[:66] + " (3D 서재)")[:80]


def _on_chat(msg):
    """lib3d_presence의 모든 새 채팅 (귓속말 제외)"""
    if msg.get("to") or msg.get("src") == "discord" or not send_on():
        return
    if str(msg.get("floor") or "") == "adult":
        return
    kind = {"user": "chat", "delivery": "delivery", "activity": "activity"}.get(msg.get("src"), "staff")
    if kind not in send_kinds():
        return
    text = " ".join(str(msg.get("text") or "").split())
    if not text or text == "…":
        return
    _OUT.append((str(msg.get("user") or "손님"), text[:1900]))
    _WAKE.set()


def _send_loop():
    while True:
        _WAKE.wait(5)
        _WAKE.clear()
        time.sleep(1.0)   # 잠깐 모아서
        _flush()


def _flush():
    """줄에 있는 것을 모두 보낸다 (같은 사람이 연달아 한 말은 한 메시지로)"""
    while _OUT:
            name, text = _OUT.popleft()
            while _OUT and _OUT[0][0] == name and len(text) + len(_OUT[0][1]) < 1900:
                text += "\n" + _OUT.popleft()[1]
            wid, url = webhook()
            if not url:
                _OUT.clear()
                break
            for _ in range(3):
                try:
                    code, data = _req("POST", url + "?wait=false" + (("&thread_id=" + thread_id()) if thread_id() else ""), {"content": text, "username": _username(name),
                                                                     "allowed_mentions": {"parse": []}})
                except Exception as e:  # noqa: BLE001
                    _STATE["error"] = "보내기: %s" % e
                    time.sleep(5)
                    continue
                if _wait_429(code, data):
                    continue
                if code >= 400:
                    _STATE["error"] = "보내기: HTTP %s %s" % (code, str((data or {}).get("message") or "")[:120])
                else:
                    _STATE["sent_at"] = time.time()
                break


# ── 받기 ──
_MENTION = re.compile(r"<@!?(\d+)>")
_EMOJI = re.compile(r"<a?:(\w+):\d+>")
_CHANNEL_REF = re.compile(r"<#\d+>")


def _text(m):
    names = {u.get("id"): (u.get("global_name") or u.get("username") or "?") for u in m.get("mentions") or []}
    t = _MENTION.sub(lambda x: "@" + names.get(x.group(1), "누군가"), m.get("content") or "")
    t = _CHANNEL_REF.sub("#채널", _EMOJI.sub(r":\1:", t))
    t = " ".join(t.split())
    if not t and m.get("attachments"):
        t = "(그림)" if any(str(a.get("content_type") or "").startswith("image/") for a in m["attachments"]) else "(파일)"
    if not t and m.get("embeds"):
        e = m["embeds"][0]
        t = " ".join(str(e.get("title") or e.get("description") or "").split())
    if not t and m.get("sticker_items"):
        t = "(스티커 %s)" % m["sticker_items"][0].get("name", "")
    return t[:lib3d_presence.CHAT_MAX_LEN]


def _arrive(key, name, text, human=False):
    """디스코드에서 한 말 → 1층 채팅 + 1층 라운지 손님. 사람이 서재 AI 직원의 이름을 부르면 그 직원이 답한다
    (봇·웹후크 글에는 답하지 않는다 - 봇끼리 끝없이 주고받지 않게. 바깥 AI가 맡은 직원도 빼서 디스코드 쪽 답과 겹치지 않게)"""
    now = time.time()
    shown = "[%s] %s" % (label(), name)
    from . import lib3d_agents   # 1층(일반 층)에 - 순환 import를 피해 여기서
    try:
        ground = lib3d_agents._ground_floor()
    except Exception:  # noqa: BLE001 - DB가 잠깐 안 돼도
        ground = "general"
    lib3d_presence.post(shown, text, ground, src="discord")
    with _LOCK:
        g = _GUESTS.get(key)
        if not g or now - g["last"] > STAY_SEC + LEAVE_SEC:   # 새로 들어옴 (나간 사람이면 다시 입구로)
            used = {x["slot"] for k, x in _GUESTS.items() if k != key and now - x["last"] <= STAY_SEC + LEAVE_SEC}
            slot = next((i for i in range(MAX_GUESTS * 3) if i not in used), len(used))
            g = _GUESTS[key] = {"first": now, "slot": slot}
        g.update(name=shown, last=now, say=text[:80], say_t=now)
        if len(_GUESTS) > MAX_GUESTS * 3:
            for k in sorted(_GUESTS, key=lambda k: _GUESTS[k]["last"])[:len(_GUESTS) - MAX_GUESTS * 3]:
                _GUESTS.pop(k, None)
    if human:
        try:
            lib3d_agents.name_call(text, "discord:%s" % key, shown, ground, skip_remote=True)
        except Exception as e:  # noqa: BLE001 - 답을 못 해도 받기는 계속
            log.warning("디스코드 이름 응답 실패: %s", e)


def _resolve_channel():
    cid = _env("LIB3D_DISCORD_CHANNEL_ID")
    if cid:
        return cid
    if thread_id():  # 스레드로 보내면 그 스레드를 읽는다
        return thread_id()
    wid, url = webhook()
    if not url:
        return ""
    code, data = _req("GET", url)
    return str((data or {}).get("channel_id") or "") if code == 200 else ""


def _recv_loop():
    backoff = 0
    while True:
        try:
            sec = max(2.0, float(_env("LIB3D_DISCORD_POLL_SEC", "3") or 3))
        except ValueError:
            sec = 3.0
        time.sleep(sec + backoff)
        if not recv_on():
            continue
        try:
            _poll_once()
            backoff = 0
        except Exception as e:  # noqa: BLE001 - 디스코드가 잠깐 안 돼도 서재는 그대로
            if _STATE["error"] != "받기: %s" % e:
                log.warning("디스코드 받기 실패: %s", e)
            _STATE["error"] = "받기: %s" % e
            backoff = min(60, backoff * 2 + 5)


def _poll_once():
    """채널의 새 메시지를 한 번 읽는다 (처음에는 기준만 잡고 지난 대화는 건너뜀)"""
    if not _STATE["channel"]:
        _STATE["channel"] = _resolve_channel()
        if not _STATE["channel"]:
            raise RuntimeError("채널을 모릅니다 (LIB3D_DISCORD_CHANNEL_ID 또는 웹후크 주소)")
    ch = _STATE["channel"]
    if not _STATE["last_id"]:
        code, data = _req("GET", "%s/channels/%s/messages?limit=1" % (API, ch), bot=True)
        if _wait_429(code, data):
            return
        if code != 200:
            raise RuntimeError("HTTP %s %s" % (code, str((data or {}).get("message") or "")[:120]))
        _STATE["last_id"] = (data[0]["id"] if data else "0")
        _STATE["error"] = ""
        return
    code, data = _req("GET", "%s/channels/%s/messages?after=%s&limit=50" % (API, ch, _STATE["last_id"]), bot=True)
    if _wait_429(code, data):
        return
    if code != 200:
        raise RuntimeError("HTTP %s %s" % (code, str((data or {}).get("message") or "")[:120]))
    wid = webhook()[0]
    for m in sorted(data or [], key=lambda x: int(x["id"])):
        _STATE["last_id"] = m["id"]
        if m.get("type") not in (0, 19) or (wid and m.get("webhook_id") == wid):
            continue
        a = m.get("author") or {}
        name = " ".join(str(a.get("global_name") or a.get("username") or "손님").split())[:20]
        text = _text(m)
        if text:
            _arrive(("w:" + name) if m.get("webhook_id") else a.get("id", name), name, text,
                    human=not m.get("webhook_id") and not a.get("bot"))
            _STATE["recv_at"] = time.time()
    _STATE["error"] = ""


def public(now=None):
    """3D 화면용 디스코드 손님 (1층): 말한 사람 + 바깥 프로그램이 위치를 알려 준 사람(lib3d_where).
    자리(place)는 그 사람이 지금 있다는 곳 - 모르면 사무실 회의 탁자. 집에 있거나 자는 사람은 보이지 않는다.
    말한 사람은 들어옴(입구) → 자리 → 말이 끊기면 나감, 위치만 아는 사람은 그 자리에 그대로."""
    from . import lib3d_where
    now = now or time.time()
    out, names = [], set()
    where = lib3d_where.everyone(now)
    tag = "[%s] " % label()
    with _LOCK:
        for key, g in _GUESTS.items():
            idle = now - g["last"]
            if idle > STAY_SEC + LEAVE_SEC:
                continue
            plain = g["name"][len(tag):] if g["name"].startswith(tag) else g["name"]
            w = where.get(plain)
            names.add(plain)
            if w and w["place"] == "home" and idle > SAY_SEC:   # 집에서 메신저로 말한 사람: 말하는 동안만 잠깐
                continue
            target = "entrance" if (not w and (now - g["first"] < ENTER_SEC or idle > STAY_SEC)) else "office"
            out.append({"id": "dc_" + hashlib.md5(key.encode("utf-8")).hexdigest()[:12], "kind": "discord", "name": g["name"],
                        "job": (w or {}).get("activity", ""), "call": "", "post": "entrance", "look": 61 + g["slot"] * 3, "target": target, "slot": g["slot"],
                        "place": (w or {}).get("place", "meeting") if not (w and w["place"] == "home") else "meeting", "where": (w or {}).get("location", ""),
                        "say": g["say"] if now - g["say_t"] < SAY_SEC else "", "book": "", "book_title": ""})
    for i, (name, w) in enumerate(sorted(where.items())):   # 말은 안 했지만 어디 있는지 아는 사람
        if name in names or w["place"] == "home" or len(out) >= MAX_PEOPLE:
            continue
        hid = hashlib.md5(name.encode("utf-8")).hexdigest()
        out.append({"id": "wh_" + hid[:12], "kind": "discord", "name": tag + name, "job": w.get("activity", ""), "call": "", "post": "entrance",
                    "look": 61 + (int(hid[:4], 16) % 40) * 3, "target": "office", "slot": 100 + i, "place": w["place"], "where": w.get("location", ""),
                    "say": "", "book": "", "book_title": ""})
    return out[:MAX_PEOPLE]


def start():
    lib3d_presence.add_listener(_on_chat)
    if _STATE["started"]:
        return
    _STATE["started"] = True
    threading.Thread(target=_send_loop, name="lib3d-discord-send", daemon=True).start()
    threading.Thread(target=_recv_loop, name="lib3d-discord-recv", daemon=True).start()
    if send_on() or recv_on():
        log.info("디스코드 연동: 보내기 %s, 받기 %s (이름 [%s])", "켬" if send_on() else "끔", "켬" if recv_on() else "끔", label())
