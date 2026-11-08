"""좋아요한 글 자동 가져오기 테스트: python3 tests/liked_import.py extension

네이버 카페 "나의 활동 → 좋아요한 글" 화면을 세 가지 형태로 흉내 내서 검사
  A. 한 화면 안에서 탭·페이지가 바뀌는 형태 (3쪽, "다음" 버튼이 있는 11쪽)
  B. 페이지 번호가 링크라서 페이지가 새로 로드되는 형태
  C. 선택된 탭이 글자 색으로만 표시되는 형태
"""
import asyncio, json, pathlib, sys, re, urllib.parse
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


# 새로 로드돼도 기록이 남도록 localStorage에 저장하는 가짜 chrome.storage
STUB = """
(() => {
  const K = '__ncl_store';
  const load = () => { try { return JSON.parse(localStorage.getItem(K) || '{}'); } catch (e) { return {}; } };
  const ls = [];
  window.__ls = ls;
  window.chrome = { storage: {
    local: {
      get(k, cb) { const d = load(); const r = {}; (Array.isArray(k) ? k : [k]).forEach(x => { if (x in d) r[x] = d[x]; }); setTimeout(() => cb(JSON.parse(JSON.stringify(r)))); },
      set(o, cb) { const d = load(); const ch = {}; for (const k in o) ch[k] = { oldValue: d[k], newValue: o[k] }; Object.assign(d, o); localStorage.setItem(K, JSON.stringify(d)); ls.forEach(f => f(ch, 'local')); cb && cb(); }
    },
    onChanged: { addListener(f) { ls.push(f); } }
  } };
})();
"""

SIDE = """<aside class="side"><h4>인기글</h4><ul>
<li><a href="https://cafe.naver.com/f-e/cafes/111/articles/9001">인기글 하나</a></li>
<li><a href="https://cafe.naver.com/f-e/cafes/111/articles/9002">인기글 둘</a></li></ul></aside>"""

CSS = """body{font:13px sans-serif;margin:0;padding:16px} .layout{display:flex;gap:20px} .side{width:180px} main{flex:1}
.tabs{display:flex;gap:4px;list-style:none;padding:0;border-bottom:1px solid #ddd} .tabs li a,.tabs button{display:block;padding:8px 12px;color:#666;text-decoration:none;border:0;background:none;font:inherit}
.tabs li.on a{color:#03c75a;font-weight:bold;border-bottom:2px solid #03c75a}
#list{list-style:none;padding:0} #list li{padding:6px 0;border-bottom:1px solid #eee}
.pagination{display:flex;gap:6px;margin-top:10px} .pagination a,.pagination button,.pagination strong{padding:2px 6px}"""

# A: 한 화면 안에서 바뀌는 형태
def page_a(total, per):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="layout">{SIDE}
<main><div class="profile">갈대잎 님의 활동</div>
<ul class="tabs"><li class="on"><a href="#" data-tab="write">작성글</a></li><li><a href="#" data-tab="comment">작성댓글</a></li>
<li><a href="#" data-tab="commented">댓글단 글</a></li><li><a href="#" data-tab="like">좋아요한 글</a></li></ul>
<ul id="list"></ul><div class="pagination" id="pager"></div></main></div>
<script>
const TOTAL = {total}, PER = {per};
let tab = 'write', page = 1;
function ids() {{ return tab === 'like' ? Array.from({{length: TOTAL}}, (_, i) => 1000 + i) : [8001, 8002, 8003]; }}
function render() {{
  const all = ids(), pages = Math.ceil(all.length / PER);
  document.getElementById('list').innerHTML = all.slice((page - 1) * PER, page * PER).map(id =>
    `<li><a class="article" href="https://cafe.naver.com/f-e/cafes/111/articles/${{id}}">글 ${{id}} 제목</a> <a class="cmt" href="https://cafe.naver.com/f-e/cafes/111/articles/${{id}}?commentFocus=true">[1]</a></li>`).join('');
  const group = Math.floor((page - 1) / 10) * 10;
  let html = group > 0 ? '<button class="btn_prev">이전</button>' : '';
  for (let p = group + 1; p <= Math.min(group + 10, pages); p++) html += p === page ? `<strong class="on">${{p}}</strong>` : `<button>${{p}}</button>`;
  if (group + 10 < pages) html += '<button class="btn_next" aria-label="다음 페이지">다음</button>';
  document.getElementById('pager').innerHTML = pages > 1 ? html : '';
}}
document.querySelector('.tabs').addEventListener('click', e => {{ const a = e.target.closest('a'); if (!a) return; e.preventDefault();
  document.querySelectorAll('.tabs li').forEach(li => li.classList.toggle('on', li.contains(a))); tab = a.dataset.tab; page = 1; render(); }});
document.getElementById('pager').addEventListener('click', e => {{ const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('btn_next')) page = Math.floor((page - 1) / 10) * 10 + 11; else if (b.classList.contains('btn_prev')) page = Math.floor((page - 1) / 10) * 10 - 9; else page = +b.textContent;
  setTimeout(render, 150); }});
render();
</script></body></html>"""


# B: 페이지가 새로 로드되는 형태 (서버가 page 값에 맞춰 그려 줌)
def page_b(url, total=25, per=10):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    page = int(q.get("page", ["1"])[0])
    pages = (total + per - 1) // per
    items = "".join(f'<li><a href="/MyCafeLikeArticles.nhn?clubid=222&articleid={2000+i}">글 {2000+i}</a></li>' for i in range((page-1)*per, min(page*per, total)))
    pager = "".join(f"<strong>{p}</strong>" if p == page else f'<a href="?tab=like&page={p}">{p}</a>' for p in range(1, pages+1))
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div class="layout">{SIDE}
<main><ul class="tabs" role="tablist"><li role="tab" aria-selected="false"><a href="?tab=write">작성글</a></li><li role="tab" aria-selected="false"><a href="?tab=comment">댓글단 글</a></li>
<li role="tab" aria-selected="true"><a href="?tab=like">좋아요한 글</a></li></ul>
<ul id="list">{items}</ul><div class="pagination">{pager}</div></main></div></body></html>"""


# C: 선택 표시가 글자 색으로만
PAGE_C = f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}
.tabs button{{color:#888}} .tabs button.x{{color:#222;font-weight:bold}}</style></head><body><div class="layout">{SIDE}
<main><div class="tabs"><button>작성글</button><button>작성댓글</button><button>댓글단 글</button><button class="x">좋아요한 글</button></div>
<ul id="list">{''.join(f'<li><a href="https://cafe.naver.com/f-e/cafes/333/articles/{3000+i}">글 {3000+i}</a></li>' for i in range(4))}</ul></main></div></body></html>"""


async def open_page(p, html_fn, path):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={"width": 1100, "height": 800})
    pg = await ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))

    async def handle(route):
        await route.fulfill(body=html_fn(route.request.url), content_type="text/html; charset=utf-8")
    await pg.route("https://cafe.naver.com/**", handle)
    await pg.add_init_script(STUB)
    css = (EXT / "style.css").read_text()
    js = (EXT / "content.js").read_text()
    # 확장처럼 매번 로드될 때 스타일·스크립트를 넣음
    await pg.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = " + json.dumps(css) + "; document.head.appendChild(s); });")
    await pg.add_init_script(js)
    await pg.goto("https://cafe.naver.com" + path)
    return b, pg, errors


stored = lambda pg: pg.evaluate("Object.values(JSON.parse(localStorage.getItem('__ncl_store')||'{}').likedArticles||{}).map(r => r.a).sort()")


async def wait_toast(pg, text, ms=30000):
    try:
        await pg.wait_for_function("t => { const e = document.getElementById('ncl-toast'); return e && e.textContent.includes(t); }", arg=text, timeout=ms)
        return await pg.inner_text("#ncl-toast")
    except Exception:
        return await pg.evaluate("(document.getElementById('ncl-toast')||{}).textContent || ''")


async def main():
    async with async_playwright() as p:
        # ---- A-1: 3쪽
        b, pg, errors = await open_page(p, lambda u: page_a(35, 12), "/f-e/cafes/111/members/abc")
        await pg.wait_for_timeout(1500)
        check("A: 작성글 탭에서는 아무것도 안 가져옴", await stored(pg) == [], str(await stored(pg)))
        await pg.click("text=좋아요한 글")
        msg = await wait_toast(pg, "가져왔어요")
        got = await stored(pg)
        check("A: 좋아요한 글 35개 모두 가져옴 (3쪽)", got == sorted(str(1000 + i) for i in range(35)), f"{len(got)}개")
        check("A: 인기글·작성글은 안 가져옴", not any(x in got for x in ["9001", "9002", "8001"]))
        check("A: 완료 알림", "35개 중 새로 35개" in msg, msg)
        dots = await pg.evaluate("document.querySelectorAll('#list .ncl-heart-dot, #list .ncl-liked-row').length")
        check("A: 가져온 뒤 목록에 표시", dots > 0)
        # 같은 날 다시: 끝까지 다시 읽지 않음
        await pg.reload()
        await pg.wait_for_timeout(800)
        await pg.click("text=좋아요한 글")
        await pg.wait_for_timeout(2500)
        t = await pg.evaluate("(document.getElementById('ncl-toast')||{}).textContent || ''")
        check("A: 같은 날 다시 열면 다시 읽지 않음", t == "", t)
        check("A: 오류 없음", not errors, "; ".join(errors[:2]))
        await b.close()

        # ---- A-2: "다음" 버튼이 있는 11쪽
        b, pg, errors = await open_page(p, lambda u: page_a(55, 5), "/f-e/cafes/111/members/abc")
        await pg.wait_for_timeout(800)
        await pg.click("text=좋아요한 글")
        msg = await wait_toast(pg, "가져왔어요", 60000)
        got = await stored(pg)
        check("A2: 11쪽, '다음' 버튼 넘어 55개 모두", len(got) == 55, f"{len(got)}개 / {msg}")
        check("A2: 오류 없음", not errors, "; ".join(errors[:2]))
        await b.close()

        # ---- B: 새로 로드되는 형태
        b, pg, errors = await open_page(p, page_b, "/MyCafeMyActivity.nhn?clubid=222&tab=like")
        msg = await wait_toast(pg, "가져왔어요", 40000)
        got = await stored(pg)
        check("B: 새로 로드되며 3쪽 25개 모두", got == sorted(str(2000 + i) for i in range(25)), f"{len(got)}개 / {msg}")
        check("B: 인기글 안 가져옴", "9001" not in got)
        check("B: 오류 없음", not errors, "; ".join(errors[:2]))
        await b.close()

        # ---- C: 글자 색으로만 선택 표시
        b, pg, errors = await open_page(p, lambda u: PAGE_C, "/f-e/cafes/333/members/abc")
        msg = await wait_toast(pg, "가져왔어요", 15000)
        got = await stored(pg)
        check("C: 색으로만 표시된 탭도 인식, 4개", got == ["3000", "3001", "3002", "3003"], f"{got} / {msg}")
        await b.close()

        # ---- D: 선택 안 된 좋아요한 글 탭(다른 탭이 색으로 선택)
        page_d = PAGE_C.replace('<button>작성글</button>', '<button class="x">작성글</button>').replace('<button class="x">좋아요한 글</button>', '<button>좋아요한 글</button>')
        b, pg, errors = await open_page(p, lambda u: page_d, "/f-e/cafes/333/members/abc")
        await pg.wait_for_timeout(2500)
        check("D: 좋아요한 글 탭이 선택 안 됐으면 안 가져옴", await stored(pg) == [], str(await stored(pg)))
        await b.close()

    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")

asyncio.run(main())
