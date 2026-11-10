#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BookOasis Assistant에 들어 있던 3D 서재의 설정·기록을 이 프로그램으로 옮긴다 (한 번만).

  python3 scripts/import_from_assistant.py /opt/bookoasis_assistant            무엇을 옮길지 보기만
  python3 scripts/import_from_assistant.py /opt/bookoasis_assistant --apply    옮기기
  python3 scripts/import_from_assistant.py /opt/bookoasis_assistant --apply --users   계정(users.json)도

옮기는 것
  - 데이터: lib3d.json(보관함·인물 수·창밖 풍경·거리·현수막), lib3d_agents.json·lib3d_agents_state.json(AI 직원·기억·기록),
           lib3d_ai_budget.json, lib3d_deliveries.jsonl, lib3d_banner.bin, lib3d_covers/(표지 캐시), ui_prefs.json(테마)
  - .env: BOOKOASIS_URL, BOOKOASIS_DB_*, LIB3D_*(LIB3D_ENABLED 빼고), MINI_COVERS_DIR - 이 프로그램 .env에 값이 비어 있는 것만
  - --users: users.json (관리자·관람자 계정과 비밀번호 그대로. 로그인 쿠키는 새로 만들어져 한 번 다시 로그인)
이미 있는 파일은 덮지 않는다 (--force면 덮음). 원본은 건드리지 않는다.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from boa3d import config  # noqa: E402

FILES = ["lib3d.json", "lib3d_agents.json", "lib3d_agents_state.json", "lib3d_ai_budget.json", "lib3d_deliveries.jsonl",
         "lib3d_banner.bin", "lib3d_banner.bin.json", "ui_prefs.json"]
DIRS = ["lib3d_covers"]
ENV_PREFIX = ("BOOKOASIS_URL", "BOOKOASIS_DB_", "LIB3D_", "MINI_COVERS_DIR")
ENV_SKIP = {"LIB3D_ENABLED"}


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    apply, users, force = "--apply" in argv, "--users" in argv, "--force" in argv
    if not args:
        print(__doc__)
        return 2
    src_root = os.path.abspath(args[0])
    src_env = config.read_env_file(os.path.join(src_root, ".env"))
    if not src_env:
        print(f"✗ {src_root}/.env를 읽지 못했습니다 (BookOasis Assistant 설치 폴더를 주세요).")
        return 1
    d = src_env.get("DATA_DIR") or "data"
    src_data = d if os.path.isabs(d) else os.path.join(src_root, d)
    config.load_env()
    dst_data = config.data_dir()
    print(f"원본 데이터: {src_data}\n새 데이터  : {dst_data}\n")
    if apply:
        os.makedirs(dst_data, exist_ok=True)
    names = FILES + (["users.json"] if users else [])
    for name in names + DIRS:
        src, dst = os.path.join(src_data, name), os.path.join(dst_data, name)
        if not os.path.exists(src):
            continue
        if os.path.exists(dst) and not force:
            print(f"  건너뜀 (이미 있음): {name}")
            continue
        print(f"  {'옮김' if apply else '옮길 것'}: {name}")
        if apply:
            if os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
                if name == "users.json":
                    os.chmod(dst, 0o600)
    mine = config.read_env_file()
    values = {k: v for k, v in src_env.items()
              if k.startswith(ENV_PREFIX) and k not in ENV_SKIP and v and not mine.get(k)}
    if values:
        print("\n.env에 넣을 값: " + ", ".join(sorted(values)))
        if apply:
            if not os.path.exists(config.ENV_PATH):
                shutil.copy2(os.path.join(ROOT, "env.example"), config.ENV_PATH)
                os.chmod(config.ENV_PATH, 0o600)
            config.save_env(values)
    if not apply:
        print("\n보기만 했습니다. 옮기려면 --apply를 붙이세요.")
    else:
        print("\n옮겼습니다. 서비스를 다시 시작하세요 (systemctl restart bookoasis_3d).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
