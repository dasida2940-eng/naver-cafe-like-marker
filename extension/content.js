// 네이버 카페 좋아요 표시 - content script
// 1) 게시글 화면: 좋아요 버튼을 누를 때만 저장/삭제 (열기만 해서는 확인하지 않음)
// 2) 게시판 목록: 저장된 글이 있는 줄을 배경색/하트로 표시
//
// 글 구분: 카페 번호(clubid) + 카페 이름(주소의 영문 이름) + 글 번호(articleid)

(() => {
  const STORAGE_KEY = "likedArticles"; // { key: { c: 카페번호, n: 카페이름, a: 글번호, t: 저장시각 } }
  const MAP_KEY = "cafeMap";           // { 카페번호: 카페이름 }  (서로 모를 때 채워 넣기용)
  const MODE_KEY = "displayMode";      // "bg" | "bg_heart" | "heart"
  const STYLE_KEY = "heartStyle";      // "text"(♥ 좋아요) | "icon"(♥)

  let liked = {};
  let cafeMap = {};
  let mode = "bg";
  let heartStyle = "text";
  let index = new Map(); // 글번호 → [기록...]  (빠른 조회용)

  // 카페 이름으로 오인하면 안 되는 주소 첫 부분
  const RESERVED = new Set(["ca-fe", "f-e", "cafes", "mycafe", "section", "home", "search", "cafe-home"]);

  // ---------- URL에서 카페번호 / 카페이름 / 글번호 추출 ----------
  // 같은 주소는 다시 계산하지 않도록 결과를 캐시
  const parseCache = new Map();
  function parseUrl(href) {
    // 상대 주소는 지금 페이지에 따라 뜻이 달라지므로 페이지 주소도 키에 포함
    const key = /^https?:/i.test(href) ? href : location.href + " " + href;
    if (parseCache.has(key)) return parseCache.get(key);
    const r = parseUrlRaw(href);
    if (parseCache.size > 5000) parseCache.clear();
    parseCache.set(key, r);
    return r;
  }

  function parseUrlRaw(href) {
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    if (url.hostname !== "cafe.naver.com") return null;
    const qs = url.searchParams;
    let c = qs.get("clubid") || qs.get("search.clubid");
    let a = qs.get("articleid");
    let n = null;

    // 신형: /ca-fe/cafes/123/articles/456 , /f-e/cafes/123/articles/456
    const m = url.pathname.match(/\/cafes\/(\d+)(?:\/articles\/(\d+))?/);
    if (m) {
      c = m[1];
      if (m[2]) a = m[2];
    }

    // 카페 이름: /카페이름 또는 /카페이름/456
    const s = url.pathname.match(/^\/([a-z0-9_-]+)(?:\/(\d+))?\/?$/i);
    if (s && !RESERVED.has(s[1].toLowerCase()) && !/\./.test(s[1])) {
      n = s[1].toLowerCase();
      if (s[2]) a = s[2];
    }

    // iframe 주소가 파라미터에 인코딩된 경우
    if (!a) {
      const inner = qs.get("iframe_url_utf8") || qs.get("iframe_url");
      if (inner) {
        const r = parseUrl(decodeURIComponent(inner));
        if (r) return { c: r.c || c, n: r.n || n, a: r.a };
      }
    }
    return { c: c || null, n: n || null, a: a || null };
  }

  // ---------- 지금 보고 있는 카페 (자기 프레임 + 바깥 프레임 주소에서 수집) ----------
  let ctxCache = null;
  let ctxCacheKey = "";
  function pageCafe() {
    // 주소가 그대로면 이전 결과 재사용
    let key = location.href;
    try { key += "|" + window.top.location.href; } catch { /* 무시 */ }
    if (ctxCache && key === ctxCacheKey) return { ...ctxCache };
    const info = computePageCafe();
    ctxCache = info;
    ctxCacheKey = key;
    return { ...info };
  }

  function computePageCafe() {
    const info = { c: null, n: null };
    let w = window;
    for (let i = 0; i < 5 && w; i++) {
      try {
        const r = parseUrl(w.location.href);
        if (r) {
          info.c = info.c || r.c;
          info.n = info.n || r.n;
        }
      } catch { /* 다른 출처 프레임이면 무시 */ }
      if (w === w.parent) break;
      w = w.parent;
    }
    fill(info);
    // 카페번호와 이름을 둘 다 알면 기억해 둠
    if (info.c && info.n && cafeMap[info.c] !== info.n) {
      cafeMap[info.c] = info.n;
      chrome.storage.local.set({ [MAP_KEY]: cafeMap });
    }
    return info;
  }

  // 한쪽만 알면 cafeMap으로 나머지를 채움
  function fill(ids) {
    if (ids.c && !ids.n && cafeMap[ids.c]) ids.n = cafeMap[ids.c];
    if (ids.n && !ids.c) {
      const c = Object.keys(cafeMap).find((k) => cafeMap[k] === ids.n);
      if (c) ids.c = c;
    }
    return ids;
  }

  // 링크 주소 + 현재 카페 정보로 완전한 글 정보 만들기
  function resolve(href, ctx) {
    const parsed = parseUrl(href);
    if (!parsed || !parsed.a) return null;
    const r = { ...parsed }; // 캐시된 결과를 직접 고치지 않도록 복사
    // 카페 정보가 없는 짧은 링크는 지금 보고 있는 카페의 글
    if (!r.c && !r.n) {
      r.c = ctx.c;
      r.n = ctx.n;
    }
    return fill(r);
  }

  // ---------- 비교 ----------
  function same(rec, ids) {
    if (rec.a !== ids.a) return false;
    if (rec.c && ids.c) return rec.c === ids.c;
    if (rec.n && ids.n) return rec.n === ids.n;
    // 예전 버전에서 카페 정보 없이 저장된 기록은 글번호만으로 비교
    return !rec.c && !rec.n;
  }

  function isLiked(ids) {
    const list = index.get(ids.a);
    return !!list && list.some((rec) => same(rec, ids));
  }

  function rebuildIndex() {
    index = new Map();
    Object.values(liked).forEach((rec) => {
      if (!index.has(rec.a)) index.set(rec.a, []);
      index.get(rec.a).push(rec);
    });
  }

  // ---------- 저장소 ----------
  // 예전 형식 { "123:456": 시각, "?:456": 시각 } → 새 형식으로 변환
  function migrate(raw) {
    let changed = false;
    const out = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      if (v && typeof v === "object") {
        out[k] = v;
        return;
      }
      changed = true;
      const [c, a] = k.split(":");
      const rec = { c: c === "?" ? null : c, n: null, a, t: v };
      out[recKey(rec)] = rec;
    });
    return { out, changed };
  }

  function recKey(rec) {
    return `${rec.c || ""}|${rec.n || ""}|${rec.a}`;
  }

  function load() {
    return new Promise((done) => {
      chrome.storage.local.get([STORAGE_KEY, MAP_KEY, MODE_KEY, STYLE_KEY], (r) => {
        cafeMap = r[MAP_KEY] || {};
        mode = r[MODE_KEY] || "bg";
        heartStyle = r[STYLE_KEY] || "text";
        const { out, changed } = migrate(r[STORAGE_KEY]);
        liked = out;
        if (changed) chrome.storage.local.set({ [STORAGE_KEY]: liked });
        rebuildIndex();
        done();
      });
    });
  }

  function setLiked(ids, value) {
    const now = isLiked(ids);
    if (value === now) {
      // 이미 저장돼 있는데 카페 정보가 빠진 기록이면 보충
      if (!value) return;
      const rec = index.get(ids.a).find((r) => same(r, ids));
      if ((rec.c || !ids.c) && (rec.n || !ids.n)) return;
      delete liked[recKey(rec)];
    }
    if (value) {
      const rec = { c: ids.c, n: ids.n, a: ids.a, t: Date.now() };
      liked[recKey(rec)] = rec;
    } else {
      Object.keys(liked).forEach((k) => {
        if (same(liked[k], ids)) delete liked[k];
      });
    }
    rebuildIndex();
    chrome.storage.local.set({ [STORAGE_KEY]: liked });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      liked = migrate(changes[STORAGE_KEY].newValue).out;
      rebuildIndex();
    }
    if (changes[MAP_KEY]) {
      cafeMap = changes[MAP_KEY].newValue || {};
      ctxCache = null;
    }
    if (changes[MODE_KEY]) mode = changes[MODE_KEY].newValue || "bg";
    if (changes[STYLE_KEY]) {
      heartStyle = changes[STYLE_KEY].newValue || "text";
      // 모양이 바뀌면 크기도 달라지므로 하트를 지우고 다시 그림 (여백도 다시 계산됨)
      clearHearts();
    }
    markList();
  });

  // ---------- 1) 게시글 화면: 좋아요 버튼 감시 ----------
  const LIKE_BTN_SELECTOR = [
    ".u_likeit_list_btn",          // 네이버 공통 좋아요 모듈
    ".like_article a",
    ".like_article button",
    "button.like_btn",
    "[class*='LikeButton']"
  ].join(",");

  function readLikeState(btn) {
    return (
      btn.classList.contains("on") ||
      btn.getAttribute("aria-pressed") === "true" ||
      btn.getAttribute("aria-selected") === "true"
    );
  }

  function currentArticle() {
    const ctx = pageCafe();
    const r = parseUrl(location.href);
    if (!r || !r.a) return null;
    return fill({ c: r.c || ctx.c, n: r.n || ctx.n, a: r.a });
  }


  // 좋아요 버튼을 눌렀을 때만 반응:
  // 누르기 전 상태를 기억해 두고, 버튼 모양이 바뀌면 바로 저장/삭제
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest && e.target.closest(LIKE_BTN_SELECTOR);
      if (!btn) return;
      const ids = currentArticle();
      if (!ids) return;
      const before = readLikeState(btn);
      let tries = 0;
      const check = () => {
        const now = readLikeState(btn);
        if (now !== before || ++tries >= 20) {
          setLiked(ids, now); // 바뀌었거나 3초가 지나면 그때 상태로 저장
        } else {
          setTimeout(check, 150);
        }
      };
      setTimeout(check, 100);
    },
    true
  );

  // ---------- 2) 게시판 목록: 표시 ----------
  const ARTICLE_LINK_SELECTOR =
    "a.article, a[href*='articleid='], a[href*='/articles/'], a[href^='/'], a[href^='https://cafe.naver.com/']";
  // 글 본문·글쓰기 에디터·댓글 본문: 문장 속 링크는 목록이 아니므로 표시하지 않음
  const ARTICLE_BODY_SELECTOR = [
    ".article_container", ".ContentRenderer", ".article_viewer", "#tbody", "#postViewArea",
    ".se-main-container", ".se-viewer", ".se-content", ".se_component_wrap", ".se-component", // 스마트에디터
    "[contenteditable='']", "[contenteditable='true']", "textarea",                          // 글쓰기 중인 영역
    ".comment_text_view", ".comment_text_box", ".text_comment"                                // 댓글 본문
  ].join(",");

  // 글 화면의 이동 버튼(이전글·다음글·목록 등): 글 제목이 아니므로 표시하지 않음
  const NAV_AREA_SELECTOR =
    ".ArticleTopBtns, .ArticleBottomBtns, .article_btn, .btn_area, .prev-next, [class*='BaseButton'], [role='button']";
  const NAV_TEXT = /^(이전\s?글|다음\s?글|윗\s?글|아랫\s?글|목록|이전|다음|맨\s?위로|top)$/i;
  function isNavButton(a) {
    if (a.closest(NAV_AREA_SELECTOR)) return true;
    // 우리가 넣은 하트 글자는 빼고 판단
    const text = [...a.childNodes]
      .filter((n) => !(n.classList && n.classList.contains("ncl-nav-heart")))
      .map((n) => n.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return NAV_TEXT.test(text);
  }

  function markList() {
    if (!document.body || document.designMode === "on") return;
    const navLinks = new Set();
    const ctx = pageCafe();
    const current = currentArticle();
    const likedRows = new Map(); // 줄 → 그 줄의 제목 링크

    document.querySelectorAll(ARTICLE_LINK_SELECTOR).forEach((a) => {
      const ids = resolve(a.getAttribute("href"), ctx);
      if (!ids || !isLiked(ids)) return;
      if (a.closest(ARTICLE_BODY_SELECTOR)) return;
      // 이전글·다음글 버튼은 줄을 칠하지 않고 버튼 안에 하트만 넣음
      if (isNavButton(a)) {
        navLinks.add(a);
        return;
      }
      // 지금 보고 있는 글 화면 안의 자기 자신 링크는 건너뜀
      if (current && current.a === ids.a && a.closest(".ArticleContentBox")) return;
      const row = findRow(a, ctx);
      likedRows.set(row, pickTitle(likedRows.get(row), a));
    });

    const showBg = mode === "bg" || mode === "bg_heart";
    const showHeart = mode === "heart" || mode === "bg_heart";

    // 배경색 (바뀔 때만 건드려서 무한 반복 방지)
    document.querySelectorAll(".ncl-liked-row").forEach((el) => {
      if (!showBg || !likedRows.has(el)) el.classList.remove("ncl-liked-row");
    });
    if (showBg) {
      likedRows.forEach((_, row) => {
        if (!row.classList.contains("ncl-liked-row")) row.classList.add("ncl-liked-row");
      });
    }

    // 하트
    placed.forEach((p, row) => {
      const keep = showHeart && likedRows.get(row) === p.title && row.isConnected && p.dot.isConnected;
      if (!keep) unplace(row);
    });
    if (showHeart) {
      likedRows.forEach((title, row) => {
        if (!placed.has(row)) place(row, title);
      });
    }
    // 이전글·다음글 버튼: 표시 방식에 따라 버튼 배경 / 버튼 안 하트
    document.querySelectorAll(".ncl-nav-liked").forEach((a) => {
      if (!showBg || !navLinks.has(a)) a.classList.remove("ncl-nav-liked");
    });
    if (showBg) navLinks.forEach((a) => a.classList.contains("ncl-nav-liked") || a.classList.add("ncl-nav-liked"));
    const navHearts = showHeart ? new Set(navLinks) : new Set();
    document.querySelectorAll(".ncl-nav-heart").forEach((h) => {
      if (!navHearts.has(h.parentElement) || h.dataset.style !== heartStyle) h.remove();
      else navHearts.delete(h.parentElement);
    });
    navHearts.forEach((a) => {
      const h = document.createElement("span");
      h.className = heartStyle === "icon" ? "ncl-nav-heart ncl-icon" : "ncl-nav-heart";
      h.dataset.style = heartStyle;
      h.textContent = heartStyle === "icon" ? "\u2665" : "\u2665 좋아요";
      h.setAttribute("aria-hidden", "true");
      // 버튼 안쪽 글자 묶음(span 등)이 있으면 그 뒤, 없으면 버튼 끝에
      a.appendChild(h);
    });

    // 우리 것이 아닌 하트(예전 버전 등) 정리
    document.querySelectorAll(".ncl-heart-dot").forEach((d) => {
      if (![...placed.values()].some((p) => p.dot === d)) d.remove();
    });
    document.querySelectorAll(".ncl-badge").forEach((b) => b.remove());
    document.querySelectorAll(".ncl-heart").forEach((el) => el.classList.remove("ncl-heart", "ncl-heart-front"));
  }

  // ---------- 하트 위치 정하기 ----------
  // 카드 전체가 링크 하나인 목록(썸네일 목록, 앨범형)은 링크 안에서 실제 제목 글자 부분을 찾음
  const TITLE_HINT = "[class*='title' i], [class*='tit' i], [class*='subject' i], [class*='headline' i], strong, b, h1, h2, h3, h4, h5, h6";
  function titleTextOf(link) {
    const big =
      link.querySelector("img, picture, video, svg, canvas") ||
      [...link.querySelectorAll("*")].filter((e) => isBlock(e) && e.textContent.trim()).length >= 2;
    if (!big) return link;
    for (const el of link.querySelectorAll(TITLE_HINT)) {
      if (el.querySelector("img, picture, video")) continue;
      const text = el.textContent.trim();
      if (text.length >= 2 && el.getClientRects().length) return el;
    }
    // 힌트가 없으면 글자가 있는 첫 블록
    for (const el of link.querySelectorAll("*")) {
      if (isBlock(el) && !el.firstElementChild && el.textContent.trim().length >= 2) return el;
    }
    return link;
  }

  // 줄 → { anchor: 하트를 넣은 요소, dot, title, pad: 원래 inline padding-right(여백을 줬을 때만), w: 폭 }
  const placed = new Map();
  const rowOfAnchor = new Map();

  // 제목에서 바깥쪽으로 한 단계씩 넓혀 가며, 하트가 글자·아이콘·사진·다른 칸과 겹치지 않는
  // 첫 자리에 하트를 놓음. 그런 자리가 없으면 가장 안쪽 칸에 하트 폭만큼 오른쪽 여백을 줘서
  // 글자가 하트 앞에서 줄바꿈(또는 말줄임)되도록 함
  function place(row, link) {
    const title = titleTextOf(link);
    const dot = document.createElement("span");
    dot.className = heartStyle === "icon" ? "ncl-heart-dot ncl-icon" : "ncl-heart-dot";
    dot.textContent = heartStyle === "icon" ? "♥" : "♥ 좋아요";
    dot.setAttribute("aria-hidden", "true");

    const cands = candidates(row, title);
    const p = { anchor: null, dot, title: link, pad: undefined, w: 0 };
    const ok = () => !overlaps(dot, row) && !separated(title, dot, row);
    const titleY = centerY(title);
    let chosen = null;

    // 1) 제목 줄: 안쪽 칸부터 바깥쪽으로, 겹치지 않는 첫 자리
    //    사진·아이콘처럼 움직이지 않는 것과 겹치면 그 바로 왼쪽으로 옮겨서 다시 확인 (글자와 겹치면 다음 칸)
    for (const c of cands) {
      attach(dot, c);
      dot.style.removeProperty("right");
      positionDot(dot, c, titleY);
      if (ok()) { chosen = c; break; }
      if (shiftLeftOfBoxes(dot, c, row) && ok()) { chosen = c; break; }
      dot.style.removeProperty("right");
    }

    // 2) 제목 줄에 여백을 줘서 글자를 비키게 함 (실제로 비켰는지 확인, 안 비키면 되돌림)
    const target = chosen ? null : reserveTarget(title, cands[0]);
    if (!chosen) {
      chosen = cands[0];
      attach(dot, chosen);
      reserve(p, target, dot, 6);
      positionDot(dot, chosen, centerY(title));
      if (!ok()) {
        unreserve(p, dot);
        chosen = null;
      }
    }

    // 3) 제목 줄에 자리가 없으면 같은 칸 아래쪽 줄(작성자·날짜 줄 등)의 오른쪽 빈자리 (줄 안쪽만)
    if (!chosen) {
      const rb = row.getBoundingClientRect();
      for (const y of otherLines(row, title)) {
        if (y - 9 < rb.top || y + 9 > rb.bottom) continue;
        for (const c of cands) {
          const r = c.getBoundingClientRect();
          if (y < r.top || y > r.bottom) continue;
          attach(dot, c);
          dot.style.removeProperty("right");
          positionDot(dot, c, y);
          if (ok() || (shiftLeftOfBoxes(dot, c, row) && ok())) { chosen = c; break; }
          dot.style.removeProperty("right");
        }
        if (chosen) break;
      }
    }

    // 4) 그래도 없으면 제목 줄에 여백을 주고, 비키지 않는 아이콘의 왼쪽으로 하트를 옮김
    if (!chosen) {
      chosen = cands[0];
      attach(dot, chosen);
      let offset = 6;
      reserve(p, target, dot, offset);
      positionDot(dot, chosen, centerY(title));
      for (let i = 0; i < 3; i++) {
        const ob = findOverlap(dot, row);
        if (!ob) break;
        const a = chosen.getBoundingClientRect();
        const edge = a.right - (parseFloat(getComputedStyle(chosen).borderRightWidth) || 0);
        const next = Math.ceil(edge - ob.left + 4);
        if (next <= offset || next > a.width - dot.getBoundingClientRect().width) break;
        offset = next;
        reserve(p, target, dot, offset);
        positionDot(dot, chosen, centerY(title));
      }
    }
    p.anchor = chosen;
    p.w = chosen.getBoundingClientRect().width;
    placed.set(row, p);
    rowOfAnchor.set(chosen, row);
    resizeObs.observe(chosen);
  }


  // 여백을 줄 대상: 제목이 혼자 한 줄인 블록이면 제목에만 (같은 칸의 작성자·날짜 줄은 그대로),
  // 제목 뒤에 N 아이콘 등이 나란히 붙는 가로 정렬(flex/grid) 줄이면 그 줄 전체에, 아니면 그 칸에
  function reserveTarget(title, cell) {
    const parentDisplay = title.parentElement ? getComputedStyle(title.parentElement).display : "";
    if (/flex|grid/.test(parentDisplay)) return title.parentElement;
    return isBlock(title) ? title : cell;
  }

  function reserve(p, target, dot, offset) {
    if (p.pad === undefined) {
      p.pad = target.style.getPropertyValue("padding-right");
      p.padBase = parseFloat(getComputedStyle(target).paddingRight) || 0;
      p.padTarget = target;
    }
    dot.style.setProperty("right", offset + "px", "important");
    const w = dot.getBoundingClientRect().width;
    target.style.setProperty("padding-right", Math.ceil(p.padBase + offset + w + 4) + "px", "important");
  }

  function unreserve(p, dot) {
    if (p.pad === undefined) return;
    if (p.pad) p.padTarget.style.setProperty("padding-right", p.pad);
    else p.padTarget.style.removeProperty("padding-right");
    dot.style.removeProperty("right");
    p.pad = undefined;
  }

  // 제목(눈에 보이는 부분)의 세로 가운데
  function centerY(title) {
    const t = visibleBox(title, title.getBoundingClientRect());
    const r = t || title.getBoundingClientRect();
    return (r.top + r.bottom) / 2;
  }

  // 제목 아래쪽에 있는 다른 글자 줄들의 세로 가운데 (위에서부터)
  function otherLines(row, title) {
    const tb = title.getBoundingClientRect();
    const ys = [];
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode() && ys.length < 6) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || title.contains(t)) continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        if (r.height < 4 || r.top < tb.bottom - 1) continue;
        const y = (r.top + r.bottom) / 2;
        if (!ys.some((v) => Math.abs(v - y) < 6)) ys.push(y);
      }
    }
    return ys.sort((a, b) => a - b);
  }

  function unplace(row) {
    const p = placed.get(row);
    if (!p) return;
    p.dot.remove();
    if (p.pad !== undefined) {
      if (p.pad) p.padTarget.style.setProperty("padding-right", p.pad);
      else p.padTarget.style.removeProperty("padding-right");
    }
    if (!p.anchor.querySelector(":scope > .ncl-heart-dot")) p.anchor.classList.remove("ncl-pos");
    resizeObs.unobserve(p.anchor);
    rowOfAnchor.delete(p.anchor);
    placed.delete(row);
  }

  function clearHearts() {
    [...placed.keys()].forEach(unplace);
  }

  function replace(row) {
    const p = placed.get(row);
    if (!p) return;
    const title = p.title;
    unplace(row);
    if (row.isConnected && title.isConnected) place(row, title);
  }

  function isBlock(el) {
    const d = getComputedStyle(el).display;
    return d === "block" || d === "-webkit-box" || d === "flow-root" || d === "list-item";
  }

  // 하트를 넣을 후보: 제목을 감싼 블록 요소들 (안쪽 → 바깥쪽, 줄까지)
  // 글자 사이에 끼는 인라인 요소와, 내용 크기에 맞춰 줄어드는 inline-block은 제외
  function candidates(row, title) {
    const out = [];
    const stop = row.tagName === "TR" ? title.closest("td") || row : row;
    let el = title.parentElement;
    while (el && out.length < 6) {
      const d = getComputedStyle(el).display;
      if (!d.startsWith("inline") && d !== "contents" && d !== "none") out.push(el);
      if (el === stop) break;
      el = el.parentElement;
    }
    if (!out.length) out.push(stop);
    return out;
  }

  function attach(dot, anchor) {
    if (dot.parentElement !== anchor) anchor.appendChild(dot);
    if (getComputedStyle(anchor).position === "static") anchor.classList.add("ncl-pos");
    document.querySelectorAll(".ncl-pos").forEach((el) => {
      if (el !== anchor && !el.querySelector(":scope > .ncl-heart-dot")) el.classList.remove("ncl-pos");
    });
  }

  // 하트의 세로 위치를 화면 기준 y(줄의 가운데)에 맞춤
  function positionDot(dot, anchor, y) {
    const a = anchor.getBoundingClientRect();
    if (!a.height) return;
    const border = parseFloat(getComputedStyle(anchor).borderTopWidth) || 0;
    dot.style.setProperty("top", Math.round(y - a.top - border + anchor.scrollTop) + "px", "important");
  }

  // 화면에서 실제로 보이는 부분 (overflow:hidden 으로 잘린 부분 제외)
  function visibleBox(el, r) {
    let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      // 말줄임(…)은 글 상자(여백 안쪽) 끝에서 잘림
      const pr = cs.textOverflow === "ellipsis" ? parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) || 0 : 0;
      if (cs.overflowX !== "visible") { box.left = Math.max(box.left, c.left); box.right = Math.min(box.right, c.right - pr); }
      if (cs.overflowY !== "visible") { box.top = Math.max(box.top, c.top); box.bottom = Math.min(box.bottom, c.bottom); }
      if (box.right <= box.left || box.bottom <= box.top) return null;
    }
    return box;
  }

  // 하트가 사진·아이콘(글자가 아닌 것)과 겹치면 그 바로 왼쪽으로 옮김. 옮겼으면 true
  function shiftLeftOfBoxes(dot, anchor, row) {
    let moved = false;
    for (let i = 0; i < 3; i++) {
      const ob = findOverlap(dot, row);
      if (!ob || ob.text) break;
      const a = anchor.getBoundingClientRect();
      const edge = a.right - (parseFloat(getComputedStyle(anchor).borderRightWidth) || 0);
      const cur = parseFloat(dot.style.getPropertyValue("right")) || 6;
      const next = Math.ceil(edge - ob.left + 4);
      if (next <= cur || next > a.width - dot.getBoundingClientRect().width) break;
      dot.style.setProperty("right", next + "px", "important");
      moved = true;
    }
    return moved;
  }

  // 제목과 하트 사이에 사진·썸네일 같은 다른 덩어리가 끼어 있는지 (끼어 있으면 하트가 제목과 동떨어져 보임)
  function separated(title, dot, row) {
    const d = dot.getBoundingClientRect();
    const t = visibleBox(title, title.getBoundingClientRect());
    if (!t || !d.width || d.left - t.right < 24) return false;
    const L = t.right, R = d.left, T = d.top, B = d.bottom;
    for (const el of row.querySelectorAll("img, picture, video, svg, canvas, [class*='thumb' i], [class*='img' i]")) {
      if (title.contains(el) || el.contains(title) || el === dot) continue;
      for (const r of el.getClientRects()) {
        if (r.width > 20 && r.height > 20 && r.right > L && r.left < R && r.bottom > T && r.top < B) return true;
      }
    }
    return false;
  }

  // 하트가 줄 안의 글자·아이콘·사진과 겹치는지 (잘려서 안 보이는 글자는 무시)
  function overlaps(dot, row) {
    return !!findOverlap(dot, row);
  }

  // 배경색·그림이 칠해진 작은 상자 = 아이콘 (안에 화면에 안 보이는 설명 글자가 있어도)
  function isPaintedIcon(el) {
    const cs = getComputedStyle(el);
    const painted = cs.backgroundImage !== "none" || !(cs.backgroundColor === "transparent" || cs.backgroundColor.endsWith(", 0)"));
    if (!painted) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.width <= 48 && r.height <= 48;
  }

  // 하트와 겹치는 것(글자·아이콘·사진)의 화면 위치, 없으면 null
  function findOverlap(dot, row) {
    const d = dot.getBoundingClientRect();
    if (!d.width) return null;
    const L = d.left - 4, R = d.right + 2, T = d.top, B = d.bottom;
    let found = null;
    const hit = (el, r) => {
      if (!r.width || !r.height) return false;
      if (!(r.right > L && r.left < R && r.bottom > T && r.top < B)) return false;
      const v = visibleBox(el, r);
      // 화면에서 거의 안 보이는(숨김 처리된 설명 글자 등) 것은 무시
      if (!v || v.right - v.left < 2 || v.bottom - v.top < 2) return false;
      if (v.right > L && v.left < R && v.bottom > T && v.top < B) {
        found = { left: v.left, right: v.right, top: v.top, bottom: v.bottom, text: el.nodeType === 3, el: el.nodeType === 1 ? el : el.parentElement };
        return true;
      }
      return false;
    };
    for (const el of row.querySelectorAll("*")) {
      if (el === dot || dot.contains(el) || el.contains(dot)) continue;
      // 상자로 판단: 이미지, 글자 없는 맨 안쪽 요소, 칠해진 작은 아이콘 (글자는 아래에서 글자 영역으로 판단)
      if (el.tagName !== "IMG" && (el.firstElementChild || el.textContent.trim()) && !isPaintedIcon(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0" && el.tagName !== "IMG") continue;
      for (const r of el.getClientRects()) if (hit(el, r)) return found;
    }
    // CSS 장식(::before/::after)으로 그린 아이콘 (새 글 N 표시 등)
    for (const el of row.querySelectorAll("*")) {
      if (el === dot || dot.contains(el)) continue;
      for (const ps of ["::before", "::after"]) {
        const r = pseudoRect(el, ps, d);
        if (r && hit(el, r)) return found;
      }
    }
    // 글자 (요소 안에 섞여 있는 글자 포함)
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || dot.contains(t)) continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (hit(t, r)) return found; // 글자를 감싼 상자의 잘림까지 반영
    }
    return null;
  }

  // CSS 장식(::before/::after) 아이콘의 대략적인 위치 (skip: 계산에서 뺄 우리 하트 위치)
  function pseudoRect(el, ps, skip) {
    const cs = getComputedStyle(el, ps);
    if (cs.content === "none" || cs.content === "normal" || cs.display === "none") return null;
    const w = parseFloat(cs.width) || 0, h = parseFloat(cs.height) || 0;
    if (!w || !h) return null;
    // 내용(글자·요소)의 첫/마지막 위치 바로 앞/뒤에 그려짐
    // 바로 아래 요소·글자의 상자 기준 (안쪽에서 말줄임으로 잘린 글자는 보지 않음)
    const rs = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 1) {
        if (n.classList.contains("ncl-heart-dot") || n.classList.contains("ncl-nav-heart")) continue;
        const cs2 = getComputedStyle(n);
        if (cs2.position === "absolute" || cs2.position === "fixed" || cs2.display === "none") continue;
        rs.push(...n.getClientRects());
      } else if (n.nodeType === 3 && n.textContent.trim()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        rs.push(...range.getClientRects());
      }
    }
    const box = el.getBoundingClientRect();
    const own = getComputedStyle(el);
    const gap = /flex|grid/.test(own.display) ? parseFloat(own.columnGap) || 0 : 0;
    let left, cy;
    if (ps === "::after") {
      const last = rs.length ? rs.reduce((a, b) => (b.bottom > a.bottom + 1 || (Math.abs(b.bottom - a.bottom) <= 1 && b.right > a.right) ? b : a)) : null;
      left = (last ? last.right + gap : box.left) + (parseFloat(cs.marginLeft) || 0);
      cy = last ? (last.top + last.bottom) / 2 : (box.top + box.bottom) / 2;
    } else {
      const first = rs[0];
      left = (first ? first.left - gap : box.left) - w - (parseFloat(cs.marginRight) || 0);
      cy = first ? (first.top + first.bottom) / 2 : (box.top + box.bottom) / 2;
    }
    return { left, right: left + w, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h };
  }

  // 폭이 바뀌면(창 크기, 확대, 숨겨졌던 탭이 열림, 사이드바 접힘 등) 하트 자리를 다시 계산
  const resizeObs = new ResizeObserver((entries) => {
    for (const e of entries) {
      const row = rowOfAnchor.get(e.target);
      const p = row && placed.get(row);
      if (!p) continue;
      const w = e.target.getBoundingClientRect().width;
      if (Math.abs(w - p.w) > 1) replace(row);
    }
  });

  function replaceAll() {
    [...placed.keys()].forEach(replace);
  }
  // 글꼴이 늦게 로딩되면 글자 폭이 달라지므로 다시 계산
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(replaceAll);
  window.addEventListener("load", replaceAll);

  // 배경을 칠할 "한 줄" 찾기
  // tr/li를 우선 쓰되, 그 안에 다른 글 링크가 섞여 있으면 여러 글을 감싼 큰 상자이므로
  // 링크에서 위로 올라가며 이 글만 담고 있는 가장 큰 요소를 대신 씀
  function findRow(a, ctx) {
    const row = a.closest("tr, li");
    if (row && onlyThisArticle(row, a, ctx)) return row;
    let el = a;
    for (let i = 0; i < 6; i++) {
      const p = el.parentElement;
      if (!p || p === row || p === document.body || !onlyThisArticle(p, a, ctx)) break;
      el = p;
    }
    return el;
  }

  function onlyThisArticle(box, a, ctx) {
    const mine = resolve(a.getAttribute("href"), ctx);
    for (const other of box.querySelectorAll(ARTICLE_LINK_SELECTOR)) {
      if (other === a) continue;
      const ids = resolve(other.getAttribute("href"), ctx);
      if (ids && ids.a !== mine.a) return false;
    }
    return true;
  }

  // 같은 줄의 링크 중 제목 링크를 고름
  // a.article > 제목다운 이름(title·tit·subject)이나 굵은 글씨 > 미리보기·요약이 아닌 것 > 글자 수(최대 60자까지만 반영)
  const DESC_RE = /desc|preview|summary|content|cont_|txt_area|excerpt|snippet/i;
  function titleScore(el) {
    let score = 0;
    if (el.classList.contains("article")) score += 10000;
    if (/title|tit|subject|headline/i.test(el.className) || el.querySelector("strong, b, h1, h2, h3, h4, [class*='title' i], [class*='tit' i], [class*='subject' i]")) score += 3000;
    if (DESC_RE.test(el.className)) score -= 3000;
    const cs = getComputedStyle(el.querySelector("strong, b, [class*='tit' i]") || el);
    if ((parseInt(cs.fontWeight, 10) || 400) >= 600) score += 500;
    score += Math.min(parseFloat(cs.fontSize) || 0, 40) * 10;
    score += Math.min(el.textContent.trim().length, 60);
    return score;
  }
  function pickTitle(prev, a) {
    if (!prev) return a;
    return titleScore(a) > titleScore(prev) ? a : prev;
  }

  // ---------- 페이지 변화 감시 ----------
  // 새 링크가 화면에 추가될 때만, 다음 화면 그리기 직전에 한 번 목록 표시
  let rafPending = false;
  function scheduleMark() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      markList();
    });
  }

  // 새로 추가된 노드에 링크가 들어 있는지 (우리가 붙인 하트는 제외)
  function hasLink(node) {
    if (node.nodeType !== 1) return false;
    return node.tagName === "A" || (node.firstElementChild !== null && node.querySelector("a") !== null);
  }

  function onMutations(records) {
    if (rafPending) return;
    for (const rec of records) {
      // 줄을 재사용하면서 링크 주소만 바꾸는 화면(페이지 이동 등)
      if (rec.type === "attributes") {
        scheduleMark();
        return;
      }
      for (const n of rec.addedNodes) {
        if (hasLink(n)) {
          scheduleMark();
          return;
        }
      }
    }
  }

  load().then(() => {
    markList();
    // 주소가 바뀌는 SPA 이동 대응
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleMark();
      }
    }, 500);
    // 노드 추가와 링크 주소(href) 변경만 감시
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"]
    });
  });
})();
