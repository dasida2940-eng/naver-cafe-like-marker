import asyncio, pathlib
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1000, "height": 900}, device_scale_factor=1)
        await pg.goto((pathlib.Path(__file__).parent / "guide_jump.html").resolve().as_uri())
        await pg.wait_for_timeout(800)
        await pg.locator("#guide").screenshot(path=str(pathlib.Path(__file__).parent.parent / "store-assets/guide-jump.png"))
        await b.close()
asyncio.run(main())
