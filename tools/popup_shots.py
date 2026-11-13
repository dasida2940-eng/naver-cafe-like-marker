"""스토어 이미지에 넣을 확장 팝업 화면을 실제 popup.html로 그림 (샘플 데이터)
cd tools && python3 popup_shots.py  →  tools/popup_*.png
"""
import asyncio, json, pathlib
from playwright.async_api import async_playwright

EXT = pathlib.Path(__file__).resolve().parent.parent / "extension"
OUT = pathlib.Path(__file__).resolve().parent

STUB = """
const D = { displayMode: 'bg_heart', heartStyle: 'text', enabled: true, likedArticles: {} };
for (let i = 0; i < 128; i++) D.likedArticles['k' + i] = { a: String(i) };
const R = __RESP__;
window.chrome = {
  storage: { local: { get(k, cb) { const r = {}; k.forEach(x => { if (x in D) r[x] = D[x]; }); setTimeout(() => cb(r)); }, set(o) { Object.assign(D, o); } } },
  runtime: { lastError: null },
  tabs: { query(q, cb) { cb([{ id: 1 }]); }, sendMessage(id, m, cb) { setTimeout(() => cb(R[m.type] || null)); } }
};
"""

STATES = {
    # 게시판 목록 화면에서 연 팝업 (기본)
    "popup_board": {"ncl-jump": {"jumping": False, "status": {"state": "idle"}}},
    # 최근 좋아요한 글로 이동을 마친 뒤
    "popup_jumped": {"ncl-jump": {"jumping": False, "status": {"state": "done", "page": 7, "pages": 7}}},
    # 좋아요한 글 화면에서 가져오는 중
    "popup_import": {"ncl-import": {"onLikedTab": True, "crawling": True, "complete": False,
                                     "status": {"state": "running", "pages": 3, "added": 45, "total": 45, "totalPages": 12, "mode": "full"}}},
}


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, resp in STATES.items():
            pg = await (await b.new_context(viewport={"width": 260, "height": 300}, device_scale_factor=2)).new_page()
            await pg.add_init_script(STUB.replace("__RESP__", json.dumps(resp)))
            await pg.goto((EXT / "popup.html").as_uri())
            await pg.wait_for_timeout(500)
            h = await pg.evaluate("Math.ceil(document.body.getBoundingClientRect().bottom + parseFloat(getComputedStyle(document.body).marginBottom))")
            await pg.set_viewport_size({"width": 260, "height": h})
            await pg.screenshot(path=str(OUT / f"{name}.png"))
        await b.close()


asyncio.run(main())
