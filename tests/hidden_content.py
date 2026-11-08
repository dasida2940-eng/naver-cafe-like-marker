import asyncio, json, re, sys, pathlib
from playwright.async_api import async_playwright
EXT = pathlib.Path(sys.argv[1]).resolve()
src = pathlib.Path("/home/claude/naver-cafe-like-marker/tests/pages/p18_profile_cmt.html").read_text()
head = src.split("<body")[0]
base = "[넥서스 아니마] 파이널 베타 테스트 인게임 플레이 영상"
extra = "공개및사전예약안내다시보기라이브스트리밍온라인음악공연"
def row(aid, t):
    return (f'<tr><td class="td_article"><div class="check_box only_box"><input type="checkbox"></div><div class="board-number"><div class="inner_number"> {aid} </div></div>'
            f'<div class="board-list"><div class="inner_list"><a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}" class="article"><span class="head">[PV]</span> {t} </a>'
            f'<span><svg class="svg-icon"><rect width="100%" height="100%" fill="#aaa"/></svg></span><a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}&amp;commentFocus=true" class="cmt"> [ <em>3</em> ] </a></div></div></td>'
            f'<td class="td_name"><button> 여긴어디인가 </button></td><td class="td_date"> 2026.11.05. </td><td class="td_view"> 13 </td></tr>')
ids = []; body = ""
for L in "ABDEFGHIJ":
    body += f'<table class="{L}">'
    for k in range(len(extra) + 1):
        aid = 5000 + len(ids); ids.append(aid); body += row(aid, base + " " + extra[:k])
    body += "</table>"
html = head + f'<body data-url="/f-e/cafes/31580371/members/abc?tab=liked">' + body + "</body></html>"
STUB = open(pathlib.Path(__file__).parent / "harness.py").read().split('STUB = """')[1].split('"""')[0]
LOST0 = """() => [...document.querySelectorAll('td.td_article')].map(cell => {
  const cb = cell.getBoundingClientRect(); const cr = cb.right - parseFloat(getComputedStyle(cell).paddingRight) + 1;
  let lost = 0; const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT); const rg = document.createRange();
  while (w.nextNode()) { const t = w.currentNode; if (!t.textContent.trim() || t.parentElement.closest('.ncl-heart-dot')) continue;
    let lim = cr; for (let a = t.parentElement; a && a !== cell; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible') lim = Math.min(lim, a.getBoundingClientRect().right); }
    rg.selectNodeContents(t); for (const r of rg.getClientRects()) if (r.width > 1) lost += Math.max(0, r.right - Math.max(lim, r.left)); }
  return Math.round(lost); })"""
LOST = """() => [...document.querySelectorAll('td.td_article')].map(cell => {
  const vis = (el) => { let r = el.getBoundingClientRect(); let L = r.left, R = r.right;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowX === 'visible') continue;
      const b = a.getBoundingClientRect(); const pr = cs.textOverflow === 'ellipsis' ? parseFloat(cs.paddingRight) : 0; R = Math.min(R, b.right - pr); L = Math.max(L, b.left); }
    const d = cell.querySelector('.ncl-heart-dot'); let w = Math.max(0, R - L);
    if (d) { const h = d.getBoundingClientRect(); const ov = Math.max(0, Math.min(R, h.right) - Math.max(L, h.left)); if (h.top < r.bottom && h.bottom > r.top) w -= ov; }
    return w; };
  return Math.round([...cell.querySelectorAll('.cmt, svg')].reduce((s, e) => s + (e.getBoundingClientRect().width - vis(e)), 0)); })"""
async def main():
    bad = 0; n = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for width in (1280, 1024, 800):
            for mode, style in (("bg_heart", "text"), ("heart", "icon")):
                pg = await (await b.new_context(viewport={"width": width, "height": 800})).new_page()
                await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
                await pg.add_init_script(STUB.replace("__MODE__", json.dumps(mode)).replace("__STYLE__", json.dumps(style)))
                await pg.goto("https://cafe.naver.com/f-e/cafes/31580371/members/abc?tab=liked")
                await pg.evaluate(f"__initLiked({json.dumps(','.join(f'c31580371:{i}' for i in ids))})")
                before = await pg.evaluate(LOST)
                await pg.add_style_tag(path=str(EXT / "style.css")); await pg.add_script_tag(path=str(EXT / "content.js"))
                await pg.wait_for_timeout(400)
                after = await pg.evaluate(LOST)
                for i, (x, y) in enumerate(zip(before, after)):
                    n += 1
                    if y > x + 1: bad += 1; print(width, mode, "row", ids[i], "table", "ABDEFGHIJ"[i // (len(extra)+1)], "lost", x, "->", y)
        await b.close()
    print(f"{n}줄 중 제목이 더 가려진 줄 {bad}")
asyncio.run(main())
