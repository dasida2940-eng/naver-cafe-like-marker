"""동작 시나리오 테스트: python3 scenarios.py <extension_dir>"""
import asyncio, json, sys, pathlib
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
STUB = pathlib.Path(__file__).parent.joinpath("harness.py").read_text().split('STUB = """')[1].split('"""')[0]

LIST = """<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px sans-serif;margin:0;padding:16px} ul{list-style:none;padding:0;max-width:700px} li{display:flex;padding:8px 0;border-bottom:1px solid #eee}
.t{flex:1;min-width:0;word-break:break-all} .n{width:100px} .d{width:90px}
</style></head><body><ul id="list"></ul>
<div class="like_article"><a class="u_likeit_list_btn" href="#" id="likebtn">좋아요</a></div>
<script>
window.renderPage = (start, n) => {
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const id = start + i;
    ul.insertAdjacentHTML('beforeend', `<li><div class="t"><a href="/testcafe/${id}">글 ${id} 제목입니다</a> <span>[${id % 7}]</span></div><div class="n">작성자${id % 5}</div><div class="d">11.0${id % 9}.</div></li>`);
  }
};
// 줄 요소는 그대로 두고 링크 주소·글자만 바꾸는 페이지 이동 (React 등이 흔히 하는 방식)
window.reusePage = (start) => {
  document.querySelectorAll('#list li').forEach((li, i) => {
    const a = li.querySelector('a'); const id = start + i;
    a.setAttribute('href', `/testcafe/${id}`); a.textContent = `글 ${id} 제목입니다`;
  });
};
document.getElementById('likebtn').addEventListener('click', (e) => {
  e.preventDefault();
  setTimeout(() => e.target.classList.toggle('on'), 200); // 서버 응답 뒤에 버튼 모양이 바뀜
});
renderPage(1, 10);
</script></body></html>"""


async def main():
    results = []
    def check(name, ok, detail=""):
        results.append((name, ok, detail))
        print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1024, "height": 800})
        pg = await ctx.new_page()
        await pg.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=LIST, content_type="text/html; charset=utf-8"))
        await pg.add_init_script(STUB.replace("__MODE__", '"bg_heart"').replace("__STYLE__", '"text"'))
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))

        # --- 좋아요 버튼: 글 화면(/testcafe/3)에서 누르면 저장, 다시 누르면 삭제
        await pg.goto("https://cafe.naver.com/testcafe/3")
        await pg.evaluate("__initLiked('5')")
        await pg.add_style_tag(path=str(EXT / "style.css"))
        await pg.add_script_tag(path=str(EXT / "content.js"))
        await pg.wait_for_timeout(300)
        state = lambda: pg.evaluate("Object.values(chrome.storage.local._d.likedArticles).map(r => r.a).sort()")
        dots = lambda: pg.evaluate("[...document.querySelectorAll('.ncl-heart-dot')].map(d => d.closest('li').querySelector('a').getAttribute('href'))")
        bgs = lambda: pg.evaluate("[...document.querySelectorAll('.ncl-liked-row')].map(r => r.querySelector('a').getAttribute('href'))")
        check("처음 표시: 저장된 글(5)만", await dots() == ["/testcafe/5"] and await bgs() == ["/testcafe/5"], str(await dots()))

        await pg.click("#likebtn")
        await pg.wait_for_timeout(600)
        check("좋아요 누르면 저장", await state() == ["3", "5"], str(await state()))
        check("저장 즉시 목록 표시", sorted(await dots()) == ["/testcafe/3", "/testcafe/5"], str(await dots()))
        await pg.click("#likebtn")
        await pg.wait_for_timeout(600)
        check("좋아요 취소하면 삭제", await state() == ["5"], str(await state()))
        check("취소 즉시 표시 사라짐", await dots() == ["/testcafe/5"], str(await dots()))

        # --- 표시 방식/하트 모양 실시간 변경
        await pg.evaluate("chrome.storage.local.set({displayMode: 'bg'})"); await pg.wait_for_timeout(150)
        check("배경만: 하트 없음", await dots() == [] and await bgs() == ["/testcafe/5"])
        await pg.evaluate("chrome.storage.local.set({displayMode: 'heart'})"); await pg.wait_for_timeout(150)
        check("하트만: 배경 없음", await bgs() == [] and await dots() == ["/testcafe/5"])
        await pg.evaluate("chrome.storage.local.set({heartStyle: 'icon'})"); await pg.wait_for_timeout(150)
        txt = await pg.evaluate("[...document.querySelectorAll('.ncl-heart-dot')].map(d => d.textContent)")
        check("하트 모양 → 아이콘", txt == ["♥"], str(txt))
        await pg.evaluate("chrome.storage.local.set({displayMode: 'bg_heart', heartStyle: 'text'})"); await pg.wait_for_timeout(150)
        check("배경+하트 복귀, 중복 없음", await dots() == ["/testcafe/5"] and await bgs() == ["/testcafe/5"])
        leftover = await pg.evaluate("[...document.querySelectorAll('[style*=padding-right]')].length + document.querySelectorAll('.ncl-pos').length")
        check("설정 바꿔도 찌꺼기(여백/기준점) 누적 없음", leftover <= 1, str(leftover))

        # --- 페이지 이동 1: 목록을 통째로 새로 그림
        await pg.evaluate("(() => { const d = {...chrome.storage.local._d.likedArticles}; ['15','18'].forEach(a => d['|testcafe|' + a] = {c:null,n:'testcafe',a,t:1}); chrome.storage.local.set({likedArticles: d}); })()")
        await pg.evaluate("renderPage(11, 10)"); await pg.wait_for_timeout(200)
        check("새 페이지(통째로 다시 그림)", sorted(await dots()) == ["/testcafe/15", "/testcafe/18"], str(await dots()))
        # --- 페이지 이동 2: 줄은 재사용하고 링크만 바뀜
        await pg.evaluate("reusePage(1)"); await pg.wait_for_timeout(200)
        check("새 페이지(줄 재사용, 주소만 변경)", await dots() == ["/testcafe/5"] and await bgs() == ["/testcafe/5"], str(await dots()) + str(await bgs()))

        # --- 아무것도 안 할 때 계속 다시 그리지 않는지 (무한 반복 방지)
        await pg.evaluate("""window.__calls = 0; new MutationObserver(m => window.__calls += m.length).observe(document.body, {subtree: true, childList: true, attributes: true})""")
        await pg.wait_for_timeout(1500)
        calls = await pg.evaluate("window.__calls")
        check("가만히 있을 때 화면 변경 없음", calls == 0, f"{calls}건")

        # --- 창 크기 변경 후에도 겹침 없이 재배치
        await pg.set_viewport_size({"width": 420, "height": 800}); await pg.wait_for_timeout(400)
        ok = await pg.evaluate("""(() => { const d = document.querySelector('.ncl-heart-dot').getBoundingClientRect();
          const r = document.createRange(); const t = document.querySelector('.ncl-heart-dot').closest('li').querySelector('a').firstChild; r.selectNodeContents(t);
          return [...r.getClientRects()].every(x => x.right <= d.left || x.left >= d.right || x.bottom <= d.top || x.top >= d.bottom); })()""")
        check("좁은 창으로 줄여도 제목 안 가림", ok)
        await pg.set_viewport_size({"width": 1024, "height": 800}); await pg.wait_for_timeout(300)

        # --- 성능: 1,000줄 중 300개 좋아요
        await pg.evaluate("""(() => { const d = chrome.storage.local._d.likedArticles; for (let i = 2000; i < 3000; i += 3) d['|testcafe|' + i] = {c:null,n:'testcafe',a:String(i),t:1};
          chrome.storage.local.set({likedArticles: d}); })()""")
        t = await pg.evaluate("""(async () => { const t0 = performance.now(); renderPage(2000, 1000);
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; })()""")
        n = await pg.evaluate("document.querySelectorAll('.ncl-heart-dot').length")
        check("1,000줄/좋아요 334개 표시", n == 334, f"{n}개")
        check("1,000줄 표시 시간 1초 이내", t < 1000, f"{t:.0f}ms")

        check("콘솔 오류 없음", not errors, "; ".join(errors[:3]))
        await b.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results)}개 중 실패 {len(fails)}개")

asyncio.run(main())
