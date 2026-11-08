"""스토어 업로드용 zip 만들기 (주석만 제거, 코드·이름·줄 구조는 그대로)

usage: python3 tools/build_store_zip.py [출력 zip 경로]

- extension/ 폴더를 복사해서 .js / .css 의 주석을 빼고 zip으로 묶음
- 원본(extension/)은 건드리지 않음
- 변수 이름 바꾸기·압축 같은 난독화는 하지 않음 (Chrome 웹 스토어 정책상 난독화 금지)
"""
import json, pathlib, re, shutil, subprocess, sys, tempfile, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"

# '/' 앞에 이 글자가 오면 나눗셈이 아니라 정규식의 시작
REGEX_PREV_CHARS = set("(,=:[!&|?{};+-*%<>~^")
REGEX_PREV_WORDS = {"return", "typeof", "case", "in", "of", "new", "delete", "void", "throw", "else", "do", "yield", "await"}


def strip_js(src: str) -> str:
    out = []
    i, n = 0, len(src)
    stack = []  # 템플릿 문자열 안 ${ } 의 중괄호 깊이
    prev = ""   # 마지막으로 나온 의미 있는 글자/단어 (정규식 판별용)

    def last_word():
        m = re.search(r"([A-Za-z_$][\w$]*)\s*$", "".join(out[-40:]))
        return m.group(1) if m else ""

    def read_template(i):
        # ` 부터 끝 ` 또는 ${ 까지
        j = i
        while j < n:
            c = src[j]
            if c == "\\":
                j += 2
                continue
            if c == "`":
                return j + 1, False
            if c == "$" and j + 1 < n and src[j + 1] == "{":
                return j + 2, True
            j += 1
        raise ValueError("닫히지 않은 템플릿 문자열")

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        # 주석 (주석만 있던 줄은 줄째로 지움)
        if c == "/" and nxt in "/*":
            if nxt == "/":
                j = src.find("\n", i)
                end = n if j < 0 else j
            else:
                j = src.find("*/", i + 2)
                if j < 0:
                    raise ValueError("닫히지 않은 주석")
                end = j + 2
            line_start = "".join(out).rsplit("\n", 1)[-1]
            rest = src[end:src.find("\n", end) if src.find("\n", end) >= 0 else n]
            if not line_start.strip() and not rest.strip():
                # 줄 앞의 들여쓰기와 줄 끝 줄바꿈까지 제거
                while out and out[-1] in " \t":
                    out.pop()
                nl = src.find("\n", end)
                i = n if nl < 0 else nl + 1
            else:
                i = end
                if nxt == "*" and "\n" in src[i - (end - i):end]:
                    out.append("\n")
            continue
        # 문자열
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == "\\":
                    j += 1
                if src[j] == "\n":
                    raise ValueError("줄바꿈이 있는 문자열")
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            prev = "a"
            continue
        # 템플릿 문자열
        if c == "`":
            j, opened = read_template(i + 1)
            out.append(src[i:j])
            i = j
            if opened:
                stack.append(0)
            prev = "a"
            continue
        if stack:
            if c == "{":
                stack[-1] += 1
            elif c == "}":
                if stack[-1] == 0:
                    stack.pop()
                    j, opened = read_template(i + 1)
                    out.append(src[i:j])
                    i = j
                    if opened:
                        stack.append(0)
                    prev = "a"
                    continue
                stack[-1] -= 1
        # 정규식
        if c == "/" and (prev == "" or prev in REGEX_PREV_CHARS or last_word() in REGEX_PREV_WORDS):
            j = i + 1
            in_class = False
            while j < n:
                d = src[j]
                if d == "\\":
                    j += 2
                    continue
                if d == "[":
                    in_class = True
                elif d == "]":
                    in_class = False
                elif d == "/" and not in_class:
                    break
                elif d == "\n":
                    raise ValueError("정규식 판별 실패")
                j += 1
            j += 1
            while j < n and (src[j].isalpha()):
                j += 1
            out.append(src[i:j])
            i = j
            prev = "a"
            continue
        out.append(c)
        if not c.isspace():
            prev = c if not (c.isalnum() or c in "_$") else "a"
        i += 1

    # 주석만 있던 줄·빈 줄 정리, 줄 끝 공백 제거
    lines = [ln.rstrip() for ln in "".join(out).split("\n")]
    cleaned, blank = [], False
    for ln in lines:
        if not ln.strip():
            if not blank and cleaned:
                cleaned.append("")
            blank = True
            continue
        cleaned.append(ln)
        blank = False
    return "\n".join(cleaned).strip() + "\n"


def strip_css(src: str) -> str:
    out = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    lines = [ln.rstrip() for ln in out.split("\n")]
    res, blank = [], False
    for ln in lines:
        if not ln.strip():
            if not blank and res:
                res.append("")
            blank = True
            continue
        res.append(ln)
        blank = False
    return "\n".join(res).strip() + "\n"


def build(dest_dir: pathlib.Path):
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
    shutil.copytree(SRC, dest_dir)
    for f in dest_dir.rglob("*.js"):
        out = strip_js(f.read_text(encoding="utf-8"))
        f.write_text(out, encoding="utf-8")
        # 문법 검사
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(f"{f.name}: 주석 제거 후 문법 오류\n{r.stderr}")
    for f in dest_dir.rglob("*.css"):
        f.write_text(strip_css(f.read_text(encoding="utf-8")), encoding="utf-8")
    return dest_dir


def main():
    version = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))["version"]
    out_zip = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / f"naver-cafe-like-marker-store-v{version}.zip"
    tmp = pathlib.Path(tempfile.mkdtemp()) / "extension"
    build(tmp)
    if out_zip.exists():
        out_zip.unlink()
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(tmp.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(tmp).as_posix())
    before = sum(f.stat().st_size for f in SRC.rglob("*") if f.is_file())
    after = sum(f.stat().st_size for f in tmp.rglob("*") if f.is_file())
    print(f"{out_zip}  (v{version}, 파일 합계 {before:,} → {after:,} bytes)")
    print(f"주석 제거본 폴더: {tmp}")


if __name__ == "__main__":
    main()
