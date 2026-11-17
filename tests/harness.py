"""네이버 카페 좋아요 표시 - 화면 구조 × 환경 자동 검사기

usage: python3 harness.py <extension_dir> [--shots]
"""
import asyncio, json, sys, pathlib, itertools, time
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
SHOTS = "--shots" in sys.argv
PAGES = sorted(pathlib.Path(__file__).parent.joinpath("pages").glob("*.html"))
OUT = pathlib.Path(__file__).parent / "out"
OUT.mkdir(exist_ok=True)

# 환경: (이름, 화면 폭, 확대 비율)
ENVS = [("1280", 1280, 1.0), ("1024", 1024, 1.0), ("800", 800, 1.0), ("1280@125%", 1280, 1.25), ("1280@150%", 1280, 1.5)]
CONFIGS = [("bg", "text"), ("bg_heart", "text"), ("bg_heart", "icon"), ("heart", "text"), ("heart", "icon")]

STUB = """
(() => {
  const liked = {};
  (document.currentScript ? 0 : 0);
  window.__ls = [];
  window.__initLiked = (spec) => {
    spec.split(',').filter(Boolean).forEach(s => {
      let c = null, n = 'testcafe', a = s;
      if (s.startsWith('c')) { [c, a] = s.slice(1).split(':'); n = null; }
      liked[`${c||''}|${n||''}|${a}`] = { c, n, a, t: 1 };
    });
  };
  const d = { likedArticles: liked, displayMode: __MODE__, heartStyle: __STYLE__ };
  window.chrome = { storage: {
    local: {
      _d: d,
      get(k, cb) { const r = {}; k.forEach(x => { if (x in d) r[x] = d[x]; }); setTimeout(() => cb(JSON.parse(JSON.stringify(r)))); },
      set(o) { const ch = {}; for (const k in o) ch[k] = { oldValue: d[k], newValue: o[k] }; Object.assign(d, o); window.__ls.forEach(f => f(ch, 'local')); }
    },
    onChanged: { addListener(f) { window.__ls.push(f); } }
  } };
})();
"""

# 화면 상태 수집 (확장 넣기 전/후 비교용)
SNAP = """
() => {
  const rows = [...document.querySelectorAll('li, tr, [data-expect]')];
  const cols = [...document.querySelectorAll('[data-col]')];
  const boxes = [...document.querySelectorAll('img, a, span, div')].filter(e => !e.firstElementChild && !e.textContent.trim());
  return {
    boxes: boxes.map(e => { const b = e.getBoundingClientRect(); return [b.width, b.height]; }),
    rows: rows.map(r => { const b = r.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }),
    cols: cols.map(c => { const b = c.getBoundingClientRect(); return [b.left, b.width]; }),
  };
}
"""

CHECK = """
(args) => {
  const [mode, before] = args;
  const errs = [];
  const showBg = mode !== 'heart', showHeart = mode !== 'bg';
  const expect = [...document.querySelectorAll('[data-expect]')];
  const dots = [...document.querySelectorAll('.ncl-heart-dot')];
  const marked = [...document.querySelectorAll('.ncl-liked-row')];
  const inExpect = (el) => expect.some(e => e === el || e.contains(el));
  const label = (el) => (el.closest('[data-expect]') || el).textContent.trim().slice(0, 18);

  // 1) 표시 위치
  if (showBg) {
    expect.forEach(e => { if (!e.classList.contains('ncl-liked-row') && !e.querySelector('.ncl-liked-row')) errs.push(['누락(배경)', label(e)]); });
    marked.forEach(m => { if (!inExpect(m)) errs.push(['잘못 표시(배경)', label(m)]); });
  } else if (marked.length) errs.push(['하트만 모드인데 배경', marked.length]);
  if (showHeart) {
    expect.forEach(e => { const n = e.querySelectorAll('.ncl-heart-dot').length; if (n !== 1) errs.push([`하트 ${n}개`, label(e)]); });
    dots.forEach(d => { if (!inExpect(d)) errs.push(['잘못 표시(하트)', label(d.parentElement)]); });
  } else if (dots.length) errs.push(['배경만 모드인데 하트', dots.length]);

  // 2) 하트가 글자/아이콘을 가리는지, 3) 잘리는지
  const vw = document.documentElement.clientWidth;
  dots.forEach(dot => {
    const d = dot.getBoundingClientRect();
    if (!d.width) { errs.push(['하트 크기 0', label(dot)]); return; }
    const row = dot.closest('[data-expect]') || dot.parentElement;
    const clip = (el, r) => { let b = {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const c = p.getBoundingClientRect();
          const pr = cs.textOverflow === 'ellipsis' ? (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) || 0 : 0;
          if (cs.overflowX !== 'visible') { b.left = Math.max(b.left, c.left); b.right = Math.min(b.right, c.right - pr); }
          if (cs.overflowY !== 'visible') { b.top = Math.max(b.top, c.top); b.bottom = Math.min(b.bottom, c.bottom); } } }
      return b; };
    let curEl = null;
    const hit = (r0) => { const r = clip(curEl, r0); return r.right - r.left > 2 && r.bottom - r.top > 2 && Math.min(r.right, d.right) - Math.max(r.left, d.left) > 1 && Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top) > 1; };
    let covered = null;
    row.querySelectorAll('*').forEach(el => {
      if (covered || el === dot || dot.contains(el) || el.contains(dot)) return;
      // 그림/아이콘(글자 없는 상자)과 글자
      const ecs = getComputedStyle(el), eb = el.getBoundingClientRect();
      const painted = ecs.backgroundImage !== 'none' || !(ecs.backgroundColor === 'transparent' || ecs.backgroundColor.endsWith(', 0)'));
      const leaf = el.tagName === 'IMG' || (!el.firstElementChild && !el.textContent.trim()) || (painted && eb.width <= 48 && eb.height <= 48);
      curEl = el;
      if (leaf) for (const r of el.getClientRects()) if (hit(r)) { covered = el.textContent.trim().slice(0, 10) || el.className || el.tagName; }
    });
    // CSS 장식(::before/::after)으로 그린 아이콘
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
    if (!covered) row.querySelectorAll('*').forEach(el => {
      if (covered || el === dot || dot.contains(el)) return;
      for (const ps of ['::before', '::after']) { const r = pseudoRect(el, ps, d); curEl = el; if (r && hit(r)) covered = 'CSS 아이콘(' + (el.className || el.tagName) + ps + ')'; }
    });
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (!covered && walker.nextNode()) {
      const t = walker.currentNode;
      if (!t.textContent.trim() || dot.contains(t)) continue;
      range.selectNodeContents(t);
      curEl = t;
      for (const r of range.getClientRects()) if (hit(r)) { covered = t.textContent.trim().slice(0, 10); break; }
    }
    if (covered) errs.push(['가림', label(dot) + ' ← ' + covered]);
    // 잘림: 화면 밖 / overflow 숨김 조상 밖
    if (d.left < 0 || d.right > vw + 0.5) errs.push(['화면 밖', label(dot)]);
    let p = dot.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = p.getBoundingClientRect();
        if (d.left < b.left - 0.5 || d.right > b.right + 0.5 || d.top < b.top - 0.5 || d.bottom > b.bottom + 0.5) { errs.push(['잘림', label(dot) + ' (' + (p.className || p.tagName) + ')']); break; }
      }
      p = p.parentElement;
    }
    // 세로 위치: 제목(data-title 또는 .title/.tit) 높이에 맞는지
    const tEl = row.querySelector('[data-title], .title, .tit');
    if (tEl) { const tb = tEl.getBoundingClientRect(), cy = (d.top + d.bottom) / 2;
      if (cy < tb.top - 2 || cy > tb.bottom + 2) {
        // 제목 줄에 자리가 없을 때는 같은 줄(카드)의 다른 글자 줄 높이에 붙는 것이 정상
        const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT), rg = document.createRange(); let onLine = false;
        while (!onLine && w.nextNode()) { const t = w.currentNode; if (!t.textContent.trim() || dot.contains(t)) continue; rg.selectNodeContents(t);
          for (const r of rg.getClientRects()) if (r.height > 4 && Math.abs((r.top + r.bottom) / 2 - cy) <= 3) { onLine = true; break; } }
        if (!onLine) errs.push(['제목 높이 아님', label(dot)]);
      } }
    // 제목과 하트 사이에 사진·썸네일이 끼면 안 됨
    if (tEl) { const tb = tEl.getBoundingClientRect();
      for (const el of row.querySelectorAll('img, [class*=thumb], [class*=img]')) { if (el.contains(tEl)) continue; const r = el.getBoundingClientRect();
        if (r.width > 20 && r.left >= tb.right - 1 && r.right <= d.left + 1 && r.bottom > d.top && r.top < d.bottom) { errs.push(['제목과 하트 사이에 사진', label(dot)]); break; } } }
    // 세로 위치: 줄 밖으로 나가지 않음
    const rb = row.getBoundingClientRect();
    if (d.top < rb.top - 1 || d.bottom > rb.bottom + 1) errs.push(['줄 밖', label(dot)]);
  });

  // 4) 다른 칸(작성자/날짜) 밀림
  const cols = [...document.querySelectorAll('[data-col]')];
  cols.forEach((c, i) => {
    const b = c.getBoundingClientRect(), [l, w] = before.cols[i];
    const reservedAnc = [...document.querySelectorAll('.ncl-heart-dot')].map(x => x.parentElement).find(a => a.style.paddingRight && a.contains(c));
    if (Math.abs(b.left - l) > 0.5 || (!reservedAnc && Math.abs(b.width - w) > 0.5)) errs.push(['칸 밀림', c.textContent.trim().slice(0, 12)]);
  });
  // 7) 이전글·다음글 버튼: 버튼 안에 하트 1개, 다른 곳엔 없음
  document.querySelectorAll('[data-navexpect]').forEach(a => {
    const n = a.querySelectorAll('.ncl-nav-heart').length, want = showHeart ? 1 : 0;
    if (n !== want) errs.push([`버튼 하트 ${n}개(기대 ${want})`, a.textContent.trim().slice(0, 8)]);
    if (a.classList.contains('ncl-nav-liked') !== showBg) errs.push(['버튼 배경 ' + (showBg ? '누락' : '불필요'), a.textContent.trim().slice(0, 8)]);
  });
  document.querySelectorAll('.ncl-nav-heart, .ncl-nav-liked').forEach(h => { if (!h.closest('[data-navexpect]')) errs.push(['버튼 아닌 곳에 버튼 표시', h.textContent.trim().slice(0, 12)]); });
  // 6) 사진·썸네일·아이콘 크기 그대로
  const boxes = [...document.querySelectorAll('img, a, span, div')].filter(e => !e.firstElementChild && !e.textContent.trim() && !e.classList.contains('ncl-heart-dot'));
  boxes.forEach((e, i) => { const b = e.getBoundingClientRect(), o = before.boxes[i];
    if (o && (Math.abs(b.width - o[0]) > 0.5 || Math.abs(b.height - o[1]) > 0.5)) errs.push(['사진/아이콘 크기 변화', (e.className || e.tagName) + ' ' + Math.round(o[0]) + '→' + Math.round(b.width)]); });
  // 5) 좋아요 아닌 줄은 그대로
  const rows = [...document.querySelectorAll('li, tr, [data-expect]')];
  rows.forEach((r, i) => {
    if (inExpect(r) || r.querySelector('[data-expect]')) return;
    const par = r.parentElement;
    if (par && getComputedStyle(par).display.includes('grid') && par.querySelector(':scope > [data-expect]')) {
      // 같은 그리드 줄의 카드는 가장 높은 카드에 맞춰 늘어나는 것이 정상 → 폭만 비교
      const b = r.getBoundingClientRect(), [l, t, w, h] = before.rows[[...document.querySelectorAll('li, tr, [data-expect]')].indexOf(r)];
      if (Math.abs(w - b.width) > 0.5) errs.push(['다른 줄 폭 변화', r.textContent.trim().slice(0, 12)]);
      return;
    }
    const b = r.getBoundingClientRect(), [l, t, w, h] = before.rows[i];
    if (Math.abs(w - b.width) > 0.5 || Math.abs(h - b.height) > 0.5) errs.push(['다른 줄 크기 변화', r.textContent.trim().slice(0, 12)]);
  });
  return errs;
}
"""


async def run_one(browser, page_path, env, cfg):
    name, width, zoom = env
    mode, style = cfg
    ctx = await browser.new_context(viewport={"width": int(width / zoom), "height": 700}, device_scale_factor=zoom)
    pg = await ctx.new_page()
    html = page_path.read_text()
    url_path = "/testcafe"
    import re
    m = re.search(r'data-url="([^"]+)"', html)
    if m: url_path = m.group(1)
    liked = re.search(r'data-liked="([^"]*)"', html).group(1)
    await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
    await pg.add_init_script(STUB.replace("__MODE__", json.dumps(mode)).replace("__STYLE__", json.dumps(style)))
    await pg.goto("https://cafe.naver.com" + url_path)
    await pg.evaluate(f"__initLiked({json.dumps(liked)})")
    if "p10" in page_path.name:
        await pg.wait_for_timeout(600)  # 탭이 열린 뒤를 기준으로
    if "p16" in page_path.name:
        await pg.wait_for_timeout(1200)  # 아이콘 CSS가 적용된 뒤를 기준으로 (확장은 그 전에 넣고 싶지만, 비교 기준은 최종 화면)
    before = await pg.evaluate(SNAP)
    await pg.add_style_tag(path=str(EXT / "style.css"))
    await pg.add_script_tag(path=str(EXT / "content.js"))
    # p16: 아이콘 CSS가 늦게 적용됨 → 다시 확인까지 기다림
    await pg.wait_for_timeout(3000 if "p16" in page_path.name else 250)
    if "p10" in page_path.name:
        # 숨겨진 상태에서 확장이 먼저 돌고, 나중에 탭이 열리는 경우
        pass
    errs = await pg.evaluate(CHECK, [mode, before])
    shot = None
    if SHOTS or errs:
        shot = OUT / f"{page_path.stem}__{name}__{mode}-{style}.png".replace("%", "pct").replace("@", "_")
        await pg.screenshot(path=str(shot), full_page=True)
    await ctx.close()
    return errs, shot


async def run_hidden_tab(browser, cfg):
    """p10: 확장이 숨겨진 탭에서 먼저 실행되고, 그 뒤 탭이 열릴 때"""
    mode, style = cfg
    page_path = [p for p in PAGES if "p10" in p.name][0]
    html = page_path.read_text()
    import re
    liked = re.search(r'data-liked="([^"]*)"', html).group(1)
    ctx = await browser.new_context(viewport={"width": 1024, "height": 700})
    pg = await ctx.new_page()
    await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
    await pg.add_init_script(STUB.replace("__MODE__", json.dumps(mode)).replace("__STYLE__", json.dumps(style)))
    await pg.goto("https://cafe.naver.com/testcafe")
    await pg.evaluate(f"__initLiked({json.dumps(liked)})")
    await pg.add_style_tag(path=str(EXT / "style.css"))
    await pg.add_script_tag(path=str(EXT / "content.js"))
    await pg.wait_for_timeout(900)
    # before 스냅샷 대신: 확장 없이 같은 화면을 다시 계산할 수 없으므로 칸/줄 비교는 생략
    before = await pg.evaluate(SNAP)
    errs = await pg.evaluate(CHECK, [mode, before])
    shot = OUT / f"p10_hidden-first__{mode}-{style}.png"
    if errs or SHOTS:
        await pg.screenshot(path=str(shot), full_page=True)
    await ctx.close()
    return errs


async def main():
    t0 = time.time()
    results = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for page_path, env, cfg in itertools.product(PAGES, ENVS, CONFIGS):
            errs, shot = await run_one(b, page_path, env, cfg)
            results.append((page_path.stem, env[0], "-".join(cfg), errs))
        for cfg in CONFIGS:
            errs = await run_hidden_tab(b, cfg)
            results.append(("p10_hidden-first", "1024", "-".join(cfg), errs))
        await b.close()
    fails = [r for r in results if r[3]]
    print(f"총 {len(results)}개 조합, 실패 {len(fails)}개 ({time.time()-t0:.0f}초)")
    # 문제 유형별 요약
    from collections import defaultdict
    by = defaultdict(set)
    for pg, env, cfg, errs in fails:
        for e in errs:
            by[(pg, e[0])].add(f"{env}/{cfg}: {e[1]}")
    for (pg, kind), items in sorted(by.items()):
        items = sorted(items)
        print(f"- [{pg}] {kind} ×{len(items)}  예) {items[0]}")
    json.dump(results, open(OUT / "results.json", "w"), ensure_ascii=False, indent=1)

asyncio.run(main())
