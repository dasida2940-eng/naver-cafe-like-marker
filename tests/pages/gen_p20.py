# 실제 네이버 CSS(사용자 저장본, 공개 저장소에 올리지 않음)로 전체글보기 목록을 그대로 그림
import pathlib
here = pathlib.Path(__file__).parent
css = (here / "naver_css/1080_cafe.css").read_text(encoding="utf-8", errors="replace") + (here / "naver_css/1080_skin_grey.css").read_text(encoding="utf-8", errors="replace")
# 아이콘 그림(svg 스프라이트)은 네트워크로 못 받으므로 테스트에서만 색으로 표시
css += "\n.skin-1080 .list-i-new{background:#ff5a3c !important;border-radius:6px}\n.skin-1080 .list-i-img,.skin-1080 [class*='list-i-']{background-color:#aaa}"
def row(aid, title, cmt="3", new=True, liked=True, extra=""):
    nw = '<span class="list-i-new"><i class="blind">new</i></span>' if new else ""
    c = f'''<a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}&amp;referrerAllArticles=true&amp;commentFocus=true" class="cmt">
                                            [<em>{cmt}</em>]
                                        </a>''' if cmt else ""
    return f'''<tr{' data-expect="1"' if liked else ''}>
				<td class="td_article">
					<div class="board-tag type_dot"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="3" height="3" alt="" class="tcol-c"></div>
					<div class="board-list">
						<div class="inner_list">
							<a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}&amp;referrerAllArticles=true" class="article" title="t">
							<span class="inner">
								{title}
							</span>
							</a>
							<div class="article_append">
										{c}
										{extra}{nw}
							</div>
						</div>
					</div>
				</td>
					<td class="td_name" data-col><div class="pers_nick_area"><table role="presentation" cellspacing="0"><tbody><tr><td class="p-nick"><a href="#" class="m-tcol-c"><div class="ellipsis m-tcol-c">여긴어디인가</div></a></td></tr></tbody></table></div></td>
					<td class="td_date" data-col>13:00</td>
					<td class="td_view" data-col>6</td>
			</tr>'''
rows = [
  row(3828, "[스타레일] 캐릭터PV - 에" + "1" * 110 + "이언즈☆아하"),
  row(3827, "1" * 155),
  row(3826, "[스타레일] 캐릭터PV - 에이언즈☆아하"),
  row(3825, "[소식] '니케' 해킹 사태에 넥슨 전사 보안 공지…\"런처 즉시 삭제\"", cmt="2", new=False),
  row(3824, "짧은 글", cmt="", new=True),
  row(3823, "가" * 45, cmt="128"),
  row(3822, "가" * 45, cmt="", new=False),
  row(3821, "[스타레일] 캐릭터PV - 에" + "1" * 110 + "이언즈☆아하", liked=False),
]
liked = ",".join(f"c31580371:{a}" for a in (3828, 3827, 3826, 3825, 3824, 3823, 3822))
html = f'''<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body data-liked="{liked}" data-url="/ArticleList.nhn?search.clubid=31580371"><div id="content-area"><div id="main-area" class="skin-1080">
<div class="article-board m-tcol-c"><table class="board-box"><colgroup><col><col style="width:118px"><col style="width:80px"><col style="width:68px"></colgroup><tbody>
{"".join(rows)}
</tbody></table></div></div></div></body></html>'''
(here / "p20_real_allarticles.html").write_text(html)
