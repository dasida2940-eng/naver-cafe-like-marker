"""최근 좋아요한 글로 이동 + 켜기/끄기 테스트: python3 tests/jump_onoff.py extension

게시판 목록을 두 형태로 흉내 냄 (글 250개, 한 페이지 10개, 번호 10개씩 묶음 + 이전/다음)
  S. 한 화면 안에서 목록만 바뀌는 형태
  R. 페이지 번호가 링크라서 페이지가 새로 로드되는 형태
게시판 글은 짝수 번호만 (홀수 번호 = 다른 게시판 글), 위에 고정 공지(오래된 글) 2개
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


TOTAL, PER = 250, 10
NOTICES = 2
IDS = [9000 - 2 * i for i in range(TOTAL)]          # 9000, 8998, … (이 게시판)
CSS = """body{font:13px sans-serif;margin:0;padding:16px} table{width:700px;border-collapse:collapse} td{padding:6px;border-bottom:1px solid #eee}
.pagination{display:flex;gap:6px;margin-top:10px} .pagination a,.pagination button,.pagination strong{padding:2px 6px}"""
def notice_html():
    # 네이버처럼 공지는 목록 위 별도 표 (#upperArticleList)
    rows_ = "".join(f'<tr><td><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/{12 + 7 * i}">[공지] 안내 {i}</a></td><td>매니저</td></tr>' for i in range(NOTICES))
    return f'<div class="article-board" id="upperArticleList"><table><tbody>{rows_}</tbody></table></div>'


def pages_count():
    return (TOTAL + PER - 1) // PER


def rows(page):
    return "".join(
        f'<tr><td><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/{i}">글 {i} 제목</a></td><td>작성자</td><td>2026.11.13.</td></tr>'
        for i in IDS[(page - 1) * PER: page * PER])


def pager_html(page, link):
    group = (page - 1) // 10 * 10
    el = (lambda p, t, c="": f'<a class="{c}" href="?page={p}">{t}</a>') if link else (lambda p, t, c="": f'<button class="{c}" data-p="{p}">{t}</button>')
    h = el(group, "이전", "btn_prev") if group > 0 else ""
    for p in range(group + 1, min(group + 10, pages_count()) + 1):
        h += f'<strong class="on">{p}</strong>' if p == page else el(p, str(p))
    if group + 10 < pages_count():
        h += el(group + 11, "다음", "btn_next")
    return h


def page_s(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    start = int(q.get("page", ["1"])[0])
    data = json.dumps({str(p): rows(p) for p in range(1, pages_count() + 1)})
    pagers = json.dumps({str(p): pager_html(p, False) for p in range(1, pages_count() + 1)})
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<h3>자유게시판</h3>{notice_html()}<table class="board"><tbody id="tb"></tbody></table><div class="pagination" id="pager"></div>
<script>
const ROWS = {data}, PAGERS = {pagers};
let page = {start};
function render() {{ document.getElementById('tb').innerHTML = ROWS[page]; document.getElementById('pager').innerHTML = PAGERS[page]; }}
document.getElementById('pager').addEventListener('click', e => {{ const b = e.target.closest('button'); if (!b) return; page = +b.dataset.p; setTimeout(render, 120); }});
render();
</script></body></html>"""


def page_r(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    page = int(q.get("page", ["1"])[0])
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<h3>자유게시판</h3>{notice_html()}<table class="board"><tbody>{rows(page)}</tbody></table><div class="pagination">{pager_html(page, True)}</div></body></html>"""


def page_article(url):
    return """<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="ArticleContentBox"><h3>글 8000</h3><p>본문</p>
<a class="u_likeit_list_btn" href="#" onclick="event.preventDefault(); this.classList.toggle('on')">좋아요</a></div></body></html>"""


async def open_page(p, html_fn, path, likes=None, enabled=None):
    b = await p.chromium.launch()
    pg = await (await b.new_context(viewport={"width": 1000, "height": 700})).new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    async def handle(route):
        await route.fulfill(body=html_fn(route.request.url), content_type="text/html; charset=utf-8")
    await pg.route("https://cafe.naver.com/**", handle)
    store = {}
    if likes is not None:
        store["likedArticles"] = {f"111||{a}": {"c": "111", "n": None, "a": str(a), "t": t} for a, t in likes}
    if enabled is not None:
        store["enabled"] = enabled
    await pg.add_init_script("if (!localStorage.getItem('__ncl_store')) localStorage.setItem('__ncl_store', " + json.dumps(json.dumps(store)) + ");")
    await pg.add_init_script(STUB)
    css = (EXT / "style.css").read_text()
    await pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = " + json.dumps(css) + "; document.head.appendChild(s); });")
    await pg.add_init_script((EXT / "content.js").read_text())
    await pg.goto("https://cafe.naver.com" + path)
    await pg.wait_for_timeout(500)
    return b, pg, errors


async def send(pg, type_, action):
    return await pg.evaluate("""(m) => new Promise(res => { let done = false;
      (window.__msg || []).forEach(f => { f(m, {}, v => { if (!done) { done = true; res(v); } }); });
      setTimeout(() => { if (!done) res(null); }, 800); })""", {"type": type_, "action": action})


async def jump(pg, ms=90000):
    st = await send(pg, "ncl-jump", "start")
    if not st or not st.get("ok"):
        return {"start": st}
    end = asyncio.get_event_loop().time() + ms / 1000
    while asyncio.get_event_loop().time() < end:
        await asyncio.sleep(0.4)
        try:
            st = await send(pg, "ncl-jump", "status")
        except Exception:
            continue  # 새로 로드되는 중
        if st and not st["jumping"] and st["status"]["state"] not in ("idle", "running"):
            return st["status"]
    return {"timeout": st}


async def current_page(pg):
    return await pg.evaluate("+(document.querySelector('.pagination strong')||{textContent:'0'}).textContent")


async def flashed(pg):
    return await pg.evaluate("(() => { const r = document.querySelector('.ncl-jump-flash'); return r ? r.textContent.trim().split(/\\s+/).slice(0,2).join(' ') : null; })()")


async def main():
    async with async_playwright() as p:
        page_of = lambda a: IDS.index(a) // PER + 1  # PER는 실행 시점 값
        for kind, fn in (("S", page_s), ("R", page_r)):
            # 1) 가장 최근 좋아요가 이 게시판 글 → 그 페이지로
            b, pg, err = await open_page(p, fn, "/f-e/cafes/111/menus/1", likes=[(8900, 300), (8500, 200), (8100, 100)])
            st = await jump(pg)
            cp = await current_page(pg)
            check(f"{kind}1 가장 최근 좋아요 글 페이지로 이동", st.get("state") == "done" and cp == page_of(8900), f"{st} 지금 {cp}쪽, 기대 {page_of(8900)}쪽")
            check(f"{kind}1 그 줄 강조", (await flashed(pg)) == "글 8900", str(await flashed(pg)))
            check(f"{kind}1 오류 없음", not err, "; ".join(err))
            await b.close()

            # 2) 가장 최근 좋아요가 다른 게시판 글(홀수) → 지나치면 건너뛰고 다음 최근 좋아요로
            b, pg, err = await open_page(p, fn, "/f-e/cafes/111/menus/1", likes=[(8955, 300), (8600, 200), (8100, 100)])
            st = await jump(pg)
            cp = await current_page(pg)
            check(f"{kind}2 다른 게시판 글은 건너뜀", st.get("state") == "done" and cp == page_of(8600) and st.get("pages", 99) <= page_of(8600), f"{st} 지금 {cp}쪽")
            await b.close()

            # 3) 다른 게시판의 아주 오래된 글이 가장 최근 좋아요 → 끝까지 본 뒤 앞쪽 페이지로 되돌아감
            b, pg, err = await open_page(p, fn, "/f-e/cafes/111/menus/1", likes=[(101, 300), (8600, 200)])
            st = await jump(pg, 180000)
            cp = await current_page(pg)
            check(f"{kind}3 끝까지 본 뒤 찾은 글 페이지로 되돌아감", st.get("state") == "done" and cp == page_of(8600), f"{st} 지금 {cp}쪽")
            await b.close()

            # 4) 중간 페이지에서 눌러도 1쪽부터 찾음 (찾는 글이 앞쪽에 있음)
            b, pg, err = await open_page(p, fn, "/f-e/cafes/111/menus/1?page=14", likes=[(8960, 300)])
            st = await jump(pg)
            cp = await current_page(pg)
            check(f"{kind}4 중간 페이지에서 시작해도 앞쪽 글을 찾음", st.get("state") == "done" and cp == page_of(8960), f"{st} 지금 {cp}쪽")
            await b.close()

        # 4b) 네이버 전체글보기처럼 페이지 번호 영역이 .prev-next (번호 링크, 새로 로드)
        def page_pn(url):
            return page_r(url).replace('<div class="pagination">', '<div class="prev-next">').replace('class="btn_next"', 'class="pgR"').replace('class="btn_prev"', 'class="pgL"')
        b, pg, err = await open_page(p, page_pn, "/f-e/cafes/111/menus/1?page=3", likes=[(8700, 300)])
        st = await jump(pg)
        cp = await pg.evaluate("+(document.querySelector('.prev-next strong')||{textContent:'0'}).textContent")
        check("4b 네이버 전체글보기 형태(.prev-next) 페이지 넘기기", st.get("state") == "done" and cp == page_of(8700), f"{st} 지금 {cp}쪽")
        await b.close()

        # 4c) 좋아요한 글 탭 화면에서는 이동 기능이 대답하지 않음 (가져오기 기능만)
        b, pg, err = await open_page(p, lambda u: page_r(u).replace("<h3>자유게시판</h3>", '<ul class="tabs"><li><a href="#">작성글</a></li><li><a href="#">댓글단 글</a></li><li class="on"><a href="#" aria-selected="true">좋아요한 글</a></li></ul>'), "/f-e/cafes/111/members/x", likes=[(9000, 1)])
        st = await send(pg, "ncl-jump", "status")
        check("4c 좋아요한 글 탭 화면에서는 이동 버튼 안 나옴", st is None, str(st))
        await b.close()

        # 4d) 한 페이지에 5개씩 보기 + 공지 7개 (공지 표가 게시글 표보다 큼)
        global PER, NOTICES
        PER, NOTICES = 5, 7
        for kind, fn in (("S", page_s), ("R", page_r)):
            b, pg, err = await open_page(p, fn, "/f-e/cafes/111/menus/1", likes=[(8900, 300), (8500, 200)])
            st = await jump(pg)
            cp = await current_page(pg)
            check(f"4d-{kind} 5개씩 보기 + 공지 7개에서도 그 페이지에 멈춤", st.get("state") == "done" and cp == page_of(8900), f"{st} 지금 {cp}쪽, 기대 {page_of(8900)}쪽")
            check(f"4d-{kind} 그 줄 강조", (await flashed(pg)) == "글 8900", str(await flashed(pg)))
            await b.close()
        PER, NOTICES = 10, 2

        # 5) 이 카페 좋아요 없음 / 이 게시판에 없음
        b, pg, err = await open_page(p, page_s, "/f-e/cafes/111/menus/1", likes=[])
        st = await jump(pg)
        check("5a 좋아요가 없으면 알려 줌", st.get("state") == "nolikes", str(st))
        await b.close()
        b, pg, err = await open_page(p, page_s, "/f-e/cafes/111/menus/1", likes=[(8999, 300), (8997, 200)])
        st = await jump(pg)
        check("5b 이 게시판에 없으면 알려 줌", st.get("state") == "notfound" and st.get("pages", 99) <= 3, str(st))
        await b.close()

        # 6) 끄기: 표시가 모두 사라지고, 이동·좋아요 기록이 동작하지 않음 / 다시 켜면 표시
        b, pg, err = await open_page(p, page_s, "/f-e/cafes/111/menus/1", likes=[(9000, 300), (8998, 200)])
        on_rows = await pg.evaluate("document.querySelectorAll('.ncl-liked-row').length")
        await pg.evaluate("chrome.storage.local.set({enabled: false})")
        await pg.wait_for_timeout(300)
        off_rows = await pg.evaluate("document.querySelectorAll('.ncl-liked-row, .ncl-heart-dot').length")
        st = await send(pg, "ncl-jump", "start")
        check("6a 끄면 표시가 모두 사라짐", on_rows == 2 and off_rows == 0, f"켜짐 {on_rows}줄, 꺼짐 {off_rows}")
        check("6b 꺼져 있으면 이동 안 함", st is not None and st.get("ok") is False, str(st))
        await pg.evaluate("chrome.storage.local.set({enabled: true})")
        await pg.wait_for_timeout(300)
        back_rows = await pg.evaluate("document.querySelectorAll('.ncl-liked-row').length")
        check("6c 다시 켜면 다시 표시", back_rows == 2, str(back_rows))
        await b.close()

        b, pg, err = await open_page(p, page_article, "/f-e/cafes/111/articles/8000", likes=[], enabled=False)
        await pg.click(".u_likeit_list_btn")
        await pg.wait_for_timeout(600)
        n_off = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('__ncl_store')).likedArticles||{}).length")
        await pg.evaluate("chrome.storage.local.set({enabled: true})")
        await pg.click(".u_likeit_list_btn")
        await pg.wait_for_timeout(600)
        await pg.click(".u_likeit_list_btn")
        await pg.wait_for_timeout(600)
        n_on = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('__ncl_store')).likedArticles||{}).length")
        check("6d 꺼져 있을 때 누른 좋아요는 기록 안 함, 켜면 기록", n_off == 0 and n_on == 1, f"꺼짐 {n_off}, 켜짐 {n_on}")
        await b.close()

        # 7) 처음 설치(설정 없음)는 켜진 상태
        b, pg, err = await open_page(p, page_s, "/f-e/cafes/111/menus/1", likes=[(9000, 1)])
        check("7 설정이 없으면 켜짐", await pg.evaluate("document.querySelectorAll('.ncl-liked-row').length") == 1)
        await b.close()

    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")


asyncio.run(main())
