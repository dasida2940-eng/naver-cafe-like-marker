import asyncio, pathlib
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        pg=await b.new_page(viewport={"width":1500,"height":900})
        await pg.goto("file://"+str(pathlib.Path("store.html").resolve()))
        await pg.wait_for_timeout(1500)
        for id,name in [("shot1","screenshot-1_1280x800.png"),("shot2","screenshot-2_1280x800.png"),("shot3","screenshot-3_1280x800.png"),("shot4","screenshot-4_1280x800.png"),("promo","promo-small_440x280.png"),("marquee","promo-marquee_1400x560.png")]:
            await pg.locator("#"+id).screenshot(path="../store-assets/"+name)
        await b.close()
    # 스토어 이미지는 알파 채널 없는 PNG여야 함
    from PIL import Image
    import glob
    for f in glob.glob('../store-assets/*.png'):
        Image.open(f).convert('RGB').save(f)
asyncio.run(main())
