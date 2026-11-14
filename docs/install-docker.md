# BookOasis 3D 서재 설치 가이드 ② 도커 (Docker Compose)

> 이 문서만 따라 하면 설치가 끝나도록 썼습니다. 리눅스 서버 + Docker Engine + Docker Compose(v2) 기준입니다.
> 가상환경으로 설치하려면 → [install-venv.md](install-venv.md) · 설치한 뒤 화면 설정 → [setup-guide.md](setup-guide.md)

> ⚠️ 도커에서 막히기 쉬운 두 가지: ① **책 폴더를 BookOasis와 같은 경로로** 마운트해야 "여기서 읽기·듣기·보기"가 되고,
> ② 컨테이너 안의 `127.0.0.1`은 호스트가 아니라서 **DB·BookOasis·YMPlayer 주소에 127.0.0.1을 쓰면 안 됩니다**(호스트 IP나 `network_mode: host`).

---

## 0. 무엇이 설치되나

| 항목 | 호스트 | 컨테이너 안 |
|---|---|---|
| 프로그램(저장소) | `/opt/bookoasis_3d` | `/app` |
| 설정 파일 | `/opt/bookoasis_3d/.env` | `/app/.env` (파일로 마운트) |
| 계정·서재 설정·AI 직원 기억·표지 캐시 | `/opt/bookoasis_3d/data` | `/data` |
| BookOasis 책 폴더 | 예: `/mnt/library` | `/mnt/library` (**같은 경로**, 읽기 전용) |
| 접속 주소 | `http://서버IP:5932/library3d` | |

이미지에 들어 있는 것: Python 3.12, PyMySQL·Pillow·anthropic, edge-tts(브런치 낭독 음성).

---

## 1. 도커 설치 (이미 있으면 건너뛰기)

```bash
docker --version && docker compose version
# 없으면:
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # sudo 없이 쓰려면 - 한 번 로그아웃했다 다시 로그인
```

---

## 2. 내려받고 파일 준비

```bash
sudo git clone https://github.com/yume-script/bookoasis_3d.git /opt/bookoasis_3d
sudo chown -R $USER:$USER /opt/bookoasis_3d
cd /opt/bookoasis_3d
cp env.example .env && chmod 600 .env
cp docker-compose.example.yml docker-compose.yml
mkdir -p data
```

---

## 3. `.env` 채우기

```bash
nano .env
```

```ini
WEB_USER=admin
WEB_PASSWORD=처음비밀번호          # 컨테이너는 0.0.0.0으로 열리므로 꼭 넣기

# BookOasis - 컨테이너에서 닿는 주소 (127.0.0.1 말고 호스트 IP, 또는 같은 도커 네트워크의 컨테이너 이름)
BOOKOASIS_URL=http://192.168.0.10:5930
BOOKOASIS_DB_URL=mysql://bookoasis:DB비밀번호@192.168.0.10:3306/bookoasis_{db_type}
#   SQLite면 DB 폴더를 같은 경로로 마운트하고: sqlite:////opt/bookoasis/db/{db_type}.db
BOOKOASIS_DB_TYPES=general,adult,audiobook,video

# 브라우저가 여는 BookOasis 주소 (작품 상세·뷰어)
LIB3D_PUBLIC_URL=http://192.168.0.10:5930
```

`WEB_HOST`, `DATA_DIR`, `TZ`는 compose 파일이 정하므로 `.env`에 넣지 마세요.

> MySQL이 `127.0.0.1`에만 열려 있으면(`bind-address = 127.0.0.1`) 컨테이너에서 못 붙습니다.
> 가장 간단한 방법은 compose에서 `network_mode: host`를 켜고(그때 `ports:`는 지움) 주소를 `127.0.0.1`로 두는 것입니다.

---

## 4. `docker-compose.yml`의 볼륨 맞추기

```bash
nano docker-compose.yml
```

| 컨테이너 경로 | 무엇 | 주의 |
|---|---|---|
| `/data` | 계정·서재 설정·AI 직원 기억·표지 캐시 | 지우면 처음부터. **백업 대상** |
| `/app/.env` | 설정 파일 | `env_file:`이 아니라 **파일로 마운트** ([AI 설정] 화면이 이 파일에 저장) |
| `/mnt/library` 등 | BookOasis 책 폴더 | BookOasis가 DB에 적어 둔 경로(`books.file_path`)와 **같은 경로**로, `:ro,rslave` |
| (SQLite면) DB 폴더 | BookOasis SQLite 파일 | `.env`의 `sqlite:///…` 경로와 같게 |

책 폴더 경로를 모르면 BookOasis 보관함 설정에서 보관함 경로를 확인하세요.

---

## 5. 빌드하고 실행

```bash
cd /opt/bookoasis_3d
docker compose up -d --build
docker compose logs -f --tail 50                 # "BookOasis 3D 서재 …: http://0.0.0.0:5932/library3d" 가 나오면 성공
docker exec bookoasis_3d python app.py --check   # DB·보관함·AI 점검
```

브라우저: `http://서버IP:5932/library3d` → `.env`의 `WEB_USER`/`WEB_PASSWORD`로 로그인.

![로그인](images/02-login.png)

그다음은 [setup-guide.md](setup-guide.md).

---

## 6. 매일 쓰는 명령

| 하려는 것 | 명령 (`/opt/bookoasis_3d`에서) |
|---|---|
| 상태 | `docker compose ps` |
| 로그 | `docker compose logs -f --tail 100` |
| 다시 시작 | `docker compose restart` |
| 멈추기 / 켜기 | `docker compose stop` / `docker compose start` |
| 설정 점검 | `docker exec bookoasis_3d python app.py --check` |
| Assistant에서 옮겨 오기 | Assistant 폴더를 `/import`로 마운트한 뒤 `docker exec bookoasis_3d python scripts/import_from_assistant.py /import --apply --users` |

---

## 7. 업데이트

```bash
cd /opt/bookoasis_3d
git pull
docker compose up -d --build
docker image prune -f        # 옛 이미지 정리 (선택)
```

`.env`와 `data/`는 볼륨이라 그대로입니다. 업데이트 뒤 화면이 예전 모습이면 브라우저 강력 새로고침(Ctrl+F5).

---

## 8. 백업

```bash
cd /opt/bookoasis_3d
docker compose stop
tar czf ~/bo3d_backup.tgz --exclude=data/lib3d_covers .env data
docker compose start
```

---

## 9. 자주 막히는 곳

| 증상 | 해결 |
|---|---|
| "BookOasis 보관함을 읽지 못했습니다" | DB 주소가 `127.0.0.1`이면 컨테이너 자신을 가리킵니다. 호스트 IP 또는 `network_mode: host` |
| 표지가 색 상자로만 | `BOOKOASIS_URL`이 컨테이너에서 열리는지: `docker exec bookoasis_3d python -c "import urllib.request;print(urllib.request.urlopen('http://192.168.0.10:5930').status)"` |
| 여기서 읽기에 아무것도 안 나옴 | 책 폴더가 같은 경로로 마운트됐는지: `docker exec bookoasis_3d ls /mnt/library` |
| rclone 마운트 책 폴더가 비어 보임 | 볼륨에 `rslave`를 붙이고 `docker compose restart` |
| [AI 설정]에서 저장한 값이 사라짐 | `.env`를 `env_file:`로 넣었거나 `environment:`에 같은 키가 있음. 파일 마운트(`./.env:/app/.env`)로 |
| BookOasis MCP(`LIB3D_MCP_COMMAND`)가 안 됨 | `docker exec`로 다른 컨테이너를 부르는 설정은 컨테이너 안에서 동작하지 않습니다. 가상환경 설치를 쓰거나 MCP 없이 |
| 업데이트했는데 그대로 | `--build`를 빼먹음 |
