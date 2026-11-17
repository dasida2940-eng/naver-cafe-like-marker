"""새로고침해도 보던 위치 유지 테스트: python3 tests/keep_scroll.py extension

- 새로고침하면 화면 맨 위에 있던 글로 돌아감 (새 글이 올라와 목록이 밀려도)
- 링크로 이동할 때·기능을 끈 때·확장을 끈 때는 하지 않음
- 예전 카페(안쪽 화면 iframe): 바깥 창을 새로고침해도 보던 게시판 페이지와 위치로
"""
import asyncio, json, pathlib, sys, urllib.parse
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
SRC = (pathlib.Path(__file__).parent / "liked_import.py").read_text()
STUB = SRC.split('STUB = """')[1].split('"""')[0]
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


CSS = "body{font:13px sans-serif;margin:0;padding:16px} table{width:700px;border-collapse:collapse} td{padding:10px 6px;border-bottom:1px solid #eee}"
loads = {}


def board(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    page = int(q.get("search.page", q.get("page", ["1"]))[0])
    key = f"board{page}"
    loads[key] = loads.get(key, 0) + 1
    extra = 3 * (loads[key] - 1)  # 새로 불러올 때마다 새 글 3개가 위에 올라옴
    start = 9000 - (page - 1) * 80
    ids = [start + i for i in range(extra, 0, -1)] + [start - i for i in range(80)]
    rows = "".join(f'<tr><td><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/{i}">글 {i} 제목</a></td><td>작성자</td></tr>' for i in ids)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<h3>자유게시판 {page}쪽</h3><table><tbody>{rows}</tbody></table></body></html>"""


def article(url):
    paras = "".join(f"<p style='height:60px'>본문 {i}</p>" for i in range(60))
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ArticleContentBox"><h3>글 8000</h3>{paras}</div></body></html>"""


def old_top(url):
    return """<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div style="height:60px">카페 메뉴</div><iframe id="cafe_main" name="cafe_main" src="/ArticleList.nhn?search.clubid=111&search.page=1" style="width:800px;height:4200px;border:0"></iframe></body></html>"""


def router(url):
    u = urllib.parse.urlparse(url)
    if "/articles/8000" in u.path:
        return article(url)
    if u.path == "/mycafe":
        return old_top(url)
    return board(url)


async def open_page(p, path, store=None):
    loads.clear()
    b = await p.chromium.launch()
    pg = await (await b.new_context(viewport={"width": 1000, "height": 600})).new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    async def handle(route):
        await route.fulfill(body=router(route.request.url), content_type="text/html; charset=utf-8")
    await pg.route("https://cafe.naver.com/**", handle)
    await pg.add_init_script("if (!localStorage.getItem('__ncl_store')) localStorage.setItem('__ncl_store', " + json.dumps(json.dumps(store or {})) + ");")
    await pg.add_init_script(STUB)
    await pg.add_init_script((EXT / "content.js").read_text())
    await pg.goto("https://cafe.naver.com" + path)
    await pg.wait_for_timeout(500)
    return b, pg, errors


TOP_ROW = """(() => { for (const a of document.querySelectorAll('a.article')) { const r = a.getBoundingClientRect(); if (r.top >= -10) return a.textContent; } })()"""


async def frame_top_row(pg):
    # 예전 카페: 안쪽 화면의 글이 바깥 창 화면 기준으로 맨 위에 보이는 것
    f = pg.frame(name="cafe_main")
    return await f.evaluate("""(() => { const dy = window.frameElement.getBoundingClientRect().top;
      for (const a of document.querySelectorAll('a.article')) { const r = a.getBoundingClientRect(); if (r.top + dy >= -10) return a.textContent; } })()""")


async def main():
    async with async_playwright() as p:
        # 1) 새로고침 → 보던 글로 (새 글 3개가 위에 올라와도)
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1")
        await pg.evaluate("document.querySelectorAll('a.article')[30].scrollIntoView({block: 'start'})")
        before = await pg.evaluate(TOP_ROW)
        await pg.reload()
        await pg.wait_for_timeout(3000)
        after = await pg.evaluate(TOP_ROW)
        check("1 새로고침하면 보던 글 위치로 (새 글이 올라와도)", after == before, f"전 {before} / 후 {after}")
        check("1 오류 없음", not err, "; ".join(err))
        await b.close()

        # 2) 링크로 같은 주소에 다시 들어가면 맨 위에서 시작
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1")
        await pg.evaluate("document.querySelectorAll('a.article')[30].scrollIntoView({block: 'start'})")
        await pg.evaluate("location.href = location.href")
        await pg.wait_for_timeout(2500)
        y = await pg.evaluate("scrollY")
        check("2 링크로 이동할 때는 맨 위에서 시작", y == 0, f"scrollY {y}")
        await b.close()

        # 3) 기능을 끄거나 확장을 끄면 보던 글로 맞추지 않음 (브라우저 기본 동작만)
        for name, st in (("3a 기능을 끄면 동작 안 함", {"keepScroll": False}), ("3b 확장을 끄면 동작 안 함", {"enabled": False})):
            b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1", st)
            await pg.evaluate("document.querySelectorAll('a.article')[30].scrollIntoView({block: 'start'})")
            before = await pg.evaluate(TOP_ROW)
            await pg.reload()
            await pg.wait_for_timeout(3000)
            after = await pg.evaluate(TOP_ROW)
            check(name, after != before, f"전 {before} / 후 {after}")
            await b.close()

        # 4) 글 보기 화면: 같은 스크롤 위치
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8000")
        await pg.evaluate("scrollTo(0, 1500)")
        await pg.reload()
        await pg.wait_for_timeout(3000)
        y = await pg.evaluate("scrollY")
        check("4 글 보기 화면도 같은 위치로", abs(y - 1500) <= 2, f"scrollY {y}")
        await b.close()

        # 5) 예전 카페: 안쪽 화면을 3쪽으로 옮긴 뒤 바깥 창 새로고침 → 3쪽, 보던 글로
        b, pg, err = await open_page(p, "/mycafe")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleList.nhn?search.clubid=111&search.page=3'")
        await pg.wait_for_timeout(1200)
        await pg.frame(name="cafe_main").evaluate("document.querySelectorAll('a.article')[25].scrollIntoView({block: 'start'})")
        await pg.wait_for_timeout(200)
        before = await frame_top_row(pg)
        await pg.reload()
        await pg.wait_for_timeout(4000)
        f = pg.frame(name="cafe_main")
        inner = urllib.parse.urlparse(f.url)
        after = await frame_top_row(pg)
        check("5a 예전 카페: 새로고침해도 보던 게시판 페이지(3쪽)로", "search.page=3" in inner.query, f.url)
        check("5b 예전 카페: 보던 글 위치로 (새 글이 올라와도)", after == before, f"전 {before} / 후 {after}")
        check("5 오류 없음", not err, "; ".join(err))
        await b.close()

        # 6) 예전 카페에서 기능을 끄면 안쪽 화면은 카페 첫 화면(1쪽)으로 (원래 네이버 동작)
        b, pg, err = await open_page(p, "/mycafe", {"keepScroll": False})
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleList.nhn?search.clubid=111&search.page=3'")
        await pg.wait_for_timeout(1200)
        await pg.reload()
        await pg.wait_for_timeout(2500)
        check("6 기능을 끄면 예전 카페는 원래대로 첫 화면", "search.page=1" in pg.frame(name="cafe_main").url, pg.frame(name="cafe_main").url)
        await b.close()

        # 7) 팝업 옵션
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.add_init_script("""window.__set = {}; window.chrome = { storage: { local: { get(k, cb) { setTimeout(() => cb({})); }, set(o) { Object.assign(window.__set, o); } } },
          runtime: { lastError: null }, tabs: { query(q, cb) { cb([{ id: 1 }]); }, sendMessage(id, m, cb) { setTimeout(() => cb(null)); } } };""")
        await pg.goto((EXT / "popup.html").as_uri())
        await pg.wait_for_timeout(300)
        on = await pg.is_checked("#keep")
        await pg.click("#keep")
        saved = await pg.evaluate("window.__set.keepScroll")
        check("7 팝업: 기본 켜짐, 끄면 저장", on and saved is False, f"기본 {on}, 저장 {saved}")
        await b.close()

    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")


asyncio.run(main())
