# BookOasis 3D 서재 설치 가이드 ① 가상환경(venv) + systemd

> 이 문서만 따라 하면 설치가 끝나도록 썼습니다. 리눅스(Ubuntu 22.04/24.04, Debian 12) 서버 기준입니다.
> 도커로 설치하려면 → [install-docker.md](install-docker.md) · 설치한 뒤 화면 설정 → [setup-guide.md](setup-guide.md)
> 코너별 자세한 설명·`.env` 전체 목록 → [guide.md](guide.md)

**권장 방식입니다.** "여기서 읽기·듣기·보기"는 BookOasis와 같은 경로로 책 파일이 보여야 하는데, BookOasis와 같은 서버에 직접 설치하면 따로 맞출 것이 없습니다.

---

## 0. 무엇이 설치되나

| 항목 | 위치 (이 문서 기준) |
|---|---|
| 프로그램 | `/opt/bookoasis_3d` (git 저장소) |
| 파이썬 가상환경 | `/opt/bookoasis_3d/venv` |
| 설정 파일 | `/opt/bookoasis_3d/.env` |
| 계정·서재 설정·AI 직원 기억·표지 캐시 | `/opt/bookoasis_3d/data` |
| 서비스 | `bookoasis_3d` (systemd) |
| 접속 주소 | `http://서버IP:5932/library3d` |

**미리 있어야 하는 것**

| 필요한 것 | 왜 |
|---|---|
| **BookOasis DB 읽기 권한** (MariaDB/MySQL 계정 또는 SQLite 파일) | 보관함·작품 목록을 여기서 읽습니다. 읽기 전용 계정이면 충분 |
| **BookOasis 주소** | 표지(`/covers/…`), 작품 상세·BookOasis 뷰어 링크 |
| 책 파일이 BookOasis와 같은 경로로 보일 것 | 여기서 읽기·듣기·보기 (안 되면 BookOasis 뷰어로만 읽음) |
| 최신 크롬·엣지·사파리·파이어폭스 | WebGL 3D 화면. three.js와 사람 모형은 인터넷(cdnjs·jsdelivr)에서 받음 |

---

## 1. 필요한 프로그램 설치

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip
python3 --version          # Python 3.9 이상이면 됨
```

---

## 2. 내려받기

```bash
sudo git clone https://github.com/yume-script/bookoasis_3d.git /opt/bookoasis_3d
cd /opt/bookoasis_3d
```

---

## 3. 가상환경 만들고 패키지 설치

```bash
cd /opt/bookoasis_3d
sudo python3 -m venv venv
sudo venv/bin/pip install --upgrade pip
sudo venv/bin/pip install -r requirements.txt
sudo venv/bin/pip install edge-tts        # (선택) 브런치 낭독 코너의 자연스러운 Edge 음성
```

- **꼭 `venv/bin/pip`로** 설치하세요. 그냥 `pip install`은 Ubuntu/Debian에서 막힙니다(`externally-managed-environment`).
- 설치되는 것: `PyMySQL`(BookOasis DB), `Pillow`(표지 줄이기), `anthropic`(AI를 Claude API로 쓸 때만 필요).

---

## 4. `.env` 만들기

```bash
cd /opt/bookoasis_3d
sudo cp env.example .env
sudo chmod 600 .env          # DB 비밀번호·AI 키가 들어가는 파일
sudo nano .env
```

**처음에 꼭 넣을 것** (나머지는 나중에 화면에서):

```ini
# ── 웹 화면 ──
WEB_HOST=0.0.0.0             # 다른 PC·태블릿에서 접속 (이 서버 안에서만 쓰면 127.0.0.1)
WEB_PORT=5932
WEB_USER=admin               # 첫 관리자 아이디 (사용자가 없을 때 한 번만 만듦)
WEB_PASSWORD=처음비밀번호     # ← 반드시 바꾸기. 0.0.0.0으로 열 때 계정이 없으면 시작하지 않음

# ── BookOasis (필수) ──
BOOKOASIS_URL=http://127.0.0.1:5930
# MariaDB/MySQL: {db_type}은 general·adult·audiobook·video로 바뀐다
BOOKOASIS_DB_URL=mysql://bookoasis:DB비밀번호@127.0.0.1:3306/bookoasis_{db_type}
#   SQLite면:  BOOKOASIS_DB_URL=sqlite:////BookOasis경로/db/{db_type}.db
#   비밀번호에 특수문자가 있으면 URL 인코딩 (@ → %40, : → %3A, / → %2F)
BOOKOASIS_DB_TYPES=general,adult,audiobook,video

# 위 BOOKOASIS_URL이 서버 안에서만 통하는 주소(127.0.0.1 등)면, 브라우저가 여는 BookOasis 주소를 따로
LIB3D_PUBLIC_URL=http://192.168.0.10:5930
```

| 값 | 어디서 확인하나 |
|---|---|
| DB 주소·계정 | BookOasis의 `.env` 또는 BookOasis 설치 때 정한 DB 설정 |
| DB 이름 | BookOasis가 세션마다 만든 DB (예: `bookoasis_general`, `bookoasis_adult` …) → `{db_type}` 자리 |
| `BOOKOASIS_URL` | 이 서버에서 BookOasis가 열리는 주소 (같은 서버면 `http://127.0.0.1:5930`) |

---

## 5. 설정 점검하고 한 번 실행해 보기

```bash
cd /opt/bookoasis_3d
sudo venv/bin/python app.py --check      # DB·보관함·AI·배달 점검 (✗ 줄을 고침)
sudo venv/bin/python app.py              # 실행
```

`BookOasis 3D 서재 2.x.x: http://0.0.0.0:5932/library3d` 줄이 나오면 성공입니다.
브라우저로 `http://서버IP:5932/library3d` → 로그인하면 1층 로비가 뜹니다. 확인했으면 `Ctrl+C`.

![로그인](images/02-login.png)
![1층 로비](images/03-lobby.png)

---

## 6. 서비스로 등록 (부팅할 때 자동 실행)

저장소의 `deploy/bookoasis_3d.service`는 `/opt/bookoasis_3d`, `root` 기준입니다(이 문서와 같음).

```bash
sudo cp /opt/bookoasis_3d/deploy/bookoasis_3d.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bookoasis_3d
systemctl status bookoasis_3d            # active (running)
journalctl -u bookoasis_3d -f            # 실시간 로그 (Ctrl+C로 나가기)
```

다른 폴더·다른 계정이면 서비스 파일의 `User=`, `WorkingDirectory=`, `ExecStart=`를 고친 뒤 복사하세요
(그 계정이 `.env`·`data/`에 쓸 수 있고, 책 파일을 읽을 수 있어야 합니다).

접속이 안 되면 방화벽: `sudo ufw allow 5932/tcp`

이제 [setup-guide.md](setup-guide.md)를 따라 보여 줄 보관함·창밖 풍경·AI 직원 등을 정하세요.

---

## 7. BookOasis Assistant에서 옮겨 오기 (예전에 Assistant 안에서 3D 서재를 쓰던 분)

```bash
cd /opt/bookoasis_3d
sudo venv/bin/python scripts/import_from_assistant.py /opt/bookoasis_assistant                   # 무엇을 옮길지 보기
sudo venv/bin/python scripts/import_from_assistant.py /opt/bookoasis_assistant --apply --users   # 옮기기 (--users: 계정도)
sudo systemctl restart bookoasis_3d
```

설정·AI 직원 기억·활동 기록·표지 캐시·계정과 Assistant `.env`의 3D 서재 값이 옮겨집니다(원본은 그대로).
Assistant 쪽 `.env`에 `LIB3D_URL=http://서버:5932`를 넣으면 사이드바 메뉴가 이쪽으로 이어집니다.

---

## 8. 업데이트

화면 왼쪽 위 버전 배지가 빨갛게 바뀌면 새 버전이 있다는 뜻입니다(설정 > 정보에도 나옴).

```bash
cd /opt/bookoasis_3d
sudo git pull
sudo venv/bin/pip install -r requirements.txt
sudo systemctl restart bookoasis_3d
```

업데이트 뒤 화면이 예전 모습이면 브라우저를 강력 새로고침(Ctrl+F5)하세요. 무엇이 바뀌었는지는 화면 [설정 > 변경 내역] 또는 `CHANGELOG.md`.

---

## 9. 백업

```bash
sudo systemctl stop bookoasis_3d
sudo tar czf ~/bo3d_backup.tgz --exclude=data/lib3d_covers -C /opt/bookoasis_3d .env data
sudo systemctl start bookoasis_3d
```

BookOasis DB에는 아무것도 쓰지 않습니다(읽기만). `data/lib3d_covers/`는 다시 받으므로 빼도 됩니다.

---

## 10. 밖(인터넷)에서 접속하려면

https 리버스 프록시 뒤에 두세요. 위치를 0.4초마다 보내고 오디오·영상을 중계하므로 버퍼링을 끕니다 (Nginx 예):

```nginx
location / {
    proxy_pass http://127.0.0.1:5932;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300;
    proxy_buffering off;
    client_max_body_size 20m;
}
```

하위 경로(`/library/` 등)보다 하위 도메인(`3d.내도메인.com`)을 권합니다.

---

## 11. 자주 막히는 곳

| 증상 | 해결 |
|---|---|
| `error: externally-managed-environment` | `pip` 대신 `venv/bin/pip` (3단계) |
| 시작하자마자 꺼짐 "로그인 계정이 없어 … 열 수 없습니다" | `.env`에 `WEB_USER`/`WEB_PASSWORD` |
| "BookOasis 보관함을 읽지 못했습니다" | `BOOKOASIS_DB_URL`(DB 이름의 `{db_type}`), 계정 권한, 이 서버에서 DB 접속 (`--check`) |
| 표지가 색 상자·제목 표지로만 | `BOOKOASIS_URL`이 이 서버에서 열리는지 |
| 작품 상세·BookOasis 뷰어가 안 열림 | 브라우저에서 열리는 주소를 `LIB3D_PUBLIC_URL`에 |
| 여기서 읽기·듣기에서 아무것도 안 나옴 | 책 파일(`books.file_path`)이 이 서버에서 같은 경로로 안 보임 - 같은 마운트로 |
| "3D 라이브러리(three.js)를 불러오지 못했습니다" | 브라우저가 cdnjs.cloudflare.com·cdn.jsdelivr.net에 접속 가능한지 |
| 화면이 버벅임 | 설정의 [3D 모형]을 '지금 그대로', [인물 수] 줄이기, 브라우저 하드웨어 가속 켜기 |

더 많은 증상은 [guide.md의 문제 해결](guide.md#10-문제-해결).
