"""기록 백업·가져오기 실제 크롬 테스트: python3 tests/backup_e2e.py extension

크롬 두 개(예전 버전 / 스토어 버전 역할)에 확장을 실제로 설치해서
예전 형식 기록 내보내기 → 다른 쪽에서 가져오기(합치기)를 검사한다.
"""
import asyncio, hashlib, json, pathlib, sys, tempfile, shutil
from playwright.async_api import async_playwright

EXT = pathlib.Path(sys.argv[1]).resolve()
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def ext_id(path):
    # 압축 해제 설치 확장의 ID = 폴더 경로의 SHA-256 앞 32자리를 a~p로 바꾼 것
    h = hashlib.sha256(str(path).encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in h)


async def open_profile(p, ext_dir):
    d = tempfile.mkdtemp()
    ctx = await p.chromium.launch_persistent_context(
        d, headless=False, accept_downloads=True,
        args=["--headless=new", f"--disable-extensions-except={ext_dir}", f"--load-extension={ext_dir}"])
    return ctx, d


async def main():
    # 두 확장이 서로 다른 ID를 갖도록 폴더를 따로 둠 (실제로 직접 설치 버전과 스토어 버전은 ID가 다름)
    tmp = pathlib.Path(tempfile.mkdtemp())
    old_dir, store_dir = tmp / "local-version", tmp / "store-version"
    shutil.copytree(EXT, old_dir)
    shutil.copytree(EXT, store_dir)
    async with async_playwright() as p:
        # ---- 예전(직접 설치) 버전: 예전 형식 + 새 형식이 섞인 기록
        ctx_a, _ = await open_profile(p, old_dir)
        ida = ext_id(old_dir)
        pa = await ctx_a.new_page()
        await pa.goto(f"chrome-extension://{ida}/backup.html")
        await pa.evaluate("""() => new Promise(r => chrome.storage.local.set({
            likedArticles: {
              '31580371:3786': 1700000000000,                 // 예전 형식 (카페번호:글번호)
              '?:999': 1700000001000,                          // 예전 형식 (카페 모름)
              '31580371|mycafe|4001': {c:'31580371', n:'mycafe', a:'4001', t:1700000002000},
              '||5000': {c:null, n:'othercafe', a:'5000', t:1700000003000}
            },
            cafeMap: {'31580371': 'mycafe'}, displayMode: 'heart', heartStyle: 'icon'}, r))""")
        await pa.reload()
        check("예전 버전: 기록 개수 표시", "4개" in await pa.inner_text("#count"), await pa.inner_text("#count"))
        async with pa.expect_download() as dl:
            await pa.click("#export")
        download = await dl.value
        backup_path = tmp / download.suggested_filename
        await download.save_as(backup_path)
        data = json.loads(backup_path.read_text())
        check("내보낸 파일 이름", download.suggested_filename.startswith("네이버카페-좋아요-기록-") and download.suggested_filename.endswith(".json"), download.suggested_filename)
        check("내보낸 파일: 4개, 새 형식으로 정리", len(data["likedArticles"]) == 4 and all(isinstance(v, dict) for v in data["likedArticles"].values()))
        check("내보낸 파일: 설정 포함", data["settings"] == {"displayMode": "heart", "heartStyle": "icon"})
        # 팝업의 버튼으로 백업 페이지가 열리는지 (이미 열린 백업 탭이 있으면 크롬이 그 탭으로 이동하므로 먼저 닫음)
        await pa.close()
        pop = await ctx_a.new_page()
        await pop.goto(f"chrome-extension://{ida}/popup.html")
        async with ctx_a.expect_page() as newp:
            await pop.click("#backup")
        opened = await newp.value
        await opened.wait_for_load_state()
        check("팝업 버튼 → 백업 페이지 열림", opened.url.endswith("/backup.html"), opened.url)
        await ctx_a.close()

        # ---- 스토어 버전: 이미 기록이 조금 있음 (겹치는 글 1개는 카페 정보가 빠진 채)
        ctx_b, _ = await open_profile(p, store_dir)
        idb = ext_id(store_dir)
        check("두 확장의 ID가 다름(실제 상황과 같음)", ida != idb)
        pb = await ctx_b.new_page()
        await pb.goto(f"chrome-extension://{idb}/backup.html")
        await pb.evaluate("""() => new Promise(r => chrome.storage.local.set({
            likedArticles: {
              '|mycafe|3786': {c:null, n:'mycafe', a:'3786', t:1700000500000},   // 같은 글, 카페번호 빠짐
              '777|x|1': {c:'777', n:'x', a:'1', t:1700000600000},               // 스토어 버전에만 있는 글
              '888||4001': {c:'888', n:null, a:'4001', t:1700000700000}         // 다른 카페의 같은 번호 글 (합쳐지면 안 됨)
            }, displayMode: 'bg', heartStyle: 'text'}, r))""")
        await pb.reload()

        # 잘못된 파일
        bad = tmp / "bad.json"
        bad.write_text("이건 json 아님")
        await pb.set_input_files("#file", str(bad))
        await pb.wait_for_selector("#msg.err")
        check("잘못된 파일 → 안내 메시지", "읽을 수 없어요" in await pb.inner_text("#msg"), await pb.inner_text("#msg"))

        # 정상 가져오기 (설정은 가져오지 않음)
        await pb.set_input_files("#file", str(backup_path))
        await pb.wait_for_selector("#msg.ok")
        msg = await pb.inner_text("#msg")
        st = await pb.evaluate("() => new Promise(r => chrome.storage.local.get(null, r))")
        liked = st["likedArticles"]
        check("가져오기 결과 메시지", "새로 추가 3개" in msg and "이미 있던 글 1개" in msg and "모두 6개" in msg, msg.replace("\n", " / "))
        check("기존 기록 유지", any(v["a"] == "1" and v["c"] == "777" for v in liked.values()))
        ent = [v for v in liked.values() if v["a"] == "3786"]
        check("같은 글은 하나로, 카페번호 보충", len(ent) == 1 and ent[0]["c"] == "31580371" and ent[0]["n"] == "mycafe", str(ent))
        check("설정은 그대로(체크 안 함)", st["displayMode"] == "bg" and st["heartStyle"] == "text")
        check("카페 정보 지도 합쳐짐", st.get("cafeMap", {}).get("31580371") == "mycafe")

        # 같은 파일을 한 번 더 → 늘어나지 않음
        await pb.set_input_files("#file", str(backup_path))
        await pb.wait_for_timeout(300)
        n2 = await pb.evaluate("() => new Promise(r => chrome.storage.local.get('likedArticles', x => r(Object.keys(x.likedArticles).length)))")
        check("같은 파일 다시 가져와도 중복 없음", n2 == 6, f"{n2}개")
        same4001 = [v for v in liked.values() if v["a"] == "4001"]
        check("다른 카페의 같은 번호 글은 따로 유지", len(same4001) == 2 and {v["c"] for v in same4001} == {"888", "31580371"}, str(same4001))

        # 설정도 가져오기 + 붙여 넣기
        await pb.check("#withSettings")
        await pb.click("summary")
        await pb.fill("#paste", backup_path.read_text())
        await pb.click("#importPaste")
        await pb.wait_for_timeout(300)
        st = await pb.evaluate("() => new Promise(r => chrome.storage.local.get(null, r))")
        check("붙여 넣기 + 설정 가져오기", st["displayMode"] == "heart" and st["heartStyle"] == "icon")

        # 가져온 기록이 실제 카페 화면에 표시되는지 (콘텐츠 스크립트가 같은 저장소를 읽음)
        page = await ctx_b.new_page()
        html = """<!doctype html><html><body><ul style="list-style:none">
          <li><a href="https://cafe.naver.com/f-e/cafes/31580371/articles/3786">가져온 글 (예전 형식이었음)</a></li>
          <li><a href="https://cafe.naver.com/f-e/cafes/31580371/articles/4001">가져온 글 2</a></li>
          <li><a href="https://cafe.naver.com/f-e/cafes/31580371/articles/4002">좋아요 안 한 글</a></li></ul></body></html>"""
        await page.route("https://cafe.naver.com/**", lambda r: r.fulfill(body=html, content_type="text/html; charset=utf-8"))
        await page.goto("https://cafe.naver.com/f-e/cafes/31580371/menus/1")
        await page.wait_for_timeout(800)
        marked = await page.evaluate("[...document.querySelectorAll('.ncl-heart-dot')].map(d => d.closest('li').textContent.slice(0, 8))")
        check("가져온 기록이 카페 목록에 표시됨", len(marked) == 2, str(marked))
        await ctx_b.close()

    print(f"\n{len(results)}개 중 실패 {results.count(False)}개")

asyncio.run(main())
