# 네이버 카페 좋아요 표시 (Chrome 확장)

<img src="extension/icons/icon128.png" width="64" align="right">

좋아요를 누른 네이버 카페 게시글을 게시판 목록에서 **분홍 배경**이나 **♥ 하트**로 표시해 주는 Chrome 확장 프로그램입니다.

![목록에서 좋아요한 글 표시](store-assets/screenshot-1_1280x800.png)

## 기능
- 게시글에서 좋아요 버튼을 **누를 때** 저장하고, 취소하면 지웁니다. 글을 열기만 해서는 저장하지 않습니다.
- 게시판 목록에서 저장된 글을 표시합니다.
- 툴바 아이콘을 눌러 표시 방식을 **배경만 / 배경 + 하트 / 하트만** 중에서 고를 수 있습니다. 고르는 즉시 열린 화면에 적용됩니다.
- 하트 모양도 **♥ 좋아요 / 아이콘만(♥)** 중에서 고를 수 있습니다. 하트는 줄 오른쪽 끝에 표시되며, 긴 제목은 하트 앞에서 줄바꿈되어 가려지지 않습니다.
- 하트는 제목 옆에서 글자·아이콘·사진·다른 칸과 겹치지 않는 자리를 찾아 붙습니다. 목록형, 테이블형, 칸이 나뉜 목록, 썸네일 목록, 앨범형(카드) 모두 지원합니다.
- 글 본문 속 링크에는 표시하지 않습니다. 배경은 반투명이라 어두운 화면에서도 글자가 잘 보입니다.
- 모든 기록은 내 브라우저에만 저장되며, 외부로 전송되지 않습니다. ([개인정보처리방침](docs/privacy.md))

## 설치

### Chrome 웹 스토어
심사가 끝나면 링크를 추가할 예정입니다.

### 직접 설치 (개발자 모드)
1. 이 저장소를 내려받습니다. (`Code` → `Download ZIP` 후 압축 해제)
2. Chrome에서 `chrome://extensions` 를 엽니다.
3. 오른쪽 위 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `extension` 폴더를 선택합니다.

## 알아 두기
- 확장을 설치하기 전에 좋아요한 글은 좋아요를 한 번 취소했다가 다시 누르면 저장됩니다.
- 글은 카페 번호(clubid) + 카페 이름(주소의 영문 이름) + 글 번호(articleid)로 구분합니다. `cafe.naver.com/카페이름/123` 같은 짧은 주소도 카페 이름으로 구분하므로, 다른 카페의 같은 번호 글과 섞이지 않습니다.

## 표시가 안 될 때
네이버가 화면 구조를 바꾸면 `extension/content.js` 상단의 선택자를 고치면 됩니다.
- `LIKE_BTN_SELECTOR` : 좋아요 버튼
- `ARTICLE_LINK_SELECTOR` : 목록의 글 제목 링크

F12 → 요소 선택으로 버튼과 링크의 class를 확인해 추가하세요.

## 폴더 구조
```
extension/      확장 프로그램 본체 (스토어에 올릴 때 이 폴더 안의 파일을 zip으로 묶음)
tests/          자동 테스트 (화면 구조 13종 × 환경 5종 × 설정 5종, 동작 시나리오)
store-assets/   Chrome 웹 스토어용 스크린샷·프로모션 이미지
docs/           개인정보처리방침 (GitHub Pages)
tools/          아이콘·스토어 이미지 생성 스크립트
```

### 스토어 업로드용 zip 만들기
```bash
cd extension && zip -r ../naver-cafe-like-marker.zip . && cd ..
```

### 스토어 이미지 다시 만들기
Python Playwright가 필요합니다.
```bash
cd tools
python3 render_icons.py   # extension/icons/ 아이콘 생성
python3 shoot.py          # store-assets/ 스크린샷·프로모션 이미지 생성
```

## 테스트
Python Playwright가 필요합니다.
```bash
python3 tests/harness.py extension     # 화면 구조 × 환경 × 설정 330개 조합 (겹침·잘림·칸 밀림·사진 크기 등)
python3 tests/scenarios.py extension   # 좋아요/취소, 설정 변경, 페이지 이동, 성능
```
`tests/out/` 에 실패한 조합의 스크린샷이 저장됩니다 (`--shots` 를 붙이면 전부 저장).
