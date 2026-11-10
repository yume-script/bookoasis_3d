#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BookOasis 3D 서재 진입점 - BookOasis 보관함을 걸어 다니며 둘러보는 3D 서점 (혼자·함께 보기, AI 직원·손님, 오락실…)

  python3 app.py            웹 서버 (상주)
  python3 app.py --check    설정만 점검하고 끝냄 (.env, BookOasis DB, 표지 주소, AI 연결)

설정은 .env (env.example 참고). 자세한 것은 docs/guide.md.
"""
import ipaddress
import logging
import os
import signal
import sys
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from boa3d import config  # noqa: E402

config.load_env()

from boa3d import auth, bookoasis_db, lib3d, lib3d_ai  # noqa: E402
from boa3d.web import make_server, modules, version  # noqa: E402

log = logging.getLogger("boa3d")


def _is_loopback(host):
    if host in ("localhost", ""):
        return host == "localhost"
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check():
    """설정 점검 결과를 출력한다. 문제가 있으면 종료 코드 1."""
    problems = 0
    print(f"BookOasis 3D 서재 {version()}  (설정 {config.ENV_PATH}{'' if os.path.exists(config.ENV_PATH) else ', 없음 - env.example을 복사하세요'})")
    print(f"데이터          : {config.data_dir()}")
    if not bookoasis_db.configured():
        print("✗ BookOasis DB  : BOOKOASIS_DB_URL이 없습니다 (필수)")
        problems += 1
    if bookoasis_db.configured():
        try:
            libs = lib3d.all_libraries()
            print(f"보관함           : {len(libs.get('libraries') or [])}개" + "".join(f"\n  ✗ {e}" for e in libs.get("errors") or []))
            problems += len(libs.get("errors") or [])
        except Exception as e:  # noqa: BLE001
            print(f"✗ 보관함        : {e}")
            problems += 1
    print(f"BookOasis 주소   : {config.settings()['bookoasis_url']}  (표지·작품 상세)")
    print(f"AI              : {'연결됨' if lib3d_ai.configured() else '설정 안 됨 (화면의 [AI 설정]에서 - 없어도 서재는 열림)'}")
    print(f"오락실(미니게임) : {'켬' if modules()['mini'] else '끔'}")
    print(f"배달·바깥 알림   : {'켬 (LIB3D_EVENT_TOKEN)' if config.env('LIB3D_EVENT_TOKEN') else '끔'}")
    return 1 if problems else 0


def main():
    config.utf8_console()
    level = getattr(logging, config.env("LOG_LEVEL", "INFO").upper(), logging.INFO)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    os.makedirs(config.data_dir(), exist_ok=True)
    if "--check" in sys.argv:
        return check()
    host = config.env("WEB_HOST", "127.0.0.1") or "127.0.0.1"
    port = config.env_int("WEB_PORT", 5932)
    if auth.bootstrap_from_env():  # 사용자가 없으면 .env의 WEB_USER/WEB_PASSWORD로 첫 관리자를 만든다
        log.info("로그인 계정 '%s'을(를) .env의 WEB_USER/WEB_PASSWORD로 만들었습니다. 이후 비밀번호는 화면에서 바꿉니다.",
                 config.env("WEB_USER", "admin") or "admin")
    if auth.needs_setup() and not _is_loopback(host) and not config.env_bool("WEB_ALLOW_NO_AUTH"):
        # 계정이 없으면 처음 연 사람이 관리자를 만들 수 있으므로 외부에 그대로 열지 않는다
        log.error("로그인 계정이 없어 %s에 열 수 없습니다. .env에 WEB_USER/WEB_PASSWORD를 넣어 첫 관리자를 만들거나, "
                  "WEB_HOST=127.0.0.1로 열어 화면에서 만드세요.", host)
        return 2
    server = make_server(host, port)

    def on_signal(signum, _frame):
        log.info("종료 신호(%s)를 받았습니다.", signal.Signals(signum).name)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    log.info("BookOasis 3D 서재 %s: http://%s:%d/library3d  (데이터: %s, BookOasis DB: %s)", version(), host, port,
             config.data_dir(), "있음" if bookoasis_db.configured() else "없음 - BOOKOASIS_DB_URL")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    log.info("종료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
