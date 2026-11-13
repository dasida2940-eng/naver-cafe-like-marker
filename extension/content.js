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
  const ENABLED_KEY = "enabled";       // false면 확장 전체가 꺼짐 (표시·기록·가져오기·이동 모두 안 함)

  let liked = {};
  let cafeMap = {};
  let mode = "bg";
  let heartStyle = "text";
  let enabled = true;
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
      chrome.storage.local.get([STORAGE_KEY, MAP_KEY, MODE_KEY, STYLE_KEY, ENABLED_KEY], (r) => {
        enabled = r[ENABLED_KEY] !== false;
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
    if (changes[ENABLED_KEY]) {
      enabled = changes[ENABLED_KEY].newValue !== false;
      // 끄면 하던 가져오기·이동도 멈춤 (표시는 아래 markList에서 모두 지워짐)
      if (!enabled) { stopRequested = true; jumpStop = true; }
    }
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
      if (!enabled) return; // 꺼져 있으면 기록하지 않음
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

    // 꺼져 있으면 아무 줄도 고르지 않음 → 아래에서 기존 표시가 모두 지워짐
    if (enabled) document.querySelectorAll(ARTICLE_LINK_SELECTOR).forEach((a) => {
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
      resetPos(dot);
      positionDot(dot, c, titleY);
      if (ok()) { chosen = c; break; }
      if (shiftLeftOfBoxes(dot, c, row) && ok()) { chosen = c; break; }
      dot.style.removeProperty("right");
    }

    // 1-2) 오른쪽 끝에 자리가 없으면, 제목 줄 내용이 끝나는 곳 바로 뒤 (제목 … [2] ♥ 좋아요)
    if (!chosen) {
      for (const c of cands) {
        attach(dot, c);
        resetPos(dot);
        positionDot(dot, c, titleY);
        if (placeAfterContent(dot, c, row) && ok()) { chosen = c; break; }
      }
      if (!chosen) resetPos(dot);
    }
    if (DEBUG) debug("자리 정하기", { title: norm(title.textContent).slice(0, 20), step1: !!chosen && !dot.style.getPropertyValue("left") ? "오른쪽 끝" : chosen ? "내용 뒤" : "실패", obstacle: describe(findOverlap(dot, row)), separated: separated(title, dot, row) });

    // 2) 제목 줄에 여백을 줘서 글자를 비키게 함 (실제로 비켰는지 확인, 안 비키면 되돌림)
    //    줄바꿈 안 되는 제목이 여백 때문에 잘리거나 옆 칸으로 넘치면 여백을 쓰지 않음
    const target = chosen ? null : reserveTarget(title, cands[0]);
    let canReserve = !chosen;
    if (!chosen) {
      chosen = cands[0];
      attach(dot, chosen);
      resetPos(dot);
      const titleBefore = lostWidth(link, "title"), otherBefore = lostWidth(link, "other");
      const fits = () => lostWidth(link, "title") <= titleBefore + 1 && lostWidth(link, "other") <= otherBefore + 1;
      const nowrap = /nowrap|pre$/.test(getComputedStyle(link).whiteSpace);
      // 한 줄 고정 줄: 제목만 말줄임(…)으로 줄여서 뒤의 아이콘·댓글 수와 하트가 모두 보이게 함
      //   제목… 🖼 [2] ♥ 좋아요
      const shrinkToFit = () => {
        if (!shrinkTitle(p, link)) return false;
        for (let i = 0; i < 5; i++) {
          // 사이 띄어쓰기 등으로 조금 모자라면 넘친/덮인 만큼 더 줄임
          let over = lostWidth(link, "other") - 1;
          positionDot(dot, chosen, centerY(title));
          const ob = findOverlap(dot, row);
          if (ob && ob.left >= link.getBoundingClientRect().left - 1) over = Math.max(over, ob.right - dot.getBoundingClientRect().left + 4);
          if (over <= 0) break;
          const w = parseFloat(link.style.getPropertyValue("max-width")) - Math.ceil(over) - 2;
          if (w < 40) break;
          link.style.setProperty("max-width", w + "px", "important");
        }
        positionDot(dot, chosen, centerY(title));
        const good = fits() && ok();
        if (DEBUG) debug("제목 줄여서 맞추기", { ok: good });
        if (!good) unshrink(p);
        return good;
      };
      reserve(p, target, dot, 6);
      positionDot(dot, chosen, centerY(title));
      let done = false;
      if (nowrap && (lostWidth(link, "other") > 1 || !ok())) done = shrinkToFit();
      if (!done) {
        canReserve = fits();
        positionDot(dot, chosen, centerY(title));
        if (!canReserve) {
          unreserve(p, dot);
          chosen = null;
          if (DEBUG) debug("여백을 주면 다른 내용이 가려져서 여백 안 씀", {});
        } else if (!ok()) {
          // 여백 때문에 뒤의 아이콘 등이 다음 줄로 내려가 새 자리가 생겼을 수 있음 → 여백을 둔 채 아래 줄 확인
          chosen = tryOtherLines(dot, cands, row, title, ok);
          if (!chosen) unreserve(p, dot);
        }
      }
    }

    // 2-2) 표처럼 배치된 줄(네이버 전체글보기 등)은 안쪽 상자에 여백을 줘도 표가 늘어날 뿐 내용이 안 비킴
    //      → 바깥 칸(board-list, td …)에 차례로 여백을 줘서, 내용이 실제로 비키고 아무것도 안 가려지는 곳을 씀
    if (!chosen && cands.length > 1) {
      const titleBefore = lostWidth(link, "title"), otherBefore = lostWidth(link, "other");
      for (const c of cands.slice(1)) {
        attach(dot, c);
        resetPos(dot);
        reserve(p, c, dot, 6);
        positionDot(dot, c, centerY(title));
        if (ok() && lostWidth(link, "title") <= titleBefore + 1 && lostWidth(link, "other") <= otherBefore + 1) {
          chosen = c;
          canReserve = true;
          if (DEBUG) debug("바깥 칸에 여백", { el: describe({ el: c, text: false, left: 0, right: 0 }) });
          break;
        }
        unreserve(p, dot);
      }
    }

    // 3) 제목 줄에 자리가 없으면 같은 칸 아래쪽 줄(작성자·날짜 줄 등)의 오른쪽 빈자리 (줄 안쪽만)
    if (!chosen) chosen = tryOtherLines(dot, cands, row, title, ok);

    // 4) 그래도 없으면 제목 줄에 여백을 주고, 비키지 않는 아이콘의 왼쪽으로 하트를 옮김
    if (!chosen && !canReserve) {
      // 여백을 못 주는 줄: 제목 줄 오른쪽 끝에 두되, 비키지 않는 아이콘이 있으면 그 왼쪽으로 (글자는 덮지 않음)
      chosen = cands[0];
      attach(dot, chosen);
      resetPos(dot);
      positionDot(dot, chosen, titleY);
      const before = dot.style.getPropertyValue("right");
      if (!(shiftLeftOfBoxes(dot, chosen, row) && !(findOverlap(dot, row) || {}).text)) {
        if (before) dot.style.setProperty("right", before, "important"); else dot.style.removeProperty("right");
      }
      if (DEBUG) debug("마지막 단계(여백 없이)", { obstacle: describe(findOverlap(dot, row)) });
    }
    if (!chosen) {
      chosen = cands[0];
      attach(dot, chosen);
      resetPos(dot);
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
        const prev = offset;
        offset = next;
        reserve(p, target, dot, offset);
        positionDot(dot, chosen, centerY(title));
        // 옮긴 자리가 글자를 덮으면 되돌림 (글자를 가리는 것보다 아이콘 옆에 붙는 편이 나음)
        const ob2 = findOverlap(dot, row);
        if (ob2 && ob2.text) {
          offset = prev;
          reserve(p, target, dot, offset);
          positionDot(dot, chosen, centerY(title));
          break;
        }
      }
      if (DEBUG) debug("마지막 단계(여백+옮기기)", { offset, obstacle: describe(findOverlap(dot, row)) });
    }
    p.anchor = chosen;
    p.w = chosen.getBoundingClientRect().width;
    const rb = row.getBoundingClientRect();
    p.rw = rb.width;
    p.rh = rb.height;
    placed.set(row, p);
    rowOfAnchor.set(chosen, row);
    rowOfAnchor.set(row, row);
    resizeObs.observe(chosen);
    resizeObs.observe(row);
    // 자리를 정한 뒤 아이콘·글꼴이 늦게 적용돼 줄바꿈이 바뀌는 경우를 대비해 조금 뒤에 다시 확인
    [600, 2000].forEach((ms) => setTimeout(() => recheck(row, p), ms));
  }

  // 자리를 정한 뒤 글자와 겹치게 됐으면 다시 자리를 잡음 (한 줄당 최대 3번)
  const recheckCount = new WeakMap();
  function recheck(row, p) {
    if (placed.get(row) !== p || !p.dot.isConnected) return;
    const n = recheckCount.get(row) || 0;
    if (n >= 3) return;
    const rb = row.getBoundingClientRect();
    const d = p.dot.getBoundingClientRect();
    const outside = d.top < rb.top - 1 || d.bottom > rb.bottom + 1;
    if (outside || overlaps(p.dot, row) || separated(titleTextOf(p.title), p.dot, row)) {
      recheckCount.set(row, n + 1);
      replace(row);
    }
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

  // 여백 때문에 안 보이게 된 내용의 폭 (하트 자리를 만들다 다른 것을 가리지 않았는지 확인용)
  // part: "title" = 제목 글자, "other" = 제목 외 내용
  // - 제목 외 내용(아이콘·사진·댓글 수 등): 상자에 잘리거나 말줄임되거나 칸 밖으로 넘친 폭
  // - 제목 글자: 칸 밖(옆 칸)으로 넘친 폭만 (상자 안에서 잘리거나 말줄임되는 건 원래 그렇게 보이는 것)
  function lostWidth(link, part) {
    const cell = link.closest("td, th, li") || link.parentElement;
    if (!cell) return 0;
    const cb = cell.getBoundingClientRect();
    const cellRight = cb.right - (parseFloat(getComputedStyle(cell).paddingRight) || 0) + 1;
    let lost = 0, lostTitle = 0;
    const measure = (node, r, isTitle) => {
      if (r.width < 2 || r.height < 2) return;
      let clipped = false;
      for (let a = node.nodeType === 1 ? node : node.parentElement; a; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== "visible") { clipped = true; break; }
        if (a === cell) break;
      }
      if (isTitle) {
        if (!clipped) lostTitle += Math.max(0, r.right - Math.max(cellRight, r.left));
        return;
      }
      const v = visibleBox(node, r);
      const shown = v ? Math.max(0, Math.min(v.right, cellRight) - v.left) : 0;
      lost += Math.max(0, r.width - shown);
    };
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || t.parentElement.closest(".ncl-heart-dot, .blind")) continue;
      range.selectNodeContents(t);
      const isTitle = link.contains(t);
      for (const r of range.getClientRects()) measure(t, r, isTitle);
    }
    for (const el of cell.querySelectorAll("img, svg")) {
      if (link.contains(el)) continue;
      for (const r of el.getClientRects()) measure(el, r, false);
    }
    return part === "title" ? lostTitle : lost;
  }

  // 한 줄 고정(줄바꿈 안 됨) 줄에서 여백 때문에 뒤의 아이콘·댓글 수가 밀려나 가려지면,
  // 제목만 말줄임(…)으로 줄여서 나머지가 보이게 함: 제목… 🖼 [3] ♥ 좋아요
  function shrinkTitle(p, link) {
    const box = link.parentElement;
    if (!box) return false;
    const lr = link.getBoundingClientRect();
    let restRight = lr.right;
    for (let n = link.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 1 && n.classList.contains("ncl-heart-dot")) continue;
      const rects = n.nodeType === 1 ? [...n.getClientRects()] : n.nodeType === 3 && n.textContent.trim() ? (() => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()]; })() : [];
      for (const r of rects) if (r.width && r.top < lr.bottom && r.bottom > lr.top) restRight = Math.max(restRight, r.right);
    }
    const cs = getComputedStyle(box);
    const br = box.getBoundingClientRect();
    const contentRight = br.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    const avail = Math.floor(contentRight - lr.left - (restRight - lr.right) - 2);
    if (avail < 40 || avail >= lr.width) return false;
    if (p.shrink === undefined) p.shrink = { el: link, style: link.getAttribute("style") };
    const st = link.style;
    st.setProperty("display", "inline-block", "important");
    st.setProperty("max-width", avail + "px", "important");
    st.setProperty("overflow", "hidden", "important");
    st.setProperty("text-overflow", "ellipsis", "important");
    st.setProperty("white-space", "nowrap", "important");
    st.setProperty("vertical-align", "top", "important");
    return true;
  }

  function unshrink(p) {
    if (p.shrink === undefined) return;
    const { el, style } = p.shrink;
    if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style);
    p.shrink = undefined;
  }

  function unreserve(p, dot) {
    unshrink(p);
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

  // 제목 아래쪽에 있는 다른 줄들의 세로 가운데 (위에서부터)
  // 글자 줄뿐 아니라 아이콘·사진만 있는 줄도 포함 (긴 제목 때문에 아이콘이 다음 줄로 넘어간 경우)
  function otherLines(row, title) {
    const tb = title.getBoundingClientRect();
    const ys = [];
    const add = (r) => {
      if (r.height < 4 || r.top < tb.bottom - 1) return;
      const y = (r.top + r.bottom) / 2;
      if (!ys.some((v) => Math.abs(v - y) < 6)) ys.push(y);
    };
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode() && ys.length < 6) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || title.contains(t) || (t.parentElement && t.parentElement.closest(".ncl-heart-dot"))) continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) add(r);
    }
    for (const el of row.querySelectorAll("img, svg, picture, video")) {
      if (title.contains(el) || el.closest(".ncl-heart-dot")) continue;
      for (const r of el.getClientRects()) if (r.width >= 4) add(r);
    }
    return ys.sort((a, b) => a - b).slice(0, 6);
  }

  function unplace(row) {
    const p = placed.get(row);
    if (!p) return;
    p.dot.remove();
    resizeObs.unobserve(row);
    rowOfAnchor.delete(row);
    unshrink(p);
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
    // 말줄임(…)은 그 상자 안에서 바로 흘러가는 글자에만 적용됨
    // (따로 배치된 요소 = 위치 지정·띄움·블록 안의 내용은 여백 칸에 있어도 그대로 보임)
    let inline = true;
    const flowCheck = (e) => {
      if (!inline || e.nodeType !== 1) return;
      const cs = getComputedStyle(e);
      if (!cs.display.startsWith("inline") || cs.float !== "none" || cs.position === "absolute" || cs.position === "fixed") inline = false;
    };
    flowCheck(el);
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") { flowCheck(p); continue; }
      const c = p.getBoundingClientRect();
      // 말줄임(…)은 글 상자(여백 안쪽) 끝에서 잘림
      const pr = inline && cs.textOverflow === "ellipsis" ? parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) || 0 : 0;
      if (cs.overflowX !== "visible") { box.left = Math.max(box.left, c.left); box.right = Math.min(box.right, c.right - pr); }
      if (cs.overflowY !== "visible") { box.top = Math.max(box.top, c.top); box.bottom = Math.min(box.bottom, c.bottom); }
      if (box.right <= box.left || box.bottom <= box.top) return null;
      flowCheck(p);
    }
    return box;
  }

  function tryOtherLines(dot, cands, row, title, ok) {
    const rb = row.getBoundingClientRect();
    const half = (dot.getBoundingClientRect().height || 17) / 2;
    for (let y of otherLines(row, title)) {
      // 줄 끝에 붙은 줄이면 하트가 줄 밖으로 나가지 않게 안쪽으로 살짝 끌어올림
      if (y + half > rb.bottom) y = rb.bottom - half - 1;
      if (y - half < rb.top) continue;
      for (const c of cands) {
        const r = c.getBoundingClientRect();
        if (y < r.top || y > r.bottom) continue;
        attach(dot, c);
        const keepRight = dot.style.getPropertyValue("right");
        dot.style.removeProperty("left");
        positionDot(dot, c, y);
        if (ok() || (shiftLeftOfBoxes(dot, c, row) && ok())) return c;
        if (keepRight) dot.style.setProperty("right", keepRight, "important");
        else dot.style.removeProperty("right");
      }
    }
    return null;
  }

  function resetPos(dot) {
    dot.style.removeProperty("right");
    dot.style.removeProperty("left");
  }

  // 제목 줄에서 내용(글자·아이콘)이 끝나는 곳 바로 뒤에 하트를 놓음. 칸 안에 다 보이면 true
  function placeAfterContent(dot, anchor, row) {
    const d = dot.getBoundingClientRect();
    if (!d.width) return false;
    let end = -Infinity;
    const band = (r) => r.width > 0 && r.height > 0 && r.bottom > d.top + 2 && r.top < d.bottom - 2;
    for (const el of anchor.querySelectorAll("*")) {
      if (el === dot || dot.contains(el)) continue;
      if (el.tagName !== "IMG" && el.tagName.toLowerCase() !== "svg" && (el.firstElementChild || el.textContent.trim()) && !isPaintedIcon(el)) continue;
      for (const r of el.getClientRects()) {
        const v = band(r) && visibleBox(el, r);
        if (v && v.right - v.left >= 2) end = Math.max(end, v.right);
      }
    }
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || dot.contains(t)) continue;
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) {
        const v = band(r) && visibleBox(t, r);
        if (v && v.right - v.left >= 2) end = Math.max(end, v.right);
      }
    }
    if (end === -Infinity) return false;
    const a = anchor.getBoundingClientRect();
    const left = end - a.left - (parseFloat(getComputedStyle(anchor).borderLeftWidth) || 0) + 6;
    dot.style.setProperty("left", Math.ceil(left) + "px", "important");
    dot.style.setProperty("right", "auto", "important");
    const n = dot.getBoundingClientRect();
    const v = visibleBox(dot, n);
    const rb = row.getBoundingClientRect();
    // 잘리지 않고 줄 안에 다 보여야 함
    return !!v && v.right >= n.right - 1 && v.left <= n.left + 1 && n.right <= rb.right;
  }

  // 진단 모드: 개발자 도구 콘솔에서 localStorage.setItem("ncl-debug", "1") 후 새로고침
  const DEBUG = (() => { try { return localStorage.getItem("ncl-debug") === "1"; } catch (e) { return false; } })();
  function debug(label, info) {
    if (DEBUG) console.log("[좋아요 표시]", label, info);
  }
  function describe(ob) {
    if (!ob) return null;
    const el = ob.el;
    return (ob.text ? "글자 " : "상자 ") + (el ? el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") : "") + ` (${Math.round(ob.left)}~${Math.round(ob.right)})`;
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
  // 폭이 바뀌거나 줄 높이(줄바꿈)가 바뀌면 다시 계산 (늦게 그려지는 아이콘·글꼴 등)
  const resizeObs = new ResizeObserver((entries) => {
    const rows = new Set();
    for (const e of entries) {
      const row = rowOfAnchor.get(e.target);
      const p = row && placed.get(row);
      if (!p) continue;
      const r = e.target.getBoundingClientRect();
      if (e.target === row) {
        if (Math.abs(r.width - p.rw) > 1 || Math.abs(r.height - p.rh) > 1) rows.add(row);
      } else if (Math.abs(r.width - p.w) > 1) rows.add(row);
    }
    rows.forEach(replace);
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


  // ---------- 3) 카페 "나의 활동 → 좋아요한 글" 목록에서 기록 가져오기 ----------
  // 좋아요한 글 탭을 열면 화면 구석에 패널만 띄우고, 버튼을 눌렀을 때만 페이지를 넘기며 읽음
  // 처음엔 끝까지("모두 가져오기"), 그다음부터는 이미 가진 글만 있는 페이지에서 멈춤("새 좋아요만 확인")
  // 추가만 하고 기존 기록은 지우지 않음
  const IMPORT_KEY = "likeImport";          // { 카페: { complete: 끝까지 읽었는지, at: 시각 } }
  const CRAWL_SESSION = "ncl-like-crawl";    // 페이지가 새로 로드되는 목록에서 이어 읽기용
  const LIKED_TAB_TEXT = /^좋아요\s?한\s?글(\s*\(?\d[\d,]*\)?)?$/;
  const NOT_LIST_SELECTOR =
    "aside, nav, header, footer, [role='navigation'], [class*='side' i], [class*='lnb' i], [class*='gnb' i], " +
    "[class*='popular' i], [class*='best' i], [class*='recommend' i], [class*='ranking' i], [class*='banner' i]";
  const ACTIVE_CLASS = /(^|[-_])(on|active|selected|current|checked|is[-_]?active|is[-_]?selected)([-_]|$)/i;
  let crawling = false;
  let importTimer = 0;

  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function looksActive(el) {
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) {
      const sel = e.getAttribute("aria-selected");
      const cur = e.getAttribute("aria-current");
      if (sel === "true" || (cur && cur !== "false")) return true;
      if ([...e.classList].some((c) => ACTIVE_CLASS.test(c))) return true;
    }
    return false;
  }

  // 같은 탭 줄의 다른 탭들과 글자 색·굵기·밑줄이 다르면 선택된 탭으로 봄
  function differsFromSiblings(el) {
    for (let item = el, i = 0; item && item.parentElement && i < 3; item = item.parentElement, i++) {
      const sibs = [...item.parentElement.children].filter((c) => c !== item && norm(c.textContent).length && norm(c.textContent).length <= 14);
      if (sibs.length < 1) continue;
      const look = (e) => {
        const t = e.querySelector("a, button, span, strong") || e;
        const a = getComputedStyle(e), b = getComputedStyle(t);
        return [a.color, a.fontWeight, a.borderBottomColor + a.borderBottomWidth, a.backgroundColor, b.color, b.fontWeight].join("|");
      };
      const mine = look(item);
      const others = sibs.map(look);
      if (others.every((o) => o === others[0]) && others[0] !== mine) return true;
      return false;
    }
    return false;
  }

  // 선택된 "좋아요한 글" 탭 (없으면 null)
  function findLikedTab() {
    for (const el of document.querySelectorAll("a, button, [role='tab'], li, span, strong")) {
      if (el.childElementCount > 3) continue;
      const text = norm(el.textContent);
      if (text.length > 14 || !LIKED_TAB_TEXT.test(text)) continue;
      if (!el.getClientRects().length) continue;
      // 탭 줄인지 확인: 가까운 곳에 다른 탭(작성글·댓글 등)이 있어야 함
      const bar = el.closest("ul, ol, [role='tablist'], div");
      if (!bar || ![...bar.querySelectorAll("a, button, [role='tab'], li")].some((o) => !o.contains(el) && !el.contains(o) && /작성|댓글/.test(norm(o.textContent)) && norm(o.textContent).length <= 14)) continue;
      if (looksActive(el) || differsFromSiblings(el)) return el;
    }
    return null;
  }

  // 탭 아래 목록 영역의 글 링크 (옆 메뉴·인기글 등 제외)
  function listLinks(tab) {
    const ctx = pageCafe();
    const after = (a) => tab.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING;
    const all = [...document.querySelectorAll(ARTICLE_LINK_SELECTOR)].filter(
      (a) => after(a) && !a.closest(NOT_LIST_SELECTOR) && !isNavButton(a) && a.getClientRects().length && resolve(a.getAttribute("href"), ctx)
    );
    if (!all.length) return { scope: null, items: [] };
    // 탭을 감싼 요소 중, 그 아래 글 링크를 품은 가장 작은 영역
    let scope = tab.parentElement;
    while (scope && scope !== document.body && !all.some((a) => scope.contains(a))) scope = scope.parentElement;
    const inScope = all.filter((a) => scope.contains(a));
    const seen = new Map();
    inScope.forEach((a) => {
      const ids = resolve(a.getAttribute("href"), ctx);
      const key = `${ids.c || ""}|${ids.n || ""}|${ids.a}`;
      if (!seen.has(key)) seen.set(key, ids);
    });
    return { scope, items: [...seen.values()] };
  }

  // 페이지 이동 영역: 목록 근처에 없으면 바깥쪽으로 넓혀 가며 찾음 (목록과 떨어져 있는 경우)
  const PAGER_HINT =
    "[class*='paginat' i], [class*='paging' i], [class*='page_next' i], [class*='page-next' i], [class*='btn_next' i], [class*='pager' i], [aria-label*='페이지'], .prev-next";
  function pagerRoot(scope) {
    let r = scope;
    for (let i = 0; i < 6 && r && r !== document.documentElement; i++) {
      const hit = [...r.querySelectorAll(PAGER_HINT)].find((e) => !e.closest(NOT_LIST_SELECTOR));
      if (hit) return r;
      r = r.parentElement;
    }
    return scope;
  }

  // 페이지 번호 줄 정보: 버튼들, 번호 버튼들, 지금 페이지 번호, 전체 페이지 수(알 때만)
  function pagerInfo(scope, tab) {
    if (!scope) return { btns: [], nums: [], curNo: 1, total: null };
    const root = pagerRoot(scope);
    const after = (e) => tab.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING;
    const btns = [...root.querySelectorAll("a, button")].filter(
      (b) => after(b) && !b.closest(NOT_LIST_SELECTOR) && b.getClientRects().length && !b.disabled && b.getAttribute("aria-disabled") !== "true"
    );
    const nums = btns.filter((b) => /^\d{1,4}$/.test(norm(b.textContent)));
    // "1 / 12" 형태: 현재 페이지·총 페이지 수 표시
    const curEl = [...root.querySelectorAll("[aria-label*='현재'], [class*='current' i]")].find((e) => /^\d{1,5}$/.test(norm(e.textContent)) && after(e));
    const totEl = [...root.querySelectorAll("[aria-label*='총'], [aria-label*='전체'], [class*='total' i]")].find((e) => /^\d{1,5}$/.test(norm(e.textContent)) && after(e));
    const curNo = curEl ? +norm(curEl.textContent) : currentPageNo(nums);
    return { btns, nums, curNo, total: totEl ? +norm(totEl.textContent) : null };
  }

  function currentPageNo(nums) {
    const current = nums.find((b) => looksActive(b));
    if (current) return +norm(current.textContent);
    if (nums.length) {
      const bar = nums[0].parentElement && nums[0].parentElement.closest("div, ul, nav, p");
      const plain = bar && [...bar.querySelectorAll("strong, span, em")].find((e) => /^\d{1,4}$/.test(norm(e.textContent)) && !e.closest("a, button"));
      if (plain) return +norm(plain.textContent);
      const diff = nums.find((b) => differsFromSiblings(b));
      if (diff) return +norm(diff.textContent);
    }
    return 1;
  }

  // 1쪽으로 돌아가기 (다른 페이지를 보던 중에 눌러도 처음부터 읽도록)
  async function goToFirstPage(tab) {
    for (let i = 0; i < 500; i++) {
      const { scope, items } = listLinks(tab);
      const { btns, nums, curNo } = pagerInfo(scope, tab);
      if (curNo <= 1) return tab;
      const one = nums.find((b) => norm(b.textContent) === "1");
      const back =
        one ||
        btns.find((b) => /(^|\s|[-_])(처음|맨\s?앞|first)($|\s|[-_])/i.test(norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + b.className)) ||
        btns.find((b) => /(^|\s|[-_])(이전|prev)($|\s|[-_]|\s?페이지)/i.test(norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + b.className) && !/이전\s?글/.test(norm(b.textContent)));
      if (!back) return tab;
      const before = items.map((x) => x.a).join(",");
      writeSessionFirst();
      back.click();
      let changed = false;
      for (let w = 0; w < 40; w++) {
        await sleep(200);
        const t2 = findLikedTab();
        if (!t2) return null;
        tab = t2;
        const now = listLinks(tab).items.map((x) => x.a).join(",");
        if (now && now !== before) { changed = true; break; }
      }
      if (!changed) return tab;
      await sleep(300);
    }
    return tab;
  }

  // 페이지 번호 줄에서 다음 페이지 버튼
  function findNextPage(scope, tab) {
    if (!scope) return null;
    const { btns, nums, curNo, total } = pagerInfo(scope, tab);
    if (total && curNo >= total) return null; // 마지막 페이지
    const next = nums.find((b) => +norm(b.textContent) === curNo + 1);
    if (next) return next;
    // 번호 묶음의 끝이면 "다음" 버튼
    return (
      btns.find((b) => {
        const label = norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + b.className;
        return /(^|\s|[-_])(다음|next)($|\s|[-_]|\s?페이지)/i.test(label) && !/다음\s?글/.test(label);
      }) || null
    );
  }

  function addLiked(items) {
    let added = 0;
    items.forEach((ids) => {
      if (isLiked(ids)) return;
      const rec = { c: ids.c || null, n: ids.n || null, a: ids.a, t: Date.now() };
      liked[recKey(rec)] = rec;
      added++;
    });
    if (added) {
      rebuildIndex();
      chrome.storage.local.set({ [STORAGE_KEY]: liked });
    }
    return added;
  }

  function cafeKey() {
    const ctx = pageCafe();
    return ctx.c || ctx.n || location.pathname.split("/").slice(0, 4).join("/");
  }

  // ----- 확장 팝업의 버튼으로 시작·중지, 진행 상황은 팝업이 물어볼 때 알려 줌 -----
  let stopRequested = false;
  // 마지막 가져오기 상태 (팝업에 보여 줄 내용)
  let importStatus = { state: "idle", pages: 0, added: 0, total: 0, mode: "" };

  function readImportState(cb) {
    chrome.storage.local.get([IMPORT_KEY], (r) => cb(r[IMPORT_KEY] || {}));
  }
  function writeImportState(key, value) {
    readImportState((map) => {
      map[key] = value;
      chrome.storage.local.set({ [IMPORT_KEY]: map });
    });
  }

  function startCrawl(mode) {
    const tab = findLikedTab();
    if (!enabled || !tab || crawling || jumping) return false;
    crawl(tab, { cafe: cafeKey(), mode, total: 0, added: 0, pages: 0, started: false });
    return true;
  }

  // 팝업과 주고받기: 좋아요한 글 탭이 있는 화면(프레임)만 대답함
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== "ncl-import") return false;
      const tab = findLikedTab();
      if (!tab && !crawling && importStatus.state === "idle") return false;
      if (msg.action === "start") {
        sendResponse({ ok: startCrawl(msg.mode === "new" ? "new" : "full") });
        return false;
      }
      if (msg.action === "stop") {
        stopRequested = true;
        sendResponse({ ok: true });
        return false;
      }
      // status
      readImportState((map) => {
        const st = map[cafeKey()];
        sendResponse({
          onLikedTab: !!tab,
          crawling,
          status: importStatus,
          complete: !!(st && typeof st === "object" && st.complete),
          completeAt: st && st.at
        });
      });
      return true;
    });
  }

  // 1쪽으로 가는 중 페이지가 새로 로드되는 경우를 위해 세션을 남겨 둠 (started=false → 도착 후 다시 1쪽 확인)
  let pendingStart = null;
  function writeSessionFirst() {
    if (pendingStart) writeSession({ ...pendingStart, started: false });
  }

  function readSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(CRAWL_SESSION) || "null");
      return s && Date.now() - s.at < 2 * 60 * 1000 ? s : null;
    } catch (e) {
      return null;
    }
  }
  function writeSession(s) {
    try {
      if (s) sessionStorage.setItem(CRAWL_SESSION, JSON.stringify({ ...s, at: Date.now() }));
      else sessionStorage.removeItem(CRAWL_SESSION);
    } catch (e) {}
  }

  // 화면이 자주 바뀌는 페이지에서도 검사는 1초에 한 번 이하로
  let lastImportCheck = 0;
  function scheduleImportCheck() {
    if (crawling) return;
    clearTimeout(importTimer);
    const wait = Math.max(400, 1000 - (Date.now() - lastImportCheck));
    importTimer = setTimeout(() => {
      lastImportCheck = Date.now();
      checkLikedImport();
    }, wait);
  }

  function checkLikedImport() {
    if (crawling || !enabled) return;
    const tab = findLikedTab();
    if (!tab) return;
    // 버튼을 눌러 읽는 중에 페이지가 새로 로드됐으면 이어서 읽음
    const session = readSession();
    if (session) crawl(tab, session);
  }

  async function crawl(tab, s) {
    if (crawling) return;
    crawling = true;
    stopRequested = false;
    let finished = false; // 마지막 페이지까지 갔는지
    try {
      // 새로 시작할 때는 1쪽부터 (페이지가 새로 로드되는 목록이면 1쪽에 도착한 뒤 이어서 시작)
      if (!s.started) {
        importStatus = { state: "running", pages: 0, added: 0, total: 0, mode: s.mode };
        pendingStart = s;
        tab = await goToFirstPage(tab);
        pendingStart = null;
        if (!tab) throw new Error("left");
        s.started = true;
      }
      for (let guard = 0; guard < 2000; guard++) {
        const { scope, items } = listLinks(tab);
        s.pages++;
        s.total += items.length;
        const added = addLiked(items);
        s.added += added;
        const info = pagerInfo(scope, tab);
        importStatus = { state: "running", pages: s.pages, added: s.added, total: s.total, mode: s.mode, totalPages: info.total };
        // 새 좋아요만 확인: 최근 순이므로 이미 가진 글만 있는 페이지가 나오면 그 뒤도 다 가진 글
        if (s.mode === "new" && items.length && added === 0) { finished = true; break; }
        const next = findNextPage(scope, tab);
        if (!next) {
          // 총 페이지 수를 아는데 아직 마지막이 아니면 다음 버튼을 못 찾은 것 → "다 읽음"으로 기록하지 않음
          finished = !(info.total && info.curNo < info.total);
          break;
        }
        if (stopRequested) break;
        const before = items.map((i) => i.a).join(",");
        writeSession(s); // 페이지가 새로 로드되면 거기서 이어 읽음
        next.click();
        let changed = false;
        for (let w = 0; w < 40 && !stopRequested; w++) {
          await sleep(200);
          const t2 = findLikedTab();
          if (!t2) break;
          tab = t2;
          const now = listLinks(tab).items.map((i) => i.a).join(",");
          if (now && now !== before) { changed = true; break; }
        }
        if (!changed) break;
        await sleep(400); // 네이버 서버에 부담을 주지 않도록 잠깐 쉼
      }
      writeSession(null);
      // 목록에서 글을 하나도 못 찾았으면(아직 안 떴거나 화면이 다름) "다 읽음"으로 기록하지 않음
      if (finished && s.total === 0) finished = false;
      if (finished) {
        if (s.mode === "full") writeImportState(s.cafe, { complete: true, at: Date.now() });
        else readImportState((map) => { if (map[s.cafe] && map[s.cafe].complete) writeImportState(s.cafe, { complete: true, at: Date.now() }); });
      }
      // 끝까지 못 읽었으면(중지·화면 벗어남) "덜 읽음"으로 남아 다음에 다시 끝까지 읽음
      importStatus = { state: finished ? "done" : stopRequested ? "stopped" : s.total === 0 ? "empty" : "interrupted", pages: s.pages, added: s.added, total: s.total, mode: s.mode };
      markList();
    } catch (e) {
      writeSession(null);
      importStatus = { state: "interrupted", pages: s.pages, added: s.added, total: s.total, mode: s.mode };
    } finally {
      crawling = false;
      stopRequested = false;
    }
  }

  // ---------- 게시판에서 가장 최근에 좋아요한 글이 있는 페이지로 이동 ----------
  // 1쪽부터 다음 페이지로 넘기며 찾음. 목록은 최신 글(큰 글번호)이 위에 오므로,
  // 목록이 어떤 글의 번호보다 아래로 내려갔는데 그 글이 안 나왔으면 이 게시판 글이 아님 → 그다음 최근 좋아요로 넘어감
  const JUMP_SESSION = "ncl-jump";         // 페이지가 새로 로드돼도 이어서 찾기
  const JUMP_RESULT = "ncl-jump-result";   // 마지막 결과 (팝업 표시용)
  const JUMP_MAX_PAGES = 300;
  let jumping = false;
  let jumpStop = false;
  let jumpStatus = readJumpResult() || { state: "idle" };
  const DOC_START = () => document.head || document.documentElement; // 목록 함수에 "문서 전체"를 넘길 때

  // 게시판 목록: 글 링크가 가장 많이 모인 목록(표·목록) 하나와 그 안의 글 (화면 순서)
  function boardList() {
    const ctx = pageCafe();
    const groups = new Map();
    for (const a of document.querySelectorAll(ARTICLE_LINK_SELECTOR)) {
      if (a.closest(NOT_LIST_SELECTOR) || a.closest(ARTICLE_BODY_SELECTOR) || isNavButton(a) || !a.getClientRects().length) continue;
      const ids = resolve(a.getAttribute("href"), ctx);
      if (!ids || !ids.a) continue;
      const box = a.closest("tbody, ul, ol") || (a.parentElement && a.parentElement.parentElement);
      if (!box) continue;
      if (!groups.has(box)) groups.set(box, new Map());
      const g = groups.get(box);
      const key = `${ids.c || ""}|${ids.n || ""}|${ids.a}`;
      if (!g.has(key)) g.set(key, ids);
    }
    let best = null;
    groups.forEach((g, box) => {
      if (!best || g.size > best.items.length) best = { scope: box, items: [...g.values()] };
    });
    return best || { scope: null, items: [] };
  }

  // 페이지 번호 줄이 있는 게시판 목록 화면인지 (좋아요한 글 탭 화면은 제외)
  function isBoardPage() {
    if (findLikedTab()) return false;
    const { scope, items } = boardList();
    if (!scope || items.length < 3) return false;
    const info = pagerInfo(scope, DOC_START());
    return info.nums.length > 0 || !!findNextPage(scope, DOC_START());
  }

  function readJumpResult() {
    try { return JSON.parse(sessionStorage.getItem(JUMP_RESULT) || "null"); } catch (e) { return null; }
  }
  function setJumpStatus(st) {
    jumpStatus = st;
    try { sessionStorage.setItem(JUMP_RESULT, JSON.stringify(st)); } catch (e) {}
  }
  function readJumpSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(JUMP_SESSION) || "null");
      return s && Date.now() - s.at < 2 * 60 * 1000 ? s : null;
    } catch (e) {
      return null;
    }
  }
  function writeJumpSession(s) {
    try {
      if (s) sessionStorage.setItem(JUMP_SESSION, JSON.stringify({ ...s, at: Date.now() }));
      else sessionStorage.removeItem(JUMP_SESSION);
    } catch (e) {}
  }

  // 이 카페의 좋아요 기록, 최근에 누른 순 (최대 300개)
  function recentLikes() {
    const ctx = pageCafe();
    return Object.values(liked)
      .filter((r) => r && /^\d+$/.test(String(r.a)) && ((ctx.c && r.c === ctx.c) || (ctx.n && r.n === ctx.n) || (!ctx.c && !ctx.n)))
      .sort((x, y) => (y.t || 0) - (x.t || 0))
      .slice(0, 300)
      .map((r) => ({ c: r.c || null, n: r.n || null, a: String(r.a) }));
  }

  function startJump() {
    if (!enabled || jumping || crawling || !isBoardPage()) return false;
    const cands = recentLikes();
    if (!cands.length) {
      setJumpStatus({ state: "nolikes" });
      return true;
    }
    runJump({ cands, ci: 0, seen: {}, phase: "first", pages: 0, target: null });
    return true;
  }

  // 버튼을 누르고 목록이 바뀔 때까지 기다림 (페이지가 새로 로드되면 세션으로 이어감)
  async function clickAndWait(btn, s) {
    const before = boardList().items.map((i) => i.a).join(",");
    writeJumpSession(s);
    btn.click();
    for (let w = 0; w < 40 && !jumpStop; w++) {
      await sleep(200);
      const now = boardList().items.map((i) => i.a).join(",");
      if (now && now !== before) {
        await sleep(300);
        return true;
      }
    }
    return false;
  }

  function highlightArticle(target) {
    const ctx = pageCafe();
    const link = [...document.querySelectorAll(ARTICLE_LINK_SELECTOR)].find((a) => {
      if (a.closest(NOT_LIST_SELECTOR) || isNavButton(a)) return false;
      const ids = resolve(a.getAttribute("href"), ctx);
      return ids && same(target, ids);
    });
    if (!link) return;
    const row = findRow(link, ctx);
    row.scrollIntoView({ block: "center" });
    row.classList.remove("ncl-jump-flash");
    void row.offsetWidth;
    row.classList.add("ncl-jump-flash");
    setTimeout(() => row.classList.remove("ncl-jump-flash"), 2600);
  }

  async function runJump(s) {
    if (jumping) return;
    jumping = true;
    jumpStop = false;
    try {
      for (let guard = 0; guard < JUMP_MAX_PAGES * 3; guard++) {
        if (jumpStop || !enabled) { setJumpStatus({ state: "stopped", pages: s.pages }); break; }
        const { scope, items } = boardList();
        if (!items.length) { setJumpStatus({ state: "empty" }); break; }
        const info = pagerInfo(scope, DOC_START());
        const cur = info.curNo;

        // 1) 1쪽으로
        if (s.phase === "first") {
          setJumpStatus({ state: "running", pages: s.pages, page: cur });
          if (cur > 1) {
            const back =
              info.nums.find((b) => norm(b.textContent) === "1") ||
              info.btns.find((b) => /(^|\s|[-_])(처음|맨\s?앞|first)($|\s|[-_])/i.test(norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + b.className)) ||
              info.btns.find((b) => /(^|\s|[-_])(이전|prev)($|\s|[-_]|\s?페이지)/i.test(norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + b.className) && !/이전\s?글/.test(norm(b.textContent)));
            if (back && (await clickAndWait(back, s))) continue;
          }
          s.phase = "scan";
        }

        // 2) 페이지를 넘기며 찾기
        if (s.phase === "scan") {
          s.pages++;
          items.forEach((ids) => {
            const i = s.cands.findIndex((c) => same(c, ids));
            if (i >= 0 && s.seen[i] === undefined) s.seen[i] = cur;
          });
          // 목록 맨 아래쪽 글번호 (답글 등으로 순서가 조금 섞여도 안전하게 아래 3개 중 가장 큰 번호)
          const tail = items.slice(-3).map((i) => +i.a).filter((x) => x > 0);
          const bottom = tail.length ? Math.max(...tail) : 0;
          while (s.ci < s.cands.length) {
            if (s.seen[s.ci] !== undefined) {
              s.target = { ...s.cands[s.ci], page: s.seen[s.ci] };
              break;
            }
            if (bottom && +s.cands[s.ci].a > bottom) s.ci++; // 지나쳤는데 없었음 → 이 게시판 글이 아님
            else break;
          }
          if (!s.target && s.ci >= s.cands.length) { setJumpStatus({ state: "notfound", pages: s.pages }); break; }
          if (!s.target) {
            const next = s.pages < JUMP_MAX_PAGES ? findNextPage(scope, DOC_START()) : null;
            if (!next) {
              // 끝까지 봤음: 본 것 중 가장 최근 좋아요
              const seenIdx = Object.keys(s.seen).map(Number).sort((x, y) => x - y);
              if (seenIdx.length) s.target = { ...s.cands[seenIdx[0]], page: s.seen[seenIdx[0]] };
              else { setJumpStatus({ state: s.pages >= JUMP_MAX_PAGES ? "toofar" : "notfound", pages: s.pages }); break; }
            } else {
              setJumpStatus({ state: "running", pages: s.pages, page: cur });
              if (!(await clickAndWait(next, s))) { setJumpStatus({ state: "interrupted", pages: s.pages }); break; }
              continue;
            }
          }
          s.phase = "goto";
        }

        // 3) 찾은 글이 있는 페이지로 (보통은 지금 페이지)
        if (s.phase === "goto") {
          const want = s.target.page;
          if (cur === want) {
            setJumpStatus({ state: "done", pages: s.pages, page: cur });
            highlightArticle(s.target);
            break;
          }
          setJumpStatus({ state: "running", pages: s.pages, page: cur });
          const nums = info.nums.map((b) => +norm(b.textContent));
          let btn = info.nums.find((b) => +norm(b.textContent) === want);
          if (!btn) {
            const re = want < Math.min(...nums, cur) ? /(^|\s|[-_])(이전|prev)($|\s|[-_]|\s?페이지)/i : /(^|\s|[-_])(다음|next)($|\s|[-_]|\s?페이지)/i;
            btn = info.btns.find((b) => {
              const label = norm(b.textContent) + " " + (b.getAttribute("aria-label") || "") + " " + (b.getAttribute("title") || "") + " " + b.className;
              return re.test(label) && !/(이전|다음)\s?글/.test(label);
            });
          }
          if (!btn || !(await clickAndWait(btn, s))) { setJumpStatus({ state: "interrupted", pages: s.pages }); break; }
          continue;
        }
      }
    } catch (e) {
      setJumpStatus({ state: "interrupted", pages: s.pages });
    } finally {
      writeJumpSession(null);
      jumping = false;
      jumpStop = false;
    }
  }

  // 팝업과 주고받기: 게시판 목록이 있는 화면(프레임)만 대답함
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== "ncl-jump") return false;
      if (!jumping && !isBoardPage()) return false;
      if (msg.action === "start") sendResponse({ ok: startJump() });
      else if (msg.action === "stop") { jumpStop = true; sendResponse({ ok: true }); }
      else sendResponse({ jumping, status: jumpStatus, likes: recentLikes().length });
      return false;
    });
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
      scheduleImportCheck();
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
        if (rec.attributeName === "href") scheduleMark();
        else scheduleImportCheck();
        continue;
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
    scheduleImportCheck();
    // 이동 중에 페이지가 새로 로드됐으면 목록이 뜬 뒤 이어서 찾음
    if (enabled && readJumpSession()) {
      const resume = (n) => {
        const s = readJumpSession();
        if (!s || jumping) return;
        if (boardList().items.length) runJump(s);
        else if (n < 25) setTimeout(() => resume(n + 1), 200);
      };
      setTimeout(() => resume(0), 300);
    }
    // 주소가 바뀌는 SPA 이동 대응
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleMark();
      }
    }, 500);
    // 노드 추가와 링크 주소(href) 변경만 감시
    new MutationObserver(onMutations).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "class", "aria-selected"]
    });
  });
})();
