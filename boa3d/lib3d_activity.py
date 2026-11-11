"""BookOasis 3D 서재 '서재 소식' - 누가 들어왔는지, 누가 무엇을 읽고·듣고·보는지 채팅으로 알려 준다

무엇을 알릴지는 .env의 LIB3D_ACTIVITY (쉼표로): join(3D 서재 접속) · read(BookOasis에서 읽기·듣기·보기) · watch(Plex·YMPlayer 재생).
기본은 join,read,watch. 비우면 전부 끔.
  join   서재에 새로 들어온 사람 (같은 사람은 JOIN_GAP 안에 다시 알리지 않는다)
  read   BookOasis DB의 진행 기록(user_progress·audiobook_progress·video_progress)이 새로 바뀐 것 + users의 이름
  watch  Plex 서버의 지금 재생(/status/sessions - LIB3D_PLEX_URL·LIB3D_PLEX_TOKEN),
         YMPlayer의 MCP 도구 now_watching (LIB3D_YMPLAYER_MCP_TOKEN - 관리자 사용자의 MCP 토큰)
성인 서재와 성인 등급 영상은 알리지 않는다. 같은 사람·같은 작품은 REPEAT_GAP 안에 한 번만.
알림은 채팅에 '서재 소식' 이름으로 올라간다 (디스코드로도 보내려면 LIB3D_DISCORD_SEND에 activity 추가).
"""
import json
import logging
import threading
import time
import urllib.request

from . import bookoasis_db, config, lib3d_presence

log = logging.getLogger("boa3d.activity")
WHO = "서재 소식"
POLL_SEC = 45
JOIN_GAP = 600          # 같은 사람이 다시 들어와도 이 시간 안에는 또 알리지 않는다
REPEAT_GAP = 1800       # 같은 사람·같은 작품
ADULT_RATINGS = ("청소년관람불가", "청불", "nc-17", "x", "xxx", "18+", "19", "19+", "r18", "tv-ma")
_LOCK = threading.Lock()
_SEEN = {}              # 이름 → 마지막으로 서재에 있던 시각
_TOLD = {}              # (누가, 무엇) → 알린 시각
_MARK = {}              # 진행 기록 표 → 지금까지 본 가장 늦은 시각 (처음에는 기준만 잡는다)
_PLEX = {"keys": None}  # 지난번에 재생 중이던 (사람, 작품)
_YMP = {"keys": None}
_STATE = {"started": False, "error": {}, "last": 0.0}
# (표가 있는 DB, 진행 표, 시각 열, 작품 표, 잇는 열, 제목 식, 말)
SOURCES = (
    ("general", "user_progress", "last_read_at", "books", "book_id", "COALESCE(NULLIF(b.series_name, ''), b.title)", "읽고 있어요"),
    ("audiobook", "audiobook_progress", "last_listened_at", "audiobooks", "audiobook_id", "b.title", "듣고 있어요"),
    ("video", "video_progress", "last_watched_at", "videos", "video_id", "b.title", "보고 있어요"),
)


def kinds():
    return {x.strip() for x in config.env("LIB3D_ACTIVITY", "join,read,watch").split(",") if x.strip()}


def _tell(who, what, text, floor="", gap=REPEAT_GAP, now=None):
    """같은 사람·같은 것을 gap 안에 다시 말하지 않는다. 말했으면 True"""
    now = now or time.time()
    skip = [w.strip().lower() for w in config.env("LIB3D_ACTIVITY_SKIP", "").split(",") if w.strip()]
    if any(w in text.lower() for w in skip):
        return False
    key = (str(who), str(what))
    with _LOCK:
        if now - _TOLD.get(key, 0) < gap:
            return False
        _TOLD[key] = now
        for k in [k for k, t in _TOLD.items() if now - t > 86400]:
            _TOLD.pop(k, None)
    lib3d_presence.post(WHO, text, floor, src="activity")
    return True


# ── 3D 서재 접속 ──
def on_presence(name, floor, now=None):
    """lib3d_presence가 위치 소식을 받을 때마다 부른다: 한동안 없던 사람이면 들어왔다고 알린다"""
    now = now or time.time()
    name = str(name or "").strip()
    if not name:
        return False
    with _LOCK:
        last = _SEEN.get(name, 0)
        _SEEN[name] = now
        if len(_SEEN) > 500:
            for k in sorted(_SEEN, key=_SEEN.get)[:100]:
                _SEEN.pop(k, None)
    if now - last < JOIN_GAP or "join" not in kinds() or str(floor or "") == "adult":
        return False
    return _tell(name, "join", "%s님이 3D 서재에 들어왔어요." % name, "", gap=JOIN_GAP, now=now)


# ── BookOasis: 읽기·듣기·보기 ──
def _users():
    """BookOasis 사용자 번호 → 이름 (users 표는 일반 DB에. 못 읽으면 빈 것)"""
    for db_type in ("general", "audiobook", "video"):
        try:
            rows = bookoasis_db.gateway(db_type).fetch_all("SELECT id, username FROM users")
            if rows:
                return {int(r["id"]): str(r["username"]) for r in rows}
        except Exception:  # noqa: BLE001 - 그 DB가 없거나 표가 없으면 다음 것
            continue
    return {}


def poll_bookoasis(now=None):
    if "read" not in kinds() or not bookoasis_db.configured():
        return 0
    types = {t.strip() for t in config.env("BOOKOASIS_DB_TYPES", "general,adult,audiobook,video").split(",")}
    users, told = None, 0
    for db_type, table, col, items, fk, title, verb in SOURCES:
        if db_type not in types:
            continue
        try:
            gw = bookoasis_db.gateway(db_type)
            mark = _MARK.get(table)
            if mark is None:   # 처음: 기준만 (지난 기록은 알리지 않는다)
                row = gw.fetch_one("SELECT MAX(%s) AS m FROM %s" % (col, table))
                _MARK[table] = str((row or {}).get("m") or "")
                continue
            rows = gw.fetch_all("SELECT p.user_id AS user_id, p.%s AS at, %s AS title FROM %s p JOIN %s b ON b.id = p.%s WHERE p.%s > ? ORDER BY p.%s LIMIT 30"
                                % (col, title, table, items, fk, col, col), (mark,))
            _STATE["error"].pop(table, None)
        except Exception as e:  # noqa: BLE001 - DB가 잠깐 안 돼도 다음에 다시
            if _STATE["error"].get(table) != str(e):
                log.info("서재 소식: %s 확인 실패: %s", table, e)
            _STATE["error"][table] = str(e)
            continue
        for r in rows:
            _MARK[table] = max(_MARK[table], str(r.get("at") or ""))
            if users is None:
                users = _users()
            name = users.get(int(r.get("user_id") or 0))
            what = " ".join(str(r.get("title") or "").split())[:60]
            if name and what and _tell(name, "bo:" + what, "%s님이 「%s」%s %s" % (name, what, _josa(what), verb), now=now):
                told += 1
    return told


def _josa(word):
    """을/를 (받침에 따라)"""
    ch = word[-1:] if word else ""
    if "가" <= ch <= "힣":
        return "을" if (ord(ch) - 0xAC00) % 28 else "를"
    return "을(를)"


# ── Plex: 지금 재생 ──
def _get_json(url, headers=None, data=None, timeout=8):
    req = urllib.request.Request(url, headers=dict({"Accept": "application/json", "User-Agent": "bookoasis_3d"}, **(headers or {})),
                                 data=json.dumps(data).encode("utf-8") if data is not None else None)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(2 * 1024 * 1024).decode("utf-8", "replace") or "{}")


def plex_sessions():
    """[(사람, 작품, 종류)] - 재생 중인 것만, 성인 등급 제외"""
    base, token = config.env("LIB3D_PLEX_URL", "").strip().rstrip("/"), config.env("LIB3D_PLEX_TOKEN", "").strip()
    if not base or not token:
        return None
    data = _get_json(base + "/status/sessions", {"X-Plex-Token": token})
    out = []
    for m in (data.get("MediaContainer") or {}).get("Metadata") or []:
        if str((m.get("Player") or {}).get("state") or "playing") != "playing":
            continue
        if str(m.get("contentRating") or "").strip().lower() in ADULT_RATINGS:
            continue
        who = str((m.get("User") or {}).get("title") or "").strip()
        kind = str(m.get("type") or "")
        what = str(m.get("grandparentTitle") or m.get("title") or "").strip() if kind in ("episode", "track") else str(m.get("title") or "").strip()
        if who and what:
            out.append((who, what[:60], kind))
    return out


def _poll_playing(store, label, fetch, now=None):
    """새로 재생을 시작한 것만 알린다 (처음에는 기준만)"""
    try:
        cur = fetch()
        _STATE["error"].pop(label, None)
    except Exception as e:  # noqa: BLE001
        if _STATE["error"].get(label) != str(e):
            log.info("서재 소식: %s 확인 실패: %s", label, e)
        _STATE["error"][label] = str(e)
        return 0
    if cur is None:
        return 0
    keys = {(w, t) for w, t, _k in cur}
    prev, store["keys"] = store["keys"], keys
    if prev is None:
        return 0
    told = 0
    for who, what, kind in cur:
        if (who, what) in prev:
            continue
        verb = "듣고 있어요" if kind in ("track", "audio", "radio", "podcast") else "보고 있어요"
        if _tell(who, label + ":" + what, "%s님이 %s에서 「%s」%s %s" % (who, label, what, _josa(what), verb), now=now):
            told += 1
    return told


# ── YMPlayer: MCP 도구 now_watching ──
def ymp_sessions():
    token = config.env("LIB3D_YMPLAYER_MCP_TOKEN", "").strip()
    base = (config.env("LIB3D_YMPLAYER_INTERNAL", "") or config.env("LIB3D_YMPLAYER_URL", "")).strip().rstrip("/")
    if not token or not base:
        return None
    res = _get_json(base + "/mcp", {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                    {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "now_watching", "arguments": {}}})
    if res.get("error"):
        raise RuntimeError(str(res["error"].get("message") or res["error"])[:200])
    result = res.get("result") or {}
    data = result.get("structuredContent")
    if data is None:
        text = next((c.get("text") for c in result.get("content") or [] if c.get("type") == "text"), "") or "{}"
        if result.get("isError"):
            raise RuntimeError(text[:200])
        data = json.loads(text)
    out = []
    for s in (data or {}).get("sessions") or []:
        who, what = str(s.get("user") or "").strip(), str(s.get("title") or "").strip()
        if who and what and not s.get("adult"):
            out.append((who, what[:60], str(s.get("kind") or "video")))
    return out


def poll_once(now=None):
    n = poll_bookoasis(now)
    if "watch" in kinds():
        n += _poll_playing(_PLEX, "Plex", plex_sessions, now)
        n += _poll_playing(_YMP, "YMPlayer", ymp_sessions, now)
    _STATE["last"] = time.time()
    return n


def _loop():
    time.sleep(25)
    while True:
        try:
            if kinds() & {"read", "watch"}:
                poll_once()
        except Exception:  # noqa: BLE001
            log.exception("서재 소식")
        time.sleep(POLL_SEC)


def status():
    return {"kinds": sorted(kinds()), "plex": bool(config.env("LIB3D_PLEX_URL", "").strip() and config.env("LIB3D_PLEX_TOKEN", "").strip()),
            "ymp": bool(config.env("LIB3D_YMPLAYER_MCP_TOKEN", "").strip()), "bookoasis": bookoasis_db.configured(),
            "error": dict(_STATE["error"]), "last": _STATE["last"]}


def start():
    if _STATE["started"]:
        return
    _STATE["started"] = True
    threading.Thread(target=_loop, name="lib3d-activity", daemon=True).start()
