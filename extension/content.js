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
    if (parseCache.has(href)) return parseCache.get(href);
    const r = parseUrlRaw(href);
    if (parseCache.size > 5000) parseCache.clear();
    parseCache.set(href, r);
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
    const r = parseUrl(href);
    if (!r || !r.a) return null;
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
      document.querySelectorAll(".ncl-heart-dot").forEach((d) => d.remove());
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

  function markList() {
    if (!document.body) return;
    const ctx = pageCafe();
    const current = currentArticle();
    const likedRows = new Map(); // 줄(tr/li) → 하트를 붙일 제목 링크

    document.querySelectorAll(ARTICLE_LINK_SELECTOR).forEach((a) => {
      const ids = resolve(a.getAttribute("href"), ctx);
      if (!ids || !isLiked(ids)) return;
      // 지금 보고 있는 글 본문 안의 링크는 건너뜀
      if (current && current.a === ids.a && a.closest(".ArticleContentBox, .article_container")) return;
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

    // 하트 (줄마다 1개, 줄 오른쪽 끝)
    // 글자 흐름 밖(position:absolute)에 띄워서, 제목 길이와 상관없이 줄바꿈이 생기지 않음
    // 테이블 목록은 줄 맨 끝이 날짜 칸이라 제목 칸의 오른쪽 끝에 붙임
    const anchors = new Map(); // 하트를 붙일 곳 → 그 줄의 제목 링크
    if (showHeart) {
      likedRows.forEach((title, row) => {
        anchors.set(heartAnchor(row, title), title);
      });
    }
    document.querySelectorAll(".ncl-heart-dot").forEach((dot) => {
      const anchor = dot.parentElement;
      if (!anchors.has(anchor)) dot.remove();
      else {
        dotTitles.set(anchor, anchors.get(anchor));
        anchors.delete(anchor);
      }
    });
    document.querySelectorAll(".ncl-pos").forEach((el) => {
      if (!el.querySelector(":scope > .ncl-heart-dot")) el.classList.remove("ncl-pos");
    });
    anchors.forEach((title, anchor) => {
      // 이미 위치 지정(relative/absolute 등)이 된 요소는 그대로 두고, 아니면 기준점으로 만듦
      if (getComputedStyle(anchor).position === "static") anchor.classList.add("ncl-pos");
      const dot = document.createElement("span");
      dot.className = heartStyle === "icon" ? "ncl-heart-dot ncl-icon" : "ncl-heart-dot";
      dot.textContent = heartStyle === "icon" ? "\u2665" : "\u2665 좋아요";
      dot.setAttribute("aria-hidden", "true");
      anchor.appendChild(dot);
      dotTitles.set(anchor, title);
      fitTitle(title, dot, anchor);
    });
    cleanupFits();

    // 예전 버전의 하트 정리
    document.querySelectorAll(".ncl-badge").forEach((b) => b.remove());
    document.querySelectorAll(".ncl-heart").forEach((el) => el.classList.remove("ncl-heart", "ncl-heart-front"));
  }

  // 하트를 붙일 곳 찾기
  // 제목·작성자·날짜처럼 칸이 나뉜 줄이면 줄 끝이 아니라 "제목 칸"의 오른쪽 끝에 붙임
  // (줄 끝에 붙이면 날짜 칸과 겹치거나 화면 밖으로 잘리고, 여백 때문에 다른 칸이 밀림)
  function heartAnchor(row, title) {
    if (row.tagName === "TR") return title.closest("td") || row;
    let cell = title;
    while (cell.parentElement && cell.parentElement !== row) cell = cell.parentElement;
    if (cell === title || cell.parentElement !== row) return row;
    if (getComputedStyle(cell).display === "inline") return row;
    const otherColumns = [...row.children].some(
      (ch) => ch !== cell && !ch.classList.contains("ncl-heart-dot") && ch.textContent.trim()
    );
    return otherColumns ? cell : row;
  }

  // ---------- 긴 제목이 하트 배지에 가려지지 않게 ----------
  // 하트 배지가 있는 줄: 줄 → 제목 링크
  const dotTitles = new Map();
  // 오른쪽 여백을 준 줄 → 원래 inline padding-right 값
  const reserved = new Map();

  // 배지 자리에 글자(제목·댓글 수·아이콘)가 겹치면, 그 줄에만 배지 폭만큼 오른쪽 여백을 줌
  // → 글자가 배지 앞에서 자연스럽게 줄바꿈되어 가려지지 않음 (겹치지 않는 줄은 그대로)
  function fitTitle(title, dot, anchor) {
    unreserve(anchor);
    if (!overlaps(dot, anchor)) return;
    const cs = getComputedStyle(anchor);
    const pad = parseFloat(cs.paddingRight) || 0;
    const need = dot.getBoundingClientRect().width + 10;
    reserved.set(anchor, anchor.style.getPropertyValue("padding-right"));
    anchor.style.setProperty("padding-right", Math.ceil(pad + need) + "px", "important");
  }

  function overlaps(dot, anchor) {
    const d = dot.getBoundingClientRect();
    const left = d.left - 4;
    for (const el of anchor.querySelectorAll("*")) {
      if (el === dot) continue;
      for (const r of el.getClientRects()) {
        if (r.width && r.right > left && r.left < d.right && r.bottom > d.top && r.top < d.bottom) return true;
      }
    }
    // 링크로 감싸지 않은 글자도 확인
    const range = document.createRange();
    for (const node of anchor.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width && r.right > left && r.left < d.right && r.bottom > d.top && r.top < d.bottom) return true;
      }
    }
    return false;
  }

  function unreserve(anchor) {
    if (!reserved.has(anchor)) return;
    const prev = reserved.get(anchor);
    if (prev) anchor.style.setProperty("padding-right", prev);
    else anchor.style.removeProperty("padding-right");
    reserved.delete(anchor);
  }

  // 하트가 사라진 줄은 원래대로
  function cleanupFits() {
    dotTitles.forEach((title, anchor) => {
      if (!anchor.isConnected || !anchor.querySelector(":scope > .ncl-heart-dot")) dotTitles.delete(anchor);
    });
    reserved.forEach((_, anchor) => {
      if (!dotTitles.has(anchor)) unreserve(anchor);
    });
  }

  // 창 크기가 바뀌면 다시 맞춤
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      dotTitles.forEach((title, anchor) => {
        const dot = anchor.querySelector(":scope > .ncl-heart-dot");
        if (dot && anchor.isConnected) fitTitle(title, dot, anchor);
      });
    }, 150);
  });

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

  // 같은 줄의 링크 중 제목 링크를 고름 (a.article 우선, 없으면 글자가 가장 긴 링크)
  function pickTitle(prev, a) {
    if (!prev) return a;
    const score = (el) =>
      (el.classList.contains("article") ? 10000 : 0) + el.textContent.trim().length;
    return score(a) > score(prev) ? a : prev;
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
    // 속성 변화는 감시하지 않고, 노드 추가만 감시
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
})();
