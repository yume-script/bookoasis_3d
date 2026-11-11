# -*- coding: utf-8 -*-
"""BookOasis 3D 서재 웹 서버 (표준 라이브러리만)

  GET  /                  → /library3d
  GET  /library3d         3D 서재 화면 (web/lib3d/index.html, app.js)
  GET  /login             로그인 화면 (사용자가 없으면 '관리자 계정 만들기')
  GET  /api/lib3d/…       서재 데이터·표지·책 읽기·AI·브런치·재즈·영화관 중계 (boa3d/lib3d*.py)
  POST /api/lib3d/…       함께 보기·채팅·설정·AI 직원
  POST /api/lib3d/events  바깥 프로그램이 배달·직원의 말 알리기 (Authorization: Bearer LIB3D_EVENT_TOKEN)
  GET  /api/lib3d/arcade  오락실 게임 하나 (mini/), /games/covers/… 그림 땅따먹기 표지
  GET  /api/auth/state    POST /api/auth/login · setup · logout · password
  GET  /api/users         POST /api/users (추가) · /api/users/role · /api/users/password · /api/users/delete
  POST /api/ui-prefs      기본 테마·강조색 (관리자)
  GET  /healthz           상태 확인 (인증 없음)

인증: 서명한 세션 쿠키 (boa3d/auth.py). 관리자(admin)는 모든 설정, 관람자(viewer)는 둘러보기·읽기·함께 보기만.
POST는 Content-Type: application/json만 받는다 → 다른 사이트의 폼 전송(CSRF)으로는 호출할 수 없다.
"""
import json
import logging
import mimetypes
import os
import re
import time
import zipfile
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import auth, config, lib3d, lib3d_agents, lib3d_ai, lib3d_brunch, lib3d_discord, lib3d_events, lib3d_jazz, lib3d_presence, lib3d_ymp

log = logging.getLogger("boa3d.web")
WEB_DIR = os.path.join(config.ROOT, "web")
STATIC = {"/theme.css": "theme.css", "/shell.js": "shell.js", "/login": "login.html", "/login.js": "login.js",
          "/library3d": "lib3d/index.html", "/library3d/app.js": "lib3d/app.js"}
PUBLIC = {"/login", "/login.js", "/theme.css", "/shell.js", "/healthz", "/api/auth/state", "/api/auth/login", "/api/auth/setup"}
PAGES = {"/", "/library3d"}   # 로그인 안 했으면 로그인 화면으로 보낼 주소
MAX_BODY = 2 * 1024 * 1024
ADMIN_ONLY_GET = {"/api/lib3d/libraries", "/api/lib3d/ai/settings", "/api/lib3d/ai/test", "/api/lib3d/agents", "/api/users"}
VIEWER_POST = {"/api/auth/logout", "/api/auth/password", "/api/lib3d/presence", "/api/lib3d/say", "/api/lib3d/brunch/tts", "/api/lib3d/leave"}
POSTS = {"/api/ui-prefs", "/api/lib3d/settings", "/api/lib3d/ai/settings", "/api/lib3d/ai/ask", "/api/lib3d/presence", "/api/lib3d/say",
         "/api/lib3d/agents", "/api/lib3d/brunch/tts", "/api/lib3d/leave"}
THEMES = ("dark", "light", "black", "navy", "auto")
ACCENTS = ("amber", "blue", "green", "purple", "red", "pink", "teal")


def version():
    return lib3d.VERSION


def _ui_prefs_path():
    return os.path.join(config.data_dir(), "ui_prefs.json")


def ui_prefs():
    """화면 기본 테마 (브라우저마다 따로 고른 테마가 있으면 그게 우선)"""
    try:
        with open(_ui_prefs_path(), encoding="utf-8") as f:
            data = json.load(f) or {}
    except (OSError, ValueError):
        data = {}
    return {"theme": data.get("theme") if data.get("theme") in THEMES else "dark",
            "accent": data.get("accent") if data.get("accent") in ACCENTS else "amber", "nav": {"groups": [], "items": {}}}


# ── 새 버전 확인 (왼쪽 위 아이콘의 업데이트 표시): GitHub의 VERSION을 6시간마다. UPDATE_CHECK_URL= 로 끔 ──
DEFAULT_UPDATE_URL = "https://raw.githubusercontent.com/yume-script/bookoasis_3d/main/VERSION"
UPDATE_CHECK_SEC = 6 * 3600
_update = {"latest": "", "checked_at": 0.0, "error": "", "running": False}


def _version_tuple(v):
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r"[.\-+]", str(v or "")) if x != "")


def _fetch_latest():
    import threading
    from urllib.request import Request, urlopen

    url = config.env("UPDATE_CHECK_URL", DEFAULT_UPDATE_URL)

    def run():
        try:
            req = Request(url, headers={"User-Agent": "bookoasis_3d", "Cache-Control": "no-cache"})
            with urlopen(req, timeout=10) as r:
                _update["latest"] = str(json.loads(r.read().decode("utf-8")).get("version") or "")
                _update["error"] = ""
        except Exception as e:  # noqa: BLE001 - 네트워크가 막혀 있어도 화면은 그대로
            _update["error"] = str(e)[:200]
        finally:
            _update["checked_at"] = time.time()
            _update["running"] = False

    if not url or _update["running"]:
        return
    _update["running"] = True
    threading.Thread(target=run, name="boa3d_update_check", daemon=True).start()


def update_info():
    if time.time() - _update["checked_at"] > UPDATE_CHECK_SEC:
        _fetch_latest()
    latest = _update["latest"]
    return {"current": version(), "latest": latest, "checked_at": _update["checked_at"], "error": _update["error"],
            "available": bool(latest and _version_tuple(latest) > _version_tuple(version()))}


def modules():
    """화면 틀(shell.js)이 보는 모듈: 3D 서재는 늘 켜짐, 오락실(미니게임)은 MINI_ENABLED"""
    return {"lib3d": True, "mini": config.env_bool("MINI_ENABLED", True)}


def arcade_menu(mods):
    """오락실 게임 목록 [{id, name, icon}] (미니게임이 꺼져 있으면 빈 목록)"""
    if not mods.get("mini"):
        return []
    try:
        from mini import bundle
        return bundle.menu()
    except Exception:  # noqa: BLE001
        log.exception("오락실 게임 목록")
        return []


class Handler(BaseHTTPRequestHandler):
    server_version = "bookoasis_3d"

    def log_message(self, fmt, *args):  # 접근 로그는 디버그로만 (화면이 15초마다 상태를 묻는다)
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if "X-Frame-Options" not in (extra or {}):
            self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):  # 브라우저가 응답 전에 닫음(새로고침·탭 닫기) - 무시
                self.close_connection = True

    def _user(self):
        """로그인한 사용자 (세션 쿠키), 아니면 None"""
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:
            return None
        morsel = cookie.get(auth.COOKIE)
        return auth.user_from_token(morsel.value) if morsel else None

    def _deny(self, path):
        if path in PAGES and self.command in ("GET", "HEAD"):
            page = path.strip("/").split("/")[0].replace("index.html", "")
            return self._send(302, b"", extra={"Location": "login" + ("#" + page if page else "")})  # 로그인 뒤 이 화면으로
        self._send(401, {"success": False, "error": "로그인이 필요합니다.", "login": True})

    def _session_cookie(self, user, remember):
        """Set-Cookie 값. https 뒤(리버스 프록시)면 Secure도 붙인다."""
        parts = [f"{auth.COOKIE}={auth.make_token(user, remember)}", "Path=/", "HttpOnly", "SameSite=Lax"]
        if remember:
            parts.append(f"Max-Age={auth.REMEMBER_SEC}")
        if (self.headers.get("X-Forwarded-Proto") or "").lower() == "https":
            parts.append("Secure")
        return "; ".join(parts)

    def do_HEAD(self):
        self.do_GET()

    def _pres_ident(self, user, context):
        """함께 보기에서의 나: (창마다 다른 key, 보일 이름). 관람자(손님 계정)는 들어올 때 적은 이름을 쓴다.
        다른 계정 이름과 같으면 '(손님)'을 붙여 흉내를 막는다."""
        viewer = not auth.is_admin(user)
        key, name = lib3d_presence.ident(user["username"], context, viewer)
        if viewer and name != user["username"] and auth.find_user(name):
            name = "%s (손님)" % name
        return key, name

    def _jazz(self, rest):
        from urllib.parse import parse_qs
        q = {k: v[0] for k, v in parse_qs(self.path.partition("?")[2]).items() if v}
        try:
            if rest == "stations":
                return self._send(200, {"success": True, "stations": lib3d_jazz.stations()})
            if rest == "now":
                return self._send(200, dict(lib3d_jazz.now_playing(q.get("s") or ""), success=True))
            if rest == "art":
                raw, ctype = lib3d_jazz.art_bytes(q.get("u"))
                return self._send(200, raw, ctype, extra={"Cache-Control": "private, max-age=86400"})
            if rest == "stream":   # 방송을 끊김 없이 이어 준다 (듣는 사람이 끊을 때까지)
                r = lib3d_jazz.open_stream(q.get("s") or "")
                self.send_response(200)
                self.send_header("Content-Type", r.headers.get("Content-Type") or "audio/mpeg")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                try:
                    while True:
                        chunk = r.read(16 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, TimeoutError):
                    pass
                finally:
                    r.close()
                return None
        except ValueError as e:
            return self._send(400, {"success": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001 - 방송국 쪽 오류
            return self._send(502, {"success": False, "error": "방송에 연결하지 못했습니다: %s" % e})
        return self._send(404, {"success": False, "error": "없는 주소입니다."})

    def _ym(self, rest, user, post=False):
        """YMPlayer 중계 (gdw/lib3d_ymp.py) - 허용한 주소만, 스트림은 조각으로 그대로 흘려 보낸다"""
        if not lib3d_ymp.configured():
            return self._send(404, {"success": False, "error": "YMPlayer 중계 설정이 없습니다 (LIB3D_YMPLAYER_USER·PASSWORD)."})
        if user and not auth.is_admin(user) and not lib3d_ymp.viewers_ok():
            return self._send(403, {"success": False, "error": "관람자 계정은 영화관을 볼 수 없습니다."})
        try:
            if rest == "sources" and not post:
                return self._send(200, {"success": True, "sources": lib3d_ymp.sources(), "newtab": lib3d.ymplayer_url()})
            if not lib3d_ymp.allowed(rest, post):
                return self._send(404, {"success": False, "error": "중계하지 않는 주소입니다."})
            query = self.path.partition("?")[2]
            fwd = {k: self.headers[k] for k in ("Range", "Accept") if self.headers.get(k)}
            if post:
                fwd["Content-Type"] = "application/json"
            r = lib3d_ymp.open_upstream(rest, query, fwd, b"{}" if post else None)
        except RuntimeError as e:
            return self._send(502, {"success": False, "error": str(e)})
        status = getattr(r, "status", None) or getattr(r, "code", 502)
        ctype = r.headers.get("Content-Type") or "application/octet-stream"
        try:
            if post or "json" in ctype or "mpegurl" in ctype.lower() or rest.endswith(".m3u8"):
                raw = r.read(16 * 1024 * 1024)
                if "mpegurl" in ctype.lower() or rest.endswith(".m3u8"):
                    raw = lib3d_ymp.rewrite_playlist(raw.decode("utf-8", "replace")).encode("utf-8")
                elif post:
                    raw = lib3d_ymp.rewrite_playlist(raw.decode("utf-8", "replace")).encode("utf-8")
                return self._send(status, raw, ctype)
            self.send_response(status)
            for k in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
                if r.headers.get(k):
                    self.send_header(k, r.headers[k])
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            while True:
                chunk = r.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):   # 재생기가 건너뛰거나 채널을 바꾸면 흔히 끊는다
            pass
        finally:
            try:
                r.close()
            except Exception:  # noqa: BLE001
                pass
        return None

    def _send_range(self, full, ctype):
        """큰 파일을 조각으로 (HTTP Range: 오디오·영상 재생기가 건너뛸 때 그 자리부터)"""
        import re as _re
        size = os.path.getsize(full)
        start, end, code = 0, size - 1, 200
        m = _re.match(r"bytes=(\d*)-(\d*)$", (self.headers.get("Range") or "").strip())
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", "bytes */%d" % size)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if code == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        left = end - start + 1
        try:
            with open(full, "rb") as f:
                f.seek(start)
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):   # 재생기가 건너뛰며 연결을 끊는 건 흔한 일
            pass
        return None

    def _brunch_get(self, path, q):
        if not lib3d_brunch.enabled():
            return self._send(404, {"success": False, "error": "브런치 낭독 코너가 꺼져 있습니다 (LIB3D_BRUNCH)."})
        try:
            if path == "/api/lib3d/brunch/today":
                return self._send(200, dict(lib3d_brunch.fetch_today(), success=True))
            if path == "/api/lib3d/brunch/list":
                return self._send(200, dict(lib3d_brunch.list_day(q.get("day") or lib3d_brunch.today_key(), q.get("sort") or "",
                                                                  q.get("next") or None), today=lib3d_brunch.today_key(), success=True))
            if path == "/api/lib3d/brunch/article":
                return self._send(200, dict(lib3d_brunch.fetch_article(q.get("u"), q.get("n")), success=True))
            if path == "/api/lib3d/brunch/voices":
                return self._send(200, dict(lib3d_brunch.tts_voices(), success=True))
        except ValueError as e:
            return self._send(400, {"success": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001 - 브런치 쪽 오류는 화면에 그대로
            return self._send(502, {"success": False, "error": "브런치에서 가져오지 못했습니다: %s" % e})
        return self._send(404, {"success": False, "error": "없는 주소입니다."})

    def _lib3d(self, path, mods, user=None):
        """BookOasis 3D 서재: 보관함·작품 목록, 표지, 책 열기 주소"""
        from urllib.parse import parse_qs
        if path.startswith("/api/lib3d/jazz/"):   # 재즈 청음실 (인터넷 재즈 라디오 중계)
            return self._jazz(path[len("/api/lib3d/jazz/"):])
        if path == "/api/lib3d/arcade":   # 오락실: 게임 하나만 띄우는 화면 (3D 서재 안 창에 넣음, #게임id)
            if not mods["mini"]:
                return self._send(404, {"success": False, "error": "미니게임이 꺼져 있습니다 (MINI_ENABLED)."})
            from mini import bundle
            return self._send(200, bundle.arcade_page().encode("utf-8"), "text/html; charset=utf-8", extra={"X-Frame-Options": "SAMEORIGIN"})
        if path.startswith("/api/lib3d/ym/"):   # 영화관 층: YMPlayer IPTV·텔레그램 중계
            return self._ym(path[len("/api/lib3d/ym/"):], user)
        q = parse_qs(self.path.partition("?")[2])
        key = (q.get("k") or [""])[0]
        adult = auth.adult_ok(user)
        if not adult and any(str(v).startswith("adult:") for v in (key, (q.get("b") or [""])[0])):
            return self._send(403, {"success": False, "error": "성인 서재는 볼 수 없는 계정입니다."})
        try:
            if path == "/api/lib3d/libraries":   # 설정 화면: 보관함 전부 + 보이는지
                return self._send(200, dict(lib3d.all_libraries(), success=True))
            if path == "/api/lib3d/data":
                d = lib3d.data(force=bool(q.get("refresh")) and auth.is_admin(user))
                if not adult:   # 성인 층을 볼 수 없는 관람자에게는 빼고
                    d = dict(d, libraries=[x for x in d.get("libraries", []) if x.get("db_type") != "adult"])
                ai = lib3d_ai.flags()
                me = {"username": user["username"], "role": auth.role_of(user), "adult": adult} if user else None
                staff_on = lib3d_ai.configured() and bool(lib3d_agents.agents())   # 직원이든 손님이든 하나라도 있으면
                return self._send(200, dict(d, ai=ai, me=me, staff_on=staff_on, brunch_on=lib3d_brunch.enabled(),
                                            people=lib3d.load_settings().get("people") or {},
                                            outside=lib3d.load_settings().get("outside") or {},
                                            models=lib3d.load_settings().get("models") or "basic",
                                            banner=lib3d.banner_info(), street=lib3d.street(), ymplayer=lib3d.ymplayer_url(), ymproxy=lib3d_ymp.configured(), arcade=arcade_menu(mods), ymplayer_embed=lib3d.ymplayer_embed(), success=True))
            if path.startswith("/api/lib3d/brunch/"):   # 1층 브런치 연재 낭독 코너 (브런치 공개 글이라 관람자도)
                return self._brunch_get(path, {k: v[0] for k, v in q.items() if v})
            if path == "/api/lib3d/banner_pick":   # 현수막에 띄울 무작위 작품 (보관함 표지 모드)
                pick = lib3d.banner_pick()
                if not adult and pick.get("db") == "adult":
                    return self._send(404, {"success": False, "error": "현수막 보관함을 볼 수 없는 계정입니다."})
                return self._send(200, dict(pick, success=True))
            if path == "/api/lib3d/banner":   # 현수막 건물 그림 (서버가 받아 둔 것)
                raw, ctype = lib3d.banner_image(force=bool(q.get("force")))
                return self._send(200, raw, ctype, extra={"Cache-Control": "private, max-age=600"})
            # AI: 손님 대화 / 설정 / BookOasis MCP 연결 시험
            if path == "/api/lib3d/ai/settings":
                return self._send(200, dict(lib3d_ai.settings(), success=True))
            if path == "/api/lib3d/weather":   # 창밖 풍경 '자동' 날씨: 기준 도시의 지금 날씨
                return self._send(200, dict(lib3d_ai.city_weather(), success=True))
            if path == "/api/lib3d/agents":   # AI 직원 설정·활동 기록 (관리자)
                return self._send(200, dict(lib3d_agents.admin_info(), success=True))
            if path == "/api/lib3d/ai/chat":
                libs = [x for x in (q.get("libs") or [""])[0].split(",") if x]
                return self._send(200, dict(lib3d_ai.chat(libs), success=True))
            if path == "/api/lib3d/ai/test":
                return self._send(200, dict(lib3d_ai.test_mcp(), success=True))
            if path == "/api/lib3d/cover":
                raw, ctype = lib3d.cover(key)
                if raw is None:
                    return self._send(404, {"success": False, "error": ctype}, extra={"Cache-Control": "max-age=600"})
                return self._send(200, raw, ctype, extra={"Cache-Control": "max-age=86400"})
            if path == "/api/lib3d/open":
                url, file_path = lib3d.open_url(key)
                return self._send(200, {"success": True, "url": url, "path": file_path})
            # 서재 안에서 읽기 (자체 뷰어)
            b = (q.get("b") or [""])[0]
            if path == "/api/lib3d/volumes":
                return self._send(200, {"success": True, "volumes": lib3d.volumes(key or b)})
            if path == "/api/lib3d/kiosk":   # BookOasis 뷰어로 읽기 (새 탭)
                return self._send(200, {"success": True, "url": lib3d.kiosk_url(b)})
            if path == "/api/lib3d/book":
                return self._send(200, dict(lib3d.book_info(b), success=True))
            if path == "/api/lib3d/page":
                data, ctype = lib3d.page(b, (q.get("i") or ["0"])[0])
                return self._send(200, data, ctype, extra={"Cache-Control": "private, max-age=3600"})
            if path == "/api/lib3d/chapter":
                return self._send(200, {"success": True, "html": lib3d.chapter(b, (q.get("i") or ["0"])[0])})
            if path == "/api/lib3d/res":
                data, ctype = lib3d.resource(b, (q.get("p") or [""])[0])
                return self._send(200, data, ctype, extra={"Cache-Control": "private, max-age=3600"})
            if path == "/api/lib3d/media":   # 오디오북·영상 한 트랙 (Range로 이어 받기·건너뛰기)
                full, ctype = lib3d.media_file(b, (q.get("i") or ["0"])[0])
                return self._send_range(full, ctype)
            if path == "/api/lib3d/pdf":
                with open(lib3d.pdf_path(b), "rb") as handle:
                    return self._send(200, handle.read(), "application/pdf")
        except (ValueError, OSError, zipfile.BadZipFile) as e:
            return self._send(404, {"success": False, "error": str(e)})
        except RuntimeError as e:   # AI 호출·MCP 실패 (안내 문구)
            log.warning("3D 서재 AI: %s", e)
            return self._send(502, {"success": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001
            log.exception("3D 서재 요청 실패")
            return self._send(500, {"success": False, "error": str(e)})
        return self._send(404, {"success": False, "error": "없는 주소입니다."})

    def _events(self):
        """POST /api/lib3d/events - Authorization: Bearer <LIB3D_EVENT_TOKEN>. 바깥 프로그램(디스코드 봇 등)이 3D 서재에 알린다.
          {"type": "delivery", "from": "배달원 이름", "items": [{"title": "제목", "kind": "book|webtoon|video|audio|comic"}], "note": "할 말"}
          {"type": "say", "agent": "boss", "text": "할 말", "place": "office"}   (직원 id, 장소는 넣지 않아도 됨)"""
        if not config.env("LIB3D_EVENT_TOKEN", "").strip():
            return self._send(404, {"success": False, "error": "3D 서재 이벤트 받기가 꺼져 있습니다 (.env의 LIB3D_EVENT_TOKEN)."})
        if not lib3d_events.token_ok(self.headers.get("Authorization")):
            return self._send(401, {"success": False, "error": "토큰이 맞지 않습니다."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            return self._send(413, {"success": False, "error": "요청이 너무 큽니다."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            return self._send(400, {"success": False, "error": "JSON 형식이 아닙니다."})
        if not isinstance(body, dict):
            return self._send(400, {"success": False, "error": "JSON 객체를 보내세요."})
        try:
            kind = body.get("type")
            if kind == "delivery":
                row = lib3d_events.from_api(body)
                if not row:
                    return self._send(409, {"success": False, "error": "배달이 꺼져 있습니다 ([AI 직원] > 배달)."})
                return self._send(200, {"success": True, "id": row["id"]})
            if kind == "say":
                lib3d_agents.remote_act(str(body.get("agent") or ""), " ".join(str(body.get("text") or "").split())[:160], str(body.get("place") or ""))
                return self._send(200, {"success": True})
            return self._send(400, {"success": False, "error": "type은 delivery·say 중 하나입니다."})
        except ValueError as e:
            return self._send(400, {"success": False, "error": str(e)})

    def _auth_post(self, path, body, user):
        """로그인/로그아웃/첫 관리자/비밀번호/사용자 관리 (YMPlayer와 같은 동작)"""
        ok = lambda data=None: self._send(200, dict({"success": True}, **(data or {})))  # noqa: E731
        fail = lambda code, msg: self._send(code, {"success": False, "error": msg})  # noqa: E731
        try:
            if path == "/api/auth/login":
                ip = self.client_address[0] if self.client_address else "?"
                if auth.throttled(ip):
                    return fail(429, "로그인 실패가 너무 많습니다. 10분 뒤에 다시 시도하세요.")
                found = auth.verify_password(body.get("username"), str(body.get("password") or ""))
                if not found:
                    auth.record_failure(ip)
                    time.sleep(0.5)  # 무작위 대입을 느리게
                    return fail(401, "아이디 또는 비밀번호가 틀렸습니다.")
                auth.clear_failures(ip)
                return self._send(200, {"success": True, "user": auth.public_user(found)},
                                  extra={"Set-Cookie": self._session_cookie(found, bool(body.get("remember")))})
            if path == "/api/auth/setup":  # 사용자가 하나도 없을 때만: 첫 관리자 만들기
                if not auth.needs_setup():
                    return fail(403, "이미 관리자 계정이 있습니다.")
                auth.create_user(body.get("username"), str(body.get("password") or ""))
                found = auth.find_user(body.get("username"))
                return self._send(200, {"success": True, "user": auth.public_user(found)},
                                  extra={"Set-Cookie": self._session_cookie(found, bool(body.get("remember")))})
            if path == "/api/auth/logout":
                if user:
                    lib3d_presence.leave(user["username"])
                return self._send(200, {"success": True},
                                  extra={"Set-Cookie": f"{auth.COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"})
            if path == "/api/auth/password":  # 내 비밀번호 바꾸기: 다른 기기의 로그인은 끊기고 이 기기는 새 쿠키
                if not auth.verify_password(user["username"], str(body.get("current") or "")):
                    return fail(400, "지금 비밀번호가 틀렸습니다.")
                changed = auth.set_password(user["username"], str(body.get("new") or ""))
                return self._send(200, {"success": True}, extra={"Set-Cookie": self._session_cookie(changed, True)})
            if path == "/api/users":
                return ok({"user": auth.create_user(body.get("username"), str(body.get("password") or ""),
                                                    role=body.get("role") or "admin", adult=bool(body.get("adult")))})
            if path == "/api/users/role":   # 권한 바꾸기: admin | viewer(3D 서재만), adult(관람자의 성인 층)
                return ok({"user": auth.set_role(body.get("username"), body.get("role"), bool(body.get("adult")), acting=user["username"])})
            if path == "/api/users/password":
                auth.set_password(body.get("username"), str(body.get("password") or ""))
                return ok()
            if path == "/api/users/delete":
                auth.delete_user(body.get("username"), acting=user["username"])
                return ok()
        except auth.AuthError as error:
            return fail(400, str(error))
        return fail(404, "없는 주소입니다.")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            return self._send(200, {"ok": True, "version": version()})
        user = self._user()
        if path == "/api/auth/state":
            return self._send(200, {"success": True, "setup": auth.needs_setup(), "ui": ui_prefs(), "version": version(),
                                    "user": auth.public_user(user) if user else None})
        if path == "/login" and user:
            return self._send(302, b"", extra={"Location": "library3d"})
        if not user and path not in PUBLIC:
            return self._deny(path)
        if user and not auth.is_admin(user) and path in ADMIN_ONLY_GET:
            return self._send(403, {"success": False, "error": "관리자만 볼 수 있습니다."})
        mods = modules()
        if path in ("/", "/index.html", "/library3d/"):
            return self._send(302, b"", extra={"Location": "/library3d"})
        if path == "/api/users":
            return self._send(200, {"success": True, "users": [auth.public_user(u) for u in auth.load_users()]})
        if path == "/api/modules":   # 화면 틀(shell.js): 메뉴·버전·테마·내 계정
            info = dict(mods, version=version(), versions={"lib3d": version()}, ui=ui_prefs(), user=user["username"],
                        role=auth.role_of(user), windows=os.name == "nt", standalone=True)
            if auth.is_admin(user):
                info["update"] = update_info()
            return self._send(200, info)
        if path.startswith("/games/covers/"):   # 오락실의 그림 땅따먹기 표지
            return self._game_cover(path, mods)
        if path.startswith("/api/lib3d/"):
            return self._lib3d(path, mods, user)
        name = STATIC.get(path)
        if not name:
            return self._send(404, {"success": False, "error": "없는 주소입니다."})
        try:
            with open(os.path.join(WEB_DIR, name), "rb") as handle:
                data = handle.read()
        except OSError:
            return self._send(404, {"success": False, "error": "파일이 없습니다."})
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype)

    def _game_cover(self, path, mods):
        if not mods["mini"]:
            return self._send(404, {"success": False, "error": "미니게임이 꺼져 있습니다 (MINI_ENABLED)."})
        from mini import bundle
        if path == "/games/covers/list.json":
            return self._send(200, bundle.list_covers())
        from urllib.parse import unquote
        real = bundle.cover_path(unquote(path[len("/games/covers/"):]))
        if not real:
            return self._send(404, {"success": False, "error": "없는 그림입니다."})
        try:
            with open(real, "rb") as handle:
                data = handle.read()
        except OSError:
            return self._send(404, {"success": False, "error": "그림을 읽을 수 없습니다."})
        return self._send(200, data, mimetypes.guess_type(real)[0] or "application/octet-stream", extra={"Cache-Control": "max-age=3600"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/lib3d/events":
            return self._events()
        user = self._user()
        if not user and path not in PUBLIC:
            return self._deny(path)
        if user and path.startswith("/api/lib3d/ym/"):   # 영화관 중계 (텔레그램 HLS 변환 시작)
            try:
                self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 65536))   # 본문은 쓰지 않지만 읽어 비운다
            except ValueError:
                pass
            return self._ym(path[len("/api/lib3d/ym/"):], user, post=True)
        if user and not auth.is_admin(user) and path not in VIEWER_POST:
            return self._send(403, {"success": False, "error": "관람자 계정은 할 수 없는 일입니다."})
        if not path.startswith(("/api/auth/", "/api/users")) and path not in POSTS:
            return self._send(404, {"success": False, "error": "없는 주소입니다."})
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return self._send(415, {"success": False, "error": "Content-Type은 application/json이어야 합니다."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            return self._send(413, {"success": False, "error": "요청이 너무 큽니다."})
        try:
            context = json.loads(self.rfile.read(length) or b"{}") if length else {}
        except ValueError:
            return self._send(400, {"success": False, "error": "JSON 형식이 아닙니다."})
        if not isinstance(context, dict):
            return self._send(400, {"success": False, "error": "JSON 객체를 보내세요."})
        if path.startswith(("/api/auth/", "/api/users")):
            return self._auth_post(path, context, user)
        if path == "/api/ui-prefs":   # 설정 > 화면: 기본 테마·강조색
            prefs = ui_prefs()
            if context.get("theme") in THEMES:
                prefs["theme"] = context["theme"]
            if context.get("accent") in ACCENTS:
                prefs["accent"] = context["accent"]
            os.makedirs(config.data_dir(), exist_ok=True)
            tmp = _ui_prefs_path() + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"theme": prefs["theme"], "accent": prefs["accent"]}, f)
            config.replace_file(tmp, _ui_prefs_path())
            return self._send(200, {"success": True, "ui": prefs})
        return self._lib3d_post(path, context, user)

    def _lib3d_post(self, path, context, user):
        if path == "/api/lib3d/leave":   # 3D 서재 [나가기]: 함께 보기에서 바로 빠진다 (아무도 없으면 AI 직원도 쉼)
            lib3d_presence.leave(self._pres_ident(user, context)[0])
            return self._send(200, {"success": True})
        if path == "/api/lib3d/brunch/tts":   # 낭독 코너: Edge 음성 한 문장 → mp3
            if not lib3d_brunch.enabled():
                return self._send(404, {"success": False, "error": "브런치 낭독 코너가 꺼져 있습니다 (LIB3D_BRUNCH)."})
            try:
                return self._send(200, lib3d_brunch.tts_audio(context.get("voice"), context.get("text")), "audio/mpeg",
                                  extra={"Cache-Control": "private, max-age=3600"})
            except ValueError as e:
                return self._send(400, {"success": False, "error": str(e)})
            except Exception as e:  # noqa: BLE001 - 음성 서버 오류는 화면에 그대로
                return self._send(502, {"success": False, "error": "음성을 만들지 못했습니다: %s" % e})
        if path in ("/api/lib3d/presence", "/api/lib3d/say"):   # 3D 서재 함께 보기: 내 위치 보내고 다른 사람·채팅 받기 / 말하기
            if not auth.adult_ok(user) and str(context.get("floor") or "") == "adult":
                context["floor"] = ""
            try:
                key, name = self._pres_ident(user, context)
                if path == "/api/lib3d/presence":
                    return self._send(200, dict(lib3d_presence.update(key, context, name),
                                                staff=lib3d_agents.public(str(context.get("floor") or "")), success=True))
                ag, question = lib3d_agents.match_call(context.get("text"))
                if ag:   # 채팅에서 AI 직원 부르기 (@사서·@도슨트…): 문답은 부른 사람에게만, 직원의 말은 그 층 모두에게
                    if not lib3d_ai.flags()["ask"]:
                        return self._send(400, {"success": False, "error": "AI 직원과의 대화가 꺼져 있습니다 - 3D 서재 설정 > AI 설정의 'AI 직원'."})
                    lib3d_agents.talk(ag, key, question, context.get("floor"), auth.is_admin(user), auth.adult_ok(user), display=name)
                    return self._send(200, {"success": True, "ask": True})
                msg = lib3d_presence.say(key, context.get("text"), context.get("floor"), name)
                # 채팅에서 직원 이름을 부르면 (@ 없이도) 그 직원이 모두가 보는 채팅으로 답한다
                lib3d_agents.name_call(context.get("text"), key, name, context.get("floor"), auth.is_admin(user), auth.adult_ok(user))
                return self._send(200, {"success": True, "msg": msg})
            except ValueError as e:
                return self._send(400, {"success": False, "error": str(e)})
        if path == "/api/lib3d/settings":  # 3D 서재 설정: 보여 줄 보관함 ({"libraries": [키…] 또는 null=전부})
            if "banner_lib" in context and "libraries" not in context:   # 현수막: 보관함 표지 무작위 (비우면 끔)
                try:
                    lib3d.save_banner_library(context.get("banner_lib"), context.get("banner_sec"))
                    if context.get("banner_lib"):
                        lib3d.banner_pick()   # 바로 뽑아 보고 안 되면 알린다
                    return self._send(200, {"success": True, "banner": lib3d.banner_info()})
                except ValueError as e:
                    return self._send(400, {"success": False, "error": str(e), "banner": lib3d.banner_info()})
                except Exception as e:  # noqa: BLE001 - DB 접속 실패 등
                    return self._send(400, {"success": False, "error": "보관함을 읽지 못했습니다: %s" % e, "banner": lib3d.banner_info()})
            if "banner" in context and "libraries" not in context:   # 현수막 그림 주소만 저장
                try:
                    url = lib3d.save_banner(context.get("banner"))
                    if url:
                        lib3d.banner_image(force=True)   # 바로 받아 보고 못 받으면 알린다
                    return self._send(200, {"success": True, "banner": lib3d.banner_info()})
                except ValueError as e:
                    return self._send(400, {"success": False, "error": str(e), "banner": lib3d.banner_info()})
            if "street" in context and "libraries" not in context:   # 거리 간판·특별한 건물 이름
                try:
                    return self._send(200, {"success": True, "street": lib3d.save_street(context["street"] if isinstance(context["street"], dict) else {})})
                except ValueError as e:
                    return self._send(400, {"success": False, "error": str(e)})
            if "models" in context and "libraries" not in context:   # 3D 모형 선택만 저장
                return self._send(200, {"success": True, "models": lib3d.save_models(context.get("models"))})
            if "outside" in context and "libraries" not in context:   # 창밖 풍경만 저장
                if not isinstance(context["outside"], dict):
                    return self._send(400, {"success": False, "error": "outside는 {time, season, weather, city} 형식이어야 합니다."})
                return self._send(200, {"success": True, "outside": lib3d.save_outside(context["outside"])})
            if "people" in context and "libraries" not in context:   # 층별 인물 수만 저장
                if not isinstance(context["people"], dict):
                    return self._send(400, {"success": False, "error": "people은 {층: {종류: 수}} 형식이어야 합니다."})
                try:
                    return self._send(200, {"success": True, "people": lib3d.save_people(context["people"])})
                except ValueError as e:
                    return self._send(400, {"success": False, "error": str(e)})
            libs = context.get("libraries")
            if libs is not None and not isinstance(libs, list):
                return self._send(400, {"success": False, "error": "libraries는 목록이나 null이어야 합니다."})
            return self._send(200, dict(lib3d.save_settings(libs), success=True))
        if path == "/api/lib3d/agents":   # AI 직원: {action: save|reset|run, ...} (관리자)
            try:
                act = context.get("action")
                if act == "save":
                    lib3d_agents.save_config(context)
                elif act == "reset":
                    lib3d_agents.reset_config()
                elif act == "run":
                    lib3d_agents.run_now(context.get("agent"), context.get("task"))
                else:
                    return self._send(400, {"success": False, "error": "action은 save·reset·run 중 하나입니다."})
                return self._send(200, dict(lib3d_agents.admin_info(), success=True))
            except ValueError as e:
                return self._send(400, {"success": False, "error": str(e)})
        if path in ("/api/lib3d/ai/settings", "/api/lib3d/ai/ask"):  # 3D 서재 AI: 설정 저장 / 질문하기
            try:
                if path == "/api/lib3d/ai/settings":
                    return self._send(200, dict(lib3d_ai.save(context), success=True))
                hist = context.get("history")
                return self._send(200, dict(lib3d_ai.ask(context.get("question"), hist if isinstance(hist, list) else []), success=True))
            except ValueError as e:
                return self._send(400, {"success": False, "error": str(e)})
            except RuntimeError as e:
                log.warning("3D 서재 AI: %s", e)
                return self._send(502, {"success": False, "error": str(e)})
            except Exception as e:  # noqa: BLE001
                log.exception("3D 서재 AI 요청 실패")
                return self._send(500, {"success": False, "error": str(e)})
        return self._send(404, {"success": False, "error": "없는 주소입니다."})


def make_server(host, port):
    server = ThreadingHTTPServer((host, port), Handler)
    lib3d_discord.start()   # 디스코드 채널 연동 (.env에 웹후크·봇 토큰이 있을 때만 실제로 주고받음)
    lib3d_agents.start()   # AI 직원 자율 업무 (AI 설정이 돼 있고 자율 업무가 켜져 있을 때만 실제로 일함)
    server.daemon_threads = True
    _fetch_latest()
    return server
