"""새로고침해도 읽던 위치 유지 테스트 (글 보기 화면만): python3 tests/keep_scroll.py extension

- 글 보기 화면을 새로고침하면 같은 스크롤 위치로
- 목록 화면은 건드리지 않음, 링크로 이동할 때·기능을 끈 때·확장을 끈 때는 하지 않음
- 예전 카페(안쪽 화면 iframe): 바깥 창을 새로고침해도 보던 글을 다시 열고 같은 위치로
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


def article_slow(url):
    # 처음엔 짧고 1.2초 뒤에 본문이 다 뜨는 글 (사진이 늦게 뜨는 경우)
    paras = "".join(f"<p style='height:60px'>본문 {i}</p>" for i in range(8))
    more = "".join(f"<p style='height:60px'>본문 {i}</p>" for i in range(8, 60))
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ArticleContentBox"><h3>글 8001</h3>{paras}<div id="more"></div></div>
<script>setTimeout(() => document.getElementById('more').innerHTML = {json.dumps(more)}, 1200);</script></body></html>"""


def article_jumpy(url):
    # 네이버처럼 글이 뜬 뒤 스크립트가 화면을 맨 위로 올리는 글
    paras = "".join(f"<p style='height:60px'>본문 {i}</p>" for i in range(60))
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ArticleContentBox"><h3>글 8002</h3>{paras}</div>
<script>setTimeout(() => scrollTo(0, 0), 300); setTimeout(() => scrollTo(0, 0), 900);</script></body></html>"""


def old_top_jumpy(url):
    # 예전 카페: 안쪽 화면이 뜨면 바깥 창을 맨 위로 올림
    return old_top(url).replace('<iframe id="cafe_main"', '<iframe onload="setTimeout(() => scrollTo(0, 0), 200)" id="cafe_main"')


def article_imgs(url):
    # 스마트에디터처럼 문단과 사진이 번갈아 있는 글. 사진은 처음엔 높이 0이고 0.3~4.5초에 걸쳐 하나씩 뜸
    parts = []
    for i in range(30):
        parts.append(f'<div class="se-module se-module-text"><p>문단 {i} 내용입니다.</p></div>')
        parts.append(f'<div class="se-module se-module-image"><img data-lazy-src="/img/{i}.jpg" data-i="{i}" style="display:block;width:400px;height:0;background:#ccd"></div>')
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body><div class="ArticleContentBox"><h3>글 8003</h3>
<div class="se-main-container">{''.join(parts)}</div></div>
<script>
// 네이버처럼 화면 근처(위아래 400px)에 온 사진만 0.3초 뒤에 뜸
const io = new IntersectionObserver(es => es.forEach(e => {{ if (!e.isIntersecting) return; io.unobserve(e.target); setTimeout(() => e.target.style.height = '300px', 300); }}), {{ rootMargin: '400px 0px' }});
document.querySelectorAll('img[data-i]').forEach(img => io.observe(img));
</script></body></html>"""


def old_top(url):
    return """<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div style="height:60px">카페 메뉴</div><iframe id="cafe_main" name="cafe_main" src="/ArticleList.nhn?search.clubid=111&search.page=1" style="width:800px;height:12000px;border:0"></iframe></body></html>"""


def router(url):
    u = urllib.parse.urlparse(url)
    if "/articles/8003" in u.path or "articleid=8003" in u.query:
        return article_imgs(url)
    if "/articles/8002" in u.path:
        return article_jumpy(url)
    if u.path == "/mycafe2":
        return old_top_jumpy(url)
    if "/articles/8001" in u.path or "articleid=8001" in u.query:
        return article_slow(url)
    if "/articles/8000" in u.path or u.path.startswith("/ArticleRead.nhn"):
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
        # 1) 목록 화면: 확장은 위치를 맞추지 않음 (새 글이 올라오면 브라우저 기본 동작대로 밀린 글이 보임)
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1")
        await pg.evaluate("document.querySelectorAll('a.article')[30].scrollIntoView({block: 'start'})")
        before = await pg.evaluate(TOP_ROW)
        await pg.reload()
        await pg.wait_for_timeout(3000)
        after = await pg.evaluate(TOP_ROW)
        check("1 목록 화면은 건드리지 않음", after != before and not err, f"전 {before} / 후 {after} {err}")
        await b.close()

        # 2) 글 보기 화면: 새로고침하면 같은 위치
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8000")
        await pg.evaluate("scrollTo(0, 1500)")
        await pg.reload()
        await pg.wait_for_timeout(3000)
        y = await pg.evaluate("scrollY")
        check("2 글 보기 화면을 새로고침하면 읽던 위치로", abs(y - 1500) <= 2 and not err, f"scrollY {y} {err}")
        await b.close()

        # 3) 링크로 같은 글에 다시 들어가면 맨 위에서 시작
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8000")
        await pg.evaluate("scrollTo(0, 1500)")
        await pg.evaluate("location.href = location.href")
        await pg.wait_for_timeout(2500)
        y = await pg.evaluate("scrollY")
        check("3 링크로 이동할 때는 맨 위에서 시작", y == 0, f"scrollY {y}")
        await b.close()

        # 4) 예전 카페: 안쪽 화면에서 글을 읽다가 바깥 창 새로고침 → 그 글, 같은 위치
        b, pg, err = await open_page(p, "/mycafe")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleRead.nhn?clubid=111&articleid=8000'")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("scrollTo(0, 1800)")
        await pg.reload()
        await pg.wait_for_timeout(4000)
        f = pg.frame(name="cafe_main")
        y = await pg.evaluate("scrollY")
        check("4a 예전 카페: 새로고침해도 읽던 글을 다시 엶", "ArticleRead.nhn" in f.url and "articleid=8000" in f.url, f.url)
        check("4b 예전 카페: 읽던 위치로", abs(y - 1800) <= 2, f"scrollY {y}")
        check("4 오류 없음", not err, "; ".join(err))
        await b.close()

        # 5) 예전 카페: 안쪽 화면이 목록이면 건드리지 않음 (네이버 원래 동작대로 카페 첫 화면)
        b, pg, err = await open_page(p, "/mycafe")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleList.nhn?search.clubid=111&search.page=3'")
        await pg.wait_for_timeout(1200)
        await pg.reload()
        await pg.wait_for_timeout(2500)
        check("5 예전 카페: 목록은 건드리지 않음", "search.page=1" in pg.frame(name="cafe_main").url, pg.frame(name="cafe_main").url)
        await b.close()

        # 6) 기능을 끄거나 확장을 끄면 예전 카페에서 글을 다시 열지 않음
        for name, st in (("6a 기능을 끄면 동작 안 함", {"keepScroll": False}), ("6b 확장을 끄면 동작 안 함", {"enabled": False})):
            b, pg, err = await open_page(p, "/mycafe", st)
            await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleRead.nhn?clubid=111&articleid=8000'")
            await pg.wait_for_timeout(1200)
            await pg.reload()
            await pg.wait_for_timeout(2500)
            check(name, "search.page=1" in pg.frame(name="cafe_main").url, pg.frame(name="cafe_main").url)
            await b.close()

        # 8) 위치로 간 뒤 바로 직접 스크롤하면 다시 끌려가지 않음 (처음 한 번만)
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8000")
        await pg.evaluate("scrollTo(0, 1500)")
        await pg.reload()
        await pg.wait_for_timeout(150)
        await pg.mouse.move(400, 300)
        await pg.mouse.wheel(0, -900)
        await pg.wait_for_timeout(300)
        y1 = await pg.evaluate("scrollY")
        await pg.wait_for_timeout(3000)
        y2 = await pg.evaluate("scrollY")
        check("8 위치로 간 뒤 바로 스크롤하면 그대로 (다시 안 끌려감)", y1 < 1000 and abs(y2 - y1) <= 2, f"스크롤 직후 {y1}, 3초 뒤 {y2}")
        await b.close()

        # 9) 글이 늦게 떠서 아직 못 갔을 때 사용자가 스크롤하면 멈춤
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8001")
        await pg.wait_for_timeout(1500)
        await pg.evaluate("scrollTo(0, 2000)")
        await pg.reload()
        await pg.wait_for_timeout(400)
        await pg.mouse.move(400, 300)
        await pg.mouse.wheel(0, 120)
        await pg.wait_for_timeout(2500)
        y = await pg.evaluate("scrollY")
        check("9 늦게 뜨는 글: 그 사이 스크롤하면 끌려가지 않음", y < 1000, f"scrollY {y}")
        await b.close()

        # 10) 글이 늦게 떠도 가만히 있으면 다 뜬 뒤 그 위치로
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8001")
        await pg.wait_for_timeout(1500)
        await pg.evaluate("scrollTo(0, 2000)")
        await pg.reload()
        await pg.wait_for_timeout(3000)
        y = await pg.evaluate("scrollY")
        check("10 늦게 뜨는 글: 다 뜬 뒤 읽던 위치로", abs(y - 2000) <= 2, f"scrollY {y}")
        await b.close()

        # 11) 예전 카페: 바깥 창 위에서 스크롤해도(안쪽 화면 밖) 끌려가지 않음
        b, pg, err = await open_page(p, "/mycafe")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleRead.nhn?clubid=111&articleid=8000'")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("scrollTo(0, 1800)")
        await pg.reload()
        await pg.wait_for_timeout(1200)
        # 바깥 창 스크롤바를 끌어 옮김: 스크롤바를 누르면 바깥 창에 mousedown이 오고 위치가 바뀜
        await pg.evaluate("document.documentElement.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); scrollTo(0, 300)")
        await pg.wait_for_timeout(3000)
        y = await pg.evaluate("scrollY")
        check("11 예전 카페: 스크롤바로 옮겨도 끌려가지 않음", abs(y - 300) <= 2, f"scrollY {y}")
        await b.close()

        # 12) 네이버가 글을 띄운 뒤 화면을 맨 위로 올려도 읽던 위치로
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8002")
        await pg.wait_for_timeout(1200)
        await pg.evaluate("scrollTo(0, 1500)")
        await pg.reload()
        await pg.wait_for_timeout(3500)
        y = await pg.evaluate("scrollY")
        check("12 네이버가 화면을 맨 위로 올려도 읽던 위치로", abs(y - 1500) <= 2, f"scrollY {y}")
        await b.close()

        # 13) 예전 카페: 안쪽 화면이 뜰 때 바깥 창을 맨 위로 올려도 읽던 위치로
        b, pg, err = await open_page(p, "/mycafe2")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleRead.nhn?clubid=111&articleid=8000'")
        await pg.wait_for_timeout(1500)
        await pg.evaluate("scrollTo(0, 1800)")
        await pg.reload()
        await pg.wait_for_timeout(4500)
        y = await pg.evaluate("scrollY")
        check("13 예전 카페: 바깥 창을 맨 위로 올려도 읽던 위치로", abs(y - 1800) <= 2 and "articleid=8000" in pg.frame(name="cafe_main").url, f"scrollY {y}")
        await b.close()

        # 14) 사진이 많은 글: 사진이 늦게 하나씩 떠도 읽던 문단으로
        TOP_P = """(() => { for (const p of document.querySelectorAll('.se-main-container p')) { const r = p.getBoundingClientRect(); if (r.bottom > 1) return p.textContent; } })()"""
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8003")
        for _ in range(12):  # 천천히 내려가며 사진을 모두 띄움
            await pg.mouse.wheel(0, 900); await pg.wait_for_timeout(350)
        await pg.evaluate("document.querySelectorAll('.se-main-container p')[20].scrollIntoView({block: 'start'})")
        await pg.wait_for_timeout(500)
        before = await pg.evaluate(TOP_P)
        await pg.reload()
        await pg.wait_for_timeout(8000)
        after = await pg.evaluate(TOP_P)
        check("14 사진이 많은 글: 사진이 늦게 떠도 읽던 문단으로", after == before, f"전 {before} / 후 {after}")
        await b.close()

        # 15) 예전 카페 + 사진이 많은 글
        b, pg, err = await open_page(p, "/mycafe")
        await pg.evaluate("document.getElementById('cafe_main').src = '/ArticleRead.nhn?clubid=111&articleid=8003'")
        await pg.wait_for_timeout(1000)
        for _ in range(12):
            await pg.mouse.wheel(0, 900); await pg.wait_for_timeout(350)
        f = pg.frame(name="cafe_main")
        await f.evaluate("(() => { const p = document.querySelectorAll('.se-main-container p')[15]; parent.scrollTo(0, p.getBoundingClientRect().top + window.frameElement.getBoundingClientRect().top + parent.scrollY); })()")
        TOP_PF = """(() => { const dy = window.frameElement.getBoundingClientRect().top; for (const p of document.querySelectorAll('.se-main-container p')) { const r = p.getBoundingClientRect(); if (r.bottom + dy > 1) return p.textContent; } })()"""
        await pg.wait_for_timeout(500)
        before = await f.evaluate(TOP_PF)
        await pg.reload()
        await pg.wait_for_timeout(9000)
        after = await pg.frame(name="cafe_main").evaluate(TOP_PF)
        check("15 예전 카페 + 사진이 많은 글: 읽던 문단으로", after == before, f"전 {before} / 후 {after}")
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
