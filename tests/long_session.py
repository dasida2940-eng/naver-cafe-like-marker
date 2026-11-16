"""오래 열어 둔 화면 테스트: python3 tests/long_session.py extension

1. 확장이 업데이트돼 끊긴 탭에서 누른 좋아요 → 잃지 않고 새로고침 뒤 저장, 안내 표시
2. 오래 열어 둔 화면 자동 새로고침 (테스트에서는 10분 대신 1.5초)
   - 시간이 지나기 전·가만히 있을 때·글 입력 중·기능 꺼짐·확장 꺼짐이면 안 함
   - 새로고침 뒤 보던 글 위치로 돌아감 (새 글이 올라와 목록이 밀려도)
   - 예전 카페(안쪽 화면 iframe)는 안쪽 화면 주소를 유지한 채 새로고침
3. 팝업: 끊긴 탭이면 [새로고침] 안내
"""
import asyncio, json, pathlib, sys, urllib.parse
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
SRC = (pathlib.Path(__file__).parent / "liked_import.py").read_text()
STUB = SRC.split('STUB = """')[1].split('"""')[0]
AUTO_MS = 1500
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


CSS = "body{font:13px sans-serif;margin:0;padding:16px} table{width:700px;border-collapse:collapse} td{padding:10px 6px;border-bottom:1px solid #eee}"
loads = {"board": 0}


def board(url):
    loads["board"] += 1
    extra = 3 if loads["board"] > 1 else 0  # 새로고침하면 새 글 3개가 위에 올라옴
    ids = [9000 + i for i in range(extra, 0, -1)] + [9000 - i for i in range(80)]
    rows = "".join(f'<tr><td><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/{i}">글 {i} 제목</a></td><td>작성자</td></tr>' for i in ids)
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<h3>자유게시판</h3><table><tbody>{rows}</tbody></table><textarea id="memo" placeholder="댓글"></textarea></body></html>"""


def article(url):
    return """<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="ArticleContentBox"><h3>글 8000</h3><p>본문</p>
<a class="u_likeit_list_btn" href="#" onclick="event.preventDefault(); this.classList.toggle('on')">좋아요</a></div></body></html>"""


def old_top(url):
    return """<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
<div style="height:60px">카페 메뉴</div><iframe id="cafe_main" name="cafe_main" src="/ArticleList.nhn?search.clubid=111&search.page=3" style="width:800px;height:2000px;border:0"></iframe></body></html>"""


def router(route):
    u = urllib.parse.urlparse(route.request.url)
    if "/articles/8000" in u.path:
        return article(route.request.url)
    if u.path.startswith("/ArticleList.nhn"):
        return board(route.request.url)
    if u.path == "/mycafe":
        return old_top(route.request.url)
    return board(route.request.url)


async def open_page(p, path, store=None, auto_ms=AUTO_MS):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={"width": 1000, "height": 600})
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    async def handle(route):
        await route.fulfill(body=router(route), content_type="text/html; charset=utf-8")
    await pg.route("https://cafe.naver.com/**", handle)
    if store is not None:
        await pg.add_init_script("if (!localStorage.getItem('__ncl_store')) localStorage.setItem('__ncl_store', " + json.dumps(json.dumps(store)) + ");")
    await pg.add_init_script(f"window.__nclAutoMs = {auto_ms}; if (window === window.top) sessionStorage.setItem('loads', +(sessionStorage.getItem('loads') || 0) + 1);")
    await pg.add_init_script(STUB)
    css = (EXT / "style.css").read_text()
    await pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = " + json.dumps(css) + "; document.head.appendChild(s); });")
    await pg.add_init_script((EXT / "content.js").read_text())
    await pg.goto("https://cafe.naver.com" + path)
    await pg.wait_for_timeout(500)
    return b, pg, errors


async def loads_count(pg):
    return await pg.evaluate("+sessionStorage.getItem('loads')")


async def top_row(pg):
    return await pg.evaluate("""(() => { for (const a of document.querySelectorAll('a.article')) { const r = a.getBoundingClientRect(); if (r.top >= -10) return a.textContent; } })()""")


async def main():
    async with async_playwright() as p:
        # 1) 확장과 끊긴 탭에서 누른 좋아요
        b, pg, err = await open_page(p, "/f-e/cafes/111/articles/8000", store={})
        # 확장 업데이트로 끊긴 상태 흉내: 확장 ID가 사라지고 저장하면 예외
        await pg.evaluate("""(() => { delete chrome.runtime.id; chrome.storage.local.set = () => { throw new Error('Extension context invalidated.'); }; })()""")
        await pg.click(".u_likeit_list_btn")
        await pg.wait_for_timeout(700)
        pending = await pg.evaluate("JSON.parse(localStorage.getItem('ncl-pending') || '[]')")
        toast = await pg.evaluate("(document.getElementById('ncl-toast') || {}).textContent || ''")
        saved = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('__ncl_store')).likedArticles || {}).length")
        check("1a 끊긴 탭에서 누른 좋아요를 보관", len(pending) == 1 and pending[0]["a"] == "8000" and pending[0]["v"] is True, str(pending))
        check("1b 새로고침하라는 안내 표시", "새로고침" in toast, toast)
        check("1c 오류로 멈추지 않음", not err, "; ".join(err))
        await pg.reload()
        await pg.wait_for_timeout(700)
        recs = await pg.evaluate("Object.values(JSON.parse(localStorage.getItem('__ncl_store')).likedArticles || {})")
        left = await pg.evaluate("localStorage.getItem('ncl-pending')")
        check("1d 새로고침하면 보관한 좋아요가 저장됨 (누른 시각 그대로)", saved == 0 and len(recs) == 1 and recs[0]["a"] == "8000" and recs[0]["t"] == pending[0]["t"] and left is None, f"{recs} 남은 보관 {left}")
        await b.close()

        # 2) 자동 새로고침
        loads["board"] = 0
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1", store={})
        await pg.evaluate("document.querySelectorAll('a.article')[30].scrollIntoView({block: 'start'})")
        before_row = await top_row(pg)
        await pg.mouse.move(200, 200)
        await pg.mouse.move(220, 210)
        await pg.wait_for_timeout(300)
        check("2a 10분(테스트 1.5초)이 지나기 전에는 새로고침 안 함", await loads_count(pg) == 1)
        await pg.wait_for_timeout(AUTO_MS + 300)
        check("2b 가만히 보고만 있으면 새로고침 안 함", await loads_count(pg) == 1)
        await pg.mouse.move(240, 230)
        await pg.wait_for_timeout(3200)
        after_row = await top_row(pg)
        check("2c 시간이 지난 뒤 마우스를 움직이면 새로고침", await loads_count(pg) == 2, str(await loads_count(pg)))
        check("2d 새 글이 올라와도 보던 글 위치로 돌아감", after_row == before_row, f"전 {before_row} / 후 {after_row}")
        check("2e 오류 없음", not err, "; ".join(err))
        await b.close()

        # 3) 글 입력 중이면 안 함
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1", store={})
        await pg.fill("#memo", "쓰던 댓글")
        await pg.mouse.click(500, 100)  # 입력칸 밖을 눌러도 써 둔 내용이 있으면 안 함
        await pg.wait_for_timeout(AUTO_MS + 300)
        await pg.mouse.move(300, 300)
        await pg.keyboard.press("ArrowDown")
        await pg.wait_for_timeout(1000)
        check("3 써 둔 댓글이 있으면 새로고침 안 함", await loads_count(pg) == 1 and await pg.input_value("#memo") == "쓰던 댓글")
        await b.close()

        # 4) 자동 새로고침 끔 / 확장 끔
        for name, st in (("4a 자동 새로고침을 끄면 안 함", {"autoRefresh": False}), ("4b 확장을 끄면 안 함", {"enabled": False})):
            b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1", store=st)
            await pg.wait_for_timeout(AUTO_MS + 300)
            await pg.mouse.move(300, 300)
            await pg.wait_for_timeout(1000)
            check(name, await loads_count(pg) == 1)
            await b.close()

        # 5) 탭으로 돌아왔을 때
        b, pg, err = await open_page(p, "/f-e/cafes/111/menus/1", store={})
        await pg.wait_for_timeout(AUTO_MS + 300)
        await pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        await pg.wait_for_timeout(1500)
        check("5 시간이 지난 뒤 탭으로 돌아오면 새로고침", await loads_count(pg) == 2)
        await b.close()

        # 6) 예전 카페: 바깥 창을 새로고침해도 안쪽 화면(게시판 3쪽)을 유지
        b, pg, err = await open_page(p, "/mycafe", store={})
        await pg.wait_for_timeout(AUTO_MS + 300)
        await pg.mouse.move(100, 20)  # 바깥 창(카페 메뉴) 위에서 움직임
        await pg.wait_for_timeout(1500)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(pg.url).query)
        inner = q.get("iframe_url_utf8", [""])[0]
        check("6 예전 카페는 안쪽 화면 주소를 붙여 새로고침", inner.startswith("/ArticleList.nhn") and "search.page=3" in inner, pg.url)
        await b.close()

        # 7) 팝업: 끊긴 탭 안내
        for name, connected, url in (("7a 끊긴 카페 탭이면 새로고침 안내", False, "https://cafe.naver.com/mycafe"),
                                     ("7b 연결된 탭이면 안내 없음", True, "https://cafe.naver.com/mycafe"),
                                     ("7c 카페가 아닌 탭이면 안내 없음", False, "https://www.google.com/")):
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={"width": 260, "height": 700})
            await pg.add_init_script("""window.chrome = { storage: { local: { get(k, cb) { setTimeout(() => cb({})); }, set() {} } },
              runtime: { lastError: null }, tabs: { query(q, cb) { cb([{ id: 1, url: %s }]); }, reload(id) { window.__reloaded = id; },
              sendMessage(id, m, cb) { setTimeout(() => cb(m.type === 'ncl-ping' && %s ? { ok: true } : undefined)); } } };""" % (json.dumps(url), "true" if connected else "false"))
            await pg.goto((EXT / "popup.html").as_uri())
            await pg.wait_for_timeout(400)
            shown = await pg.evaluate("document.getElementById('stale').classList.contains('show')")
            ok = shown == (not connected and "cafe.naver.com" in url)
            if shown:
                await pg.click("#staleReload")
                ok = ok and await pg.evaluate("window.__reloaded === 1")
            check(name, ok, f"안내 {shown}")
            await b.close()

    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")


asyncio.run(main())
