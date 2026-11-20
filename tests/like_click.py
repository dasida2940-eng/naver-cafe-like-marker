"""좋아요 버튼 누르기 테스트: python3 tests/like_click.py extension

실제 네이버 글 화면(바깥 /decompile, 안쪽 /ca-fe/cafes/.../articles/...)을 흉내 내서 검사
  - 좋아요를 누르면 기록되고, 카페 이름에 "decompile"이 들어가지 않는지
  - 바로 옆 "좋아요한 멤버 리스트"를 눌러도 기록이 지워지지 않는지
  - 다시 누르면(취소) 기록이 지워지는지
  - 예전에 잘못 저장된 "decompile" 이름이 정리되고, 목록에서 하트가 보이는지
"""
import asyncio, json, pathlib, sys, urllib.parse
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
# liked_import.py와 같은 가짜 chrome.storage 사용
_src = (pathlib.Path(__file__).parent / "liked_import.py").read_text()
STUB = _src.split('STUB = """', 1)[1].split('"""', 1)[0]

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


CLUB, ART, NAME = "31580371", "4071", "goodcafe"
INNER = f"/ca-fe/cafes/{CLUB}/articles/{ART}?referrerAllArticles=true&oldPath=%2FArticleRead.nhn%3Fclubid%3D{CLUB}%26articleid%3D{ART}"
TOP = "/decompile?iframe_url_utf8=" + urllib.parse.quote(INNER, safe="")

# 실제 기록에 나온 좋아요 영역 구조 그대로
ARTICLE = """<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="ReplyBox"><div class="box_left"><div class="like_article">
<div class="ReactionLikeIt u_likeit_list_module _cafeReactionModule">
<a href="#" class="like_no u_likeit_list_btn _button off" aria-pressed="false"><span class="u_ico _icon"></span><em class="u_txt">좋아요</em><em class="u_cnt _count">0</em></a>
</div><a href="#" class="like_count_btn">이 글을 '좋아요'한 멤버 리스트</a></div></div></div>
<script>
const b = document.querySelector('._button');
b.addEventListener('click', e => { e.preventDefault(); setTimeout(() => {
  const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.classList.toggle('off', !on);
  b.setAttribute('aria-pressed', on); b.querySelector('._count').textContent = on ? 1 : 0; }, 60); });
document.querySelector('.like_count_btn').addEventListener('click', e => e.preventDefault());
</script></body></html>"""

LIST = f"""<!doctype html><html><head><meta charset="utf-8"></head><body><table class="article-board"><tbody>
<tr><td class="td_article"><div class="board-list"><a class="article" href="/{NAME}/{ART}">좋아요한 글</a></div></td></tr>
<tr><td class="td_article"><div class="board-list"><a class="article" href="/{NAME}/4072">다른 글</a></div></td></tr>
</tbody></table></body></html>"""


def frame_page(inner_src):
    return f'<!doctype html><html><body><iframe id="cafe_main" name="cafe_main" src="{inner_src}" style="width:900px;height:600px"></iframe></body></html>'


def serve(url):
    u = urllib.parse.urlparse(url)
    if u.path == "/decompile":
        return frame_page(INNER)
    if u.path.startswith("/ca-fe/cafes/"):
        return ARTICLE
    if u.path == f"/{NAME}":
        return frame_page(f"/ArticleList.nhn?search.clubid={CLUB}&search.boardtype=L")
    if u.path == "/ArticleList.nhn":
        return LIST
    return "<html><body></body></html>"


store = lambda pg: pg.evaluate("JSON.parse(localStorage.getItem('__ncl_store')||'{}')")


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1100, "height": 800})
        errors = []

        async def handle(route):
            await route.fulfill(body=serve(route.request.url), content_type="text/html; charset=utf-8")
        await ctx.route("https://cafe.naver.com/**", handle)
        await ctx.add_init_script(STUB)
        await ctx.add_init_script((EXT / "content.js").read_text())
        pg = await ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))

        # 처음 상태: 카페 이름 지도에는 진짜 이름만
        await pg.goto("https://cafe.naver.com/")
        await pg.evaluate("localStorage.setItem('__ncl_store', JSON.stringify({cafeMap: {%s: '%s'}}))" % (CLUB, NAME))

        await pg.goto("https://cafe.naver.com" + TOP)
        await pg.wait_for_timeout(600)
        inner = pg.frame(name="cafe_main")
        await inner.click("._button")
        await pg.wait_for_timeout(600)
        s = await store(pg)
        recs = list((s.get("likedArticles") or {}).values())
        check("좋아요 누르면 기록됨", any(r["a"] == ART for r in recs), json.dumps(recs, ensure_ascii=False))
        check("카페 이름에 decompile이 안 들어감", all(r.get("n") != "decompile" for r in recs), json.dumps(recs, ensure_ascii=False))
        check("카페 이름 지도가 decompile로 바뀌지 않음", (s.get("cafeMap") or {}).get(CLUB) == NAME, json.dumps(s.get("cafeMap")))

        await inner.click(".like_count_btn")
        await pg.wait_for_timeout(3600)
        recs = list(((await store(pg)).get("likedArticles") or {}).values())
        check("멤버 리스트를 눌러도 기록이 남음", any(r["a"] == ART for r in recs), json.dumps(recs, ensure_ascii=False))

        await inner.click("._button")
        await pg.wait_for_timeout(600)
        recs = list(((await store(pg)).get("likedArticles") or {}).values())
        check("다시 누르면(취소) 기록이 지워짐", not any(r["a"] == ART for r in recs), json.dumps(recs, ensure_ascii=False))

        # 예전 버그로 잘못 저장된 상태에서 시작
        bad = {"cafeMap": {CLUB: "decompile"},
               "likedArticles": {f"{CLUB}|decompile|{ART}": {"c": CLUB, "n": "decompile", "a": ART, "t": 1}}}
        await pg.evaluate("s => localStorage.setItem('__ncl_store', JSON.stringify(s))", bad)
        await pg.goto(f"https://cafe.naver.com/{NAME}")
        await pg.wait_for_timeout(1200)
        s = await store(pg)
        recs = list((s.get("likedArticles") or {}).values())
        check("잘못 저장된 decompile 이름이 정리됨", recs and all(r.get("n") != "decompile" for r in recs), json.dumps(recs, ensure_ascii=False))
        check("카페 이름 지도가 진짜 이름으로 돌아옴", (s.get("cafeMap") or {}).get(CLUB) == NAME, json.dumps(s.get("cafeMap")))
        lst = pg.frame(name="cafe_main")
        marked = await lst.evaluate("[...document.querySelectorAll('.ncl-liked-row, .ncl-heart')].map(e => e.textContent.trim())")
        has = await lst.evaluate(f"!!document.querySelector('a[href=\"/{NAME}/{ART}\"]').closest('.ncl-liked-row, .ncl-heart') || !!document.querySelector('.ncl-heart-dot')")
        check("목록에서 좋아요한 글이 표시됨", has, json.dumps(marked, ensure_ascii=False))

        check("스크립트 오류 없음", not errors, "; ".join(errors[:3]))
        await b.close()
    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")
    sys.exit(1 if False in results else 0)


asyncio.run(main())
