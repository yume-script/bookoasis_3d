/* BookOasis 3D 서재 - 모던 서점 분위기의 건물 안을 혼자 걸어 다니며 둘러보고, 고른 책을 그 자리에서 읽는다.
 * 세션별로 층(1층 일반 · 2층 성인 · 3층 오디오북 · 4층 비디오 …), 보관함은 서가 구역, 작품(시리즈)은
 * 평대의 표지 · 눈높이 칸의 표지 진열 · 나머지 칸의 책등(제목)으로. 빈칸은 장식용 책으로 채운다.
 * 데이터: api/lib3d/data · 표지: api/lib3d/cover · 열기: api/lib3d/open · 읽기: api/lib3d/volumes|book|page|chapter|pdf
 * 조작: W A S D·방향키 이동(Shift 빠르게), 끌기로 둘러보기, 책 누르기, 휴대폰은 왼쪽 아래 끌기로 이동
 * 읽기: 펼친 책 모양, 책장 넘김(넓은 화면은 두 쪽 펼침, 만화는 오른쪽→왼쪽도). 매장에는 걷고 책을 고르는 사람들.
 * 설정(#settings): 보여 줄 보관함 고르기 - api/lib3d/libraries, POST api/lib3d/settings */
(function () {
  'use strict';
  var wrap = document.getElementById('l3d');
  var msg = document.getElementById('l3d-msg');
  if (!wrap) return;
  if (!window.THREE) { msg.textContent = '3D 라이브러리(three.js)를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'; return; }
  var T = window.THREE;

  // ── 렌더러·장면 (실사 느낌: sRGB, 필름 톤, 부드러운 그림자) ──
  var renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  wrap.insertBefore(renderer.domElement, wrap.firstChild);
  var scene = new T.Scene();
  if (T.RoomEnvironment) {   // 실내 반사광(환경 조명): 나무·금속·유리에 은은한 반사가 생긴다
    try { scene.environment = new T.PMREMGenerator(renderer).fromScene(new T.RoomEnvironment(), 0.04).texture; } catch (e) { /* 없으면 예전대로 */ }
  }
  scene.background = new T.Color(0xf3efe8);
  scene.fog = new T.Fog(0xf3efe8, 40, 120);
  var camera = new T.PerspectiveCamera(60, 1, 0.05, 200);
  var EYE = 1.62, CEIL = 5.4;
  var hemi = new T.HemisphereLight(0xffffff, 0xcbb89c, scene.environment ? 0.3 : 0.6); scene.add(hemi);
  scene.add(new T.AmbientLight(0xffffff, 0.12));
  var sun = new T.DirectionalLight(0xfff4e2, 0.85);   // 창으로 들어오는 빛
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ── 질감 (캔버스로 만든 나무결·바닥·창) ──
  var FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  function canvasTex(w, h, draw, repeat) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function rnd(seed) { var s = seed % 2147483647 || 1; return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }
  function grain(g, w, h, base, dark, lines, r) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (var i = 0; i < lines; i++) {
      var y = r() * h;
      g.strokeStyle = dark; g.globalAlpha = 0.05 + r() * 0.12; g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath(); g.moveTo(0, y);
      for (var x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / (40 + r() * 60) + i) * (2 + r() * 4));
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  var oakTex = canvasTex(512, 512, function (g, w, h) { grain(g, w, h, '#c9a27a', '#7a5534', 90, rnd(7)); }, [1, 1]);
  var floorTex = canvasTex(1024, 1024, function (g, w, h) {   // 밝은 원목 마루 (판자 이음매가 엇갈림)
    var r = rnd(11), pw = 128;
    for (var col = 0; col < w / pw; col++) {
      var y = -r() * 300;
      while (y < h) {
        var len = 260 + r() * 300, tone = 200 + Math.floor(r() * 26);
        g.fillStyle = 'rgb(' + tone + ',' + (tone - 34) + ',' + (tone - 78) + ')';
        g.fillRect(col * pw, y, pw, len);
        for (var k = 0; k < 14; k++) {
          g.strokeStyle = 'rgba(110,70,40,' + (0.05 + r() * 0.08) + ')'; g.lineWidth = 1 + r() * 2;
          var gx = col * pw + 6 + r() * (pw - 12);
          g.beginPath(); g.moveTo(gx, y); g.bezierCurveTo(gx + 6, y + len / 3, gx - 6, y + len * 2 / 3, gx, y + len); g.stroke();
        }
        g.fillStyle = 'rgba(70,45,25,0.35)'; g.fillRect(col * pw, y + len - 2, pw, 2);
        y += len;
      }
      g.fillStyle = 'rgba(70,45,25,0.35)'; g.fillRect(col * pw + pw - 2, 0, 2, h);
    }
  }, [6, 6]);
  var skyTex = canvasTex(64, 256, function (g, w, h) {   // 창밖 (밝은 하늘)
    var grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#dff0ff'); grd.addColorStop(0.7, '#f7fbff'); grd.addColorStop(1, '#e8efe2');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });

  var M = {
    oak: new T.MeshStandardMaterial({ map: oakTex, roughness: 0.62, metalness: 0 }),
    white: new T.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.9 }),
    wall: new T.MeshStandardMaterial({ color: 0xf2efea, roughness: 0.95 }),
    black: new T.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.45, metalness: 0.55 }),
    steel: new T.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.85 }),
    floor: new T.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }),
    ceil: new T.MeshStandardMaterial({ color: 0xfbfaf8, roughness: 1, side: T.DoubleSide }),
    lamp: new T.MeshBasicMaterial({ color: 0xfffaf0 }),
    sky: new T.MeshBasicMaterial({ map: skyTex }),
    shelfBack: new T.MeshStandardMaterial({ color: 0xece7df, roughness: 0.9 }),
    green: new T.MeshStandardMaterial({ color: 0x4f7a4a, roughness: 0.8 }),
    pot: new T.MeshStandardMaterial({ color: 0xe9e4dc, roughness: 0.7 })
  };

  function textTex(lines, w, h, bg, fg, size, align) {
    return canvasTex(w, h, function (g) {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = align || 'center';
      var y = h / 2 - (lines.length - 1) * size * 0.6;
      lines.forEach(function (line, i) {
        var s = i === 0 ? size : size * 0.55;
        g.font = (i === 0 ? '700 ' : '400 ') + s + 'px ' + FONT;
        g.fillText(line, align === 'left' ? 40 : w / 2, y + i * size * 1.15, w - 60);
      });
    });
  }
  // 차분한 책 색 (서점 책등처럼)
  var PALETTE = [0x2f4858, 0x8c3b3b, 0xd8cbb0, 0x3e5c47, 0x1f2a44, 0xb5793e, 0x6b4f73, 0xe9e2d0, 0x9a9a8a, 0x41363b,
                 0x7d8f69, 0xc2a35a, 0x5b6b7a, 0xa65f4b, 0x2c2c2c, 0xd9d4c7];
  function hashStr(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }
  function colorOf(s) { return PALETTE[hashStr(s) % PALETTE.length]; }
  function inkOn(hex) { var c = new T.Color(hex); return (c.r * 0.3 + c.g * 0.59 + c.b * 0.11) > 0.6 ? '#2a2a2a' : '#f3efe6'; }

  // ── 구조 ──
  var BOOTH_W = 10, BOOTH_D = 8, GAP = 5, COLS = 4, LOBBY = 14;
  var parent = scene, books = [], booths = [];
  function add(mesh, x, y, z, cast) {
    mesh.position.set(x, y, z);
    if (cast) { mesh.castShadow = true; mesh.receiveShadow = true; }
    parent.add(mesh);
    return mesh;
  }
  function box(w, h, d, mat, x, y, z, cast) { return add(new T.Mesh(new T.BoxGeometry(w, h, d), mat), x, y, z, cast); }

  // 책장 하나 (원목 틀 + 흰 뒤판 + 검은 받침), 로컬 +z가 앞. 반환 { unit, width, rows: [{y}] }
  var SHELF_H = 2.3, ROW_Y = [0.14, 0.58, 1.02, 1.46, 1.9], DEPTH = 0.36;
  function shelfUnit(g, x, z, rotY, width) {
    var unit = new T.Group();
    unit.position.set(x, 0, z); unit.rotation.y = rotY;
    g.add(unit);
    function part(w, h, d, mat, px, py, pz) {
      var m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(px, py, pz); m.castShadow = true; m.receiveShadow = true; unit.add(m); return m;
    }
    part(width, SHELF_H, 0.02, M.shelfBack, 0, SHELF_H / 2, -DEPTH / 2 + 0.01);
    part(0.04, SHELF_H, DEPTH, M.oak, -width / 2, SHELF_H / 2, 0);
    part(0.04, SHELF_H, DEPTH, M.oak, width / 2, SHELF_H / 2, 0);
    part(width + 0.04, 0.04, DEPTH, M.oak, 0, SHELF_H, 0);
    part(width, 0.1, DEPTH - 0.02, M.black, 0, 0.05, 0);
    part(width + 0.1, 0.035, DEPTH + 0.05, M.oak, 0, SHELF_H + 0.037, 0.01);   // 윗몰딩
    part(width + 0.04, 0.03, 0.012, M.oak, 0, SHELF_H - 0.045, DEPTH / 2);       // 윗단 앞 가림
    ROW_Y.forEach(function (y, i) { if (i) part(width, 0.025, DEPTH, M.oak, 0, y - 0.0125, 0); });
    return { unit: unit, width: width, rows: ROW_Y.map(function (y) { return { y: y }; }) };
  }

  // 책 (작품 하나) - 표지 진열(face), 평대(flat), 책등(spine)
  var faceGeo = new T.BoxGeometry(0.3, 0.42, 0.035);
  var paperMat = new T.MeshStandardMaterial({ color: 0xf0ebe0, roughness: 0.9 });   // 종이 단면 (모든 책이 같이 씀)
  function makeBook(kind, s, lib) {
    var base = colorOf(s.title);
    var side = paperMat;
    var front = new T.MeshStandardMaterial({ color: base, roughness: 0.6 });
    var mesh, b = { key: lib.db_type + ':' + s.last, title: s.title || '(제목 없음)', count: s.count, lib: lib.name,
                    db: lib.db_type, front: front, base: base, state: 0, kind: kind };
    if (kind === 'spine') {
      var th = 0.035 + (hashStr(s.title) % 5) * 0.008, ht = 0.3 + (hashStr(s.title + 'h') % 6) * 0.015;
      mesh = new T.Mesh(new T.BoxGeometry(th, ht, 0.24), [side, side, side, side, front, side]);   // 앞면(+z) = 책등
      b.th = th; b.ht = ht;
    } else {
      mesh = new T.Mesh(faceGeo, [side, side, side, side, front, side]);
    }
    mesh.castShadow = true;
    mesh.userData.book = b;
    b.mesh = mesh;
    books.push(b);
    return b;
  }

  // 장식용 책 (누를 수 없음, 한 구역에 InstancedMesh 하나)
  function fillerBooks(g, items) {
    if (!items.length) return;
    var im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshStandardMaterial({ roughness: 0.75 }), items.length);
    var m4 = new T.Matrix4(), q = new T.Quaternion(), c = new T.Color();
    items.forEach(function (it, i) {
      q.setFromEuler(new T.Euler(0, it.ry, 0));
      m4.compose(new T.Vector3(it.x, it.y, it.z), q, new T.Vector3(it.w, it.h, it.d));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHex(it.c));
    });
    im.castShadow = true; im.receiveShadow = true;
    g.add(im);
  }

  // 책장 칸 채우기: 눈높이 칸(3번째 줄)은 표지 진열, 나머지는 책등. 작품이 모자라면 장식 책
  // fill = { face: 표지 칸에 놓을 작품, spine: 책등 칸에 놓을 작품, left: 아직 안 채운 책등 칸 너비 합(m) }
  //  → 책등 칸마다 '남은 작품 수 / 남은 자리 수' 확률로 고르면 작품이 모든 책장에 고르게 퍼진다
  var SPINE_STEP = 0.055;   // 책 한 권이 차지하는 평균 너비(m)
  function stockShelf(su, fill, lib, filler, group) {
    var w = su.width - 0.08, unit = su.unit;
    unit.updateMatrixWorld(true);
    var toGroup = new T.Matrix4().copy(group.matrixWorld).invert().multiply(unit.matrixWorld);
    var p = new T.Vector3(), r = rnd(hashStr(lib.name) + Math.round(su.width * 100 + unit.position.x * 10 + unit.position.z * 7));
    su.rows.forEach(function (row, ri) {
      if (ri === 2) {   // 표지 진열
        var n = Math.floor(w / 0.38);
        for (var i = 0; i < n; i++) {
          var x = -w / 2 + 0.38 * (i + 0.5);
          var s = fill.face.shift() || fill.spine.shift();
          if (s) {
            var b = makeBook('face', s, lib);
            b.mesh.position.set(x, row.y + 0.21, -0.06); b.mesh.rotation.x = -0.1;
            unit.add(b.mesh);
          } else {
            p.set(x, row.y + 0.2, -0.06).applyMatrix4(toGroup);
            filler.push({ x: p.x, y: p.y, z: p.z, w: 0.29, h: 0.4, d: 0.03, ry: unit.rotation.y, c: PALETTE[Math.floor(r() * PALETTE.length)] });
          }
        }
        return;
      }
      var cx = -w / 2;
      while (cx < w / 2 - 0.05) {
        var want = fill.spine.length / Math.max(1, (fill.left - (cx + w / 2)) / SPINE_STEP);   // 남은 작품 / 남은 자리
        var s2 = r() < Math.min(0.9, want) ? fill.spine.shift() : null;   // 작품이 넉넉해도 장식 책을 조금 섞어 실제 서가처럼
        if (s2) {
          var b2 = makeBook('spine', s2, lib);
          if (cx + b2.th > w / 2) { fill.spine.unshift(s2); books.pop(); break; }
          b2.mesh.position.set(cx + b2.th / 2, row.y + b2.ht / 2, -0.02);
          unit.add(b2.mesh);
          cx += b2.th + 0.004;
        } else {
          var th = 0.025 + r() * 0.045, ht = 0.26 + r() * 0.11;
          if (cx + th > w / 2) break;
          p.set(cx + th / 2, row.y + ht / 2, -0.02).applyMatrix4(toGroup);
          filler.push({ x: p.x, y: p.y, z: p.z, w: th, h: ht, d: 0.2 + r() * 0.05, ry: unit.rotation.y,
                        c: PALETTE[Math.floor(r() * PALETTE.length)] });
          cx += th + 0.004;
        }
        if (r() < 0.04) cx += 0.12;   // 가끔 빈틈
      }
      fill.left = Math.max(0, fill.left - w);
    });
  }

  function addSection(lib, index) {
    var col = index % COLS, row = Math.floor(index / COLS);
    var cx = (col - (COLS - 1) / 2) * (BOOTH_W + GAP), cz = -LOBBY - BOOTH_D / 2 - row * (BOOTH_D + GAP);
    var g = new T.Group();
    g.position.set(cx, 0, cz);
    parent.add(g);
    g.updateMatrixWorld(true);
    var queue = lib.series.slice();
    // 평대 (작품 표지를 눕혀서)
    var tbl = new T.Group(); tbl.position.set(0, 0, 1.6); g.add(tbl);
    var top = new T.Mesh(new T.BoxGeometry(2.8, 0.05, 1.3), M.oak); top.position.y = 0.82; top.castShadow = top.receiveShadow = true; tbl.add(top);
    var body = new T.Mesh(new T.BoxGeometry(2.6, 0.78, 1.1), M.white); body.position.y = 0.4; body.castShadow = body.receiveShadow = true; tbl.add(body);
    for (var t = 0; t < 10 && queue.length; t++) {   // 평대: 들어올 때마다 이 보관함 작품 중 무작위 10개 (책장에서는 뺀다)
      var b = makeBook('flat', queue.splice(Math.floor(Math.random() * queue.length), 1)[0], lib);
      b.mesh.rotation.x = -Math.PI / 2;
      b.mesh.rotation.z = ((hashStr(b.title) % 7) - 3) * 0.02;
      b.mesh.position.set(-1.12 + (t % 5) * 0.56, 0.86, -0.27 + Math.floor(t / 5) * 0.55);
      tbl.add(b.mesh);
    }
    // 책장: 뒤 2개, 양옆 1개씩
    var units = [shelfUnit(g, -BOOTH_W / 4 + 0.05, -BOOTH_D / 2 + 0.3, 0, BOOTH_W / 2 - 0.3),
                 shelfUnit(g, BOOTH_W / 4 - 0.05, -BOOTH_D / 2 + 0.3, 0, BOOTH_W / 2 - 0.3),
                 shelfUnit(g, -BOOTH_W / 2 + 0.3, -0.3, Math.PI / 2, BOOTH_D - 1.6),
                 shelfUnit(g, BOOTH_W / 2 - 0.3, -0.3, -Math.PI / 2, BOOTH_D - 1.6)];
    var filler = [], faceN = 0, spineW = 0;
    units.forEach(function (u) { var w = u.width - 0.08; faceN += Math.floor(w / 0.38); spineW += w * (ROW_Y.length - 1); });
    var fill = { face: queue.slice(0, faceN), spine: queue.slice(faceN), left: spineW };   // 최근 작품은 눈높이 표지 칸부터
    units.forEach(function (u) { stockShelf(u, fill, lib, filler, g); });
    fillerBooks(g, filler);
    // 천장에 매단 구역 간판 (검정 판, 흰 글씨)
    var sign = new T.Mesh(new T.BoxGeometry(4.2, 0.62, 0.04), [M.black, M.black, M.black, M.black,
      new T.MeshBasicMaterial({ map: textTex([lib.name, lib.series.length + '작품'], 1024, 152, '#1d1e20', '#f5f2ec', 64) }), M.black]);
    sign.position.set(0, 3.75, -0.6); g.add(sign);
    [-1.9, 1.9].forEach(function (sx) {
      var cable = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 4.06, 6), M.black);
      cable.position.set(sx, (CEIL + 4.06) / 2, -0.6); g.add(cable);
    });
    // 평대 위 펜던트 조명
    var shade = new T.Mesh(new T.CylinderGeometry(0.16, 0.34, 0.26, 24, 1, true), M.black);
    shade.position.set(0, 2.45, 1.6); g.add(shade);
    var bulb = new T.Mesh(new T.CircleGeometry(0.33, 24), M.lamp); bulb.rotation.x = Math.PI / 2; bulb.position.set(0, 2.33, 1.6); g.add(bulb);
    var cord = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 2.58, 6), M.black); cord.position.set(0, (CEIL + 2.58) / 2, 1.6); g.add(cord);
    booths.push({ name: lib.name, x: cx, z: cz, count: lib.series.length });
    if (layout) layout.sections.push({ x: cx, z: cz });
  }

  // ── 건물 (한 층) ──
  var hall = { x0: -20, x1: 20, z0: -40, z1: 10 };
  var elevator = null;
  // ── 창밖 경치: 먼 하늘·산·도시(둘러싼 원통 그림) + 길·보도·가로수·건너편 건물(실제 입체, 걸으면 시차가 생긴다) ──
  var SCENE_R = 130;   // 먼 경치 원통 반지름
  var grassTex = canvasTex(256, 256, function (g, w, h) {
    var r = rnd(31); g.fillStyle = '#8aa36f'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 2200; i++) { g.fillStyle = 'rgba(' + (60 + Math.floor(r() * 60)) + ',' + (100 + Math.floor(r() * 60)) + ',50,' + (0.15 + r() * 0.25) + ')'; g.fillRect(r() * w, r() * h, 2, 2 + r() * 3); }
  }, [60, 60]);
  var paveTex = canvasTex(256, 256, function (g, w, h) {   // 보도블록
    var r = rnd(37); g.fillStyle = '#c9c2b6'; g.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 32) for (var x = (y / 32) % 2 ? -32 : 0; x < w; x += 64) {
      var t = 190 + Math.floor(r() * 25); g.fillStyle = 'rgb(' + t + ',' + (t - 6) + ',' + (t - 16) + ')'; g.fillRect(x + 1, y + 1, 62, 30);
    }
  }, [2, 40]);
  var roadTex = canvasTex(256, 512, function (g, w, h) {   // 아스팔트 + 가운데 점선
    var r = rnd(41); g.fillStyle = '#5d6064'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 3000; i++) { g.fillStyle = 'rgba(255,255,255,' + r() * 0.06 + ')'; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    g.fillStyle = '#e9d27a'; for (var y = 0; y < h; y += 128) g.fillRect(w / 2 - 4, y, 8, 64);
    g.fillStyle = '#f2f2ee'; g.fillRect(8, 0, 6, h); g.fillRect(w - 14, 0, 6, h);
  }, [1, 20]);
  // 건너편 건물 외벽: 한 장이 가로 4칸 × 세로 4층 (한 칸 3m × 3.2m). 건물마다 UV를 크기에 맞춰 되풀이해 창 크기가 늘 같다.
  // 모양 둘: 0 = 사무실(넓은 띠창·어두운 창틀), 1 = 주거(창 둘·창턱·실외기). 같은 배치로 색·반사(G=거칠기,B=금속성)·밤 불빛·요철 그림을 그린다.
  function drawFacade(g, w, h, style, mode) {
    var C = w / 4, wallC = { color: '#ffffff', pbr: 'rgb(0,228,0)', night: '#000000', bump: '#808080' }[mode];
    g.fillStyle = wallC; g.fillRect(0, 0, w, h);
    var rr = rnd(43 + style * 7);
    if (mode === 'color') {   // 벽 얼룩·줄눈
      for (var n = 0; n < 2600; n++) { g.fillStyle = 'rgba(' + (rr() < 0.5 ? '0,0,0,' : '255,255,255,') + rr() * 0.05 + ')'; g.fillRect(rr() * w, rr() * h, 2 + rr() * 3, 1 + rr() * 2); }
      g.fillStyle = 'rgba(0,0,0,0.05)';
      if (style) for (var by = 0; by < h; by += 8) g.fillRect(0, by, w, 1);
      else for (var px = 0; px < w; px += C / 2) g.fillRect(px, 0, 1, h);
    }
    if (mode === 'bump') { g.fillStyle = '#6c6c6c'; if (style) for (var by2 = 0; by2 < h; by2 += 8) g.fillRect(0, by2, w, 1); else for (var px2 = 0; px2 < w; px2 += C / 2) g.fillRect(px2, 0, 2, h); }
    function rect(x, y, ww, hh, col) { g.fillStyle = col; g.fillRect(x, y, ww, hh); }
    function win(x, y, ww, hh, seed, mull) {
      var q = rnd(seed), lit = q(), blind = q(), tone = q(), warm = q();
      var fr = style ? 4 : 3;
      if (mode === 'color') {
        rect(x - fr, y - fr, ww + fr * 2, hh + fr * 2, style ? '#f1efe9' : '#3b4048');
        var gg = g.createLinearGradient(0, y, 0, y + hh); gg.addColorStop(0, tone < 0.5 ? '#8ea3b8' : '#7d93aa'); gg.addColorStop(1, tone < 0.5 ? '#5f7388' : '#52677d');
        g.fillStyle = gg; g.fillRect(x, y, ww, hh);
        g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(x, y + hh); g.lineTo(x + ww * 0.45, y); g.lineTo(x + ww * 0.62, y); g.lineTo(x + ww * 0.17, y + hh); g.fill();   // 유리 비침
        if (blind < 0.45) rect(x, y, ww, hh * (0.2 + blind), style ? 'rgba(244,238,226,0.9)' : 'rgba(226,230,234,0.85)');   // 블라인드·커튼
        if (lit < 0.1) rect(x, y, ww, hh, 'rgba(255,226,160,0.5)');
        for (var m = 1; m < mull; m++) rect(x + ww * m / mull - 1, y, 2, hh, style ? '#f1efe9' : '#3b4048');
        if (style) { rect(x, y + hh * 0.55, ww, 2, '#f1efe9'); rect(x - fr - 2, y + hh + fr, ww + fr * 2 + 4, 5, '#dcd8ce'); rect(x - fr, y + hh + fr + 5, ww + fr * 2, 14, 'rgba(0,0,0,0.07)'); }
      } else if (mode === 'pbr') {
        rect(x - fr, y - fr, ww + fr * 2, hh + fr * 2, style ? 'rgb(0,150,0)' : 'rgb(0,90,160)');
        rect(x, y, ww, hh, 'rgb(0,14,255)');
        if (blind < 0.45) rect(x, y, ww, hh * (0.2 + blind), 'rgb(0,70,150)');
        for (var m2 = 1; m2 < mull; m2++) rect(x + ww * m2 / mull - 1, y, 2, hh, 'rgb(0,120,120)');
        if (style) rect(x - fr - 2, y + hh + fr, ww + fr * 2 + 4, 5, 'rgb(0,170,0)');
      } else if (mode === 'night') {
        if (lit < 0.4) {
          var col = warm < 0.7 ? '#ffd58a' : warm < 0.9 ? '#fff0c8' : '#bfd8ff';
          rect(x, y, ww, hh, col);
          if (blind < 0.45) rect(x, y, ww, hh * (0.2 + blind), 'rgba(0,0,0,0.35)');
          rect(x, y + hh * 0.7, ww, hh * 0.3, 'rgba(0,0,0,0.18)');   // 방 안 가구 그림자
          for (var m3 = 1; m3 < mull; m3++) rect(x + ww * m3 / mull - 1, y, 2, hh, '#000000');
        }
      } else {
        rect(x - fr, y - fr, ww + fr * 2, hh + fr * 2, '#c4c4c4'); rect(x, y, ww, hh, '#3c3c3c');
        for (var m4 = 1; m4 < mull; m4++) rect(x + ww * m4 / mull - 1, y, 2, hh, '#b0b0b0');
        if (style) rect(x - fr - 2, y + hh + fr, ww + fr * 2 + 4, 5, '#e6e6e6');
      }
    }
    for (var fy = 0; fy < 4; fy++) for (var fx = 0; fx < 4; fx++) {
      var x0 = fx * C, y0 = fy * C, sd = 1000 + style * 500 + fy * 17 + fx * 5;
      if (style) {
        win(x0 + C * 0.1, y0 + C * 0.2, C * 0.32, C * 0.52, sd, 2); win(x0 + C * 0.58, y0 + C * 0.2, C * 0.32, C * 0.52, sd + 91, 2);
        if (rnd(sd + 7)() < 0.4) {   // 창 아래 실외기
          var ax = x0 + C * 0.16, ay = y0 + C * 0.8;
          if (mode === 'color') { rect(ax, ay, C * 0.2, C * 0.13, '#c9ccd0'); rect(ax + 3, ay + 3, C * 0.2 - 6, C * 0.13 - 6, '#8d9298'); }
          else if (mode === 'pbr') rect(ax, ay, C * 0.2, C * 0.13, 'rgb(0,110,190)');
          else if (mode === 'bump') rect(ax, ay, C * 0.2, C * 0.13, '#d8d8d8');
        }
      } else win(x0 + C * 0.07, y0 + C * 0.16, C * 0.86, C * 0.58, sd, 4);
      if (mode === 'color') { rect(x0, y0, C, 2, 'rgba(0,0,0,0.16)'); rect(x0, y0 + 2, C, 3, 'rgba(255,255,255,0.3)'); }   // 층 사이 띠
      else if (mode === 'bump') rect(x0, y0, C, 5, '#b8b8b8');
    }
  }
  function facadeMap(style, mode) {
    var t = canvasTex(512, 512, function (g, w, h) { drawFacade(g, w, h, style, mode); }, [1, 1]);
    if (mode !== 'color' && mode !== 'night') t.encoding = T.LinearEncoding;
    return t;
  }
  var FACADE_TEX = [0, 1].map(function (st) { return { color: facadeMap(st, 'color'), pbr: facadeMap(st, 'pbr'), night: facadeMap(st, 'night'), bump: facadeMap(st, 'bump') }; });
  var FACADE_COLORS = [0xf3e2c7, 0xe9a48f, 0x9fd3c7, 0xf2c879, 0xe3c2b0, 0xb9d6e8];   // 따뜻한 파스텔 (크림·산호·민트·겨자·살구·하늘)
  function bldGeo(bd, bh, bw) {   // 한 변 1짜리 상자 + 건물 크기에 맞춘 UV (가로는 3m마다 한 칸, 세로는 3.2m마다 한 층)
    var gq = unitBox.clone(), uv = gq.attributes.uv; gq.userData = {};
    for (var i = 0; i < uv.count; i++) {
      var face = Math.floor(i / 4);
      if (face === 2 || face === 3) { uv.setXY(i, 0.004, 0.004); continue; }   // 지붕·바닥은 벽 색만
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round((face < 2 ? bw : bd) / 3)) / 4, uv.getY(i) * Math.max(1, Math.round(bh / 3.2)) / 4);
    }
    uv.needsUpdate = true; return gq;
  }
  Object.assign(M, {
    pano: new T.MeshBasicMaterial({ side: T.BackSide, fog: false, depthWrite: false }),   // 깊이를 쓰지 않아 원통 너머의 큰 산·숲이 그 위에 그려진다   // 그림은 applyOutside()가 상태별로
    lightPool: new T.MeshBasicMaterial({ map: canvasTex(64, 64, function (g) { var gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,214,150,0.55)'); gr.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }), transparent: true, depthWrite: false, opacity: 0 }),
    streetLight: new T.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0x000000, emissiveIntensity: 1.6, roughness: 0.4 }),
    pole: new T.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }),
    grass: new T.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
    pave: new T.MeshStandardMaterial({ map: paveTex, roughness: 0.95 }),
    road: new T.MeshStandardMaterial({ map: roadTex, roughness: 0.9 }),
    trunk: new T.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.95, map: barkTex }),
    leafCore: [0x35522d, 0x3f5c33, 0x2f4a2a, 0x4a6638].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }); }),   // 잎 사이로 보이는 속 그늘
    leafCard: [0x5d8a4e, 0x6f9a55, 0x4f7a44, 0x83a862].map(function (c) { return new T.MeshStandardMaterial({ color: c, map: leafTex, alphaTest: 0.4, side: T.DoubleSide, roughness: 0.85 }); }),
    leaf: [0x5d8a4e, 0x6f9a55, 0x4f7a44, 0x83a862].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }); }),
    facade: [0, 1].reduce(function (acc, st) { return acc.concat(FACADE_COLORS.map(function (c) { var m = new T.MeshStandardMaterial({ map: FACADE_TEX[st].color, color: c, roughness: 1, metalness: 1, roughnessMap: FACADE_TEX[st].pbr, metalnessMap: FACADE_TEX[st].pbr, bumpMap: FACADE_TEX[st].bump, bumpScale: 0.06 }); m.userData.style = st; return m; })); }, []),
    shopGlass: new T.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.1, metalness: 0.5, emissive: 0x000000, emissiveIntensity: 0.9 }),
    parapet: new T.MeshStandardMaterial({ color: 0xcdbfae, roughness: 0.8 }),
    awning: [0xd85c4a, 0x3d8f8a, 0xf0b93c, 0xf4efe6].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.8 }); }),
    glassPane: new T.MeshStandardMaterial({ color: 0xdfeaf2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false })
  });
  var poolGeo = new T.PlaneGeometry(7, 7); poolGeo.userData.shared = true;
  var trunkGeo = new T.CylinderGeometry(0.12, 0.18, 2.6, 8), crownGeo = new T.IcosahedronGeometry(1.6, 1), unitBox = new T.BoxGeometry(1, 1, 1);
  [trunkGeo, crownGeo, unitBox].forEach(function (gq) { gq.userData.shared = true; });
  // ── 실제 나무 느낌: 나무껍질 줄기 + 갈라진 가지, 잎사귀 뭉치 카드(투명 그림)를 수관에 겹겹이, 침엽수는 층층이 처진 가지 ──
  function mergeGeos(list) {   // [[geometry, Matrix4]…] → 하나로 (위치·법선·UV·색인)
    var pos = [], nor = [], uv = [], idx = [], base = 0, v = new T.Vector3(), nm = new T.Matrix3();
    list.forEach(function (it) {
      var g = it[0], m = it[1], p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, ix = g.index;
      nm.getNormalMatrix(m);
      for (var i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
        uv.push(u.getX(i), u.getY(i));
      }
      if (ix) for (var k = 0; k < ix.count; k++) idx.push(base + ix.getX(k)); else for (var k2 = 0; k2 < p.count; k2++) idx.push(base + k2);
      base += p.count; g.dispose();
    });
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); out.setIndex(idx); out.userData.shared = true;
    return out;
  }
  function xf(px, py, pz, rx, ry, rz, sc) { return new T.Matrix4().compose(new T.Vector3(px, py, pz), new T.Quaternion().setFromEuler(new T.Euler(rx || 0, ry || 0, rz || 0)), new T.Vector3(sc || 1, sc || 1, sc || 1)); }
  var barkTex = canvasTex(128, 256, function (g, w, h) {   // 세로로 갈라진 나무껍질
    var r = rnd(113); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 260; i++) { g.strokeStyle = 'rgba(0,0,0,' + (0.12 + r() * 0.3) + ')'; g.lineWidth = 1 + r() * 2.5; var x = r() * w, y = r() * h, l = 14 + r() * 50;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 6, y + l * 0.3, x + (r() - 0.5) * 6, y + l * 0.7, x + (r() - 0.5) * 4, y + l); g.stroke(); }
    for (var k = 0; k < 500; k++) { g.fillStyle = 'rgba(255,255,255,' + r() * 0.12 + ')'; g.fillRect(r() * w, r() * h, 1.5, 2 + r() * 5); }
  }, [2, 1]);
  var leafTex = canvasTex(256, 256, function (g, w, h) {   // 잎사귀 뭉치 (밝기만 - 색은 계절 재질이 입힌다)
    var r = rnd(127); g.clearRect(0, 0, w, h);
    for (var i = 0; i < 105; i++) {
      var d = Math.sqrt(r()) * w * 0.43, a = r() * Math.PI * 2, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, l = 22 + r() * 18, t = 150 + Math.floor(r() * 105);
      g.save(); g.translate(x, y); g.rotate(r() * Math.PI * 2);
      g.fillStyle = 'rgb(' + t + ',' + t + ',' + t + ')';
      g.beginPath(); g.moveTo(0, -l / 2); g.quadraticCurveTo(l * 0.36, 0, 0, l / 2); g.quadraticCurveTo(-l * 0.36, 0, 0, -l / 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -l / 2); g.lineTo(0, l / 2); g.stroke();
      g.restore();
    }
  });
  var needleTex = canvasTex(128, 128, function (g, w, h) {   // 침엽수 잎결 (아래로 처진 바늘잎)
    var r = rnd(131); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 900; i++) { var t = r(); g.strokeStyle = t < 0.5 ? 'rgba(0,0,0,' + (0.1 + r() * 0.3) + ')' : 'rgba(255,255,255,' + (0.1 + r() * 0.3) + ')'; g.lineWidth = 1;
      var x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 5, y + 5 + r() * 12); g.stroke(); }
  }, [6, 2]);
  var treeTrunkGeo = (function () {   // 굵은 밑동에서 가늘어지는 줄기 + 수관 속으로 뻗는 가지 넷
    var parts = [[new T.CylinderGeometry(0.11, 0.21, 3.0, 9, 3), xf(0, 1.5, 0)], [new T.CylinderGeometry(0.2, 0.3, 0.25, 9), xf(0, 0.1, 0)]];
    [[0.5, 0.7, 0.0], [-0.55, 0.6, 2.1], [0.45, -0.65, 4.2], [-0.3, -0.5, 1.0]].forEach(function (b, i) {
      var len = 1.5 + i * 0.12; parts.push([new T.CylinderGeometry(0.035, 0.085, len, 6), xf(Math.sin(b[2]) * 0.38, 2.75 + i * 0.12, Math.cos(b[2]) * 0.38, b[0], b[2], b[1])]);
    });
    return mergeGeos(parts);
  })();
  var pineTreeGeo = (function () {   // 여섯 층: 끝이 들쭉날쭉하고 아래로 처진 가지 치마
    var parts = [];
    for (var k = 0; k < 6; k++) {
      var rad = 1.55 - k * 0.24, hgt = 1.5 - k * 0.08, gq = new T.ConeGeometry(rad, hgt, 16, 2, true), p = gq.attributes.position;
      for (var i = 0; i < p.count; i++) {
        var y = p.getY(i), x = p.getX(i), z = p.getZ(i), rr = Math.hypot(x, z);
        if (y < -hgt / 2 + 0.01 && rr > 0.01) { var a = Math.atan2(z, x), j = (Math.round(a / (Math.PI * 2) * 16) % 2) ? 1.0 : 0.72; p.setXYZ(i, x * j, y - (j > 0.9 ? 0.22 : 0), z * j); }
        else if (rr > 0.01 && y < hgt / 2 - 0.01) p.setXYZ(i, x * 1.12, y, z * 1.12);   // 가운데 고리를 살짝 부풀림
      }
      gq.computeVertexNormals();
      parts.push([gq, xf(0, 1.6 + k * 0.82 + hgt / 2, 0, 0, k * 0.7, 0)]);
    }
    return mergeGeos(parts);
  })();
  var pineTrunkGeo = new T.CylinderGeometry(0.1, 0.2, 2.4, 8); pineTrunkGeo.translate(0, 1.2, 0); pineTrunkGeo.userData.shared = true;
  var leafCardGeo = new T.PlaneGeometry(1, 1); leafCardGeo.userData.shared = true;
  M.trunk.map = barkTex; M.leafCard.forEach(function (m) { m.map = leafTex; });   // 그림은 재질보다 뒤에 만들어지므로 여기서 잇는다
  function leafCards(list, mat) {   // [x, y, z, 크기, 회전 셋] 여러 장을 InstancedMesh 하나로
    if (!list.length) return;
    var im = new T.InstancedMesh(leafCardGeo, mat, list.length), m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
    list.forEach(function (c, i) { e.set(c[4], c[5], c[6]); q.setFromEuler(e); m4.compose(v.set(c[0], c[1], c[2]), q, sc.set(c[3], c[3], 1)); im.setMatrixAt(i, m4); });
    im.frustumCulled = false; parent.add(im);
  }
  // ── 창밖 풍경 상태: 시간(낮·노을·밤) × 계절(봄·여름·가을·겨울) × 날씨(맑음·흐림·비·눈), 각각 자동 가능 ──
  var OUTSIDE = { time: 'auto', season: 'auto', weather: 'clear' };   // 설정값 (lib3d.json outside)
  var OUT = null;                                                       // 지금 적용된 실제 값
  function resolveOutside() {
    var now = new Date(), hr = now.getHours() + now.getMinutes() / 60, mo = now.getMonth() + 1;
    var time = OUTSIDE.time !== 'auto' ? OUTSIDE.time : (hr >= 6.5 && hr < 17 ? 'day' : hr >= 17 && hr < 19 ? 'dusk' : 'night');
    var season = OUTSIDE.season !== 'auto' ? OUTSIDE.season : (mo >= 3 && mo <= 5 ? 'spring' : mo >= 6 && mo <= 8 ? 'summer' : mo >= 9 && mo <= 11 ? 'autumn' : 'winter');
    var weather = OUTSIDE.weather;
    if (weather === 'auto') {   // 날마다 바뀌는 날씨 (겨울은 눈, 여름은 비가 잦게)
      var d = Math.floor(now.getTime() / 86400000), x = ((d * 9301 + 49297) % 233280) / 233280;
      weather = x < 0.55 ? 'clear' : x < 0.75 ? 'cloudy' : season === 'winter' ? 'snow' : 'rain';
    }
    return { time: time, season: season, weather: weather };
  }
  var SEASON_LEAF = {
    spring: [0xf2b8c6, 0xf6c9d4, 0xe9a3b8, 0xffdbe4], summer: [0x5d8a4e, 0x6f9a55, 0x4f7a44, 0x83a862],
    autumn: [0xd9822b, 0xc8562a, 0xe0a43a, 0xb84a2a], winter: [0xe9edf1, 0xdfe5ea, 0xf3f5f7, 0xd5dce2]
  };
  var panoCache = {};
  function makePano(o) {   // 먼 경치 그림 (상태별로 한 번만 그려 둔다)
    var key = o.time + o.season + o.weather;
    if (panoCache[key]) return panoCache[key];
    var night = o.time === 'night', dusk = o.time === 'dusk', grey = o.weather !== 'clear', winter = o.season === 'winter';
    var t = canvasTex(4096, 1024, function (g, w, h) {
      var r = rnd(23), hz = h * 0.7;
      var sky = g.createLinearGradient(0, 0, 0, hz);
      if (night) { sky.addColorStop(0, grey ? '#121722' : '#0b1430'); sky.addColorStop(0.6, grey ? '#1d2330' : '#1a2a52'); sky.addColorStop(1, grey ? '#2a303c' : '#34466e'); }
      else if (dusk) { sky.addColorStop(0, grey ? '#5c5a66' : '#3d4f86'); sky.addColorStop(0.5, grey ? '#8a7d7c' : '#d9877a'); sky.addColorStop(1, grey ? '#b19a88' : '#f4c27c'); }
      else if (grey) { sky.addColorStop(0, o.weather === 'cloudy' ? '#9aa5b0' : '#7f8994'); sky.addColorStop(1, '#c9cfd4'); }
      else { sky.addColorStop(0, '#7fb2e3'); sky.addColorStop(0.55, '#b9d7f0'); sky.addColorStop(1, '#eef4f6'); }
      g.fillStyle = sky; g.fillRect(0, 0, w, hz);
      if (night && !grey) {   // 별·달
        for (var s = 0; s < 700; s++) { g.fillStyle = 'rgba(255,255,255,' + (0.3 + r() * 0.7) + ')'; var sz = r() < 0.08 ? 2.4 : 1.3; g.fillRect(r() * w, r() * hz * 0.85, sz, sz); }
        var mx = w * 0.62, my = hz * 0.28, mg = g.createRadialGradient(mx, my, 10, mx, my, 160);
        mg.addColorStop(0, 'rgba(220,230,255,0.45)'); mg.addColorStop(1, 'rgba(220,230,255,0)');
        g.fillStyle = mg; g.fillRect(mx - 160, my - 160, 320, 320);
        g.fillStyle = '#f4f1e2'; g.beginPath(); g.arc(mx, my, 26, 0, Math.PI * 2); g.fill();
      } else if (!night && !grey) {   // 해 (노을이면 지평선 가까이 크게)
        var sx = w * 0.32, sy = dusk ? hz * 0.82 : hz * 0.35, rad = dusk ? 420 : 260, glow = g.createRadialGradient(sx, sy, 4, sx, sy, rad);
        glow.addColorStop(0, dusk ? 'rgba(255,214,150,1)' : 'rgba(255,250,232,0.95)'); glow.addColorStop(1, 'rgba(255,214,150,0)');
        g.fillStyle = glow; g.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
      }
      var clouds = grey ? 160 : 46;
      for (var c = 0; c < clouds; c++) {   // 구름
        var cx = r() * w, cy = hz * (0.05 + r() * (grey ? 0.75 : 0.55)), cw = 90 + r() * (grey ? 420 : 260);
        for (var k = 0; k < 7; k++) {
          var a = (grey ? 0.25 : 0.18) + r() * 0.3;
          g.fillStyle = night ? 'rgba(70,78,98,' + a + ')' : dusk ? 'rgba(255,200,180,' + a + ')' : grey ? 'rgba(' + (o.weather === 'cloudy' ? 222 : 170) + ',' + (o.weather === 'cloudy' ? 226 : 176) + ',' + (o.weather === 'cloudy' ? 232 : 186) + ',' + a + ')' : 'rgba(255,255,255,' + a + ')';
          g.beginPath(); g.ellipse(cx + (r() - 0.5) * cw, cy + (r() - 0.5) * 18, cw * (0.25 + r() * 0.3), 12 + r() * 16, 0, 0, Math.PI * 2); g.fill();
        }
      }
      function ridge(base, amp, col, step, cap) {
        var pts = [], y = base;
        for (var x = 0; x <= w; x += step) { y += (r() - 0.5) * amp; y = Math.max(base - amp * 3, Math.min(base + amp, y)); pts.push([x, y]); }
        g.fillStyle = col; g.beginPath(); g.moveTo(0, hz); pts.forEach(function (p) { g.lineTo(p[0], p[1]); }); g.lineTo(w, hz); g.closePath(); g.fill();
        if (cap) {   // 눈 덮인 산마루
          g.strokeStyle = cap; g.lineWidth = 10; g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1] + 4); else g.moveTo(p[0], p[1] + 4); }); g.stroke();
        }
      }
      var dim = night ? 0.35 : dusk ? 0.75 : grey ? 0.85 : 1;
      function shade(hex, f) { var cc = new T.Color(hex); cc.multiplyScalar(f || dim); return '#' + cc.getHexString(); }
      ridge(hz - 120, 26, shade('#a9bccb'), 40, winter ? shade('#f2f5f8') : null);
      ridge(hz - 70, 22, shade('#8fa7b6'), 30, winter ? shade('#e8eef3') : null);
      for (var b = 0; b < 260; b++) {   // 먼 도시
        var bx = r() * w, bw = 14 + r() * 46, bh = 18 + Math.pow(r(), 2.2) * 150;
        g.fillStyle = shade('#' + new T.Color((120 + Math.floor(r() * 30)) / 255, (138 + Math.floor(r() * 25)) / 255, (155 + Math.floor(r() * 25)) / 255).getHexString());
        g.fillRect(bx, hz - bh, bw, bh);
        for (var wy = hz - bh + 5; wy < hz - 6; wy += 9) for (var wx = bx + 3; wx < bx + bw - 4; wx += 7) {
          var on = r();
          if (night || dusk) { if (on < (night ? 0.45 : 0.2)) { g.fillStyle = r() < 0.8 ? '#ffd98a' : '#cfe3ff'; g.fillRect(wx, wy, 3, 4); } }
          else if (on < 0.5) { g.fillStyle = 'rgba(235,242,248,0.35)'; g.fillRect(wx, wy, 3, 4); }
        }
      }
      var leaf = SEASON_LEAF[o.season];
      for (var tt = 0; tt < 900; tt++) {   // 가까운 나무 줄
        var tx = r() * w, tr = 10 + r() * 22;
        g.fillStyle = shade('#' + new T.Color(leaf[Math.floor(r() * 4)]).getHexString(), dim * 0.9);
        g.beginPath(); g.arc(tx, hz - tr * 0.4, tr, 0, Math.PI * 2); g.fill();
      }
      var ground = g.createLinearGradient(0, hz, 0, h);
      var gc = winter ? '#e9eef2' : o.season === 'autumn' ? '#9c9364' : '#7f9a6c';
      ground.addColorStop(0, shade(gc)); ground.addColorStop(1, shade(gc, dim * 0.88));
      g.fillStyle = ground; g.fillRect(0, hz, w, h - hz);
    });
    t.wrapS = T.RepeatWrapping;
    panoCache[key] = t;
    return t;
  }
  // 비·눈 입자 (건물 바깥 양옆에만, 층마다 새로 만든다)
  var weatherFx = null;
  function addWeather(w, back, front, gy) {
    var N = 4000, pos = new Float32Array(N * 6), sp = new Float32Array(N), r = rnd(71);
    var box = { x0: w / 2 + 0.4, x1: w / 2 + 26, z0: back - 30, z1: front + 30, y0: gy, y1: CEIL + 14 };
    for (var i = 0; i < N; i++) {
      var side = i % 2 ? 1 : -1, x = side * (box.x0 + r() * (box.x1 - box.x0)), y = box.y0 + r() * (box.y1 - box.y0), z = box.z0 + r() * (box.z1 - box.z0);
      pos[i * 6] = pos[i * 6 + 3] = x; pos[i * 6 + 1] = y; pos[i * 6 + 4] = y - 0.35; pos[i * 6 + 2] = pos[i * 6 + 5] = z; sp[i] = 0.7 + r() * 0.6;
    }
    var rainGeo = new T.BufferGeometry(); rainGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    var rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: 0xdfe8f2, transparent: true, opacity: 0.75 }));
    var sp2 = new Float32Array(N * 3); for (i = 0; i < N; i++) { sp2[i * 3] = pos[i * 6]; sp2[i * 3 + 1] = pos[i * 6 + 1]; sp2[i * 3 + 2] = pos[i * 6 + 2]; }
    var snowGeo = new T.BufferGeometry(); snowGeo.setAttribute('position', new T.BufferAttribute(sp2, 3));
    var snow = new T.Points(snowGeo, new T.PointsMaterial({ color: 0xffffff, size: 0.22, map: flakeTex, transparent: true, alphaTest: 0.2, depthWrite: false }));
    [rain, snow].forEach(function (m) { m.frustumCulled = false; m.visible = false; parent.add(m); });
    weatherFx = { rain: rain, snow: snow, sp: sp, box: box, N: N };
  }
  var flakeTex = canvasTex(32, 32, function (g, w, h) {
    var gr = g.createRadialGradient(16, 16, 1, 16, 16, 15); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  function updateWeather(dt, now) {
    if (!weatherFx || !OUT) return;
    var f = weatherFx, b = f.box, H = b.y1 - b.y0;
    if (OUT.weather === 'rain' && f.rain.visible) {
      var a = f.rain.geometry.attributes.position.array;
      for (var i = 0; i < f.N; i++) {
        var o = i * 6, y = a[o + 1] - dt * 16 * f.sp[i];
        if (y < b.y0) y += H;
        a[o + 1] = y; a[o + 4] = y - 0.35;
      }
      f.rain.geometry.attributes.position.needsUpdate = true;
    } else if (OUT.weather === 'snow' && f.snow.visible) {
      var s = f.snow.geometry.attributes.position.array, t = now / 1000;
      for (var j = 0; j < f.N; j++) {
        var q = j * 3, yy = s[q + 1] - dt * 1.1 * f.sp[j];
        if (yy < b.y0) yy += H;
        s[q + 1] = yy; s[q + 2] += Math.sin(t * 0.8 + j) * dt * 0.25;
      }
      f.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
  var streetLamps = [];
  // 상태를 장면에 입힌다 (층을 다시 짓지 않고 재질·빛·입자만 바꾼다)
  function applyOutside() {
    var o = resolveOutside();
    if (OUT && OUT.time === o.time && OUT.season === o.season && OUT.weather === o.weather && !applyOutside.force) return;
    applyOutside.force = false;
    OUT = o;
    var night = o.time === 'night', dusk = o.time === 'dusk', grey = o.weather !== 'clear', winter = o.season === 'winter';
    M.pano.map = makePano(o); M.pano.needsUpdate = true;
    // 바깥 물체는 실내 조명을 같이 받으므로 시간·날씨만큼 색을 어둡게 한다 (밤에는 켜진 창·가로등만 밝게)
    var f = night ? 0.13 : dusk ? 0.7 : grey ? 0.8 : 1;
    function tint(m, hex) { m.color.setHex(hex).multiplyScalar(f); }
    var lc = SEASON_LEAF[o.season]; M.leaf.forEach(function (m, i) { tint(m, lc[i]); }); M.leafCard.forEach(function (m, i) { tint(m, lc[i]); m.color.multiplyScalar(1.12); }); M.leafCore.forEach(function (m, i) { tint(m, lc[i]); m.color.multiplyScalar(0.5); });
    tint(M.grass, winter ? 0xf4f7fa : o.season === 'autumn' ? 0xd8c690 : 0xffffff);
    M.grass.map = winter ? null : grassTex; M.grass.needsUpdate = true;
    var wet = o.weather === 'rain';
    M.road.roughness = wet ? 0.25 : 0.9; tint(M.road, wet ? 0x8a8f96 : winter ? 0xe4e8ec : 0xffffff);
    M.pave.roughness = wet ? 0.35 : 0.95; tint(M.pave, winter ? 0xf2f4f6 : wet ? 0xb7b4ae : 0xffffff);
    tint(M.trunk, winter ? 0x5a4a3e : 0x6b4f3a); tint(M.pole, 0x3a3d42);
    var FC = FACADE_COLORS;
    M.facade.forEach(function (m, i) {
      tint(m, FC[i % FC.length]);
      m.emissiveMap = (night || dusk) ? FACADE_TEX[m.userData.style].night : null; m.emissive.setHex((night || dusk) ? 0xffffff : 0x000000);
      m.emissiveIntensity = night ? 1 : 0.5; m.needsUpdate = true;
    });
    M.streetLight.emissive.setHex(night || dusk || grey ? 0xffe2a8 : 0x000000);
    M.lightPool.opacity = night ? 1 : dusk ? 0.5 : 0;
    // 바깥 재질은 실내 반사광을 시간에 맞춰 줄인다 (밤에 실내 빛이 바깥 유리·벽에 비치지 않게)
    var envOut = night ? 0.02 : dusk ? 0.12 : 0.25;
    [].concat(M.leaf, M.leafCard, M.leafCore, M.facade, M.awning, CAR.paint, [M.grass, M.pave, M.road, M.trunk, M.pole, M.shopGlass, M.parapet, CAR.glass, CAR.tire])
      .forEach(function (m) { m.envMapIntensity = envOut; m.userData.envSet = true; });
    M.shopGlass.emissive.setHex(night ? 0x1c1208 : dusk ? 0x120c05 : 0x000000);   // 빛 세기는 선형값이라 아주 어둡게 줘야 은은하다
    CAR.head.emissive.setHex(night || dusk || grey ? 0xfff6dd : 0x000000); CAR.tail.emissive.setHex(night || dusk || grey ? 0xff2a1a : 0x000000);
    tint(M.parapet, 0xcdbfae); M.awning.forEach(function (m, i) { tint(m, [0xd85c4a, 0x3d8f8a, 0xf0b93c, 0xf4efe6][i]); });
    CAR.paint.forEach(function (m, i) { tint(m, [0xe8e6e1, 0x1f2328, 0x8b1e2b, 0x2c4a7a, 0x9aa2a8, 0x3d5a45, 0xd9c79c][i]); });
    // 빛: 낮은 지금 그대로, 노을은 따뜻하게 낮게, 밤은 달빛 + 실내 조명
    var bg = night ? 0x1a2030 : dusk ? 0xe9cdb5 : grey ? 0xd9dcde : 0xf3efe8;
    scene.background.setHex(bg); scene.fog.color.setHex(bg);
    scene.fog.near = night ? 70 : 40; scene.fog.far = night ? 170 : 120;
    sun.color.setHex(night ? 0x9fb4e0 : dusk ? 0xffb27a : 0xfff4e2);
    sun.intensity = night ? 0.18 : dusk ? 0.6 : grey ? 0.45 : 0.85;
    if (hemi) { hemi.intensity = (night ? 0.5 : grey ? 0.7 : 0.6) * (scene.environment ? 0.5 : 1); hemi.color.setHex(night ? 0xfff1dc : 0xffffff); }
    if (weatherFx) { weatherFx.rain.visible = o.weather === 'rain'; weatherFx.snow.visible = o.weather === 'snow'; }
    M.glassPane.opacity = o.weather === 'rain' ? 0.22 : night ? 0.08 : 0.12;
    tint(EXT.stone, 0xe6e0d4); tint(EXT.metal, 0x2a2e34); tint(EXT.glass, 0x23374a); tint(EXT.soffit, 0xb98a5a); tint(EXT.spine, 0xffffff);
    [EXT.stone, EXT.metal, EXT.glass, EXT.soffit, EXT.spine].forEach(function (m) { m.envMapIntensity = m === EXT.glass ? envOut * 2.4 : envOut; m.userData.envSet = true; });
    extNight(night, dusk);
    campTint(o, f, envOut);
    if (OUT_ENV) {   // 실제 하늘(HDR) 반사: 건물 유리창·서재 외장 유리·차·강물에 하늘과 구름이 비친다
      var sky = night ? 0.07 : dusk ? 0.55 : grey ? 0.6 : 1;
      M.facade.forEach(function (m) { m.envMapIntensity = sky; });
      M.shopGlass.envMapIntensity = sky * 0.9; EXT.glass.envMapIntensity = sky * 1.1; EXT.metal.envMapIntensity = sky * 0.7;
      CAR.paint.forEach(function (m) { m.envMapIntensity = sky * 0.8; }); CAR.glass.envMapIntensity = sky;
      CAMP.water.envMapIntensity = Math.max(0.12, sky * 0.9);
    }
  }
  setInterval(function () { applyOutside(); }, 60000);   // 자동(시간·계절·날씨)이면 1분마다 확인
  // 바깥 건물용 환경 조명: 실제 하늘을 찍은 HDR 그림(three.js 예제의 royal_esplanade_1k.hdr, Poly Haven CC0)을 받아 반사에 쓴다.
  // 못 받으면 예전처럼 실내 환경 조명으로 비친다. 서재 안 재질에는 쓰지 않는다.
  var OUT_ENV = null, OUT_ENV_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/textures/equirectangular/royal_esplanade_1k.hdr';
  function loadOutEnv() {
    if (!T.RGBELoader) return;
    new T.RGBELoader().setDataType(T.UnsignedByteType).load(OUT_ENV_URL, function (tex) {
      try {
        var pm = new T.PMREMGenerator(renderer); OUT_ENV = pm.fromEquirectangular(tex).texture; tex.dispose(); pm.dispose();
        [].concat(M.facade, CAR.paint, [M.shopGlass, M.parapet, EXT.glass, EXT.metal, EXT.stone, CAR.glass, CAMP.water]).forEach(function (m) { m.envMap = OUT_ENV; m.needsUpdate = true; });
        applyOutside.force = true; applyOutside();
      } catch (e) { console.warn('3D 서재 바깥 환경 조명:', e && e.message); }
    }, undefined, function (e) { console.warn('3D 서재 바깥 환경 조명:', e && e.message); });
  }


  // 창 구멍이 난 옆벽: 창 아래·위 띠 + 창 사이 기둥
  function sideWall(x, z0, z1, wins) {
    var len = z1 - z0, cz0 = (z0 + z1) / 2;
    add(new T.Mesh(new T.BoxGeometry(0.2, 0.5, len), M.wall), x, 0.25, cz0).receiveShadow = true;
    add(new T.Mesh(new T.BoxGeometry(0.2, CEIL - 4.1, len), M.wall), x, (CEIL + 4.1) / 2, cz0).receiveShadow = true;
    var edges = [z0];
    wins.slice().sort(function (a, b) { return a - b; }).forEach(function (wz) { edges.push(wz - 2.7, wz + 2.7); });
    edges.push(z1);
    for (var i = 0; i < edges.length; i += 2) {
      var a = edges[i], b = edges[i + 1];
      if (b - a > 0.01) add(new T.Mesh(new T.BoxGeometry(0.2, 3.6, b - a), M.wall), x, 2.3, (a + b) / 2).receiveShadow = true;
    }
  }
  // 바깥: 층이 높을수록 땅이 내려간다(위층에서 내려다보는 경치)
  // ── 가구 (모서리를 둥글린 상자로 만든 소파·의자·탁자·스탠드, 잎이 여러 겹인 화분) ──
  function rbox(w, h, d, r) {   // 둥근 모서리 상자 (없으면 보통 상자)
    return T.RoundedBoxGeometry ? new T.RoundedBoxGeometry(w, h, d, 3, Math.min(r || 0.04, w / 2, h / 2, d / 2)) : new T.BoxGeometry(w, h, d);
  }
  var fabricTex = canvasTex(128, 128, function (g, w, h) {   // 직물 결
    var r = rnd(61); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 1800; i++) { g.fillStyle = 'rgba(0,0,0,' + r() * 0.07 + ')'; g.fillRect(r() * w, r() * h, 1, 1 + r() * 2); }
    for (var y = 0; y < h; y += 2) { g.fillStyle = 'rgba(0,0,0,0.025)'; g.fillRect(0, y, w, 1); }
  }, [3, 3]);
  var rugTex = canvasTex(512, 512, function (g, w, h) {   // 러그 (테두리 + 잔무늬)
    var r = rnd(67); g.fillStyle = '#b9a58a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6f5a44'; g.lineWidth = 14; g.strokeRect(22, 22, w - 44, h - 44);
    g.strokeStyle = '#e8dcc6'; g.lineWidth = 4; g.strokeRect(44, 44, w - 88, h - 88);
    for (var i = 0; i < 9000; i++) { g.fillStyle = 'rgba(' + (r() < 0.5 ? '70,55,40' : '240,230,210') + ',' + r() * 0.12 + ')'; g.fillRect(r() * w, r() * h, 2, 2); }
    g.strokeStyle = 'rgba(111,90,68,0.35)'; g.lineWidth = 3;
    for (var k = 0; k < 6; k++) { g.beginPath(); g.ellipse(w / 2, h / 2, 60 + k * 26, 40 + k * 18, 0, 0, Math.PI * 2); g.stroke(); }
  });
  var FURN = {
    sofa: [0x5b6b5e, 0x8a6f5a, 0x3f4a5a, 0xb9ab97].map(function (c) { return new T.MeshStandardMaterial({ color: c, map: fabricTex, roughness: 0.95 }); }),
    leather: new T.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.45, metalness: 0.05 }),
    seam: new T.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 }),
    ceramic: new T.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.35 }),
    bulb: new T.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 1.2 }),
    rug: new T.MeshStandardMaterial({ map: rugTex, roughness: 1 }),
    walnut: new T.MeshStandardMaterial({ map: oakTex, color: 0x8a6a50, roughness: 0.45 }),
    brass: new T.MeshStandardMaterial({ color: 0xb8924a, roughness: 0.3, metalness: 0.9 }),
    shadeOn: new T.MeshStandardMaterial({ color: 0xf6ead2, emissive: 0xffdca0, emissiveIntensity: 0.55, roughness: 0.9, side: T.DoubleSide }),
    soil: new T.MeshStandardMaterial({ color: 0x3b2c22, roughness: 1 }),
    leaves: [0x3f6b3a, 0x4f7d44, 0x5f8f4e, 0x355c33].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.7, side: T.DoubleSide }); })
  };
  Object.keys(FURN).forEach(function (k) { [].concat(FURN[k]).forEach(function (m) { m.userData.keep = true; }); });   // 층을 바꿔도 지우지 않음
  function part(g, geo, mat, x, y, z, rx, ry, rz) {
    var m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function sofa(x, z, ry, seats, mat) {   // 소파 (seats=1이면 안락의자)
    var g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    var W = 0.78 * seats + 0.36;
    part(g, rbox(W, 0.22, 0.9, 0.05), mat, 0, 0.21, 0);                                          // 받침
    for (var i = 0; i < seats; i++) part(g, rbox(0.76, 0.16, 0.72, 0.06), mat, (i - (seats - 1) / 2) * 0.78, 0.4, 0.06);   // 방석
    part(g, rbox(W, 0.52, 0.2, 0.07), mat, 0, 0.56, -0.36, -0.12);                                // 등받이
    [-1, 1].forEach(function (s) { part(g, rbox(0.18, 0.5, 0.9, 0.07), mat, s * (W / 2 - 0.09), 0.38, 0); });   // 팔걸이
    [-1, 1].forEach(function (s) { [-1, 1].forEach(function (t) {                                   // 다리
      part(g, new T.CylinderGeometry(0.025, 0.018, 0.12, 10), FURN.walnut, s * (W / 2 - 0.08), 0.06, t * 0.36);
    }); });
    if (seats > 1) part(g, rbox(0.42, 0.36, 0.12, 0.05), FURN.sofa[3], -W / 2 + 0.45, 0.62, -0.18, -0.25, 0.2);   // 쿠션
    for (var b = 0; b < seats; b++) part(g, rbox(0.72, 0.4, 0.16, 0.07), mat, (b - (seats - 1) / 2) * 0.78, 0.66, -0.24, -0.2);   // 자리마다 등쿠션
    part(g, rbox(W - 0.04, 0.05, 0.86, 0.02), FURN.walnut, 0, 0.1, 0);                               // 원목 받침 틀
    for (var sb = 1; sb < seats; sb++) part(g, new T.BoxGeometry(0.012, 0.15, 0.7), FURN.seam, (sb - seats / 2) * 0.78, 0.4, 0.06);   // 방석 사이 골
    [-1, 1].forEach(function (s2) { part(g, rbox(0.2, 0.05, 0.92, 0.025), mat, s2 * (W / 2 - 0.09), 0.645, 0); });   // 팔걸이 윗단
    if (seats > 2) {   // 팔걸이에 걸친 담요 + 반대쪽 작은 쿠션
      part(g, rbox(0.22, 0.03, 0.6, 0.012), FURN.sofa[1], W / 2 - 0.09, 0.685, 0.05);
      part(g, rbox(0.03, 0.3, 0.6, 0.012), FURN.sofa[1], W / 2 + 0.012, 0.53, 0.05);
      part(g, rbox(0.36, 0.3, 0.1, 0.05), FURN.leather, W / 2 - 0.5, 0.6, -0.16, -0.3, -0.25);
    }
    return g;
  }
  function coffeeTable(x, z, ry) {
    var g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g);
    part(g, rbox(1.2, 0.05, 0.62, 0.02), FURN.walnut, 0, 0.42, 0);
    part(g, rbox(1.1, 0.03, 0.54, 0.01), FURN.walnut, 0, 0.12, 0);
    [-1, 1].forEach(function (s) { [-1, 1].forEach(function (t) { part(g, new T.CylinderGeometry(0.018, 0.018, 0.4, 8), M.black, s * 0.54, 0.2, t * 0.26); }); });
    var r = rnd(Math.floor(x * 13 + z * 7) + 99);
    for (var i = 0; i < 3; i++) {   // 쌓인 책 + 머그잔
      part(g, new T.BoxGeometry(0.24 + r() * 0.06, 0.035, 0.17), new T.MeshStandardMaterial({ color: PALETTE[Math.floor(r() * PALETTE.length)], roughness: 0.6 }),
        -0.3, 0.465 + i * 0.036, 0, 0, r() * 0.4 - 0.2, 0);
    }
    part(g, new T.CylinderGeometry(0.045, 0.04, 0.1, 16), M.white, 0.32, 0.495, 0.08);
    part(g, new T.CylinderGeometry(0.075, 0.075, 0.008, 20), M.white, 0.32, 0.449, 0.08);                 // 잔 받침
    part(g, new T.TorusGeometry(0.03, 0.008, 6, 12), M.white, 0.372, 0.495, 0.08);                         // 잔 손잡이
    part(g, new T.CylinderGeometry(0.036, 0.036, 0.004, 16), FURN.leather, 0.32, 0.546, 0.08);             // 커피
    part(g, rbox(0.34, 0.02, 0.24, 0.008), M.black, 0.02, 0.455, -0.14);                                   // 쟁반
    part(g, new T.CylinderGeometry(0.035, 0.05, 0.16, 14), FURN.ceramic, 0.0, 0.545, -0.14);               // 꽃병
    for (var f = 0; f < 5; f++) {   // 꽃대와 꽃
      var fa = f * 1.26, fh = 0.16 + r() * 0.1;
      part(g, new T.CylinderGeometry(0.004, 0.004, fh, 5), FURN.leaves[1], Math.cos(fa) * 0.02, 0.625 + fh / 2, -0.14 + Math.sin(fa) * 0.02, Math.sin(fa) * 0.25, 0, -Math.cos(fa) * 0.25);
      part(g, new T.SphereGeometry(0.022, 8, 6), new T.MeshStandardMaterial({ color: [0xe98a9c, 0xf2c14e, 0xf4f1ea, 0xd9668a, 0xf0a45d][f], roughness: 0.7 }), Math.cos(fa) * (0.02 + fh * 0.25), 0.625 + fh, -0.14 + Math.sin(fa) * (0.02 + fh * 0.25));
    }
    part(g, new T.BoxGeometry(0.21, 0.006, 0.28), M.white, 0.1, 0.139, 0.02, 0, 0.3, 0);                   // 아래 선반의 잡지
    part(g, new T.BoxGeometry(0.21, 0.006, 0.28), new T.MeshStandardMaterial({ color: PALETTE[Math.floor(r() * PALETTE.length)], roughness: 0.5 }), 0.1, 0.146, 0.02, 0, 0.1, 0);
    [-1, 1].forEach(function (s3) { part(g, new T.BoxGeometry(1.08, 0.02, 0.02), M.black, 0, 0.385, s3 * 0.26); });   // 상판 아래 보
    return g;
  }
  function floorLamp(x, z) {
    var g = new T.Group(); g.position.set(x, 0, z); parent.add(g);
    part(g, new T.CylinderGeometry(0.17, 0.19, 0.03, 24), M.black, 0, 0.015, 0);
    part(g, new T.CylinderGeometry(0.014, 0.014, 1.55, 8), FURN.brass, 0, 0.79, 0);
    part(g, new T.CylinderGeometry(0.17, 0.25, 0.3, 24, 1, true), FURN.shadeOn, 0, 1.66, 0).castShadow = false;
    part(g, new T.TorusGeometry(0.17, 0.006, 6, 24), FURN.brass, 0, 1.81, 0, Math.PI / 2);                 // 갓 위·아래 테
    part(g, new T.TorusGeometry(0.25, 0.006, 6, 24), FURN.brass, 0, 1.51, 0, Math.PI / 2);
    part(g, new T.SphereGeometry(0.05, 12, 8), FURN.bulb, 0, 1.62, 0).castShadow = false;                  // 전구
    part(g, new T.CylinderGeometry(0.022, 0.022, 0.08, 10), FURN.brass, 0, 1.55, 0);                       // 소켓
    part(g, new T.CylinderGeometry(0.002, 0.002, 0.22, 4), FURN.brass, 0.06, 1.44, 0);                     // 당김줄
    part(g, new T.SphereGeometry(0.01, 6, 5), FURN.brass, 0.06, 1.33, 0);
    part(g, new T.CylinderGeometry(0.03, 0.03, 0.06, 12), FURN.brass, 0, 0.06, 0);                         // 받침 목
    return g;
  }
  function rug(x, z, w, d, ry) {
    var m = new T.Mesh(new T.PlaneGeometry(w, d), FURN.rug); m.rotation.set(-Math.PI / 2, 0, ry || 0); m.receiveShadow = true;
    add(m, x, 0.006, z); return m;
  }
  var leafGeo = (function () {   // 끝이 뾰족한 잎 한 장 (평면을 휘어서)
    var gq = new T.PlaneGeometry(0.16, 0.62, 2, 6), p = gq.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i) + 0.31, t = y / 0.62;
      p.setX(i, p.getX(i) * Math.sin(Math.PI * Math.min(1, t * 1.1)) * 1.1);
      p.setZ(i, -Math.pow(t, 2) * 0.22 + Math.abs(p.getX(i)) * 0.3);
      p.setY(i, y);
    }
    gq.computeVertexNormals(); gq.userData.shared = true; return gq;
  })();
  // ── 3D 모형 파일 (설정 > 3D 모형에서 '모형 파일' 고르면): 소파·의자·화분(Khronos glTF 예제, CC BY 4.0), 자동차(three.js 예제 Ferrari 458) ──
  var REAL_BASE = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/';
  var REAL_FILES = {
    sofa: REAL_BASE + 'GlamVelvetSofa/glTF-Binary/GlamVelvetSofa.glb',
    chair: REAL_BASE + 'ChairDamaskPurplegold/glTF-Binary/ChairDamaskPurplegold.glb',
    plant: REAL_BASE + 'DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb',
    car: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/models/gltf/ferrari.glb'
  };
  var MODELS = 'basic';   // 설정값: basic(지금 그대로) | real(모형 파일)
  var REAL = {}, realLoading = false, carPaints = null;
  function loadReal() {
    if (realLoading || MODELS !== 'real' || !T.GLTFLoader) return;
    realLoading = true;
    var gl = new T.GLTFLoader();
    if (T.DRACOLoader) { var dr = new T.DRACOLoader(); dr.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/'); gl.setDRACOLoader(dr); }
    var left = Object.keys(REAL_FILES).length;
    Object.keys(REAL_FILES).forEach(function (k) {
      gl.load(REAL_FILES[k], function (g) {
        var root = g.scene;
        root.traverse(function (o) {
          if (/firefly|light/i.test(o.name) && k === 'plant') o.visible = false;   // 화분 모형의 반딧불이·조명은 뺀다
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        keepShared(root); REAL[k] = root;
        if (--left === 0) rebuildForModels();
      }, undefined, function (e) { console.warn('3D 서재 모형 파일:', k, e); if (--left === 0) rebuildForModels(); });
    });
  }
  function rebuildForModels() { if (cur >= 0 && floors[cur]) buildFloor(cur); }
  function useReal(k) { return MODELS === 'real' && REAL[k]; }
  // 모형을 크기에 맞춰 놓는다 (바닥에 붙이고 가운데 정렬). size: {w: 너비} 또는 {h: 높이} 또는 {l: 길이}
  function fitClone(k, size, x, y, z, ry) {
    var src = REAL[k], c = src.clone(), box = new T.Box3().setFromObject(src), sz = new T.Vector3(); box.getSize(sz);
    var sc = size.w ? size.w / sz.x : size.h ? size.h / sz.y : size.l / sz.z;
    var inner = new T.Group(); inner.add(c); c.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    var g = new T.Group(); g.add(inner); inner.scale.setScalar(sc); g.position.set(x, y || 0, z); g.rotation.y = ry || 0;
    parent.add(g); return g;
  }
  function plant(x, z, scale, seed) {   // 화분 + 줄기마다 잎이 겹겹이
    if (useReal('plant')) return fitClone('plant', { h: 1.3 * (scale || 1) }, x, 0, z, (seed || 0) * 1.7);
    var g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(scale || 1); parent.add(g);
    part(g, new T.CylinderGeometry(0.28, 0.21, 0.55, 28), M.pot, 0, 0.275, 0);
    part(g, new T.CylinderGeometry(0.29, 0.29, 0.03, 28), M.pot, 0, 0.55, 0);
    part(g, new T.CircleGeometry(0.26, 24), FURN.soil, 0, 0.545, 0, -Math.PI / 2);
    var r = rnd(seed || 7);
    for (var s = 0; s < 14; s++) {
      var a = r() * Math.PI * 2, tilt = 0.15 + r() * 0.5, len = 0.55 + r() * 0.75;
      var stem = new T.Group(); stem.position.set(Math.cos(a) * 0.05, 0.55, Math.sin(a) * 0.05); stem.rotation.set(0, -a, 0); g.add(stem);
      var arm = new T.Group(); arm.rotation.z = tilt; stem.add(arm);
      part(arm, new T.CylinderGeometry(0.008, 0.012, len, 5), FURN.leaves[3], 0, len / 2, 0).castShadow = false;
      for (var l = 0; l < 3; l++) {
        var lf = part(arm, leafGeo, FURN.leaves[Math.floor(r() * 3)], 0, len * (0.55 + l * 0.2), 0, -0.6 - r() * 0.5, r() * Math.PI * 2, 0.3);
        lf.scale.setScalar(0.8 + r() * 0.5);
      }
    }
    return g;
  }
  // 로비 라운지: 러그 + 소파 + 안락의자 둘 + 탁자 + 스탠드 (양쪽)
  function lounge(cx, cz, flip) {
    rug(cx, cz, 4.2, 3.2);
    [-0.8, 0, 0.8].forEach(function (ox) { addSeat(cx + ox, cz - 1.0, 0, 0.47); });   // 소파 세 자리 + 양옆 의자
    addSeat(cx - 1.55, cz + 0.35, Math.PI / 2 + 0.25, 0.47);
    addSeat(cx + 1.55, cz + 0.35, -Math.PI / 2 - 0.25, 0.47);
    if (useReal('sofa') && useReal('chair')) {   // 모형 파일: 벨벳 소파 + 단추 장식 의자 둘
      fitClone('sofa', { w: 2.5 }, cx, 0, cz - 1.05, 0);
      fitClone('chair', { w: 0.95 }, cx - 1.65, 0, cz + 0.35, Math.PI / 2 + 0.25);
      fitClone('chair', { w: 0.95 }, cx + 1.65, 0, cz + 0.35, -Math.PI / 2 - 0.25);
      coffeeTable(cx, cz + 0.05, 0);
      floorLamp(cx + 1.85, cz - 1.25);
      plant(cx - 2.0, cz - 1.3, 0.8, 11 + (flip ? 3 : 0));
      return;
    }
    sofa(cx, cz - 1.15, 0, 3, FURN.sofa[flip ? 2 : 0]);
    sofa(cx - 1.65, cz + 0.35, Math.PI / 2 + 0.25, 1, FURN.leather);
    sofa(cx + 1.65, cz + 0.35, -Math.PI / 2 - 0.25, 1, FURN.sofa[1]);
    coffeeTable(cx, cz + 0.05, 0);
    floorLamp(cx + 1.85, cz - 1.25);
    plant(cx - 2.0, cz - 1.3, 0.8, 11 + (flip ? 3 : 0));
  }
  // ── 바깥 차 (차도를 오가며 달린다, 밤엔 전조등·후미등) ──
  var CAR = {
    paint: [0xe8e6e1, 0x1f2328, 0x8b1e2b, 0x2c4a7a, 0x9aa2a8, 0x3d5a45, 0xd9c79c].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.6 }); }),
    glass: new T.MeshStandardMaterial({ color: 0x1b232c, roughness: 0.08, metalness: 0.4 }),
    tire: new T.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    head: new T.MeshStandardMaterial({ color: 0xf2f2ea, emissive: 0x000000, emissiveIntensity: 1.5 }),
    tail: new T.MeshStandardMaterial({ color: 0x7a1010, emissive: 0x000000, emissiveIntensity: 1.5 })
  };
  Object.keys(CAR).forEach(function (k) { [].concat(CAR[k]).forEach(function (m) { m.userData.keep = true; }); });
  var carGeo = null;
  function carParts() {
    if (carGeo) return carGeo;
    carGeo = { body: rbox(1.8, 0.62, 4.3, 0.18), cabin: rbox(1.6, 0.55, 2.3, 0.2), wheel: new T.CylinderGeometry(0.33, 0.33, 0.24, 18),
               lamp: new T.BoxGeometry(0.42, 0.12, 0.05) };
    Object.keys(carGeo).forEach(function (k) { carGeo[k].userData.shared = true; });
    return carGeo;
  }
  var cars = [];
  function makeCar(r) {
    if (useReal('car')) {   // 모형 파일 차: 차체 색만 바꾼다 (모형은 앞이 -z라 돌려 세운다)
      if (!carPaints) {
        var bodyMat = null; REAL.car.traverse(function (o) { if (o.isMesh && o.name === 'body' && !bodyMat) bodyMat = o.material; });
        carPaints = [0xe8e6e1, 0x1f2328, 0x8b1e2b, 0x2c4a7a, 0x9aa2a8, 0x3d5a45, 0xd9c79c].map(function (c) {
          var m = bodyMat ? bodyMat.clone() : new T.MeshStandardMaterial({ roughness: 0.25, metalness: 0.6 }); m.color.setHex(c); m.userData.keep = true; return m;
        });
      }
      var holder = parent, tmpG = new T.Group(); parent = tmpG;
      var car = fitClone('car', { l: 4.4 }, 0, 0, 0, Math.PI);
      parent = holder;
      var paint = carPaints[Math.floor(r() * carPaints.length)];
      car.traverse(function (o) { if (!o.isMesh) return; o.castShadow = false; if (o.name === 'body') o.material = paint; });   // 바깥이라 그림자 생략(가볍게)
      return tmpG;
    }
    var G = carParts(), g = new T.Group();
    var paint = CAR.paint[Math.floor(r() * CAR.paint.length)];
    function p(geo, mat, x, y, z, rz) { var m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (rz) m.rotation.z = rz; m.castShadow = true; g.add(m); return m; }
    p(G.body, paint, 0, 0.6, 0);
    var cab = p(G.cabin, CAR.glass, 0, 1.12, -0.25); cab.scale.set(1, 1, 1);
    p(G.cabin, paint, 0, 1.34, -0.25).scale.set(1.01, 0.12, 0.92);   // 지붕
    [-1, 1].forEach(function (s) { [-1.35, 1.35].forEach(function (z) { p(G.wheel, CAR.tire, s * 0.82, 0.33, z, Math.PI / 2); }); });
    [-0.6, 0.6].forEach(function (x) { p(G.lamp, CAR.head, x, 0.7, 2.15); p(G.lamp, CAR.tail, x, 0.72, -2.15); });
    return g;
  }
  function loopOf(w, back, front) {   // 순환 도로: 양옆 길을 서재 뒤(z0)와 캠핑장 뒤(z1)에서 잇는다
    var cz = (front + back) / 2, rz1 = front + PLAZA_D + RIVER_GAP + RIVER_W;
    return { hx: w / 2 + 9, z0: back - 26, z1: Math.min(rz1 + CAMP_D, cz + SCENE_R - 22) + 5 };
  }
  function loopAt(L, off, s) {   // 차선(off: 바깥 +, 안 -)을 따라 s만큼 간 자리와 방향. 오른쪽 길은 +z, 앞길은 -x, 왼쪽 길은 -z, 뒷길은 +x
    var rad = 4.5 + off, hx = L.hx + off, za = L.z0 - off, zb = L.z1 + off;
    var sz = zb - za - 2 * rad, sx = 2 * hx - 2 * rad, arc = Math.PI / 2 * rad, per = 2 * sz + 2 * sx + 4 * arc;
    s = ((s % per) + per) % per;
    function corner(cx, cz0, a0, t) { var a = a0 + t / rad; return [cx + Math.cos(a) * rad, cz0 + Math.sin(a) * rad, Math.atan2(-Math.sin(a), Math.cos(a))]; }
    if (s < sz) return [hx, za + rad + s, 0, 1, per];
    s -= sz; if (s < arc) return corner(hx - rad, zb - rad, 0, s).concat([0, per]);
    s -= arc; if (s < sx) return [hx - rad - s, zb, -Math.PI / 2, 0, per];
    s -= sx; if (s < arc) return corner(-hx + rad, zb - rad, Math.PI / 2, s).concat([0, per]);
    s -= arc; if (s < sz) return [-hx, zb - rad - s, Math.PI, -1, per];
    s -= sz; if (s < arc) return corner(-hx + rad, za + rad, Math.PI, s).concat([0, per]);
    s -= arc; if (s < sx) return [-hx + rad + s, za, Math.PI / 2, 0, per];
    s -= sx; return corner(hx - rad, za + rad, -Math.PI / 2, s).concat([0, per]);
  }
  function addCars(w, back, front, gy) {
    cars = [];
    var r = rnd(83), L = loopOf(w, back, front);
    [1.9, -1.9].forEach(function (off) {   // 차선 둘: 바깥 차선과 안 차선이 서로 반대로 돈다
      var per = loopAt(L, off, 0)[4], n = useReal('car') ? 4 : 8 + Math.floor(r() * 3), speed = 8 + r() * 2;   // 같은 차선은 같은 빠르기 (앞차를 뚫지 않게)
      for (var i = 0; i < n; i++) {
        var c = makeCar(r); parent.add(c);
        cars.push({ g: c, L: L, off: off, rev: off < 0, s: (i + r() * 0.5) / n * per, speed: speed, gy: gy });
      }
    });
    updateCars(0);
  }
  function updateCars(dt) {
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i], ns = c.s + (c.rev ? -1 : 1) * c.speed * dt, q = loopAt(c.L, c.off, ns), dz = q[3] * (c.rev ? -1 : 1);
      if (dt && dz && carHold({ g: c.g, dir: dz }, q[1])) continue;   // 횡단보도에 사람이 있으면 선다
      c.s = ns; c.g.position.set(q[0], c.gy, q[1]); c.g.rotation.y = q[2] + (c.rev ? Math.PI : 0);
    }
  }
  // 현수막 건물([거리] 설정의 현수막 건물): 설정에 그림 주소가 있으면 간판 아래 벽에 건다 (그림은 서버가 받아 둔 것을 쓴다)
  var BANNER_B = null, bannerMesh = null, BANNER = { url: '', v: '' };
  var bannerTimer = null;
  function clearBanner() {
    if (bannerMesh && bannerMesh.parent) {
      bannerMesh.parent.remove(bannerMesh);
      if (bannerMesh.userData.book) books = books.filter(function (q) { return q !== bannerMesh.userData.book; });
      disposeGroup(bannerMesh);
    }
    bannerMesh = null;
  }
  function hangBanner(tex, book) {   // 그림을 비율대로 간판 아래 벽에 (위아래 봉)
    clearBanner();
    var spot = BANNER_B;
    tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    var iw = tex.image.width || 1, ih = tex.image.height || 1, maxH = Math.max(2, spot.top - spot.bottom);
    var w = spot.maxW, h = w * ih / iw;
    if (h > maxH) { h = maxH; w = h * iw / ih; }
    var g = new T.Group(); g.position.set(spot.face - spot.side * 0.25, spot.top - h / 2, spot.z); g.rotation.y = -spot.side * Math.PI / 2;
    var mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false, side: T.DoubleSide });
    var pic = new T.Mesh(new T.PlaneGeometry(w, h), mat);
    g.add(pic);
    [h / 2 + 0.06, -h / 2 - 0.06].forEach(function (y) {
      var bar = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, w + 0.3, 10), M.pole); bar.rotation.z = Math.PI / 2; bar.position.set(0, y, 0.02); g.add(bar);
    });
    if (book) {   // 보관함 표지: 누르면 작품 카드 (멀리 있어도 누를 수 있게 거리 제한 없이 고르게 함)
      book.front = mat; book.mesh = pic; book.state = 2; book.kind = 'banner'; pic.userData.book = book; g.userData.book = book; books.push(book);
    }
    floorGroup.add(g); bannerMesh = g;
  }
  function placeBanner() {
    clearTimeout(bannerTimer); bannerTimer = null;
    clearBanner();
    if (!BANNER_B || !floorGroup) return;
    var spot = BANNER_B, holder = floorGroup;
    function stale() { return spot !== BANNER_B || holder !== floorGroup; }   // 그새 층이 바뀜
    if (BANNER.mode === 'library') {
      var next = function () {
        if (stale()) return;
        if (reading || document.visibilityState !== 'visible') { bannerTimer = setTimeout(next, 5000); return; }
        api('api/lib3d/banner_pick').then(function (d) {
          if (stale()) return;
          loader.load('api/lib3d/cover?k=' + encodeURIComponent(d.key), function (tex) {
            if (stale()) { tex.dispose(); return; }
            hangBanner(tex, { key: d.key, title: d.title || '(제목 없음)', count: d.count, lib: d.lib_name || '현수막', db: d.db, base: 0x333333 });
          });
        }).catch(function (e) { console.warn('3D 서재 현수막:', e.message); })
          .then(function () { if (!stale()) bannerTimer = setTimeout(next, Math.max(5, BANNER.sec || 30) * 1000); });
      };
      next();
      return;
    }
    if (!BANNER.url) return;
    loader.load('api/lib3d/banner?v=' + encodeURIComponent(BANNER.v), function (tex) {
      if (stale()) { tex.dispose(); return; }
      hangBanner(tex, null);
    }, undefined, function () { console.warn('3D 서재 현수막 그림을 불러오지 못했습니다.'); });
  }
  // 건너편 건물 간판 이름: [창밖 풍경 > 거리] 설정 (공개 저장소라 기본은 중립 이름 - gdw/lib3d.py STREET_DEFAULT)
  // 서재 옆 오른쪽 건물들에 갤러리·청음실, 왼쪽에 사무실, 나머지 건물엔 간판 이름을 차례로. 현수막은 정한 건물에.
  var STREET = { signs: ['BOOK CAFE', 'FLOWER', 'BAKERY', 'STUDIO', 'MARKET', 'PHOTO', 'TEA HOUSE', 'ATELIER'], gallery: 'GALLERY', jazz: 'RECORDS', office: 'OFFICE', banner: 'GALLERY' };
  var SIGN_COLORS = [['#1d3557', '#f1faee'], ['#7a1f2b', '#fff4e6'], ['#f4f1ea', '#1d1e20'], ['#2d6a4f', '#ffffff'], ['#f2b705', '#1d1e20'],
                     ['#3a0ca3', '#ffffff'], ['#222222', '#ffd166'], ['#e76f51', '#ffffff']];
  function addOutside(w, back, front, floorIdx) {
    var gy = -floorIdx * 4.5 - 0.05, cz = (front + back) / 2, d = front - back, r = rnd(53 + floorIdx);
    var rz0 = front + PLAZA_D + RIVER_GAP, rz1 = rz0 + RIVER_W;   // 서재 앞 강 (땅은 addRiverCamp가 강 양쪽으로 깐다)
    var pano = new T.Mesh(new T.CylinderGeometry(SCENE_R, SCENE_R, 110, 64, 1, true), M.pano);
    add(pano, 0, EYE - 110 * 0.3 + 110 / 2, cz);   // 그림의 지평선(아래에서 30%)을 눈높이에 맞춘다
    pano.rotation.y = floorIdx * 1.3; pano.renderOrder = -10;
    var LP = loopOf(w, back, front), len = LP.z1 - LP.z0 + 8, lcz = (LP.z0 + LP.z1) / 2;   // 길은 순환 도로 끝까지만
    var r2 = rnd(977 + floorIdx), Lp = [], Lm = [], La = [], LEAFC = [[], [], [], []];   // 건물 장식(난간 돌·어두운 쇠·밝은 설비) - 한꺼번에 그린다
    var signed = { gallery: false, jazz: false, office: false, next: 0 };
    BANNER_B = null; bannerMesh = null; SHOPS = {};
    [1, -1].forEach(function (side) {
      var walkX = side * (w / 2 + 2.5), roadX = side * (w / 2 + 9), farWalkX = side * (w / 2 + 15.5);
      var walk = new T.Mesh(new T.PlaneGeometry(5, len), M.pave); walk.rotation.x = -Math.PI / 2; add(walk, walkX, gy + 0.02, lcz);
      var road = new T.Mesh(new T.PlaneGeometry(8, len), M.road); road.rotation.x = -Math.PI / 2; add(road, roadX, gy + 0.01, lcz);
      var walk2 = new T.Mesh(new T.PlaneGeometry(5, len), M.pave); walk2.rotation.x = -Math.PI / 2; add(walk2, farWalkX, gy + 0.02, lcz);
      for (var tz = back - 40; tz < front + 40; tz += 7 + r() * 3) {   // 가로수 (양쪽 보도)
        if (tz > rz0 - 2.5 && tz < rz1 + 2.5) continue;   // 다리 위에는 심지 않는다
        [walkX + side * 1.4, farWalkX - side * 1.4].forEach(function (tx) {
          var ts = 0.9 + r2() * 0.35, li = Math.floor(r2() * 4);
          var trunk = new T.Mesh(treeTrunkGeo, M.trunk); trunk.scale.setScalar(ts); trunk.rotation.y = r2() * 6; add(trunk, tx, gy, tz);
          var ch = gy + (3.7 + r() * 0.4) * ts;
          for (var cc = 0; cc < 4; cc++) {   // 속을 채우는 어두운 잎 덩어리
            var crown = new T.Mesh(crownGeo, M.leafCore[(li + cc) % 4]), sz = (cc ? 0.38 + r() * 0.14 : 0.5) * ts;
            crown.scale.set(sz * (1 + r() * 0.3), sz * (1 + r() * 0.3), sz * (1 + r() * 0.3)); crown.rotation.set(r() * 3, r() * 3, 0);
            add(crown, tx + (cc ? (r() - 0.5) * 1.5 : 0) * ts, ch + (cc ? (r() - 0.3) * 1.1 : 0.35) * ts, tz + (cc ? (r() - 0.5) * 1.5 : 0) * ts);
          }
          for (var pad = 0; pad < 14; pad++) r();   // 예전과 같은 수만큼 난수를 써서 건물 배치가 바뀌지 않게
          for (var lc = 0; lc < 150; lc++) {   // 겉을 덮는 잎사귀 뭉치 (위쪽은 넓게, 아래쪽은 성기게)
            var u = r2() * 2 - 0.45, th = r2() * Math.PI * 2, hr = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u))), rad = (0.8 + r2() * 0.3) * ts;
            if (u > 1) { u = 1; hr = r2() * 0.5; }
            LEAFC[(li + (lc % 3 === 0 ? 1 : 0)) % 4].push([tx + Math.cos(th) * hr * 2.0 * rad, ch + u * 1.55 * rad, tz + Math.sin(th) * hr * 2.0 * rad, (1.0 + r2() * 0.8) * ts, r2() * 3, r2() * 6, r2() * 3]);
          }
        });
      }
      for (var lz = back - 30; lz < front + 30; lz += 14) {   // 가로등 (밤·흐린 날 켜짐)
        var lx = walkX + side * 2.1;   // 차도 쪽 보도 가장자리
        var pole = new T.Mesh(unitBox, M.pole); pole.scale.set(0.12, 5, 0.12); add(pole, lx, gy + 2.5, lz);
        var arm = new T.Mesh(unitBox, M.pole); arm.scale.set(1.1, 0.08, 0.08); add(arm, lx + side * 0.5, gy + 4.95, lz);
        var bulb = new T.Mesh(unitBox, M.streetLight); bulb.scale.set(0.5, 0.12, 0.28); add(bulb, lx + side * 1.0, gy + 4.85, lz);
        var pool = new T.Mesh(poolGeo, M.lightPool); pool.rotation.x = -Math.PI / 2; add(pool, lx + side * 1.0, gy + 0.04, lz);   // 바닥 불빛
      }
      for (var bz = back - 50; bz < front + 50;) {   // 건너편 건물들
        var bw = 10 + r() * 14, bd = 10 + r() * 10, bh = 9 + Math.pow(r(), 1.6) * 34;
        var mat = M.facade[Math.floor(r() * M.facade.length)];
        if (bz + bw > rz0 - 1) { if (rz0 - 1 - bz < 9) break; bw = rz0 - 1 - bz; }   // 건물은 강가까지만 - 남은 자리가 9m 넘으면 거기에 맞춰 짓는다 (서재 옆 건물 자리를 잃지 않게)
        var bld = new T.Mesh(bldGeo(bd, bh, bw), mat); bld.scale.set(bd, bh, bw);
        var bx = side * (w / 2 + 18 + bd / 2 + r() * 6);
        add(bld, bx, gy + bh / 2, bz + bw / 2);
        var shop = new T.Mesh(unitBox, M.shopGlass); shop.scale.set(bd + 0.2, 3.4, bw + 0.2); add(shop, bx, gy + 1.7, bz + bw / 2);   // 1층 상점 유리
        var aw = new T.Mesh(unitBox, M.awning[Math.floor(r() * M.awning.length)]); aw.scale.set(1.4, 0.12, bw * 0.8);   // 차양
        aw.rotation.z = side * 0.25; add(aw, bx - side * (bd / 2 + 0.6), gy + 3.6, bz + bw / 2);
        var cap = new T.Mesh(unitBox, M.parapet); cap.scale.set(bd + 0.3, 0.5, bw + 0.3); add(cap, bx, gy + bh + 0.25, bz + bw / 2);   // 옥상 난간
        var mid = bz + bw / 2, nm = null, near = mid > back && mid < rz0 - 4;   // 걸어갈 수 있는 서재 옆 건물
        var plain = STREET.signs.filter(function (n) { return [STREET.gallery, STREET.jazz, STREET.office].indexOf(n) < 0; });
        if (near && side > 0 && STREET.gallery && !signed.gallery) { signed.gallery = true; nm = STREET.gallery; }
        else if (near && side > 0 && STREET.jazz && !signed.jazz) { signed.jazz = true; nm = STREET.jazz; }
        else if (near && side < 0 && STREET.office && !signed.office) { signed.office = true; nm = STREET.office; }
        else if (mid > back - 35 && mid < front + 35 && signed.next < plain.length) nm = plain[signed.next++];
        if (nm) {
          SHOPS[nm] = { side: side, z: mid, bx: bx, bd: bd, bw: bw, bh: bh, gy: gy, bld: bld, shop: shop };   // 1층 방을 낼 수 있게
          var sw = Math.min(bw * 0.85, 11), sh = sw * 0.22, sy = gy + Math.min(bh - sh, 14), sx = bx - side * (bd / 2 + 0.2), sc0 = SIGN_COLORS[(signed.next + (side > 0 ? 0 : 3)) % SIGN_COLORS.length];
          if (nm === STREET.banner) {   // 현수막 건물: 검은 간판
            sc0 = ['#14181f', '#ffffff'];
            BANNER_B = { face: bx - side * (bd / 2), side: side, z: mid, top: sy - sh / 2 - 0.5, bottom: gy + 4.6, maxW: Math.min(bw * 0.75, 9),
                       bx: bx, bd: bd, bw: bw, bh: bh, gy: gy, bld: bld, shop: shop };   // 1층 갤러리용
          }
          var sign = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: textTex([nm], 1024, 224, sc0[0], sc0[1], nm.length > 10 ? 120 : 150), toneMapped: false }));
          sign.rotation.y = -side * Math.PI / 2; add(sign, sx, sy, mid);   // 서재 쪽을 보게
          var sbk = new T.Mesh(unitBox, M.pole); sbk.scale.set(0.15, sh + 0.25, sw + 0.25); add(sbk, bx - side * (bd / 2 + 0.05), sy, mid);
        }
        (function (bx, bd, bw, bh, mid, nm, style) {   // 세밀한 장식: 띠 장식·처마·모서리 기둥·가게 창살과 문·발코니·옥상 설비·홈통
          var face = bx - side * bd / 2, y0 = gy, room = nm && [STREET.gallery, STREET.jazz, STREET.office].indexOf(nm) >= 0;
          Lp.push([bx, y0 + 3.62, mid, bd + 0.3, 0.2, bw + 0.3], [bx, y0 + bh - 0.2, mid, bd + 0.55, 0.28, bw + 0.55], [bx, y0 + bh + 0.85, mid, bd + 0.3, 0.1, bw + 0.3]);
          [-1, 1].forEach(function (cx) { [-1, 1].forEach(function (cz2) { Lp.push([bx + cx * (bd / 2 - 0.12), y0 + 3.7 + (bh - 3.9) / 2, mid + cz2 * (bw / 2 - 0.12), 0.42, bh - 3.9, 0.42]); }); });
          for (var fy = 2; fy * 3.2 < bh - 2; fy += style ? 1 : 2) Lp.push([bx, y0 + fy * 3.2 * (bh / (Math.max(1, Math.round(bh / 3.2)) * 3.2)), mid, bd + 0.14, 0.09, bw + 0.14]);   // 층 띠
          Lm.push([face - side * 0.3, y0 + bh / 2, mid + bw / 2 - 0.5, 0.1, bh, 0.1]);   // 홈통
          if (!room) {   // 1층 가게 앞: 창살·아래턱·문
            for (var mz = -bw / 2 + 0.3; mz <= bw / 2 - 0.29; mz += (bw - 0.6) / Math.max(2, Math.round(bw / 2.4))) Lm.push([face - side * 0.14, y0 + 1.75, mid + mz, 0.09, 3.3, 0.09]);
            Lm.push([face - side * 0.14, y0 + 3.35, mid, 0.1, 0.12, bw], [face - side * 0.16, y0 + 0.2, mid, 0.14, 0.4, bw]);
            var dz0 = (r2() - 0.5) * bw * 0.4;
            Lm.push([face - side * 0.2, y0 + 1.25, mid + dz0, 0.1, 2.5, 1.3]); La.push([face - side * 0.27, y0 + 1.1, mid + dz0 + 0.45, 0.04, 0.4, 0.05]);
          }
          if (style && bh > 12) {   // 주거 건물: 길 쪽 발코니 한두 줄
            var cols = bw > 16 ? [-bw * 0.25, bw * 0.25] : [0];
            cols.forEach(function (cz3) { for (var by = 2; by * 3.2 < bh - 3; by++) {
              var yy = y0 + by * 3.2 * (bh / (Math.max(1, Math.round(bh / 3.2)) * 3.2)) + 0.15;
              Lp.push([face - side * 0.5, yy, mid + cz3, 1.0, 0.1, 2.6]);
              Lm.push([face - side * 0.98, yy + 0.95, mid + cz3, 0.05, 0.05, 2.6], [face - side * 0.98, yy + 0.5, mid + cz3, 0.03, 0.9, 2.56]);
            } });
          }
          var na = 1 + Math.floor(r2() * 3);   // 옥상: 실외기·환기구·안테나
          for (var ai = 0; ai < na; ai++) {
            var ax = bx + (r2() - 0.5) * bd * 0.6, az = mid + (r2() - 0.5) * bw * 0.6;
            La.push([ax, y0 + bh + 0.9, az, 1.3, 0.8, 0.9]); Lm.push([ax, y0 + bh + 1.32, az, 0.9, 0.04, 0.6]);
          }
          if (r2() < 0.6) Lm.push([bx + (r2() - 0.5) * bd * 0.5, y0 + bh + 2.4, mid + (r2() - 0.5) * bw * 0.5, 0.06, 3.8, 0.06]);
          if (r2() < 0.45) { var tk = new T.Mesh(tankGeo, CAMP.cooler); tk.scale.set(1.1, 1.7, 1.1); add(tk, bx + bd * 0.25, y0 + bh + 1.6, mid - bw * 0.25);
            Lm.push([bx + bd * 0.25, y0 + bh + 0.6, mid - bw * 0.25, 1.6, 0.12, 1.6]); }
        })(bx, bd, bw, bh, bz + bw / 2, nm, mat.userData.style);
        if (r() < 0.5) { var hut = new T.Mesh(unitBox, M.parapet); hut.scale.set(bd * 0.3, 2.2, bw * 0.25); add(hut, bx + (r() - 0.5) * bd * 0.4, gy + bh + 1.1, bz + bw / 2 + (r() - 0.5) * bw * 0.4); }
        bz += bw + 2 + r() * 6;
      }
    });
    instBoxes(Lp, M.parapet); instBoxes(Lm, M.pole); instBoxes(La, CAMP.cooler);
    LEAFC.forEach(function (l, i) { leafCards(l, M.leafCard[i]); });
    // 순환 도로의 앞길(캠핑장 뒤)·뒷길(서재 뒤) + 모퉁이
    [LP.z0, LP.z1].forEach(function (rz) {
      var cr = new T.Mesh(new T.PlaneGeometry(8, 2 * LP.hx + 8), M.road); cr.rotation.set(-Math.PI / 2, 0, Math.PI / 2); add(cr, 0, gy + 0.024, rz);   // 양옆 보도보다 살짝 위 (찻길이 보도에 덮이지 않게)
      [-1, 1].forEach(function (sd) { var wk = new T.Mesh(new T.PlaneGeometry(2.4, 2 * LP.hx + 18), M.pave); wk.rotation.set(-Math.PI / 2, 0, Math.PI / 2); add(wk, 0, gy + 0.022, rz + sd * 5.2); });
    });
    addRiverCamp(w, back, front, gy, floorIdx);
    addWeather(w, back, front, gy);
    addCars(w, back, front, gy);
    setTimeout(placeBanner, 0);   // 층을 다 지은 뒤
  }
  // ── 서재 앞 큰 강 + 강 건너 캠핑장 (눈 덮인 산 아래, 밤이면 텐트마다 불이 켜진다) ──
  // 앞마당 끝에서 나무다리(가운데)나 양옆 보도 다리로 강을 건너면 캠핑장. 걸어서 둘러보고 빈 의자에 앉을 수 있다.
  var RIVER_GAP = 2.5, RIVER_W = 28, CAMP_D = 44;
  var RV = null, campFx = null;   // RV: 지금 1층의 강·캠핑장 자리 (걸을 수 있는 곳 계산용)
  var waterTex = canvasTex(256, 256, function (g, w, h) {
    var r = rnd(71); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (var i = 0; i < 420; i++) {
      g.strokeStyle = 'rgba(' + (r() < 0.5 ? '255,255,255,' : '20,50,80,') + (0.05 + r() * 0.12) + ')'; g.lineWidth = 1 + r() * 1.5;
      var x = r() * w, y = r() * h, l = 10 + r() * 34; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y + (r() - 0.5) * 5, x + l, y); g.stroke();
    }
  }, [26, 5]);
  // 먼 산: 넓고 완만한 큰 산 (정상은 평평한 능선, 오른쪽에 낮은 봉우리와 송신탑, 봉우리 바로 아래에 바위기둥 - 주상절리, 앞에는 겹겹의 낮은 산줄기).
  // 계절마다 다시 그린다: 겨울은 정상부에 눈, 봄·여름은 초록, 가을은 갈색. 시간(밤·노을)은 재질 색으로 입힌다.
  var mountCache = {};
  function mountainTex(season) {
    if (mountCache[season]) return mountCache[season];
    var C = { spring: ['#7f9a78', '#5f8062', '#4c6b52', '#3f5c47'], summer: ['#6f9463', '#517c50', '#3f6644', '#33573b'],
              autumn: ['#9a8a66', '#84704f', '#6b5a42', '#57493a'], winter: ['#8f98ac', '#737d92', '#5d677c', '#4b556a'] }[season] || null;
    if (!C) C = ['#6f9463', '#517c50', '#3f6644', '#33573b'];
    var t = canvasTex(1536, 512, function (g, w, h) {
      var r = rnd(173), winter = season === 'winter';
      function ridge(pts, jit) {   // 꼭짓점 사이를 잘게 나눠 울퉁불퉁한 능선으로
        var out = [];
        for (var i = 0; i < pts.length - 1; i++) for (var k = 0; k < 14; k++) { var u = k / 14; out.push([(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u) * w, (pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u) * h + (r() - 0.5) * jit]); }
        out.push([pts[pts.length - 1][0] * w, pts[pts.length - 1][1] * h]);
        return out;
      }
      function fill(line, col) { g.beginPath(); g.moveTo(line[0][0], h); line.forEach(function (p) { g.lineTo(p[0], p[1]); }); g.lineTo(line[line.length - 1][0], h); g.closePath(); if (col) { g.fillStyle = col; g.fill(); } }
      g.clearRect(0, 0, w, h);
      // 큰 산 몸통
      var main = ridge([[0, 0.78], [0.1, 0.66], [0.22, 0.5], [0.31, 0.36], [0.4, 0.22], [0.46, 0.15], [0.53, 0.13], [0.6, 0.16], [0.66, 0.22], [0.72, 0.3], [0.78, 0.29], [0.82, 0.25], [0.87, 0.31], [0.94, 0.5], [1, 0.7]], 7);
      var gr = g.createLinearGradient(0, h * 0.12, 0, h); gr.addColorStop(0, C[0]); gr.addColorStop(0.55, C[1]); gr.addColorStop(1, C[1]);
      fill(main, gr);
      g.save(); fill(main); g.clip();
      for (var i = 0; i < 90; i++) {   // 골짜기 그늘과 능선 빛 (정상에서 아래로 갈라지는 주름)
        var sx = w * (0.08 + r() * 0.86), sy = h * (0.14 + r() * 0.45), len = h * (0.12 + r() * 0.3), dx = (sx - w * 0.53) * (0.25 + r() * 0.5);
        g.strokeStyle = (i % 2 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (0.05 + r() * 0.09) + ')'; g.lineWidth = 4 + r() * 16;
        g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + dx * 0.4, sy + len * 0.5, sx + dx, sy + len); g.stroke();
      }
      if (winter) {   // 정상부에 내려앉은 눈 (아래로 갈수록 성기게)
        for (var n = 0; n < 3200; n++) { var nx = w * (0.28 + r() * 0.6), ny = h * (0.1 + Math.pow(r(), 2.2) * 0.3); g.fillStyle = 'rgba(246,248,252,' + (0.12 + r() * 0.3) + ')'; g.beginPath(); g.ellipse(nx, ny, 5 + r() * 16, 2 + r() * 5, (nx - w * 0.53) / w * 1.2, 0, 6.3); g.fill(); }
        g.fillStyle = 'rgba(246,248,252,0.75)'; fill(ridge([[0.36, 0.3], [0.42, 0.22], [0.47, 0.17], [0.53, 0.15], [0.6, 0.18], [0.65, 0.24], [0.7, 0.31]], 12), 'rgba(246,248,252,0.0)');
        for (var st = 0; st < 40; st++) { var qx = w * (0.38 + r() * 0.34), ql = h * (0.06 + r() * 0.16); g.strokeStyle = 'rgba(246,248,252,' + (0.3 + r() * 0.4) + ')'; g.lineWidth = 3 + r() * 9; g.beginPath(); g.moveTo(qx, h * 0.2); g.lineTo(qx + (qx - w * 0.53) * 0.4, h * 0.2 + ql); g.stroke(); }
      } else {   // 숲의 얼룩
        for (var f = 0; f < 1800; f++) { g.fillStyle = 'rgba(' + (r() < 0.5 ? '20,50,25,' : '200,220,150,') + r() * 0.1 + ')'; g.beginPath(); g.arc(r() * w, h * (0.14 + r() * 0.8), 4 + r() * 10, 0, 6.3); g.fill(); }
      }
      // 봉우리 바로 아래의 바위기둥 무리 (주상절리): 정상 능선 밑에 세로로 선 회색 돌기둥이 들쭉날쭉
      [[0.395, 0.455, 0.225, 0.075], [0.47, 0.565, 0.165, 0.08], [0.585, 0.645, 0.2, 0.075], [0.795, 0.835, 0.27, 0.05]].forEach(function (b) {
        for (var x = b[0] * w; x < b[1] * w;) {
          var cw = 3 + r() * 5, ch = h * b[3] * (0.35 + r() * 0.65), base = h * (b[2] + b[3]) + (r() - 0.5) * 10 + Math.sin(x / 40) * 5, tone = 108 + Math.floor(r() * 62);
          if (r() < 0.82) {
            g.fillStyle = 'rgb(' + tone + ',' + (tone - 3) + ',' + (tone - 9) + ')'; g.fillRect(x, base - ch, cw, ch);
            g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, base - ch, 1.5, ch); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + cw - 1.5, base - ch, 1.5, ch);
            if (winter) { g.fillStyle = 'rgba(246,248,252,0.85)'; g.fillRect(x, base - ch, cw, 3); }
          }
          x += cw + (r() < 0.2 ? 4 + r() * 8 : 0.5);
        }
        for (var bsh = 0; bsh < 70; bsh++) { g.fillStyle = winter ? 'rgba(235,240,246,' + (0.4 + r() * 0.4) + ')' : (r() < 0.5 ? C[1] : C[2]); g.beginPath(); g.arc(w * (b[0] - 0.01 + r() * (b[1] - b[0] + 0.02)), h * (b[2] + b[3]) + (r() - 0.3) * 16, 3 + r() * 6, 0, 6.3); g.fill(); }   // 기둥 밑동의 수풀
      });
      g.restore();
      // 오른쪽 봉우리의 송신탑
      g.strokeStyle = 'rgba(70,74,84,0.9)'; g.lineWidth = 2; [[0.815, 0.25, 26], [0.826, 0.255, 18]].forEach(function (a) { g.beginPath(); g.moveTo(a[0] * w, a[1] * h); g.lineTo(a[0] * w, a[1] * h - a[2]); g.stroke(); });
      // 앞의 낮은 산줄기 둘 (가까울수록 짙게)
      fill(ridge([[0, 0.7], [0.08, 0.63], [0.16, 0.68], [0.25, 0.6], [0.34, 0.66], [0.43, 0.61], [0.5, 0.67], [0.6, 0.62], [0.7, 0.68], [0.8, 0.61], [0.9, 0.66], [1, 0.62]], 9), C[2]);
      fill(ridge([[0, 0.8], [0.1, 0.76], [0.2, 0.8], [0.3, 0.74], [0.42, 0.79], [0.55, 0.75], [0.66, 0.8], [0.77, 0.75], [0.88, 0.8], [1, 0.76]], 8), C[3]);
      for (var tr = 0; tr < 700; tr++) { g.fillStyle = 'rgba(' + (winter ? '230,235,242,' : '15,40,22,') + (0.1 + r() * 0.2) + ')'; g.beginPath(); g.arc(r() * w, h * (0.64 + r() * 0.36), 3 + r() * 6, 0, 6.3); g.fill(); }
    });
    mountCache[season] = t;
    return t;
  }
  var flareTex = canvasTex(128, 128, function (g, w, h) {   // 랜턴 불빛 (가운데 빛 + 가는 빛줄기)
    g.clearRect(0, 0, w, h);
    var gr = g.createRadialGradient(64, 64, 1, 64, 64, 62); gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.18, 'rgba(255,190,90,0.55)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.translate(64, 64);
    for (var i = 0; i < 6; i++) { g.rotate(Math.PI / 6); var lg = g.createLinearGradient(-62, 0, 62, 0); lg.addColorStop(0, 'rgba(255,220,160,0)'); lg.addColorStop(0.5, 'rgba(255,235,190,0.8)'); lg.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = lg; g.fillRect(-62, -0.8, 124, 1.6); }
  });
  var TENT_COLORS = [0xe8dcc6, 0xf3ede1, 0xa8875f, 0x8a6e52, 0x7d8466, 0xd9c7a6, 0xcbb894, 0x9a8a70];   // 면 텐트 색: 베이지·크림·황갈·갈색·올리브·모래
  var tentTex = canvasTex(256, 256, function (g, w, h) {   // 천의 짜임과 잔주름
    var r = rnd(149); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (var y = 0; y < h; y += 2) { g.fillStyle = 'rgba(0,0,0,0.03)'; g.fillRect(0, y, w, 1); }
    for (var i = 0; i < 70; i++) { g.strokeStyle = 'rgba(' + (r() < 0.6 ? '0,0,0,' : '255,255,255,') + (0.04 + r() * 0.07) + ')'; g.lineWidth = 1 + r() * 2;
      var x = r() * w, y2 = r() * h; g.beginPath(); g.moveTo(x, y2); g.quadraticCurveTo(x + (r() - 0.5) * 60, y2 + 30 + r() * 40, x + (r() - 0.5) * 30, y2 + 70 + r() * 60); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.1)'; for (var sx = 0; sx < w; sx += w / 4) g.fillRect(sx, 0, 1.5, h);   // 이음 솔기
  }, [4, 1]);
  var CAMP = {
    water: new T.MeshStandardMaterial({ map: waterTex, color: 0x4f86a8, roughness: 0.12, metalness: 0.55 }),
    bank: new T.MeshStandardMaterial({ color: 0x8e8a80, roughness: 0.95 }),
    wood: new T.MeshStandardMaterial({ color: 0x8a6645, roughness: 0.85 }),
    dirt: new T.MeshStandardMaterial({ color: 0xb09a78, roughness: 1 }),
    tent: TENT_COLORS.map(function (c) { return new T.MeshStandardMaterial({ color: c, map: tentTex, roughness: 0.92, side: T.DoubleSide, emissive: 0x000000 }); }),
    trim: new T.MeshStandardMaterial({ color: 0x6b5644, roughness: 0.9, side: T.DoubleSide }),          // 치마·처마 띠·끝 천
    inside: new T.MeshStandardMaterial({ color: 0x2a221b, roughness: 1, side: T.DoubleSide, emissive: 0x000000 }),   // 열린 문 안쪽 (밤엔 불빛)
    mesh: new T.MeshStandardMaterial({ color: 0x3a3a36, roughness: 1, side: T.DoubleSide }),            // 모기장 창
    frame: new T.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.5 }),
    cushion: new T.MeshStandardMaterial({ color: 0xe9e1d0, map: fabricTex, roughness: 1 }),
    rug: new T.MeshStandardMaterial({ color: 0xe6dcc8, map: fabricTex, roughness: 1 }),
    steel: new T.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.55, metalness: 0.7, side: T.DoubleSide }),
    ember: new T.MeshStandardMaterial({ color: 0x3a1a0c, emissive: 0xff5a14, emissiveIntensity: 0.9, roughness: 1 }),
    rope: new T.LineBasicMaterial({ color: 0xd8d2c0 }),
    canopy: new T.MeshStandardMaterial({ color: 0x3f7a55, roughness: 0.85, side: T.DoubleSide }),
    lamp: new T.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0x000000, emissiveIntensity: 2.2, roughness: 0.4 }),
    flame: new T.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9, fog: false }),
    stone: new T.MeshStandardMaterial({ color: 0x6f6b66, roughness: 1, flatShading: true }),
    pine: [0x2f5a3c, 0x3a6a45, 0x274d35].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 1, map: needleTex, side: T.DoubleSide }); }),
    hammock: new T.MeshStandardMaterial({ color: 0x3b6fb0, roughness: 0.9, side: T.DoubleSide }),
    chair: new T.MeshStandardMaterial({ color: 0x4a5a48, roughness: 0.9 }),
    cooler: new T.MeshStandardMaterial({ color: 0xd9e4ea, roughness: 0.6 }),
    lot: new T.MeshStandardMaterial({ color: 0x77736c, roughness: 1 }),
    fuji: new T.MeshBasicMaterial({ map: mountainTex('summer'), alphaTest: 0.5, fog: false, side: T.DoubleSide }),
    flare: new T.SpriteMaterial({ map: flareTex, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
  };
  Object.keys(CAMP).forEach(function (k) { [].concat(CAMP[k]).forEach(function (m) { m.userData.keep = true; m.userData.envSet = true; }); });
  var domeGeo = new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), tipiGeo = new T.ConeGeometry(1, 1, 6, 1, true), pineGeo = new T.ConeGeometry(1, 1, 7),
      rockGeo = new T.IcosahedronGeometry(1, 0), bulbGeo = new T.SphereGeometry(1, 8, 6), flameGeo = new T.ConeGeometry(0.22, 0.7, 6);
  var tankGeo = new T.CylinderGeometry(1, 1, 1, 14);
  [domeGeo, tipiGeo, pineGeo, rockGeo, bulbGeo, flameGeo, tankGeo].forEach(function (gq) { gq.userData.shared = true; });
  function campTint(o, f, envOut) {   // applyOutside에서: 시간·계절·날씨에 맞춰 강·캠핑장 색과 불빛
    var night = o.time === 'night', dusk = o.time === 'dusk', grey = o.weather !== 'clear', winter = o.season === 'winter', lit = night || dusk || grey;
    function tint(m, hex) { m.color.setHex(hex).multiplyScalar(f); }
    tint(CAMP.water, night ? 0x6f8fd0 : dusk ? 0xc98f7a : grey ? 0x6f8794 : 0x4f86a8); CAMP.water.envMapIntensity = Math.max(0.15, envOut * 3);
    tint(CAMP.bank, winter ? 0xdfe3e6 : 0x8e8a80); tint(CAMP.wood, 0x8a6645); tint(CAMP.dirt, winter ? 0xe6e6e2 : 0xb09a78);
    CAMP.tent.forEach(function (m, i) {   // 밤에는 안에 켠 랜턴으로 천이 주황빛으로 비친다
      tint(m, TENT_COLORS[i]);
      m.emissive.setHex(night ? 0xff9a3a : dusk ? 0x7a3a10 : 0x000000); m.emissiveIntensity = night ? (i > 1 && i !== 5 && i !== 6 ? 0.18 : 0.42) : 0.25;   // 밝은 면 텐트가 더 환하게 비친다
    });
    tint(CAMP.trim, 0x6b5644); tint(CAMP.mesh, 0x3a3a36); tint(CAMP.frame, 0x8a8d90); tint(CAMP.cushion, 0xe9e1d0); tint(CAMP.rug, 0xe6dcc8); tint(CAMP.steel, 0x2b2d30);
    CAMP.inside.emissive.setHex(night ? 0xffa040 : dusk ? 0x5a2c0c : 0x000000); CAMP.inside.emissiveIntensity = night ? 0.9 : 0.4;
    CAMP.rope.color.setHex(0xd8d2c0).multiplyScalar(Math.max(0.3, f));
    CAMP.flame.opacity = night ? 0.8 : dusk ? 0.7 : 0.55;
    [CAMP.trim, CAMP.mesh, CAMP.frame, CAMP.cushion, CAMP.rug, CAMP.steel, CAMP.inside].forEach(function (m) { m.envMapIntensity = envOut; });
    tint(CAMP.canopy, 0x3f7a55); tint(CAMP.stone, 0x6f6b66); tint(CAMP.hammock, 0x3b6fb0); tint(CAMP.chair, 0x4a5a48); tint(CAMP.cooler, 0xd9e4ea); tint(CAMP.lot, winter ? 0xd8dadb : 0x77736c); CAMP.lot.envMapIntensity = envOut;
    if (HORSE.mats) HORSE.mats.forEach(function (m) { m.color.setHex(m.userData.base).multiplyScalar(Math.max(0.2, f)); m.envMapIntensity = envOut; });
    CAMP.pine.forEach(function (m, i) { tint(m, winter ? [0x9fb0a4, 0xaebcb2, 0x8fa398][i] : [0x2f5a3c, 0x3a6a45, 0x274d35][i]); });
    CAMP.lamp.emissive.setHex(lit ? 0xffc46a : 0x000000);
    CAMP.flare.opacity = night ? 0.7 : dusk ? 0.35 : 0;
    CAMP.fuji.color.setHex(night ? 0x3d4270 : dusk ? 0xf2b9a0 : grey ? 0xc3c8cf : 0xffffff);
    var mt = mountainTex(o.season); if (CAMP.fuji.map !== mt) { CAMP.fuji.map = mt; CAMP.fuji.needsUpdate = true; }
    [CAMP.bank, CAMP.wood, CAMP.dirt, CAMP.canopy, CAMP.stone, CAMP.hammock, CAMP.chair, CAMP.cooler].concat(CAMP.tent, CAMP.pine).forEach(function (m) { m.envMapIntensity = envOut; });
    if (campFx) { campFx.night = night ? 1 : dusk ? 0.6 : grey ? 0.4 : 0.25; campFx.dark = night; }
    BIRD.mats.forEach(function (m) { m.color.setScalar(Math.max(0.35, f)); m.envMapIntensity = envOut; });
  }
  function addRiverCamp(w, back, front, gy, floorIdx) {
    var cz = (front + back) / 2, z0 = front + PLAZA_D + RIVER_GAP, z1 = z0 + RIVER_W, W = SCENE_R * 2;
    var farZ = cz + SCENE_R - 4, campZ1 = Math.min(z1 + CAMP_D, farZ - 18), hw = w / 2 + 4.6, r = rnd(907);
    var walk = floorIdx === 0 && cur === 0;
    RV = walk ? { z0: z0, z1: z1, cz1: campZ1, hw: hw, blocks: [], rects: [], seats: [], fire: null } : null;
    campFx = { night: 0.25, flames: [], light: null, t: 0, horses: [], paddock: null, group: null, birds: [], birdKinds: [], sky: { x: 0, y: gy, z: (z0 + z1) / 2 + 8 }, dark: false };
    function plane(wd, dp, mat, x, y, z) { var m = new T.Mesh(new T.PlaneGeometry(wd, dp), mat); m.rotation.x = -Math.PI / 2; return add(m, x, y, z); }
    function ubox(sx, sy, sz, mat, x, y, z) { var m = new T.Mesh(unitBox, mat); m.scale.set(sx, sy, sz); return add(m, x, y, z); }
    // 땅(강 이쪽·저쪽) + 강물(땅보다 낮게) + 돌 둑
    var nearD = z0 - (cz - SCENE_R), farD = cz + SCENE_R - z1;
    plane(W, nearD, M.grass, 0, gy, z0 - nearD / 2); plane(W, farD, M.grass, 0, gy, z1 + farD / 2);
    plane(W, RIVER_W, CAMP.water, 0, gy - 0.85, (z0 + z1) / 2);
    ubox(W, 1.0, 0.5, CAMP.bank, 0, gy - 0.5, z0 + 0.25); ubox(W, 1.0, 0.5, CAMP.bank, 0, gy - 0.5, z1 - 0.25);
    for (var i = 0; i < 26; i++) { var rk = new T.Mesh(rockGeo, CAMP.stone), rs = 0.3 + r() * 0.7; rk.scale.set(rs * 1.4, rs * 0.7, rs); rk.rotation.y = r() * 6;   // 물가 바위
      add(rk, (r() - 0.5) * W * 0.8, gy - 0.75, r() < 0.5 ? z0 + 1 + r() * 1.5 : z1 - 1 - r() * 1.5); }
    // 양옆 길(보도·차도)이 강을 건너는 다리: 상판 + 교각 + 난간
    [1, -1].forEach(function (side) {
      var mx = side * (w / 2 + 9);
      ubox(18.4, 0.5, RIVER_W + 1, M.parapet, mx, gy - 0.26, (z0 + z1) / 2);
      for (var pz = z0 + 5; pz < z1 - 2; pz += 9) ubox(16, 0.9, 1.0, M.parapet, mx, gy - 0.7, pz);
      [side * (w / 2 - 0.05), side * (w / 2 + 18.05)].forEach(function (rx) {
        ubox(0.08, 0.06, RIVER_W + 1, M.pole, rx, gy + 1.05, (z0 + z1) / 2); ubox(0.05, 0.05, RIVER_W + 1, M.pole, rx, gy + 0.55, (z0 + z1) / 2);
        for (var qz = z0 - 0.4; qz <= z1 + 0.5; qz += 2) ubox(0.07, 1.05, 0.07, M.pole, rx, gy + 0.52, qz);
      });
    });
    // 가운데 나무 보행교 (앞마당 → 캠핑장)
    var bz0 = front + PLAZA_D + 0.3, bl = z1 + 0.6 - bz0, bcz = bz0 + bl / 2;
    ubox(3.4, 0.16, bl, CAMP.wood, 0, gy - 0.02, bcz);
    for (var pl = bz0 + 0.3; pl < bz0 + bl; pl += 0.6) ubox(3.4, 0.02, 0.5, CAMP.wood, 0, gy + 0.07, pl);   // 널빤지 결
    for (var pz2 = z0 + 3.5; pz2 < z1 - 1; pz2 += 7) [-1.4, 1.4].forEach(function (px) { ubox(0.35, 1.1, 0.35, CAMP.wood, px, gy - 0.55, pz2); });
    [-1.7, 1.7].forEach(function (rx) {
      ubox(0.1, 0.08, bl, CAMP.wood, rx, gy + 1.05, bcz); ubox(0.06, 0.06, bl, CAMP.wood, rx, gy + 0.6, bcz);
      for (var qz = bz0; qz <= bz0 + bl + 0.01; qz += 2.2) ubox(0.12, 1.1, 0.12, CAMP.wood, rx, gy + 0.55, qz);
      [bz0 + 0.2, bz0 + bl - 0.2].forEach(function (lz) {   // 다리 양끝 등
        ubox(0.1, 2.4, 0.1, M.pole, rx, gy + 1.2, lz); var b = new T.Mesh(bulbGeo, CAMP.lamp); b.scale.setScalar(0.1); add(b, rx, gy + 2.5, lz);
        var fl = new T.Sprite(CAMP.flare); fl.scale.set(1.3, 1.3, 1); add(fl, rx, gy + 2.5, lz);
      });
    });
    // 먼 산 (경치 그림 바로 앞의 큰 판) + 캠핑장 뒤 침엽수 숲
    var fuji = new T.Mesh(new T.PlaneGeometry(250, 83), CAMP.fuji); fuji.rotation.y = Math.PI; add(fuji, 0, gy + 41.5 - 16, farZ);   // 아래 산줄기는 숲 뒤로 내려 앉힌다
    function pine(x, z, s) {
      var tr = new T.Mesh(pineTrunkGeo, M.trunk); tr.scale.setScalar(s * 0.8); add(tr, x, gy, z);
      var pn = new T.Mesh(pineTreeGeo, CAMP.pine[Math.floor(r() * 3)]); pn.scale.set(s * (0.72 + r() * 0.16), s * (0.74 + r() * 0.2), s * (0.72 + r() * 0.16)); pn.rotation.y = r() * 6; add(pn, x, gy - 0.3 * s, z);
    }
    for (var fx = -SCENE_R + 10; fx < SCENE_R - 10; fx += 3.2 + r() * 2.5) pine(fx, campZ1 + 13 + r() * 10, 1.3 + r() * 1.5);
    [1, -1].forEach(function (side) {   // 강 건너 길 바깥쪽도 숲
      for (var tz = z1 + 3; tz < campZ1 + 4; tz += 3.5 + r() * 2.5) for (var k = 0; k < 2; k++) pine(side * (w / 2 + 21 + k * 6 + r() * 5), tz + r() * 2, 1.2 + r() * 1.2);
    });
    // 캠핑장: 다리에서 이어지는 흙길, 텐트·타프·차·랜턴·모닥불·해먹
    plane(3.6, campZ1 - z1 - 6, CAMP.dirt, 0, gy + 0.015, z1 + (campZ1 - z1 - 6) / 2);
    plane(hw * 1.7, 3, CAMP.dirt, 0, gy + 0.014, z1 + 15);
    function block(x, z, rad) { if (RV) RV.blocks.push({ x: x, z: z, r: rad }); }
    function lantern(x, z, hgt) {
      ubox(0.06, hgt, 0.06, M.pole, x, gy + hgt / 2, z);
      var b = new T.Mesh(bulbGeo, CAMP.lamp); b.scale.setScalar(0.09); add(b, x, gy + hgt + 0.05, z);
      var fl = new T.Sprite(CAMP.flare); fl.scale.set(2.2, 2.2, 1); add(fl, x, gy + hgt + 0.05, z);
      var pool = new T.Mesh(poolGeo, M.lightPool); pool.rotation.x = -Math.PI / 2; add(pool, x, gy + 0.03, z);
    }
    function tent(kind, x, z, ry, mat) {   // 0 벨 텐트 · 1 티피 · 2 터널형 거실 텐트 · 3 흰 프레임 텐트 · 4 타프 쉘터 (앞은 +z)
      var g = new T.Group(); g.position.set(x, gy, z); g.rotation.y = ry; parent.add(g);
      function gm(geo, m, sx, sy, sz, px, py, pz) { var q = new T.Mesh(geo, m); q.scale.set(sx, sy, sz); q.position.set(px || 0, py || 0, pz || 0); g.add(q); return q; }
      function ropes(pts) {   // 당김줄: [x1,y1,z1, x2,y2,z2 …] + 끝마다 팩
        var lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); g.add(new T.LineSegments(lg, CAMP.rope));
        for (var k = 3; k < pts.length; k += 6) gm(unitBox, M.pole, 0.03, 0.16, 0.03, pts[k], 0.06, pts[k + 2]);
      }
      function tri(w0, h0, m) { var sh = new T.Shape(); sh.moveTo(-w0 / 2, 0); sh.lineTo(w0 / 2, 0); sh.lineTo(0, h0); sh.closePath(); return new T.Mesh(new T.ShapeGeometry(sh), m); }
      var rp = [], k0, a0;
      if (kind === 0) {   // 벨 텐트: 낮은 둥근 벽 + 원뿔 지붕, 앞에 ㅅ자 문
        gm(new T.CylinderGeometry(2.2, 2.2, 0.75, 12, 1, true), mat, 1, 1, 1, 0, 0.375, 0);
        gm(new T.ConeGeometry(2.34, 2.25, 12, 1, true), mat, 1, 1, 1, 0, 0.75 + 1.125, 0);
        gm(new T.CylinderGeometry(2.36, 2.36, 0.06, 12, 1, true), CAMP.trim, 1, 1, 1, 0, 0.75, 0);   // 처마 띠
        gm(new T.ConeGeometry(0.22, 0.3, 12), CAMP.trim, 1, 1, 1, 0, 3.05, 0); gm(unitBox, M.pole, 0.04, 0.25, 0.04, 0, 3.3, 0);
        var door = tri(1.25, 1.75, CAMP.inside); door.position.set(0, 0.02, 2.14); door.rotation.x = -0.36; g.add(door);
        [-1, 1].forEach(function (sd) { var fl = gm(unitBox, mat, 0.16, 1.5, 0.05, sd * 0.5, 0.8, 2.0); fl.rotation.set(-0.36, 0, sd * 0.33); gm(unitBox, M.pole, 0.035, 1.85, 0.035, sd * 0.33, 0.9, 1.93).rotation.set(-0.36, 0, sd * 0.34); });
        for (k0 = 0; k0 < 12; k0++) { a0 = (k0 + 0.5) / 12 * Math.PI * 2; if (Math.abs(Math.sin(a0)) < 0.3 && Math.cos(a0) > 0) continue; rp.push(Math.sin(a0) * 2.34, 0.75, Math.cos(a0) * 2.34, Math.sin(a0) * 3.5, 0, Math.cos(a0) * 3.5); }
        ropes(rp); block(x, z, 2.4);
      } else if (kind === 1) {   // 티피(피라미드): 여덟 면 원뿔 + 아래 치마, 앞면 지퍼 문 한쪽을 걷어 올림
        var cone = new T.ConeGeometry(2.3, 3.4, 8, 1, true); cone.rotateY(Math.PI / 8);
        var sk = new T.CylinderGeometry(2.3, 2.3, 0.28, 8, 1, true); sk.rotateY(Math.PI / 8);
        gm(cone, mat, 1, 1, 1, 0, 0.28 + 1.7, 0); gm(sk, CAMP.trim, 1, 1, 1, 0, 0.14, 0);
        gm(new T.ConeGeometry(0.3, 0.42, 8), CAMP.trim, 1, 1, 1, 0, 3.55, 0); gm(unitBox, M.pole, 0.04, 0.3, 0.04, 0, 3.85, 0);
        var ap = 2.3 * Math.cos(Math.PI / 8), tilt = Math.atan2(ap, 3.4);
        gm(unitBox, CAMP.trim, 0.035, 2.5, 0.02, 0, 0.28 + 1.2, ap * (1 - 1.2 / 3.4) + 0.02).rotation.x = -tilt;   // 지퍼 선
        var dr = tri(0.9, 1.7, CAMP.inside); dr.geometry.translate(0.45, 0, 0); dr.position.set(0.02, 0.3, ap * (1 - 0.02 / 3.4) + 0.03); dr.rotation.x = -tilt; g.add(dr);
        var roll = gm(new T.CylinderGeometry(0.07, 0.07, 1.5, 8), mat, 1, 1, 1, 0.62, 0.95, ap * 0.74 + 0.08); roll.rotation.set(-tilt, 0, -0.42);   // 말아 올린 문 자락
        var vent = tri(0.3, 0.22, CAMP.inside); vent.position.set(-0.25, 2.5, ap * (1 - 2.25 / 3.4) + 0.03); vent.rotation.x = -tilt; g.add(vent);
        for (k0 = 0; k0 < 8; k0++) { a0 = k0 / 8 * Math.PI * 2; if (k0 === 0) continue; rp.push(Math.sin(a0) * 2.3 * 0.62, 0.28 + 3.4 * 0.38, Math.cos(a0) * 2.3 * 0.62, Math.sin(a0) * 3.7, 0, Math.cos(a0) * 3.7); }
        ropes(rp); block(x, z, 2.2);
      } else if (kind === 2) {   // 터널형 거실 텐트: 긴 반원통 + 둥근 뒤 끝, 활대 넷, 앞에 폴 둘로 세운 차양
        var body = new T.CylinderGeometry(1.55, 1.55, 4.6, 18, 1, true, Math.PI / 2, Math.PI); body.rotateX(Math.PI / 2);
        gm(body, mat, 1, 1.22, 1, 0, 0, 0);
        gm(new T.SphereGeometry(1.55, 14, 8, Math.PI, Math.PI, 0, Math.PI / 2), CAMP.trim, 1, 1.22, 0.75, 0, 0, -2.3);
        var fr = new T.Mesh(new T.CircleGeometry(1.55, 18, 0, Math.PI), CAMP.trim); fr.scale.y = 1.22; fr.position.set(0, 0, 2.3); g.add(fr);
        var dm = new T.Mesh(new T.PlaneGeometry(1.3, 1.45), CAMP.inside); dm.position.set(0, 0.74, 2.32); g.add(dm);
        [-0.9, 0.9].forEach(function (wx) { var wn = new T.Mesh(new T.PlaneGeometry(0.42, 0.5), CAMP.mesh); wn.position.set(wx * 1.15, 0.75, 2.32); g.add(wn); });
        [-2.3, -0.77, 0.77, 2.3].forEach(function (pz) { var ar = new T.Mesh(new T.TorusGeometry(1.57, 0.024, 6, 20, Math.PI), M.pole); ar.scale.y = 1.22; ar.position.z = pz; g.add(ar); });
        [-1, 1].forEach(function (sd) { [-1.4, 0.2].forEach(function (wz) { var w2 = gm(unitBox, CAMP.mesh, 0.02, 0.5, 0.8, sd * 1.42, 0.85, wz); w2.rotation.z = sd * 0.42; }); });   // 옆 창 (모기장)
        var aw = gm(unitBox, mat, 2.9, 0.025, 2.3, 0, 1.82, 3.4); aw.rotation.x = 0.07;                                                // 차양
        [-1.38, 1.38].forEach(function (px) { gm(unitBox, M.pole, 0.035, 1.78, 0.035, px, 0.89, 4.5); rp.push(px, 1.76, 4.5, px * 1.5, 0, 5.9); });
        [-1, 1].forEach(function (sd) { [-2.3, 0, 2.3].forEach(function (pz) { rp.push(sd * 1.5, 0.75, pz, sd * 2.5, 0, pz); }); });
        ropes(rp);
        [-1.4, 1.4].forEach(function (o) { block(x + Math.sin(ry) * o, z + Math.cos(ry) * o, 1.9); });
      } else if (kind === 3) {   // 흰 프레임 텐트: 둥근 상자 천 + 회색 폴대, 앞을 양옆으로 묶어 연 자락, 안에 쿠션, 아래 러그
        gm(rbox(2.3, 1.75, 2.3, 0.32), mat, 1, 1, 1, 0, 0.875, 0);
        var rg = new T.Mesh(new T.PlaneGeometry(3.0, 3.0), CAMP.rug); rg.rotation.x = -Math.PI / 2; rg.position.y = 0.02; g.add(rg);
        var op = new T.Mesh(new T.PlaneGeometry(1.5, 1.4), CAMP.inside); op.position.set(0, 0.72, 1.157); g.add(op);
        [-1, 1].forEach(function (sd) {
          var dp = gm(rbox(0.5, 1.4, 0.07, 0.03), mat, 1, 1, 1, sd * 0.62, 0.74, 1.19); dp.rotation.z = -sd * 0.16;                     // 묶은 자락
          gm(unitBox, CAMP.trim, 0.2, 0.035, 0.09, sd * 0.56, 0.8, 1.2);
          [-1, 1].forEach(function (sz) { gm(new T.CylinderGeometry(0.02, 0.02, 1.5, 6), CAMP.frame, 1, 1, 1, sd * 1.17, 0.75, sz * 1.17); });   // 모서리 폴
          var ar = new T.Mesh(new T.TorusGeometry(1.17, 0.02, 6, 14, Math.PI), CAMP.frame); ar.scale.y = 0.36; ar.position.set(0, 1.45, sd * 1.17); g.add(ar);
          var ar2 = new T.Mesh(new T.TorusGeometry(1.17, 0.02, 6, 14, Math.PI), CAMP.frame); ar2.scale.y = 0.36; ar2.rotation.y = Math.PI / 2; ar2.position.set(sd * 1.17, 1.45, 0); g.add(ar2);
        });
        gm(rbox(0.55, 0.45, 0.16, 0.07), CAMP.cushion, 1, 1, 1, -0.3, 0.3, 0.95).rotation.x = -0.4;
        gm(rbox(0.5, 0.42, 0.16, 0.07), CAMP.cushion, 1, 1, 1, 0.28, 0.32, 0.8).rotation.set(-0.3, 0.3, 0);
        gm(rbox(0.55, 0.14, 0.4, 0.06), CAMP.cushion, 1, 1, 1, 0.45, 0.09, 1.1);
        block(x, z, 1.75);
      } else {   // 타프 쉘터 (맞배 지붕 천 + 기둥) - 아래로 지나다닐 수 있다
        [-1, 1].forEach(function (s) { var p = gm(unitBox, mat, 2.9, 0.03, 4.6, s * 1.25, 2.05, 0); p.rotation.z = -s * 0.55; });
        [-2.3, 2.3].forEach(function (pz) { gm(unitBox, M.pole, 0.06, 2.8, 0.06, 0, 1.4, pz); rp.push(0, 2.78, pz, 0, 0, pz + (pz > 0 ? 2.2 : -2.2)); });
        [-1, 1].forEach(function (s) { [-2.3, 2.3].forEach(function (pz) { gm(unitBox, M.pole, 0.05, 1.3, 0.05, s * 2.45, 0.65, pz); rp.push(s * 2.45, 1.3, pz, s * 3.5, 0, pz + (pz > 0 ? 0.8 : -0.8)); }); });
        rp.push(0, 2.78, -2.3, 0, 2.78, 2.3); ropes(rp);
      }
      return g;
    }
    function chair(x, z, rot, free) {   // 캠핑 의자 (빈 의자는 앉을 수 있다)
      var g = new T.Group(); g.position.set(x, gy, z); g.rotation.y = rot; parent.add(g);
      var s = new T.Mesh(unitBox, CAMP.chair); s.scale.set(0.5, 0.05, 0.46); s.position.y = 0.42; g.add(s);
      var b = new T.Mesh(unitBox, CAMP.chair); b.scale.set(0.5, 0.5, 0.05); b.position.set(0, 0.68, -0.24); b.rotation.x = -0.18; g.add(b);
      [[-0.23, -0.2], [0.23, -0.2], [-0.23, 0.2], [0.23, 0.2]].forEach(function (q) { var l = new T.Mesh(unitBox, M.pole); l.scale.set(0.03, 0.42, 0.03); l.position.set(q[0], 0.21, q[1]); g.add(l); });
      if (free && walk) addSeat(x, z, rot, 0.44); else if (RV) RV.seats.push({ x: x, z: z, rot: rot });
    }
    function table(x, z) {
      ubox(1.2, 0.05, 0.7, CAMP.wood, x, gy + 0.62, z); [[-0.5, -0.28], [0.5, -0.28], [-0.5, 0.28], [0.5, 0.28]].forEach(function (q) { ubox(0.04, 0.62, 0.04, M.pole, x + q[0], gy + 0.31, z + q[1]); });
      ubox(0.5, 0.36, 0.34, CAMP.cooler, x + 0.9, gy + 0.18, z + 0.1);
      var b = new T.Mesh(bulbGeo, CAMP.lamp); b.scale.set(0.09, 0.12, 0.09); add(b, x - 0.3, gy + 0.75, z);
      var fl = new T.Sprite(CAMP.flare); fl.scale.set(1.6, 1.6, 1); add(fl, x - 0.3, gy + 0.78, z);
      block(x, z, 0.8);
    }
    // 모닥불 (가운데 길 옆 빈터) + 둘러앉는 의자
    var fxp = 7.5, fzp = z1 + 9;
    // 화롯대: 네 다리 위 네모 쇠 화로에 장작 몇 개, 숯불과 작은 불꽃 (불빛은 은은하게)
    var pit = new T.Mesh(new T.CylinderGeometry(0.46, 0.22, 0.24, 4, 1, true), CAMP.steel); pit.rotation.y = Math.PI / 4; add(pit, fxp, gy + 0.5, fzp);
    var pitB = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.02, 4), CAMP.steel); pitB.rotation.y = Math.PI / 4; add(pitB, fxp, gy + 0.385, fzp);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (q) { var lg0 = ubox(0.025, 0.46, 0.025, CAMP.steel, fxp + q[0] * 0.27, gy + 0.2, fzp + q[1] * 0.27); lg0.rotation.set(q[1] * 0.22, 0, -q[0] * 0.22); });
    var ember = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.03, 10), CAMP.ember); add(ember, fxp, gy + 0.41, fzp);
    [0.3, 1.4, 2.5].forEach(function (a1, ai) { var lg = new T.Mesh(new T.CylinderGeometry(0.04, 0.045, 0.56, 7), CAMP.wood); lg.rotation.set(Math.PI / 2 - 0.25, a1, 0); add(lg, fxp + Math.sin(a1) * 0.04, gy + 0.5 + ai * 0.02, fzp + Math.cos(a1) * 0.04); });
    for (var fi = 0; fi < 3; fi++) { var fm = new T.Mesh(flameGeo, CAMP.flame); add(fm, fxp + (r() - 0.5) * 0.16, gy + 0.68, fzp + (r() - 0.5) * 0.16); campFx.flames.push({ m: fm, ph: r() * 6, y: gy + 0.68, k: 0.42 + fi * 0.08 }); }
    var fglow = new T.Sprite(CAMP.flare); fglow.scale.set(1.1, 1.1, 1); add(fglow, fxp, gy + 0.7, fzp);
    if (walk) { var fl0 = new T.PointLight(0xff9a3a, 0, 9, 2); add(fl0, fxp, gy + 0.9, fzp); campFx.light = fl0; }
    for (var wd = 0; wd < 7; wd++) { var wl = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.5, 7), CAMP.wood); wl.rotation.z = Math.PI / 2; add(wl, fxp + 1.35, gy + 0.06 + Math.floor(wd / 3) * 0.1, fzp - 0.9 + (wd % 3) * 0.11 + Math.floor(wd / 3) * 0.05); }   // 옆에 쌓아 둔 장작
    block(fxp, fzp, 0.75); if (RV) RV.fire = { x: fxp, z: fzp };
    for (var ci = 0; ci < 6; ci++) { var ca = ci / 6 * Math.PI * 2 + 0.3, cx1 = fxp + Math.sin(ca) * 2.1, cz1 = fzp + Math.cos(ca) * 2.1; chair(cx1, cz1, ca + Math.PI, ci % 2 === 1); }
    // 텐트 자리: 가운데 길(|x|<3)과 모닥불 둘레를 피해 줄지어
    // 주차장 (길 쪽 한편에 줄지어) - 차는 텐트 사이에 두지 않는다
    function inRect(R, x, z, m) { return x > R.x0 - m && x < R.x1 + m && z > R.z0 - m && z < R.z1 + m; }
    var nCars = 5, PK = { x0: hw - 7.2, x1: hw - 0.2, z0: z1 + 2.2, z1: z1 + 2.2 + nCars * 3.0 + 0.6 };
    plane(PK.x1 - PK.x0, PK.z1 - PK.z0, M.road, (PK.x0 + PK.x1) / 2, gy + 0.016, (PK.z0 + PK.z1) / 2).material = CAMP.lot;
    for (var pk = 0; pk <= nCars; pk++) ubox(5.2, 0.02, 0.1, CAMP.cooler, PK.x0 + 3.4, gy + 0.03, PK.z0 + 0.3 + pk * 3.0);   // 주차 칸 선
    for (var pc = 0; pc < nCars; pc++) {
      ubox(1.9, 0.14, 0.2, M.parapet, PK.x1 - 0.5, gy + 0.07, PK.z0 + 1.8 + pc * 3.0).rotation.y = Math.PI / 2;   // 바퀴 멈춤턱
      if (pc === 3) continue;   // 한 칸은 비워 둔다
      var pcar = makeCar(r); pcar.position.set(PK.x0 + 3.6 + (r() - 0.5) * 0.4, gy, PK.z0 + 1.8 + pc * 3.0); pcar.rotation.y = (r() < 0.7 ? 1 : -1) * Math.PI / 2 + (r() - 0.5) * 0.06; parent.add(pcar);
    }
    var psign = new T.Mesh(new T.PlaneGeometry(0.8, 0.8), new T.MeshBasicMaterial({ map: textTex(['P'], 128, 128, '#1f4fa8', '#ffffff', 100), toneMapped: false })); psign.rotation.y = -Math.PI / 2;
    add(psign, PK.x0 - 0.1, gy + 2.3, PK.z0 + 0.3); ubox(0.08, 2.7, 0.08, M.pole, PK.x0 - 0.05, gy + 1.35, PK.z0 + 0.3);
    lantern(PK.x0 - 0.3, PK.z1 - 0.3, 2.6);
    if (RV) RV.rects.push(PK);
    // 말 방목장 (캠핑장 안쪽 왼편, 나무 울타리 안을 말들이 달린다)
    var PD = { x0: -hw + 1, x1: -hw + 18, z0: campZ1 - 14, z1: campZ1 - 1 };
    [[PD.x0, PD.z0, PD.x1, PD.z0], [PD.x0, PD.z1, PD.x1, PD.z1], [PD.x0, PD.z0, PD.x0, PD.z1], [PD.x1, PD.z0, PD.x1, PD.z1]].forEach(function (e) {
      var len = Math.hypot(e[2] - e[0], e[3] - e[1]), alongX = e[1] === e[3];
      [0.55, 1.05].forEach(function (y) { ubox(alongX ? len : 0.07, 0.09, alongX ? 0.07 : len, CAMP.wood, (e[0] + e[2]) / 2, gy + y, (e[1] + e[3]) / 2); });
      for (var d0 = 0; d0 <= len + 0.01; d0 += len / Math.round(len / 2.4)) ubox(0.14, 1.25, 0.14, CAMP.wood, e[0] + (alongX ? d0 : 0), gy + 0.62, e[1] + (alongX ? 0 : d0));
    });
    plane(PD.x1 - PD.x0 - 1.5, PD.z1 - PD.z0 - 1.5, CAMP.dirt, (PD.x0 + PD.x1) / 2, gy + 0.013, (PD.z0 + PD.z1) / 2);
    ubox(1.6, 0.5, 0.6, CAMP.wood, PD.x1 - 1.6, gy + 0.3, PD.z0 + 1.2);   // 물통
    if (RV) RV.rects.push(PD);
    campFx.paddock = { cx: (PD.x0 + PD.x1) / 2, cz: (PD.z0 + PD.z1) / 2, rx: (PD.x1 - PD.x0) / 2 - 2.2, rz: (PD.z1 - PD.z0) / 2 - 2.2, gy: gy };
    campFx.group = parent; addHorses(); addBirds();
    var spots = [], rowsN = Math.max(2, Math.floor((campZ1 - z1 - 8) / 9.5));
    for (var ry0 = 0; ry0 < rowsN; ry0++) for (var sx0 = -hw + 4.5; sx0 <= hw - 4.5; sx0 += 8.2) {
      var tx = sx0 + (r() - 0.5) * 2, tz2 = z1 + 6 + ry0 * 9.5 + (r() - 0.5) * 2 + (ry0 === 0 ? 0 : 3);
      if (Math.abs(tx) < 4.2 || Math.hypot(tx - fxp, tz2 - fzp) < 6.5 || Math.abs(tz2 - (z1 + 15)) < 3.2) continue;
      if (inRect(PK, tx, tz2, 3.2) || inRect(PD, tx, tz2, 3.4)) continue;   // 주차장·말 방목장 자리는 비운다
      spots.push([tx, tz2]);
    }
    spots.forEach(function (sp, si) {
      var kind = si % 5, light = [0, 1, 5, 6], dark = [2, 3, 4, 7], mat = CAMP.tent[kind === 3 ? 1 : (kind === 2 || kind === 4 ? dark : light)[Math.floor(r() * 4)]], ry = Math.atan2(-sp[0], z1 + 15 - sp[1]) + (r() - 0.5) * 0.8;
      tent(kind, sp[0], sp[1], ry, mat);
      if (kind === 4) { table(sp[0], sp[1]); chair(sp[0] - 1.2, sp[1] + 0.9, 1.2, true); chair(sp[0] + 0.3, sp[1] - 1.1, -0.3, false); }
      else if (kind === 2) { var ax0 = sp[0] + Math.sin(ry) * 3.6, az0 = sp[1] + Math.cos(ry) * 3.6; chair(ax0 - Math.cos(ry) * 0.7, az0 + Math.sin(ry) * 0.7, ry, true); chair(ax0 + Math.cos(ry) * 0.7, az0 - Math.sin(ry) * 0.7, ry, false); }   // 차양 아래 의자
      if (r() < 0.75) lantern(sp[0] + Math.sin(ry + 0.9) * 3.9, sp[1] + Math.cos(ry + 0.9) * 3.9, 1.5 + r() * 0.6);
    });
    // 줄 전구 (기둥 사이에 늘어뜨린 작은 전구)
    [[-hw + 3, z1 + 4.5, -6, z1 + 4.5], [5, z1 + 20.5, hw - 4, z1 + 20.5]].forEach(function (ln) {
      ubox(0.07, 2.9, 0.07, M.pole, ln[0], gy + 1.45, ln[1]); ubox(0.07, 2.9, 0.07, M.pole, ln[2], gy + 1.45, ln[3]);
      var n = Math.max(6, Math.floor(Math.abs(ln[2] - ln[0]) / 1.3));
      for (var k = 1; k < n; k++) { var t = k / n, b = new T.Mesh(bulbGeo, CAMP.lamp); b.scale.setScalar(0.07); add(b, ln[0] + (ln[2] - ln[0]) * t, gy + 2.85 - Math.sin(t * Math.PI) * 0.55, ln[1]); }
    });
    // 해먹 (스탠드 둘 사이에 처진 천)
    var hx = -8.5, hz = z1 + 9.5;
    [-1.7, 1.7].forEach(function (o) { [-0.35, 0.35].forEach(function (s) { var lg2 = ubox(0.06, 1.5, 0.06, M.pole, hx + o + s * 0.4, gy + 0.7, hz); lg2.rotation.z = s * 0.9; }); });
    for (var hk = 0; hk < 9; hk++) { var ht = (hk + 0.5) / 9, hs = ubox(0.4, 0.03, 0.85, CAMP.hammock, hx - 1.6 + ht * 3.2, gy + 1.25 - Math.sin(ht * Math.PI) * 0.6, hz); hs.rotation.z = -Math.cos(ht * Math.PI) * 0.55; }
    block(hx, hz, 1.6); lantern(hx + 2.6, hz + 0.8, 1.8);
  }
  // 말: three.js 예제 webgl_morphtargets_horse의 Horse.glb (모양 변형으로 달리는 동작). 모형은 볼 때 CDN에서 받는다.
  var HORSE = { mesh: null, clip: null, scale: 1, lift: 0, mats: null };
  function loadHorse() {
    if (!T.GLTFLoader) return;
    new T.GLTFLoader().load(MODEL_BASE + 'Horse.glb', function (gl) {
      var mesh = null; gl.scene.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh || !gl.animations.length) return;
      mesh.geometry.userData.shared = true;
      HORSE.scale = 1.75 / 190; HORSE.lift = 0;   // 모형 키가 190쯤(발이 바닥) - 모양 변형 모형이라 상자로는 잴 수 없다
      HORSE.mats = [0xffffff, 0xd8c3a5, 0x8a6a52].map(function (c) { var m = mesh.material.clone(); m.userData.keep = true; m.userData.envSet = true; m.userData.base = c; m.morphTargets = true; return m; });
      HORSE.mesh = mesh; HORSE.clip = gl.animations[0];
      addHorses(); applyOutside.force = true; applyOutside();
    }, undefined, function (e) { console.warn('3D 서재 말 모형:', e && e.message); });
  }
  function addHorses() {   // 방목장을 도는 말 세 마리 (모형을 받은 뒤, 층을 지을 때마다)
    if (!HORSE.mesh || !campFx || !campFx.paddock || !campFx.group || campFx.horses.length) return;
    for (var i = 0; i < 3; i++) {
      var h = new T.Mesh(HORSE.mesh.geometry, HORSE.mats[i]); h.scale.setScalar(HORSE.scale * (1 - i * 0.07)); h.castShadow = false;
      if (HORSE.mesh.morphTargetInfluences) { h.morphTargetInfluences = HORSE.mesh.morphTargetInfluences.slice(); h.morphTargetDictionary = HORSE.mesh.morphTargetDictionary; }
      var mx = new T.AnimationMixer(h); mx.clipAction(HORSE.clip).setDuration(0.9 + i * 0.08).play(); mx.update(i * 0.31);
      campFx.group.add(h);
      campFx.horses.push({ m: h, mixer: mx, a: i * 2.1, k: 1 - i * 0.12, lift: HORSE.lift * (1 - i * 0.07) });
    }
    updateCamp(0, performance.now());
  }
  // 새: three.js 예제 webgl_lights_hemisphere의 Flamingo.glb와 같은 묶음의 Stork·Parrot (날갯짓 모양 변형). 강과 캠핑장 위를 돈다.
  var BIRD = { kinds: [], mats: [] };
  function loadBirds() {
    if (!T.GLTFLoader) return;
    [['Stork.glb', 0.016], ['Flamingo.glb', 0.016], ['Parrot.glb', 0.013]].forEach(function (b) {
      new T.GLTFLoader().load(MODEL_BASE + b[0], function (gl) {
        var mesh = null; gl.scene.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh || !gl.animations.length) return;
        mesh.geometry.userData.shared = true;
        var m = mesh.material.clone(); m.userData.keep = true; m.userData.envSet = true; m.morphTargets = true; m.fog = false; BIRD.mats.push(m);
        BIRD.kinds.push({ mesh: mesh, mat: m, clip: gl.animations[0], scale: b[1] });
        addBirds(); applyOutside.force = true; applyOutside();
      }, undefined, function (e) { console.warn('3D 서재 새 모형:', e && e.message); });
    });
  }
  function addBirds() {   // 받은 종류마다 몇 마리씩 (층을 지을 때마다 다시)
    if (!campFx || !campFx.group || !campFx.sky) return;
    BIRD.kinds.forEach(function (k, ki) {
      if (campFx.birdKinds.indexOf(k) >= 0) return;
      campFx.birdKinds.push(k);
      var r = rnd(331 + ki * 17), n = ki === 0 ? 3 : 2;
      for (var i = 0; i < n; i++) {
        var b = new T.Mesh(k.mesh.geometry, k.mat); b.scale.setScalar(k.scale * (0.85 + r() * 0.3));
        if (k.mesh.morphTargetInfluences) { b.morphTargetInfluences = k.mesh.morphTargetInfluences.slice(); b.morphTargetDictionary = k.mesh.morphTargetDictionary; }
        var mx = new T.AnimationMixer(b); mx.clipAction(k.clip).setDuration(0.9 + r() * 0.5).play(); mx.update(r());
        campFx.group.add(b);
        campFx.birds.push({ m: b, mixer: mx, a: r() * 6.28, rad: 22 + r() * 34, h: 13 + r() * 14, sp: (0.1 + r() * 0.08) * (r() < 0.5 ? 1 : -1), ox: (r() - 0.5) * 30, oz: (r() - 0.5) * 24, ph: r() * 6 });
      }
    });
  }
  function campWalk(x, z) {   // 가운데 나무다리 + 캠핑장 풀밭 (텐트·차·모닥불은 돌아서)
    if (!RV || !layout) return false;
    if (Math.abs(x) < 1.45 && z >= layout.front + PLAZA_D - 0.5 && z <= RV.z1 + 1) return true;
    if (Math.abs(x) <= RV.hw && z >= RV.z1 + 0.6 && z <= RV.cz1) {
      for (var i = 0; i < RV.blocks.length; i++) { var b = RV.blocks[i]; if (Math.hypot(x - b.x, z - b.z) < b.r) return false; }
      for (var j = 0; j < RV.rects.length; j++) { var R = RV.rects[j]; if (x > R.x0 - 0.3 && x < R.x1 + 0.3 && z > R.z0 - 0.3 && z < R.z1 + 0.3) return false; }   // 주차장·방목장 울타리 안
      return true;
    }
    return false;
  }
  function spawnCampers(seed, place) {   // 캠핑하는 사람들: 모닥불가에 앉은 사람, 서서 이야기하는 사람, 산을 보는 사람
    if (!RV) return;
    var r = rnd(seed * 211 + 5), n = 0;
    function mk() { return makePerson(seed * 223 + 41 + (n++) * 37); }
    RV.seats.forEach(function (s, i) {   // 의자에 앉은 사람 (관절 모형은 의자 옆에 선다)
      if (i > 5) return;
      var p = mk();
      if (p.mixer) { p.kind = 'staff'; place(p, s.x + Math.sin(s.rot) * 0.7, s.z + Math.cos(s.rot) * 0.7, s.rot); setLook(p, 'calm'); }
      else { p.kind = 'sit'; place(p, s.x, s.z, s.rot); p.body.position.y = -0.5; p.legL.rotation.x = -1.5; p.legR.rotation.x = -1.5; }
    });
    var f = RV.fire;
    [[-5.5, 13.5, 0.9], [-4.5, 14.2, -2.2], [4.5, 24, Math.PI], [-12, 5, Math.PI]].forEach(function (q, i) {   // 서 있는 사람: 둘은 마주 보고, 둘은 산·강을 본다
      var p = mk(); p.kind = i < 2 ? 'chat' : 'staff'; place(p, q[0], RV.z1 + q[1], i === 2 ? 0 : q[2]); if (p.mixer) setLook(p, 'calm');
    });
    if (f) { var w0 = mk(); w0.kind = 'staff'; place(w0, f.x - 1.3, f.z + 2.6, Math.atan2(1.3, -2.6)); if (w0.mixer) setLook(w0, 'calm'); }   // 불 쬐며 선 사람
  }
  function updateCamp(dt, now) {   // 모닥불 일렁임 + 강물 흐름
    if (!campFx) return;
    waterTex.offset.x = (now / 9000) % 1; waterTex.offset.y = Math.sin(now / 5000) * 0.02;
    for (var i = 0; i < campFx.flames.length; i++) {
      var f = campFx.flames[i], s = 0.75 + Math.sin(now / 90 + f.ph) * 0.2 + Math.sin(now / 37 + f.ph * 2) * 0.1;
      var fk = f.k || 1; f.m.scale.set((0.8 + s * 0.3) * fk, s * fk, (0.8 + s * 0.3) * fk); f.m.position.y = f.y + (s - 0.75) * 0.12;
    }
    var P = campFx.paddock;
    for (var hi = 0; hi < campFx.horses.length; hi++) {   // 말: 울타리 안 타원 길을 따라 달린다
      var H = campFx.horses[hi], rk = 1 - hi * 0.13;
      H.mixer.update(dt); H.a += dt * 0.85 * H.k;
      var hx = Math.sin(H.a) * P.rx * rk, hz = Math.cos(H.a) * P.rz * rk;
      H.m.position.set(P.cx + hx, P.gy + H.lift, P.cz + hz);
      H.m.rotation.y = Math.atan2(Math.cos(H.a) * P.rx * rk, -Math.sin(H.a) * P.rz * rk);
    }
    for (var bi = 0; bi < campFx.birds.length; bi++) {   // 새: 높이를 조금씩 바꾸며 큰 원을 그린다 (밤에는 쉰다)
      var B = campFx.birds[bi], S = campFx.sky;
      B.m.visible = !campFx.dark; if (campFx.dark) continue;
      B.mixer.update(dt); B.a += dt * B.sp;
      B.m.position.set(S.x + B.ox + Math.sin(B.a) * B.rad, S.y + B.h + Math.sin(now / 4000 + B.ph) * 1.5, S.z + B.oz + Math.cos(B.a) * B.rad * 0.7);
      B.m.rotation.y = Math.atan2(Math.cos(B.a) * B.rad * B.sp, -Math.sin(B.a) * B.rad * 0.7 * B.sp);
      B.m.rotation.z = -0.25 * (B.sp > 0 ? 1 : -1);   // 도는 쪽으로 살짝 기울인다
    }
    if (campFx.light) campFx.light.intensity = campFx.night * (0.75 + Math.sin(now / 160) * 0.08 + Math.sin(now / 67) * 0.05);   // 은은하게
  }
  // ── 1층 출입문 + 바깥 앞마당 (도서관 밖으로 나가 보기) ──
  var DOOR_W = 3.6, DOOR_H = 2.9, PLAZA_D = 9, autoDoor = null, CINE_WALL = null;
  var glassDoorMat = new T.MeshStandardMaterial({ color: 0xcfe3ee, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false, side: T.DoubleSide });
  glassDoorMat.userData.keep = true;
  // ── 바깥에서 본 서재 (1층에서 나갔을 때만): 현대 건축풍 외장 ──
  // 안쪽 벽 바로 바깥에 얇은 외장을 한 겹 씌운다 → 서재 안은 그대로, 창·문 위치도 그대로 맞는다.
  // 1층: 돌 받침 + 문 양옆 커튼월(짙은 유리 + 금속 멀리언), 금속 문틀, 원목 처마의 캐노피와 간판, 옆벽은 돌 기둥 사이 창 + 금속 핀
  // 위층: 층마다 돌 띠 + 띠창, 둘레를 도는 세로 핀, 앞 왼쪽 모서리엔 층을 꿰뚫는 '책등' 벽(색색의 거대한 책), 옥상 난간·화단·간판
  var EXT = {
    stone: new T.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.85 }),
    metal: new T.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.38, metalness: 0.6 }),
    glass: new T.MeshStandardMaterial({ color: 0x23374a, roughness: 0.06, metalness: 0.55, emissive: 0x000000 }),
    soffit: new T.MeshStandardMaterial({ color: 0xb98a5a, roughness: 0.7 }),
    lamp: new T.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0x000000 }),
    spine: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })
  };
  Object.keys(EXT).forEach(function (k) { EXT[k].userData.keep = true; });
  function extNight(night, dusk) {   // applyOutside에서: 밤엔 유리 안쪽이 따뜻하게, 캐노피 조명 켜짐
    EXT.glass.emissive.setHex(night ? 0x120c05 : dusk ? 0x080502 : 0x000000);
    EXT.lamp.emissive.setHex(night || dusk ? 0xffe2a8 : 0x000000);
  }
  function instBoxes(list, mat, colors) {   // [x, y, z, sx, sy, sz] 여러 개를 InstancedMesh 하나로
    if (!list.length) return null;
    var im = new T.InstancedMesh(unitBox, mat, list.length), m4 = new T.Matrix4(), q = new T.Quaternion(), c = new T.Color();
    list.forEach(function (b, i) {
      m4.compose(new T.Vector3(b[0], b[1], b[2]), q, new T.Vector3(b[3], b[4], b[5])); im.setMatrixAt(i, m4);
      if (colors) im.setColorAt(i, c.setHex(colors[i]));
    });
    im.castShadow = true; im.receiveShadow = true; parent.add(im);
    return im;
  }
  function addFacade(w, back, front) {
    var d = front - back, cz = (front + back) / 2, up = Math.max(1, floors.length) - 1, fh = 4.5, top = CEIL + up * fh;
    var fins = [], frames = [], stones = [];
    // ── 1층 앞면: 돌 받침·머리띠, 문 양옆 커튼월 ──
    stones.push([0, 0.15, front + 0.13, w + 0.5, 0.3, 0.06], [0, 4.95, front + 0.13, w + 0.5, 0.9, 0.06]);
    [-1, 1].forEach(function (sd) {
      var x0 = DOOR_W / 2 + 0.6, x1 = w / 2 + 0.2, cw = x1 - x0, cx = sd * (x0 + cw / 2);
      var gl = new T.Mesh(unitBox, EXT.glass); gl.scale.set(cw, 4.2, 0.05); gl.position.set(cx, 2.4, front + 0.13); parent.add(gl);
      for (var mx = x0; mx <= x1 + 0.01; mx += 1.6) frames.push([sd * mx, 2.4, front + 0.18, 0.07, 4.2, 0.1]);   // 세로 멀리언
      frames.push([cx, 3.3, front + 0.18, cw, 0.06, 0.1]);   // 가로 띠
      stones.push([sd * (DOOR_W / 2 + 0.3), 2.4, front + 0.13, 0.6, 4.2, 0.06]);   // 문 옆 돌 기둥
    });
    // 금속 문틀 (앞으로 튀어나온 액자)
    frames.push([0, DOOR_H + 0.18, front + 0.25, DOOR_W + 0.9, 0.26, 0.3]);
    [-1, 1].forEach(function (sd) { frames.push([sd * (DOOR_W / 2 + 0.32), (DOOR_H + 0.3) / 2, front + 0.25, 0.26, DOOR_H + 0.3, 0.3]); });
    // ── 캐노피: 원목 처마 + 금속 테두리 + 간판 + 아래 조명, 가는 기둥 둘 ──
    var cw2 = 9.5, cd = 3.2, cy = 3.65;
    var slab = new T.Mesh(unitBox, EXT.metal); slab.scale.set(cw2, 0.46, cd); slab.position.set(0, cy, front + cd / 2); slab.castShadow = true; parent.add(slab);
    var sof = new T.Mesh(new T.PlaneGeometry(cw2 - 0.2, cd - 0.1), EXT.soffit); sof.rotation.x = Math.PI / 2; sof.position.set(0, cy - 0.235, front + cd / 2); parent.add(sof);
    for (var li = 0; li < 6; li++) {
      var lp = new T.Mesh(new T.CircleGeometry(0.11, 16), EXT.lamp); lp.rotation.x = Math.PI / 2;
      lp.position.set((li % 3 - 1) * 2.6, cy - 0.24, front + 1 + Math.floor(li / 3) * 1.4); parent.add(lp);
    }
    [-1, 1].forEach(function (sd) { var col = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, cy, 12), EXT.metal); col.position.set(sd * (cw2 / 2 - 0.4), cy / 2, front + cd - 0.3); col.castShadow = true; parent.add(col); });
    var outTex = textTex(['BookOasis 3D 서재'], 1800, 84, '#2a2e34', '#f5f2ec', 58);   // 캐노피 앞면 간판 (판과 같은 비율)
    var outSign = new T.Mesh(new T.PlaneGeometry(cw2, 0.44), new T.MeshBasicMaterial({ map: outTex, toneMapped: false }));
    outSign.position.set(0, cy, front + cd + 0.006); parent.add(outSign);
    // ── 옆면: 창 사이 돌 기둥, 창틀, 세로 핀 ──
    var wins = []; for (var wz0 = front - 6; wz0 > back + 3; wz0 -= 7) wins.push(wz0);
    [-1, 1].forEach(function (sd) {
      var x = sd * (w / 2 + 0.13);
      stones.push([x, 0.25, cz, 0.06, 0.5, d + 0.26], [x, (CEIL + 4.1) / 2, cz, 0.06, CEIL - 4.1, d + 0.26]);
      var edges = [back - 0.13]; wins.slice().sort(function (a, b) { return a - b; }).forEach(function (wz) { edges.push(wz - 2.7, wz + 2.7); }); edges.push(front + 0.13);
      for (var i = 0; i < edges.length; i += 2) if (edges[i + 1] - edges[i] > 0.01) stones.push([x, 2.3, (edges[i] + edges[i + 1]) / 2, 0.06, 3.6, edges[i + 1] - edges[i]]);
      wins.forEach(function (wz) {
        frames.push([x + sd * 0.06, 0.47, wz, 0.16, 0.06, 5.5], [x + sd * 0.06, 4.13, wz, 0.16, 0.06, 5.5]);   // 창 위·아래 금속 테
        [-2.75, 2.75].forEach(function (o) { fins.push([x + sd * 0.17, 2.3, wz + o, 0.3, 4.6, 0.08]); });     // 창 양옆 세로 핀
      });
    });
    // 뒷면
    stones.push([0, CEIL / 2, back - 0.13, w + 0.5, CEIL, 0.06]);
    // ── 위층: 돌 몸통 + 층마다 띠창 + 둘레 세로 핀 ──
    for (var k = 1; k <= up; k++) {
      var y0 = CEIL + 0.03 + (k - 1) * fh;   // 천장과 겹쳐 깜빡이지 않게 살짝 위
      add(new T.Mesh(new T.BoxGeometry(w + 0.4, fh, d + 0.4), EXT.stone), 0, y0 + fh / 2, cz);
      add(new T.Mesh(new T.BoxGeometry(w + 0.46, 2.7, d + 0.46), EXT.glass), 0, y0 + 2.05, cz);
      frames.push([0, y0 + 0.02, cz, w + 0.6, 0.12, d + 0.6]);   // 층 경계 금속 띠
      for (var fx = -w / 2 + 0.9; fx <= w / 2 - 0.9; fx += 1.8) { fins.push([fx, y0 + 2.05, front + 0.3, 0.07, 2.7, 0.16], [fx, y0 + 2.05, back - 0.3, 0.07, 2.7, 0.16]); }
      for (var fz = back + 0.9; fz <= front - 0.9; fz += 1.8) [-1, 1].forEach(function (sd) { fins.push([sd * (w / 2 + 0.3), y0 + 2.05, fz, 0.16, 2.7, 0.07]); });
    }
    // ── 앞 왼쪽 모서리: 위층을 꿰뚫는 '책등' 벽 (서재의 얼굴) ──
    if (up >= 1) {
      var sx0 = -w / 2 + 0.6, sx1 = Math.min(-w / 2 + 9.5, -DOOR_W), spines = [], cols = [], rr = rnd(97);
      add(new T.Mesh(new T.BoxGeometry(sx1 - sx0 + 0.6, top - CEIL + 0.4, 0.5), EXT.metal), (sx0 + sx1) / 2, (CEIL + top) / 2, front + 0.45);
      for (var fl2 = 0; fl2 < up; fl2++) {
        var by = CEIL + 0.25 + fl2 * fh, xx = sx0 + 0.15;
        frames.push([(sx0 + sx1) / 2, by - 0.12, front + 0.85, sx1 - sx0 + 0.4, 0.12, 0.5]);   // 선반
        while (xx < sx1 - 0.2) {
          var bw = 0.3 + rr() * 0.45, bh = fh * (0.62 + rr() * 0.3);
          if (xx + bw > sx1) break;
          spines.push([xx + bw / 2, by + bh / 2, front + 0.82, bw - 0.03, bh, 0.55 + rr() * 0.12]); cols.push(PALETTE[Math.floor(rr() * PALETTE.length)]);
          xx += bw + (rr() < 0.08 ? 0.25 : 0.02);
        }
      }
      instBoxes(spines, EXT.spine, cols);
    }
    // ── 옥상: 금속 난간, 화단, 옥상 간판 ──
    frames.push([0, top + 0.35, front + 0.25, w + 0.7, 0.7, 0.12], [0, top + 0.35, back - 0.25, w + 0.7, 0.7, 0.12]);
    [-1, 1].forEach(function (sd) { frames.push([sd * (w / 2 + 0.3), top + 0.35, cz, 0.12, 0.7, d + 0.6]); });
    add(new T.Mesh(new T.BoxGeometry(w + 0.4, 0.1, d + 0.4), M.parapet), 0, top + 0.05, cz);
    for (var pi = 0; pi < 4; pi++) {
      var px = (pi - 1.5) * Math.min(8, w / 5), pz = front - 4;
      add(new T.Mesh(new T.BoxGeometry(3, 0.6, 1.2), EXT.metal), px, top + 0.4, pz);
      for (var lf = 0; lf < 5; lf++) { var bush = new T.Mesh(new T.IcosahedronGeometry(0.35 + (lf % 2) * 0.12, 0), M.leaf[(pi + lf) % M.leaf.length]); bush.position.set(px - 1.1 + lf * 0.55, top + 0.95, pz); parent.add(bush); }
    }
    var roofTex = textTex(['BookOasis'], 1400, 260, 'rgba(0,0,0,0)', '#f5f2ec', 200);
    var roofSign = new T.Mesh(new T.PlaneGeometry(12, 2.2), new T.MeshBasicMaterial({ map: roofTex, transparent: true, toneMapped: false }));
    roofSign.position.set(w / 4, top + 1.9, front - 0.6); parent.add(roofSign);
    [-5, 0, 5].forEach(function (o) { frames.push([w / 4 + o, top + 1.0, front - 0.75, 0.08, 2, 0.08]); });
    frames.push([w / 4, top + 0.85, front - 0.75, 12, 0.06, 0.08]);
    instBoxes(stones, EXT.stone);
    instBoxes(frames, EXT.metal);
    instBoxes(fins, EXT.metal);
  }
  // ── 길 건너 건물 1층 방 (상점처럼): 건물 1층을 비우고 유리 진열창·문·바닥·천장·벽을 짓는다. 횡단보도로 건너가 들어간다 ──
  // 지금 쓰는 방([거리] 설정의 건물): 갤러리(표지 액자), 재즈 청음실, 사무실. 길 양쪽 어느 건물이든 된다(side = +1 오른쪽, -1 왼쪽).
  var SHOPS = {}, ROOMS = [], GALLERY_R = null;
  var galGlass = new T.MeshStandardMaterial({ color: 0xa9c0cc, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false, side: T.DoubleSide });
  var galWall = new T.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.9, side: T.DoubleSide });
  var galFloor = new T.MeshStandardMaterial({ color: 0xcfcac1, roughness: 0.35 });
  [galGlass, galWall, galFloor].forEach(function (m) { m.userData.keep = true; });
  function shopRoom(C, w, o) {   // o: {label, wall, floor, ceil, sign: [제목, 부제], signBg, signFg}
    if (!C || !C.bld) return null;
    var s = C.side, gy = C.gy, bd = C.bd, bw = C.bw, bx = C.bx, z = C.z, H = 3.4;
    var fx = bx - s * bd / 2, kx = bx + s * bd / 2;   // 길 쪽 벽 / 안쪽 벽
    C.bld.scale.y = C.bh - H; C.bld.position.y = gy + H + (C.bh - H) / 2;   // 1층을 비운다 (위층만 남김)
    if (C.shop && C.shop.parent) C.shop.parent.remove(C.shop);
    var R = { s: s, fx: fx, kx: kx, bx: bx, bd: bd, bw: bw, z: z, gy: gy, H: H, w: w, label: o.label, inRot: -s * Math.PI / 2 };
    var wallM = o.wall || galWall;
    var fl = new T.Mesh(new T.PlaneGeometry(bd, bw), o.floor || galFloor); fl.rotation.x = -Math.PI / 2; fl.position.set(bx, gy + 0.012, z); fl.receiveShadow = true; parent.add(fl);
    var ce = new T.Mesh(new T.PlaneGeometry(bd, bw), o.ceil || wallM); ce.rotation.x = Math.PI / 2; ce.position.set(bx, gy + H - 0.02, z); parent.add(ce);
    var bk = new T.Mesh(new T.PlaneGeometry(bw, H), wallM); bk.rotation.y = R.inRot; bk.position.set(kx, gy + H / 2, z); parent.add(bk);
    [-1, 1].forEach(function (sd) { var sw0 = new T.Mesh(new T.PlaneGeometry(bd, H), wallM); sw0.position.set(bx, gy + H / 2, z + sd * bw / 2); parent.add(sw0); });
    // 길 쪽: 유리 진열창 + 가운데 문(열린 채) + 금속 창살 + 문 위 간판
    var dw = 2.4, dh = 2.7, side0 = (bw - dw) / 2;
    [-1, 1].forEach(function (sd) {
      var gl = new T.Mesh(new T.PlaneGeometry(side0, H), galGlass); gl.rotation.y = Math.PI / 2; gl.position.set(fx, gy + H / 2, z + sd * (dw / 2 + side0 / 2)); parent.add(gl);
      for (var q = 0; q <= Math.floor(side0 / 1.5); q++) { var mu = new T.Mesh(unitBox, M.black); mu.scale.set(0.08, H, 0.06); mu.position.set(fx, gy + H / 2, z + sd * (dw / 2 + q * 1.5)); parent.add(mu); }
    });
    var lin = new T.Mesh(new T.PlaneGeometry(dw, H - dh), galGlass); lin.rotation.y = Math.PI / 2; lin.position.set(fx, gy + dh + (H - dh) / 2, z); parent.add(lin);
    var top0 = new T.Mesh(unitBox, M.black); top0.scale.set(0.1, 0.1, bw); top0.position.set(fx, gy + H, z); parent.add(top0);
    var dt0 = new T.Mesh(unitBox, M.black); dt0.scale.set(0.1, 0.08, dw); dt0.position.set(fx, gy + dh, z); parent.add(dt0);
    var openTex = textTex(o.sign, 1024, 220, o.signBg || '#14181f', o.signFg || '#ffffff', 84);
    var op = new T.Mesh(new T.PlaneGeometry(2.4, 0.52), new T.MeshBasicMaterial({ map: openTex, toneMapped: false })); op.rotation.y = R.inRot + Math.PI; op.position.set(fx - s * 0.05, gy + dh + 0.36, z); parent.add(op);
    // 횡단보도 (서재 쪽 보도 ↔ 건너편 보도)
    for (var zx = w / 2 + 5.3; zx < w / 2 + 13; zx += 1.0) { var st = new T.Mesh(new T.PlaneGeometry(0.5, 3.0), new T.MeshBasicMaterial({ color: 0xf2f2ee })); st.rotation.x = -Math.PI / 2; st.position.set(s * zx, gy + 0.025, z); parent.add(st); }
    ROOMS.push(R);
    return R;
  }
  function roomAt(x, z) {   // 이 자리가 어느 방 안인지
    if (cur !== 0) return null;
    for (var i = 0; i < ROOMS.length; i++) {
      var R = ROOMS[i], ax = R.s * x, fa = R.s * R.fx;
      if (ax > fa + 0.1 && ax < fa + R.bd && Math.abs(z - R.z) < R.bw / 2) return R;
    }
    return null;
  }
  function roomWalk(x, z) {   // 횡단보도·건너편 보도·문·방 안
    for (var i = 0; i < ROOMS.length; i++) {
      var R = ROOMS[i], ax = R.s * x, fa = R.s * R.fx, w = R.w;
      if (ax < 0) continue;
      if (Math.abs(z - R.z) < 1.5 && ax >= w / 2 + 4.4 && ax <= w / 2 + 13.2) return true;                         // 횡단보도
      if (ax >= w / 2 + 13 && ax <= fa - 0.15 && Math.abs(z - R.z) < 14) return true;                              // 건너편 보도
      if (ax > fa - 0.3 && ax < fa + 0.6 && Math.abs(z - R.z) < 0.85) return true;                                  // 문
      if (ax >= fa + 0.4 && ax <= fa + R.bd - 0.4 && Math.abs(z - R.z) <= R.bw / 2 - 0.4) return true;             // 방 안
    }
    return false;
  }
  function carHold(c, z) {   // 사람이 횡단보도에 있으면 다가오던 차가 앞에서 선다
    var cx = camera.position.x, cz = camera.position.z;
    for (var i = 0; i < ROOMS.length; i++) {
      var R = ROOMS[i], ax = R.s * cx;
      if (R.s * c.g.position.x < 0 || ax < R.w / 2 + 4.4 || ax > R.w / 2 + 13.2 || Math.abs(cz - R.z) > 1.8) continue;
      var ahead = (R.z - z) * c.dir;
      if (ahead > 2.2 && ahead < 10) return true;
    }
    return false;
  }
  // 갤러리: 벽마다 서재 전체에서 무작위로 고른 표지 액자 (누르면 작품 카드)
  function addGallery(w) {
    GALLERY_R = null;
    var gn = STREET.gallery, R = gn && shopRoom(SHOPS[gn], w, { label: gn + ' 갤러리 · 액자를 누르면 작품 · [입구로]는 서재 입구', sign: [gn + ' GALLERY', '들어오세요 · 액자를 누르면 작품 카드'] });
    if (!R) return;
    GALLERY_R = R;
    var gy = R.gy, z = R.z, H = R.H, bw = R.bw, s = R.s, seed = rnd(311);
    var inTex = textTex([gn + ' 갤러리'], 1400, 180, '#f4f2ee', '#14181f', 110);
    var inSign = new T.Mesh(new T.PlaneGeometry(3.6, 0.46), new T.MeshBasicMaterial({ map: inTex, toneMapped: false })); inSign.rotation.y = R.inRot; inSign.position.set(R.kx - s * 0.02, gy + H - 0.3, z); parent.add(inSign);
    var pool = []; floors.forEach(function (f) { (f.libs || []).forEach(function (lib) { lib.series.forEach(function (sr) { if (sr.last) pool.push([lib, sr]); }); }); });
    var PW = 1.15, PH = 1.62, fr = 0.07, slots = [];
    for (var sz = z - bw / 2 + 1.6; sz <= z + bw / 2 - 1.6; sz += 2.1) slots.push([R.kx - s * 0.03, sz, R.inRot]);   // 안쪽 벽
    [-1, 1].forEach(function (sd) { for (var d0 = 1.9; d0 <= R.bd - 1.3; d0 += 2.1) slots.push([R.fx + s * d0, z + sd * (bw / 2 - 0.03), sd > 0 ? Math.PI : 0]); });
    slots.forEach(function (sl) {
      var pick0 = pool.length ? pool.splice(Math.floor(seed() * pool.length), 1)[0] : null; if (!pick0) return;
      var lib = pick0[0], sr = pick0[1], base = colorOf(sr.title);
      var mat = new T.MeshStandardMaterial({ color: base, roughness: 0.55 });
      var b = { key: lib.db_type + ':' + sr.last, title: sr.title || '(제목 없음)', count: sr.count, lib: lib.name, db: lib.db_type, front: mat, base: base, state: 2, kind: 'poster' };
      var g = new T.Group(); g.position.set(sl[0], gy + 1.5, sl[1]); g.rotation.y = sl[2]; parent.add(g);
      var back = new T.Mesh(unitBox, M.oak); back.scale.set(PW + fr * 2, PH + fr * 2, 0.05); back.position.z = 0.025; g.add(back);
      var mount = new T.Mesh(unitBox, galWall); mount.scale.set(PW + 0.02, PH + 0.02, 0.01); mount.position.z = 0.05; g.add(mount);
      var m = new T.Mesh(posterGeo, mat); m.scale.set(PW - 0.12, PH - 0.12, 1); m.position.z = 0.058; m.userData.book = b; g.add(m);
      var lamp = new T.Mesh(unitBox, EXT.metal); lamp.scale.set(0.5, 0.05, 0.12); lamp.position.set(0, PH / 2 + 0.24, 0.18); g.add(lamp);   // 그림 조명
      var bulb = new T.Mesh(unitBox, EXT.lamp); bulb.scale.set(0.44, 0.02, 0.08); bulb.position.set(0, PH / 2 + 0.21, 0.19); g.add(bulb);
      b.mesh = m; books.push(b);
      loader.load('api/lib3d/cover?k=' + encodeURIComponent(b.key), function (tex) {
        tex.encoding = T.sRGBEncoding; tex.anisotropy = 8; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; b.cover = true;
      }, undefined, function () { b.state = 3; titleCover(b); });
    });
    var bn = new T.Group(); bn.position.set(R.bx + s * 0.4, gy, z); parent.add(bn);   // 가운데 의자 (안쪽 벽을 보고)
    var top = new T.Mesh(unitBox, M.oak); top.scale.set(0.55, 0.06, 2.4); top.position.y = 0.45; bn.add(top);
    [-1, 1].forEach(function (o) { var lg = new T.Mesh(unitBox, M.black); lg.scale.set(0.45, 0.42, 0.06); lg.position.set(0, 0.21, o * 1.05); bn.add(lg); });
    [-0.6, 0.6].forEach(function (o) { addSeat(R.bx + s * 0.4, z + o, s * Math.PI / 2, 0.48); });
  }
  // ── 재즈 청음실: 길 건너 [거리] 설정의 청음실 건물 1층 - 스피커·앰프·턴테이블·LP 선반·네온, 벽 화면에 지금 곡과 스펙트럼 ──
  // 인터넷 재즈 라디오 3곳(colaiuta77/jazzradio 참고)을 서버가 이어 준다. 소리는 고른 사람에게만, 청음실에서 멀어질수록 작아진다.
  var JZ = { room: null, audio: null, ctx: null, an: null, gain: null, data: null, st: '', playing: false, vol: 0.8, now: null, bars: null, platter: null,
             screen: null, scrTex: null, art: null, artUrl: '', pollAt: 0, list: [] };
  var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  try { JZ.vol = parseFloat(localStorage.getItem('l3d_jazz_vol') || '0.8'); JZ.st = localStorage.getItem('l3d_jazz_st') || ''; } catch (e) { /* 기본값 */ }
  var jzBox = el('l3d-jazz');
  function addJazzRoom(w) {
    JZ.room = null; JZ.bars = null; JZ.platter = null; JZ.screen = null;
    var jn = STREET.jazz, info = jn && SHOPS[jn]; if (!info) return;
    var wallM = new T.MeshStandardMaterial({ color: 0x24352c, roughness: 0.9, side: T.DoubleSide });
    var floorM = new T.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.55 });
    var ceilM = new T.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.95, side: T.DoubleSide });
    var R = shopRoom(info, w, { label: jn + ' 재즈 청음실 · 턴테이블·화면을 누르거나 의자에 앉으면 라디오', wall: wallM, floor: floorM, ceil: ceilM,
                                sign: ['JAZZ LISTENING ROOM', jn + ' · 재즈 청음실 · 들어오세요'], signBg: '#1a1410', signFg: '#ffcf7a' });
    if (!R) return;
    JZ.room = R;
    var s = R.s, gy = R.gy, z = R.z;
    function P(d, lat, y) { return new T.Vector3(R.kx - s * d, gy + (y || 0), z + lat); }   // 안쪽 벽에서 d만큼 앞, 옆으로 lat
    var wood = new T.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.6 }), dark = new T.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
    var brass = new T.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.3, metalness: 0.8 });
    function boxAt(mat, sx, sy, sz, p, hit) { var m = new T.Mesh(unitBox, mat); m.scale.set(sx, sy, sz); m.position.copy(p); m.rotation.y = R.inRot; m.castShadow = true; parent.add(m); if (hit) { m.userData.jazz = true; brunchHits.push(m); } return m; }
    // 음반 가게처럼: 안쪽 벽 가득 LP 선반(화면 양옆, 바닥부터 천장까지) + 위에 줄지은 조명, 그 앞 긴 나무 작업대에 턴테이블·앰프·라디오
    var lpW = [], lpC = [], rw = rnd(79), LPC = [0xd8c9a0, 0xc9b27a, 0xe6dcc0, 0xb89a62, 0xd9b98a, 0xcdbb8e, 0x8c6b3f, 0xa5522e, 0x3a3a3a, 0xe9e2cf];
    var half = R.bw / 2 - 0.35, rows = 5, rh = 0.56;
    [-1, 1].forEach(function (sd) {
      var a = 1.75, b = half, mid = sd * (a + b) / 2, len = b - a;
      for (var row = 0; row <= rows; row++) boxAt(wood, len, 0.04, 0.36, P(0.2, mid, 0.14 + row * rh));                 // 선반 널
      for (var dv = a; dv <= b + 0.01; dv += len / Math.max(2, Math.round(len / 1.25))) boxAt(wood, 0.05, rows * rh, 0.36, P(0.2, sd * dv, 0.14 + rows * rh / 2));   // 칸막이
      for (var row2 = 0; row2 < rows; row2++) for (var lz = a + 0.06; lz < b - 0.04; lz += 0.042) {
        if (rw() < 0.06) { lz += 0.08; continue; }   // 군데군데 빈 틈
        var hh = 0.42 + rw() * 0.06;
        lpW.push([R.kx - s * 0.2, gy + 0.16 + row2 * rh + hh / 2, z + sd * lz, 0.31, hh, 0.034]); lpC.push(LPC[Math.floor(Math.pow(rw(), 1.4) * LPC.length)]);
      }
      for (var sp = a + 0.6; sp < b; sp += 1.5) {   // 선반 위 조명
        boxAt(dark, 0.06, 0.1, 0.06, P(0.55, sd * sp, rows * rh + 0.3));
        var bl = new T.Mesh(new T.SphereGeometry(0.05, 10, 8), FURN.bulb); bl.position.copy(P(0.5, sd * sp, rows * rh + 0.22)); parent.add(bl);
      }
      boxAt(dark, len, 0.03, 0.03, P(0.55, mid, rows * rh + 0.36));   // 조명 레일
    });
    instBoxes(lpW, EXT.spine, lpC);
    // 큰 스피커 둘 (작업대 양옆, 바닥에)
    [-1, 1].forEach(function (sd) {
      var c = P(1.0, sd * 2.75, 0.75);
      boxAt(wood, 0.8, 1.5, 0.55, c);
      [[0.35, 0.2], [0.9, 0.12], [1.25, 0.055]].forEach(function (cn) {
        var cone = new T.Mesh(new T.CylinderGeometry(cn[1], cn[1] * 0.7, 0.05, 24), dark); cone.rotation.z = Math.PI / 2;
        cone.position.copy(P(1.3, sd * 2.75, cn[0])); cone.rotation.y = R.inRot + Math.PI / 2; parent.add(cone);
      });
    });
    // 긴 나무 작업대 (두꺼운 상판 + 다리 틀 + 아래 LP 상자)
    boxAt(wood, 4.3, 0.1, 0.85, P(1.0, 0, 0.86), true);
    [-1.9, 1.9].forEach(function (lat) { boxAt(wood, 0.1, 0.8, 0.7, P(1.0, lat, 0.41)); });
    boxAt(wood, 3.7, 0.06, 0.1, P(1.0, 0, 0.25));
    [-0.9, 0.7].forEach(function (lat, ci) { boxAt(wood, 0.5, 0.36, 0.42, P(1.0, lat, 0.2)); for (var k = 0; k < 9; k++) boxAt(new T.MeshStandardMaterial({ color: LPC[(k * 3 + ci) % LPC.length], roughness: 0.8 }), 0.035, 0.32, 0.33, P(1.0, lat - 0.2 + k * 0.05, 0.42)); });
    var vuTex = canvasTex(512, 128, function (g, cw, ch) {
      g.fillStyle = '#1a1206'; g.fillRect(0, 0, cw, ch);
      [0, 1].forEach(function (k) { var x0 = 30 + k * 250; g.fillStyle = '#f3c26b'; g.fillRect(x0, 18, 200, 92); g.strokeStyle = '#3a2a10'; g.lineWidth = 3;
        g.beginPath(); g.arc(x0 + 100, 120, 80, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.fillStyle = '#3a2a10'; g.font = '700 18px ' + FONT; g.fillText('VU', x0 + 88, 70); });
    });
    boxAt(dark, 0.7, 0.2, 0.42, P(1.0, 0.55, 1.01), true);                                             // 앰프
    var vu = new T.Mesh(new T.PlaneGeometry(0.6, 0.15), new T.MeshBasicMaterial({ map: vuTex, toneMapped: false }));
    vu.position.copy(P(1.215, 0.55, 1.02)); vu.rotation.y = R.inRot; parent.add(vu);
    [0.32, 0.78].forEach(function (lat) { var kn = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.03, 12), brass); kn.rotation.z = Math.PI / 2; kn.position.copy(P(1.225, lat, 0.94)); kn.rotation.y = R.inRot + Math.PI / 2; parent.add(kn); });
    boxAt(dark, 0.62, 0.1, 0.46, P(1.0, -0.75, 0.96), true);                                           // 턴테이블 몸통
    var platter = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.02, 32), new T.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.3 }));
    platter.position.copy(P(1.0, -0.8, 1.025)); platter.userData.jazz = true; brunchHits.push(platter); parent.add(platter);
    var label = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.022, 20), new T.MeshStandardMaterial({ color: 0xc0392b })); label.position.set(0, 0.002, 0.03); platter.add(label);
    JZ.platter = platter;
    var arm = new T.Mesh(unitBox, brass); arm.scale.set(0.02, 0.02, 0.26); arm.position.copy(P(0.93, -0.56, 1.06)); arm.rotation.y = R.inRot + 0.5; parent.add(arm);
    boxAt(new T.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 }), 0.42, 0.24, 0.2, P(1.0, 1.55, 1.03), true);   // 작은 흰 라디오
    boxAt(dark, 0.2, 0.16, 0.02, P(1.105, 1.48, 1.03));
    // 작업대에 기대 놓은 그림 둘 + 옆 나무 장
    [[-1.65, 0x6fae6a, 0xf2c14e], [1.15, 0xe2a05a, 0x5b8fb9]].forEach(function (q) {
      var cv = canvasTex(128, 96, function (g, cw, ch) { g.fillStyle = '#' + new T.Color(q[1]).getHexString(); g.fillRect(0, 0, cw, ch); g.fillStyle = '#' + new T.Color(q[2]).getHexString();
        for (var k = 0; k < 14; k++) { g.beginPath(); g.arc(rw() * cw, rw() * ch, 6 + rw() * 14, 0, 6.3); g.fill(); } g.strokeStyle = '#f4efe2'; g.lineWidth = 6; g.strokeRect(3, 3, cw - 6, ch - 6); });
      var pm = new T.Mesh(new T.PlaneGeometry(0.5, 0.38), new T.MeshBasicMaterial({ map: cv, toneMapped: false })); pm.position.copy(P(1.47, q[0], 0.62)); pm.rotation.y = R.inRot; pm.rotation.order = 'YXZ'; pm.rotation.x = -0.22; parent.add(pm);
    });
    boxAt(wood, 0.9, 0.9, 0.7, P(1.0, 3.75, 0.45)); boxAt(dark, 0.7, 0.6, 0.02, P(1.36, 3.75, 0.45));
    // 벽 화면: 방송국·곡·커버 + 그 아래 스펙트럼 막대
    JZ.scrTex = canvasTex(1024, 512, function (g, cw, ch) { g.fillStyle = '#100c08'; g.fillRect(0, 0, cw, ch); });
    var scr = new T.Mesh(new T.PlaneGeometry(3.0, 1.5), new T.MeshBasicMaterial({ map: JZ.scrTex, toneMapped: false }));
    scr.position.copy(P(0.03, 0, 2.35)); scr.rotation.y = R.inRot; scr.userData.jazz = true; brunchHits.push(scr); parent.add(scr);
    JZ.screen = scr;
    var barMat = new T.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }), n = 28;
    var bars = new T.InstancedMesh(unitBox, barMat, n); bars.userData.base = P(0.06, 0, 1.5); bars.userData.n = n; parent.add(bars);
    JZ.bars = bars; JZ.levels = new Float32Array(n); setBars(0);
    // LP 선반 (옆 벽)
    var lps = [], cols = [], rr = rnd(77);
    [-1, 1].forEach(function (sd) {
      for (var row = 0; row < 3; row++) {
        boxAt(wood, 0.32, 0.04, 2.6, new T.Vector3(R.bx + s * 0.2, gy + 0.55 + row * 0.6, z + sd * (R.bw / 2 - 0.2)).add(new T.Vector3(0, 0, 0)));
        for (var k = 0; k < 40; k++) {
          lps.push([R.bx + s * (0.2 - 1.25 + k * 0.064), gy + 0.73 + row * 0.6, z + sd * (R.bw / 2 - 0.2), 0.045, 0.32, 0.3]);
          cols.push([0x1d1d1d, 0x8c3b3b, 0x2f4858, 0xd8cbb0, 0xb5793e, 0x3e5c47, 0x6b4f73][Math.floor(rr() * 7)]);
        }
      }
    });
    instBoxes(lps, EXT.spine, cols);
    // 네온 'JAZZ' (옆 벽)
    var neonTex = textTex(['JAZZ'], 512, 200, 'rgba(0,0,0,0)', '#ff6ec7', 170);
    var neon = new T.Mesh(new T.PlaneGeometry(1.8, 0.7), new T.MeshBasicMaterial({ map: neonTex, transparent: true, toneMapped: false }));
    neon.position.set(R.bx - s * 1.2, gy + 2.55, z - (R.bw / 2 - 0.05)); parent.add(neon);
    // 안락의자 셋 (화면을 보고) + 스탠드
    [-1.7, 0, 1.7].forEach(function (lat) {
      var p0 = P(4.3, lat, 0), ch = new T.Group(); ch.position.copy(p0); ch.rotation.y = s * Math.PI / 2; parent.add(ch);
      var seatM = new T.MeshStandardMaterial({ color: 0x7a2e22, roughness: 0.7 });
      var se = new T.Mesh(unitBox, seatM); se.scale.set(0.8, 0.2, 0.7); se.position.y = 0.42; ch.add(se);
      var bk = new T.Mesh(unitBox, seatM); bk.scale.set(0.8, 0.75, 0.16); bk.position.set(0, 0.85, -0.3); ch.add(bk);
      [-0.36, 0.36].forEach(function (ax) { var am = new T.Mesh(unitBox, seatM); am.scale.set(0.1, 0.25, 0.66); am.position.set(ax, 0.6, 0); ch.add(am); });
      var lg = new T.Mesh(unitBox, dark); lg.scale.set(0.7, 0.32, 0.6); lg.position.y = 0.16; ch.add(lg);
      addSeat(p0.x, p0.z, s * Math.PI / 2, 0.52, { jazz: true });
    });
    var lampP = P(R.bd - 1.2, R.bw / 2 - 1.0, 0);
    var pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.6, 8), brass); pole.position.set(lampP.x, gy + 0.8, lampP.z); parent.add(pole);
    var shade = new T.Mesh(new T.CylinderGeometry(0.14, 0.24, 0.24, 20, 1, true), EXT.lamp); shade.position.set(lampP.x, gy + 1.65, lampP.z); parent.add(shade);
    drawJazzScreen();
  }
  function setBars(t) {   // 스펙트럼 막대 높이 (levels 0~1)
    var B = JZ.bars; if (!B) return;
    var R = JZ.room, n = B.userData.n, base = B.userData.base, m4 = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(0, R.inRot, 0)), wid = 2.8 / n;
    for (var i = 0; i < n; i++) {
      var h = 0.03 + JZ.levels[i] * 0.55, lat = (i - (n - 1) / 2) * wid;
      m4.compose(new T.Vector3(base.x, base.y + h / 2, base.z + lat), q, new T.Vector3(wid * 0.7, h, 0.03)); B.setMatrixAt(i, m4);
    }
    B.instanceMatrix.needsUpdate = true;
  }
  function drawJazzScreen() {
    if (!JZ.screen) return;
    var st = JZ.list.filter(function (x) { return x.id === JZ.st; })[0], nw = JZ.now || {}, img = JZ.art;
    var tex = canvasTex(1024, 512, function (g, cw, ch) {
      var grd = g.createLinearGradient(0, 0, cw, ch); grd.addColorStop(0, '#1b120a'); grd.addColorStop(1, '#0b0f14'); g.fillStyle = grd; g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#ffcf7a'; g.font = '700 34px ' + FONT; g.textBaseline = 'top';
      g.fillText(JZ.playing ? 'ON AIR · ' + (st ? st.name : '') : 'JAZZ LISTENING ROOM', 40, 34, cw - 80);
      var x0 = 40;
      if (img && img.complete && img.naturalWidth) { g.drawImage(img, 40, 100, 340, 340); x0 = 410; }
      g.fillStyle = '#f5f2ec'; g.font = '700 54px ' + FONT;
      wrapText(g, JZ.playing ? (nw.title || '곡 정보를 기다리는 중') : '턴테이블이나 이 화면을 누르세요', x0, 130, cw - x0 - 40, 64, 3);
      g.fillStyle = '#c9b48a'; g.font = '400 38px ' + FONT;
      g.fillText(JZ.playing ? (nw.artist || '') : '인터넷 재즈 라디오 3곳 · 의자에 앉아 들어 보세요', x0, 340, cw - x0 - 40);
      if (st && JZ.playing) { g.fillStyle = '#8a7a5a'; g.font = '400 28px ' + FONT; g.fillText(st.sub, x0, 400, cw - x0 - 40); }
    });
    var m = JZ.screen.material; if (m.map && m.map !== JZ.scrTex) m.map.dispose(); m.map = tex; m.needsUpdate = true;
  }
  function jzLoadList() {
    if (JZ.list.length) return Promise.resolve(JZ.list);
    return api('api/lib3d/jazz/stations').then(function (d) { JZ.list = d.stations || []; if (!JZ.st && JZ.list[0]) JZ.st = JZ.list[0].id; return JZ.list; });
  }
  function jzPoll(force) {
    if (!JZ.st || (!force && Date.now() - JZ.pollAt < 20000)) return;
    JZ.pollAt = Date.now();
    api('api/lib3d/jazz/now?s=' + encodeURIComponent(JZ.st)).then(function (d) {
      var changed = !JZ.now || JZ.now.raw !== d.raw; JZ.now = d;
      if (d.art && d.art !== JZ.artUrl) {
        JZ.artUrl = d.art; var im = new Image(); im.onload = function () { JZ.art = im; drawJazzScreen(); jzPanel(); }; im.src = 'api/lib3d/jazz/art?u=' + encodeURIComponent(d.art);
      } else if (!d.art) { JZ.art = null; JZ.artUrl = ''; }
      if (changed) { drawJazzScreen(); jzPanel(); }
    }).catch(function () {});
  }
  function jzPlay(id) {
    if (id) { JZ.st = id; try { localStorage.setItem('l3d_jazz_st', id); } catch (e) { /* 무시 */ } }
    if (!JZ.audio) {
      JZ.audio = new Audio(); JZ.audio.preload = 'none';
      JZ.audio.addEventListener('playing', function () { JZ.playing = true; jzPanel(); drawJazzScreen(); });
      JZ.audio.addEventListener('pause', function () { JZ.playing = false; jzPanel(); drawJazzScreen(); });
      JZ.audio.addEventListener('error', function () { JZ.playing = false; el('l3d-jz-msg').textContent = '방송에 연결하지 못했습니다. 다른 방송국을 골라 보세요.'; jzPanel(); });
    }
    if (!IS_IOS && !JZ.ctx && (window.AudioContext || window.webkitAudioContext)) {   // 소리 분석(막대)·거리에 따른 소리 크기 (iOS는 기기 볼륨)
      try {
        JZ.ctx = new (window.AudioContext || window.webkitAudioContext)();
        var src = JZ.ctx.createMediaElementSource(JZ.audio);
        JZ.an = JZ.ctx.createAnalyser(); JZ.an.fftSize = 128; JZ.data = new Uint8Array(JZ.an.frequencyBinCount);
        JZ.gain = JZ.ctx.createGain(); src.connect(JZ.an); JZ.an.connect(JZ.gain); JZ.gain.connect(JZ.ctx.destination);
      } catch (e) { JZ.ctx = null; }
    }
    if (JZ.ctx && JZ.ctx.state === 'suspended') JZ.ctx.resume();
    el('l3d-jz-msg').textContent = '연결하는 중...';
    JZ.audio.src = 'api/lib3d/jazz/stream?s=' + encodeURIComponent(JZ.st) + '&t=' + Date.now();
    var p = JZ.audio.play(); if (p && p.catch) p.catch(function () { el('l3d-jz-msg').textContent = '▶를 다시 눌러 주세요 (브라우저가 자동 재생을 막음).'; });
    JZ.now = null; JZ.art = null; JZ.artUrl = ''; jzPoll(true); jzPanel(); drawJazzScreen();
  }
  function jzStop() {
    if (JZ.audio) { JZ.audio.pause(); JZ.audio.removeAttribute('src'); try { JZ.audio.load(); } catch (e) { /* 무시 */ } }
    JZ.playing = false; jzPanel(); drawJazzScreen();
  }
  function jzPanel() {
    if (!jzBox) return;
    var list = el('l3d-jz-st'); list.textContent = '';
    JZ.list.forEach(function (st) {
      var b = document.createElement('button'); b.type = 'button'; b.className = st.id === JZ.st ? 'on' : '';
      var t = document.createElement('b'); t.textContent = st.name; var sm = document.createElement('small'); sm.textContent = st.sub;
      b.appendChild(t); b.appendChild(sm); b.addEventListener('click', function () { jzPlay(st.id); }); list.appendChild(b);
    });
    var nw = JZ.now || {};
    el('l3d-jz-title').textContent = JZ.playing ? (nw.title || '곡 정보를 기다리는 중') : '멈춤';
    el('l3d-jz-artist').textContent = JZ.playing ? (nw.artist || '') : '방송국을 고르면 바로 나옵니다';
    var im = el('l3d-jz-art'); if (JZ.playing && JZ.art) { im.src = JZ.art.src; im.hidden = false; } else im.hidden = true;
    el('l3d-jz-pp').textContent = JZ.playing ? '❚❚ 멈춤' : '▶ 듣기';
    if (JZ.playing) el('l3d-jz-msg').textContent = '';
    var st = JZ.list.filter(function (x) { return x.id === JZ.st; })[0]; el('l3d-jz-home').href = st ? st.home : '#';
    el('l3d-jz-vol').value = String(JZ.vol); el('l3d-jz-vol').style.display = IS_IOS ? 'none' : '';
    el('l3d-jz-ios').hidden = !IS_IOS;
  }
  function openJazz() {
    [setBox, aiBox, pplBox, outBox, mdlBox, staffBox, brBox, mpBox, cpBox].forEach(function (b) { if (b) b.classList.remove('on'); });
    jzBox.classList.add('on'); closeCard();
    jzLoadList().then(function () { jzPanel(); jzPoll(true); }).catch(function (e) { el('l3d-jz-msg').textContent = e.message; });
  }
  el('l3d-jz-pp').addEventListener('click', function () { if (JZ.playing) jzStop(); else jzLoadList().then(function () { jzPlay(); }); });
  el('l3d-jz-vol').addEventListener('input', function () { JZ.vol = parseFloat(el('l3d-jz-vol').value) || 0; try { localStorage.setItem('l3d_jazz_vol', String(JZ.vol)); } catch (e) { /* 무시 */ } });
  el('l3d-jz-close').addEventListener('click', function () { jzBox.classList.remove('on'); });   // 닫아도 소리는 계속 (■ 멈춤)
  function updateJazz(dt, now) {   // 거리에 따른 소리 크기, 턴테이블 회전, 스펙트럼 막대
    if (!JZ.audio || !JZ.playing) { if (JZ.bars && JZ.levels[0] > 0.001) { for (var k = 0; k < JZ.levels.length; k++) JZ.levels[k] *= 0.9; setBars(); } return; }
    var R = JZ.room, f = 0;
    if (R && cur === 0) {
      var d = Math.hypot(camera.position.x - R.bx, camera.position.z - R.z) - Math.max(R.bd, R.bw) / 2;
      f = roomAt(camera.position.x, camera.position.z) === R ? 1 : Math.max(0, Math.min(1, 1 - d / 30)) * 0.6;   // 밖에서는 멀수록 작게
    }
    if (JZ.gain) JZ.gain.gain.value = JZ.vol * f;
    else JZ.audio.muted = f <= 0.02;   // iOS: 기기 볼륨, 멀리 가면 끔
    if (JZ.platter) JZ.platter.rotation.y += dt * 3.5;
    if (JZ.bars) {
      if (JZ.an) {
        JZ.an.getByteFrequencyData(JZ.data);
        for (var i = 0; i < JZ.levels.length; i++) { var v = JZ.data[Math.min(JZ.data.length - 1, Math.floor(i * 1.6) + 1)] / 255; JZ.levels[i] += (v - JZ.levels[i]) * Math.min(1, dt * 12); }
      } else for (var j = 0; j < JZ.levels.length; j++) JZ.levels[j] = 0.25 + 0.25 * Math.sin(now / 180 + j * 0.7) * Math.sin(now / 410 + j * 1.3);
      setBars();
    }
    jzPoll(false);
  }
  // ── 사무실: 길 건너 왼쪽 [거리] 설정의 사무실 건물 1층 - 큰 책상과 모니터, 책장, 손님용 소파, 회사 이름 ──
  var OFFICE = null;
  function addOffice(w) {
    OFFICE = null;
    var on = STREET.office, info = on && SHOPS[on]; if (!info) return;
    var wallM = new T.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.9, side: T.DoubleSide });
    var floorM = new T.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.5 });
    var R = shopRoom(info, w, { label: on + ' 사무실 · [입구로]는 서재 입구', wall: wallM, floor: floorM, sign: [on, '사무실 · 들어오세요'], signBg: '#1d2a3a', signFg: '#ffffff' });
    if (!R) return;
    OFFICE = R;
    var s = R.s, gy = R.gy, z = R.z;
    function P(d, lat, y) { return new T.Vector3(R.kx - s * d, gy + (y || 0), z + lat); }
    function boxAt(mat, sx, sy, sz, p) { var m = new T.Mesh(unitBox, mat); m.scale.set(sx, sy, sz); m.position.copy(p); m.rotation.y = R.inRot; m.castShadow = true; parent.add(m); return m; }
    var wood = new T.MeshStandardMaterial({ color: 0x5b3f2a, roughness: 0.55 }), dark = new T.MeshStandardMaterial({ color: 0x1f2226, roughness: 0.5 });
    // 회사 이름 (안쪽 벽)
    var nTex = textTex([on], 1400, 220, '#1d2a3a', '#ffffff', 140);
    var nm = new T.Mesh(new T.PlaneGeometry(3.4, 0.55), new T.MeshBasicMaterial({ map: nTex, toneMapped: false })); nm.rotation.y = R.inRot; nm.position.copy(P(0.02, 0, 2.75)); parent.add(nm);
    // 큰 책상 + 모니터 둘 + 의자 (안쪽 벽을 등지고 문 쪽을 봄)
    boxAt(wood, 0.9, 0.06, 2.4, P(1.6, 0, 0.76));
    [-1, 1].forEach(function (sd) { boxAt(dark, 0.8, 0.72, 0.06, P(1.6, sd * 1.15, 0.37)); });
    [-0.45, 0.45].forEach(function (lat) {
      boxAt(dark, 0.05, 0.38, 0.62, P(1.85, lat, 1.03));
      var sc = new T.Mesh(new T.PlaneGeometry(0.58, 0.34), new T.MeshBasicMaterial({ color: 0x2a5d8a, toneMapped: false }));
      sc.rotation.y = R.inRot + Math.PI; sc.position.copy(P(1.82, lat, 1.03)); parent.add(sc);
    });
    var ch = new T.Group(); ch.position.copy(P(0.8, 0, 0)); ch.rotation.y = -s * Math.PI / 2; parent.add(ch);
    var seat = new T.Mesh(unitBox, dark); seat.scale.set(0.55, 0.1, 0.55); seat.position.y = 0.48; ch.add(seat);
    var back = new T.Mesh(unitBox, dark); back.scale.set(0.55, 0.75, 0.08); back.position.set(0, 0.9, -0.26); ch.add(back);
    var leg = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.45, 8), M.pole); leg.position.y = 0.23; ch.add(leg);
    OFFICE.chief = { x: P(0.8, 0, 0).x, z: P(0.8, 0, 0).z, rot: -s * Math.PI / 2 };   // 사장 자리 (2단계에서 AI 직원이 앉음)
    // 손님 의자 둘 (책상을 보고)
    [-0.6, 0.6].forEach(function (lat) {
      var p0 = P(2.6, lat, 0), g = new T.Group(); g.position.copy(p0); g.rotation.y = s * Math.PI / 2; parent.add(g);
      var se = new T.Mesh(unitBox, wood); se.scale.set(0.5, 0.06, 0.5); se.position.y = 0.46; g.add(se);
      var bk = new T.Mesh(unitBox, wood); bk.scale.set(0.5, 0.45, 0.05); bk.position.set(0, 0.72, -0.23); g.add(bk);
      addSeat(p0.x, p0.z, s * Math.PI / 2, 0.48);
    });
    // 회의 탁자 + 의자 여덟 (디스코드에서 온 출판사 사람들이 앉는 자리)
    boxAt(wood, 1.1, 0.05, 3.4, P(5.3, 0, 0.745));
    boxAt(dark, 1.0, 0.04, 3.3, P(5.3, 0, 0.70));                                                       // 상판 아래 틀
    [3.85, 6.75].forEach(function (d0) { [-0.42, 0.42].forEach(function (lat) { boxAt(dark, 0.07, 0.7, 0.07, P(d0, lat, 0.35)); }); boxAt(dark, 0.86, 0.05, 0.05, P(d0, 0, 0.12)); });
    var paper = new T.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }), screenM = new T.MeshBasicMaterial({ color: 0x9fc4e8, toneMapped: false });
    [[4.3, 0.3], [5.1, -0.3], [5.9, 0.3], [6.4, -0.3]].forEach(function (q, qi) {                      // 노트북·원고·컵
      boxAt(dark, 0.24, 0.015, 0.34, P(q[0], q[1], 0.78));
      var lid = boxAt(dark, 0.015, 0.22, 0.34, P(q[0], q[1] + (q[1] > 0 ? -0.13 : 0.13), 0.89)); lid.rotation.y = 0; lid.scale.set(0.34, 0.22, 0.015); lid.rotation.x = (q[1] > 0 ? 1 : -1) * 0.2;
      var sc = new T.Mesh(new T.PlaneGeometry(0.31, 0.19), screenM); sc.position.copy(P(q[0], q[1] + (q[1] > 0 ? -0.121 : 0.121), 0.89)); sc.rotation.y = q[1] > 0 ? 0 : Math.PI; sc.rotation.x = (q[1] > 0 ? 1 : -1) * 0.2; parent.add(sc);
      boxAt(paper, 0.3, 0.012, 0.21, P(q[0] + 0.38, q[1] * 0.8, 0.778)).rotation.y = R.inRot + qi * 0.4;
      var cup = new T.Mesh(new T.CylinderGeometry(0.035, 0.03, 0.09, 12), FURN.ceramic); cup.position.copy(P(q[0] - 0.3, q[1] * 0.6, 0.815)); parent.add(cup);
    });
    var vase = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 0.2, 14), FURN.ceramic); vase.position.copy(P(5.3, 0, 0.87)); parent.add(vase);
    OFFICE.seats = []; OFFICE.door = { x: R.fx + s * 1.0, z: z, rot: R.inRot };
    var armGeoC = rbox(0.05, 0.03, 0.34, 0.012), seatGeoC = rbox(0.5, 0.08, 0.5, 0.03), backGeoC = rbox(0.48, 0.5, 0.06, 0.03), spokeGeo = new T.BoxGeometry(0.04, 0.03, 0.3), casterGeo = new T.SphereGeometry(0.03, 8, 6);
    [1, -1].forEach(function (sd) { [4.1, 4.9, 5.7, 6.5].forEach(function (d0) {
      var p1 = P(d0, sd * 0.95, 0), g1 = new T.Group(), rot = sd > 0 ? Math.PI : 0; g1.position.copy(p1); g1.rotation.y = rot; parent.add(g1);
      part(g1, seatGeoC, dark, 0, 0.47, 0); part(g1, backGeoC, dark, 0, 0.82, -0.24, -0.1);
      part(g1, new T.CylinderGeometry(0.025, 0.025, 0.3, 8), M.pole, 0, 0.28, 0); part(g1, new T.BoxGeometry(0.04, 0.2, 0.04), M.pole, 0, 0.55, -0.25);
      [-1, 1].forEach(function (a) { part(g1, armGeoC, dark, a * 0.27, 0.68, 0.0); part(g1, new T.BoxGeometry(0.03, 0.2, 0.03), M.pole, a * 0.27, 0.57, 0.1); });
      for (var k5 = 0; k5 < 5; k5++) { var an = k5 * Math.PI * 2 / 5; part(g1, spokeGeo, M.pole, Math.sin(an) * 0.15, 0.1, Math.cos(an) * 0.15, 0, an, 0); part(g1, casterGeo, dark, Math.sin(an) * 0.3, 0.035, Math.cos(an) * 0.3); }
      OFFICE.seats.push({ x: p1.x, z: p1.z, rot: rot });
    }); });
    // 책장 (옆 벽) + 소파·탁자 (앞쪽) + 화분
    [-1, 1].forEach(function (sd) {
      var bx0 = R.bx + s * 0.3, zz = z + sd * (R.bw / 2 - 0.25);
      var sh = new T.Mesh(unitBox, wood); sh.scale.set(2.4, 2.2, 0.4); sh.position.set(bx0, gy + 1.1, zz); parent.add(sh);
      var lps = [], cols = [], rr = rnd(sd > 0 ? 41 : 43);
      for (var row = 0; row < 4; row++) for (var k = 0; k < 18; k++) { lps.push([bx0 - 1.1 + k * 0.12, gy + 0.35 + row * 0.5, zz - sd * 0.12, 0.08, 0.36, 0.25]); cols.push(PALETTE[Math.floor(rr() * PALETTE.length)]); }
      instBoxes(lps, EXT.spine, cols);
    });
    sofa(R.fx + s * 1.6, z + R.bw / 2 - 2.0, s * Math.PI / 2, 2, FURN.leather);
    coffeeTable(R.fx + s * 2.7, z + R.bw / 2 - 2.0, 0);
    plant(R.kx - s * 0.6, z - R.bw / 2 + 0.7, 1.1, 51);
  }
  function addDoorAndPlaza(w, back, front) {
    // 문틀 + 좌우로 열리는 유리 자동문 두 짝
    box(DOOR_W + 0.1, 0.1, 0.26, M.black, 0, DOOR_H + 0.05, front);
    [-1, 1].forEach(function (sd) { box(0.08, DOOR_H, 0.26, M.black, sd * (DOOR_W / 2), DOOR_H / 2, front); });
    var leaves = [-1, 1].map(function (sd) {
      var g = new T.Group(); g.position.set(sd * DOOR_W / 4, 0, front); parent.add(g);
      var gl = new T.Mesh(new T.PlaneGeometry(DOOR_W / 2 - 0.04, DOOR_H - 0.06), glassDoorMat); gl.position.y = DOOR_H / 2; g.add(gl);
      var fr = new T.Mesh(unitBox, M.black); fr.scale.set(0.05, DOOR_H - 0.06, 0.05); fr.position.set(-sd * (DOOR_W / 4 - 0.03), DOOR_H / 2, 0); g.add(fr);
      var hd = new T.Mesh(unitBox, M.pole); hd.scale.set(0.03, 0.6, 0.04); hd.position.set(-sd * (DOOR_W / 4 - 0.15), 1.05, 0.05); g.add(hd);
      return { g: g, sd: sd };
    });
    autoDoor = { leaves: leaves, open: 0, front: front };
    addFacade(w, back, front);   // 바깥에서 본 서재 (외장·위층·책등 벽·캐노피·옥상)
    addGallery(w);               // 길 건너 갤러리 ([거리] 설정)
    addJazzRoom(w);              // 길 건너 재즈 청음실 ([거리] 설정)
    addOffice(w);                // 길 건너 왼쪽 사무실 ([거리] 설정)
    // 안쪽·바깥 매트
    [front - 1.1, front + 1.1].forEach(function (mz) { var mat = new T.Mesh(new T.PlaneGeometry(3.2, 1.6), new T.MeshStandardMaterial({ color: 0x2b2d30, roughness: 1 })); mat.rotation.x = -Math.PI / 2; add(mat, 0, 0.015, mz); });
    // 앞마당 (보도블록) - 양옆 보도와 이어진다
    var pw = w + 10, plaza = new T.Mesh(new T.PlaneGeometry(pw, PLAZA_D), M.pave); plaza.rotation.x = -Math.PI / 2; plaza.receiveShadow = true;
    add(plaza, 0, 0.02, front + PLAZA_D / 2 + 0.1);
    var curb = new T.Mesh(unitBox, M.pole); curb.scale.set(pw, 0.12, 0.25); add(curb, 0, 0.06, front + PLAZA_D + 0.2);
    // 문 옆 화분 + 바깥 벤치 (앉을 수 있음)
    [-1, 1].forEach(function (sd) { plant(sd * (DOOR_W / 2 + 1.1), front + 0.9, 1.1, 21 + (sd > 0 ? 1 : 0)); });
    [-1, 1].forEach(function (sd) {
      var bx = sd * 7.5, bz = front + 3.2;
      box(2.2, 0.06, 0.5, M.oak, bx, 0.45, bz, true);
      [-0.95, 0.95].forEach(function (o) { box(0.05, 0.42, 0.42, M.black, bx + o, 0.21, bz); });
      [-0.6, 0.6].forEach(function (o) { addSeat(bx + o, bz, 0, 0.48); });   // 바깥을 보고 (길·건너편 건물)
    });
  }
  function updateDoor(dt) {   // 가까이 가면 열리고 멀어지면 닫힌다
    if (!autoDoor) return;
    var near = Math.abs(camera.position.x) < 3.2 && Math.abs(camera.position.z - autoDoor.front) < 3.4;
    for (var n in remotes) { var q = remotes[n]; if (Math.abs(q.g.position.x) < 3 && Math.abs(q.g.position.z - autoDoor.front) < 3) near = true; }
    autoDoor.open += ((near ? 1 : 0) - autoDoor.open) * Math.min(1, dt * 3.5);
    autoDoor.leaves.forEach(function (l) { l.g.position.x = l.sd * (DOOR_W / 4 + (DOOR_W / 2 - 0.1) * autoDoor.open); });
  }
  function isOutside(x, z) { return cur === 0 && layout && (z > layout.front + 0.2 || Math.abs(x) > layout.w / 2 + 0.2); }
  function walkable(x, z) {   // 걸어 다닐 수 있는 곳: 서재 안 + (1층이면) 문 + 앞마당 + 양옆 보도
    if (x >= hall.x0 && x <= hall.x1 && z >= hall.z0 && z <= hall.z1) return !(CINE_WALL != null && Math.abs(z - CINE_WALL) < 0.4 && Math.abs(x) > 2.6);   // 영화관 칸막이
    if (cur !== 0 || !layout) return false;
    var L = layout, ax = Math.abs(x), outer = L.w / 2 + 4.6;
    if (ax < DOOR_W / 2 - 0.35 && z > hall.z1 - 0.1 && z < L.front + 1.0) return autoDoor ? autoDoor.open > 0.55 : true;   // 문이 열려야 지나간다
    if (ax <= outer && z >= L.front + 0.45 && z <= L.front + PLAZA_D) return true;    // 앞마당
    if (ax >= L.w / 2 + 0.45 && ax <= outer && z >= L.back - 38 && z <= (RV ? RV.z1 + 1 : L.front + 38)) return true;   // 양옆 보도 (차도는 안 됨) - 강 건너까지
    if (campWalk(x, z)) return true;   // 나무다리 + 강 건너 캠핑장
    if (roomWalk(x, z)) return true;   // 횡단보도 건너 방들 (갤러리·재즈 청음실·사무실)
    return false;
  }
  function addBuilding(fl, cols, rows) {
    var w = cols * BOOTH_W + (cols - 1) * GAP + 12, back = -LOBBY - rows * (BOOTH_D + GAP) - 2, front = 10;
    var d = front - back, cz = (front + back) / 2;
    hall = { x0: -w / 2 + 0.6, x1: w / 2 - 0.6, z0: back + 0.6, z1: front - 0.6 };
    layout = { w: w, front: front, back: back, cols: cols, rows: rows, sections: [] };
    floorTex.repeat.set(w / 7, d / 7);
    var fl0 = new T.Mesh(new T.PlaneGeometry(w, d), M.floor);
    fl0.rotation.x = -Math.PI / 2; fl0.receiveShadow = true; add(fl0, 0, 0, cz);
    var ceil = new T.Mesh(new T.PlaneGeometry(w, d), M.ceil);
    ceil.rotation.x = Math.PI / 2; add(ceil, 0, CEIL, cz);
    // 매입 조명 (천장의 밝은 사각)
    for (var lz = front - 3; lz > back + 2; lz -= 4.5) {
      for (var lx = -w / 2 + 4; lx < w / 2 - 2; lx += 6) {
        var l = new T.Mesh(new T.PlaneGeometry(0.6, 0.6), M.lamp); l.rotation.x = Math.PI / 2; add(l, lx, CEIL - 0.01, lz);
      }
    }
    // 벽 + 걸레받이 (앞뒤 벽은 통으로, 옆벽은 창 구멍을 내서)
    var wins = [];
    for (var wz0 = front - 6; wz0 > back + 3; wz0 -= 7) wins.push(wz0);
    [[0, front, w, 0], [0, back, w, 0], [-w / 2, cz, d, Math.PI / 2], [w / 2, cz, d, Math.PI / 2]].forEach(function (s, si) {
      if (si === 0 && cur === 0) {   // 1층 앞벽: 문 자리를 비워 밖으로 나갈 수 있게 (자동문)
        var sw0 = (w - DOOR_W) / 2;
        [-1, 1].forEach(function (sd) { var wp = new T.Mesh(new T.BoxGeometry(sw0, CEIL, 0.2), M.wall); wp.receiveShadow = true; add(wp, sd * (DOOR_W / 2 + sw0 / 2), CEIL / 2, front); });
        add(new T.Mesh(new T.BoxGeometry(DOOR_W, CEIL - DOOR_H, 0.2), M.wall), 0, (CEIL + DOOR_H) / 2, front);
      } else if (si < 2) {
        var wall = new T.Mesh(new T.BoxGeometry(s[2], CEIL, 0.2), M.wall);
        wall.rotation.y = s[3]; wall.receiveShadow = true; add(wall, s[0], CEIL / 2, s[1]);
      } else sideWall(s[0], back, front, wins);
      var base = new T.Mesh(new T.BoxGeometry(s[2], 0.12, 0.24), M.black);
      base.rotation.y = s[3]; add(base, s[0], 0.06, s[1]);
    });
    addOutside(w, back, front, Math.max(0, cur));
    // 큰 창 (양옆 벽, 검은 창틀, 거의 투명한 유리 너머로 바깥 경치)
    for (var wz = front - 6; wz > back + 3; wz -= 7) {
      [-1, 1].forEach(function (side) {
        var gx = side * (w / 2 - 0.11);
        var glass = new T.Mesh(new T.PlaneGeometry(5.4, 3.6), M.glassPane);
        glass.rotation.y = -side * Math.PI / 2; add(glass, gx, 2.3, wz);
        [-2.7, 0, 2.7].forEach(function (o) { var mul = new T.Mesh(new T.BoxGeometry(0.05, 3.7, 0.06), M.black); mul.rotation.y = -side * Math.PI / 2; add(mul, gx, 2.3, wz + o); });
        [0.5, 4.1].forEach(function (y) { add(new T.Mesh(new T.BoxGeometry(0.06, 0.05, 5.5), M.black), gx, y, wz); });
      });
    }
    // 창으로 드는 햇빛 방향 + 그림자 범위
    sun.position.set(w / 2 + 10, 14, cz + 6);
    sun.target.position.set(0, 0, cz);
    var sc = sun.shadow.camera, ext = Math.max(w, d) / 2 + 4;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 80; sc.updateProjectionMatrix();
    // 입구 유리문
    autoDoor = null;
    if (cur === 0) { addDoorAndPlaza(w, back, front); }
    else {
      var door = new T.Mesh(new T.PlaneGeometry(3.6, 2.8), M.sky); door.rotation.y = Math.PI; add(door, 0, 1.4, front - 0.11);
      box(3.7, 0.06, 0.08, M.black, 0, 2.82, front - 0.14); box(0.05, 2.8, 0.08, M.black, 0, 1.4, front - 0.14);
    }
    // 간판 (흰 판, 검은 글씨) - 들어오면 정면 위
    var title = textTex(fl.cinema ? ['BookOasis 영화관', fl.label + '  ·  YMPlayer  ·  안쪽 상영관'] : ['BookOasis', fl.label + '  ·  보관함 ' + fl.libs.length + '  ·  작품 ' + fl.total.toLocaleString()],
      1600, 300, '#f7f5f1', '#1d1e20', 118);
    var signBoard = new T.Mesh(new T.BoxGeometry(8.4, 1.58, 0.06), [M.black, M.black, M.black, M.black, new T.MeshBasicMaterial({ map: title }), M.black]);
    add(signBoard, 0, 3.55, front - 7.5);
    [-3.8, 3.8].forEach(function (sx) { add(new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 4.34, 6), M.black), sx, (CEIL + 4.34) / 2, front - 7.5); });
    // 계산대 (흰 몸통, 원목 상판) + 벤치 + 화분
    box(4.6, 1.0, 0.9, M.white, w / 2 - 5.5, 0.5, front - 5.5, true);
    box(4.8, 0.05, 1.05, M.oak, w / 2 - 5.5, 1.02, front - 5.5, true);
    var deskSign = new T.Mesh(new T.PlaneGeometry(1.4, 0.28), new T.MeshBasicMaterial({ map: textTex(['INFORMATION · 안내'], 512, 100, '#f7f5f1', '#1d1e20', 46) }));
    add(deskSign, w / 2 - 5.5, 0.72, front - 5.04);
    box(2.4, 0.06, 0.5, M.oak, -2.8, 0.45, front - 3.2, true);
    [-0.75, 0, 0.75].forEach(function (ox) { addSeat(-2.8 + ox, front - 3.2, Math.PI, 0.48); });   // 입구 벤치 (로비 쪽을 보고)
    [-1.05, 1.05].forEach(function (o) { box(0.05, 0.42, 0.42, M.black, -2.8 + o, 0.21, front - 3.2); });
    [[w / 2 - 1.2, front - 1.2], [-w / 2 + 1.2, front - 1.2], [w / 2 - 1.2, back + 1.2], [-w / 2 + 1.2, back + 1.2]].forEach(function (p, i) {
      plant(p[0], p[1], 1.25, 3 + i);
    });
    // 라운지 (로비 양쪽, 통로를 피해서)
    var lx = Math.max(w / 2 - 6.5, 8);
    lounge(-lx, front - 13, false);
    lounge(lx, front - 13, true);
    // 층 안내판 (왼쪽, 이 층의 서가 목록)
    var lines = [fl.label].concat(fl.libs.slice(0, 15).map(function (l) { return l.name; }));
    if (fl.libs.length > 15) lines.push('… 외 ' + (fl.libs.length - 15) + '개');
    var dir = canvasTex(512, 760, function (g) {
      g.fillStyle = '#1d1e20'; g.fillRect(0, 0, 512, 760);
      g.fillStyle = '#f5f2ec'; g.textBaseline = 'top';
      lines.forEach(function (ln, i) { g.font = (i ? '400 30px ' : '700 44px ') + FONT; g.fillText(ln, 32, 28 + i * (i ? 44 : 60), 448); });
    });
    var stand = new T.Mesh(new T.BoxGeometry(1.4, 2.1, 0.05), [M.black, M.black, M.black, M.black, new T.MeshBasicMaterial({ map: dir }), M.black]);
    add(stand, -w / 2 + 5, 1.25, front - 6, true);
    box(0.5, 0.2, 0.3, M.black, -w / 2 + 5, 0.1, front - 6);
    // 엘리베이터 (왼쪽 벽, 스테인리스 문, 누르면 층 고르기)
    var ev = new T.Group(); ev.position.set(-w / 2 + 0.11, 0, front - 3); ev.rotation.y = Math.PI / 2; parent.add(ev);
    var frame = new T.Mesh(new T.BoxGeometry(2.5, 2.9, 0.06), M.black); frame.position.set(0, 1.45, 0.02); ev.add(frame);
    var doorM = new T.Mesh(new T.BoxGeometry(2.2, 2.7, 0.06), M.steel); doorM.position.set(0, 1.35, 0.06); ev.add(doorM);
    var seam = new T.Mesh(new T.BoxGeometry(0.01, 2.7, 0.07), M.black); seam.position.set(0, 1.35, 0.065); ev.add(seam);
    var lab = new T.Mesh(new T.PlaneGeometry(2.2, 0.32), new T.MeshBasicMaterial({ map: textTex(['ELEVATOR  ·  ' + fl.label], 640, 92, '#1d1e20', '#f5f2ec', 44) }));
    lab.position.set(0, 3.05, 0.06); ev.add(lab);
    doorM.userData.elevator = true;
    elevator = doorM;
  }

  // ── 사람들: 통로를 걷는 손님, 서가 앞에서 책을 고르는 손님, 서서 읽는 손님, 벤치에 앉은 손님, 안내 직원 ──
  // 옷 입은 사람 모형(Michelle)·관절 모형(Xbot)을 받으면 그것으로, 못 받으면 둥근 몸통·원통 팔다리로 만든 단순한 사람. 누를 수 없고 걸어 다니는 사람과 부딪히지 않는다.
  var people = [], layout = null, chatPair = null;
  var AI = { chat: false, ask: false, chat_sec: 60 };
  var SKIN = [0xf1c9a5, 0xe5b48e, 0xc99067, 0x9c6845, 0xf6d9c4];
  var CLOTH = [0x2f3b4c, 0x7a3b3b, 0xe4e0d8, 0x3f5a4a, 0x9b8f7a, 0x26292f, 0x5e6f86, 0xb07a4f, 0x6d5a7e, 0xcfc7b8, 0x8a9a6b];
  var PANTS = [0x23262b, 0x3a4352, 0x5b5248, 0x2e3a2f, 0xb9b0a0, 0x1f2633];
  var HAIR = [0x1d1a17, 0x3b2a1e, 0x6b4a2e, 0x9a7b5a, 0x2a2a2a, 0xb8b1a6];
  var torsoGeo = new T.LatheGeometry([new T.Vector2(0.15, 0), new T.Vector2(0.17, 0.14), new T.Vector2(0.195, 0.4),
    new T.Vector2(0.205, 0.5), new T.Vector2(0.17, 0.58), new T.Vector2(0.07, 0.63), new T.Vector2(0.0, 0.64)], 24);
  var legGeo = new T.CylinderGeometry(0.075, 0.058, 0.86, 14);
  var armGeo = new T.CylinderGeometry(0.052, 0.042, 0.6, 12);
  var ballGeo = new T.SphereGeometry(1, 20, 14);
  var hairGeo = new T.SphereGeometry(0.118, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
  var neckGeo = new T.CylinderGeometry(0.048, 0.052, 0.12, 12);
  function std(c, r) { return new T.MeshStandardMaterial({ color: c, roughness: r || 0.8 }); }

  function person(seed, beach) {
    var r = rnd(seed * 7919 + 13), pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var skin = std(pick(SKIN), 0.7), shirt = std(pick(CLOTH)), pants = std(pick(PANTS)), hair = std(pick(HAIR), 0.9),
        shoe = std(r() < 0.5 ? 0x1b1b1b : 0xe8e4dc, 0.6);
    if (beach) {   // 숨은 인물: 맨팔·맨다리(피부색) 위에 비키니, 샌들
      skin = std(0xf0c4a0, 0.65); shirt = skin; pants = skin; hair = std(0x5a3a22, 0.85); shoe = std(0xd8b47c, 0.7);
    }
    var g = new T.Group(), body = new T.Group();
    g.add(body);
    function limb(geo, mat, px, py, len) {
      var pivot = new T.Group(); pivot.position.set(px, py, 0); body.add(pivot);
      var m = new T.Mesh(geo, mat); m.position.y = -len / 2; m.castShadow = true; pivot.add(m);
      return pivot;
    }
    var legL = limb(legGeo, pants, -0.09, 0.92, 0.86), legR = limb(legGeo, pants, 0.09, 0.92, 0.86);
    [legL, legR].forEach(function (leg) {
      var s = new T.Mesh(ballGeo, shoe); s.scale.set(0.065, 0.045, 0.13); s.position.set(0, -0.88, 0.035); leg.add(s);
    });
    var torso = new T.Mesh(torsoGeo, shirt); torso.position.y = 0.88; torso.castShadow = true; body.add(torso);
    var armL = limb(armGeo, shirt, -0.235, 1.46, 0.6), armR = limb(armGeo, shirt, 0.235, 1.46, 0.6);
    [armL, armR].forEach(function (arm) { var hnd = new T.Mesh(ballGeo, skin); hnd.scale.setScalar(0.048); hnd.position.y = -0.64; arm.add(hnd); });
    var neck = new T.Mesh(neckGeo, skin); neck.position.y = 1.55; body.add(neck);
    var head = new T.Group(); head.position.y = 1.7; body.add(head);
    var face = new T.Mesh(ballGeo, skin); face.scale.set(0.105, 0.125, 0.11); face.castShadow = true; head.add(face);
    var hr = new T.Mesh(hairGeo, hair); hr.position.set(0, 0.025, -0.008); hr.rotation.x = -0.25; head.add(hr);
    if (beach) {
      var suit = std(0xe2465a, 0.5);
      var top = new T.Mesh(new T.CylinderGeometry(0.188, 0.195, 0.11, 24), suit); top.position.y = 1.3; body.add(top);
      [-1, 1].forEach(function (sd) {   // 끈
        var st = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.2, 6), suit); st.position.set(sd * 0.1, 1.42, 0.06); st.rotation.x = 0.3; body.add(st);
      });
      var bottom = new T.Mesh(new T.CylinderGeometry(0.158, 0.15, 0.13, 24), suit); bottom.position.y = 0.93; body.add(bottom);
      var long = new T.Mesh(new T.CylinderGeometry(0.1, 0.06, 0.38, 16), hair); long.position.set(0, -0.15, -0.07); head.add(long);   // 긴 머리
      var straw = std(0xe9d29a, 0.85);
      var brim = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 0.012, 32), straw); brim.position.y = 0.07; head.add(brim);
      var crown = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.1, 24), straw); crown.position.y = 0.12; head.add(crown);
      var band = new T.Mesh(new T.CylinderGeometry(0.121, 0.121, 0.025, 24), suit); band.position.y = 0.085; head.add(band);
    }
    var sc = beach ? 0.97 : 0.9 + r() * 0.16;
    g.scale.setScalar(sc);
    return { g: g, body: body, legL: legL, legR: legR, armL: armL, armR: armR, head: head, r: r, phase: r() * 6, sc: sc };
  }
  // ── 사람 모형: 옷 입은 사람(three.js 예제의 Michelle)에 Xbot의 걷기·서 있기 동작을 옮겨 입힌다 ──
  // Michelle을 못 받으면 Xbot 마네킹으로, 둘 다 못 받으면 위의 단순한 사람으로 그대로 둔다.
  var MODEL_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/models/gltf/';
  var HUMAN = { gltf: null, dressed: null, clips: {}, dclips: {}, looks: [], beachMat: null, man: null };
  // 남자 손님(readyplayer.me 예제 모형): 윗옷·바지 색과 수염
  var MAN_LOOKS = [
    { top: null, bottom: null, beard: true }, { top: 0x34445e, bottom: 0x2a2d35, beard: false },
    { top: 0x5a5f66, bottom: 0x1f2126, beard: true }, { top: 0x7b8a6a, bottom: 0x4a4038, beard: false },
    { top: 0x23252b, bottom: 0x23252b, beard: false }, { top: 0x8a4a3a, bottom: 0x3a4352, beard: true },
  ];
  var POSES = [];   // 덧입히는 동작은 쓰지 않는다(반복 끄덕임이 어색함) — 시선은 setLook()으로
  // 손님 옷차림: 바지·윗옷·피부색
  var LOOKS = [
    { pants: 0x2f4a6e, top: 0xf2efe8, skin: 0xe8b996 }, { pants: 0x1e1f22, top: 0x8c2f39, skin: 0xc68a62 },
    { pants: 0xb8a888, top: 0x2d3e57, skin: 0xf1cdb0 }, { pants: 0x4b5a3a, top: 0xd9c9a8, skin: 0x8d5a3b },
    { pants: 0xe8e4dc, top: 0x1d1d1f, skin: 0xe0ac86 }, { pants: 0x3a4352, top: 0x6f8fa8, skin: 0xf3d2b8 },
    { pants: 0x5b4636, top: 0xe9e2d0, skin: 0xd09a72 }, { pants: 0x26324a, top: 0xc9a227, skin: 0xb07650 },
  ];
  function respawn() {   // 지금 층의 사람들을 새 모형으로 다시 세운다
    if (cur < 0 || !floorGroup) return;
    people.forEach(function (q) { floorGroup.remove(q.g); disposeGroup(q.g); });
    parent = floorGroup; spawnPeople(floors[cur], cur + 1); parent = scene; dimEnv(floorGroup);
    if (remotes) Object.keys(remotes).forEach(dropRemote);   // 함께 보는 사람도 새 모형으로 다시
    if (staffNPC) dropStaff();
    if (brunchSpot) placeNarrator();   // 낭독가도 새 모형(엘프)으로
  }
  // three.js 예제의 Collada 모형: 걷는 스톰트루퍼(뼈대·동작 포함)와 받침대 위 엘프 피규어(정지 모형)
  var COLLADA_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r175/examples/models/collada/';
  function keepShared(root) {   // 층을 바꿀 때 지워도 원본은 남도록 형상·재질을 공용으로 표시
    root.traverse(function (o) {
      if (o.geometry) o.geometry.userData.shared = true;
      (Array.isArray(o.material) ? o.material : (o.material ? [o.material] : [])).forEach(function (m) { m.userData.keep = true; });
    });
  }
  function loadCollada() {
    if (!T.ColladaLoader || !T.SkeletonUtils) return;
    var cl = new T.ColladaLoader();
    cl.load(COLLADA_BASE + 'stormtrooper/stormtrooper.dae', function (c) {
      if (!c.scene.animations || !c.scene.animations.length) return;
      // 동작 트랙이 개체 고유 ID로 묶여 있어 복제본에 붙지 않는다 → 뼈 이름으로 바꿔 묶는다
      var byId = {}; c.scene.traverse(function (o) { byId[o.uuid] = o; });
      var clip = c.scene.animations[0].clone();
      clip.tracks.forEach(function (t) { var i = t.name.indexOf('.'), o = byId[t.name.slice(0, i)]; if (o && o.name) t.name = o.name + t.name.slice(i); });
      keepShared(c.scene); HUMAN.trooper = c.scene; HUMAN.trooperClip = clip; respawn();
    }, undefined, function (e) { console.warn('3D 서재 스톰트루퍼:', e); });
    cl.load(COLLADA_BASE + 'elf/elf.dae', function (c) {
      keepShared(c.scene); HUMAN.elf = c.scene; makeBunnyHair();
      try { HUMAN.elfRig = rigElf(c.scene); if (HUMAN.elfRig) HUMAN.elfRig.geo.userData.shared = true; }
      catch (e) { console.warn('3D 서재 엘프 뼈대:', e); HUMAN.elfRig = null; }   // 못 심으면 받침대째 피규어로
      respawn();
    }, undefined, function (e) { console.warn('3D 서재 엘프:', e); });
  }
  function robotHuman(r) {   // 걷다 멈추면 손 흔들기·엄지척·춤 같은 동작, 가까이 오면 손을 흔들며 놀란 표정
    var model = T.SkeletonUtils.clone(HUMAN.robot.scene);
    model.scale.setScalar(HUMAN.robotScale);
    var face = null;
    model.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.morphTargetDictionary && !face) face = o; } });
    var g = new T.Group(); g.add(model);
    var mixer = new T.AnimationMixer(model), C = HUMAN.robotClips, acts = {};
    if (C.Idle) { acts.idle = mixer.clipAction(C.Idle); acts.idle.play(); }
    if (C.Walking) { acts.walk = mixer.clipAction(C.Walking); acts.walk.play(); acts.walk.setEffectiveWeight(0); }
    mixer.update(r() * 2);
    return { g: g, mixer: mixer, acts: acts, clips: C, model: model, r: r, phase: r() * 6, sc: 1, walkW: 0, robot: true, face: face, greetAt: 0, walkRate: 1.1 };
  }
  function robotEmote(p, name, sec) {   // 한 번만 하는 동작 (그동안은 서 있는다)
    var clip = p.clips[name]; if (!clip) return;
    if (p.emote) p.emote.act.fadeOut(0.2);
    var a = p.mixer.clipAction(clip); a.reset(); a.setLoop(name === 'Dance' ? T.LoopRepeat : T.LoopOnce, 1); a.clampWhenFinished = true;
    a.setEffectiveWeight(1); a.fadeIn(0.25); a.play();
    var len = sec || clip.duration;
    p.emote = { act: a, left: len }; p.pause = Math.max(p.pause || 0, len + 0.3);
  }
  function robotMood(p, key, v) {   // 얼굴 표정 (morph: Angry·Surprised·Sad)
    if (!p.face) return;
    var i = p.face.morphTargetDictionary[key]; if (i == null) return;
    p.face.morphTargetInfluences[i] += (v - p.face.morphTargetInfluences[i]) * 0.15;
  }
  function updateRobot(p, dt, now) {
    var cx = camera.position.x - p.g.position.x, cz = camera.position.z - p.g.position.z, near = Math.hypot(cx, cz) < 3.2;
    if (near && now - p.greetAt > 25000 && !reading) {   // 가까이 온 사람에게 인사
      p.greetAt = now; p.greet = 2.2; robotEmote(p, p.r() < 0.5 ? 'Wave' : 'ThumbsUp');
    }
    if (p.greet > 0) {
      p.greet -= dt;
      var want = Math.atan2(cx, cz), c0 = p.g.rotation.y;
      p.g.rotation.y = c0 + Math.atan2(Math.sin(want - c0), Math.cos(want - c0)) * Math.min(1, dt * 5);
    }
    robotMood(p, 'Surprised', p.greet > 1.2 ? 1 : 0);
    if (p.emote) {
      p.emote.left -= dt;
      if (p.emote.left <= 0) { p.emote.act.fadeOut(0.3); p.emote = null; }
    } else if (p.pause > 0.8 && p.r() < dt * 0.6) {   // 멈춰 있을 때 가끔 한 가지 동작
      var pick = ['Wave', 'Yes', 'ThumbsUp', 'Dance', 'Jump', 'No'][Math.floor(p.r() * 6)];
      robotEmote(p, pick, pick === 'Dance' ? 3.5 : null);
    }
  }
  function trooperHuman(r) {   // 총을 든 채 걷는 동작 하나뿐이라 멈추지 않고 계속 순찰한다
    var model = T.SkeletonUtils.clone(HUMAN.trooper);
    model.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    var turn = new T.Group(); turn.rotation.y = Math.PI; turn.scale.setScalar(0.4); turn.add(model);   // 모형이 뒤(-Z)를 보고 있어 돌려 세운다
    var g = new T.Group(); g.add(turn);
    var mixer = new T.AnimationMixer(model), walk = mixer.clipAction(HUMAN.trooperClip);
    walk.play(); mixer.update(r() * 3);
    return { g: g, mixer: mixer, acts: { walk: walk }, clips: {}, model: model, r: r, phase: r() * 6, sc: 1, walkW: 1, alwaysWalk: true };
  }
  // ── 엘프에 사람 뼈대 심기: 뼈대 없는 피규어(elf.dae)에 Mixamo식 뼈대를 맞춰 넣고, 다른 손님과 같은 걷기·서 있기 동작을 입힌다 ──
  // 재질: 0 받침대(뗀다) / 1 몸·옷·부츠 / 2 얼굴 / 3 머리카락.
  // 몸은 이어진 덩어리로 나눠 다리(치마 아래)·부츠·소매·손을 찾고, 그 덩어리에서 관절 위치를 잰다.
  function rigElf(src) {
    src.updateMatrixWorld(true);
    var mesh = null; src.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return null;
    var g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g0.applyMatrix4(mesh.matrixWorld);
    var P = g0.attributes.position, n = P.count, i, t;
    var grp = new Int8Array(n);
    g0.groups.forEach(function (gr) { for (var q = gr.start; q < gr.start + gr.count; q++) grp[q] = gr.materialIndex; });
    if (g0.groups.length < 4) return null;
    var floorY = 1e9, topY = -1e9;
    for (i = 0; i < n; i++) if (grp[i] !== 0) { floorY = Math.min(floorY, P.getY(i)); topY = Math.max(topY, P.getY(i)); }
    var h = topY - floorY;
    function Y(q) { return P.getY(q) - floorY; }
    // 같은 자리 꼭짓점 묶기 + 덩어리 나누기
    var key = {}, vid = new Int32Array(n), nid = 0;
    for (i = 0; i < n; i++) {
      var k = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4);
      vid[i] = key[k] === undefined ? (key[k] = nid++) : key[k];
    }
    function components(test) {   // test(삼각형 첫 꼭짓점) 통과한 몸 삼각형만으로 이은 덩어리 → 꼭짓점별 덩어리 번호(-1 없음)
      var par = new Int32Array(nid); for (var a = 0; a < nid; a++) par[a] = a;
      function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      var ok = new Uint8Array(n);
      for (var tt = 0; tt < n / 3; tt++) {
        var b = tt * 3;
        if (grp[b] !== 1 || !test(b) || !test(b + 1) || !test(b + 2)) continue;
        ok[b] = ok[b + 1] = ok[b + 2] = 1;
        var x = find(vid[b]); par[x] = find(vid[b + 1]); x = find(vid[b + 1]); par[x] = find(vid[b + 2]);
      }
      var out = new Int32Array(n);
      for (var c = 0; c < n; c++) out[c] = ok[c] ? find(vid[c]) : -1;
      return out;
    }
    function stats(comp) {
      var s = {};
      for (var c = 0; c < n; c++) {
        if (comp[c] < 0) continue;
        var q = s[comp[c]] || (s[comp[c]] = { id: comp[c], n: 0, x: 0, y: 0, z: 0, y0: 1e9, y1: -1e9 });
        q.n++; q.x += P.getX(c); q.y += Y(c); q.z += P.getZ(c); q.y0 = Math.min(q.y0, Y(c)); q.y1 = Math.max(q.y1, Y(c));
      }
      return Object.keys(s).map(function (k2) { var q = s[k2]; q.x /= q.n; q.y /= q.n; q.z /= q.n; return q; }).sort(function (a, b) { return b.n - a.n; });
    }
    function centroid(test) {
      var v = new T.Vector3(), c = 0;
      for (var q = 0; q < n; q++) if (test(q)) { v.x += P.getX(q); v.y += Y(q); v.z += P.getZ(q); c++; }
      return c ? v.multiplyScalar(1 / c) : null;
    }
    function band(sel, y, w) {   // sel 꼭짓점 중 높이 y 둘레의 평균 (없으면 띠를 넓혀 다시)
      for (var k2 = 1; k2 < 40; k2 *= 2) {
        var c = centroid(function (q) { return sel(q) && Math.abs(Y(q) - y) < w * k2; });
        if (c) return c;
      }
      return null;
    }
    // 1) 다리: 사타구니(키의 43.5%) 아래 몸 삼각형의 큰 덩어리 둘 = 왼·오른 다리, 부츠는 가까운 다리로
    var crotch = h * 0.435;
    var lowComp = components(function (q) { return Y(q) < crotch; });
    var low = stats(lowComp);
    if (low.length < 2) return null;
    var legIds = [low[0], low[1]].sort(function (a, b) { return b.x - a.x; });   // [0] = +x = 모형의 왼쪽
    var part = new Int8Array(n).fill(-1);   // 0/1 왼·오른 다리, 2/3 왼·오른 팔
    for (i = 0; i < n; i++) {
      if (lowComp[i] === legIds[0].id) part[i] = 0;
      else if (lowComp[i] === legIds[1].id) part[i] = 1;
    }
    low.slice(2).forEach(function (c) {   // 부츠 등: 가까운 다리 쪽으로
      var d0 = Math.hypot(c.x - legIds[0].x, c.z - legIds[0].z), d1 = Math.hypot(c.x - legIds[1].x, c.z - legIds[1].z);
      for (var q = 0; q < n; q++) if (lowComp[q] === c.id) part[q] = d0 < d1 ? 0 : 1;
    });
    // 2) 팔: 어깨 아래 몸 삼각형 덩어리 중 몸통에서 옆으로 떨어진 것(소매·손)
    var armCut = h * 0.68;   // 이보다 높으면 소매가 어깨에서 스웨터와 이어진다
    var upComp = components(function (q) { return Y(q) > crotch * 0.9 && Y(q) < armCut; });
    var mid = centroid(function (q) { return grp[q] === 1 && Y(q) > crotch && Y(q) < h * 0.7; });
    stats(upComp).forEach(function (c) {
      if (c.n < 60 || Math.abs(c.x - mid.x) < h * 0.1 || c.y1 - c.y0 < h * 0.04) return;
      var sd = c.x > mid.x ? 2 : 3;
      for (var q = 0; q < n; q++) if (upComp[q] === c.id && part[q] < 0) part[q] = sd;
    });
    // 3) 관절 위치
    var J = {};
    [0, 1].forEach(function (s) {
      var tag = s === 0 ? 'Left' : 'Right';
      var legTop = centroid(function (q) { return part[q] === s && Y(q) > crotch - h * 0.05 && Y(q) < crotch; });
      var footMin = 1e9; for (var q = 0; q < n; q++) if (part[q] === s) footMin = Math.min(footMin, Y(q));
      var knee = band(function (q) { return part[q] === s; }, footMin + (crotch - footMin) * 0.5, h * 0.015);
      var ankle = band(function (q) { return part[q] === s; }, footMin + h * 0.07, h * 0.012);
      var maxZ = -1e9; for (q = 0; q < n; q++) if (part[q] === s && Y(q) < footMin + h * 0.03) maxZ = Math.max(maxZ, P.getZ(q));
      var toe = centroid(function (q) { return part[q] === s && Y(q) < footMin + h * 0.03 && P.getZ(q) > maxZ - h * 0.03; });
      J[tag + 'UpLeg'] = legTop.setY(crotch - h * 0.01); J[tag + 'Leg'] = knee; J[tag + 'Foot'] = ankle; J[tag + 'ToeBase'] = toe;
    });
    var hipC = J.LeftUpLeg.clone().add(J.RightUpLeg).multiplyScalar(0.5);
    function torsoAt(y) { var c = centroid(function (q) { return grp[q] === 1 && part[q] < 0 && Math.abs(Y(q) - y) < h * 0.012; }); return c || new T.Vector3(hipC.x, y, hipC.z); }
    J.Hips = new T.Vector3(hipC.x, crotch + h * 0.03, hipC.z);
    J.Spine = torsoAt(crotch + h * 0.10);
    J.Spine1 = torsoAt(crotch + h * 0.17);
    J.Spine2 = torsoAt(crotch + h * 0.24);
    var shY = 1e9, armTop = [null, null];
    var cnt = [0, 0, 0, 0]; for (i = 0; i < n; i++) if (part[i] >= 0) cnt[part[i]]++;
    if (cnt[2] < 50 || cnt[3] < 50) { console.warn('엘프 팔을 찾지 못함', cnt); return null; }
    [2, 3].forEach(function (s, j) {
      var top = -1e9; for (var q = 0; q < n; q++) if (part[q] === s) top = Math.max(top, Y(q));
      armTop[j] = top;
    });
    J.Neck = torsoAt(Math.min(h * 0.79, Math.max(armTop[0], armTop[1]) + h * 0.02));
    J.Neck.y = Math.max(J.Neck.y, J.Spine2.y + h * 0.04);
    var face = centroid(function (q) { return grp[q] === 2; });
    var chin = 1e9; for (i = 0; i < n; i++) if (grp[i] === 2) chin = Math.min(chin, Y(i));
    J.Neck.y = Math.max(J.Spine2.y + h * 0.04, chin - h * 0.075);   // 목 밑동
    J.Head = new T.Vector3(face.x, Math.max(J.Neck.y + h * 0.03, chin - h * 0.01), face.z - h * 0.005);   // 머리뼈 밑(턱 높이)
    J.HeadTop_End = new T.Vector3(face.x, h, face.z);
    // 척추는 골반 중심 → 머리 중심(얼굴+머리카락 중 목 위)으로 곧게: 높이별 단면 중심을 쓰면 가슴 때문에 앞으로 굽어
    // 걷기 동작을 옮길 때 상체가 숙여진다(꾸부정)
    var headC = centroid(function (q) { return (grp[q] === 2 || grp[q] === 3) && Y(q) > J.Neck.y + h * 0.02; }) || face;
    ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End'].forEach(function (nm) {
      var tq = (J[nm].y - J.Hips.y) / (h - J.Hips.y);
      J[nm].x = J.Hips.x + (headC.x - J.Hips.x) * tq; J[nm].z = J.Hips.z + (headC.z - J.Hips.z) * tq;
    });
    [2, 3].forEach(function (s, j) {
      var tag = s === 2 ? 'Left' : 'Right', top = armTop[j];
      var bot = 1e9; for (var q = 0; q < n; q++) if (part[q] === s) bot = Math.min(bot, Y(q));
      var len = top - bot;
      function at(f, w) { return band(function (q) { return part[q] === s; }, top - len * f, len * (w || 0.03)); }
      var sh = at(0.02, 0.04), el = at(0.36), wr = at(0.70), hd = at(0.97, 0.04);
      sh.y += h * 0.035;   // 찾은 팔 윗끝은 어깨보다 조금 아래
      J[tag + 'Arm'] = sh; J[tag + 'ForeArm'] = el; J[tag + 'Hand'] = wr; J[tag + 'HandEnd'] = hd;
      J[tag + 'Shoulder'] = new T.Vector3(J.Spine2.x + (sh.x - J.Spine2.x) * 0.35, sh.y + h * 0.01, J.Spine2.z + (sh.z - J.Spine2.z) * 0.35);
    });
    // 4) 뼈대 (부모, 자식 순서는 동작 옮기기에서 '첫 자식' 방향을 쓰므로 척추→목을 먼저)
    var TREE = [['Hips', null], ['Spine', 'Hips'], ['Spine1', 'Spine'], ['Spine2', 'Spine1'], ['Neck', 'Spine2'], ['Head', 'Neck'], ['HeadTop_End', 'Head'],
                ['LeftShoulder', 'Spine2'], ['LeftArm', 'LeftShoulder'], ['LeftForeArm', 'LeftArm'], ['LeftHand', 'LeftForeArm'],
                ['RightShoulder', 'Spine2'], ['RightArm', 'RightShoulder'], ['RightForeArm', 'RightArm'], ['RightHand', 'RightForeArm'],
                ['LeftUpLeg', 'Hips'], ['LeftLeg', 'LeftUpLeg'], ['LeftFoot', 'LeftLeg'], ['LeftToeBase', 'LeftFoot'],
                ['RightUpLeg', 'Hips'], ['RightLeg', 'RightUpLeg'], ['RightFoot', 'RightLeg'], ['RightToeBase', 'RightFoot']];
    var BI = {}; TREE.forEach(function (b, j) { BI[b[0]] = j; });
    // 5) 무게: 선분(뼈)까지 거리로 고르고, 이웃 뼈와 부드럽게 섞는다
    function segW(p, a, b) { var ab = b.clone().sub(a), tq = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return { d: p.distanceTo(a.clone().add(ab.multiplyScalar(tq))), t: tq }; }
    function chainW(p, names, ends) {   // 사슬 [뼈들], 각 뼈 선분 = 관절→다음 관절. 가장 가까운 둘을 거리 반비례로
      var best = [];
      for (var c = 0; c < names.length; c++) {
        var r = segW(p, J[names[c]], ends[c]);
        best.push({ b: BI[names[c]], d: r.d });
      }
      best.sort(function (a, b) { return a.d - b.d; });
      var a0 = best[0], a1 = best[1] || best[0], w0 = 1 / Math.pow(a0.d + 1e-4, 4), w1 = 1 / Math.pow(a1.d + 1e-4, 4);
      return [[a0.b, w0 / (w0 + w1)], [a1.b, w1 / (w0 + w1)]];
    }
    var chains = {
      legL: [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], [J.LeftLeg, J.LeftFoot, J.LeftToeBase]],
      legR: [['RightUpLeg', 'RightLeg', 'RightFoot'], [J.RightLeg, J.RightFoot, J.RightToeBase]],
      armL: [['LeftArm', 'LeftForeArm', 'LeftHand'], [J.LeftForeArm, J.LeftHand, J.LeftHandEnd]],
      armR: [['RightArm', 'RightForeArm', 'RightHand'], [J.RightForeArm, J.RightHand, J.RightHandEnd]],
      body: [['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'], [J.Spine, J.Spine1, J.Spine2, J.Neck, J.Head, J.HeadTop_End]]
    };
    function smooth(e0, e1, x) { var tq = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return tq * tq * (3 - 2 * tq); }
    var keep = [];
    g0.groups.forEach(function (gr) { if (gr.materialIndex === 0) return; for (var tt = gr.start / 3; tt < (gr.start + gr.count) / 3; tt++) keep.push([tt, gr.materialIndex]); });
    var names = ['position', 'normal', 'uv'].filter(function (nm) { return g0.attributes[nm]; });
    var m = keep.length * 3, arrs = {};
    names.forEach(function (nm) { arrs[nm] = new Float32Array(m * g0.attributes[nm].itemSize); });
    var sIdx = new Uint16Array(m * 4), sW = new Float32Array(m * 4), geo = new T.BufferGeometry(), lastMat = -1, gStart = 0;
    var pv = new T.Vector3();
    keep.forEach(function (kt, j) {
      if (kt[1] !== lastMat) { if (lastMat >= 0) geo.addGroup(gStart, j * 3 - gStart, lastMat); lastMat = kt[1]; gStart = j * 3; }
      for (var v = 0; v < 3; v++) {
        var srcI = kt[0] * 3 + v, dst = j * 3 + v, o = dst * 4;
        names.forEach(function (nm) { var at = g0.attributes[nm], sz = at.itemSize; for (var q = 0; q < sz; q++) arrs[nm][dst * sz + q] = at.array[srcI * sz + q]; });
        pv.set(P.getX(srcI), Y(srcI), P.getZ(srcI));
        var w;
        if (grp[srcI] === 2) w = [[BI.Head, 1]];
        else if (grp[srcI] === 3) {   // 머리카락: 목 위는 머리, 아래로 늘어진 머리는 가슴과 섞는다
          var hw = smooth(J.Neck.y - h * 0.08, J.Neck.y + h * 0.01, pv.y);
          w = [[BI.Head, hw], [BI.Spine2, 1 - hw]];
        } else if (part[srcI] === 0 || part[srcI] === 1) {
          w = chainW(pv, chains[part[srcI] === 0 ? 'legL' : 'legR'][0], chains[part[srcI] === 0 ? 'legL' : 'legR'][1]);
          var hb = smooth(crotch - h * 0.04, crotch, pv.y) * 0.3;   // 사타구니 근처는 골반과 섞기
          if (hb > 0) { w = w.map(function (x) { return [x[0], x[1] * (1 - hb)]; }); w.push([BI.Hips, hb]); }
        } else if (part[srcI] === 2 || part[srcI] === 3) {
          w = chainW(pv, chains[part[srcI] === 2 ? 'armL' : 'armR'][0], chains[part[srcI] === 2 ? 'armL' : 'armR'][1]);
        } else if (pv.y < crotch + h * 0.08) {   // 치마 속 허벅지 윗부분·엉덩이: 골반과 허벅지 중 가까운 쪽과 섞는다
          w = chainW(pv, ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg'], [J.Spine, J.Spine1, J.LeftLeg, J.RightLeg]);
        } else if (pv.y > armCut - h * 0.03 && pv.y < J.Neck.y) {   // 어깨 높이(소매 윗부분·어깨 띠): 몸통과 위팔 중 가까운 쪽과 섞는다
          w = chainW(pv, chains.body[0].concat(['LeftArm', 'RightArm']), chains.body[1].concat([J.LeftForeArm, J.RightForeArm]));
        } else {
          w = chainW(pv, chains.body[0], chains.body[1]);
        }
        for (var q2 = 0; q2 < 4; q2++) { sIdx[o + q2] = w[q2] ? w[q2][0] : 0; sW[o + q2] = w[q2] ? w[q2][1] : 0; }
      }
    });
    geo.addGroup(gStart, m - gStart, lastMat);
    names.forEach(function (nm) { geo.setAttribute(nm, new T.BufferAttribute(arrs[nm], g0.attributes[nm].itemSize)); });
    geo.translate(0, -floorY, 0);
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(sIdx, 4));
    geo.setAttribute('skinWeight', new T.Float32BufferAttribute(sW, 4));
    geo.computeBoundingSphere();
    var mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(function (mt) { var c2 = mt.clone(); c2.skinning = true; c2.userData.keep = true; return c2; });
    return { geo: geo, mats: mats, J: J, tree: TREE, h: h };
  }
  // 묶어 둔 엘프 하나 (뼈대는 사람마다 따로). 반환하는 root는 동작을 붙일 모형 뿌리
  function elfModel(rig) {
    var bones = [], byName = {};
    rig.tree.forEach(function (b) {
      var bone = new T.Bone(); bone.name = b[0]; byName[b[0]] = bone; bones.push(bone);
      var pos = rig.J[b[0]], parentPos = b[1] ? rig.J[b[1]] : new T.Vector3();
      bone.position.copy(pos).sub(parentPos);
      if (b[1]) byName[b[1]].add(bone);
    });
    var sk = new T.SkinnedMesh(rig.geo, rig.mats);
    sk.add(byName.Hips); sk.bind(new T.Skeleton(bones));
    sk.castShadow = true; sk.frustumCulled = false;
    var root = new T.Group(); root.add(sk);
    return root;
  }
  function elfWalker(r) {   // 사람 뼈대를 심은 엘프: 다른 손님과 같은 걷기·서 있기 동작
    if (!HUMAN.elfClips && HUMAN.gltf) {   // Xbot 동작을 엘프 뼈대로 한 번만 옮겨 둔다
      var tmpl = elfModel(HUMAN.elfRig), cl = {};
      ['idle', 'walk'].forEach(function (nm) { if (HUMAN.clips[nm]) cl[nm] = retargetClip(HUMAN.gltf.scene, tmpl, HUMAN.clips[nm]); });
      HUMAN.elfClips = cl;
    }
    var model = elfModel(HUMAN.elfRig); model.scale.setScalar(0.25);
    var g = new T.Group(); g.add(model);
    var mixer = new T.AnimationMixer(model), acts = {};
    ['idle', 'walk'].forEach(function (nm) { if (HUMAN.elfClips[nm]) acts[nm] = mixer.clipAction(HUMAN.elfClips[nm]); });
    if (acts.idle) acts.idle.play();
    if (acts.walk) { acts.walk.play(); acts.walk.setEffectiveWeight(0); }
    mixer.update(r() * 3);
    return { g: g, mixer: mixer, acts: acts, clips: HUMAN.elfClips, model: model, handL: findBone(model, 'LeftHand'), r: r, phase: r() * 6, sc: 1, walkW: 0, isElf: true };
  }
  function elfStatue() {   // 받침대가 붙은 실물 크기 피규어 (뼈대를 못 심었을 때)
    var e = HUMAN.elf.clone();
    e.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    var g = new T.Group(); e.scale.setScalar(0.25); g.add(e);
    return { g: g, r: rnd(7), phase: 0, kind: 'statue' };
  }
  function loadHumans() {
    loadCollada();
    if (!T.GLTFLoader || !T.SkeletonUtils) return;
    var loader = new T.GLTFLoader();
    // 로봇 손님: three.js 예제 webgl_animation_skinning_morph의 RobotExpressive (Tomás Laulhé/Quaternius, CC0)
    loader.load(MODEL_BASE + 'RobotExpressive/RobotExpressive.glb', function (rg) {
      rg.scene.traverse(function (o) { if (o.geometry) o.geometry.userData.shared = true; (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach(function (m) { m.userData.keep = true; }); });
      var box = new T.Box3().setFromObject(rg.scene);
      HUMAN.robot = rg; HUMAN.robotScale = 1.3 / Math.max(0.1, box.max.y - box.min.y);   // 키 1.3m쯤 (사람보다 조금 작게)
      HUMAN.robotClips = {}; rg.animations.forEach(function (c) { HUMAN.robotClips[c.name] = c; });
      respawn();
    }, undefined, function (e) { console.warn('3D 서재 로봇 손님 모형:', e && e.message); });
    loader.load(MODEL_BASE + 'Xbot.glb', function (gltf) {
      gltf.scene.traverse(function (o) { if (o.geometry) o.geometry.userData.shared = true; });
      var raw = {};
      gltf.animations.forEach(function (c) { raw[c.name] = c; HUMAN.clips[c.name] = c; });
      POSES.forEach(function (n) {
        if (raw[n]) { var c = raw[n].clone(); T.AnimationUtils.makeClipAdditive(c); HUMAN.clips[n] = c; }
      });
      HUMAN.gltf = gltf;
      respawn();
      loader.load(MODEL_BASE + 'Michelle.glb', function (dg) {
        try {
          var base = null;
          dg.scene.traverse(function (o) { if (o.geometry) o.geometry.userData.shared = true; if (o.isMesh) base = o.material; });
          ['idle', 'walk'].concat(POSES).forEach(function (n) {
            if (!raw[n]) return;
            var c = retargetClip(gltf.scene, dg.scene, raw[n]);
            if (POSES.indexOf(n) >= 0) T.AnimationUtils.makeClipAdditive(c);
            HUMAN.dclips[n] = c;
          });
          function mat(look) {
            var m = base.clone(); m.map = recolorSkin(base.map.image, look); m.userData.keep = true; return m;
          }
          HUMAN.looks = LOOKS.map(mat);
          var dmesh = null; dg.scene.traverse(function (o) { if (o.isSkinnedMesh && !dmesh) dmesh = o; });
          try {   // 숨은 인물: 옷 그림을 다시 칠하고 선글라스·헤드폰을 뗀 형상
            HUMAN.beachMat = paintBunny(dg, { pants: 0xf0c8a8, top: 0x8e0a1f, skin: 0xf0c8a8, beach: true });
            HUMAN.beachGeo = bunnyGeometry(dmesh);
            var hinfo = michelleHeadInfo(dmesh), hk = [], bi = HUMAN.beachGeo.index;   // 묶은 머리 떼기
            for (var ti = 0; ti < bi.count; ti += 3) if (!hinfo.hair[hinfo.find(bi.getX(ti))]) hk.push(bi.getX(ti), bi.getX(ti + 1), bi.getX(ti + 2));
            HUMAN.beachNoHair = HUMAN.beachGeo.clone(); HUMAN.beachNoHair.setIndex(hk); HUMAN.beachNoHair.userData.shared = true;
            HUMAN.beachHead = { mesh: dmesh, info: hinfo };
            makeBunnyHair();
          } catch (e) {
            console.warn('3D 서재 숨은 인물 옷:', e);
            HUMAN.beachMat = mat({ pants: 0xf0c8a8, top: 0x8e0a1f, skin: 0xf0c8a8, beach: true }); HUMAN.beachGeo = null;
          }
          HUMAN.dressed = dg;
          respawn();
        } catch (e) { console.warn('3D 서재 사람 모형:', e); HUMAN.dressed = null; }
        loader.load(MODEL_BASE + 'readyplayer.me.glb', function (mg) {
          try {
            var mats = {};
            mg.scene.traverse(function (o) { if (o.geometry) o.geometry.userData.shared = true; if (o.isMesh) mats[o.material.name] = o.material; });
            var mclips = {};
            ['idle', 'walk'].concat(POSES).forEach(function (n) {
              if (!raw[n]) return;
              var c = retargetClip(gltf.scene, mg.scene, raw[n]);
              if (POSES.indexOf(n) >= 0) T.AnimationUtils.makeClipAdditive(c);
              mclips[n] = c;
            });
            function suit(name, col) {
              var b = mats[name]; if (!b || col == null) return b;
              var m = b.clone(); if (b.map) m.map = recolorSuit(b.map.image, col); m.userData.keep = true; return m;
            }
            HUMAN.man = { scene: mg.scene, clips: mclips, looks: MAN_LOOKS.map(function (lk) {
              return { top: suit('Wolf3D_Outfit_Top', lk.top), bottom: suit('Wolf3D_Outfit_Bottom', lk.bottom), beard: lk.beard };
            }) };
            respawn();
          } catch (e) { console.warn('3D 서재 사람 모형:', e); HUMAN.man = null; }
        }, undefined, function (e) { console.warn('3D 서재 사람 모형:', e); /* 못 받으면 여자 손님만 */ });
      }, undefined, function (e) { console.warn('3D 서재 사람 모형:', e); /* 못 받으면 마네킹 그대로 */ });
    }, undefined, function (e) { console.warn('3D 서재 사람 모형:', e); /* 못 받으면 단순한 사람 그대로 */ });
  }
  // ── 옷 입은 사람: Michelle(glTF)에 Xbot의 걷기·서 있기 동작을 옮겨 입힌다 ──
  function boneKey(n) { return n.replace(/^mixamorig:?/, ''); }   // Mixamo 접두사를 빼면 readyplayer.me 뼈 이름과 같다
  function boneMap(root) { var o = {}; root.updateMatrixWorld(true); root.traverse(function (b) { if (b.isBone) o[boneKey(b.name)] = b; }); return o; }
  function worldQ(o) { var q = new T.Quaternion(); o.getWorldQuaternion(q); return q; }
  function worldP(o) { var v = new T.Vector3(); o.getWorldPosition(v); return v; }
  // 대상 모형의 기본 자세를 원본(T자)에 맞춘다: 뼈마다 자식 뼈를 향하는 방향을 원본과 같게 돌린다 (A자 → T자)
  function alignRest(S, root) {
    var order = []; root.traverse(function (b) { if (b.isBone) order.push(b); });
    order.forEach(function (db) {
      var sb = S[boneKey(db.name)]; if (!sb) return;
      var dc = null, sc2 = null;
      db.children.forEach(function (c) { if (!dc && c.isBone && S[boneKey(c.name)]) { dc = c; sc2 = S[boneKey(c.name)]; } });
      if (!dc) return;
      root.updateMatrixWorld(true);
      var sd = worldP(sc2).sub(worldP(sb)), dd = worldP(dc).sub(worldP(db));
      if (sd.lengthSq() < 1e-10 || dd.lengthSq() < 1e-10) return;
      var w = new T.Quaternion().setFromUnitVectors(dd.normalize(), sd.normalize()).multiply(worldQ(db));
      db.quaternion.copy(worldQ(db.parent).invert().multiply(w));
    });
    root.updateMatrixWorld(true);
  }
  // 두 모형의 기본 자세 차이를 뼈마다 앞뒤로 보정해 회전 동작만 옮긴다 (위치 이동 트랙은 버림: 제자리 걷기)
  function retargetClip(srcRoot, dstRoot0, clip) {
    var dstRoot = T.SkeletonUtils.clone(dstRoot0);
    var S = boneMap(srcRoot), D = boneMap(dstRoot), tracks = [];
    alignRest(S, dstRoot);
    clip.tracks.forEach(function (tr) {
      var mm = /^(.*)\.quaternion$/.exec(tr.name); if (!mm) return;
      var key = boneKey(mm[1]), sb = S[key], db = D[key]; if (!sb || !db) return;
      var P = worldQ(db.parent).invert().multiply(worldQ(sb.parent)), Q = worldQ(sb).invert().multiply(worldQ(db));
      var v = tr.values.slice(), q = new T.Quaternion();
      for (var i = 0; i < v.length; i += 4) { q.fromArray(v, i); q.premultiply(P).multiply(Q); q.toArray(v, i); }
      tracks.push(new T.QuaternionKeyframeTrack(db.name + '.quaternion', tr.times, v));
    });
    return new T.AnimationClip(clip.name, clip.duration, tracks);
  }
  function hsl2rgb(h, s, l) { var c = new T.Color(); c.setHSL(h, s, l); return [c.r * 255, c.g * 255, c.b * 255]; }
  // 바지(노란색)·윗옷(회색)·피부(갈색)를 골라 다시 칠한 옷 무늬를 만든다
  function recolorSkin(img, look) {
    var w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    var d = cx.getImageData(0, 0, w, h), a = d.data, hsl = {}, col = new T.Color();
    var pants = new T.Color(look.pants).getHSL({}), top = new T.Color(look.top).getHSL({}), skin = new T.Color(look.skin).getHSL({});
    for (var i = 0; i < a.length; i += 4) {
      col.setRGB(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255); col.getHSL(hsl);
      var out = null;
      if (hsl.h > 0.11 && hsl.h < 0.19 && hsl.s > 0.45 && hsl.l > 0.3) {   // 노란 바지
        out = hsl2rgb(pants.h, pants.s, Math.min(0.95, pants.l * hsl.l / 0.55));
      } else if (hsl.s < 0.1 && hsl.l > 0.3 && hsl.l < 0.62) {   // 회색 윗옷
        out = hsl2rgb(top.h, top.s, Math.min(0.95, top.l * hsl.l / 0.45));
      } else if (hsl.h > 0.02 && hsl.h < 0.1 && hsl.s > 0.25 && hsl.s < 0.75 && hsl.l > 0.12 && hsl.l < 0.6) {   // 피부
        out = hsl2rgb(skin.h, skin.s, Math.min(0.95, skin.l * hsl.l / 0.3));
      }
      if (look.beach && hsl.h > 0.45 && hsl.h < 0.56 && hsl.s > 0.3) out = hsl2rgb(skin.h, skin.s, skin.l);   // 바지 무늬 지우기
      if (out) { a[i] = out[0]; a[i + 1] = out[1]; a[i + 2] = out[2]; }
    }
    cx.putImageData(d, 0, 0);
    var tex = new T.CanvasTexture(cv); tex.flipY = false; tex.encoding = T.sRGBEncoding;
    return tex;
  }

  // 갈색 계열(정장·바지)만 골라 다른 색으로 다시 칠한다. 작게 줄여 칠해 빠르게
  function recolorSuit(img, hex) {
    var w = Math.min(512, img.width), h = Math.min(512, img.height), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
    var d = cx.getImageData(0, 0, w, h), a = d.data, hsl = {}, col = new T.Color(), to = new T.Color(hex).getHSL({});
    for (var i = 0; i < a.length; i += 4) {
      col.setRGB(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255); col.getHSL(hsl);
      if ((hsl.h < 0.11 || hsl.h > 0.97) && hsl.s > 0.08 && hsl.s < 0.65) {
        var out = hsl2rgb(to.h, to.s, Math.min(0.92, to.l * hsl.l / 0.38));
        a[i] = out[0]; a[i + 1] = out[1]; a[i + 2] = out[2];
      }
    }
    cx.putImageData(d, 0, 0);
    var tex = new T.CanvasTexture(cv); tex.flipY = false; tex.encoding = T.sRGBEncoding;
    return tex;
  }
  function findBone(root, name) {
    var re = new RegExp('(^|mixamorig:?)' + name + '$'), hit = null;
    root.traverse(function (o) { if (!hit && o.isBone && re.test(o.name)) hit = o; });
    return hit;
  }
  function onBone(bone, mesh, pos) {   // 뼈대에 붙이는 소품: 뼈대 축척(0.01)을 되돌려 실제 크기로 붙인다
    bone.updateWorldMatrix(true, false);
    var ws = new T.Vector3(); bone.getWorldScale(ws);
    var k = 1 / (ws.x || 1);
    mesh.scale.multiplyScalar(k);
    if (pos) mesh.position.set(pos[0] * k, pos[1] * k, pos[2] * k);
    bone.add(mesh); return mesh;
  }
  var SHIRT = [0x2f3b4c, 0x7a3b3b, 0xd9d3c7, 0x3f5a4a, 0x9b8f7a, 0x2b2e35, 0x5e6f86, 0xb07a4f, 0x6d5a7e, 0xc4b9a6, 0x8a9a6b, 0x34506b];
  function manHuman(r) {
    var model = T.SkeletonUtils.clone(HUMAN.man.scene), lk = HUMAN.man.looks[Math.floor(r() * HUMAN.man.looks.length)];
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      var n = o.material.name;
      if (n === 'Wolf3D_Outfit_Top' && lk.top) o.material = lk.top;
      else if (n === 'Wolf3D_Outfit_Bottom' && lk.bottom) o.material = lk.bottom;
      else if (n === 'Wolf3D_Beard') o.visible = lk.beard;
    });
    var g = new T.Group(); g.add(model);
    var mixer = new T.AnimationMixer(model), acts = {};
    ['idle', 'walk'].forEach(function (n) { if (HUMAN.man.clips[n]) acts[n] = mixer.clipAction(HUMAN.man.clips[n]); });
    if (acts.idle) acts.idle.play();
    if (acts.walk) { acts.walk.play(); acts.walk.setEffectiveWeight(0); }
    mixer.update(r() * 3);
    var sc = 0.96 + r() * 0.08;
    g.scale.setScalar(sc);
    return { g: g, mixer: mixer, acts: acts, clips: HUMAN.man.clips, model: model, handL: findBone(model, 'LeftHand'), r: r, phase: r() * 6, sc: sc, walkW: 0 };
  }
  // ── 숨은 인물 의상: 크리스마스 토끼 (빨간 벨벳 + 흰 털 테두리, 토끼 귀 머리띠, 털 목장식·리본, 손목 커프스, 빨간 망사 스타킹) ──
  var COSTUME = {
    red: new T.MeshStandardMaterial({ color: 0x8e0a1f, roughness: 0.8 }),   // 벨벳 느낌의 짙은 빨강
    fur: new T.MeshStandardMaterial({ color: 0xfbf8f3, roughness: 1 })
  };
  Object.keys(COSTUME).forEach(function (k) { COSTUME[k].userData.keep = true; });
  // ── 숨은 인물 옷 그림: Michelle 옷 그림을 픽셀마다 다시 칠한다 ──
  // 삼각형마다 옷 그림(UV) 안의 픽셀을 훑으며, 그 픽셀이 몸의 어디(기본 자세 높이, 미터)인지 무게중심 좌표로 구해 칠한다.
  // 바지 → 빨간 하의(옆이 높게 파인 모양)+허리 흰 털 / 맨 허벅지 / 빨간 스타킹 윗단 / 망사 스타킹,
  // 윗옷 → 가슴만 가리는 빨간 상의 + 윗단 흰 털, 나머지는 맨살. 원래 그림의 밝기로 주름 음영을 살린다.
  // 헤드폰 조각을 뺀 형상 (이어진 덩어리 단위: 머리 둘레의 빨간 헤드폰. 선글라스는 남김)
  function bunnyGeometry(mesh) {
    var geo = mesh.geometry, P = geo.attributes.position, UV = geo.attributes.uv, idx = geo.index, n = P.count, i;
    var img = mesh.material.map.image, W = img.width, H = img.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'); g.drawImage(img, 0, 0); var pd = g.getImageData(0, 0, W, H).data;
    var par = new Int32Array(n); for (i = 0; i < n; i++) par[i] = i;
    function f(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    for (var t = 0; t < idx.count; t += 3) { var a = f(idx.getX(t)), b = f(idx.getX(t + 1)), c = f(idx.getX(t + 2)); par[a] = b; par[f(b)] = f(c); }
    var C = {}, col = new T.Color(), hsl = {};
    for (i = 0; i < n; i++) {
      var r = f(i), q = C[r] || (C[r] = { n: 0, red: 0, mn: [9, 9, 9], mx: [-9, -9, -9] });
      q.n++; [P.getX(i), P.getY(i), P.getZ(i)].forEach(function (v, k) { q.mn[k] = Math.min(q.mn[k], v); q.mx[k] = Math.max(q.mx[k], v); });
      var x = Math.min(W - 1, Math.floor(UV.getX(i) * W)), y = Math.min(H - 1, Math.floor(UV.getY(i) * H)), o = (y * W + x) * 4;
      col.setRGB(pd[o] / 255, pd[o + 1] / 255, pd[o + 2] / 255); col.getHSL(hsl);
      if (hsl.s > 0.45 && (hsl.h < 0.14 || hsl.h > 0.93) && hsl.l > 0.25) q.red++;
    }
    function drop(q) {
      // 선글라스(얼굴 앞, z > 0.06)는 남겨 코를 가린다
      return q.mn[1] > 1.36 && q.red / q.n > 0.3 && q.mn[2] < 0.06;                                                 // 헤드폰
    }
    var keep = [];
    for (t = 0; t < idx.count; t += 3) if (!drop(C[f(idx.getX(t))])) keep.push(idx.getX(t), idx.getX(t + 1), idx.getX(t + 2));
    var out = geo.clone(); out.setIndex(keep); out.userData.shared = true;
    return out;
  }
  function paintBunny(dg, look) {
    var mesh = null; dg.scene.traverse(function (o) { if (o.isSkinnedMesh && !mesh) mesh = o; });
    var base = mesh.material, img = base.map.image, W = img.width, H = img.height;
    var src = document.createElement('canvas'); src.width = W; src.height = H;
    var sx = src.getContext('2d'); sx.drawImage(img, 0, 0);
    var px = sx.getImageData(0, 0, W, H).data;
    var tex = recolorSkin(img, look), cx = tex.image.getContext('2d');
    var outD = cx.getImageData(0, 0, W, H), out = outD.data;
    var col = new T.Color(), hsl = {};
    var CL = new Int8Array(W * H), LUM = new Float32Array(W * H);   // 원래 그림의 부위(1 바지·줄무늬·어두운 단, 2 윗옷)와 밝기
    for (var i = 0; i < W * H; i++) {
      col.setRGB(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255); col.getHSL(hsl);
      LUM[i] = hsl.l;
      if (hsl.h > 0.0 && hsl.h < 0.11 && hsl.s > 0.2 && hsl.l > 0.04 && hsl.l < 0.6) CL[i] = 4;   // 피부 (짙은 갈색 포함)
      else if ((hsl.h > 0.11 && hsl.h < 0.19 && hsl.s > 0.45 && hsl.l > 0.3) || (hsl.h > 0.45 && hsl.h < 0.56 && hsl.s > 0.3) || hsl.l < 0.3) CL[i] = 1;
      else if (hsl.s < 0.1 && hsl.l > 0.3 && hsl.l < 0.62) CL[i] = 2;
      else if ((hsl.h < 0.05 || hsl.h > 0.93) && hsl.s > 0.55 && hsl.l > 0.25) CL[i] = 3;   // 빨강 (선글라스·헤드폰)
      else if (hsl.h > 0.02 && hsl.h < 0.1 && hsl.s > 0.25 && hsl.s < 0.75 && hsl.l > 0.12 && hsl.l < 0.6) CL[i] = 4;   // 피부
    }
    // 칠할 맨살 색: 다시 칠한 그림에서 원래 피부였던 픽셀의 평균 (팔·얼굴 피부와 같은 톤)
    var fr = [], fl = [];   // 얼굴 피부(코 아래 볼) 색과 밝기
    var rs = [], gs = [], bs = [];   // 맨살 색: 아래팔 꼭짓점 그림 색의 가운데값 (팔과 같은 톤)
    var PP = mesh.geometry.attributes.position, UU = mesh.geometry.attributes.uv;
    for (i = 0; i < PP.count; i++) {
      var ax0 = Math.abs(PP.getX(i)); if (ax0 < 0.32 || ax0 > 0.5 || PP.getY(i) < 1.2 || PP.getY(i) > 1.36) continue;
      var ux = Math.min(W - 1, Math.floor(UU.getX(i) * W)), uy = Math.min(H - 1, Math.floor(UU.getY(i) * H)), up = (uy * W + ux) * 4;
      rs.push(out[up]); gs.push(out[up + 1]); bs.push(out[up + 2]);
    }
    function med(a) { a.sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)] / 255; }
    var skin = rs.length ? new T.Color(med(rs), med(gs), med(bs)) : new T.Color(look.skin), red = new T.Color(0x8e0a1f), fur = new T.Color(0xf7f3ec), netRed = new T.Color(0xa3102a);
    function put(o, c, shade) {
      out[o] = Math.min(255, c.r * 255 * shade); out[o + 1] = Math.min(255, c.g * 255 * shade); out[o + 2] = Math.min(255, c.b * 255 * shade);
    }
    var P = mesh.geometry.attributes.position, UV = mesh.geometry.attributes.uv, idx = mesh.geometry.index;
    // 얼굴 덩어리(머리 높이에서 가장 큰, 앞으로 나온 덩어리) - 눈·눈썹은 따로라 건드리지 않는다
    var par = new Int32Array(P.count); for (var vi = 0; vi < P.count; vi++) par[vi] = vi;
    function fnd(q) { while (par[q] !== q) { par[q] = par[par[q]]; q = par[q]; } return q; }
    for (var ti = 0; ti < idx.count; ti += 3) { var r1 = fnd(idx.getX(ti)), r2 = fnd(idx.getX(ti + 1)), r3 = fnd(idx.getX(ti + 2)); par[r1] = r2; par[fnd(r2)] = fnd(r3); }
    var cs = {};
    for (vi = 0; vi < P.count; vi++) { var rc = fnd(vi), cq = cs[rc] || (cs[rc] = { n: 0, y0: 9, y1: -9, z1: -9 }); cq.n++; cq.y0 = Math.min(cq.y0, P.getY(vi)); cq.y1 = Math.max(cq.y1, P.getY(vi)); cq.z1 = Math.max(cq.z1, P.getZ(vi)); }
    var faceComp = -1, best = 0;
    Object.keys(cs).forEach(function (kk) { var cq = cs[kk]; if (cq.y0 > 1.3 && cq.y1 < 1.6 && cq.z1 > 0.08 && cq.n > best) { best = cq.n; faceComp = +kk; } });
    for (vi = 0; vi < P.count; vi++) {   // 볼·턱(그늘 아래) 그림 색
      if (fnd(vi) !== faceComp || P.getY(vi) < 1.33 || P.getY(vi) > 1.385 || P.getZ(vi) < 0.03) continue;
      var vx = Math.min(W - 1, Math.floor(UV.getX(vi) * W)), vy = Math.min(H - 1, Math.floor(UV.getY(vi) * H)), vp = vy * W + vx;
      fr.push([out[vp * 4], out[vp * 4 + 1], out[vp * 4 + 2]]); fl.push(LUM[vp]);
    }
    fr.sort(function (p1, p2) { return (p1[0] + p1[1] + p1[2]) - (p2[0] + p2[1] + p2[2]); }); fl.sort();
    var faceC = fr.length ? new T.Color(fr[fr.length >> 1][0] / 255, fr[fr.length >> 1][1] / 255, fr[fr.length >> 1][2] / 255) : skin;
    var faceL = fl.length ? fl[fl.length >> 1] : 0.3;
    var tri = idx ? idx.count / 3 : P.count / 3;
    for (var t = 0; t < tri; t++) {
      var a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      var ya = P.getY(a), yb = P.getY(b), yc = P.getY(c);
      if (Math.max(ya, yb, yc) < 0.12) continue;
      var isFace = fnd(a) === faceComp;
      var xa = Math.abs(P.getX(a)), xb = Math.abs(P.getX(b)), xc = Math.abs(P.getX(c));
      var ax = UV.getX(a) * W, ay = UV.getY(a) * H, bx = UV.getX(b) * W, by = UV.getY(b) * H, cxp = UV.getX(c) * W, cyp = UV.getY(c) * H;
      var den = (by - cyp) * (ax - cxp) + (cxp - bx) * (ay - cyp);
      if (Math.abs(den) < 1e-9) continue;
      var x0 = Math.max(0, Math.floor(Math.min(ax, bx, cxp) - 1)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cxp) + 1));
      var y0 = Math.max(0, Math.floor(Math.min(ay, by, cyp) - 1)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cyp) + 1));
      for (var py = y0; py <= y1; py++) for (var pxx = x0; pxx <= x1; pxx++) {
        var qx = pxx + 0.5, qy = py + 0.5;
        var w1 = ((by - cyp) * (qx - cxp) + (cxp - bx) * (qy - cyp)) / den, w2 = ((cyp - ay) * (qx - cxp) + (ax - cxp) * (qy - cyp)) / den, w3 = 1 - w1 - w2;
        if (w1 < -0.02 || w2 < -0.02 || w3 < -0.02) continue;   // 이음매가 비지 않게 살짝 넓게
        var pi = py * W + pxx, k = CL[pi];
        if (!k && !isFace) continue;
        var y = w1 * ya + w2 * yb + w3 * yc, x = w1 * xa + w2 * xb + w3 * xc, o = pi * 4;
        if (isFace) {   // 얼굴: 몸과 같은 맨살 색에 원래 밝기 음영만 (선글라스 그늘은 걷어 낸다), 속눈썹·입술은 그대로
          col.setRGB(px[pi * 4] / 255, px[pi * 4 + 1] / 255, px[pi * 4 + 2] / 255); col.getHSL(hsl);
          if ((LUM[pi] < 0.1 && y > 1.435) || ((hsl.h < 0.03 || hsl.h > 0.9) && hsl.s > 0.35)) continue;
          var shade = LUM[pi] / faceL;
          if (y > 1.385 && y < 1.47) shade = Math.max(0.95, shade);
          put(o, skin, Math.max(0.6, Math.min(1.12, shade))); continue;
        }
        if (k === 4 && y > 1.2) { put(o, skin, Math.max(0.6, Math.min(1.12, LUM[pi] / faceL))); continue; }   // 목·귀 등도 같은 맨살 색
        if (k === 3 || k === 4) continue;
        if (k === 1 && y > 0.12 && y < 1.06 && x < 0.3) {
          var sh = Math.max(0.65, Math.min(1.25, LUM[pi] / 0.5));   // 원래 바지 주름 음영
          var cut = 0.865 + Math.min(1, x / 0.16) * 0.1;            // 하의 아랫선: 가운데 낮고 옆으로 갈수록 높게
          if (y > 1.0) put(o, skin, 1);
          else if (y > 0.975) put(o, fur, Math.min(1, sh));
          else if (y > cut) put(o, red, sh);
          else if (y > 0.70) put(o, skin, 1);
          else if (y > 0.67) put(o, red, sh);
          else {   // 망사: 옷 그림 좌표로 사선 격자
            var g1 = (pxx + py) % 9, g2 = (pxx - py + 900) % 9;
            put(o, g1 < 1.4 || g2 < 1.4 ? netRed : skin, g1 < 1.4 || g2 < 1.4 ? sh : 1);
          }
        } else if (k === 2 && y > 1.0 && y < 1.45) {
          var sh2 = Math.max(0.7, Math.min(1.25, LUM[pi] / 0.45));
          if (y > 1.155 && y < 1.255) put(o, red, sh2);          // 가슴만 가리는 상의
          else if (y >= 1.255 && y < 1.28) put(o, fur, Math.min(1, sh2));
          else put(o, skin, 1);
        }
      }
    }
    cx.putImageData(outD, 0, 0);
    tex.needsUpdate = true;
    var m = base.clone(); m.map = tex; m.userData.keep = true;

    return m;
  }
  // ── 숨은 인물 머리: Michelle의 묶은 머리를 떼고, 엘프의 긴 머리카락을 크기·위치를 맞춰 머리뼈에 붙인다 ──
  function michelleHeadInfo(mesh) {   // 얼굴 덩어리(머리 높이에서 가장 큰, 앞으로 나온) 중심·높이, 떼어 낼 머리카락 덩어리
    var geo = mesh.geometry, P = geo.attributes.position, UV = geo.attributes.uv, idx = geo.index, n = P.count, i, t;
    var img = mesh.material.map.image, W = img.width, H = img.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'); g.drawImage(img, 0, 0); var pd = g.getImageData(0, 0, W, H).data;
    var par = new Int32Array(n); for (i = 0; i < n; i++) par[i] = i;
    function f(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    for (t = 0; t < idx.count; t += 3) { var a = f(idx.getX(t)), b = f(idx.getX(t + 1)), c = f(idx.getX(t + 2)); par[a] = b; par[f(b)] = f(c); }
    var C = {}, col = new T.Color(), hsl = {};
    for (i = 0; i < n; i++) {
      var r = f(i), q = C[r] || (C[r] = { id: r, n: 0, dark: 0, s: new T.Vector3(), mn: [9, 9, 9], mx: [-9, -9, -9] });
      q.n++; q.s.x += P.getX(i); q.s.y += P.getY(i); q.s.z += P.getZ(i);
      [P.getX(i), P.getY(i), P.getZ(i)].forEach(function (v, k) { q.mn[k] = Math.min(q.mn[k], v); q.mx[k] = Math.max(q.mx[k], v); });
      var x = Math.min(W - 1, Math.floor(UV.getX(i) * W)), y = Math.min(H - 1, Math.floor(UV.getY(i) * H)), o = (y * W + x) * 4;
      col.setRGB(pd[o] / 255, pd[o + 1] / 255, pd[o + 2] / 255); col.getHSL(hsl);
      if (hsl.l < 0.2 && hsl.s < 0.5) q.dark++;
    }
    var face = null;
    Object.keys(C).forEach(function (k) { var q = C[k]; if (q.mn[1] > 1.3 && q.mx[1] < 1.6 && q.mx[2] > 0.08 && (!face || q.n > face.n)) face = q; });
    var hair = {};
    Object.keys(C).forEach(function (k) {   // 머리 높이의 어두운 덩어리 = 머리카락 (눈썹·속눈썹처럼 얼굴 앞에 붙은 것은 남김)
      var q = C[k];
      if (q !== face && q.mx[1] > 1.4 && q.mn[1] > 1.25 && q.dark / q.n > 0.5 && q.mn[2] < 0.03) hair[q.id] = 1;
    });
    return { find: f, hair: hair, center: face.s.clone().multiplyScalar(1 / face.n), h: face.mx[1] - face.mn[1], top: face.mx[1] };
  }
  function elfHairGeometry(src) {   // 엘프 모형에서 머리카락(재질 3)만, 얼굴(재질 2) 기준 중심·높이와 함께
    src.updateMatrixWorld(true);
    var mesh = null; src.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
    var g0 = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g0.applyMatrix4(mesh.matrixWorld);
    var grp = {}; g0.groups.forEach(function (gr) { grp[gr.materialIndex] = gr; });
    if (!grp[2] || !grp[3]) return null;
    var P = g0.attributes.position, fc = new T.Vector3(), fy0 = 1e9, fy1 = -1e9;
    for (var i = grp[2].start; i < grp[2].start + grp[2].count; i++) { fc.x += P.getX(i); fc.y += P.getY(i); fc.z += P.getZ(i); fy0 = Math.min(fy0, P.getY(i)); fy1 = Math.max(fy1, P.getY(i)); }
    fc.multiplyScalar(1 / grp[2].count);
    var hair = new T.BufferGeometry();
    ['position', 'normal', 'uv'].forEach(function (nm) {
      var at = g0.attributes[nm]; if (!at) return;
      hair.setAttribute(nm, new T.BufferAttribute(at.array.slice(grp[3].start * at.itemSize, (grp[3].start + grp[3].count) * at.itemSize), at.itemSize));
    });
    var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return { geo: hair, mat: mats[3], center: fc, h: fy1 - fy0 };
  }
  // 엘프 머리카락을 Michelle 머리뼈에 붙일 형상(머리뼈 좌표계)으로
  function bunnyHair(mesh, info, elf) {
    var s = info.h / elf.h, geo = elf.geo.clone();
    geo.translate(-elf.center.x, -elf.center.y, -elf.center.z);
    geo.scale(s, s, s);
    geo.translate(info.center.x, info.center.y + info.h * 0.03, info.center.z - info.h * 0.04);
    var sk = mesh.skeleton, hi = sk.bones.findIndex(function (b) { return /Head$/.test(b.name); });
    geo.applyMatrix4(sk.boneInverses[hi]);   // 기본 자세(형상 공간) → 머리뼈 공간
    geo.computeBoundingSphere(); geo.userData.shared = true;
    var mat = elf.mat.clone(); mat.skinning = false; mat.color = new T.Color(0x3a2216); mat.userData.keep = true;   // 금발을 짙은 갈색으로
    return { geo: geo, mat: mat, bone: sk.bones[hi].name };
  }
  function makeBunnyHair() {   // 엘프와 Michelle이 모두 준비되면 한 번 만든다
    if (HUMAN.bunnyHair || !HUMAN.elf || !HUMAN.beachHead) return;
    try {
      var elf = elfHairGeometry(HUMAN.elf);
      if (elf) HUMAN.bunnyHair = bunnyHair(HUMAN.beachHead.mesh, HUMAN.beachHead.info, elf);
    } catch (e) { console.warn('3D 서재 숨은 인물 머리:', e); }
  }
  function santaBunny(model, hips, head) {
    hips.updateWorldMatrix(true, false);
    var ws = new T.Vector3(); hips.getWorldScale(ws);
    var k = 1 / (ws.x || 1);   // 뼈대 축척(0.01)을 되돌려 미터 단위로 붙인다 (가늘게 줄인 다리 뼈에 붙인 것은 같이 가늘어진다)
    function put(bone, geo, mat, pos, rot, scl) {
      if (!bone) return null;
      var m = new T.Mesh(geo, mat); m.castShadow = true;
      m.scale.setScalar(k); if (scl) m.scale.set(k * scl[0], k * scl[1], k * scl[2]);
      if (pos) m.position.set(pos[0] * k, pos[1] * k, pos[2] * k);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      bone.add(m); return m;
    }
    function len(bone) { var c = bone && bone.children.filter(function (x) { return x.isBone; })[0]; return c ? c.position.length() / k : 0.3; }
    // 헐렁한 바지 몸매를 맨다리·좁은 골반으로 (자식 뼈에서 축척을 되돌려 몸통·발은 그대로)
    var spine = findBone(model, 'Spine');
    hips.scale.set(0.82, 1, 0.85); if (spine) spine.scale.set(1 / 0.82, 1, 1 / 0.85);
    ['Left', 'Right'].forEach(function (sd) {
      var up = findBone(model, sd + 'UpLeg'), lg = findBone(model, sd + 'Leg'), ft = findBone(model, sd + 'Foot');
      if (up) up.scale.set(0.62 / 0.82, 1, 0.62 / 0.85);
      if (lg) lg.scale.set(0.72, 1, 0.72);
      if (ft) ft.scale.set(1 / (0.62 * 0.72), 1, 1 / (0.62 * 0.72));
    });
    var spine2 = findBone(model, 'Spine2'), neck = findBone(model, 'Neck');
    // 토끼 귀 머리띠
    put(head, new T.TorusGeometry(0.1, 0.008, 6, 24, Math.PI), COSTUME.red, [0, 0.15, 0.01]);
    [-1, 1].forEach(function (sd) {
      var ear = put(head, new T.SphereGeometry(1, 16, 12), COSTUME.fur, [sd * 0.055, 0.31, 0], [0, 0, -sd * 0.22], [0.034, 0.12, 0.016]);
      if (ear) put(head, new T.SphereGeometry(1, 16, 12), COSTUME.red, [sd * 0.057, 0.30, 0.009], [0, 0, -sd * 0.22], [0.02, 0.095, 0.01]);
    });
    // 털 목장식 + 빨간 리본
    put(neck, new T.TorusGeometry(0.047, 0.013, 8, 24), COSTUME.fur, [0, 0.055, 0.008], [Math.PI / 2, 0, 0]);
    [-1, 1].forEach(function (sd) { put(neck, new T.SphereGeometry(1, 10, 8), COSTUME.red, [sd * 0.013, 0.04, 0.058], [0, 0, sd * 0.6], [0.015, 0.009, 0.007]); });
    // 상의·하의·스타킹은 옷 그림을 다시 칠해 표현한다 (paintBunny)
    // 손목 커프스 (아래팔 끝)
    ['Left', 'Right'].forEach(function (sd) {
      var fa = findBone(model, sd + 'ForeArm'), L = len(fa);
      put(fa, new T.CylinderGeometry(0.036, 0.033, 0.07, 16), COSTUME.red, [0, L * 0.86, 0]);
      put(fa, new T.TorusGeometry(0.037, 0.012, 8, 20), COSTUME.fur, [0, L * 0.8, 0], [Math.PI / 2, 0, 0]);
    });
  }
  function dressedHuman(seed, beach) {
    var r = rnd(seed * 7919 + 13);
    if (!beach && HUMAN.man && r() < 0.5) return manHuman(r);
    var model = T.SkeletonUtils.clone(HUMAN.dressed.scene);
    var mat = beach ? HUMAN.beachMat : HUMAN.looks[Math.floor(r() * HUMAN.looks.length)];
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.material = mat; o.castShadow = true; o.frustumCulled = false;
      if (beach && HUMAN.beachGeo && o.isSkinnedMesh) o.geometry = HUMAN.bunnyHair ? HUMAN.beachNoHair : HUMAN.beachGeo;
    });
    var g = new T.Group(); g.add(model);
    var head = findBone(model, 'Head'), hips = findBone(model, 'Hips'), handL = findBone(model, 'LeftHand');
    if (beach && hips && head) {
      santaBunny(model, hips, head);
      if (HUMAN.bunnyHair) {   // 엘프 머리 모양의 긴 갈색 머리
        var hb = null; model.traverse(function (o) { if (o.isBone && o.name === HUMAN.bunnyHair.bone) hb = o; });
        if (hb) { var hm = new T.Mesh(HUMAN.bunnyHair.geo, HUMAN.bunnyHair.mat); hm.castShadow = true; hm.frustumCulled = false; hb.add(hm); }
      }
    }
    var mixer = new T.AnimationMixer(model), acts = {};
    ['idle', 'walk'].forEach(function (n) { if (HUMAN.dclips[n]) acts[n] = mixer.clipAction(HUMAN.dclips[n]); });
    if (acts.idle) acts.idle.play();
    if (acts.walk) { acts.walk.play(); acts.walk.setEffectiveWeight(0); }
    mixer.update(r() * 3);
    var sc = beach ? 1.04 : 0.98 + r() * 0.1;
    g.scale.setScalar(sc);
    return { g: g, mixer: mixer, acts: acts, clips: HUMAN.dclips, model: model, handL: handL, r: r, phase: r() * 6, sc: sc, walkW: 0 };
  }
  function human(seed, beach) {
    if (HUMAN.dressed) return dressedHuman(seed, beach);
    var r = rnd(seed * 7919 + 13), pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var model = T.SkeletonUtils.clone(HUMAN.gltf.scene);
    var bodyCol = beach ? 0xf0c4a0 : pick(SHIRT), jointCol = beach ? 0xe2b18b : pick(PANTS);
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      var joint = /Joints/i.test(o.material.name);
      var m = new T.MeshStandardMaterial({ color: joint ? jointCol : bodyCol, roughness: beach ? 0.55 : (joint ? 0.6 : 0.85),
        metalness: 0, skinning: true });
      o.material = m;
    });
    var g = new T.Group(); g.add(model);
    var head = findBone(model, 'Head'), spine = findBone(model, 'Spine2'), hips = findBone(model, 'Hips'),
        handL = findBone(model, 'LeftHand');
    var hairM = std(beach ? 0x5a3a22 : pick(HAIR), 0.9);
    if (head && (beach || r() < 0.75)) {   // 머리카락
      var cap = new T.Mesh(new T.SphereGeometry(0.108, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
      cap.rotation.x = -0.2; onBone(head, cap, [0, 0.11, -0.01]);
      if (beach || r() < 0.35) {   // 긴 머리
        var lg = new T.Mesh(new T.CylinderGeometry(0.095, 0.06, beach ? 0.36 : 0.26, 16), hairM);
        onBone(head, lg, [0, beach ? -0.02 : 0.02, -0.075]);
      }
    }
    if (beach && spine && hips && head) {   // 숨은 인물: 빨간 비키니와 밀짚모자
      var suit = std(0xe2465a, 0.45);
      var top = new T.Mesh(new T.CylinderGeometry(0.135, 0.14, 0.09, 24), suit); top.scale.z = 0.85; onBone(spine, top, [0, 0.115, 0.015]);
      var bot = new T.Mesh(new T.CylinderGeometry(0.15, 0.13, 0.1, 24), suit); bot.scale.z = 0.8; onBone(hips, bot, [0, -0.065, 0]);
      var straw = std(0xe9d29a, 0.85);
      var brim = new T.Mesh(new T.CylinderGeometry(0.26, 0.26, 0.012, 32), straw); onBone(head, brim, [0, 0.135, 0]);
      var crown = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.1, 24), straw); onBone(head, crown, [0, 0.185, 0]);
      var band = new T.Mesh(new T.CylinderGeometry(0.121, 0.121, 0.025, 24), suit); onBone(head, band, [0, 0.15, 0]);
    }
    var mixer = new T.AnimationMixer(model), acts = {};
    ['idle', 'walk'].forEach(function (n) { if (HUMAN.clips[n]) acts[n] = mixer.clipAction(HUMAN.clips[n]); });
    if (acts.idle) acts.idle.play();
    if (acts.walk) { acts.walk.play(); acts.walk.setEffectiveWeight(0); }
    mixer.update(r() * 3);   // 모두 같은 박자로 움직이지 않게
    var sc = beach ? 1.0 : 0.93 + r() * 0.12;
    g.scale.setScalar(sc);
    return { g: g, mixer: mixer, acts: acts, clips: HUMAN.clips, model: model, handL: handL, r: r, phase: r() * 6, sc: sc, walkW: 0 };
  }
  // 서 있는 사람의 시선: 반복 끄덕임 동작 대신 머리 뼈를 천천히 돌린다
  // read: 고개를 숙이고 책을 본다 / browse: 서가를 따라 천천히 둘러본다 / calm: 가끔 주변을 본다
  function setLook(p, kind) {
    if (!p.mixer) return;
    p.look = kind; p.headBone = p.headBone || findBone(p.model, 'Head'); p.neckBone = p.neckBone || findBone(p.model, 'Neck');
  }
  function applyLook(p, now) {
    if (!p.look || !p.headBone || p.walkW > 0.5) return;
    var t = now / 1000 + p.phase * 7, pitch = 0, yaw = 0;
    if (p.look === 'read') { pitch = 0.42 + Math.sin(t * 0.35) * 0.03; yaw = Math.sin(t * 0.13) * 0.06; }
    else if (p.look === 'browse') {   // 몇 초씩 한곳을 보다가 천천히 옮긴다
      var s = Math.sin(t * 0.18) + 0.35 * Math.sin(t * 0.07 + 1.3);
      yaw = Math.max(-1, Math.min(1, s * 1.6)) * 0.45; pitch = 0.12 + Math.sin(t * 0.11 + 0.7) * 0.06;
    } else { yaw = Math.sin(t * 0.09) * 0.3; pitch = 0.04; }
    var k = 1 - p.walkW * 2;
    if (p.neckBone) { p.neckBone.rotateY(yaw * 0.4 * k); p.neckBone.rotateX(pitch * 0.4 * k); }
    p.headBone.rotateY(yaw * 0.6 * k); p.headBone.rotateX(pitch * 0.6 * k);
  }
  function carryBook(p) {   // 왼손에 든 책
    if (!p.handL) return;
    var bk = new T.Mesh(new T.BoxGeometry(0.16, 0.23, 0.03), [M.white, M.white, M.white, M.white,
      std(PALETTE[Math.floor(p.r() * PALETTE.length)], 0.6), std(PALETTE[Math.floor(p.r() * PALETTE.length)], 0.6)]);
    bk.rotation.y = Math.PI / 2;
    onBone(p.handL, bk, [0.02, 0.09, 0.03]);
  }
  function makePerson(seed, beach) { return HUMAN.gltf ? human(seed, beach) : person(seed, beach); }

  function heldBook(p) {   // 가슴 앞에 펼쳐 든 책
    var bk = new T.Mesh(new T.BoxGeometry(0.32, 0.22, 0.03), [M.white, M.white, M.white, M.white, std(PALETTE[Math.floor(p.r() * PALETTE.length)], 0.6), M.white]);
    bk.position.set(0, 1.22, 0.3); bk.rotation.x = -0.9; (p.body || p.g).add(bk);
    if (p.mixer) { bk.parent.remove(bk); carryBook(p); setLook(p, 'read'); return; }
    p.armL.rotation.set(-1.15, 0, 0.25); p.armR.rotation.set(-1.15, 0, -0.25);
    p.head.rotation.x = 0.35;
  }

  // 층별 인물 수 ([설정 > 인물 수], lib3d.json의 people.{층 키}.{종류}) - 비우면 자동
  var PEOPLE = {};
  var PEOPLE_KINDS = [
    { k: 'walk', label: '걷는 손님' }, { k: 'browse', label: '책 고르는 손님' }, { k: 'read', label: '서서 읽는 손님' },
    { k: 'sit', label: '벤치 손님' }, { k: 'chat', label: '대화하는 손님(쌍)' }, { k: 'staff', label: '안내 직원' },
    { k: 'trooper', label: '스톰트루퍼' }, { k: 'elf', label: '엘프' }, { k: 'robot', label: '로봇 손님' }, { k: 'beach', label: '숨은 인물(산타 토끼)' },
  ];
  var PEOPLE_MAX = 20;
  function spawnPeople(fl, seed) {
    people = [];
    chatPair = null;
    if (!layout) return;
    var r = rnd(seed + 99), L = layout, n = 0, secs = L.sections || [];
    var cfg = PEOPLE[fl.key] || {};
    function cnt(kind, auto) {   // 저장한 수가 있으면 그 수, 없으면 자동
      var v = cfg[kind];
      return (typeof v === 'number' && v >= 0) ? Math.min(PEOPLE_MAX, v) : auto;
    }
    function place(p, x, z, ry) { p.g.position.set(x, 0, z); p.g.rotation.y = ry; parent.add(p.g); people.push(p); n++; return p; }
    // 통로 격자 (서가 사이 세로 통로 x, 서가 줄 앞 가로 통로 z, 로비)
    var lanes = [], rowsZ = [L.front - 6.5];
    for (var c = 0; c <= L.cols; c++) lanes.push((c - L.cols / 2) * (BOOTH_W + GAP));
    for (var rr = 0; rr < L.rows; rr++) rowsZ.push(-LOBBY + GAP / 2 - rr * (BOOTH_D + GAP));
    L.lanes = lanes; L.rowsZ = rowsZ;
    function walker(p, speed, row) {   // 통로를 걷는 사람으로 세운다
      var li = Math.floor(r() * lanes.length), zi = row === undefined ? Math.floor(r() * rowsZ.length) : Math.min(row, rowsZ.length - 1);
      p.kind = 'walk'; p.node = [li, zi]; p.speed = speed;
      place(p, lanes[li], rowsZ[zi], 0);
      nextNode(p);
      return p;
    }
    // 정한 수만큼 구역을 고른다 (자동이면 구역마다 확률로)
    function pickSections(kind, chance) {
      var out = [];
      if (!secs.length) return out;
      var v = cnt(kind, -1);
      if (v < 0) { secs.forEach(function (s, j) { if (r() < chance) out.push([s, j]); }); return out; }
      var start = Math.floor(r() * secs.length);
      for (var q = 0; q < v; q++) out.push([secs[(start + q) % secs.length], q]);
      return out;
    }
    var i;
    // 걷는 손님
    var walkers = cnt('walk', Math.min(5, 2 + Math.floor(fl.libs.length / 2)));
    for (i = 0; i < walkers; i++) walker(makePerson(seed * 31 + i), 0.95 + r() * 0.45);
    // 서가 앞에서 고르는 손님 (평대 앞 또는 옆 서가 앞)
    pickSections('browse', 0.3).forEach(function (sj, q) {
      var s = sj[0], p2 = makePerson(seed * 53 + sj[1] + 400 + q * 7);
      p2.kind = 'browse'; p2.t = r() * 4;
      if (p2.mixer) { setLook(p2, 'browse'); if (r() < 0.4) carryBook(p2); }
      if (r() < 0.5) place(p2, s.x + (r() - 0.5) * 2.4, s.z + 3.15, Math.PI);
      else place(p2, s.x - BOOTH_W / 2 + 1.05, s.z - 0.2 + (r() - 0.5) * 3, Math.PI / 2);
    });
    // 서서 읽는 손님
    pickSections('read', 0.12).forEach(function (sj, q) {
      var s = sj[0], p3 = makePerson(seed * 71 + sj[1] + 800 + q * 7);
      p3.kind = 'read'; place(p3, s.x + BOOTH_W / 2 - 1.2, s.z + 2.6 - Math.floor(q / secs.length) * 1.4, -Math.PI / 2 - 0.4); heldBook(p3);
    });
    // 벤치 손님 (관절 모형은 벤치 옆에 서서 읽는다)
    var sits = cnt('sit', 1);
    for (i = 0; i < sits; i++) {
      var sit = makePerson(seed * 97 + 5 + i * 11);
      if (sit.mixer) {
        sit.kind = 'read'; place(sit, -1.6 - i * 0.9, L.front - 2.6, Math.PI + 0.5); heldBook(sit);
      } else {
        sit.kind = 'sit'; place(sit, -2.8 + (i % 3) * 0.75, L.front - 3.25, Math.PI);
        sit.body.position.y = -0.47; sit.legL.rotation.x = -1.5; sit.legR.rotation.x = -1.5; heldBook(sit);
      }
    }
    // 숨은 인물: 자동이면 층에 들어올 때 가끔(약 3번에 1번)
    var beach = cnt('beach', r() < 0.34 ? 1 : 0);
    for (i = 0; i < beach; i++) { var bk = walker(makePerson(seed * 101 + 3 + i * 13, true), 1.25, 0); bk.hidden = true; }
    // 책 이야기를 나누는 두 손님: 서가 입구 쪽에서 마주 본다 (AI 손님 대화가 켜지면 첫 쌍이 말풍선으로 이야기)
    var pairs = secs.length ? cnt('chat', AI.chat ? 1 : 0) : 0, pstart = Math.floor(r() * Math.max(1, secs.length));
    for (i = 0; i < pairs; i++) {
      var cs = secs[(pstart + i) % secs.length], dz = Math.floor(i / secs.length) * 1.6;
      var ca = makePerson(seed * 151 + 11 + i * 17), cb = makePerson(seed * 157 + 13 + i * 17);
      ca.kind = 'chat'; cb.kind = 'chat';
      place(ca, cs.x + 2.3, cs.z + 3.3 - dz, Math.PI / 2 + 0.3);
      place(cb, cs.x + 3.3, cs.z + 3.3 - dz, -Math.PI / 2 - 0.3);
      if (!chatPair) chatPair = [ca, cb];
    }
    // 스톰트루퍼: 통로를 순찰
    if (HUMAN.trooper) {
      var troops = cnt('trooper', 1);
      for (i = 0; i < troops; i++) walker(trooperHuman(rnd(seed * 131 + 9 + i * 19)), 0.85, i === 0 ? 1 : undefined);
    }
    // 엘프: 로비에서 시작해 통로를 걷는다 (뼈대를 못 심었으면 로비에 피규어로)
    // 로봇 손님: 통로를 걷다 멈추면 이런저런 동작, 가까이 가면 인사 (모형을 받은 뒤)
    if (HUMAN.robot) {
      var robots = cnt('robot', 1);
      for (i = 0; i < robots; i++) walker(robotHuman(rnd(seed * 173 + 29 + i * 31)), 1.05, i === 0 ? 0 : undefined);
    }
    var elves = cnt('elf', 1);
    for (i = 0; i < elves; i++) {
      if (HUMAN.elfRig && HUMAN.gltf) walker(elfWalker(rnd(seed * 163 + 17 + i * 23)), 1.0, i === 0 ? 0 : undefined);
      else if (HUMAN.elf) place(elfStatue(), 4 + i * 1.6, L.front - 8.5, -0.3);
    }
    // 안내 데스크 직원
    var staffs = cnt('staff', STAFF_ON ? 0 : 1);   // AI 직원이 있으면 사서가 안내 데스크를 맡는다
    for (i = 0; i < staffs; i++) {
      var staff = makePerson(seed * 13 + 7 + i * 29);
      staff.kind = 'staff'; place(staff, L.w / 2 - 5.5 - i * 1.1, L.front - 6.35, 0);
      if (staff.mixer) setLook(staff, 'calm');
    }
    if (cur === 0) spawnCampers(seed, place);   // 강 건너 캠핑장 사람들
  }

  // 걷는 손님: 서점 안 아무 곳(통로 격자의 한 점)을 목적지로 골라 통로를 따라 꺾어 가며 간다.
  // 가로 먼저/세로 먼저를 그때그때 고르고, 통로 폭 안에서 좌우로 흩어져 걷는다. 서가 줄에 닿으면 가끔 서가 앞에 서서 둘러본다.
  // (통로로만 다니므로 서가·벽을 뚫지 않는다)
  function planRoute(p) {
    var L = layout, li = p.node[0], zi = p.node[1], lanes = L.lanes, rows = L.rowsZ, route = [];
    var gl = Math.floor(p.r() * lanes.length), gz = Math.floor(p.r() * rows.length);
    if (p.r() < 0.35) { gl = Math.max(0, Math.min(lanes.length - 1, li + (p.r() < 0.5 ? -1 : 1))); gz = zi; }   // 가끔은 가까운 곳만
    if (gl === li && gz === zi) gl = li > 0 ? li - 1 : Math.min(lanes.length - 1, li + 1);
    function pt(l, z) {
      return { node: [l, z], x: lanes[l] + (p.r() - 0.5) * 3.0, z: rows[z] + (p.r() - 0.5) * (z === 0 ? 3.2 : 2.6) };
    }
    if (p.r() < 0.5) { if (gl !== li) route.push(pt(gl, zi)); if (gz !== zi) route.push(pt(gl, gz)); }   // 줄을 따라 옆으로 → 통로로 앞뒤
    else { if (gz !== zi) route.push(pt(li, gz)); if (gl !== li) route.push(pt(gl, gz)); }             // 통로로 앞뒤 → 줄을 따라 옆으로
    if (!route.length) route.push(pt(gl, gz));
    // 서가 줄에 닿았으면 가끔 옆 구역 서가 앞에 서서 둘러보고(몇 초), 다시 통로로 나온다
    if (gz > 0 && !p.alwaysWalk && p.r() < (p.robot ? 0.25 : 0.45)) {
      var near = (L.sections || []).filter(function (sc) {
        return Math.abs(sc.z + BOOTH_D / 2 + GAP / 2 - rows[gz]) < 1 && Math.abs(sc.x - lanes[gl]) < BOOTH_W / 2 + GAP;
      });
      if (near.length) {
        var sc = near[Math.floor(p.r() * near.length)], bx = sc.x + (p.r() - 0.5) * 2.6;
        route.push({ node: [gl, gz], x: bx, z: sc.z + 3.15, lookYaw: Math.PI, stop: 3 + p.r() * 6 });
        route.push({ node: [gl, gz], x: bx + (p.r() - 0.5) * 1.2, z: rows[gz] + (p.r() - 0.5) * 1.6 });   // 서가 앞 통로로 한 걸음 나와서
        route.push(pt(gl, gz));   // 세로 통로로 돌아간다 (다음 길이 서가를 가로지르지 않게)
      }
    }
    p.route = route;
  }
  function nextNode(p) {
    if (!layout) return;
    if (!p.route || !p.route.length) planRoute(p);
    var o = p.route.shift();
    p.prev = p.node; p.node = o.node;
    p.tx = o.x; p.tz = o.z;
    p.speedK = 0.8 + p.r() * 0.45;   // 구간마다 걸음 빠르기를 조금씩
    p.lookYaw = null;
    if (p.arrive) {   // 지난 목적지에서 할 일 (서가 앞이면 그쪽을 보고 선다)
      p.lookYaw = p.arrive.lookYaw; p.pause = p.arrive.stop;
      p.arrive = null;
    } else if (!p.alwaysWalk && p.r() < (p.robot ? 0.35 : 0.12)) {
      p.pause = 0.6 + p.r() * 2.6;   // 가끔 멈춰 두리번 (로봇은 자주 멈춰 동작)
      p.lookYaw = p.g.rotation.y + (p.r() - 0.5) * 2.4;
    }
    if (o.stop) { p.arrive = { lookYaw: o.lookYaw, stop: o.stop }; }
  }
  function turnTo(p, yaw, k) {
    var cur0 = p.g.rotation.y, diff = Math.atan2(Math.sin(yaw - cur0), Math.cos(yaw - cur0));
    p.g.rotation.y = cur0 + diff * Math.min(1, k);
  }

  function updateHuman(p, dt, now) {
    var moving = false;
    if (p.kind === 'walk') {
      if (p.pause > 0) { p.pause -= dt; if (p.lookYaw != null) turnTo(p, p.lookYaw, dt * 3); }
      else {
        var dx = p.tx - p.g.position.x, dz = p.tz - p.g.position.z, d = Math.hypot(dx, dz);
        if (d < 0.15) nextNode(p);
        else {
          moving = true;
          turnTo(p, Math.atan2(dx, dz), dt * 5);
          var stepLen = Math.min(d, p.speed * (p.speedK || 1) * dt * p.walkW);
          p.g.position.x += dx / d * stepLen; p.g.position.z += dz / d * stepLen;
        }
      }
    }
    // 걷기 ↔ 서 있기를 부드럽게 섞는다
    if (p.alwaysWalk) { p.mixer.update(dt * 0.9); return; }
    if (p.robot) updateRobot(p, dt, now);
    p.walkW += ((moving ? 1 : 0) - p.walkW) * Math.min(1, dt * 4);
    var ew = p.emote ? p.emote.act.getEffectiveWeight() : 0;   // 로봇이 동작 중이면 그만큼 서 있기를 덜 섞는다
    if (p.acts.walk) { p.acts.walk.setEffectiveWeight(p.walkW * (1 - ew)); p.acts.walk.timeScale = p.speed * (p.speedK || 1) / 1.25 * (p.walkRate || 1); }
    if (p.acts.idle) p.acts.idle.setEffectiveWeight((1 - p.walkW) * (1 - ew));
    p.mixer.update(dt);
    applyLook(p, now);
  }

  function updatePeople(dt, now) {
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (p.mixer) { updateHuman(p, dt, now); continue; }
      if (p.kind === 'walk') {
        if (p.pause > 0) {
          p.pause -= dt;
          if (p.lookYaw != null) turnTo(p, p.lookYaw, dt * 3);
          p.legL.rotation.x *= 0.85; p.legR.rotation.x *= 0.85; p.armL.rotation.x *= 0.85; p.armR.rotation.x *= 0.85;
          p.head.rotation.y = Math.sin(now / 700 + p.phase) * 0.6;
          continue;
        }
        var dx = p.tx - p.g.position.x, dz = p.tz - p.g.position.z, d = Math.hypot(dx, dz);
        if (d < 0.15) { nextNode(p); continue; }
        turnTo(p, Math.atan2(dx, dz), dt * 6);
        var stepLen = Math.min(d, p.speed * (p.speedK || 1) * dt);
        p.g.position.x += dx / d * stepLen; p.g.position.z += dz / d * stepLen;
        p.phase += dt * p.speed * 5.2;
        var sw = Math.sin(p.phase);
        p.legL.rotation.x = sw * 0.5; p.legR.rotation.x = -sw * 0.5;
        p.armL.rotation.x = -sw * 0.38; p.armR.rotation.x = sw * 0.38;
        p.body.position.y = Math.abs(Math.cos(p.phase)) * 0.025;
        p.head.rotation.y *= 0.9;
      } else if (p.kind === 'browse') {   // 책장을 훑어보다 가끔 손을 뻗는다
        p.t += dt;
        p.head.rotation.y = Math.sin(now / 1500 + p.phase) * 0.45;
        p.head.rotation.x = 0.1 + Math.sin(now / 2300 + p.phase) * 0.12;
        var reach = Math.max(0, Math.sin(p.t * 0.6 + p.phase)) ;
        p.armR.rotation.x = -reach * 1.25;
        p.body.rotation.y = Math.sin(now / 4000 + p.phase) * 0.08;
      } else if (p.kind === 'read' || p.kind === 'sit') {   // 숨쉬기·고개 끄덕임
        p.body.rotation.x = Math.sin(now / 1800 + p.phase) * 0.015;
        p.head.rotation.y = Math.sin(now / 3000 + p.phase) * 0.12;
      } else if (p.kind === 'staff') {
        p.head.rotation.y = Math.sin(now / 2600 + p.phase) * 0.5;
      }
    }
  }

  // ── 이동·시점 ──
  var yaw = 0, pitch = 0, keys = {}, moveStick = { x: 0, y: 0 };
  function home() { camera.position.set(0, EYE, 9); yaw = 0; pitch = 0.1; }
  // 나갔던 자리 기억 (이 브라우저에): 층·위치·시선. 다음에 들어오면 그 자리에서 시작
  var POS_KEY = 'l3d_pos', posRestored = false, posSavedAt = 0;
  function savePos() {
    if (cur < 0 || !floors[cur]) return;
    try {
      localStorage.setItem(ukey(POS_KEY), JSON.stringify({ floor: floors[cur].key, x: +camera.position.x.toFixed(2), z: +camera.position.z.toFixed(2),
                                                     yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) }));
    } catch (e) { /* 저장 못 하면 다음에 입구에서 시작 */ }
  }
  function restorePos() {   // 처음 지을 때 한 번: 저장한 층을 짓고 그 자리로. 못 하면 false
    var p = null;
    try { p = JSON.parse(localStorage.getItem(ukey(POS_KEY)) || 'null'); } catch (e) { p = null; }
    if (!p || typeof p.x !== 'number') return false;
    var idx = floors.map(function (f) { return f.key; }).indexOf(p.floor);
    if (idx < 0) return false;
    buildFloor(idx);
    if (!walkable(p.x, p.z) && !(cur === 0 && Math.abs(p.x) < DOOR_W / 2 && Math.abs(p.z - layout.front) < 1.2)) { home(); return true; }   // 서가 배치가 바뀌어 밖이면 입구로
    camera.position.set(p.x, EYE, p.z); yaw = p.yaw || 0; pitch = p.pitch || 0;
    return true;
  }
  window.addEventListener('pagehide', savePos);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') savePos(); });
  function teleport(b) {
    if (b.floor !== cur) buildFloor(b.floor);
    camera.position.set(b.x, EYE, b.z + BOOTH_D / 2 + 3.8); yaw = 0; pitch = -0.05; closeMap();
  }
  var reading = false;
  window.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (cineBox && cineBox.classList.contains('on')) { if (e.key === 'Escape') closeCinema(); return; }
    if (arcBox && arcBox.classList.contains('on')) { if (e.key === 'Escape') closeArcade(); return; }   // 오락실 창이 열려 있으면 걷지 않는다   // 상영관이 열려 있으면 걷지 않는다
    if (reading) { readerKey(e); return; }
    keys[e.key.toLowerCase()] = true;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  var drag = null;
  var stickEl = document.getElementById('l3d-stick'), stickKnob = stickEl.firstChild;
  renderer.domElement.addEventListener('pointerdown', function (e) {
    var r = wrap.getBoundingClientRect();
    if (e.pointerType === 'touch') padOn();
    var isStick = false;   // 떠오르는 조이스틱은 채팅과 겹쳐서 쓰지 않는다 - 오른쪽 아래 이동 버튼(l3d-pad)으로
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, stick: isStick };
    if (isStick) {
      stickEl.style.display = 'block';
      stickEl.style.left = (e.clientX - r.left - 48) + 'px';
      stickEl.style.top = (e.clientY - r.top - 48) + 'px';
    }
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) drag.moved = true;
    if (drag.stick) {
      var ox = Math.max(-40, Math.min(40, e.clientX - drag.sx)), oy = Math.max(-40, Math.min(40, e.clientY - drag.sy));
      moveStick.x = ox / 40; moveStick.y = oy / 40;
      stickKnob.style.transform = 'translate(' + ox + 'px,' + oy + 'px)';
    } else {
      yaw -= dx * 0.004;
      pitch = Math.max(-1.1, Math.min(1.1, pitch - dy * 0.0035));
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && !drag.stick) pick(e.clientX, e.clientY);
    if (drag.stick) { moveStick.x = moveStick.y = 0; stickEl.style.display = 'none'; stickKnob.style.transform = ''; }
    drag = null;
  }
  // 터치 이동 버튼: 누르고 있는 동안 그 키를 누른 것처럼 (여러 손가락으로 같이 눌러도 된다)
  var padEl = document.getElementById('l3d-pad');
  function padOn() { if (!wrap.classList.contains('touch')) { wrap.classList.add('touch'); helpText(); } }
  function helpText() {
    var h = el('l3d-help');
    if (h && wrap.classList.contains('touch')) h.textContent = '이동 오른쪽 아래 ↑←↓→ 버튼 · 둘러보기 화면 끌기 · 책·엘리베이터 누르기';
  }
  try { if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(navigator.userAgent)) padOn(); } catch (e) { /* 마우스 화면 */ }
  Array.prototype.forEach.call(padEl.querySelectorAll('button'), function (b) {
    var k = b.getAttribute('data-k');
    function down(e) { e.preventDefault(); e.stopPropagation(); keys[k] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch (x) { /* 없어도 됨 */ } }
    function up(e) { e.preventDefault(); keys[k] = false; b.classList.remove('on'); }
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  });
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  // ── 앉기 (1인칭): 의자·소파·벤치를 누르거나 가까이서 [앉기] → 눈높이를 낮추고 의자가 보는 쪽으로. 걷기 키를 누르면 일어난다 ──
  var seats = [], sitting = null, glide = null, SIT_EYE = 1.15;
  var seatHitMat = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  seatHitMat.userData.keep = true;
  function addSeat(x, z, rot, h, opt) {   // rot: 앉은 사람이 보는 쪽 (사람 모형 rotation.y와 같은 뜻)
    var st = { x: x, z: z, rot: rot, h: h || 0.46, brunch: !!(opt && opt.brunch), media: !!(opt && opt.media), cinema: !!(opt && opt.cinema), arcade: opt && opt.arcade || '', jazz: !!(opt && opt.jazz) };
    var m = new T.Mesh(unitBox, seatHitMat); m.scale.set(0.62, 0.95, 0.62); m.position.set(x, 0.48, z);
    m.userData.seat = st; st.mesh = m; (parent || floorGroup).add(m);
    seats.push(st);
    return st;
  }
  function seatTaken(st) {
    var near = function (x, z) { return Math.hypot(x - st.x, z - st.z) < 0.45; };
    if (people.some(function (q) { return (q.kind === 'sit' || q.kind === 'read' || q.kind === 'statue') && q.g && near(q.g.position.x, q.g.position.z); })) return '다른 손님이 앉아 있어요';
    for (var n in remotes) if (remotes[n].sit && near(remotes[n].tx, remotes[n].tz)) return n + '님이 앉아 있어요';
    return '';
  }
  function nearestSeat(maxD) {
    var best = null, bd = maxD;
    seats.forEach(function (st) {
      var d = Math.hypot(camera.position.x - st.x, camera.position.z - st.z);
      if (d < bd && !seatTaken(st)) { bd = d; best = st; }
    });
    return best;
  }
  function sitDown(st) {
    var why = seatTaken(st); if (why) { flashHelp(why); return; }
    closeCard();
    sitting = st; vel.set(0, 0); keys = {};
    glide = { t: 0, dur: 0.7, fx: camera.position.x, fz: camera.position.z, fy: camera.position.y, tx: st.x + Math.sin(st.rot) * 0.05, tz: st.z + Math.cos(st.rot) * 0.05,
              ty: st.h + 0.67, fyaw: yaw, tyaw: st.rot + Math.PI, fpitch: pitch, tpitch: 0 };
    sitBtn();
    if (st.brunch && BRUNCH_ON) openBrunch();
    if (st.media) openMediaPick();
    if (st.jazz) { openJazz(); if (!JZ.playing) jzLoadList().then(function () { jzPlay(); }); }   // 앉으면 바로 라디오
    if (st.arcade) setTimeout(function () { openArcade(st.arcade); }, 650);
    if (st.cinema && !(cine.video && !cine.video.paused)) setTimeout(openCinema, 700);   // 자리에 앉은 뒤 상영관 (상영 중이면 그대로)
  }
  function standUp(now) {
    var st = sitting; sitting = null;
    if (!st) return;
    var ox = st.x + Math.sin(st.rot) * 0.75, oz = st.z + Math.cos(st.rot) * 0.75;
    if (now) { glide = null; camera.position.y = EYE; }
    else glide = { t: 0, dur: 0.45, fx: camera.position.x, fz: camera.position.z, fy: camera.position.y, tx: ox, tz: oz, ty: EYE };
    sitBtn();
  }
  function flashHelp(t) {
    var h = el('l3d-help'); if (!h) return;
    var old = h.dataset.base || h.textContent; h.dataset.base = old; h.textContent = t;
    clearTimeout(flashHelp.tm); flashHelp.tm = setTimeout(function () { h.textContent = h.dataset.base; }, 2500);
  }
  var sitBtnEl = el('l3d-sit');
  sitBtnEl.addEventListener('click', function () {
    if (sitting) { standUp(); return; }
    var st = nearestSeat(2.3); if (st) sitDown(st);
  });
  function sitBtn() {   // 아래 버튼 줄: 가까운 빈자리가 있으면 [앉기], 앉아 있으면 [일어나기]
    if (!sitBtnEl) return;
    var show = !!sitting || !!nearestSeat(2.3);
    sitBtnEl.style.display = show && !reading ? '' : 'none';
    sitBtnEl.textContent = sitting ? '일어나기' : '앉기';
  }
  var vel = new T.Vector2();
  function step(dt) {
    var f = 0, s = 0;
    if (glide) {   // 앉기·일어나기 움직임
      glide.t = Math.min(1, glide.t + dt / glide.dur);
      var e = glide.t < 0.5 ? 2 * glide.t * glide.t : 1 - Math.pow(-2 * glide.t + 2, 2) / 2;
      camera.position.x = glide.fx + (glide.tx - glide.fx) * e;
      camera.position.z = glide.fz + (glide.tz - glide.fz) * e;
      camera.position.y = glide.fy + (glide.ty - glide.fy) * e;
      if (glide.tyaw != null) yaw = glide.fyaw + Math.atan2(Math.sin(glide.tyaw - glide.fyaw), Math.cos(glide.tyaw - glide.fyaw)) * e;
      if (glide.tpitch != null) pitch = glide.fpitch + (glide.tpitch - glide.fpitch) * e;
      if (glide.t >= 1) glide = null;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      return;
    }
    if (sitting) {   // 앉아 있는 동안: 둘러보기·돌기만, 걷기 키를 누르면 일어난다
      if (!reading && (keys.w || keys.s || keys.a || keys.d || keys.arrowup || keys.arrowdown || moveStick.x || moveStick.y)) { standUp(); return; }
      if (Math.hypot(camera.position.x - sitting.x, camera.position.z - sitting.z) > 1.2) { standUp(true); }   // 지도·입구로 등으로 옮겨졌으면
      else {
        if (!reading) { if (keys.arrowleft) yaw += dt * 1.6; if (keys.arrowright) yaw -= dt * 1.6; }
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
        return;
      }
    }
    if (!reading) {
      if (keys.w || keys.arrowup) f += 1;
      if (keys.s || keys.arrowdown) f -= 1;
      if (keys.a) s -= 1;
      if (keys.d) s += 1;
      if (keys.arrowleft) yaw += dt * 1.6;
      if (keys.arrowright) yaw -= dt * 1.6;
      f -= moveStick.y; s += moveStick.x;
    }
    var speed = keys.shift ? 7 : 3.4;
    var sin = Math.sin(yaw), cos = Math.cos(yaw);
    var tx = (-sin * f + cos * s) * speed, tz = (-cos * f - sin * s) * speed;
    vel.x += (tx - vel.x) * Math.min(1, dt * 8);     // 부드럽게 출발·멈춤
    vel.y += (tz - vel.y) * Math.min(1, dt * 8);
    var cx0 = camera.position.x, cz0 = camera.position.z, nx = cx0 + vel.x * dt, nz = cz0 + vel.y * dt;
    if (walkable(nx, nz)) { camera.position.x = nx; camera.position.z = nz; }
    else if (walkable(nx, cz0)) { camera.position.x = nx; vel.y = 0; }   // 벽을 따라 미끄러지듯
    else if (walkable(cx0, nz)) { camera.position.z = nz; vel.x = 0; }
    else if (!walkable(cx0, cz0)) {   // 지금 자리가 갈 수 없는 곳이면(설정이 바뀌는 등) 안쪽으로 되돌림
      camera.position.x = Math.max(hall.x0, Math.min(hall.x1, cx0)); camera.position.z = Math.max(hall.z0, Math.min(hall.z1, cz0));
    } else vel.set(0, 0);
    updateDoor(dt);
    var moving = Math.hypot(vel.x, vel.y);
    camera.position.y = EYE + Math.sin(performance.now() / 160) * 0.012 * Math.min(1, moving / 3);   // 걸음 흔들림
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }

  // ── 표지·책등 글자: 가까운 책만 ──
  var loading = 0, MAX_LOAD = 6, NEAR = 9;
  var tmp = new T.Vector3(), loader = new T.TextureLoader();
  function spineTex(b) {
    var hex = '#' + new T.Color(b.base).getHexString();
    return canvasTex(96, 768, function (g, w, h) {
      g.fillStyle = hex; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 40, w, 6); g.fillRect(0, h - 46, w, 6);
      g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 2);
      g.fillStyle = inkOn(b.base); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 46px ' + FONT;
      g.fillText(b.title, 0, 0, h - 120);
      g.restore();
    });
  }
  function titleCover(b) {
    var hex = '#' + new T.Color(b.base).getHexString(), ink = inkOn(b.base);
    b.front.map = canvasTex(300, 420, function (g, w, h) {
      g.fillStyle = hex; g.fillRect(0, 0, w, h);
      g.fillStyle = ink; g.globalAlpha = 0.25; g.fillRect(24, 24, w - 48, 3); g.fillRect(24, h - 60, w - 48, 3); g.globalAlpha = 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      var words = String(b.title), lines = [];
      while (words && lines.length < 5) { lines.push(words.slice(0, 8)); words = words.slice(8); }
      g.font = '700 34px ' + FONT;
      lines.forEach(function (ln, i) { g.fillText(ln, w / 2, 110 + i * 46, w - 40); });
      g.font = '400 22px ' + FONT; g.fillText(b.count + '권', w / 2, h - 34);
    });
    b.front.color.set(0xffffff); b.front.needsUpdate = true;
  }
  function loadNear() {
    var cand = [];
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      if (b.state) continue;
      b.mesh.getWorldPosition(tmp);
      var d = tmp.distanceTo(camera.position);
      if (d < NEAR) cand.push([d, b]);
    }
    cand.sort(function (a, c) { return a[0] - c[0]; });
    cand.forEach(function (pair) {
      var b = pair[1];
      if (b.kind === 'spine') {   // 책등은 글자만 (바로 그림)
        if (pair[0] > 6) return;
        b.state = 2; b.front.map = spineTex(b); b.front.color.set(0xffffff); b.front.needsUpdate = true;
        return;
      }
      if (loading >= MAX_LOAD) return;
      b.state = 1; loading++;
      loader.load('api/lib3d/cover?k=' + encodeURIComponent(b.key), function (tex) {
        loading--; tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
        b.front.map = tex; b.front.color.set(0xffffff); b.front.needsUpdate = true; b.state = 2; b.cover = true;
      }, undefined, function () { loading--; b.state = 3; titleCover(b); });
    });
  }

  // ── 책 누르기 → 카드 ──
  var ray = new T.Raycaster(), ndc = new T.Vector2();
  var card = document.getElementById('l3d-card');
  var picked = null, pickedInfo = null;
  function pick(cx, cy) {
    var r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    var targets = books.map(function (b) { return b.mesh; });
    if (elevator) targets.push(elevator);
    targets = targets.concat(brunchHits, seats.map(function (st) { return st.mesh; }));
    var hit = ray.intersectObjects(targets, false)[0];
    if (hit && hit.object === elevator && hit.distance < 8) { openFloors(); return; }
    if (hit && hit.object.userData.cinema && hit.distance < 40) { closeCard(); openCinema(true); return; }
    if (hit && hit.object.userData.jazz && hit.distance < 12) { openJazz(); return; }
    if (hit && hit.object.userData.arcade && hit.distance < 10) { openArcade(hit.object.userData.arcade); return; }
    if (hit && hit.object.userData.brunch && hit.distance < 14) { closeCard(); openBrunch(); return; }
    if (hit && hit.object.userData.seat) {
      if (hit.distance < 5 && !sitting) sitDown(hit.object.userData.seat);
      else if (!sitting) flashHelp('조금 더 가까이 가서 누르면 앉아요');
      return;
    }
    if (!hit || !hit.object.userData.book || (hit.distance > 12 && hit.object.userData.book.kind !== 'banner')) { closeCard(); return; }
    showCard(hit.object.userData.book);
  }
  function el(id) { return document.getElementById(id); }
  function showCard(b) {
    picked = b; pickedInfo = null;
    el('l3d-read').textContent = b.db === 'audiobook' ? '여기서 듣기' : b.db === 'video' ? '여기서 보기' : '여기서 읽기';
    el('l3d-card-title').textContent = b.title;
    el('l3d-card-sub').textContent = b.lib + ' · ' + b.count.toLocaleString() + '권';
    el('l3d-card-path').textContent = '';
    var img = el('l3d-card-img');
    img.hidden = false;
    img.onerror = function () { img.hidden = true; };
    img.src = 'api/lib3d/cover?k=' + encodeURIComponent(b.key);
    el('l3d-open').hidden = true;
    card.classList.add('on');
    fetch('api/lib3d/open?k=' + encodeURIComponent(b.key), { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (picked !== b) return;
        pickedInfo = d;
        el('l3d-card-path').textContent = d.path || '';
        el('l3d-open').hidden = !d.url;
      }).catch(function () {});
  }
  function closeCard() { picked = null; card.classList.remove('on'); }
  el('l3d-close').addEventListener('click', closeCard);
  el('l3d-open').addEventListener('click', function () { if (pickedInfo && pickedInfo.url) window.open(pickedInfo.url, '_blank', 'noopener'); });
  el('l3d-read').addEventListener('click', function () { if (picked) openReader(picked); });
  // BookOasis 뷰어는 새 탭으로 (서재는 그대로 두고, 다 읽으면 탭만 닫으면 됨).
  // 주소를 서버에 묻는 동안 팝업 차단에 걸리지 않게 누른 순간 빈 탭을 먼저 연다
  function openBoViewer(kiosk, tab) {
    var w = tab || window.open('about:blank', '_blank');
    if (!w) { location.href = kiosk; return; }   // 팝업이 막힌 브라우저: 예전처럼 이 창에서
    try { w.opener = null; } catch (e) { /* 무시 */ }
    w.location.href = kiosk;
  }
  el('l3d-read-bo').addEventListener('click', function () {
    if (!picked) return;
    var tab = window.open('about:blank', '_blank');
    api('api/lib3d/kiosk?b=' + encodeURIComponent(picked.key)).then(function (info) {
      openBoViewer(info.url, tab);
    }).catch(function (e) { if (tab) tab.close(); el('l3d-card-path').textContent = e.message; });
  });

  // ── 뷰어 (서재 안에서 읽기): 두 손에 든 책, 책장 넘김 ──
  // 만화·웹툰(그림)과 epub은 책 모양으로 펼쳐 한 장씩 넘긴다(넓은 화면은 두 쪽 펼침). 웹툰은 '세로 스크롤'로도.
  // epub은 장(章) 본문을 쪽 크기로 나눠(CSS 다단) 책장처럼 넘긴다. pdf는 브라우저 PDF 보기.
  var R = { box: el('l3d-reader'), stage: el('l3d-r-stage'), body: el('l3d-r-body'), vols: el('l3d-r-vols'),
            pos: el('l3d-r-pos'), mode: el('l3d-r-mode'), dirBtn: el('l3d-r-dir'),
            info: null, idx: 0, list: [], scroll: false, vi: 0, rtl: false, busy: false, pages: 0, html: '' };
  var book = el('l3d-book'), pgL = el('l3d-pg-l'), pgR = el('l3d-pg-r'), leaf = el('l3d-leaf');
  var leafF = leaf.querySelector('.front'), leafB = leaf.querySelector('.back');
  // 응답 읽기: JSON이 아니면(앞단 프록시의 502·504 오류 화면 등) 알아보기 쉬운 말로
  function readJSON(r) {
    return r.text().then(function (t) {
      try { return JSON.parse(t); } catch (e) {
        var title = (t.match(/<title>([^<]*)<\/title>/i) || [])[1] || (t.match(/<h1>([^<]*)<\/h1>/i) || [])[1] || '';
        var err = new Error('서버 대신 앞단(프록시)이 응답했습니다: ' + r.status + (title ? ' ' + title.trim().replace(/^\d{3}\s*/, '') : '') +
          ' - 서버를 다시 시작하는 중이거나 잠시 연결이 끊겼을 수 있습니다. 잠시 뒤 다시 해 보세요.');
        err.status = r.status; err.proxy = true; throw err;
      }
    });
  }
  function busy(e) { return e && e.proxy && (e.status === 502 || e.status === 503 || e.status === 504); }
  function api(url) {
    var once = function () {
      return fetch(url, { credentials: 'same-origin' }).then(readJSON).then(function (d) {
        if (!d.success) throw new Error(d.error || '불러오지 못했습니다');
        return d;
      });
    };
    return once().catch(function (e) { if (!busy(e)) throw e; return new Promise(function (ok) { setTimeout(ok, 1500); }).then(once); });   // 502·503·504는 한 번 더
  }
  function note(t) { var m = el('l3d-r-msg'); m.textContent = t || ''; m.hidden = !t; }
  function spread() { return R.box.clientWidth > 900 && R.info && R.info.kind !== 'pdf'; }
  function openReader(b) {
    reading = true; keys = {}; wrap.classList.add('reading');
    R.box.classList.add('on'); note('불러오는 중...');
    el('l3d-r-title').textContent = b.title;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(ukey('l3d_read_' + b.key)) || 'null'); } catch (e) { saved = null; }
    try { R.rtl = localStorage.getItem('l3d_rtl') === '1'; } catch (e) { R.rtl = false; }
    R.series = b.key;
    api('api/lib3d/volumes?k=' + encodeURIComponent(b.key)).then(function (d) {
      R.list = d.volumes || [];
      R.vols.innerHTML = '';
      R.list.forEach(function (v, i) {
        var o = document.createElement('option'); o.value = i; o.textContent = v.title; R.vols.appendChild(o);
      });
      var start = 0;
      if (saved && saved.key) R.list.forEach(function (v, i) { if (v.key === saved.key) start = i; });
      loadVolume(start, saved && saved.key ? saved.page || 0 : 0);
    }).catch(function (e) { note(e.message); });
  }
  function closeReader() { mediaOnClose(); medBox.hidden = true; reading = false; wrap.classList.remove('reading'); R.box.classList.remove('on'); R.body.innerHTML = ''; clearPage(pgL); clearPage(pgR); }
  function remember() {
    if (!R.info || isMedia(R.info)) return;
    var at = R.info.kind === 'epub' ? { c: R.chap || 0, p: R.idx } : R.idx;
    try { localStorage.setItem(ukey('l3d_read_' + R.series), JSON.stringify({ key: R.info.key, page: at })); } catch (e) { /* 무시 */ }
  }
  function loadVolume(i, page) {
    var v = R.list[i];
    if (!v) return;
    R.vols.value = i;
    note('불러오는 중...');
    api('api/lib3d/book?b=' + encodeURIComponent(v.key)).then(function (info) {
      R.info = info; R.vi = i;
      medBox.hidden = true;
      if (isMedia(info)) { R.mode.hidden = true; R.dirBtn.hidden = true; showMedia(info, page); return; }
      if (MED.el && !MED.video && mini.hidden === false) { /* 들으며 다른 책 읽기: 소리는 그대로 */ }
      R.mode.hidden = info.kind !== 'images';
      R.dirBtn.hidden = info.kind !== 'images';
      if (info.kind === 'unsupported') { showStage(false); note('이 형식은 여기서 읽을 수 없습니다. [BookOasis 뷰어]로 읽으세요.'); return; }
      if (info.kind === 'epub') { loadChapter(page && page.c || 0, page && page.p || 0); return; }
      if (!info.count) { note('읽을 쪽이 없습니다.'); return; }
      R.pages = info.count;
      R.idx = Math.max(0, Math.min(typeof page === 'number' ? page : 0, info.count - 1));
      note('');
      render();
    }).catch(function (e) { note(e.message); });
  }
  function pageUrl(i) { return 'api/lib3d/page?b=' + encodeURIComponent(R.info.key) + '&i=' + i; }
  function showStage(on) { R.stage.hidden = !on; R.body.hidden = on; }

  // 한 쪽 그리기: 그림 / epub 쪽 / 빈 종이
  function clearPage(node) { node.innerHTML = ''; node.classList.remove('blank'); }
  function fillPage(node, i) {
    clearPage(node);
    if (i < 0 || i >= R.pages) { node.classList.add('blank'); return; }
    if (R.info.kind === 'epub') {
      var view = document.createElement('div'); view.className = 'l3d-txt';
      var art = document.createElement('article'); art.innerHTML = R.html;
      view.appendChild(art); node.appendChild(view);
      requestAnimationFrame(function () {   // 한 단 = 한 쪽 (단 너비 = 쪽 안쪽 너비)
        art.style.columnWidth = view.clientWidth + 'px';
        art.style.transform = 'translateX(' + (-i * (view.clientWidth + 48)) + 'px)';
      });
      var no = document.createElement('span'); no.className = 'l3d-pno'; no.textContent = i + 1; node.appendChild(no);
      return;
    }
    var img = document.createElement('img'); img.alt = (i + 1) + '쪽'; img.draggable = false;
    img.onerror = function () {   // 빈 종이로 남지 않게 이유를 적는다
      fetch(pageUrl(i), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).catch(function () { return {}; })
        .then(function (d) {
          if (img.parentNode !== node) return;
          var e = document.createElement('div'); e.className = 'l3d-pgerr';
          e.textContent = (i + 1) + '쪽을 불러오지 못했습니다' + (d && d.error ? ' - ' + d.error : '');
          node.replaceChild(e, img);
        });
    };
    img.src = pageUrl(i);
    node.appendChild(img);
  }
  function pageStep() { var v = pgR.querySelector('.l3d-txt'); return v ? v.clientWidth + 48 : 0; }

  function render() {
    var info = R.info;
    if (info.kind === 'pdf') {
      showStage(false);
      R.body.className = 'l3d-r-body pdf'; R.body.innerHTML = '';
      var f = document.createElement('iframe'); f.src = 'api/lib3d/pdf?b=' + encodeURIComponent(info.key); f.title = info.title;
      R.body.appendChild(f); R.pos.textContent = 'PDF'; return;
    }
    if (info.kind === 'images' && R.scroll) {   // 세로 스크롤 (웹툰)
      showStage(false);
      R.body.className = 'l3d-r-body scroll'; R.body.innerHTML = '';
      for (var i = 0; i < info.count; i++) {
        var im = document.createElement('img'); im.loading = 'lazy'; im.src = pageUrl(i); im.alt = (i + 1) + '쪽';
        R.body.appendChild(im);
      }
      R.pos.textContent = info.count + '장 · 스크롤';
      return;
    }
    showStage(true);
    book.classList.toggle('two', spread());
    book.classList.toggle('rtl', R.rtl && info.kind === 'images');
    if (spread()) { R.idx -= R.idx % 2; fillPage(pgL, R.idx); fillPage(pgR, R.idx + 1); }
    else fillPage(pgR, R.idx);
    var last = spread() ? Math.min(R.idx + 2, R.pages) : R.idx + 1;
    R.pos.textContent = (info.kind === 'epub' ? (R.chap + 1) + '장 · ' : '') + (R.idx + 1) + (spread() && last > R.idx + 1 ? '-' + last : '') + ' / ' + R.pages;
    if (info.kind === 'images') for (var k = 1; k <= 2; k++) if (R.idx + k + 1 < R.pages) { var pre = new Image(); pre.src = pageUrl(R.idx + k + 1); }
    remember();
  }

  // 책장 넘김: 앞면·뒷면이 있는 한 장(leaf)을 책등을 축으로 180도 돌린다
  function flip(dir) {
    if (R.busy) return;
    var n = spread() ? 2 : 1, to = R.idx + dir * n;
    if (to < 0 || to >= R.pages) {
      if (R.info.kind === 'epub') { nextChapter(dir); return; }
      if (dir > 0) { if (R.vi + 1 < R.list.length) loadVolume(R.vi + 1, 0); else note('마지막 권의 끝입니다.'); }
      else if (R.vi > 0) loadVolume(R.vi - 1, 1e9);
      return;
    }
    R.busy = true;
    var two = spread();
    leaf.className = 'l3d-leaf ' + (two ? 'half' : 'full') + (dir > 0 ? ' fwd' : ' back');
    if (dir > 0) {
      fillPage(leafF, two ? R.idx + 1 : R.idx);           // 지금 오른쪽 쪽이 넘어간다
      fillPage(leafB, two ? R.idx + 2 : -1);              // 넘어간 장의 뒷면 = 다음 왼쪽 쪽
      fillPage(pgR, two ? R.idx + 3 : R.idx + 1);         // 그 아래 = 다음 오른쪽 쪽
    } else {
      fillPage(leafF, two ? R.idx - 1 : R.idx - 1);       // 되돌아오는 장의 앞면 = 이전 오른쪽 쪽
      fillPage(leafB, two ? R.idx : -1);
      if (two) fillPage(pgL, R.idx - 2);
    }
    void leaf.offsetWidth;   // 시작 자세를 먼저 그리고
    leaf.classList.add('go');
    book.classList.add('turning');
    setTimeout(function () {
      R.idx = to; leaf.className = 'l3d-leaf'; clearPage(leafF); clearPage(leafB);
      book.classList.remove('turning'); R.busy = false; render();
    }, 620);
  }
  function go(dir) {
    if (!R.info) return;
    if (isMedia(R.info)) { mediaPlay(MED.track + dir, 0); return; }
    if (R.info.kind === 'images' && R.scroll) { R.body.scrollBy({ top: dir * R.body.clientHeight * 0.85, behavior: 'smooth' }); return; }
    if (R.info.kind === 'pdf') return;
    flip(dir);
  }

  // epub: 장 본문을 쪽 크기로 나눈다 (CSS 다단 - 한 단이 한 쪽)
  function loadChapter(c, p) {
    note('불러오는 중...');
    api('api/lib3d/chapter?b=' + encodeURIComponent(R.info.key) + '&i=' + c).then(function (d) {
      R.chap = c; R.html = d.html; R.pages = 1; R.idx = 0;
      showStage(true);
      book.classList.toggle('two', spread()); book.classList.remove('rtl');
      fillPage(pgR, 0);
      requestAnimationFrame(function () {   // 쪽 수 세기
        var art = pgR.querySelector('article');
        R.pages = Math.max(1, Math.round((art.scrollWidth + 48) / pageStep()));
        R.idx = p === 'end' ? R.pages - 1 : Math.max(0, Math.min(p || 0, R.pages - 1));
        note(''); render();
      });
    }).catch(function (e) { note(e.message); });
  }
  function nextChapter(dir) {
    var c = (R.chap || 0) + dir;
    if (c < 0) { if (R.vi > 0) loadVolume(R.vi - 1, { c: 0, p: 0 }); return; }
    if (c >= R.info.count) { if (R.vi + 1 < R.list.length) loadVolume(R.vi + 1, { c: 0, p: 0 }); else note('마지막 장입니다.'); return; }
    loadChapter(c, dir < 0 ? 'end' : 0);
  }

  function readerKey(e) {
    var k = e.key;
    if (k === 'Escape') { closeReader(); return; }
    if (isMedia(R.info) && k === ' ') { e.preventDefault(); if (MED.el) { if (MED.el.paused) MED.el.play(); else MED.el.pause(); } return; }
    var fwd = R.rtl && R.info && R.info.kind === 'images' ? 'ArrowLeft' : 'ArrowRight';
    var bwd = fwd === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    if (k === fwd || k === 'PageDown' || k === ' ') { e.preventDefault(); go(1); }
    if (k === bwd || k === 'PageUp') { e.preventDefault(); go(-1); }
  }
  el('l3d-r-prev').addEventListener('click', function () { go(R.rtl && R.info && R.info.kind === 'images' ? 1 : -1); });
  el('l3d-r-next').addEventListener('click', function () { go(R.rtl && R.info && R.info.kind === 'images' ? -1 : 1); });
  el('l3d-r-close').addEventListener('click', closeReader);
  R.vols.addEventListener('change', function () { loadVolume(parseInt(R.vols.value, 10) || 0, 0); });
  R.mode.addEventListener('click', function () { R.scroll = !R.scroll; R.mode.textContent = R.scroll ? '책으로' : '세로 스크롤'; render(); });
  R.dirBtn.addEventListener('click', function () {
    R.rtl = !R.rtl;
    try { localStorage.setItem('l3d_rtl', R.rtl ? '1' : '0'); } catch (e) { /* 무시 */ }
    R.dirBtn.textContent = R.rtl ? '오른쪽→왼쪽' : '왼쪽→오른쪽';
    render();
  });
  R.stage.addEventListener('click', function (e) {   // 책 왼쪽·오른쪽을 눌러 넘기기
    if (!R.info || R.info.kind === 'pdf') return;
    var r = book.getBoundingClientRect();
    var left = e.clientX < r.left + r.width / 2;
    var dir = left ? -1 : 1;
    if (R.rtl && R.info.kind === 'images') dir = -dir;
    go(dir);
  });
  window.addEventListener('resize', function () { if (reading && R.info && !R.scroll && R.info.kind !== 'pdf') render(); });
  el('l3d-r-bo').addEventListener('click', function () {
    if (R.info) openBoViewer(R.info.kiosk);
  });

  // ── 설정: 보여 줄 보관함 ──
  var setBox = el('l3d-set');
  function openSettings() {
    setBox.classList.add('on');
    var list = el('l3d-set-list');
    list.textContent = '불러오는 중...';
    api('api/lib3d/libraries').then(function (d) {
      list.textContent = '';
      var groups = {};
      d.libraries.forEach(function (l) { (groups[l.db_type] = groups[l.db_type] || []).push(l); });
      FLOOR_ORDER.concat(Object.keys(groups).filter(function (k) { return FLOOR_ORDER.indexOf(k) < 0; })).forEach(function (k) {
        if (!groups[k]) return;
        var h = document.createElement('div'); h.className = 'l3d-set-h';
        var all = document.createElement('input'); all.type = 'checkbox';
        all.checked = groups[k].every(function (l) { return l.shown; });
        var lab = document.createElement('label'); lab.appendChild(all); lab.appendChild(document.createTextNode(' ' + (FLOOR_NAMES[k] || k) + ' (' + groups[k].length + ')'));
        h.appendChild(lab); list.appendChild(h);
        var boxes = [];
        groups[k].forEach(function (l) {
          var row = document.createElement('label'); row.className = 'l3d-set-row';
          var c = document.createElement('input'); c.type = 'checkbox'; c.checked = l.shown; c.value = l.key;
          row.appendChild(c); row.appendChild(document.createTextNode(' ' + l.name));
          list.appendChild(row); boxes.push(c);
        });
        all.addEventListener('change', function () { boxes.forEach(function (c) { c.checked = all.checked; }); });
      });
      if ((d.errors || []).length) { var er = document.createElement('p'); er.textContent = d.errors.join(' / '); list.appendChild(er); }
    }).catch(function (e) { list.textContent = e.message; });
  }
  function saveSettings(all) {
    var keys = all ? null : Array.prototype.map.call(setBox.querySelectorAll('.l3d-set-row input:checked'), function (c) { return c.value; });
    fetch('api/lib3d/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ libraries: keys }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.success) throw new Error(d.error || '저장 실패'); setBox.classList.remove('on'); cur = 0; build(true); })
      .catch(function (e) { el('l3d-set-msg').textContent = e.message; });
  }
  el('l3d-set-btn').addEventListener('click', function () { if (cfgBox.classList.contains('on')) cfgClose(); else cfgGo(0); });
  el('l3d-set-save').addEventListener('click', function () { saveSettings(false); });
  el('l3d-set-all').addEventListener('click', function () { saveSettings(true); });
  el('l3d-set-close').addEventListener('click', function () { setBox.classList.remove('on'); });
  // ── AI: 설정 / 질문하기 / 손님 대화 ──
  function setAI(a) {
    AI = { chat: !!a.chat, ask: !!a.ask, chat_sec: a.chat_sec || 60 };
    chatIn.placeholder = AI.ask ? '채팅 (Enter) · @사서 / @도슨트 + 할 말 → AI 직원이 답하고 움직여요' : '채팅 (Enter로 보내기)';
  }
  function postJSON(url, body) {
    var once = function () {
      return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(readJSON)
        .then(function (d) { if (!d.success) throw new Error(d.error || '실패'); return d; });
    };
    return once().catch(function (e) { if (!busy(e)) throw e; return new Promise(function (ok) { setTimeout(ok, 1500); }).then(once); });   // 502·503·504는 한 번 더
  }
  var aiBox = el('l3d-ai');
  function aiProvider() {   // 연결 방식에 따라 주소 칸·모델 예시·패키지 안내를 바꾼다
    var claude = el('l3d-ai-provider').value === 'anthropic';
    el('l3d-ai-base-f').hidden = claude;
    el('l3d-ai-sdk').hidden = !claude || aiSdk;
    el('l3d-ai-model').placeholder = claude ? 'claude-opus-5-5' : '예: my-model';
    var dl = el('l3d-ai-models'); dl.textContent = '';
    (claude ? ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] : []).forEach(function (m) {
      var o = document.createElement('option'); o.value = m; dl.appendChild(o);
    });
  }
  var aiSdk = true;
  el('l3d-ai-provider').addEventListener('change', aiProvider);
  function openAI() {
    setBox.classList.remove('on'); aiBox.classList.add('on');
    el('l3d-ai-msg').textContent = '불러오는 중...';
    api('api/lib3d/ai/settings').then(function (d) {
      aiSdk = d.sdk; el('l3d-ai-provider').value = d.provider; el('l3d-ai-base').value = d.base_url || '';
      el('l3d-ai-key').value = ''; el('l3d-ai-clear').checked = false;
      el('l3d-ai-key').placeholder = d.api_key_set ? '저장됨 - 바꿀 때만 입력' : 'sk-...';
      el('l3d-ai-model').value = d.model; el('l3d-ai-chat').checked = d.chat; el('l3d-ai-sec').value = d.chat_sec;
      el('l3d-ai-ask').checked = d.ask; el('l3d-ai-mcp').value = d.mcp_command || '';
      el('l3d-ai-builtin').checked = d.builtin; el('l3d-ai-servers').value = d.mcp_servers || '';
      el('l3d-ai-daily').value = d.daily;
      el('l3d-ai-budget').textContent = d.budget ? '오늘 ' + d.budget.used + ' / ' + (d.budget.limit || '무제한') + '회 썼습니다.' : '';
      aiProvider();
      var ids = { LIB3D_AI_PROVIDER: 'l3d-ai-provider', LIB3D_AI_BASE_URL: 'l3d-ai-base', LIB3D_AI_API_KEY: 'l3d-ai-key', LIB3D_AI_MODEL: 'l3d-ai-model', LIB3D_AI_CHAT: 'l3d-ai-chat', LIB3D_AI_CHAT_SEC: 'l3d-ai-sec',
                  LIB3D_AI_ASK: 'l3d-ai-ask', LIB3D_MCP_COMMAND: 'l3d-ai-mcp', LIB3D_MCP_SERVERS: 'l3d-ai-servers', LIB3D_AI_BUILTIN: 'l3d-ai-builtin', LIB3D_AI_DAILY: 'l3d-ai-daily' };
      Object.keys(ids).forEach(function (k) { el(ids[k]).disabled = (d.fixed || []).indexOf(k) >= 0; });
      el('l3d-ai-msg').textContent = (d.fixed || []).length ? '환경변수로 정해진 항목은 바꿀 수 없습니다: ' + d.fixed.join(', ') : '';
    }).catch(function (e) { el('l3d-ai-msg').textContent = e.message; });
  }
  el('l3d-ai-close').addEventListener('click', function () { aiBox.classList.remove('on'); });
  el('l3d-ai-save').addEventListener('click', function () {
    var body = { provider: el('l3d-ai-provider').value, base_url: el('l3d-ai-base').value, model: el('l3d-ai-model').value, chat: el('l3d-ai-chat').checked, chat_sec: +el('l3d-ai-sec').value || 60,
                 ask: el('l3d-ai-ask').checked, mcp_command: el('l3d-ai-mcp').value,
                 builtin: el('l3d-ai-builtin').checked, mcp_servers: el('l3d-ai-servers').value, daily: el('l3d-ai-daily').value };
    if (el('l3d-ai-key').value) body.api_key = el('l3d-ai-key').value;
    if (el('l3d-ai-clear').checked) body.clear_key = true;
    el('l3d-ai-msg').textContent = '저장 중...';
    postJSON('api/lib3d/ai/settings', body).then(function (d) {
      var had = AI.chat;
      setAI(d); el('l3d-ai-key').value = '';
      el('l3d-ai-key').placeholder = d.api_key_set ? '저장됨 - 바꿀 때만 입력' : 'sk-...';
      el('l3d-ai-msg').textContent = '저장했습니다.';
      if (had !== AI.chat) { stopChat(); respawn(); }
    }).catch(function (e) { el('l3d-ai-msg').textContent = e.message; });
  });
  el('l3d-ai-test').addEventListener('click', function () {
    el('l3d-ai-msg').textContent = 'MCP에 연결하는 중... (저장한 설정으로 시험)';
    api('api/lib3d/ai/test').then(function (d) {
      var lines = (d.servers || []).map(function (sv) { return '✓ ' + sv.name + ' - 도구 ' + sv.tools.length + '개: ' + sv.tools.join(', '); });
      (d.errors || []).forEach(function (e) { lines.push('✗ ' + e); });
      el('l3d-ai-msg').textContent = lines.join('\n') || '연결된 MCP·도구가 없습니다.';
      el('l3d-ai-msg').style.whiteSpace = 'pre-wrap';
    }).catch(function (e) { el('l3d-ai-msg').textContent = e.message; });
  });

  // 손님 대화: 층의 두 손님이 책 한 권을 두고 나누는 말을 말풍선으로 번갈아 띄운다
  var bubble = el('l3d-bubble'), talk = null, chatNext = 0, chatBusy = false, tmpV = new T.Vector3();
  function stopChat() { talk = null; bubble.style.display = 'none'; }
  function chatTick() {
    var now = performance.now();
    if (LEFT || !AI.chat || !chatPair || reading || chatBusy || talk || now < chatNext || document.visibilityState !== 'visible') return;
    var a = chatPair[0].g.position;
    if (Math.hypot(camera.position.x - a.x, camera.position.z - a.z) > 26) return;   // 멀리 있으면 부르지 않는다(요금)
    chatBusy = true;
    var keys = (floors[cur] ? floors[cur].libs : []).map(function (l) { return l.key; }).join(',');
    api('api/lib3d/ai/chat?libs=' + encodeURIComponent(keys)).then(function (d) {
      if (!d.lines || !d.lines.length) { chatNext = performance.now() + (d.wait || AI.chat_sec) * 1000; return; }
      talk = { lines: d.lines, i: 0, title: d.book && d.book.title, until: 0, pair: chatPair };
      chatNext = performance.now() + AI.chat_sec * 1000;
    }).catch(function (e) {
      console.warn('3D 서재 손님 대화:', e.message);
      chatNext = performance.now() + AI.chat_sec * 2000;
    }).then(function () { chatBusy = false; });
  }
  setInterval(chatTick, 2000);
  function placeBubble() {
    if (!talk) return;
    if (talk.pair !== chatPair || reading) { stopChat(); return; }
    var now = performance.now();
    if (now > talk.until) {
      if (talk.until && ++talk.i >= talk.lines.length) { stopChat(); return; }
      var ln = talk.lines[talk.i];
      bubble.textContent = '';
      if (talk.i === 0 && talk.title) { var b = document.createElement('b'); b.textContent = '「' + talk.title + '」'; bubble.appendChild(b); }
      bubble.appendChild(document.createTextNode(ln.text));
      talk.until = now + 2600 + ln.text.length * 70;
    }
    var p = talk.pair[talk.lines[talk.i].who % 2];
    tmpV.set(p.g.position.x, p.g.position.y + 1.85 * (p.sc || 1), p.g.position.z);
    var dist = camera.position.distanceTo(tmpV);
    tmpV.project(camera);
    if (tmpV.z > 1 || dist > 30 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) { bubble.style.display = 'none'; return; }
    bubble.style.display = 'block';
    bubble.style.left = ((tmpV.x + 1) / 2 * wrap.clientWidth) + 'px';
    bubble.style.top = ((1 - tmpV.y) / 2 * wrap.clientHeight - 6) + 'px';
  }
  // 층별 인물 수: 층(열) × 인물 종류(행) 숫자 칸, 비우면 자동
  var pplBox = el('l3d-ppl');
  function openPeople() {
    setBox.classList.remove('on'); aiBox.classList.remove('on'); pplBox.classList.add('on');
    var t = el('l3d-ppl-t'); t.textContent = ''; el('l3d-ppl-msg').textContent = '';
    if (!floors.length) { el('l3d-ppl-msg').textContent = '서재를 다 지은 뒤 다시 여세요.'; return; }
    var hr = document.createElement('tr'); hr.appendChild(document.createElement('th'));
    floors.forEach(function (f) { var th = document.createElement('th'); th.textContent = f.label; hr.appendChild(th); });
    t.appendChild(hr);
    PEOPLE_KINDS.forEach(function (pk) {
      var tr = document.createElement('tr'), th = document.createElement('th'); th.textContent = pk.label; tr.appendChild(th);
      floors.forEach(function (f) {
        var td = document.createElement('td'), inp = document.createElement('input');
        inp.type = 'number'; inp.min = 0; inp.max = PEOPLE_MAX; inp.placeholder = '자동';
        inp.dataset.floor = f.key; inp.dataset.kind = pk.k;
        var v = (PEOPLE[f.key] || {})[pk.k]; if (typeof v === 'number') inp.value = v;
        td.appendChild(inp); tr.appendChild(td);
      });
      t.appendChild(tr);
    });
  }
  function savePeople(auto) {
    var out = {};
    if (!auto) Array.prototype.forEach.call(pplBox.querySelectorAll('input[data-floor]'), function (inp) {
      if (inp.value === '') return;
      (out[inp.dataset.floor] = out[inp.dataset.floor] || {})[inp.dataset.kind] = Math.max(0, Math.min(PEOPLE_MAX, parseInt(inp.value, 10) || 0));
    });
    el('l3d-ppl-msg').textContent = '저장 중...';
    postJSON('api/lib3d/settings', { people: out }).then(function (d) {
      PEOPLE = d.people || {}; respawn(); stopChat();
      if (auto) openPeople();
      el('l3d-ppl-msg').textContent = '저장했습니다. 지금 층에 바로 반영했습니다.';
    }).catch(function (e) { el('l3d-ppl-msg').textContent = e.message; });
  }
  el('l3d-ppl-save').addEventListener('click', function () { savePeople(false); });
  el('l3d-ppl-auto').addEventListener('click', function () { savePeople(true); });
  el('l3d-ppl-close').addEventListener('click', function () { pplBox.classList.remove('on'); });
  // 창밖 풍경 설정: 고르는 즉시 미리 보이고, [저장]하면 lib3d.json에 남는다
  var outBox = el('l3d-out');
  function openOutside() {
    setBox.classList.remove('on'); aiBox.classList.remove('on'); pplBox.classList.remove('on'); outBox.classList.add('on');
    el('l3d-out-banner').value = BANNER.url || '';
    el('l3d-out-bmode').value = BANNER.mode || ''; el('l3d-out-banner-sec').value = BANNER.sec || 30; bannerModeUI(); bannerLibs();
    el('l3d-out-time').value = OUTSIDE.time; el('l3d-out-season').value = OUTSIDE.season; el('l3d-out-weather').value = OUTSIDE.weather;
    el('l3d-out-msg').textContent = '';
    streetForm();
  }
  // [거리]: 길 건너 간판 이름과 갤러리·청음실·사무실·현수막 건물
  function streetForm() {
    el('l3d-st-signs').value = (STREET.signs || []).join('\n');
    ['gallery', 'jazz', 'office'].forEach(function (k) { el('l3d-st-' + k).value = STREET[k] || ''; });
    var sel = el('l3d-st-banner'), names = [STREET.gallery, STREET.jazz, STREET.office].concat(STREET.signs || []).filter(function (n, i, a) { return n && a.indexOf(n) === i; });
    sel.textContent = ''; [''].concat(names).forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n || '없음'; sel.appendChild(o); });
    sel.value = STREET.banner || '';
  }
  el('l3d-st-save').addEventListener('click', function () {
    var body = { signs: el('l3d-st-signs').value, gallery: el('l3d-st-gallery').value, jazz: el('l3d-st-jazz').value, office: el('l3d-st-office').value, banner: el('l3d-st-banner').value };
    el('l3d-out-msg').textContent = '저장 중...';
    postJSON('api/lib3d/settings', { street: body }).then(function (d) {
      STREET = d.street; streetForm();
      el('l3d-out-msg').textContent = '거리를 저장했습니다. 1층에서 다시 지어 바로 보여 줍니다.';
      if (cur === 0) buildFloor(0);
    }).catch(function (e) { el('l3d-out-msg').textContent = e.message; });
  });
  function outsideForm() { return { time: el('l3d-out-time').value, season: el('l3d-out-season').value, weather: el('l3d-out-weather').value }; }
  ['l3d-out-time', 'l3d-out-season', 'l3d-out-weather'].forEach(function (id) {
    el(id).addEventListener('change', function () { OUTSIDE = outsideForm(); applyOutside.force = true; applyOutside(); el('l3d-out-msg').textContent = '미리 보기 중 - 저장해야 남습니다.'; });
  });
  el('l3d-out-save').addEventListener('click', function () {
    postJSON('api/lib3d/settings', { outside: outsideForm() }).then(function (d) {
      OUTSIDE = d.outside; applyOutside.force = true; applyOutside(); el('l3d-out-msg').textContent = '저장했습니다.';
    }).catch(function (e) { el('l3d-out-msg').textContent = e.message; });
  });
  el('l3d-out-close').addEventListener('click', function () { outBox.classList.remove('on'); });
  function bannerModeUI() {
    var m = el('l3d-out-bmode').value;
    el('l3d-out-burl').hidden = m !== 'url'; el('l3d-out-blib').hidden = m !== 'library';
  }
  el('l3d-out-bmode').addEventListener('change', bannerModeUI);
  function bannerLibs() {   // 보관함 목록 (숨긴 보관함도 고를 수 있게 전부)
    var sel = el('l3d-out-banner-lib');
    if (sel.options.length > 1) { sel.value = BANNER.lib || ''; return; }
    api('api/lib3d/libraries').then(function (d) {
      d.libraries.forEach(function (l) {
        var o = document.createElement('option'); o.value = l.key; o.textContent = (FLOOR_NAMES[l.db_type] || l.db_type) + ' · ' + l.name; sel.appendChild(o);
      });
      sel.value = BANNER.lib || '';
    }).catch(function () { /* 목록 실패 - 저장할 때 다시 */ });
  }
  el('l3d-out-banner-save').addEventListener('click', function () {
    var m = el('l3d-out-bmode').value, url = el('l3d-out-banner').value.trim(), lib = el('l3d-out-banner-lib').value;
    if (m === 'library' && !lib) { el('l3d-out-msg').textContent = '보관함을 골라 주세요.'; return; }
    el('l3d-out-msg').textContent = m === 'url' ? '그림을 받아 보는 중...' : '저장 중...';
    var steps = m === 'library' ? [{ banner_lib: lib, banner_sec: +el('l3d-out-banner-sec').value || 30 }]
      : [{ banner_lib: '' }, { banner: m === 'url' ? url : '' }];
    steps.reduce(function (pr, body) { return pr.then(function () { return postJSON('api/lib3d/settings', body); }); }, Promise.resolve())
      .then(function () { return api('api/lib3d/data'); })
      .then(function (d) {
        BANNER = d.banner || BANNER; placeBanner();
        el('l3d-out-msg').textContent = BANNER.mode === 'library' ? '저장했습니다. ' + (STREET.banner || '현수막') + ' 건물 현수막에 그 보관함 표지가 ' + BANNER.sec + '초마다 바뀌어 걸립니다.'
          : BANNER.mode === 'url' ? '저장했습니다. 창밖 ' + (STREET.banner || '현수막') + ' 건물에 걸었습니다.' : '현수막을 내렸습니다.';
      }).catch(function (e) { el('l3d-out-msg').textContent = e.message; });
  });
  // 3D 모형: 지금 그대로(코드로 그린 가구) | 모형 파일
  var mdlBox = el('l3d-mdl');
  function openModels() {
    [setBox, aiBox, pplBox, outBox].forEach(function (b) { b.classList.remove('on'); }); mdlBox.classList.add('on');
    Array.prototype.forEach.call(mdlBox.querySelectorAll('input[name=l3d-mdl]'), function (i) { i.checked = i.value === MODELS; });
    el('l3d-mdl-msg').textContent = '';
  }
  el('l3d-mdl-close').addEventListener('click', function () { mdlBox.classList.remove('on'); });
  el('l3d-mdl-save').addEventListener('click', function () {
    var v = (mdlBox.querySelector('input[name=l3d-mdl]:checked') || {}).value || 'basic';
    el('l3d-mdl-msg').textContent = '저장 중...';
    postJSON('api/lib3d/settings', { models: v }).then(function (d) {
      MODELS = d.models;
      if (MODELS === 'real' && !(REAL.sofa || REAL.car)) { el('l3d-mdl-msg').textContent = '저장했습니다. 모형 파일을 받는 중 (약 14MB) - 다 받으면 바로 바뀝니다.'; loadReal(); }
      else { el('l3d-mdl-msg').textContent = '저장했습니다.'; rebuildForModels(); }
    }).catch(function (e) { el('l3d-mdl-msg').textContent = e.message; });
  });

  // AI 직원 설정 (관리자): 직업·목표·성격·부르는 말·자율 업무, 기억과 활동 기록 보기
  var staffBox = el('l3d-staff'), STAFF_CFG = null;
  function staffInput(tag, val, attrs) {
    var e = document.createElement(tag); if (tag === 'textarea') e.rows = 2;
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (attrs && attrs.type === 'checkbox') e.checked = !!val; else e.value = val == null ? '' : val;
    return e;
  }
  // 탭 안의 하위 탭: [data-sub] 묶음마다 버튼 하나, 고른 묶음만 보인다 (다시 그려도 고른 하위 탭은 그대로)
  function subTabs(box, order) {
    if (!box) return;
    var old = box.querySelector(':scope > .l3d-sub-tabs'); if (old) old.remove();
    var items = Array.prototype.slice.call(box.querySelectorAll(':scope > [data-sub]'));
    var names = [];
    items.forEach(function (x) { if (names.indexOf(x.dataset.sub) < 0) names.push(x.dataset.sub); });
    if (order) names.sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    if (names.length < 2) return;
    var bar = document.createElement('div'); bar.className = 'l3d-sub-tabs'; bar.setAttribute('role', 'tablist');
    var pick = names.indexOf(box.dataset.sub) >= 0 ? box.dataset.sub : names[0];
    function show(name) {
      box.dataset.sub = name;
      items.forEach(function (x) { x.hidden = x.dataset.sub !== name; });
      Array.prototype.forEach.call(bar.children, function (b) { b.classList.toggle('on', b.textContent === name); });
      box.scrollTop = 0;
    }
    names.forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = n;
      b.addEventListener('click', function () { show(n); });
      bar.appendChild(b);
    });
    box.insertBefore(bar, box.firstChild);
    show(pick);
  }
  function labeled(text, input) { var l = document.createElement('label'); l.className = input.type === 'checkbox' ? 'c' : 'f'; if (input.type === 'checkbox') { l.appendChild(input); l.appendChild(document.createTextNode(' ' + text)); } else { l.appendChild(document.createTextNode(text)); l.appendChild(input); } return l; }
  function drawStaff(d) {
    STAFF_CFG = d.config;
    var body = el('l3d-staff-body'); body.textContent = '';
    function section(sub, cls) { var sc = document.createElement('section'); sc.dataset.sub = sub; if (cls) sc.className = cls; body.appendChild(sc); return sc; }
    function h4(box, text) { var h = document.createElement('h4'); h.className = 'st-h'; h.textContent = text; box.appendChild(h); }
    function note(box, text) { var pn = document.createElement('p'); pn.className = 'sub'; pn.textContent = text; box.appendChild(pn); }
    // ── 기본·배달 ──
    var base = section('기본·배달', 'card');
    note(base, (d.configured ? '' : '⚠ AI 설정(연결 방식·주소·모델)을 먼저 해야 직원이 일합니다. ') +
      '오늘 AI 호출 ' + d.budget.used + ' / ' + (d.budget.limit || '무제한') + '회 (AI 설정 > 기능에서 한도 변경).');
    base.appendChild(labeled('자율 업무 - 이용자가 없어도 직원은 정해진 주기로 혼자 일하고, AI 손님도 찾아옴',
      staffInput('input', d.config.autonomous, { type: 'checkbox', 'data-k': 'autonomous' })));
    var dl = d.config.delivery || {}, dfs = section('기본·배달', 'card'); dfs.dataset.delivery = '1';
    h4(dfs, '배달 - 책·영상·웹툰이 들어오면 배달원이 1층 안내 데스크로');
    dfs.appendChild(labeled('배달 받기', staffInput('input', dl.enabled !== false, { type: 'checkbox', 'data-d': 'enabled' })));
    dfs.appendChild(labeled('웹툰 다운로더(BookOasis Assistant)가 보낸 회차도 (잠잠해질 때까지 모아 한 상자로)', staffInput('input', dl.webtoon !== false, { type: 'checkbox', 'data-d': 'webtoon' })));
    dfs.appendChild(labeled('배달원 이름 (바깥 프로그램이 이름을 보내면 그 이름)', staffInput('input', dl.name || '배달원', { type: 'text', 'data-d': 'name' })));
    note(dfs, d.events_on ? '바깥 프로그램 알림 켜짐: POST /api/lib3d/events (Authorization: Bearer LIB3D_EVENT_TOKEN).' : '바깥 프로그램(디스코드 봇 등)에서 보내려면 .env에 LIB3D_EVENT_TOKEN을 넣으세요.');
    var recent = (d.deliveries || []).slice(0, 5);
    if (recent.length) {
      var rl = document.createElement('div'); rl.className = 'logs';
      recent.forEach(function (x) { var r = document.createElement('div'); r.textContent = new Date(x.t * 1000).toLocaleString() + ' · ' + (x.from || (x.src === 'webtoon' ? '웹툰 다운로더' : '배달원')) + ' · ' + x.text; rl.appendChild(r); });
      h4(dfs, '최근 배달'); dfs.appendChild(rl);
    }
    var dc = d.discord || {}, dcs = section('기본·배달', 'card');
    h4(dcs, '디스코드 채널 연동 (.env)');
    note(dcs, (dc.send || dc.recv ? '보내기 ' + (dc.send ? '켬 (' + (dc.kinds || []).join(', ') + ')' : '끔') + ' · 받기 ' + (dc.recv ? '켬 - 말한 사람은 [' + dc.label + '] 이름으로 1층 라운지에' : '끔') +
      (dc.recv_at ? ' · 마지막 받음 ' + new Date(dc.recv_at * 1000).toLocaleTimeString() : '') + (dc.sent_at ? ' · 마지막 보냄 ' + new Date(dc.sent_at * 1000).toLocaleTimeString() : '')
      : '꺼짐 - .env의 LIB3D_DISCORD_WEBHOOK_URL(보내기)·LIB3D_DISCORD_BOT_TOKEN(받기)을 넣고 다시 시작하세요.') + (dc.error ? ' · ⚠ ' + dc.error : ''));
    // ── 사람마다 접고 펴는 카드 (서재 직원 / 길 건너 / AI 손님) ──
    var STREET_POST = { office: 1, gallery: 1, jazz: 1 }, firstOf = {};
    var guestSec = null;
    d.config.agents.forEach(function (a) {
      var guest = a.kind === 'guest';
      var sub = guest ? 'AI 손님' : STREET_POST[a.post] ? '길 건너' : '서재 직원';
      if (guest && !guestSec) {
        guestSec = section('AI 손님');
        note(guestSec, '정해진 주기마다 입구로 들어와 구역을 둘러보고, 직원에게 묻고, 책을 살펴본 뒤 나갑니다 (손님과 직원의 대화는 그 층 채팅에 공개). ' +
          '오늘 호출을 한도의 70% 넘게 썼으면 손님은 오지 않습니다.');
      }
      if (sub === '길 건너' && !firstOf[sub]) note(section(sub), '길 건너 건물(사무실·갤러리·재즈 청음실)에서 일하는 사람들. 가끔 손님처럼 서재에 들르고, 사서·도슨트의 보고는 대표가 받습니다.');
      var fs = document.createElement('fieldset'); fs.dataset.agent = a.id; fs.dataset.sub = sub;
      if (!firstOf[sub]) { firstOf[sub] = true; fs.classList.add('open'); }
      var head = document.createElement('button'); head.type = 'button'; head.className = 'fs-head';
      var hb = document.createElement('b'); hb.textContent = a.name; head.appendChild(hb);
      var hs = document.createElement('small'); hs.textContent = a.job + (d.remote_on && a.remote_url ? ' · 바깥 AI(전화)' : ''); head.appendChild(hs);
      if (a.enabled === false) { var off = document.createElement('span'); off.className = 'off-tag'; off.textContent = guest ? '안 옴' : '쉼'; head.appendChild(off); }
      var arrow = document.createElement('i'); arrow.textContent = '›'; head.appendChild(arrow);
      head.addEventListener('click', function () { fs.classList.toggle('open'); });
      fs.appendChild(head);
      var fb = document.createElement('div'); fb.className = 'fs-body'; fs.appendChild(fb);
      fb.appendChild(labeled(guest ? '방문하기' : '일하기', staffInput('input', a.enabled !== false, { type: 'checkbox', 'data-f': 'enabled' })));
      if (!guest) fb.appendChild(labeled('혼자 돌아다니기 (끄면 일이 없을 때 제자리)', staffInput('input', a.roam !== false, { type: 'checkbox', 'data-f': 'roam' })));
      var g2 = document.createElement('div'); g2.className = 'grid2'; fb.appendChild(g2);
      g2.appendChild(labeled('이름', staffInput('input', a.name, { type: 'text', 'data-f': 'name' })));
      g2.appendChild(labeled(guest ? '소개' : '직업', staffInput('input', a.job, { type: 'text', 'data-f': 'job' })));
      if (!guest) g2.appendChild(labeled('부르는 말 (쉼표로)', staffInput('input', (a.call || []).join(', '), { type: 'text', 'data-f': 'call' })));
      fb.appendChild(labeled(guest ? '찾는 것' : '목표', staffInput('textarea', a.goal, { type: 'text', 'data-f': 'goal' })));
      fb.appendChild(labeled('성격', staffInput('textarea', a.personality, { type: 'text', 'data-f': 'personality' })));
      if (!guest && d.remote_on) {   // 전화: 이 직원의 생각을 바깥 AI가 맡는다 (.env의 LIB3D_REMOTE_AI=1일 때만 보임 - 디스코드는 채널 연동을 쓴다)
        h4(fb, '바깥 AI (전화) - 넣으면 질문·보고를 그 주소로 보내고, 이 직원의 자율 업무는 쉼');
        var g3 = document.createElement('div'); g3.className = 'grid2'; fb.appendChild(g3);
        g3.appendChild(labeled('주소', staffInput('input', a.remote_url || '', { type: 'url', 'data-f': 'remote_url', placeholder: '비우면 이 서버의 AI' })));
        g3.appendChild(labeled('토큰 (Bearer)', staffInput('input', '', { type: 'password', 'data-f': 'remote_token', placeholder: a.remote_token_set ? '저장됨 - 바꿀 때만 입력' : '없음', autocomplete: 'new-password' })));
      }
      if ((a.tasks || []).length) h4(fb, guest ? '방문' : '혼자 하는 업무 (주기: 분)');
      (a.tasks || []).forEach(function (t) {
        var row = document.createElement('div'); row.className = 'task'; row.dataset.task = t.id;
        row.appendChild(staffInput('input', t.enabled !== false, { type: 'checkbox', 'data-t': 'enabled', title: '이 업무 켜기' }));
        var nm = document.createElement('b'); var lr = d.last_run[a.id + '/' + t.id];
        nm.textContent = t.title; var when = document.createElement('small'); when.textContent = lr ? ' 마지막 ' + new Date(lr * 1000).toLocaleString() : ' 아직 안 함'; nm.appendChild(when); row.appendChild(nm);
        row.appendChild(staffInput('input', t.every_min, { type: 'number', min: 10, max: 10080, 'data-t': 'every_min', title: '주기(분)' }));
        var run = document.createElement('button'); run.type = 'button'; run.className = 'l3d-btn'; run.textContent = '지금 실행';
        run.addEventListener('click', function () {
          el('l3d-staff-msg').textContent = a.name + ' - ' + t.title + ' 시작했습니다. 끝나면 활동 기록에 남습니다.';
          postJSON('api/lib3d/agents', { action: 'run', agent: a.id, task: t.id }).catch(function (e) { el('l3d-staff-msg').textContent = e.message; });
        });
        row.appendChild(run);
        var det = document.createElement('details'); det.className = 'task-prompt';
        var sm = document.createElement('summary'); sm.textContent = '지시문'; det.appendChild(sm);
        det.appendChild(staffInput('textarea', t.prompt, { 'data-t': 'prompt' }));
        row.appendChild(det);
        fb.appendChild(row);
      });
      var notes = (d.notes[a.id] || []).slice(-6);
      if (notes.length) { var n = document.createElement('div'); n.className = 'notes'; n.textContent = '기억: ' + notes.join(' / '); fb.appendChild(n); }
      body.appendChild(fs);
    });
    // ── 활동 기록 ──
    var logSec = section('활동 기록', 'card');
    var logs = document.createElement('div'); logs.className = 'logs';
    (d.log || []).slice(0, 30).forEach(function (e) {
      var r = document.createElement('div');
      r.textContent = new Date(e.t * 1000).toLocaleString() + ' · ' + e.name + ' · ' + e.title + '\n' + e.text;
      logs.appendChild(r);
    });
    if (!(d.log || []).length) logs.textContent = '아직 기록이 없습니다.';
    logSec.appendChild(logs);
    subTabs(body, ['기본·배달', '서재 직원', '길 건너', 'AI 손님', '활동 기록']);
  }
  function openStaff() {
    [setBox, aiBox, pplBox, outBox, mdlBox].forEach(function (b) { b.classList.remove('on'); }); staffBox.classList.add('on');
    el('l3d-staff-msg').textContent = '';
    api('api/lib3d/agents').then(drawStaff).catch(function (e) { el('l3d-staff-body').textContent = e.message; });
  }
  el('l3d-staff-close').addEventListener('click', function () { staffBox.classList.remove('on'); });
  el('l3d-staff-reset').addEventListener('click', function () {
    if (!window.confirm('AI 직원·손님 설정을 기본값으로 되돌릴까요? (기억·활동 기록은 남습니다)')) return;
    postJSON('api/lib3d/agents', { action: 'reset' }).then(function (d) { drawStaff(d); el('l3d-staff-msg').textContent = '기본값으로 되돌렸습니다.'; })
      .catch(function (e) { el('l3d-staff-msg').textContent = e.message; });
  });
  el('l3d-staff-save').addEventListener('click', function () {
    var body = { action: 'save', autonomous: staffBox.querySelector('[data-k=autonomous]').checked, agents: [], delivery: {} };
    Array.prototype.forEach.call(staffBox.querySelectorAll('[data-d]'), function (i) { body.delivery[i.dataset.d] = i.type === 'checkbox' ? i.checked : i.value; });
    Array.prototype.forEach.call(staffBox.querySelectorAll('fieldset[data-agent]'), function (fs) {
      var a = { id: fs.dataset.agent, tasks: [] };
      Array.prototype.forEach.call(fs.querySelectorAll('[data-f]'), function (i) { a[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; });
      Array.prototype.forEach.call(fs.querySelectorAll('.task'), function (row) {
        var t = { id: row.dataset.task };
        Array.prototype.forEach.call(row.querySelectorAll('[data-t]'), function (i) { t[i.dataset.t] = i.type === 'checkbox' ? i.checked : i.value; });
        a.tasks.push(t);
      });
      body.agents.push(a);
    });
    el('l3d-staff-msg').textContent = '저장 중...';
    postJSON('api/lib3d/agents', body).then(function (d) { drawStaff(d); el('l3d-staff-msg').textContent = '저장했습니다.'; })
      .catch(function (e) { el('l3d-staff-msg').textContent = e.message; });
  });
  // ── 서재 설정 창: 위쪽 탭 하나로 (보관함 · AI 설정 · 인물 수 · 창밖 풍경 · 3D 모형 · AI 직원) ──
  // 각 탭의 내용은 예전 설정 패널 그대로(열 때 불러오고, 패널마다 저장). 패널이 켜지면(.on) 창이 보이고 그 탭에 불이 들어온다
  var cfgBox = el('l3d-cfg'), cfgTabsEl = el('l3d-cfg-tabs');
  var CFG_TABS = [[setBox, '보여 줄 보관함', function () { openSettings(); }], [aiBox, 'AI 설정', function () { openAI(); }],
                  [pplBox, '층별 인물 수', function () { if (floors.length) openPeople(); else pendingPeople = true; }],
                  [outBox, '창밖 풍경', function () { openOutside(); }], [mdlBox, '3D 모형', function () { openModels(); }],
                  [staffBox, 'AI 직원', function () { openStaff(); }]];
  function cfgGo(i) {
    CFG_TABS.forEach(function (t) { t[0].classList.remove('on'); });
    CFG_TABS[i][2]();
    CFG_TABS[i][0].classList.add('on');
  }
  CFG_TABS.forEach(function (t, i) {
    var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = t[1];
    b.addEventListener('click', function () { if (!t[0].classList.contains('on')) cfgGo(i); });
    cfgTabsEl.appendChild(b);
  });
  function cfgSync() {   // 켜진 패널이 있으면 창을 띄우고 그 탭 표시
    var any = false;
    CFG_TABS.forEach(function (t, i) {
      var on = t[0].classList.contains('on'); any = any || on;
      cfgTabsEl.children[i].classList.toggle('on', on); cfgTabsEl.children[i].setAttribute('aria-selected', on ? 'true' : 'false');
    });
    cfgBox.classList.toggle('on', any);
  }
  if (window.MutationObserver) {
    var cfgObs = new MutationObserver(cfgSync);
    CFG_TABS.forEach(function (t) { cfgObs.observe(t[0], { attributes: true, attributeFilter: ['class'] }); });
  }
  function cfgClose() { CFG_TABS.forEach(function (t) { t[0].classList.remove('on'); }); cfgSync(); }
  el('l3d-cfg-x').addEventListener('click', cfgClose);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cfgBox.classList.contains('on')) { e.stopPropagation(); cfgClose(); } }, true);
  subTabs(aiBox.querySelector('.body'), ['연결', '기능', '도구']);
  subTabs(outBox.querySelector('.body'), ['풍경', '거리', '현수막']);
  function hashNav() {
    if (ME && ME.role === 'viewer') return;
    var tab = { '#settings': 0, '#ai': 1, '#people': 2, '#outside': 3, '#models': 4, '#staff': 5 }[location.hash];
    if (tab != null) cfgGo(tab);
    if (location.hash === '#brunch' && BRUNCH_ON) openBrunch();
  }
  var pendingPeople = false;
  window.addEventListener('hashchange', hashNav);
  setTimeout(hashNav, 0);

  // ── 지도·층 ──
  var map = el('l3d-map');
  function closeMap() { map.classList.remove('on'); }
  function menuButton(text, sub, fn, strong) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = '<span></span><small></small>';
    btn.firstChild.textContent = text; btn.lastChild.textContent = sub;
    if (strong) btn.style.fontWeight = '700';
    btn.addEventListener('click', fn);
    map.appendChild(btn);
  }
  function openFloors() {
    map.textContent = '';
    floors.forEach(function (f, i) {
      menuButton((i === cur ? '▶ ' : '') + f.label, '보관함 ' + f.libs.length + ' · 작품 ' + f.total.toLocaleString(),
        function () { buildFloor(i); home(); closeMap(); }, i === cur);
    });
    map.classList.add('on');
  }
  el('l3d-map-btn').addEventListener('click', function () {
    if (map.classList.contains('on')) { closeMap(); return; }
    map.textContent = '';
    floors.forEach(function (f) {
      var head = document.createElement('div');
      head.textContent = f.label;
      head.style.cssText = 'padding:8px 10px 2px;font-size:.75rem;opacity:.65;font-weight:700';
      map.appendChild(head);
      f.booths.forEach(function (b) { menuButton(b.name, b.count + '작품', function () { teleport(b); }); });
    });
    map.classList.add('on');
  });
  el('l3d-floor-btn').addEventListener('click', function () { if (map.classList.contains('on')) closeMap(); else openFloors(); });
  el('l3d-home').addEventListener('click', function () { home(); closeMap(); });
  el('l3d-outside').addEventListener('click', function () {   // 외부로: 1층 밖, 서재와 캠핑장 사이 강 위 나무다리 한가운데 (캠핑장 쪽을 보고)
    if (!floors.length) return;
    if (cur !== 0) buildFloor(0);
    if (RV) { camera.position.set(0, EYE, (RV.z0 + RV.z1) / 2); yaw = Math.PI; pitch = 0.05; } else home();
    closeMap();
  });
  el('l3d-reload').addEventListener('click', function () { build(true); });

  var whereEl = el('l3d-where');
  function where() {
    var best = null, bd = 1e9;
    booths.forEach(function (b) {
      var d = Math.hypot(camera.position.x - b.x, camera.position.z - b.z);
      if (d < bd) { bd = d; best = b; }
    });
    var fl = floors[cur] ? floors[cur].label + ' · ' : '';
    var room0 = roomAt(camera.position.x, camera.position.z);
    if (room0) { whereEl.textContent = room0.label; return; }
    if (RV && cur === 0 && camera.position.z > RV.z1) { whereEl.textContent = '강 건너 캠핑장 · 빈 의자에 앉아 쉴 수 있어요'; return; }
    if (RV && cur === 0 && camera.position.z > RV.z0) { whereEl.textContent = '강 위 다리 · 건너편은 캠핑장'; return; }
    if (isOutside(camera.position.x, camera.position.z)) { whereEl.textContent = '도서관 밖 · 유리문으로 들어오면 ' + fl.replace(/ · $/, ''); return; }
    whereEl.textContent = fl + (best && bd < 9 ? best.name + ' · ' + best.count + '작품' : '로비 · 엘리베이터나 [층]으로 다른 층');
  }

  // ── 짓기: 세션(db_type)마다 한 층 ──
  var FLOOR_NAMES = { general: '일반', adult: '성인', audiobook: '오디오북', video: '비디오' };
  var FLOOR_ORDER = ['general', 'adult', 'audiobook', 'video'];
  var floors = [], cur = -1, floorGroup = null;
  function makeFloors(libs) {
    var by = {};
    libs.forEach(function (l) { (by[l.db_type] = by[l.db_type] || []).push(l); });
    return Object.keys(by).sort(function (a, b) {
      var ia = FLOOR_ORDER.indexOf(a), ib = FLOOR_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    }).map(function (k, i) {
      var list = by[k], total = 0;
      list.forEach(function (l) { total += l.series.length; });
      return { key: k, label: (i + 1) + '층 ' + (FLOOR_NAMES[k] || k), libs: list, total: total, booths: [] };
    });
  }
  var shared = [].concat.apply([], Object.keys(M).map(function (k) { return M[k]; }));   // 배열(나뭇잎·외벽 색)도 펼친다
  function disposeGroup(g) {
    g.traverse(function (o) {
      if (o.geometry && !o.geometry.userData.shared && [faceGeo, torsoGeo, legGeo, armGeo, ballGeo, hairGeo, neckGeo].indexOf(o.geometry) < 0) o.geometry.dispose();
      var ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      ms.forEach(function (m) {
        if (shared.indexOf(m) >= 0 || m.userData.keep) return;   // 공용 재질은 그대로
        if (m.map && m.map !== oakTex && m.map !== floorTex && m.map !== skyTex) m.map.dispose();
        m.dispose();
      });
    });
  }
  // 입구 벽·안쪽 벽에 이 층 책 표지를 포스터처럼 (무작위, 누르면 작품 카드)
  var posterGeo = new T.PlaneGeometry(1, 1); posterGeo.userData.shared = true;
  function addPosters(fl, seed) {
    if (!layout) return;
    var r = rnd(seed * 211 + 5), pool = [];
    fl.libs.forEach(function (lib) { lib.series.forEach(function (s) { if (s.last) pool.push([lib, s]); }); });
    if (!pool.length) return;
    var L = layout, PW = 1.5, PH = 2.15, frame = 0.07;
    function poster(x, z, rotY) {
      var pick0 = pool.splice(Math.floor(r() * pool.length), 1)[0];
      if (!pick0) return;
      var lib = pick0[0], s = pick0[1], base = colorOf(s.title);
      var mat = new T.MeshStandardMaterial({ color: base, roughness: 0.55 });
      var b = { key: lib.db_type + ':' + s.last, title: s.title || '(제목 없음)', count: s.count, lib: lib.name, db: lib.db_type,
                front: mat, base: base, state: 2, kind: 'poster' };
      var g = new T.Group(); g.position.set(x, 2.55 + (r() - 0.5) * 0.25, z); g.rotation.y = rotY; parent.add(g);
      var back = new T.Mesh(unitBox, M.black); back.scale.set(PW + frame * 2, PH + frame * 2, 0.04); back.position.z = 0.02; g.add(back);
      var m = new T.Mesh(posterGeo, mat); m.scale.set(PW, PH, 1); m.position.z = 0.045; m.userData.book = b; g.add(m);
      b.mesh = m; books.push(b);
      loader.load('api/lib3d/cover?k=' + encodeURIComponent(b.key), function (tex) {
        tex.encoding = T.sRGBEncoding; tex.anisotropy = 8; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; b.cover = true;
      }, undefined, function () { b.state = 3; titleCover(b); });
    }
    var step = 2.6, x;
    // 입구 벽 (안쪽을 보게, 문·엘리베이터 앞은 비움)
    for (x = -L.w / 2 + 3.5; x < L.w / 2 - 2; x += step + r() * 0.8) {
      if (Math.abs(x) < 3.2) continue;
      if (ARC_X && x > ARC_X[0] && x < ARC_X[1]) continue;   // 오락기 뒤 벽은 비운다
      if (r() < 0.85) poster(x, L.front - 0.12, Math.PI);
    }
    // 안쪽 벽
    for (x = -L.w / 2 + 2.5; x < L.w / 2 - 2; x += step + r() * 0.8) if (r() < 0.85) poster(x, L.back + 0.12, 0);
  }
  function dimEnv(root) {   // 환경 반사광은 은은하게 (재질마다 한 번)
    if (!scene.environment) return;
    root.traverse(function (o) {
      [].concat(o.material || []).forEach(function (m) { if (m && m.isMeshStandardMaterial && !m.userData.envSet) { m.envMapIntensity = m === M.floor ? 0.12 : 0.3; m.userData.envSet = true; } });
    });
  }
  function buildFloor(i) {
    if (floorGroup) { scene.remove(floorGroup); disposeGroup(floorGroup); }
    books = []; booths = []; seats = []; if (sitting) standUp(true);
    cur = i;
    var fl = floors[i];
    floorGroup = new T.Group();
    scene.add(floorGroup);
    parent = floorGroup;
    ARC_X = null; CINE_WALL = null; ROOMS = []; GALLERY_R = null; OFFICE = null; JZ.room = null; JZ.bars = null; JZ.platter = null; JZ.screen = null;   // 길 건너 방은 1층에서만 다시 만든다
    if (i !== 0 && JZ.playing) jzStop(); if (cine.video) cineStop(); cineScreen = null; if (cine.tex) { cine.tex.dispose(); cine.tex = null; }
    COLS = fl.cinema ? 3 : Math.max(2, Math.min(4, fl.libs.length));
    brunchHits = [];
    addBuilding(fl, COLS, fl.cinema ? 1 : Math.ceil(fl.libs.length / COLS));
    applyOutside.force = true; applyOutside();
    fl.libs.forEach(function (lib, j) { addSection(lib, j); });
    if (i === 0 && ARCADE.length && layout) { var sp0 = arcadeSpan(layout); if (sp0.x1 >= -layout.w / 2 + 6) ARC_X = [sp0.x1 - 0.8, sp0.x0 + 0.8]; }   // 포스터보다 먼저 자리를 잡는다
    addPosters(fl, i + 1);
    addBrunchCorner(i);
    addArcade(i);
    addMediaBooth(fl);
    if (fl.cinema) addCinema();
    spawnPeople(fl, i + 1);
    dimEnv(floorGroup);
    booths.forEach(function (b) { b.floor = i; });
    fl.booths = booths.slice();
    parent = scene;
    closeCard();
  }
  function build(refresh) {
    msg.style.display = '';
    msg.textContent = '서점을 여는 중...';
    fetch('api/lib3d/data' + (refresh ? '?refresh=1' : ''), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || '불러오기 실패');
        var libs = d.libraries || [];
        if (!libs.length) {
          msg.textContent = 'BookOasis 보관함을 읽지 못했습니다. .env의 BOOKOASIS_DB_URL을 확인하세요.' +
            ((d.errors || []).length ? ' (' + d.errors.join(' / ') + ')' : '');
          return;
        }
        applyMe(d.me);
        STAFF_ON = !!d.staff_on;
        BRUNCH_ON = !!d.brunch_on;
        if (d.ai) setAI(d.ai);
        PEOPLE = d.people || {};
        MODELS = d.models === 'real' ? 'real' : 'basic'; loadReal();
        if (d.banner) { BANNER = d.banner; if (el('l3d-out').classList.contains('on')) openOutside(); }
        if (d.outside) OUTSIDE = Object.assign({ time: 'auto', season: 'auto', weather: 'clear' }, d.outside);
        floors = makeFloors(libs);
        ARCADE = d.arcade || [];
        if (d.street) STREET = d.street;
        YMPLAYER = d.ymplayer || ''; YM_EMBED = d.ymplayer_embed || 'auto'; YMPROXY = !!d.ymproxy;
        if (YMPLAYER || YMPROXY) floors.push({ key: 'cinema', label: (floors.length + 1) + '층 영화관', libs: [], total: 0, booths: [], cinema: true });
        floors.forEach(function (f, i) {
          var cols = Math.max(2, Math.min(4, f.libs.length));
          f.booths = f.libs.map(function (l, j) {
            return { name: l.name, count: l.series.length, floor: i,
                     x: (j % cols - (cols - 1) / 2) * (BOOTH_W + GAP), z: -LOBBY - BOOTH_D / 2 - Math.floor(j / cols) * (BOOTH_D + GAP) };
          });
        });
        var first = !posRestored; posRestored = true;
        if (!(first && restorePos())) { buildFloor(Math.max(0, Math.min(cur, floors.length - 1))); home(); }
        msg.style.display = 'none';
        if (pendingPeople) { pendingPeople = false; openPeople(); }
      })
      .catch(function (e) { msg.textContent = '불러오지 못했습니다: ' + e.message; });
  }

  // ── 함께 보기: 0.4초마다 내 위치를 보내고, 같은 층 사람들을 이름표 단 사람으로 보여 준다 + 채팅 ──
  var ME = null;                    // {username, role, adult} (서재 데이터와 함께 받음)
  function ukey(k) { return ME ? k + '@' + ME.username : k; }   // 같은 브라우저를 여러 사람이 써도 기억을 따로
  var remotes = {};                 // 사용자 → 사람 모형 {g, mixer, acts, tag, tx, tz, tyaw, msg, msgUntil}
  var chatSince = 0, presBusy = false, onlineList = [];
  function nameTag(name, msg, color) {   // 머리 위 이름표 (말하면 말풍선 위에 한 줄)
    var c = document.createElement('canvas'); c.width = 512; c.height = msg ? 220 : 90;
    var g = c.getContext('2d');
    function pill(y, h, bg, fg, text, size, bold) {
      g.font = (bold ? '700 ' : '500 ') + size + 'px ' + FONT;
      var w = Math.min(500, g.measureText(text).width + 40), x = (512 - w) / 2;
      g.fillStyle = bg; g.beginPath(); g.moveTo(x + h / 2, y); g.lineTo(x + w - h / 2, y); g.arc(x + w - h / 2, y + h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
      g.lineTo(x + h / 2, y + h); g.arc(x + h / 2, y + h / 2, h / 2, Math.PI / 2, Math.PI * 1.5); g.fill();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, y + h / 2 + 2, 470);
    }
    if (msg) {
      var line = msg.length > 26 ? msg.slice(0, 25) + '…' : msg;
      pill(10, 100, 'rgba(255,255,255,0.96)', '#1d1e20', line, 40, false);
    }
    pill(c.height - 78, 66, 'rgba(20,21,23,0.82)', color || '#ffd166', name, 36, true);
    var tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding;
    var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.scale.set(1.6, 1.6 * c.height / 512, 1); sp.renderOrder = 10;
    return sp;
  }
  function setTag(p, name, msg) {
    if (p.tag) { p.g.remove(p.tag); p.tag.material.map.dispose(); p.tag.material.dispose(); }
    p.tag = nameTag(name, msg); p.tag.position.y = 2.1 + (msg ? 0.2 : 0); p.g.add(p.tag);
  }
  function makeRemote(name) {
    var p = makePerson(hashStr(name) % 100000 + 7);
    p.kind = 'remote'; p.remote = name; p.walkW = 0;
    setTag(p, name, '');
    return p;
  }
  function updateRemote(p, dt) {
    var dx = p.tx - p.g.position.x, dz = p.tz - p.g.position.z, d = Math.hypot(dx, dz);
    if (d > 6) { p.g.position.x = p.tx; p.g.position.z = p.tz; d = 0; }   // 엘리베이터·지도 이동은 바로
    var k = Math.min(1, dt * 6);
    p.g.position.x += dx * k; p.g.position.z += dz * k;
    var cy = p.g.rotation.y, diff = Math.atan2(Math.sin(p.tyaw - cy), Math.cos(p.tyaw - cy));
    p.g.rotation.y = cy + diff * Math.min(1, dt * 8);
    var moving = p.moving || d > 0.08;
    p.walkW += ((moving ? 1 : 0) - p.walkW) * Math.min(1, dt * 5);
    if (p.mixer) {
      if (p.acts.walk) { p.acts.walk.setEffectiveWeight(p.walkW); p.acts.walk.timeScale = 1.1; }
      if (p.acts.idle) p.acts.idle.setEffectiveWeight(1 - p.walkW);
      p.mixer.update(dt);
    }
    sitPose(p, dt);
    if (p.msgUntil && performance.now() > p.msgUntil) { p.msgUntil = 0; setTag(p, p.remote, ''); }
    p.g.visible = Math.hypot(camera.position.x - p.g.position.x, camera.position.z - p.g.position.z) > 0.9;   // 내 자리와 겹치면 숨김
  }
  function sitPose(p, dt) {   // 함께 보는 사람이 앉았으면: 엉덩이를 내리고 허벅지·무릎을 굽힌다 (걷기·서 있기 동작 위에 덧씌움)
    p.sitW = (p.sitW || 0) + ((p.sit ? 1 : 0) - (p.sitW || 0)) * Math.min(1, dt * 5);
    var w = p.sitW;
    p.g.position.y = -0.47 * w;
    if (w < 0.01) return;
    if (p.mixer) {
      if (!p.sb) p.sb = { ul: findBone(p.model, 'LeftUpLeg'), ur: findBone(p.model, 'RightUpLeg'), ll: findBone(p.model, 'LeftLeg'), lr: findBone(p.model, 'RightLeg') };
      if (p.sb.ul) p.sb.ul.rotateX(-1.5 * w);
      if (p.sb.ur) p.sb.ur.rotateX(-1.5 * w);
      if (p.sb.ll) p.sb.ll.rotateX(1.55 * w);
      if (p.sb.lr) p.sb.lr.rotateX(1.55 * w);
    } else if (p.legL) { p.legL.rotation.x = -1.5 * w; p.legR.rotation.x = -1.5 * w; }
  }
  function dropRemote(name) {
    var p = remotes[name]; if (!p) return;
    if (p.g.parent) p.g.parent.remove(p.g);
    disposeGroup(p.g); delete remotes[name];
  }
  function syncRemotes(list) {
    var seen = {};
    list.forEach(function (o) {
      var rid = o.id || o.user;   // 같은 손님 계정을 여럿이 써도 창마다 따로
      seen[rid] = true;
      var p = remotes[rid];
      if (p && p.g.parent !== floorGroup) { dropRemote(rid); p = null; }   // 층을 다시 지었으면 새로
      if (p && p.remote !== o.user) { setTag(p, o.user, ''); p.remote = o.user; }   // 이름을 바꿨으면
      if (!p) {
        p = remotes[rid] = makeRemote(o.user);
        p.g.position.set(o.x, 0, o.z); p.g.rotation.y = o.yaw;
        floorGroup.add(p.g);
        dimEnv(p.g);
      }
      p.tx = o.x; p.tz = o.z; p.tyaw = o.yaw; p.moving = o.moving && !o.sit; p.readingTitle = o.reading; p.sit = !!o.sit;
    });
    Object.keys(remotes).forEach(function (n) { if (!seen[n]) dropRemote(n); });
  }
  // 채팅
  var chatLog = el('l3d-chat-log'), chatIn = el('l3d-chat-in');
  function chatLine(m) {
    var d = document.createElement('div'); d.className = 'l3d-chat-line' + (m.to ? ' priv' : '');
    var who = document.createElement('b'); who.textContent = m.user + (m.floor && floors[cur] && m.floor !== floors[cur].key ? ' (' + floorLabel(m.floor) + ')' : '');
    d.appendChild(who); d.appendChild(document.createTextNode(' ' + m.text));
    if (m.books && m.books.length) {   // 안내 데스크가 찾은 책: 누르면 작품 카드(여기서 읽기·BookOasis 뷰어), ↗는 BookOasis 상세
      var ul = document.createElement('div'); ul.className = 'l3d-chat-books';
      m.books.forEach(function (bk) {
        var row = document.createElement('div'); row.className = 'l3d-chat-book';
        var img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = 'api/lib3d/cover?k=' + encodeURIComponent(bk.key);
        img.onerror = function () { img.style.visibility = 'hidden'; };
        var btn = document.createElement('button'); btn.type = 'button';
        var t = document.createElement('b'); t.textContent = bk.title;
        var sub = document.createElement('small');
        sub.textContent = [bk.author, bk.count + '권', bk.status, FLOOR_NAMES[bk.db] || bk.db].filter(Boolean).join(' · ');
        btn.appendChild(t); btn.appendChild(sub);
        btn.addEventListener('click', function () { showCard({ key: bk.key, title: bk.title, count: bk.count, lib: (FLOOR_NAMES[bk.db] || bk.db) + ' 서재', db: bk.db }); });
        row.appendChild(img); row.appendChild(btn);
        if (bk.url) {
          var a = document.createElement('a'); a.href = bk.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '↗'; a.title = 'BookOasis에서 열기';
          row.appendChild(a);
        }
        ul.appendChild(row);
      });
      d.appendChild(ul);
    }
    if (m.user === '안내 데스크' && m.text !== '찾아보는 중...') {   // 답이 오면 '찾아보는 중...'은 지운다
      Array.prototype.forEach.call(chatLog.querySelectorAll('.l3d-chat-line.wait'), function (x) { x.remove(); });
    }
    if (m.user === '안내 데스크' && m.text === '찾아보는 중...') d.classList.add('wait');
    if (m.to) el('l3d-chat').classList.add('ask');
    chatLog.appendChild(d);
    while (chatLog.children.length > 40) chatLog.removeChild(chatLog.firstChild);
    chatLog.scrollTop = chatLog.scrollHeight;
    var p = remotes[m.user];
    if (p && Date.now() / 1000 - m.t < 20) { setTag(p, m.user, m.text); p.msgUntil = performance.now() + 7000; }
  }
  function floorLabel(key) {
    var f = floors.filter(function (x) { return x.key === key; })[0];
    return f ? f.label.split(' ')[0] : (FLOOR_NAMES[key] || key || '?');
  }
  function onlineChip() {
    var chip = el('l3d-online'), others = onlineList.filter(function (o) { return o.id ? o.id !== MYKEY : (!ME || o.user !== ME.username); });
    chip.hidden = !others.length;
    chip.textContent = '함께 보는 사람 ' + others.length + ' · ' + others.map(function (o) {
      return o.user + '(' + floorLabel(o.floor) + (o.reading ? ' · 읽는 중' : '') + ')';
    }).join(', ');
  }
  function presenceTick() {
    if (LEFT || NICK_ASK || presBusy || !floors.length || cur < 0 || !floors[cur] || document.visibilityState !== 'visible') return;
    presBusy = true;
    var body = { floor: floors[cur].key, x: +(sitting ? sitting.x : camera.position.x).toFixed(2), z: +(sitting ? sitting.z : camera.position.z).toFixed(2),
                 yaw: +(sitting ? sitting.rot : yaw + Math.PI).toFixed(3), sit: !!sitting,
                 moving: !!(keys.w || keys.s || keys.a || keys.d || keys.arrowup || keys.arrowdown || moveStick.x || moveStick.y),
                 reading: reading ? el('l3d-r-title').textContent : null, since: chatSince, cid: CID, nick: NICK };
    fetch('api/lib3d/presence', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) return;
        syncRemotes(d.others || []);
        if (STAFF_ON) syncStaff(d.staff);
        MYKEY = d.me || MYKEY; onlineList = d.online || []; onlineChip();
        (d.chat || []).forEach(function (m) { if (m.id > chatSince) chatLine(m); });
        chatSince = Math.max(chatSince, d.chat_id || 0);
      }).catch(function (e) { console.warn('3D 서재 함께 보기:', e && e.message); })
      .then(function () { presBusy = false; });
  }
  setInterval(presenceTick, 400);
  chatIn.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key !== 'Enter' || e.isComposing) return;
    var text = chatIn.value.trim(); if (!text || !floors[cur]) return;
    chatIn.value = '';
    postJSON('api/lib3d/say', { text: text, floor: floors[cur].key, cid: CID, nick: NICK }).then(function () { presenceTick(); setTimeout(presenceTick, 300); })
      .catch(function (er) { var m = { user: '알림', text: er.message, t: Date.now() / 1000 }; chatLine(m); });
  });
  new MutationObserver(function () { el('l3d-chat').classList.toggle('hide', map.classList.contains('on')); })   // 층·지도 목록과 겹치지 않게
    .observe(map, { attributes: true, attributeFilter: ['class'] });
  el('l3d-chat-toggle').addEventListener('click', function () { el('l3d-chat').classList.toggle('min'); });
  // 함께 보기의 나: 창(브라우저)마다 id, 손님(관람자) 계정은 들어올 때 이름을 적는다 (같은 guest 계정을 여럿이 써도 구별)
  var CID = '', NICK = '', NICK_ASK = false, MYKEY = '';
  try { CID = localStorage.getItem('l3d_cid') || ''; if (!CID) { CID = Math.random().toString(36).slice(2, 12); localStorage.setItem('l3d_cid', CID); } } catch (e) { CID = Math.random().toString(36).slice(2, 12); }
  try { CID += (sessionStorage.getItem('l3d_tab') || (function () { var t = Math.random().toString(36).slice(2, 5); sessionStorage.setItem('l3d_tab', t); return t; })()); } catch (e) { /* 창 구별 없이 */ }
  function askNick() {
    var box = el('l3d-nick'), inp = el('l3d-nick-in');
    try { inp.value = localStorage.getItem('l3d_nick') || ''; } catch (e) { inp.value = ''; }
    NICK_ASK = true; box.classList.add('on'); keys = {};
    setTimeout(function () { inp.focus(); inp.select(); }, 50);
  }
  function setNick(v) {
    NICK = String(v || '').replace(/\s+/g, ' ').replace(/^@+/, '').trim().slice(0, 16);
    try { localStorage.setItem('l3d_nick', NICK); } catch (e) { /* 이번 한 번만 */ }
    NICK_ASK = false; el('l3d-nick').classList.remove('on');
    el('l3d-nick-btn').textContent = '✎ ' + (NICK || (ME && ME.username) || '이름');
    presenceTick();
  }
  el('l3d-nick-ok').addEventListener('click', function () { setNick(el('l3d-nick-in').value); });
  el('l3d-nick-skip').addEventListener('click', function () { setNick(''); });
  el('l3d-nick-in').addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) setNick(el('l3d-nick-in').value); });
  el('l3d-nick-btn').addEventListener('click', askNick);
  function applyMe(me) {   // 관람자: 설정 버튼·질문하기를 숨긴다 (서버도 막음)
    var first = !ME;
    ME = me || null;
    var viewer = ME && ME.role === 'viewer';
    el('l3d-nick-btn').hidden = !viewer;
    if (viewer && first) askNick();   // 손님 계정으로 들어오면 먼저 이름부터
    ['l3d-set-btn'].forEach(function (id) { el(id).hidden = viewer; });
    if (viewer) ['l3d-set', 'l3d-ai', 'l3d-ppl', 'l3d-out', 'l3d-mdl', 'l3d-staff'].forEach(function (id) { el(id).classList.remove('on'); });
  }

  // ── 1층 입구 오른쪽: 브런치 연재 낭독 코너 (요일별 브런치북 연재 → 골라서 소리 내어 읽기) ──
  // 낭독대·낭독가·안내 화면(오늘 새 글)을 두고, 누르면 목록 → 글 → 듣기(브라우저 음성 또는 서버 Edge 음성).
  // 소리는 고른 사람의 화면에서만 난다. 낭독가 머리 위 말풍선에 지금 읽는 문장이 뜬다.
  var BRUNCH_ON = false, brunchHits = [], brunchScreen = null, narrator = null, brunchToday = null, brunchTodayAt = 0;
  var BR_DAYS = [['MONDAY', '월'], ['TUESDAY', '화'], ['WEDNESDAY', '수'], ['THURSDAY', '목'], ['FRIDAY', '금'], ['SATURDAY', '토'], ['SUNDAY', '일'], ['COMPLETE', '완결']];
  function brDayKo(k) { var d = BR_DAYS.filter(function (x) { return x[0] === k; })[0]; return d ? d[1] : ''; }
  function addBrunchCorner(floorIdx) {
    brunchScreen = null; narrator = null; brunchSpot = null;   // 누르는 대상 목록(brunchHits)은 buildFloor가 층을 짓기 전에 비운다 (청음실 것이 지워지지 않게)
    if (!BRUNCH_ON || !layout || floorIdx !== 0) return;   // 1층에만
    var L = layout, cx = Math.min(9.5, L.w / 2 - 6), f = L.front;
    var g = new T.Group(); g.position.set(cx, 0, 0); parent.add(g);
    // 둥근 러그 + 낭독대 + 스탠드 조명
    var rug = new T.Mesh(new T.CircleGeometry(2.3, 48), new T.MeshStandardMaterial({ color: 0x7a4b3a, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, f - 2.6); rug.receiveShadow = true; g.add(rug);
    var lect = new T.Group(); lect.position.set(0, 0, f - 1.75); g.add(lect);
    var post = new T.Mesh(unitBox, M.oak); post.scale.set(0.5, 1.05, 0.36); post.position.y = 0.52; lect.add(post);
    var top = new T.Mesh(unitBox, M.oak); top.scale.set(0.7, 0.05, 0.48); top.position.set(0, 1.12, -0.04); top.rotation.x = -0.32; lect.add(top);
    var open = new T.Mesh(new T.PlaneGeometry(0.46, 0.3), new T.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.9 }));
    open.position.set(0, 1.155, -0.05); open.rotation.x = -Math.PI / 2 + 0.32 + Math.PI; open.rotation.z = Math.PI; lect.add(open);
    [post, top].forEach(function (m) { m.castShadow = true; m.userData.brunch = true; brunchHits.push(m); });
    var lampPole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.6, 8), M.black); lampPole.position.set(1.0, 0.8, f - 1.3); g.add(lampPole);
    var lampShade = new T.Mesh(new T.CylinderGeometry(0.12, 0.22, 0.22, 20, 1, true), M.lamp); lampShade.position.set(1.0, 1.65, f - 1.3); g.add(lampShade);
    // 듣는 의자 두 개 (낭독대를 보게)
    [-0.9, 0.9].forEach(function (ox) {
      var ch = new T.Group(); ch.position.set(ox, 0, f - 3.7); ch.rotation.y = ox < 0 ? 0.25 : -0.25; g.add(ch);   // 등받이는 로비 쪽, 앉으면 낭독대를 본다
      var seat = new T.Mesh(unitBox, new T.MeshStandardMaterial({ color: 0x31574d, roughness: 0.8 })); seat.scale.set(0.7, 0.18, 0.62); seat.position.y = 0.42; ch.add(seat);
      var back = new T.Mesh(unitBox, seat.material); back.scale.set(0.7, 0.6, 0.14); back.position.set(0, 0.75, -0.28); ch.add(back);
      [-0.3, 0.3].forEach(function (ax) { var arm = new T.Mesh(unitBox, seat.material); arm.scale.set(0.1, 0.22, 0.6); arm.position.set(ax, 0.58, 0); ch.add(arm); });
      var leg = new T.Mesh(unitBox, M.black); leg.scale.set(0.6, 0.33, 0.5); leg.position.y = 0.17; ch.add(leg);
      ch.traverse(function (m) { if (m.isMesh) m.castShadow = true; });
      addSeat(cx + ox, f - 3.7, ox < 0 ? 0.25 : -0.25, 0.51, { brunch: true });   // 앉으면 낭독 패널을 연다
    });
    // 천장에 매단 간판 (양면)
    var signTex = textTex(['브런치 연재 낭독'], 1024, 200, '#f5f2ec', '#1d1e20', 104);
    var signMat = new T.MeshBasicMaterial({ map: signTex, toneMapped: false });
    var sign = new T.Mesh(new T.BoxGeometry(3.0, 0.58, 0.04), [M.black, M.black, M.black, M.black, signMat, signMat]);
    sign.position.set(0, 3.3, f - 2.6); g.add(sign);
    [-1.3, 1.3].forEach(function (sx) { var c = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 3.59, 6), M.black); c.position.set(sx, (CEIL + 3.59) / 2, f - 2.6); g.add(c); });
    // 안내 화면 (오늘 새 글) - 로비 쪽을 보게
    var sx0 = 2.5, sz0 = f - 2.9;
    var sg = new T.Group(); sg.position.set(sx0, 0, sz0); sg.rotation.y = Math.atan2(2 - (cx + sx0), (f - 7) - sz0); g.add(sg);
    var leg2 = new T.Mesh(unitBox, M.black); leg2.scale.set(0.08, 0.7, 0.08); leg2.position.y = 0.35; sg.add(leg2);
    var foot = new T.Mesh(unitBox, M.black); foot.scale.set(0.6, 0.04, 0.36); foot.position.y = 0.02; sg.add(foot);
    var frame = new T.Mesh(unitBox, M.black); frame.scale.set(1.2, 1.56, 0.06); frame.position.set(0, 1.45, -0.02); sg.add(frame);
    var scr = new T.Mesh(new T.PlaneGeometry(1.12, 1.48), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    scr.position.set(0, 1.45, 0.015); sg.add(scr);
    [scr, frame].forEach(function (m) { m.userData.brunch = true; brunchHits.push(m); });
    brunchScreen = scr;
    // 낭독가 (낭독대 뒤에서 앞을 보고) - 여자 엘프
    brunchSpot = { x: cx, z: f - 1.15, group: parent };
    placeNarrator();
    drawBrunchScreen();
    loadBrunchToday();
  }
  var brunchSpot = null;
  function placeNarrator() {   // 엘프 모형(뼈대 → 걷기·서 있기 동작)이 늦게 받아지면 respawn에서 다시 세운다
    if (!brunchSpot || !brunchSpot.group || brunchSpot.group !== floorGroup) return;
    var say = narrator && narrator.lastSay || '';
    if (narrator) { if (narrator.g.parent) narrator.g.parent.remove(narrator.g); disposeGroup(narrator.g); narrator = null; }
    if (HUMAN.elfRig && HUMAN.gltf) narrator = elfWalker(rnd(7171));
    else if (HUMAN.elf) narrator = elfStatue();
    else narrator = makePerson(7171);   // 엘프를 아직 못 받았으면 잠시 사람 모형으로
    narrator.kind = 'agent'; narrator.walkW = 0; narrator.tag = null;
    narrator.g.position.set(brunchSpot.x, 0, brunchSpot.z); narrator.g.rotation.y = Math.PI;
    narrator.tx = brunchSpot.x; narrator.tz = brunchSpot.z; narrator.face = Math.PI;
    brunchSpot.group.add(narrator.g); dimEnv(narrator.g);
    if (narrator.mixer) setLook(narrator, 'calm');
    setNarrator(say);
  }
  function setNarrator(msg) {
    if (!narrator) return;
    if (narrator.tag) { narrator.g.remove(narrator.tag); narrator.tag.material.map.dispose(); narrator.tag.material.dispose(); }
    narrator.lastSay = msg;
    narrator.tag = nameTag('엘프 낭독가 · 브런치 연재', msg, '#c9a7ff');
    narrator.tag.position.y = (narrator.isElf ? 1.95 : 2.15) + (msg ? 0.2 : 0); narrator.g.add(narrator.tag);
  }
  function loadBrunchToday() {
    if (Date.now() - brunchTodayAt < 10 * 60 * 1000 && brunchToday) { drawBrunchScreen(); return; }
    brunchTodayAt = Date.now();
    api('api/lib3d/brunch/today').then(function (d) { brunchToday = d; drawBrunchScreen(); })
      .catch(function (e) { brunchToday = { error: e.message }; drawBrunchScreen(); });
  }
  function drawBrunchScreen() {
    if (!brunchScreen) return;
    var d = brunchToday, now = brTts.playing || brTts.idx > 0 ? brArt : null;
    var tex = canvasTex(560, 740, function (g, w, h) {
      g.fillStyle = '#fbf8f2'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d1e20'; g.fillRect(0, 0, w, 96);
      g.fillStyle = '#f5f2ec'; g.font = '700 38px ' + FONT; g.textBaseline = 'middle'; g.fillText('브런치 연재 낭독', 30, 50);
      g.textBaseline = 'top'; var y = 116;
      if (now) {
        g.fillStyle = '#7b4bd1'; g.font = '700 26px ' + FONT; g.fillText('지금 낭독 중', 30, y); y += 38;
        g.fillStyle = '#1d1e20'; g.font = '700 30px ' + FONT;
        wrapText(g, now.title || '', 30, y, w - 60, 40, 2).forEach(function () { y += 40; });
        g.fillStyle = '#6b6862'; g.font = '400 24px ' + FONT; g.fillText((now.book_title || '') + ' · ' + (now.author || ''), 30, y + 4, w - 60); y += 52;
        g.fillStyle = '#e6e1d8'; g.fillRect(30, y, w - 60, 2); y += 18;
      }
      if (!d) { g.fillStyle = '#6b6862'; g.font = '400 26px ' + FONT; g.fillText('오늘의 연재를 불러오는 중...', 30, y); return; }
      if (d.error) { g.fillStyle = '#b3261e'; g.font = '400 24px ' + FONT; wrapText(g, d.error, 30, y, w - 60, 32, 4); return; }
      g.fillStyle = '#1d1e20'; g.font = '700 30px ' + FONT;
      g.fillText('오늘(' + brDayKo(d.day) + ') 새 글 ' + d.fresh + '편', 30, y); y += 50;
      (d.items || []).slice(0, now ? 3 : 6).forEach(function (it) {
        var x = 30;
        if (it.fresh) { g.fillStyle = '#e85d04'; g.fillRect(x, y + 4, 58, 28); g.fillStyle = '#fff'; g.font = '700 20px ' + FONT; g.fillText('NEW', x + 6, y + 7); x += 70; }
        g.fillStyle = '#1d1e20'; g.font = '700 25px ' + FONT; g.fillText(it.title, x, y + 4, w - x - 30); y += 36;
        g.fillStyle = '#6b6862'; g.font = '400 21px ' + FONT; g.fillText(it.book_title + ' · ' + it.author, 30, y, w - 60); y += 40;
      });
      g.fillStyle = '#7b4bd1'; g.font = '700 24px ' + FONT; g.fillText('눌러서 골라 들어 보세요 ▶', 30, h - 54);
    });
    var m = brunchScreen.material; if (m.map) m.map.dispose(); m.map = tex; m.needsUpdate = true;
  }

  // 패널: 요일 탭 → 목록 → 글 (+ 듣기)
  var brBox = el('l3d-brunch'), brDay = null, brNext = '', brCounts = {}, brArt = null, brSeq = 0;
  function openBrunch() {
    [setBox, aiBox, pplBox, outBox, mdlBox, staffBox].forEach(function (b) { if (b) b.classList.remove('on'); });
    brBox.classList.add('on');
    brLoadVoices();
    if (!brDay) { brDay = brunchToday && brunchToday.day || BR_DAYS[(new Date().getDay() + 6) % 7][0]; brList(); }
  }
  function brTabs() {
    var t = el('l3d-br-days'); t.textContent = '';
    BR_DAYS.forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.className = d[0] === brDay ? 'on' : '';
      b.textContent = d[1];
      if (brCounts[d[0]]) { var n = document.createElement('span'); n.className = 'n'; n.textContent = brCounts[d[0]]; b.appendChild(n); }
      b.addEventListener('click', function () { brDay = d[0]; brList(); });
      t.appendChild(b);
    });
  }
  function brShow(id, on) { el(id).hidden = false; el(id).style.display = on ? '' : 'none'; }   // 버튼·줄의 CSS display가 hidden을 덮어써서
  function brShowList(on) {
    brShow('l3d-br-days', on); brShow('l3d-br-tts', !on);
    brShow('l3d-br-back', !on); brShow('l3d-br-orig', !on); if (!on) brShow('l3d-br-more', false);
  }
  function brList(append) {
    var seq = ++brSeq, body = el('l3d-br-body');
    brShowList(true); brTabs();
    if (!append) { body.textContent = '불러오는 중...'; brNext = ''; }
    var url = 'api/lib3d/brunch/list?day=' + encodeURIComponent(brDay) + (append && brNext ? '&next=' + encodeURIComponent(brNext) : '');
    api(url).then(function (d) {
      if (seq !== brSeq) return;
      if (!append) { body.textContent = ''; brCounts[brDay] = d.items.filter(function (x) { return x.fresh; }).length; brTabs(); }
      d.items.forEach(function (it) {
        var r = document.createElement('div'); r.className = 'it';
        var img = document.createElement('img'); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.alt = '';
        if (it.image) img.src = it.image; else img.style.visibility = 'hidden';
        var tx = document.createElement('div');
        var b = document.createElement('b');
        if (it.fresh) { var nw = document.createElement('span'); nw.className = 'new'; nw.textContent = 'NEW'; b.appendChild(nw); }
        b.appendChild(document.createTextNode(it.title || '(제목 없음)'));
        var s1 = document.createElement('small'); s1.textContent = it.book_title + ' · ' + it.author + (it.publish_time ? ' · ' + brWhen(it.publish_time) : '');
        var s2 = document.createElement('small'); s2.textContent = (it.summary || '').slice(0, 80);
        tx.appendChild(b); tx.appendChild(s1); if (it.summary) tx.appendChild(s2);
        r.appendChild(img); r.appendChild(tx);
        r.addEventListener('click', function () { brOpen(it.user_id, it.article_no); });
        body.appendChild(r);
      });
      if (!d.items.length && !append) body.textContent = '이 요일에는 연재가 없습니다.';
      brNext = d.more ? d.next_url : '';
      brShow('l3d-br-more', !!brNext);
    }).catch(function (e) { if (seq === brSeq) { body.textContent = ''; var p = document.createElement('p'); p.className = 'err'; p.textContent = e.message; body.appendChild(p); } });
  }
  function brWhen(ms) {
    var d = (Date.now() - ms) / 60000;
    if (d < 60) return Math.max(1, Math.round(d)) + '분 전';
    if (d < 1440) return Math.round(d / 60) + '시간 전';
    var t = new Date(ms); return (t.getMonth() + 1) + '.' + t.getDate();
  }
  function brOpen(uid, no, autoplay) {
    var seq = ++brSeq, body = el('l3d-br-body');
    brStop(); brShowList(false); body.textContent = '글을 불러오는 중...';
    api('api/lib3d/brunch/article?u=' + encodeURIComponent(uid) + '&n=' + encodeURIComponent(no)).then(function (a) {
      if (seq !== brSeq) return;
      brArt = a; body.textContent = ''; body.scrollTop = 0;
      var art = document.createElement('div'); art.className = 'art';
      var h = document.createElement('h4'); h.textContent = a.title; art.appendChild(h);
      var m = document.createElement('div'); m.className = 'meta';
      m.textContent = [a.book_title, a.author, a.publish_time ? new Date(a.publish_time).toLocaleDateString() : ''].filter(Boolean).join(' · ');
      art.appendChild(m);
      if (a.restricted) { var w = document.createElement('p'); w.className = 'err'; w.textContent = '멤버십 글이라 앞부분만 있습니다. 전체는 브런치 원문에서 보세요.'; art.appendChild(w); }
      var txt = document.createElement('div'); txt.className = 'txt';
      txt.innerHTML = a.body;   // 서버가 허용한 태그·주소만 남긴 본문 (lib3d_brunch.sanitize)
      art.appendChild(txt);
      var eps = a.episodes || [], ci = -1;
      eps.forEach(function (e, i) { if (e.current || Number(e.article_no) === Number(no)) ci = i; });
      brArt.prev = ci > 0 && eps[ci - 1].article_no ? eps[ci - 1] : null;
      brArt.next = ci >= 0 && eps[ci + 1] && eps[ci + 1].article_no ? eps[ci + 1] : null;
      var nav = document.createElement('div'); nav.className = 'eps';
      [[brArt.prev, '← 이전 화'], [brArt.next, '다음 화 →']].forEach(function (x) {
        if (!x[0]) return;
        var b = document.createElement('button'); b.type = 'button'; b.className = 'l3d-btn'; b.textContent = x[1] + ' ' + (x[0].title || '');
        b.addEventListener('click', function () { brOpen(x[0].user_id, x[0].article_no); });
        nav.appendChild(b);
      });
      art.appendChild(nav);
      body.appendChild(art);
      el('l3d-br-orig').href = a.url;
      brTtsUi();
      drawBrunchScreen();
      if (autoplay) brPlay(0);
    }).catch(function (e) { if (seq === brSeq) { body.textContent = ''; var p = document.createElement('p'); p.className = 'err'; p.textContent = e.message; body.appendChild(p); } });
  }

  // 듣기: 문단을 문장 조각(최대 약 180자)으로 나눠 하나씩. 'b:이름' 브라우저 음성 / 'e:ID' 서버 Edge 음성(mp3, 다음 두 문장 미리 받음)
  var synth = window.speechSynthesis || null, hasSynth = !!(synth && typeof SpeechSynthesisUtterance !== 'undefined');
  var brTts = { chunks: [], idx: 0, playing: false, gen: 0, cur: null, audio: new Audio(), fetches: {}, server: [], serverNote: '', cfg: {} };
  try { brTts.cfg = JSON.parse(localStorage.getItem('l3d_brunch_tts') || '{}') || {}; } catch (e) { brTts.cfg = {}; }
  function brSave() { try { localStorage.setItem('l3d_brunch_tts', JSON.stringify(brTts.cfg)); } catch (e) { /* 저장 못 해도 됨 */ } }
  function brSplit(text) {
    var out = [], buf = '';
    (String(text).replace(/\s+/g, ' ').trim().match(/[^.!?。…~”"’]+[.!?。…~”"’]*/g) || []).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (s) {
      while (s.length > 180) { var cut = s.lastIndexOf(' ', 180); if (cut < 60) cut = 180; if (buf) { out.push(buf); buf = ''; } out.push(s.slice(0, cut)); s = s.slice(cut).trim(); }
      if (buf && (buf + ' ' + s).length > 180) { out.push(buf); buf = ''; }
      buf = buf ? buf + ' ' + s : s;
    });
    if (buf) out.push(buf);
    return out.filter(function (t) { return /[0-9A-Za-z가-힣]/.test(t); });
  }
  function brChunks() {
    var out = [], art = brBox.querySelector('.art'); if (!art) return out;
    var h = art.querySelector('h4');
    brSplit(h.textContent + '.').forEach(function (s) { out.push({ el: h, text: s }); });
    Array.prototype.forEach.call(art.querySelector('.txt').children, function (e) {
      brSplit(e.innerText || e.textContent || '').forEach(function (s) { out.push({ el: e, text: s }); });
    });
    return out;
  }
  function brKoVoices() { var all = hasSynth ? synth.getVoices() : []; var ko = all.filter(function (v) { return /^ko/i.test(v.lang); }); return ko.length ? ko : all; }
  function brFillVoices() {
    var sel = el('l3d-br-voice'); sel.textContent = '';
    function group(label, list) {
      var og = document.createElement('optgroup'); og.label = label;
      list.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; op.disabled = !!o[2]; og.appendChild(op); });
      sel.appendChild(og);
    }
    var bv = brKoVoices().map(function (v) { return ['b:' + v.name, brVoiceLabel(v)]; });
    if (bv.length) group('브라우저 음성', bv);
    if (brTts.server.length) group('Edge 음성 (서버)', brTts.server.map(function (v) { return ['e:' + v.id, v.name]; }));
    else if (brTts.serverNote) group('Edge 음성 (서버)', [['', brTts.serverNote, true]]);
    var vals = Array.prototype.filter.call(sel.options, function (o) { return !o.disabled; }).map(function (o) { return o.value; });
    sel.value = brTts.cfg.voice && vals.indexOf(brTts.cfg.voice) >= 0 ? brTts.cfg.voice : (vals.filter(function (v) { return v.indexOf('e:ko-KR-SunHi') === 0; })[0] || vals[0] || '');
    el('l3d-br-play').disabled = !vals.length;
  }
  // 브라우저 음성 이름은 제각각이다: 크롬 "Google 한국의", 엣지 "Microsoft SunHi Online (Natural) - Korean (Korea)",
  // 윈도우 "Microsoft Heami - Korean (Korean)", 애플 "Yuna". 알아보기 쉽게 바꾼다.
  function brVoiceLabel(v) {
    var n = String(v.name || '').trim();
    if (/^Google\s*한국의$/i.test(n) || /^Google\s*(Korean|한국어)$/i.test(n)) n = 'Google 한국어 (여성)';
    n = n.replace(/\s*[-–]\s*(Korean|한국어).*$/i, '').replace(/\s+Online \(Natural\)/i, ' (자연스러운 음성)');
    n = n.replace(/^Microsoft\s+/i, 'MS ').replace(/^Yuna$/i, 'Yuna (애플)');
    if (!/^ko/i.test(v.lang || '')) n += ' (' + v.lang + ')';
    if (v.localService === false && !/Google/i.test(n)) n += ' · 온라인';
    return n || v.lang || '기본 음성';
  }
  function brVoice() { return el('l3d-br-voice').value || ''; }
  function brRate() { return parseFloat(el('l3d-br-rate').value) || 1; }
  function brMark(e) {
    if (brTts.cur === e) return;
    if (brTts.cur) brTts.cur.classList.remove('tts-on');
    brTts.cur = e; if (!e) return;
    e.classList.add('tts-on');
    var box = el('l3d-br-body'), r = e.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (r.top < br.top + 20 || r.bottom > br.bottom - 20) box.scrollTop += r.top - br.top - box.clientHeight / 3;
  }
  function brTtsUi(note) {
    var paused = !brTts.playing && brTts.chunks.length && brTts.idx > 0;
    el('l3d-br-play').textContent = brTts.playing ? '❚❚ 일시정지' : paused ? '▶ 이어 듣기' : '▶ 낭독';
    var pos = el('l3d-br-pos'); pos.className = note ? 'pos err' : 'pos';
    pos.textContent = note || (brTts.chunks.length && (brTts.playing || paused) ? Math.min(brTts.idx + 1, brTts.chunks.length) + ' / ' + brTts.chunks.length : '');
  }
  function brFetch(i) {
    var c = brTts.chunks[i]; if (!c) return null;
    var key = brVoice() + '|' + i;
    if (!brTts.fetches[key]) {
      brTts.fetches[key] = fetch('api/lib3d/brunch/tts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: brVoice().slice(2), text: c.text }) }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || '음성을 만들지 못했습니다'); });
        return r.blob();
      }).then(function (b) { return URL.createObjectURL(b); });
      brTts.fetches[key].catch(function () { delete brTts.fetches[key]; });
    }
    return brTts.fetches[key];
  }
  function brDone(gen) { if (gen !== brTts.gen || !brTts.playing) return; brTts.idx++; brSpeak(); }
  function brSpeak() {
    if (brTts.idx >= brTts.chunks.length) {
      var nx = brTts.cfg.autoNext && brArt && brArt.next;
      brStop();
      if (nx) brOpen(nx.user_id, nx.article_no, true);
      return;
    }
    var c = brTts.chunks[brTts.idx], gen = brTts.gen;
    brMark(c.el); brTtsUi(); setNarrator(c.text);
    if (brVoice().indexOf('e:') === 0) {
      brFetch(brTts.idx + 1); brFetch(brTts.idx + 2);
      brFetch(brTts.idx).then(function (url) {
        if (gen !== brTts.gen || !brTts.playing) return;
        var a = brTts.audio; a.onended = function () { brDone(gen); }; a.src = url; a.playbackRate = brRate();
        var p = a.play(); if (p && p.catch) p.catch(function () { if (gen === brTts.gen) { brTts.playing = false; brTtsUi('재생하지 못했습니다. ▶를 다시 눌러 주세요.'); } });
      }, function (e) { if (gen === brTts.gen) { brTts.playing = false; brTtsUi(e.message); } });
    } else if (hasSynth) {
      var u = new SpeechSynthesisUtterance(c.text), name = brVoice().slice(2);
      u.lang = 'ko-KR';
      var v = brKoVoices().filter(function (x) { return x.name === name; })[0]; if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = brRate();
      u.onend = function () { brDone(gen); };
      u.onerror = function (e) { if (e.error !== 'interrupted' && e.error !== 'canceled') brDone(gen); };
      brTts.utter = u; synth.speak(u);
    } else { brTts.playing = false; brTtsUi('이 브라우저는 음성 읽기를 지원하지 않습니다.'); }
  }
  function brSilence() { if (hasSynth) synth.cancel(); brTts.audio.onended = null; brTts.audio.pause(); }
  function brPlay(from) {
    if (!brTts.chunks.length || from === 0) { brTts.chunks = brChunks(); brTts.fetches = {}; }
    if (!brTts.chunks.length) { brTtsUi('읽을 글이 없습니다'); return; }
    if (typeof from === 'number') brTts.idx = from;
    if (brTts.idx >= brTts.chunks.length) brTts.idx = 0;
    brTts.gen++; brSilence(); brTts.playing = true; brSpeak(); drawBrunchScreen();
  }
  function brPause() { brTts.gen++; brTts.playing = false; brSilence(); brTtsUi(); }
  function brStop() {
    var was = brTts.playing || brTts.idx > 0;
    brTts.gen++; brTts.playing = false; brTts.chunks = []; brTts.idx = 0; brTts.fetches = {};
    brSilence(); brMark(null); brTtsUi(); setNarrator('');
    if (was) drawBrunchScreen();
  }
  el('l3d-br-play').addEventListener('click', function () { if (brTts.playing) brPause(); else brPlay(); });
  el('l3d-br-stop').addEventListener('click', brStop);
  el('l3d-br-rate').value = String(brTts.cfg.rate || '1');
  el('l3d-br-rate').addEventListener('change', function () {
    brTts.cfg.rate = el('l3d-br-rate').value; brSave();
    if (brTts.playing) { if (brVoice().indexOf('e:') === 0) brTts.audio.playbackRate = brRate(); else brPlay(brTts.idx); }
  });
  el('l3d-br-voice').addEventListener('change', function () { brTts.cfg.voice = brVoice(); brSave(); brTts.fetches = {}; if (brTts.playing) brPlay(brTts.idx); });
  el('l3d-br-next').checked = !!brTts.cfg.autoNext;
  el('l3d-br-next').addEventListener('change', function () { brTts.cfg.autoNext = el('l3d-br-next').checked; brSave(); });
  el('l3d-br-body').addEventListener('click', function (ev) {   // 듣는 중에 문단을 누르면 거기서부터
    if (!brTts.chunks.length || (ev.target.closest && ev.target.closest('a, button'))) return;
    for (var i = 0; i < brTts.chunks.length; i++) if (brTts.chunks[i].el === ev.target || brTts.chunks[i].el.contains(ev.target)) { brPlay(i); return; }
  });
  el('l3d-br-back').addEventListener('click', function () { brList(); });
  el('l3d-br-more').addEventListener('click', function () { brList(true); });
  el('l3d-br-close').addEventListener('click', function () { brBox.classList.remove('on'); });   // 닫아도 듣기는 계속 (■로 멈춤)
  brFillVoices();
  if (hasSynth && synth.addEventListener) synth.addEventListener('voiceschanged', brFillVoices);
  function brLoadVoices() {
    if (brLoadVoices.done) return; brLoadVoices.done = true;
    api('api/lib3d/brunch/voices').then(function (d) { brTts.server = d.voices || []; brTts.serverNote = d.available ? '' : (d.reason || ''); brFillVoices(); }).catch(function () {});
  }

  // ── 3층 오디오북·4층 영상: 서재 안에서 듣기·보기 (트랙 목록, 이어 듣기, 속도) + 들으며 걷는 작은 재생 막대 ──
  var MED = { el: null, info: null, track: 0, series: '', title: '', saveAt: 0, video: false };
  var medBox = el('l3d-r-media'), mini = el('l3d-mini');
  function isMedia(info) { return info && (info.kind === 'audio' || info.kind === 'video'); }
  function mediaSrc(info, i) { return 'api/lib3d/media?b=' + encodeURIComponent(info.key) + '&i=' + i; }
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + x).slice(-2); }
  function mediaStop() {
    if (MED.el) { MED.el.pause(); MED.el.removeAttribute('src'); try { MED.el.load(); } catch (e) { /* 없어도 됨 */ } if (MED.el.parentNode) MED.el.parentNode.removeChild(MED.el); }
    MED.el = null; MED.info = null; mini.hidden = true;
  }
  function mediaSave() {
    if (!MED.el || !MED.info) return;
    try { localStorage.setItem(ukey('l3d_read_' + MED.series), JSON.stringify({ key: MED.info.key, page: { t: MED.track, s: Math.floor(MED.el.currentTime || 0) } })); } catch (e) { /* 무시 */ }
  }
  function showMedia(info, at) {
    showStage(false); R.body.hidden = true; medBox.hidden = false; medBox.textContent = '';
    R.pos.textContent = ''; note('');
    var video = info.kind === 'video';
    if (MED.el && (MED.info && MED.info.key !== info.key || MED.video !== video)) mediaStop();   // 다른 작품이면 앞의 소리를 끈다
    var same = MED.el && MED.info && MED.info.key === info.key;
    MED.info = info; MED.series = R.series; MED.title = R.list[R.vi] ? R.list[R.vi].title : info.title; MED.video = video;
    var wrapM = document.createElement('div'); wrapM.className = 'm-wrap' + (video ? ' v' : '');
    var left = document.createElement('div'); left.className = 'm-main';
    if (!video) {
      var cov = document.createElement('img'); cov.className = 'm-cover'; cov.alt = '';
      cov.src = 'api/lib3d/cover?k=' + encodeURIComponent(R.series); cov.onerror = function () { cov.style.visibility = 'hidden'; };
      left.appendChild(cov);
    }
    if (!same) {
      MED.el = document.createElement(video ? 'video' : 'audio');
      MED.el.controls = true; MED.el.preload = 'metadata'; MED.el.setAttribute('playsinline', '');
      MED.el.addEventListener('ended', function () { if (MED.info && MED.track + 1 < MED.info.count) mediaPlay(MED.track + 1, 0); else mediaSave(); });
      MED.el.addEventListener('timeupdate', function () {
        if (Date.now() - MED.saveAt > 5000) { MED.saveAt = Date.now(); mediaSave(); }
        if (!mini.hidden) el('l3d-mini-time').textContent = fmtTime(MED.el.currentTime) + ' / ' + fmtTime(MED.el.duration);
      });
      MED.el.addEventListener('pause', function () { mediaSave(); el('l3d-mini-pp').textContent = '▶'; });
      MED.el.addEventListener('play', function () { el('l3d-mini-pp').textContent = '❚❚'; });
      MED.el.addEventListener('error', function () {
        note(video ? '이 영상은 브라우저에서 바로 재생할 수 없는 형식일 수 있습니다 (mkv·avi·HEVC 등). [BookOasis 뷰어]나 YMPlayer로 보세요.' : '이 파일을 재생하지 못했습니다.');
      });
    }
    MED.el.className = video ? 'm-video' : 'm-audio';
    left.appendChild(MED.el);
    var bar = document.createElement('div'); bar.className = 'm-bar';
    [['⏮ 이전', function () { mediaPlay(MED.track - 1, 0); }], ['-15초', function () { MED.el.currentTime = Math.max(0, MED.el.currentTime - 15); }],
     ['+30초', function () { MED.el.currentTime = MED.el.currentTime + 30; }], ['다음 ⏭', function () { mediaPlay(MED.track + 1, 0); }]].forEach(function (x) {
      var bt = document.createElement('button'); bt.type = 'button'; bt.className = 'l3d-btn'; bt.textContent = x[0]; bt.addEventListener('click', x[1]); bar.appendChild(bt);
    });
    var sp = document.createElement('select'); sp.title = '속도';
    ['0.8', '1', '1.2', '1.5', '1.75', '2'].forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v + 'x'; sp.appendChild(o); });
    try { sp.value = localStorage.getItem('l3d_media_rate') || '1'; } catch (e) { sp.value = '1'; }
    sp.addEventListener('change', function () { MED.el.playbackRate = parseFloat(sp.value) || 1; try { localStorage.setItem('l3d_media_rate', sp.value); } catch (e) { /* 무시 */ } });
    bar.appendChild(sp);
    left.appendChild(bar);
    var list = document.createElement('div'); list.className = 'm-list';
    (info.tracks || []).forEach(function (t) {
      var r = document.createElement('button'); r.type = 'button'; r.dataset.i = t.i;
      r.textContent = (t.i + 1) + '. ' + t.name; if (t.dir) r.title = t.dir;
      r.addEventListener('click', function () { mediaPlay(t.i, 0); });
      list.appendChild(r);
    });
    wrapM.appendChild(left); wrapM.appendChild(list); medBox.appendChild(wrapM);
    if (!info.count) { note('재생할 파일이 없습니다.'); return; }
    MED.el.playbackRate = parseFloat(sp.value) || 1;
    if (same) { markTrack(); return; }
    var t0 = at && typeof at === 'object' ? Math.min(at.t || 0, info.count - 1) : 0;
    mediaPlay(t0, at && typeof at === 'object' ? at.s || 0 : 0, true);
  }
  function markTrack() {
    Array.prototype.forEach.call(medBox.querySelectorAll('.m-list button'), function (b) {
      var on = Number(b.dataset.i) === MED.track; b.classList.toggle('on', on);
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
    R.pos.textContent = (MED.track + 1) + ' / ' + (MED.info ? MED.info.count : 0);
    el('l3d-mini-t').textContent = MED.title + ' · ' + (MED.track + 1) + '/' + (MED.info ? MED.info.count : 0);
  }
  function mediaPlay(i, seek, first) {
    if (!MED.info || i < 0 || i >= MED.info.count) return;
    MED.track = i;
    MED.el.src = mediaSrc(MED.info, i);
    var rate = MED.el.playbackRate;
    MED.el.addEventListener('loadedmetadata', function once() {
      MED.el.removeEventListener('loadedmetadata', once);
      if (seek) { try { MED.el.currentTime = seek; } catch (e) { /* 처음부터 */ } }
      MED.el.playbackRate = rate;
    });
    var p = MED.el.play(); if (p && p.catch) p.catch(function () { if (first) note('▶를 누르면 재생합니다.'); });
    markTrack(); mediaSave();
  }
  function mediaOnClose() {   // 읽기 화면을 닫을 때: 영상은 멈추고, 오디오는 듣던 중이면 작은 막대로 계속
    if (!MED.el) return;
    if (MED.video || MED.el.paused) { mediaSave(); mediaStop(); return; }
    el('l3d-mini-hold').appendChild(MED.el);   // 화면에서만 옮겨 두고 소리는 계속 (문서에서 빼면 브라우저가 멈춘다)
    mini.hidden = false; markTrack();
  }
  el('l3d-mini-pp').addEventListener('click', function () { if (!MED.el) return; if (MED.el.paused) MED.el.play(); else MED.el.pause(); });
  el('l3d-mini-x').addEventListener('click', function () { mediaSave(); mediaStop(); });
  el('l3d-mini-open').addEventListener('click', function () {
    if (!MED.info) return;
    mini.hidden = true;
    openReader({ key: MED.series, title: MED.title });
  });

  // 3층·4층 입구 오른쪽: 청음 부스 / 시청 부스 (헤드폰 의자에 앉으면 이 층 작품 고르기)
  function addMediaBooth(fl) {
    if (!layout || (fl.key !== 'audiobook' && fl.key !== 'video')) return;
    var L = layout, cx = Math.min(9.5, L.w / 2 - 6), f = L.front, video = fl.key === 'video';
    var g = new T.Group(); g.position.set(cx, 0, 0); parent.add(g);
    var rug = new T.Mesh(new T.CircleGeometry(2.6, 48), new T.MeshStandardMaterial({ color: video ? 0x23324a : 0x3b2e4a, roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, f - 3); rug.receiveShadow = true; g.add(rug);
    var signTex = textTex([video ? '시청 부스' : '청음 부스'], 1024, 200, '#f5f2ec', '#1d1e20', 110);
    var signMat = new T.MeshBasicMaterial({ map: signTex, toneMapped: false });
    var sign = new T.Mesh(new T.BoxGeometry(2.6, 0.5, 0.04), [M.black, M.black, M.black, M.black, signMat, signMat]);
    sign.position.set(0, 3.3, f - 3); g.add(sign);
    [-1.1, 1.1].forEach(function (sx) { var c = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 3.55, 6), M.black); c.position.set(sx, (CEIL + 3.55) / 2, f - 3); g.add(c); });
    var seatMat = new T.MeshStandardMaterial({ color: video ? 0x8b2f3a : 0x4d3b6e, roughness: 0.8 });
    var phoneMat = new T.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.4, metalness: 0.3 });
    [[-1.6, 0.35], [-0.55, 0.12], [0.55, -0.12], [1.6, -0.35]].forEach(function (o, i) {
      var ox = o[0], rot = o[1];
      var ch = new T.Group(); ch.position.set(ox, 0, f - 3.6); ch.rotation.y = rot; g.add(ch);   // 앞(+z, 입구 쪽 벽)을 보고 앉는다
      var seat = new T.Mesh(unitBox, seatMat); seat.scale.set(0.72, 0.2, 0.66); seat.position.y = 0.42; ch.add(seat);
      var back = new T.Mesh(unitBox, seatMat); back.scale.set(0.72, 0.85, 0.16); back.position.set(0, 0.86, -0.3); back.rotation.x = -0.12; ch.add(back);
      [-0.32, 0.32].forEach(function (ax) { var arm = new T.Mesh(unitBox, seatMat); arm.scale.set(0.1, 0.24, 0.62); arm.position.set(ax, 0.6, 0); ch.add(arm); });
      var base = new T.Mesh(new T.CylinderGeometry(0.22, 0.28, 0.32, 16), M.black); base.position.y = 0.16; ch.add(base);
      var band = new T.Mesh(new T.TorusGeometry(0.11, 0.015, 8, 20, Math.PI), phoneMat); band.position.set(0, 1.38, -0.3); ch.add(band);   // 등받이에 걸린 헤드폰
      [-0.11, 0.11].forEach(function (ex) { var cup = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.04, 14), phoneMat); cup.rotation.z = Math.PI / 2; cup.position.set(ex, 1.36, -0.3); ch.add(cup); });
      ch.traverse(function (m) { if (m.isMesh) m.castShadow = true; });
      addSeat(cx + ox + Math.sin(rot) * 0.02, f - 3.6, rot, 0.52, { media: true });
      if (video) {   // 의자 앞 작은 화면
        var scr = new T.Mesh(new T.PlaneGeometry(0.62, 0.38), new T.MeshBasicMaterial({ color: [0x2d6a9f, 0x9f2d5a, 0x2d9f6a, 0x9f7a2d][i], toneMapped: false }));
        var stand = new T.Mesh(unitBox, M.black); stand.scale.set(0.05, 1.1, 0.05); stand.position.set(ox + Math.sin(rot) * 0.9, 0.55, f - 2.7); g.add(stand);
        scr.position.set(ox + Math.sin(rot) * 0.9, 1.2, f - 2.68); scr.rotation.y = Math.PI + rot; g.add(scr);
      }
    });
  }
  var mpBox = el('l3d-mpick'), mpLib = 0;
  function openMediaPick() {
    var fl = floors[cur]; if (!fl || !fl.libs.length) return;
    [setBox, aiBox, pplBox, outBox, mdlBox, staffBox, brBox].forEach(function (b) { if (b) b.classList.remove('on'); });
    el('l3d-mp-h').textContent = fl.key === 'video' ? '시청 부스 - 볼 작품 고르기' : '청음 부스 - 들을 작품 고르기';
    var tabs = el('l3d-mp-tabs'); tabs.textContent = '';
    if (mpLib >= fl.libs.length) mpLib = 0;
    fl.libs.forEach(function (lib, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = i === mpLib ? 'on' : ''; b.textContent = lib.name;
      b.addEventListener('click', function () { mpLib = i; openMediaPick(); });
      tabs.appendChild(b);
    });
    drawMediaPick();
    mpBox.classList.add('on');
  }
  function drawMediaPick() {
    var fl = floors[cur], lib = fl.libs[mpLib], q = (el('l3d-mp-q').value || '').trim().toLowerCase(), body = el('l3d-mp-body');
    body.textContent = '';
    lib.series.filter(function (s) { return s.last && (!q || String(s.title).toLowerCase().indexOf(q) >= 0); }).slice(0, 200).forEach(function (s) {
      var key = lib.db_type + ':' + s.last;
      var r = document.createElement('div'); r.className = 'it';
      var img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = 'api/lib3d/cover?k=' + encodeURIComponent(key);
      img.onerror = function () { img.style.visibility = 'hidden'; };
      var tx = document.createElement('div'); var b = document.createElement('b'); b.textContent = s.title || '(제목 없음)';
      var sm = document.createElement('small'); sm.textContent = lib.name + ' · ' + s.count + '개';
      tx.appendChild(b); tx.appendChild(sm); r.appendChild(img); r.appendChild(tx);
      r.addEventListener('click', function () { mpBox.classList.remove('on'); openReader({ key: key, title: s.title || '(제목 없음)' }); });
      body.appendChild(r);
    });
    if (!body.firstChild) body.textContent = '작품이 없습니다.';
  }
  el('l3d-mp-q').addEventListener('input', drawMediaPick);
  el('l3d-mp-close').addEventListener('click', function () { mpBox.classList.remove('on'); });

  // ── 영화관 층 (YMPlayer): 큰 스크린 + 좌석 여러 줄, 스크린을 누르거나 앉으면 YMPlayer를 띄운다 ──
  var YMPLAYER = '', YM_EMBED = 'auto', cineBox = el('l3d-cine');
  // 서재 안(iframe)에 띄울 수 있는지: https 화면에 http YMPlayer(혼합 콘텐츠)나, 다른 사이트(로그인 쿠키가 막힘)면 안 된다
  function siteOf(h) {
    if (/^[\d.]+$/.test(h) || h.indexOf(':') >= 0 || h.indexOf('.') < 0) return h;   // IP·localhost는 주소 그대로
    var p = h.split('.'), n = /^(co|or|go|ne|ac|re|pe|com|net|org)$/.test(p[p.length - 2]) && p.length > 2 ? 3 : 2;
    return p.slice(-n).join('.');
  }
  function ymWhyNoFrame() {
    if (YM_EMBED === 'frame') return '';
    if (YM_EMBED === 'tab') return '설정(LIB3D_YMPLAYER_EMBED=tab)에 따라 새 탭으로 엽니다.';
    var u; try { u = new URL(YMPLAYER); } catch (e) { return ''; }
    if (location.protocol === 'https:' && u.protocol === 'http:') return '이 화면은 https인데 YMPlayer 주소가 http라 브라우저가 서재 안에 띄우는 것을 막습니다.';
    if (siteOf(u.hostname) !== siteOf(location.hostname)) return '서재(' + location.hostname + ')와 YMPlayer(' + u.hostname + ')가 다른 사이트라 브라우저가 서재 안에서 YMPlayer 로그인을 막습니다.';
    return '';
  }
  function ymNewTab() { var w0 = window.open(YMPLAYER + '/', 'ymplayer'); if (w0) { try { w0.focus(); } catch (e) { /* 무시 */ } } return !!w0; }
  function addCinema() {
    var L = layout, w = L.w, f = L.front, b0 = L.back, tz0 = f - 16; CINE_WALL = tz0;   // 로비 뒤부터 안쪽 벽까지가 상영관
    var dark = new T.MeshStandardMaterial({ color: 0x1a1416, roughness: 0.95 });
    var carpet = new T.Mesh(new T.PlaneGeometry(w - 0.4, tz0 - b0), new T.MeshStandardMaterial({ color: 0x3a1418, roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, 0.011, (tz0 + b0) / 2); carpet.receiveShadow = true; parent.add(carpet);
    [-1, 1].forEach(function (sd) {   // 옆벽 커튼 (창을 가림)
      var cu = new T.Mesh(unitBox, dark); cu.scale.set(0.3, CEIL, tz0 - b0); cu.position.set(sd * (w / 2 - 0.3), CEIL / 2, (tz0 + b0) / 2); parent.add(cu);
    });
    var cub = new T.Mesh(unitBox, dark); cub.scale.set(w, CEIL, 0.3); cub.position.set(0, CEIL / 2, b0 + 0.3); parent.add(cub);
    // 상영관 입구 칸막이 (가운데 통로만 열림)
    var gapW = 6, pw = (w - gapW) / 2;
    [-1, 1].forEach(function (sd) { var pt = new T.Mesh(unitBox, dark); pt.scale.set(pw, CEIL, 0.25); pt.position.set(sd * (gapW / 2 + pw / 2), CEIL / 2, tz0); parent.add(pt); });
    var lintel = new T.Mesh(unitBox, dark); lintel.scale.set(gapW, CEIL - 3, 0.25); lintel.position.set(0, 3 + (CEIL - 3) / 2, tz0); parent.add(lintel);
    var inTex = textTex(['상영관 · YMPlayer'], 1024, 160, '#1d1e20', '#ffd166', 90);
    var inSign = new T.Mesh(new T.PlaneGeometry(4, 0.62), new T.MeshBasicMaterial({ map: inTex, toneMapped: false })); inSign.position.set(0, 3.5, tz0 + 0.14); parent.add(inSign);
    // 스크린
    var sw = Math.min(14, w - 6), sh = Math.min(CEIL - 1, sw * 9 / 21);
    var scrTex = canvasTex(1400, 600, function (g, cw, ch) {
      var grd = g.createLinearGradient(0, 0, 0, ch); grd.addColorStop(0, '#20263a'); grd.addColorStop(1, '#0c0e16');
      g.fillStyle = grd; g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#e5a00d'; g.font = '700 120px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('▶ YMPlayer', cw / 2, ch / 2 - 60);
      g.fillStyle = '#f5f2ec'; g.font = '400 46px ' + FONT; g.fillText('스크린을 누르거나 좌석에 앉으면 상영관이 열립니다', cw / 2, ch / 2 + 70);
      g.fillStyle = '#9aa0b0'; g.font = '400 34px ' + FONT; g.fillText('Plex · IPTV · 텔레그램 영상', cw / 2, ch / 2 + 140);
    });
    var scr = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
    scr.position.set(0, 0.6 + sh / 2, b0 + 0.5); scr.userData.cinema = true; parent.add(scr); brunchHits.push(scr);
    cineScreen = scr; cineIdle = scrTex;
    var frame = new T.Mesh(unitBox, M.black); frame.scale.set(sw + 0.3, sh + 0.3, 0.05); frame.position.set(0, 0.6 + sh / 2, b0 + 0.46); parent.add(frame);
    // 좌석: 스크린을 보고 여러 줄
    var seatMat = new T.MeshStandardMaterial({ color: 0x9b1d2a, roughness: 0.75 }), n = Math.max(6, Math.min(12, Math.floor((w - 8) / 0.78)));
    for (var row = 0; row < 6; row++) {
      var z = b0 + 7 + row * 1.35;
      if (z > tz0 - 1.5) break;
      for (var k = 0; k < n; k++) {
        var x = (k - (n - 1) / 2) * 0.78 + (k >= n / 2 ? 0.6 : -0.6);   // 가운데 통로
        var ch = new T.Group(); ch.position.set(x, 0, z); ch.rotation.y = Math.PI; parent.add(ch);
        var seat = new T.Mesh(unitBox, seatMat); seat.scale.set(0.62, 0.16, 0.58); seat.position.y = 0.44; ch.add(seat);
        var back = new T.Mesh(unitBox, seatMat); back.scale.set(0.62, 0.72, 0.12); back.position.set(0, 0.84, -0.28); ch.add(back);
        var leg = new T.Mesh(unitBox, M.black); leg.scale.set(0.5, 0.36, 0.4); leg.position.y = 0.18; ch.add(leg);
        addSeat(x, z, Math.PI, 0.52, { cinema: true });
      }
    }
  }
  function openCinema(gesture) {
    if (YMPROXY) { openCinemaPick(); return; }   // 서버 중계가 있으면 스크린에 직접 상영
    if (!YMPLAYER) return;
    var why = ymWhyNoFrame(), fr = el('l3d-cine-frame'), gate = el('l3d-cine-gate');
    el('l3d-cine-tab').href = YMPLAYER + '/';
    if (why && gesture && ymNewTab()) return;   // 스크린을 눌렀으면 바로 새 탭 (팝업 차단에 안 걸림)
    cineBox.classList.add('on'); wrap.classList.add('reading'); keys = {};
    fr.hidden = !!why; gate.hidden = !why;
    if (why) { el('l3d-cine-why').textContent = why; return; }   // 앉아서 연 경우: 큰 [상영 시작] 버튼으로 새 탭
    if (!fr.getAttribute('src')) fr.setAttribute('src', YMPLAYER + '/');
  }
  function closeCinema() {
    cineBox.classList.remove('on'); wrap.classList.remove('reading');
    el('l3d-cine-frame').removeAttribute('src');   // 닫으면 재생도 멈춘다
  }
  el('l3d-cine-close').addEventListener('click', closeCinema);
  el('l3d-cine-go').addEventListener('click', function () { if (ymNewTab()) closeCinema(); });

  // ── 영화관: YMPlayer IPTV·텔레그램을 서버 중계로 받아 3D 스크린에 직접 상영 ──
  // 고르기 창(소스 탭 → IPTV 채널 / 텔레그램 영상) → 숨은 <video>로 재생하고 그 화면을 스크린 텍스처로.
  // 엔진은 YMPlayer와 같은 hls.js·mpegts.js (처음 쓸 때 jsdelivr에서 받음). 소리는 고른 사람에게만.
  var YMPROXY = false, cineScreen = null, cineIdle = null, cine = { video: null, hls: null, ts: null, tex: null, title: '', vod: false, token: 0 };
  var cpBox = el('l3d-cpick'), cpState = { src: null, list: [], tgCh: '', offset: 0, more: false, sources: null, group: '' };
  var IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  function loadScript(url, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = url; s.onload = function () { if (test()) ok(); else bad(new Error('재생 엔진을 불러오지 못했습니다')); };
      s.onerror = function () { bad(new Error('재생 엔진을 불러오지 못했습니다 (인터넷 연결 확인)')); }; document.head.appendChild(s);
    });
  }
  function cineVideo() {
    if (cine.video) return cine.video;
    var v = document.createElement('video'); v.className = 'l3d-cine-video'; v.setAttribute('playsinline', ''); v.crossOrigin = 'anonymous'; v.preload = 'auto';
    v.addEventListener('loadedmetadata', fitScreen);
    v.addEventListener('playing', function () { cineUi(); });
    v.addEventListener('pause', function () { cineUi(); });
    v.addEventListener('timeupdate', function () { if (Date.now() - (cine.uiAt || 0) > 500) { cine.uiAt = Date.now(); cineUi(); } });
    v.addEventListener('error', function () { cineMsg('재생하지 못했습니다' + (v.error && v.error.message ? ': ' + v.error.message : '')); });
    wrap.appendChild(v);
    cine.video = v;
    return v;
  }
  function fitScreen() {   // 스크린 가로 길이를 영상 비율에 맞춘다 (높이는 그대로)
    var v = cine.video; if (!cineScreen || !v || !v.videoWidth) return;
    var p = cineScreen.geometry.parameters, k = Math.min(1, (v.videoWidth / v.videoHeight) * p.height / p.width);
    cineScreen.scale.x = k;
  }
  function cineDestroy() {
    if (cine.hls) { try { cine.hls.destroy(); } catch (e) { /* 무시 */ } cine.hls = null; }
    if (cine.ts) { try { cine.ts.destroy(); } catch (e) { /* 무시 */ } cine.ts = null; }
    if (cine.video) { cine.video.pause(); cine.video.removeAttribute('src'); try { cine.video.load(); } catch (e) { /* 무시 */ } }
  }
  function cinePlay(url, kind, title, vod) {
    var v = cineVideo(), token = ++cine.token;
    cineDestroy();
    cine.title = title; cine.vod = !!vod;
    cineMsg('여는 중... ' + title);
    if (cineScreen) {
      if (!cine.tex) { cine.tex = new T.VideoTexture(v); cine.tex.encoding = T.sRGBEncoding; }
      cineScreen.material.map = cine.tex; cineScreen.material.needsUpdate = true;
    }
    var go = function () { var p = v.play(); if (p && p.catch) p.catch(function () { if (token === cine.token) cineMsg('▶를 눌러 재생하세요'); }); };
    var abs = new URL(url, location.href).href;
    if (kind === 'hls' && !(v.canPlayType('application/vnd.apple.mpegurl') && IS_SAFARI)) {
      loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js', function () { return !!window.Hls; }).then(function () {
        if (token !== cine.token) return;
        if (!window.Hls.isSupported()) { v.src = abs; go(); return; }
        var h = new window.Hls({ enableWorker: true, lowLatencyMode: false }); cine.hls = h;
        h.on(window.Hls.Events.ERROR, function (e, d) { if (d && d.fatal && token === cine.token) cineMsg('재생 오류: ' + (d.details || d.type)); });
        h.loadSource(abs); h.attachMedia(v); h.on(window.Hls.Events.MANIFEST_PARSED, go);
      }).catch(function (e) { cineMsg(e.message); });
    } else if (kind === 'ts') {
      loadScript('https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js', function () { return !!window.mpegts; }).then(function () {
        if (token !== cine.token) return;
        if (!window.mpegts.isSupported()) { cineMsg('이 브라우저는 MPEG-TS 생방송을 재생하지 못합니다.'); return; }
        var p = window.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: abs }, { enableStashBuffer: false, liveBufferLatencyChasing: true });
        cine.ts = p; p.attachMediaElement(v); p.load();
        p.on(window.mpegts.Events.ERROR, function (t, d) { if (token === cine.token) cineMsg('재생 오류: ' + t + ' ' + d); });
        go();
      }).catch(function (e) { cineMsg(e.message); });
    } else if (kind === 'dash') {
      cineMsg('DASH(.mpd) 채널은 영화관에서 아직 못 봅니다. [YMPlayer 새 탭]으로 보세요.');
    } else { v.src = abs; go(); }
    el('l3d-cbar').hidden = false; cineUi();
  }
  function cineStop() {
    cine.token++; cineDestroy();
    if (cineScreen && cineIdle) { cineScreen.material.map = cineIdle; cineScreen.material.needsUpdate = true; cineScreen.scale.x = 1; }
    el('l3d-cbar').hidden = true; if (cine.video) cine.video.classList.remove('full');
  }
  function cineMsg(t) { el('l3d-cb-msg').textContent = t || ''; }
  function cineUi() {
    var v = cine.video; if (!v) return;
    el('l3d-cb-t').textContent = cine.title;
    el('l3d-cb-pp').textContent = v.paused ? '▶' : '❚❚';
    var dur = isFinite(v.duration) ? v.duration : 0;
    el('l3d-cb-time').textContent = cine.vod && dur ? fmtTime(v.currentTime) + ' / ' + fmtTime(dur) : (v.paused ? '' : '● 재생 중');
    if (!v.paused && v.readyState > 2) cineMsg('');
    ['l3d-cb-back', 'l3d-cb-fwd'].forEach(function (id) { el(id).style.display = cine.vod && dur ? '' : 'none'; });
  }
  el('l3d-cb-pp').addEventListener('click', function () { var v = cine.video; if (!v) return; if (v.paused) v.play(); else v.pause(); });
  el('l3d-cb-back').addEventListener('click', function () { if (cine.video) cine.video.currentTime = Math.max(0, cine.video.currentTime - 10); });
  el('l3d-cb-fwd').addEventListener('click', function () { if (cine.video) cine.video.currentTime += 30; });
  el('l3d-cb-vol').addEventListener('input', function () { if (cine.video) { cine.video.volume = parseFloat(el('l3d-cb-vol').value); cine.video.muted = false; } });
  el('l3d-cb-full').addEventListener('click', function () {   // 스크린 대신 화면 가득 (다시 누르면 스크린으로)
    var v = cine.video; if (!v) return;
    v.classList.toggle('full'); v.controls = v.classList.contains('full');
    el('l3d-cb-full').textContent = v.classList.contains('full') ? '스크린으로' : '크게 보기';
  });
  el('l3d-cb-stop').addEventListener('click', cineStop);
  el('l3d-cb-pick').addEventListener('click', function () { openCinemaPick(); });

  function openCinemaPick() {
    [setBox, aiBox, pplBox, outBox, mdlBox, staffBox, brBox, mpBox].forEach(function (b) { if (b) b.classList.remove('on'); });
    cpBox.classList.add('on');
    el('l3d-cp-tab').href = YMPLAYER ? YMPLAYER + '/' : '#';
    if (cpState.sources) { cpTabs(); return; }
    el('l3d-cp-body').textContent = 'YMPlayer에서 불러오는 중...';
    api('api/lib3d/ym/sources').then(function (d) {
      cpState.sources = d.sources || [];
      if (!cpState.sources.length) { el('l3d-cp-body').textContent = 'YMPlayer에 IPTV·텔레그램 소스가 없습니다 (또는 서재용 계정이 볼 수 있는 소스가 없음).'; return; }
      cpState.src = cpState.sources[0]; cpTabs(); cpLoad();
    }).catch(function (e) { el('l3d-cp-body').textContent = e.message; cpState.sources = null; });
  }
  function cpTabs() {
    var t = el('l3d-cp-tabs'); t.textContent = '';
    cpState.sources.forEach(function (s) {
      var b = document.createElement('button'); b.type = 'button'; b.className = s === cpState.src ? 'on' : '';
      b.textContent = (s.type === 'iptv' ? '📺 ' : '✈ ') + s.name;
      b.addEventListener('click', function () { cpState.src = s; cpState.tgCh = ''; cpState.group = ''; el('l3d-cp-q').value = ''; cpTabs(); cpLoad(); });
      t.appendChild(b);
    });
    var sel = el('l3d-cp-sel'); sel.textContent = '';
    var s = cpState.src;
    if (s && s.type === 'telegram') {
      [['', '모든 채널']].concat((s.channels || []).map(function (c) { return [c.id, c.title || c.id]; })).forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op);
      });
      sel.value = cpState.tgCh;
    }
    sel.style.display = s && (s.type === 'telegram' || cpState.groups) ? '' : 'none';
  }
  function cpLoad(more) {
    var s = cpState.src, body = el('l3d-cp-body'); if (!s) return;
    if (!more) { body.textContent = '불러오는 중...'; cpState.offset = 0; }
    var base = 'api/lib3d/ym/' + (s.type === 'iptv' ? 'iptv/' : 'tg/') + encodeURIComponent(s.id) + '/';
    if (s.type === 'iptv') {
      Promise.all([api(base + 'channels'), s.has_epg ? api(base + 'epg').catch(function () { return null; }) : Promise.resolve(null)]).then(function (r) {
        cpState.list = r[0].channels || []; cpState.epg = r[1];
        var groups = []; cpState.list.forEach(function (c) { if (groups.indexOf(c.group) < 0) groups.push(c.group); });
        var sel = el('l3d-cp-sel'); sel.textContent = '';
        [''].concat(groups).forEach(function (g) { var op = document.createElement('option'); op.value = g; op.textContent = g || '모든 그룹'; sel.appendChild(op); });
        sel.style.display = groups.length > 1 ? '' : 'none'; sel.value = cpState.group; cpState.groups = groups.length > 1;
        cpDraw();
      }).catch(function (e) { body.textContent = e.message; });
      return;
    }
    var q = (el('l3d-cp-q').value || '').trim();
    var url = base + 'videos?' + new URLSearchParams({ channel: cpState.tgCh, offset: cpState.offset, limit: 40, q: q, sort: 'latest', kind: 'video' });
    api(url).then(function (d) {
      if (!more) cpState.list = [];
      cpState.list = cpState.list.concat(d.items || []); cpState.more = !!d.more; cpState.offset += (d.items || []).length;
      cpDraw();
    }).catch(function (e) { body.textContent = e.message; });
  }
  function nowOn(c) {   // 편성표에서 지금 방송 제목
    var e = cpState.epg; if (!e || !e.programmes) return '';
    var id = c.tvg_id && e.programmes[c.tvg_id] ? c.tvg_id : (e.names || {})[String(c.name || '').toLowerCase().replace(/\s+/g, '')];
    var list = id && e.programmes[id], now = Date.now() / 1000;
    if (!list) return '';
    for (var i = 0; i < list.length; i++) if (list[i][0] <= now && now < list[i][1]) return list[i][2];
    return '';
  }
  function cpDraw() {
    var s = cpState.src, body = el('l3d-cp-body'), q = (el('l3d-cp-q').value || '').trim().toLowerCase();
    body.textContent = '';
    if (s.type === 'iptv') {
      cpState.list.filter(function (c) { return (!cpState.group || c.group === cpState.group) && (!q || String(c.name).toLowerCase().indexOf(q) >= 0); }).slice(0, 300).forEach(function (c) {
        var on = nowOn(c);
        cpRow(c.logo, c.name, (c.group || '') + (on ? ' · 지금: ' + on : ''), function () {
          var u = '/api/lib3d/ym/stream?' + new URLSearchParams(Object.assign({ url: c.url }, c.ua ? { ua: c.ua } : {}, c.referer ? { ref: c.referer } : {}));
          var path = String(c.url).split('?')[0].toLowerCase(), kind = /[?&]output=ts/i.test(c.url) || /\.ts$/.test(path) ? 'ts' : /\.mpd$/.test(path) ? 'dash' : /\.(mp4|m4v|webm|mov|mkv)$/.test(path) ? 'direct' : 'hls';
          cpBox.classList.remove('on'); cinePlay(u, kind, c.name, false);
        });
      });
    } else {
      cpState.list.forEach(function (v) {
        var thumb = v.has_thumb ? 'api/lib3d/ym/tg/' + encodeURIComponent(s.id) + '/thumb/' + v.channel + '/' + v.msg : '';
        cpRow(thumb, v.title || v.file_name || '(제목 없음)', (v.duration ? fmtTime(v.duration) + ' · ' : '') + String(v.date || '').slice(0, 10), function () { tgPlay(s, v); });
      });
      if (cpState.more) {
        var mb = document.createElement('button'); mb.type = 'button'; mb.className = 'l3d-btn'; mb.textContent = '더 보기';
        mb.addEventListener('click', function () { mb.remove(); cpLoad(true); }); body.appendChild(mb);
      }
    }
    if (!body.firstChild) body.textContent = '없습니다.';
  }
  function cpRow(img, title, sub, onClick) {
    var r = document.createElement('div'); r.className = 'it';
    var im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer';
    if (img) { im.src = img; im.onerror = function () { im.style.visibility = 'hidden'; }; } else im.style.visibility = 'hidden';
    var tx = document.createElement('div'); var b = document.createElement('b'); b.textContent = title;
    var sm = document.createElement('small'); sm.textContent = sub;
    tx.appendChild(b); tx.appendChild(sm); r.appendChild(im); r.appendChild(tx);
    r.addEventListener('click', onClick);
    el('l3d-cp-body').appendChild(r);
  }
  function tgPlay(s, v) {   // YMPlayer와 같은 판단: 원본 그대로 되면 Range 스트림, 아니면 서버 변환 (Safari는 HLS 변환)
    cpBox.classList.remove('on');
    var base = 'api/lib3d/ym/tg/' + encodeURIComponent(s.id) + '/', id = v.channel + '/' + v.msg, title = v.title || v.file_name || '';
    cineMsg('여는 중... ' + title); el('l3d-cbar').hidden = false;
    api(base + 'video/' + id + '?probe=1').then(function (d) {
      var play = (d.item && d.item.play) || { mode: 'direct' }, mode = play.mode;
      if (IS_SAFARI && mode === 'direct' && play.container && (play.container !== 'mp4' || String(play.video || '').split(' ')[0] !== 'h264')) mode = 'transcode';
      if (mode === 'direct') { cinePlay('/' + base + 'stream/' + id, 'direct', title, true); return; }
      if (IS_SAFARI) {
        postJSON(base + 'hls/' + id + '?' + new URLSearchParams({ start: 0, mode: mode }), {}).then(function (j) { cinePlay(j.url, 'hls', title, false); })
          .catch(function (e) { cineMsg(e.message); });
        return;
      }
      cinePlay('/' + base + 'transcode/' + id + '?' + new URLSearchParams({ start: 0, mode: mode }), 'direct', title + ' (서버 변환)', false);
    }).catch(function (e) { cineMsg(e.message); });
  }
  el('l3d-cp-q').addEventListener('input', function () {
    if (!cpState.src) return;
    if (cpState.src.type === 'iptv') cpDraw(); else { clearTimeout(cpState.qt); cpState.qt = setTimeout(function () { cpLoad(); }, 400); }
  });
  el('l3d-cp-sel').addEventListener('change', function () {
    var v = el('l3d-cp-sel').value;
    if (cpState.src.type === 'iptv') { cpState.group = v; cpDraw(); } else { cpState.tgCh = v; cpLoad(); }
  });
  el('l3d-cp-close').addEventListener('click', function () { cpBox.classList.remove('on'); });

  // ── 오락실 (1층 입구 왼쪽): 미니게임마다 오락기 한 대, 누르거나 앞 의자에 앉으면 그 게임 ──
  var ARCADE = [], arcBox = el('l3d-arcade'), ARC_X = null;   // ARC_X: 오락기가 놓인 앞벽 구간 (포스터를 비움)
  var ARC_COLORS = [0xd62839, 0x1f6feb, 0xf2b705, 0x2a9d8f, 0x7b2cbf, 0xe76f51, 0x118ab2, 0xef476f, 0x06d6a0, 0x3a86ff, 0xff7f11, 0x8338ec];
  function arcadeSpan(L) {   // 오락기를 놓을 x 범위 [끝, 시작] (입구 왼쪽 벽을 따라)
    var n = Math.min(ARCADE.length, 8), x0 = -DOOR_W / 2 - 3.0;
    return { n: n, x0: x0, x1: x0 - (n - 1) * 1.2, step: 1.2 };
  }
  function addArcade(floorIdx) {
    if (floorIdx !== 0 || !ARCADE.length || !layout) return;
    var L = layout, f = L.front, sp = arcadeSpan(L);
    if (sp.x1 < -L.w / 2 + 6) return;   // 너무 좁은 건물
    var signTex = textTex(['오락실 · 미니게임'], 1024, 180, '#14121c', '#ff4fd8', 96);
    var signMat = new T.MeshBasicMaterial({ map: signTex, toneMapped: false });
    var sign = new T.Mesh(new T.BoxGeometry(3.4, 0.6, 0.04), [M.black, M.black, M.black, M.black, signMat, signMat]);
    sign.position.set((sp.x0 + sp.x1) / 2, 3.35, f - 2.2); parent.add(sign);
    [-1.5, 1.5].forEach(function (o) { var c = new T.Mesh(new T.CylinderGeometry(0.006, 0.006, CEIL - 3.65, 6), M.black); c.position.set((sp.x0 + sp.x1) / 2 + o, (CEIL + 3.65) / 2, f - 2.2); parent.add(c); });
    var floorMat = new T.Mesh(new T.PlaneGeometry(sp.x0 - sp.x1 + 2.2, 3.6), new T.MeshStandardMaterial({ color: 0x1b1530, roughness: 0.9 }));
    floorMat.rotation.x = -Math.PI / 2; floorMat.position.set((sp.x0 + sp.x1) / 2, 0.011, f - 1.9); floorMat.receiveShadow = true; parent.add(floorMat);
    ARCADE.slice(0, sp.n).forEach(function (gm, i) {
      var x = sp.x0 - i * sp.step, col = ARC_COLORS[i % ARC_COLORS.length];
      var g = new T.Group(); g.position.set(x, 0, f - 0.75); g.rotation.y = Math.PI; parent.add(g);   // 로비 쪽(-z)을 보고
      var body = new T.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.1 });
      var dark = new T.MeshStandardMaterial({ color: 0x15151a, roughness: 0.6 });
      var base = new T.Mesh(unitBox, body); base.scale.set(0.82, 0.95, 0.72); base.position.set(0, 0.475, 0); g.add(base);
      var upper = new T.Mesh(unitBox, body); upper.scale.set(0.82, 0.95, 0.42); upper.position.set(0, 1.4, -0.15); g.add(upper);
      var panel = new T.Mesh(unitBox, dark); panel.scale.set(0.8, 0.06, 0.34); panel.position.set(0, 1.0, 0.24); panel.rotation.x = 0.25; g.add(panel);
      var stick = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.12, 8), M.black); stick.position.set(-0.18, 1.08, 0.26); g.add(stick);
      var ball = new T.Mesh(new T.SphereGeometry(0.035, 12, 10), new T.MeshStandardMaterial({ color: 0xd62839, roughness: 0.3 })); ball.position.set(-0.18, 1.15, 0.26); g.add(ball);
      [0.05, 0.15, 0.25].forEach(function (bx, k) { var bt = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.02, 12), new T.MeshBasicMaterial({ color: [0xffd166, 0x06d6a0, 0xef476f][k] })); bt.position.set(bx, 1.06, 0.27); bt.rotation.x = 0.25; g.add(bt); });
      var scrTex = canvasTex(400, 320, function (c, w, h) {
        var grd = c.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#0d0b1e'); grd.addColorStop(1, '#241a4a'); c.fillStyle = grd; c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,0.06)'; for (var yy = 0; yy < h; yy += 4) c.fillRect(0, yy, w, 1);   // 주사선
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#ffd166'; c.font = '700 40px ' + FONT; wrapText(c, gm.name, 22, 90, w - 44, 50, 2);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = '#7ee0c3'; c.font = '700 26px ' + FONT; c.fillText('PRESS START', w / 2, 262);
      });
      var scr = new T.Mesh(new T.PlaneGeometry(0.66, 0.53), new T.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
      scr.position.set(0, 1.45, 0.075); scr.rotation.x = -0.12; g.add(scr);
      var mq = canvasTex(400, 90, function (c, w, h) { c.fillStyle = '#ff4fd8'; c.fillRect(0, 0, w, h); c.fillStyle = '#14121c'; c.font = '800 44px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(gm.name.replace(/\s*\(.*\)$/, ''), w / 2, h / 2 + 2, w - 20); });
      var marquee = new T.Mesh(new T.PlaneGeometry(0.8, 0.18), new T.MeshBasicMaterial({ map: mq, toneMapped: false })); marquee.position.set(0, 1.97, 0.07); g.add(marquee);
      var mbox = new T.Mesh(unitBox, dark); mbox.scale.set(0.84, 0.22, 0.5); mbox.position.set(0, 1.97, -0.17); g.add(mbox);
      g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.userData.arcade = gm.id; brunchHits.push(o); } });
      // 앞 의자 (앉으면 그 게임)
      var st = new T.Group(); st.position.set(x, 0, f - 1.75); parent.add(st);
      var seat = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.08, 18), dark); seat.position.y = 0.62; st.add(seat);
      var leg = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.6, 8), M.pole); leg.position.y = 0.3; st.add(leg);
      var foot = new T.Mesh(new T.CylinderGeometry(0.2, 0.22, 0.03, 18), M.pole); foot.position.y = 0.015; st.add(foot);
      addSeat(x, f - 1.75, 0, 0.62, { arcade: gm.id });   // 오락기(+z)를 보고
    });
  }
  function openArcade(id) {
    var gm = ARCADE.filter(function (g) { return g.id === id; })[0] || ARCADE[0]; if (!gm) return;
    closeCard();
    arcBox.classList.add('on'); wrap.classList.add('reading'); keys = {};
    el('l3d-arc-t').textContent = '🕹 ' + gm.name;
    var fr = el('l3d-arc-frame');
    if (fr.dataset.game !== gm.id) { fr.dataset.game = gm.id; fr.setAttribute('src', 'api/lib3d/arcade#' + encodeURIComponent(gm.id)); }
    setTimeout(function () { try { fr.focus(); fr.contentWindow.focus(); } catch (e) { /* 무시 */ } }, 400);   // 방향키가 게임으로 가게
    var sel = el('l3d-arc-sel');
    if (!sel.options.length) ARCADE.forEach(function (g) { var o = document.createElement('option'); o.value = g.id; o.textContent = g.name; sel.appendChild(o); });
    sel.value = gm.id;
  }
  function closeArcade() {
    arcBox.classList.remove('on'); wrap.classList.remove('reading');
    var fr = el('l3d-arc-frame'); fr.removeAttribute('src'); fr.dataset.game = '';   // 닫으면 게임도 끝
  }
  el('l3d-arc-close').addEventListener('click', closeArcade);
  window.addEventListener('message', function (e) { if (e.origin === location.origin && e.data === 'l3d-arcade-close' && arcBox.classList.contains('on')) closeArcade(); });   // 게임 안에서 Esc
  el('l3d-arc-sel').addEventListener('change', function () { openArcade(el('l3d-arc-sel').value); });

  // ── AI 직원 (사서·도슨트 …): 서버의 상태(가려는 곳·말·가리키는 책)대로 걷고 말하고 가리킨다 + 로비 안내판 ──
  var staffNPC = {}, staffData = [], boardMesh = null, boardSig = '', pointer = null, STAFF_ON = false;
  function placePos(name) {
    var L = layout; if (!L) return null;
    var lx = Math.max(L.w / 2 - 6.5, 8);
    if (name === 'desk') return [L.w / 2 - 5.5, L.front - 6.35, 0];
    if (name === 'lobby') return [-3.5, L.front - 9, 0.4];
    if (name === 'entrance') return [1.6, L.front - 2.4, Math.PI];
    if (name === 'lounge') return [-lx + 2.4, L.front - 11.2, 0.6];
    if (name === 'elevator') return [-L.w / 2 + 2.2, L.front - 3, -Math.PI / 2];
    if (name === 'office') return OFFICE && OFFICE.chief ? [OFFICE.chief.x, OFFICE.chief.z, OFFICE.chief.rot] : null;   // 길 건너 (1층에만)
    if (name === 'gallery' || name === 'jazz') {
      var R0 = name === 'gallery' ? GALLERY_R : JZ.room;
      return R0 ? [R0.fx + R0.s * (name === 'jazz' ? R0.bd - 2.2 : 2.2), R0.z + (name === 'jazz' ? 0.9 : -1.4), name === 'jazz' ? -R0.s * Math.PI / 2 : R0.s * Math.PI / 2 + 0.6] : null;
    }
    var b = (floors[cur] && floors[cur].booths || []).filter(function (x) { return x.name === name; })[0];
    if (b) return [b.x + 2.6, b.z + BOOTH_D / 2 + 1.6, Math.PI];
    return null;
  }
  function bookByKey(key) { return books.filter(function (b) { return b.key === key && b.mesh && b.kind !== 'banner'; })[0]; }
  function makeStaff(s) {
    var p = makePerson(5000 + s.look * 37);
    p.kind = 'agent'; p.walkW = 0; p.staffId = s.id;
    p.tag = null; setStaffTag(p, s, '');
    var home = placePos(s.post) || placePos('lobby');
    p.g.position.set(home[0], 0, home[1]); p.g.rotation.y = home[2];
    p.tx = home[0]; p.tz = home[1]; p.face = home[2];
    floorGroup.add(p.g); dimEnv(p.g);
    if (p.mixer) setLook(p, 'calm');
    if (s.kind === 'courier') {   // 두 손으로 든 택배 상자
      var bx = new T.Group(), cb = new T.Mesh(unitBox, new T.MeshStandardMaterial({ color: 0xb8865a, roughness: 0.9 }));
      cb.scale.set(0.5, 0.36, 0.38); bx.add(cb);
      var tp = new T.Mesh(unitBox, new T.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 })); tp.scale.set(0.51, 0.02, 0.08); tp.position.y = 0.18; bx.add(tp);
      bx.position.set(0, 1.05, 0.36); p.g.add(bx);
    }
    return p;
  }
  function setStaffTag(p, s, msg) {   // 직원은 청록, AI 손님은 호박색 이름표
    if (p.tag) { p.g.remove(p.tag); p.tag.material.map.dispose(); p.tag.material.dispose(); }
    p.tag = nameTag(s.job ? s.name + ' · ' + s.job : s.name, msg, s.kind === 'guest' ? '#ffcf7a' : s.kind === 'courier' ? '#ff9f6b' : s.kind === 'discord' ? '#a5b4ff' : s.post === 'office' ? '#ffd166' : (s.post === 'gallery' || s.post === 'jazz') ? '#9fd3ff' : '#7ee0c3');
    p.tag.position.y = 2.15 + (msg ? 0.2 : 0); p.g.add(p.tag);
  }
  function syncStaff(d) {
    if (!d || !floorGroup || !layout) return;
    staffData = (d.agents || []).concat(cur === 0 ? d.deliveries || [] : []);   // 배달원·디스코드 손님은 1층에만 (배달원은 안내 데스크로, 디스코드 손님은 라운지로)
    Object.keys(staffNPC).forEach(function (k) {   // 나간 손님(목록에서 빠진 사람)은 지운다
      if (staffData.some(function (s) { return s.id === k; })) return;
      var gone = staffNPC[k]; if (gone.g.parent) gone.g.parent.remove(gone.g); disposeGroup(gone.g); delete staffNPC[k];
    });
    var ROOMPOST = { office: 1, gallery: 1, jazz: 1 };
    staffData.forEach(function (s) {
      if (ROOMPOST[s.post] && !placePos(s.post) && (!s.target || ROOMPOST[s.target] && !placePos(s.target))) {   // 길 건너 사람: 자기 공간이 없는 층(2층부터)에는 안 보인다
        if (staffNPC[s.id]) { var q0 = staffNPC[s.id]; if (q0.g.parent) q0.g.parent.remove(q0.g); disposeGroup(q0.g); delete staffNPC[s.id]; }
        return;
      }
      var p = staffNPC[s.id];
      if (p && p.g.parent !== floorGroup) { disposeGroup(p.g); p = null; }
      if (!p) { p = staffNPC[s.id] = makeStaff(s); p.fresh = true; }
      var pos = null, face = null;
      if (s.target === 'book' && s.book) {
        var bk = bookByKey(s.book);
        if (bk) {   // 그 책이 있는 구역 앞에 서서 책 쪽을 본다
          var q0 = placePos(bk.lib);
          bk.mesh.getWorldPosition(tmpV);
          pos = q0 ? [q0[0], q0[1]] : [tmpV.x, tmpV.z + 1.4];
          face = Math.atan2(tmpV.x - pos[0], tmpV.z - pos[1]);
          if (s.kind !== 'guest') showPointer(bk, s.book);   // 손님은 책 앞에서 살펴보기만
        }
      } else if (s.target) {
        var q = placePos(s.target); if (q) { pos = [q[0], q[1]]; face = q[2]; }
      }
      if (!pos && s.target !== 'book') { var h = placePos(s.post) || placePos('lobby'); pos = [h[0], h[1]]; face = h[2]; }
      if (s.kind === 'discord') {   // 디스코드에서 온 사람: 길 건너 사무실 회의 탁자 의자에 앉는다 (사무실이 없으면 라운지에 나란히)
        var sl = s.slot || 0; p.seatRot = null;
        if (OFFICE && OFFICE.seats && OFFICE.seats.length) {
          if (s.target === 'entrance') { pos = [OFFICE.door.x, OFFICE.door.z + ((sl % 3) - 1) * 0.5]; face = OFFICE.door.rot; }   // 들어오고 나갈 때는 사무실 문
          else { var seat = OFFICE.seats[sl % OFFICE.seats.length]; pos = [seat.x, seat.z]; face = seat.rot; p.seatRot = seat.rot; }
          if (p.fresh) { p.fresh = false; p.g.position.set(OFFICE.door.x, 0, OFFICE.door.z); }
        } else {
          if (s.target !== 'entrance') { var lq = placePos('lounge'); pos = [lq[0], lq[1]]; face = lq[2]; }
          if (pos) pos = [pos[0] + ((sl % 4) - 1.5) * 1.1, pos[1] + Math.floor(sl / 4) * 1.2 - 0.6];
        }
      }
      if (pos) { p.tx = pos[0]; p.tz = pos[1]; p.face = face; }   // 이 화면에 없는 책이면 그 자리에 머문다
      var say = s.say || '';
      if (say !== (p.lastSay || '')) { p.lastSay = say; setStaffTag(p, s, say); }
    });
    if (pointer && !staffData.some(function (s) { return s.kind !== 'guest' && s.target === 'book' && s.book === pointer.key; })) hidePointer();
    drawBoard(d.board || {}, d.log || []);
  }
  function updateStaff(p, dt, now) {
    var dx = p.tx - p.g.position.x, dz = p.tz - p.g.position.z, d = Math.hypot(dx, dz), moving = d > 0.15;
    if (d > 40) { p.g.position.x = p.tx; p.g.position.z = p.tz; moving = false; }
    if (moving) {
      var step = Math.min(d, (d > 8 ? 2.4 : 1.35) * dt * Math.max(0.2, p.walkW));   // 멀면 바삐 걷는다
      p.g.position.x += dx / d * step; p.g.position.z += dz / d * step;
      var want = Math.atan2(dx, dz), cy = p.g.rotation.y;
      p.g.rotation.y = cy + Math.atan2(Math.sin(want - cy), Math.cos(want - cy)) * Math.min(1, dt * 6);
    } else if (p.face != null) {
      var cy2 = p.g.rotation.y;
      p.g.rotation.y = cy2 + Math.atan2(Math.sin(p.face - cy2), Math.cos(p.face - cy2)) * Math.min(1, dt * 3);
    }
    p.walkW += ((moving ? 1 : 0) - p.walkW) * Math.min(1, dt * 4);
    if (p.mixer) {
      if (p.acts.walk) { p.acts.walk.setEffectiveWeight(p.walkW); p.acts.walk.timeScale = Math.hypot(p.tx - p.g.position.x, p.tz - p.g.position.z) > 8 ? 1.6 : 1.05; }
      if (p.acts.idle) p.acts.idle.setEffectiveWeight(1 - p.walkW);
      p.mixer.update(dt);
      applyLook(p, now);
    }
    if (p.seatRot !== undefined) { p.sit = p.seatRot != null && !moving; sitPose(p, dt); }   // 사무실 의자에 앉기
  }
  function showPointer(bk, key) {   // 가리키는 책 위에 통통 튀는 화살표
    if (pointer && pointer.key === key) return;
    hidePointer();
    var cone = new T.Mesh(new T.ConeGeometry(0.09, 0.22, 16), new T.MeshBasicMaterial({ color: 0xffb703, toneMapped: false }));
    cone.rotation.x = Math.PI;
    bk.mesh.getWorldPosition(tmpV);
    cone.position.set(tmpV.x, tmpV.y + 0.42, tmpV.z);
    floorGroup.add(cone);
    pointer = { key: key, mesh: cone, y: tmpV.y + 0.42 };
  }
  function hidePointer() {
    if (pointer) { if (pointer.mesh.parent) pointer.mesh.parent.remove(pointer.mesh); pointer.mesh.geometry.dispose(); pointer.mesh.material.dispose(); }
    pointer = null;
  }
  function drawBoard(board, logs) {   // 로비 안내판: 직원이 건 내용 + 최근 활동
    if (!floorGroup || !layout) return;
    var sig = JSON.stringify([board, logs.map(function (e) { return e.t; })]);
    if (boardMesh && boardMesh.parent === floorGroup && sig === boardSig) return;
    boardSig = sig;
    if (boardMesh) { if (boardMesh.parent) boardMesh.parent.remove(boardMesh); disposeGroup(boardMesh); }
    var tex = canvasTex(1024, 1280, function (g, w, h) {
      g.fillStyle = '#1d2a26'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#7ee0c3'; g.font = '700 30px ' + FONT; g.textBaseline = 'top';
      g.fillText('AI 직원 소식판', 48, 40);
      g.fillStyle = '#f5f2ec'; g.font = '700 54px ' + FONT;
      g.fillText(board.title || '오늘의 도서관', 48, 90, w - 96);
      g.font = '400 36px ' + FONT;
      var y = 172;
      (board.lines && board.lines.length ? board.lines : ['직원들이 일한 내용이 여기에 걸립니다.']).slice(0, 8).forEach(function (ln) {
        wrapText(g, ln, 48, y, w - 96, 46, 2).forEach(function () { y += 46; });
      });
      if (board.by) { g.fillStyle = '#9fb8b0'; g.font = '400 26px ' + FONT; g.fillText('— ' + board.by, 48, y + 6); y += 40; }
      y = Math.max(y + 30, 620);
      g.fillStyle = '#7ee0c3'; g.font = '700 32px ' + FONT; g.fillText('최근 활동', 48, y); y += 52;
      logs.slice(0, 5).forEach(function (e) {
        var tm = new Date(e.t * 1000), hh = ('0' + tm.getHours()).slice(-2) + ':' + ('0' + tm.getMinutes()).slice(-2);
        g.fillStyle = '#ffd166'; g.font = '700 28px ' + FONT; g.fillText(hh + '  ' + e.name + ' · ' + e.title, 48, y, w - 96); y += 38;
        g.fillStyle = '#d8d2c6'; g.font = '400 26px ' + FONT;
        wrapText(g, e.text || '', 48, y, w - 96, 34, 2).forEach(function () { y += 34; });
        y += 14;
      });
    });
    var g = new T.Group(); g.position.set(5.5, 0, layout.front - 8.2);
    var face = new T.Mesh(new T.PlaneGeometry(1.6, 2.0), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.set(0, 1.55, 0.03); g.add(face);
    var back = new T.Mesh(unitBox, M.black); back.scale.set(1.7, 2.1, 0.05); back.position.set(0, 1.55, 0); g.add(back);
    var leg = new T.Mesh(unitBox, M.black); leg.scale.set(0.08, 0.55, 0.08); leg.position.set(0, 0.27, 0); g.add(leg);
    var foot = new T.Mesh(unitBox, M.black); foot.scale.set(0.7, 0.04, 0.4); foot.position.set(0, 0.02, 0); g.add(foot);
    floorGroup.add(g); boardMesh = g;
  }
  function wrapText(g, text, x, y, maxW, lh, maxLines) {   // 글자 단위로 줄바꿈해 그리고 줄 목록을 돌려준다
    var lines = [], cur0 = '';
    String(text).split('').forEach(function (ch) {
      if (g.measureText(cur0 + ch).width > maxW) { lines.push(cur0); cur0 = ch; } else cur0 += ch;
    });
    if (cur0) lines.push(cur0);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
    lines.forEach(function (ln, i) { g.fillText(ln, x, y + i * lh); });
    return lines;
  }
  function dropStaff() {
    Object.keys(staffNPC).forEach(function (k) { var p = staffNPC[k]; if (p.g.parent) p.g.parent.remove(p.g); disposeGroup(p.g); });
    staffNPC = {}; hidePointer(); boardMesh = null; boardSig = '';
  }

  // ── 나가기: 소리·재생·함께 보기·그리기를 모두 멈추고 안내 화면 ([다시 들어가기]로 이어서) ──
  var LEFT = false;
  function leaveLibrary() {
    if (LEFT) return;
    LEFT = true;
    try { brStop(); } catch (e) { /* 무시 */ }
    try { jzStop(); } catch (e) { /* 무시 */ }
    try { if (MED.el) { mediaSave(); mediaStop(); } } catch (e) { /* 무시 */ }
    try { if (cine.video) cineStop(); closeCinema(); closeArcade(); } catch (e) { /* 무시 */ }
    if (reading) closeReader();
    if (sitting) standUp(true);
    keys = {}; savePos();
    [setBox, aiBox, pplBox, outBox, mdlBox, staffBox, brBox, mpBox, cpBox].forEach(function (b) { if (b) b.classList.remove('on'); });
    fetch('api/lib3d/leave', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cid: CID }), keepalive: true }).catch(function () {});
    el('l3d-left').classList.add('on');
  }
  function reenterLibrary() {
    if (!LEFT) return;
    LEFT = false; el('l3d-left').classList.remove('on');
    last = performance.now(); requestAnimationFrame(frame); presenceTick();
  }
  el('l3d-exit').addEventListener('click', leaveLibrary);
  el('l3d-left-back').addEventListener('click', reenterLibrary);
  el('l3d-left-out').addEventListener('click', function () {
    fetch('api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function () { location.href = '/login'; }, function () { location.href = '/login'; });
  });

  // ── 그리기 ──
  var last = performance.now(), acc = 0;
  function frame(now) {
    if (LEFT) return;   // 나간 동안은 그리지도 움직이지도 않는다
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    if (!reading) { updatePeople(dt, now); updateWeather(dt, now); updateCars(dt); updateCamp(dt, now); for (var rn in remotes) updateRemote(remotes[rn], dt);
      for (var sn in staffNPC) updateStaff(staffNPC[sn], dt, now);
      if (narrator) updateStaff(narrator, dt, now);
      updateJazz(dt, now);
      if (pointer) pointer.mesh.position.y = pointer.y + Math.abs(Math.sin(now / 300)) * 0.12; }
    acc += dt;
    if (acc > 0.3) { acc = 0; loadNear(); where(); sitBtn(); if (now - posSavedAt > 2000) { posSavedAt = now; savePos(); } }
    if (!reading) renderer.render(scene, camera);
    placeBubble();
    requestAnimationFrame(frame);
  }
  resize();
  home();
  loadHumans();
  loadOutEnv();
  loadHorse();
  loadBirds();
  build(false);
  requestAnimationFrame(frame);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(wrap);
})();
