"""좋아요 기록이 아주 많을 때(2만 개) 속도 테스트: python3 tests/many_likes.py extension
- 목록 50줄 표시에 걸리는 시간, 화면이 바뀔 때 다시 표시하는 시간
- 최근 좋아요한 글로 이동 시작까지의 시간
"""
import asyncio, json, pathlib, sys, time
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
SRC = (pathlib.Path(__file__).parent / "liked_import.py").read_text()
STUB = SRC.split('STUB = """')[1].split('"""')[0]
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


N = 20000
LIKED = {f"111||{a}": {"c": "111", "n": None, "a": str(a), "t": 1700000000000 + a} for a in range(100000, 100000 + N)}
ROWS = "".join(f'<tr><td><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/{a}">글 {a} 제목입니다</a></td><td>작성자</td></tr>' for a in range(100000 + N - 1, 100000 + N - 51, -1))
PAGE = f"""<!doctype html><html><head><meta charset="utf-8"></head><body><table><tbody id="tb">{ROWS}</tbody></table>
<div class="pagination"><strong>1</strong><button>2</button></div></body></html>"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1000, "height": 700})
        await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=PAGE, content_type="text/html; charset=utf-8"))
        await pg.add_init_script("localStorage.setItem('__ncl_store', " + json.dumps(json.dumps({"likedArticles": LIKED})) + ");")
        await pg.add_init_script(STUB)
        css = (EXT / "style.css").read_text()
        await pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = " + json.dumps(css) + "; document.head.appendChild(s); });")
        await pg.add_init_script((EXT / "content.js").read_text())
        t0 = time.time()
        await pg.goto("https://cafe.naver.com/f-e/cafes/111/menus/1")
        await pg.wait_for_function("document.querySelectorAll('.ncl-liked-row').length === 50", timeout=15000)
        t1 = time.time() - t0
        check("목록 50줄 표시 (좋아요 2만 개)", t1 < 3, f"{t1:.2f}초")
        # 화면이 바뀔 때 (목록을 새로 그림)
        t0 = time.time()
        await pg.evaluate("(() => { const tb = document.getElementById('tb'); tb.innerHTML = tb.innerHTML.replace(/글 /g, '글  '); })()")
        await pg.wait_for_function("document.querySelectorAll('.ncl-liked-row').length === 50", timeout=15000)
        t2 = time.time() - t0
        check("목록을 새로 그릴 때 다시 표시", t2 < 1.5, f"{t2:.2f}초")
        # 이동 기능: 상태 확인(최근 좋아요 목록 계산)
        t0 = time.time()
        st = await pg.evaluate("""() => new Promise(res => (window.__msg || []).forEach(f => f({ type: 'ncl-jump', action: 'status' }, {}, res)))""")
        t3 = time.time() - t0
        check("이동 기능 상태 확인", st is not None and st["likes"] == 300 and t3 < 1, f"{t3:.2f}초, 대상 {st and st['likes']}개")
        await b.close()
    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")


asyncio.run(main())
