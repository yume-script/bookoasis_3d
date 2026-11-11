"""BookOasis 3D 서재 - 길 건너 건물 1층 '픽시브 랭킹 전시관'

픽시브(pixiv.net) 랭킹의 그림을 전시관 벽 액자에 건다. 기본은 꺼짐 - 관리자가 [설정 > 창밖 풍경 > 픽시브]에서 켠다.
  - 랭킹: https://www.pixiv.net/ranking.php?mode=…&content=…&format=json (로그인 쿠키 PHPSESSID가 있어야 한다)
  - 그림: 저장하지 않는다. 브라우저가 직접 받으면 픽시브가 막으므로(Referer) 서버가 그때그때 이어 준다 (i.pximg.net만, 잠깐 기억)
  - 성인(R-18) 랭킹은 고를 수 없고, 'R-18' 꼬리표가 붙은 작품은 늘 뺀다. '수위 있는 그림 빼기'(기본 켜짐)는 픽시브가 표시한 것까지 뺀다
  - 누구에게 보일지는 관리자가 정한다: 관리자만(기본) / 관람자에게도
설정은 DATA_DIR/lib3d.json의 pixiv, 로그인 쿠키만 .env의 LIB3D_PIXIV_PHPSESSID (화면에 돌려주지 않는다).
yume-script/pixiv_ranking 플러그인(BookOasis용)이 하던 일을 3D 서재에 맞게 새로 썼다 (SJVA 회원인증은 쓰지 않는다).
"""
import collections
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import urllib.request

from . import config, lib3d

log = logging.getLogger("boa3d.pixiv")
MODES = collections.OrderedDict([("daily", "일간"), ("weekly", "주간"), ("monthly", "월간"), ("rookie", "신인"), ("original", "오리지널"),
                                 ("daily_ai", "AI 생성"), ("male", "남성 인기"), ("female", "여성 인기")])
CONTENTS = collections.OrderedDict([("all", "종합"), ("illust", "일러스트"), ("manga", "만화"), ("ugoira", "움직이는 그림")])
CONTENT_MODES = {"all": set(MODES), "illust": {"daily", "weekly", "monthly", "rookie", "daily_ai"},
                 "manga": {"daily", "weekly", "monthly", "rookie", "daily_ai"}, "ugoira": {"daily", "weekly", "daily_ai"}}
DEFAULT = {"enabled": False, "building": "STUDIO", "mode": "daily", "content": "illust", "limit": 24, "viewers": False, "safe": True}
LIMIT_MAX = 40
LIST_TTL = 1800
IMG_KEEP = 80
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
REFERER = "https://www.pixiv.net/"
_IMG_RE = re.compile(r"^https://i\.pximg\.net/[\w\-./%]+\.(?:jpg|jpeg|png|gif|webp)$", re.I)
_LOCK = threading.Lock()
_LIST = {}                               # (mode, content, safe) → (시각, 목록)
_IMG = collections.OrderedDict()         # 주소 → (바이트, 종류)
_STATE = {"error": "", "at": 0.0}


def cookie():
    return config.env("LIB3D_PIXIV_PHPSESSID", "").strip()


def settings():
    st = dict(DEFAULT)
    saved = lib3d.load_settings().get("pixiv") or {}
    for k, v in DEFAULT.items():
        if k in saved and isinstance(saved[k], type(v)):
            st[k] = saved[k]
    if st["mode"] not in CONTENT_MODES.get(st["content"], ()):
        st["mode"] = "daily"
    st["limit"] = max(4, min(LIMIT_MAX, int(st["limit"])))
    return st


def save(body):
    """{enabled, building, mode, content, limit, viewers, safe, phpsessid?} - 쿠키는 적었을 때만 바꾸고, clear_cookie면 지운다"""
    cur = settings()
    for k in ("enabled", "viewers", "safe"):
        if k in body:
            cur[k] = bool(body[k])
    if "building" in body:
        cur["building"] = re.sub(r"[\x00-\x1f<>]", "", " ".join(str(body["building"] or "").split()))[:24]
    if "content" in body:
        if body["content"] not in CONTENTS:
            raise ValueError("그림 종류를 다시 골라 주세요.")
        cur["content"] = body["content"]
    if "mode" in body:
        if body["mode"] not in MODES:
            raise ValueError("랭킹 종류를 다시 골라 주세요.")
        cur["mode"] = body["mode"]
    if cur["mode"] not in CONTENT_MODES[cur["content"]]:
        raise ValueError("'%s'에는 '%s' 랭킹이 없습니다." % (CONTENTS[cur["content"]], MODES[cur["mode"]]))
    if "limit" in body:
        try:
            cur["limit"] = max(4, min(LIMIT_MAX, int(body["limit"])))
        except (TypeError, ValueError):
            raise ValueError("그림 수는 숫자로 적어 주세요.")
    street = lib3d.street()
    if cur["enabled"] and cur["building"] in [street[k] for k in ("gallery", "jazz", "office") if street[k]]:
        raise ValueError("'%s' 건물은 이미 다른 공간(갤러리·청음실·사무실)이 쓰고 있습니다." % cur["building"])
    value = " ".join(str(body.get("phpsessid") or "").split())
    if value:
        if not re.fullmatch(r"[\w\-]{8,200}", value):
            raise ValueError("PHPSESSID 형식이 아닙니다 (픽시브에 로그인한 브라우저의 쿠키 값).")
        config.save_env({"LIB3D_PIXIV_PHPSESSID": value})
        os.environ["LIB3D_PIXIV_PHPSESSID"] = value
    elif body.get("clear_cookie"):
        config.save_env({"LIB3D_PIXIV_PHPSESSID": ""})
        os.environ["LIB3D_PIXIV_PHPSESSID"] = ""
    lib3d.save_setting("pixiv", cur)
    with _LOCK:
        _LIST.clear()
    return public(True)


def public(admin):
    """화면에 줄 설정 (쿠키 값은 주지 않는다). 볼 수 없는 사람에게는 꺼진 것으로"""
    st = settings()
    show = st["enabled"] and (admin or st["viewers"])
    out = {"enabled": bool(show), "building": st["building"], "mode": st["mode"], "content": st["content"],
           "label": "%s · %s" % (MODES[st["mode"]], CONTENTS[st["content"]]), "limit": st["limit"]}
    if admin:
        out.update(on=st["enabled"], viewers=st["viewers"], safe=st["safe"], cookie_set=bool(cookie()), error=_STATE["error"],
                   modes=list(MODES.items()), contents=list(CONTENTS.items()),
                   content_modes={k: sorted(v) for k, v in CONTENT_MODES.items()})
    return out


def allowed(admin):
    st = settings()
    return st["enabled"] and (admin or st["viewers"])


def _fetch(url, timeout=12, limit=3 * 1024 * 1024):
    headers = {"User-Agent": UA, "Referer": REFERER, "Accept-Language": "ko,en;q=0.8"}
    if cookie() and urllib.parse.urlsplit(url).hostname == "www.pixiv.net":
        headers["Cookie"] = "PHPSESSID=" + cookie()
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
        return r.read(limit + 1)[:limit], r.headers.get("Content-Type", "")


def _items(data, safe):
    out = []
    for c in data.get("contents") or []:
        thumb = str(c.get("url") or "")
        tags = [str(t) for t in c.get("tags") or []]
        kind = c.get("illust_content_type") or {}
        if not _IMG_RE.match(thumb) or any(t.upper().replace("－", "-").startswith("R-18") for t in tags):
            continue
        if safe and (int(kind.get("sexual") or 0) > 0 or kind.get("grotesque") or kind.get("violent")):
            continue
        out.append({"id": str(c.get("illust_id") or ""), "rank": int(c.get("rank") or len(out) + 1), "title": " ".join(str(c.get("title") or "").split())[:60],
                    "author": " ".join(str(c.get("user_name") or "").split())[:40], "thumb": thumb,
                    "w": int(c.get("width") or 0), "h": int(c.get("height") or 0),
                    "url": "https://www.pixiv.net/artworks/%s" % c.get("illust_id")})
    return out


def ranking():
    """지금 설정의 랭킹 목록 (30분 보관). 못 받으면 ValueError(사람이 읽을 말)"""
    st = settings()
    key = (st["mode"], st["content"], st["safe"])
    with _LOCK:
        hit = _LIST.get(key)
    if hit and time.time() - hit[0] < LIST_TTL:
        return hit[1][:st["limit"]]
    if not cookie():
        raise ValueError("픽시브 로그인 쿠키(PHPSESSID)를 설정에 넣어 주세요.")
    url = "https://www.pixiv.net/ranking.php?" + urllib.parse.urlencode(
        dict({"mode": st["mode"], "p": 1, "format": "json"}, **({} if st["content"] == "all" else {"content": st["content"]})))
    try:
        raw, _ctype = _fetch(url)
        data = json.loads(raw.decode("utf-8", "replace"))
    except ValueError:
        _STATE.update(error="픽시브가 랭킹 대신 다른 화면을 보냈습니다 - 로그인 쿠키(PHPSESSID)가 만료됐을 수 있습니다.", at=time.time())
        raise ValueError(_STATE["error"])
    except Exception as e:  # noqa: BLE001
        _STATE.update(error="픽시브 랭킹을 받지 못했습니다: %s" % str(e)[:120], at=time.time())
        raise ValueError(_STATE["error"])
    items = _items(data if isinstance(data, dict) else {}, st["safe"])
    if not items:
        _STATE.update(error=str((data or {}).get("error") or "랭킹에 보여 줄 그림이 없습니다 (쿠키 만료 또는 모두 걸러짐)")[:160], at=time.time())
        raise ValueError(_STATE["error"])
    _STATE.update(error="", at=time.time())
    with _LOCK:
        _LIST[key] = (time.time(), items)
    return items[:st["limit"]]


def image(url):
    """랭킹에 나온 그림 하나 (바이트, 종류). 픽시브 그림 서버 주소만"""
    url = str(url or "")
    if not _IMG_RE.match(url):
        raise ValueError("픽시브 그림 주소가 아닙니다.")
    with _LOCK:
        hit = _IMG.get(url)
        if hit:
            _IMG.move_to_end(url)
            return hit
    raw, ctype = _fetch(url, timeout=15)
    out = (raw, ctype if ctype.startswith("image/") else "image/jpeg")
    with _LOCK:
        _IMG[url] = out
        while len(_IMG) > IMG_KEEP:
            _IMG.popitem(last=False)
    return out
