"""BookOasis 3D 서재 - 바깥 프로그램(디스코드 봇 등)의 인물이 지금 어디서 무엇을 하는지 → 3D 서재의 자리

바깥 프로그램이 POST /api/lib3d/events {"type": "where", "people": [{"name", "location", "activity", "state", "company"}]}로 알려 주면,
그 사람(디스코드에서 온 손님과 같은 이름)을 말한 장소에 맞는 곳에 세운다. 대화에서 "편집국에 있다"던 사람이 사무실 책상에 앉아 있게.
장소 글은 제각각이라 낱말로 묶는다 (앞의 것이 먼저):
  home     집·자는 중        → 보이지 않음
  cafe     카페·커피          → 길 건너 카페 탁자
  eat      주점·식당·밥집     → 카페 탁자 (식당이 따로 없어서)
  library  서재·서점·도서관   → 서재 1층 라운지
  meeting  회의               → 사무실 회의 탁자
  video    영상·촬영·스튜디오 → 사무실 영상팀 책상
  book     편집국·출판·원고   → 사무실 편집국 책상
  camp     캠핑·강가          → 강 건너 캠핑장 모닥불가
  street   거리·공원·가게…    → 서재 앞마당
모르는 곳이면 소속(company)으로 book·video, 그것도 모르면 street.
소식은 KEEP_SEC 동안만 믿는다 (봇이 멈추면 사람들이 그 자리에 계속 남지 않게).
"""
import re
import threading
import time

KEEP_SEC = 3 * 3600
MAX_PEOPLE = 60
RULES = (
    ("home", ("자택", "침대", "숙소", "오두막", "다락", "거실", "방에서", "원룸", "기숙사", "자취방")),
    ("cafe", ("카페", "커피", "오후세시")),
    ("eat", ("주점", "식당", "밥집", "술집", "포차", "분식", "국밥", "레스토랑", "빵집", "베이커리", "솥뚜껑", "구내식당", "점심")),
    ("library", ("서재", "서점", "도서관", "bookoasis", "북오아시스")),
    ("meeting", ("회의", "미팅")),
    ("video", ("영상", "촬영", "스튜디오", "상영관", "영사실", "편집실", "매표", "녹음")),
    ("book", ("편집국", "출판", "편집부", "서가", "서고", "수선실", "원고", "교정")),
    ("camp", ("캠핑", "강가", "강변", "샘터", "모닥불")),
    ("street", ("거리", "골목", "공원", "산책", "시장", "편의점", "약국", "헬스", "학원", "공방", "관리실", "서버실", "창고", "옥상", "사옥", "로비")),
)
_HOME_RE = re.compile(r"(?:^|[\s(,·/])(?:우리\s?|내\s?|자기\s?)?집(?:$|[\s),·/]|에|으로|에서|안|앞)")
_LOCK = threading.Lock()
_PEOPLE = {}   # 이름 → {location, activity, state, company, place, t}


def place_of(location, state="", company=""):
    """장소 글 → 자리 종류"""
    if "자는" in str(state or "") or "수면" in str(state or ""):
        return "home"
    loc = str(location or "").lower()
    if _HOME_RE.search(loc):   # '집'은 낱말로 있을 때만 ('편집국'·'편집실'의 집이 아님)
        return "home"
    for key, words in RULES:
        if any(w in loc for w in words):
            return key
    comp = str(company or "")
    if any(w in comp for w in ("영상", "스튜디오")):
        return "video"
    if any(w in comp for w in ("편집", "출판")):
        return "book"
    return "street"


def update(people, now=None):
    """people: [{"name", "location", "activity", "state", "company"}] - 온 사람만 바꾼다. 받은 수"""
    now = now or time.time()
    n = 0
    with _LOCK:
        for p in (people or [])[:MAX_PEOPLE]:
            if not isinstance(p, dict):
                continue
            name = " ".join(str(p.get("name") or "").split())[:20]
            if not name:
                continue
            loc = " ".join(str(p.get("location") or "").split())[:40]
            state = " ".join(str(p.get("state") or "").split())[:20]
            comp = " ".join(str(p.get("company") or "").split())[:40]
            _PEOPLE[name] = {"location": loc, "activity": " ".join(str(p.get("activity") or "").split())[:40], "state": state, "company": comp,
                             "place": place_of(loc, state, comp), "t": now}
            n += 1
        for k in [k for k, v in _PEOPLE.items() if now - v["t"] > KEEP_SEC]:
            _PEOPLE.pop(k, None)
    return n


def get(name, now=None):
    now = now or time.time()
    with _LOCK:
        v = _PEOPLE.get(str(name or ""))
        return dict(v) if v and now - v["t"] <= KEEP_SEC else None


def everyone(now=None):
    """지금 믿을 수 있는 소식 전부 {이름: 정보}"""
    now = now or time.time()
    with _LOCK:
        return {k: dict(v) for k, v in _PEOPLE.items() if now - v["t"] <= KEEP_SEC}
