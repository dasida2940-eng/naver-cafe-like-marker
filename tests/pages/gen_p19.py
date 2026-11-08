# p19 (전체글보기) 테스트 화면 생성기: python3 tests/pages/gen_p19.py
import pathlib
ones = "1" * 155
def row(aid, title, liked=True, new=True, append_first=False):
    nw = '<span class="list-i-new"><i class="blind">new</i></span>' if new else ''
    art = f'''<a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}&amp;referrerAllArticles=true" class="article" title="t">
<span class="inner">
{title}
</span>
</a>
'''
    app = f'''<div class="article_append">
<a href="/ArticleRead.nhn?clubid=31580371&amp;articleid={aid}&amp;referrerAllArticles=true&amp;commentFocus=true" class="cmt">
 [<em>3</em>]
</a>
{nw}
</div>
'''
    body = app + art if append_first else art + app
    return f'''<tr{' data-expect="1"' if liked else ''}><td class="td_article"><div class="board-tag type_dot"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="3" height="3" alt="" class="tcol-c"></div><div class="board-list"><div class="inner_list">
{body}</div></div></td><td class="td_name" data-col><div class="pers_nick_area"><table role="presentation"><tbody><tr><td class="p-nick"><a href="#"><div class="ellipsis">여긴어디인가</div></a></td></tr></tbody></table></div></td><td class="td_date" data-col>13:00</td><td class="td_view" data-col>6</td></tr>'''
def rows(append_first=False):
    return "".join([row(3828, ones, append_first=append_first),
                    row(3829, "[스타레일] 캐릭터PV - 에이언즈☆아하", append_first=append_first),
                    row(3830, "가" * 60, append_first=append_first),
                    row(3832, "[스타레일] 캐릭터PV - 에" + "1" * 110 + "이언즈☆아하", append_first=append_first),
                    row(3831, ones, False, append_first=append_first)])
common = '''body{font:13px "Malgun Gothic","Noto Sans CJK KR",sans-serif;margin:0;padding:16px;color:#333} a{color:#333;text-decoration:none} h4{margin:12px 0 4px}
table.L{width:860px;border-collapse:collapse;table-layout:fixed} table.L>tbody>tr>td{border-bottom:1px solid #eee;padding:10px 6px;vertical-align:middle;height:20px}
.td_name{width:130px} .td_date{width:80px} .td_view{width:50px} .pers_nick_area table{border-collapse:collapse} .p-nick{padding:0}
.blind{position:absolute;clip:rect(0 0 0 0);width:1px;height:1px;overflow:hidden}
.board-tag{float:left;width:12px;padding-top:8px} .cmt{color:#f53;margin-left:3px} .cmt em{font-style:normal}
.list-i-new{display:inline-block;width:11px;height:11px;margin-left:3px;background:#f53;border-radius:2px;vertical-align:middle}
'''
variants = {
 "K": ".K .board-list{overflow:hidden} .K .inner_list{overflow:hidden;white-space:nowrap} .K .article_append{display:inline-block}",
 "L2": ".L2 .board-list{overflow:hidden} .L2 .inner_list{overflow:hidden;white-space:nowrap;text-overflow:ellipsis} .L2 .article_append{display:inline}",
 "M": ".M .board-list{overflow:hidden} .M .inner_list{white-space:nowrap;overflow:hidden} .M .article{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:top} .M .article_append{display:inline-block}",
 "N": ".N .board-list{display:table;table-layout:fixed;width:100%} .N .inner_list{display:table-cell;overflow:hidden;white-space:nowrap;text-overflow:ellipsis} .N .article_append{display:inline}",
 "O": ".O .inner_list{word-break:break-all} .O .article_append{display:inline}",
 "P": ".P .inner_list{display:flex;align-items:center} .P .article{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0} .P .article_append{flex:none}",
 # Q: 댓글 수·new를 제목 상자의 오른쪽 여백 칸에 따로 배치 (실제 네이버 캡처와 같은 모양)
 "Q": ".Q .board-list{overflow:hidden} .Q .inner_list{position:relative;padding-right:46px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis} .Q .article_append{position:absolute;right:0;top:0}",
 # R: 댓글 수·new를 오른쪽에 띄움(float)
 "R": ".R .board-list{overflow:hidden} .R .article_append{float:right} .R .inner_list{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}",
 # S: 제목 폭을 고정으로 줄이고 그 뒤에 댓글 수·new
 "S": ".S .board-list{overflow:hidden} .S .inner_list{white-space:nowrap} .S .article{display:inline-block;max-width:calc(100% - 50px);overflow:hidden;text-overflow:ellipsis;vertical-align:top} .S .article_append{display:inline-block}",
}
body = "".join(f'<h4>{k}</h4><table class="L {k}">{rows(k == "R")}</table>' for k in variants)
liked = "c31580371:3828,c31580371:3829,c31580371:3830,c31580371:3832"
html = f'<!doctype html><html><head><meta charset="utf-8"><style>{common}{" ".join(variants.values())}</style></head><body data-liked="{liked}" data-url="/ArticleList.nhn?search.clubid=31580371">{body}</body></html>'
pathlib.Path(__file__).with_name("p19_allarticles.html").write_text(html)
