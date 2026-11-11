# BookOasis 3D 서재 (bookoasis_3d)

[BookOasis](https://github.com/yume-script) 보관함을 모던 서점 건물로 지어, 그 안을 걸어 다니며 책을 고르고 그 자리에서 읽고·듣고·보는 3D 서재입니다.
예전에는 [BookOasis Assistant](https://github.com/yume-script/bookoasis_assistant)의 메뉴였고, 2.46.0부터 따로 설치하는 프로그램이 되었습니다.

- 세션(일반·성인·오디오북·비디오)마다 한 층, 보관함마다 서가 구역, 작품마다 책장의 책(표지)
- 여기서 읽기(만화·EPUB·PDF)·듣기(오디오북 청음 부스)·보기(시청 부스, 맨 위 영화관 - YMPlayer)
- 함께 보기·채팅, 의자에 앉기, 바깥 거리(갤러리·재즈 청음실·사무실), 1층 브런치 낭독 코너·오락실
- AI 직원(사서·도슨트·대표·큐레이터·청음실 주인)과 AI 손님 - OpenAI 호환 API 또는 Claude API, BookOasis MCP
- 배달: 웹툰 다운로더·디스코드 봇 등 바깥 프로그램이 `POST /api/lib3d/events`로 보내면 배달원이 안내 데스크로
- 디스코드 채널 연동(선택): 웹후크로 서재 채팅 보내기, 봇 토큰으로 채널 대화 받기 - 말한 사람은 "[출판사] 애순이" 같은 손님으로 1층에
- 1층 밖: 순환 도로와 길 건너 건물, 서재 앞 강과 다리, 강 건너 캠핑장(텐트·화롯대·말·새)과 큰 산. 창밖 풍경은 시간·계절·**기준 도시의 실제 날씨**
- 서재 소식(선택): 누가 들어왔는지, BookOasis·Plex·YMPlayer에서 누가 무엇을 읽고 보는지 채팅으로 알림
- 계정: 관리자(모든 설정) / 관람자(둘러보기·읽기·함께 보기, 성인 층은 허용한 사람만)

| 문서 | 내용 |
|---|---|
| [docs/guide.md](docs/guide.md) | 설치·설정·쓰는 법·코너별 안내·`.env` 전체 목록·배포(도커·프록시·백업·보안)·문제 해결 |
| [CHANGELOG.md](CHANGELOG.md) | 버전별 변경 내역 (화면 [설정 > 변경 내역]에서도) |
| [env.example](env.example) | 설정 예시 (주석 포함) |

파이썬 표준 라이브러리로 도는 웹 서버(Python 3.9+)와 three.js 화면입니다. BookOasis DB(MariaDB/MySQL 또는 SQLite) 읽기 권한이 필요합니다.

## 설치

```bash
git clone https://github.com/yume-script/bookoasis_3d /opt/bookoasis_3d
cd /opt/bookoasis_3d
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp env.example .env && chmod 600 .env    # BOOKOASIS_DB_URL, BOOKOASIS_URL, WEB_USER/WEB_PASSWORD 등
venv/bin/python app.py --check            # 설정 점검
venv/bin/python app.py                    # http://127.0.0.1:5932/library3d
```

서비스로 돌리려면 `deploy/bookoasis_3d.service`(경로·User 수정) → `systemctl enable --now bookoasis_3d`.
업데이트: `git pull && venv/bin/pip install -r requirements.txt && systemctl restart bookoasis_3d`.

**BookOasis Assistant에서 옮겨 오기**: `venv/bin/python scripts/import_from_assistant.py /opt/bookoasis_assistant --apply --users`
(설정·AI 직원 기억·활동 기록·표지 캐시·계정·`.env`의 3D 서재 값).

자세한 설치·설정·쓰는 법·문제 해결은 [docs/guide.md](docs/guide.md).

## 구조

```
app.py                      진입점 (웹 서버, --check)
boa3d/web.py                웹 서버 (로그인·화면·API)
boa3d/auth.py               계정·세션 쿠키 (DATA_DIR/users.json)
boa3d/config.py             .env 읽기
boa3d/bookoasis_db.py       BookOasis DB (MySQL/SQLite)
boa3d/lib3d.py              보관함·작품·표지·책 읽기·거리 설정
boa3d/lib3d_ai.py           AI 연결·MCP 도구·손님 대화
boa3d/lib3d_agents.py       AI 직원·손님 (자율 업무, 보고, 바깥 AI 전화)
boa3d/lib3d_events.py       배달 (POST /api/lib3d/events)
boa3d/lib3d_presence.py     함께 보기·채팅
boa3d/lib3d_brunch.py       브런치 연재 낭독 코너
boa3d/lib3d_jazz.py         재즈 청음실 (인터넷 재즈 라디오 중계)
boa3d/lib3d_ymp.py          영화관 (YMPlayer IPTV·텔레그램 중계)
boa3d/lib3d_discord.py      디스코드 채널 연동 (웹후크 보내기, 봇 토큰으로 받기)
boa3d/lib3d_activity.py     서재 소식 (접속·읽기·재생 알림)
web/lib3d/                  3D 화면 (index.html, app.js - three.js r128)
web/shell.js, theme.css     화면 틀(사이드바·테마·계정), login.*
mini/                       오락실 미니게임 (ym_mini_game)
scripts/import_from_assistant.py   BookOasis Assistant에서 옮기기
```

## 테스트

```bash
python3 -m unittest discover -s tests
```
