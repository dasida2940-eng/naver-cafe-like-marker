import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for src, sizes in [("icon.svg",[48,128]),("icon_small.svg",[16,32])]:
            svg=open(src).read()
            for s in sizes:
                pg = await b.new_page(viewport={"width":s,"height":s})
                await pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ",f"<svg width=\"{s}\" height=\"{s}\" ",1)}</body></html>')
                await pg.screenshot(path=f"../extension/icons/icon{s}.png", omit_background=True)
        await b.close()
asyncio.run(main())
