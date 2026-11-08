import asyncio, json, pathlib, re, sys
from playwright.async_api import async_playwright
EXT = pathlib.Path(sys.argv[1])
src = (pathlib.Path(__file__).parent / "pages/p18_profile_cmt.html").read_text()
style = src.split("<style>")[1].split("</style>")[0]
row = '''<tr><td class="td_article"><div class="check_box only_box"><div class="FormInputCheck"><input type="checkbox" class="input_check"><label class="label"><span class="blind">선택</span></label></div></div><div class="board-number"><div class="inner_number"> 3766 </div></div><div class="board-list"><div class="inner_list"><!----><a href="/ArticleRead.nhn?clubid=31580371&amp;articleid=3766" target="_blank" class="article"><span class="head">[소식]</span> '니케' 해킹 사태에 넥슨 전사 보안 공지…"런처 즉시 삭제" </a><!----><span data-v-b59ec6de=""><svg aria-label="사진" class="svg-icon list_attach_img"><rect width="100%" height="100%" fill="#aaa"/></svg><!----></span><a href="/ArticleRead.nhn?clubid=31580371&amp;articleid=3766&amp;commentFocus=true" target="_blank" class="cmt"> [ <em>2</em> ] </a><!----></div></div></td><td class="td_name"><button type="button"> Hy </button><!----></td><td class="td_date"> 2026.11.04. </td><td class="td_view"> 24 </td><!----></tr>'''
STUB = open(pathlib.Path(__file__).parent / "harness.py").read().split('STUB = """')[1].split('"""')[0]
CHK = """() => [...document.querySelectorAll('table')].map(t => { const d = t.querySelector('.ncl-heart-dot'); if (!d) return t.className + ': 하트없음';
  const h = d.getBoundingClientRect(); const bad = [...t.querySelectorAll('.cmt, svg, .article')].filter(e => { for (const r of e.getClientRects()) if (r.right > h.left+1 && r.left < h.right-1 && r.bottom > h.top && r.top < h.bottom) return true; return false; }).map(e => e.className.baseVal ?? e.className);
  return t.className + ': ' + (bad.length ? '겹침 ' + bad.join(',') : 'ok'); })"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for tw in range(580, 1000, 20):
            html = f'<!doctype html><html><head><meta charset="utf-8"><style>{style} table{{width:{tw}px !important}}</style></head><body>' + "".join(f'<table class="{L}">{row}</table>' for L in "ABCDEFGHIJ") + "</body></html>"
            pg = await (await b.new_context(viewport={"width": 1280, "height": 900})).new_page()
            await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
            await pg.add_init_script(STUB.replace("__MODE__", '"bg_heart"').replace("__STYLE__", '"text"'))
            await pg.goto("https://cafe.naver.com/f-e/cafes/31580371/members/abc?tab=liked")
            await pg.evaluate("__initLiked('c31580371:3766')")
            await pg.add_style_tag(path=str(EXT / "style.css")); await pg.add_script_tag(path=str(EXT / "content.js")); await pg.wait_for_timeout(300)
            res = [r for r in await pg.evaluate(CHK) if not r.endswith("ok")]
            if res: print(tw, res)
            await pg.close()
        await b.close()
    print("끝")
asyncio.run(main())
