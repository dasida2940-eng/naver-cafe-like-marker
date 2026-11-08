// 좋아요 기록 백업(내보내기) / 가져오기(합치기)
// 저장 형식은 content.js 와 같음:
//   likedArticles: { "카페번호|카페이름|글번호": { c, n, a, t } }
//   cafeMap:       { 카페번호: 카페이름 }
// 예전 형식 { "카페번호:글번호": 시각, "?:글번호": 시각 } 도 읽음

const APP = "naver-cafe-like-marker";
const KEYS = ["likedArticles", "cafeMap", "displayMode", "heartStyle"];
const $ = (id) => document.getElementById(id);

function recKey(rec) {
  return `${rec.c || ""}|${rec.n || ""}|${rec.a}`;
}

// 어떤 형식이든 { 키: {c, n, a, t} } 로 정리
function normalize(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([k, v]) => {
    let rec;
    if (v && typeof v === "object") {
      if (v.a == null) return;
      rec = { c: v.c != null ? String(v.c) : null, n: v.n || null, a: String(v.a), t: Number(v.t) || Date.now() };
    } else {
      const [c, a] = String(k).split(":");
      if (!a) return;
      rec = { c: c === "?" || !c ? null : c, n: null, a, t: Number(v) || Date.now() };
    }
    out[recKey(rec)] = rec;
  });
  return out;
}

// 카페번호·카페이름 중 한쪽만 알면 cafeMap으로 나머지를 채움
function fill(rec, cafeMap) {
  const r = { ...rec };
  if (r.c && !r.n && cafeMap[r.c]) r.n = cafeMap[r.c];
  if (r.n && !r.c) {
    const c = Object.keys(cafeMap).find((k) => cafeMap[k] === r.n);
    if (c) r.c = c;
  }
  return r;
}

// 같은 글인지 (확장 본체와 같은 기준)
// 카페번호끼리 또는 카페이름끼리 비교하고, 비교할 수 없으면 카페 정보가 아예 없는 기록만 같은 글로 봄
function sameArticle(x, y) {
  if (x.a !== y.a) return false;
  if (x.c && y.c) return x.c === y.c;
  if (x.n && y.n) return x.n === y.n;
  return (!x.c && !x.n) || (!y.c && !y.n);
}

// 가져온 기록을 지금 기록에 합침
function merge(current, incoming, cafeMap = {}) {
  const result = {};
  Object.values(current).forEach((rec) => {
    const r = fill(rec, cafeMap);
    result[recKey(r)] = r;
  });
  let added = 0, enriched = 0, dup = 0;
  Object.values(incoming).forEach((raw) => {
    const rec = fill(raw, cafeMap);
    const key = Object.keys(result).find((k) => sameArticle(result[k], rec));
    if (!key) {
      result[recKey(rec)] = rec;
      added++;
      return;
    }
    const old = result[key];
    // 지금 기록에 빠진 카페 정보가 가져온 기록에 있으면 보충
    const better = { c: old.c || rec.c, n: old.n || rec.n, a: old.a, t: Math.min(old.t || rec.t, rec.t || old.t) };
    if (better.c !== old.c || better.n !== old.n) {
      delete result[key];
      result[recKey(better)] = better;
      enriched++;
    } else {
      dup++;
    }
  });
  return { result, added, enriched, dup };
}

// 백업 파일 / 저장소 통째 / 기록만 있는 객체, 무엇이든 받아들임
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("파일 내용을 읽을 수 없어요. 이 확장에서 저장한 기록 파일(.json)인지 확인해 주세요.");
  }
  if (!data || typeof data !== "object") throw new Error("기록 파일 형식이 아니에요.");
  let liked, cafeMap = {}, settings = {};
  if (data.likedArticles && typeof data.likedArticles === "object") {
    liked = data.likedArticles;
    cafeMap = data.cafeMap || {};
    settings = data.settings || { displayMode: data.displayMode, heartStyle: data.heartStyle };
  } else {
    // 기록만 들어 있는 객체
    const vals = Object.values(data);
    const looksLiked = vals.length && vals.every((v) => typeof v === "number" || (v && typeof v === "object" && "a" in v));
    if (!looksLiked) throw new Error("좋아요 기록을 찾지 못했어요.");
    liked = data;
  }
  const records = normalize(liked);
  if (!Object.keys(records).length) throw new Error("파일에 좋아요 기록이 없어요.");
  return { records, cafeMap, settings };
}

function showMsg(text, ok) {
  const m = $("msg");
  m.textContent = text;
  m.className = "msg " + (ok ? "ok" : "err");
}

function refreshCount() {
  chrome.storage.local.get(["likedArticles"], (r) => {
    const n = Object.keys(normalize(r.likedArticles)).length;
    $("count").textContent = `저장된 좋아요 글: ${n}개`;
  });
}

// ---------- 내보내기 ----------
$("export").addEventListener("click", () => {
  chrome.storage.local.get(KEYS, (r) => {
    const data = {
      app: APP,
      format: 1,
      version: chrome.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      likedArticles: normalize(r.likedArticles),
      cafeMap: r.cafeMap || {},
      settings: { displayMode: r.displayMode || "bg", heartStyle: r.heartStyle || "text" }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `네이버카페-좋아요-기록-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
});

// ---------- 가져오기 ----------
function importText(text) {
  let parsed;
  try {
    parsed = parseBackup(text);
  } catch (e) {
    showMsg(e.message, false);
    return;
  }
  chrome.storage.local.get(KEYS, (r) => {
    const cafeMap = { ...parsed.cafeMap, ...(r.cafeMap || {}) }; // 지금 알고 있는 정보 우선
    const { result, added, enriched, dup } = merge(normalize(r.likedArticles), parsed.records, cafeMap);
    const update = { likedArticles: result, cafeMap };
    if ($("withSettings").checked) {
      const s = parsed.settings || {};
      if (["bg", "bg_heart", "heart"].includes(s.displayMode)) update.displayMode = s.displayMode;
      if (["text", "icon"].includes(s.heartStyle)) update.heartStyle = s.heartStyle;
    }
    chrome.storage.local.set(update, () => {
      const total = Object.keys(result).length;
      showMsg(
        `가져오기 완료\n새로 추가 ${added}개 · 카페 정보 보충 ${enriched}개 · 이미 있던 글 ${dup}개\n지금 저장된 좋아요 글: 모두 ${total}개` +
          (update.displayMode || update.heartStyle ? "\n표시 설정도 가져왔어요." : ""),
        true
      );
      refreshCount();
    });
  });
}

$("file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => importText(String(reader.result));
  reader.onerror = () => showMsg("파일을 읽지 못했어요.", false);
  reader.readAsText(f);
  e.target.value = ""; // 같은 파일을 다시 골라도 동작하도록
});

$("importPaste").addEventListener("click", () => {
  const t = $("paste").value.trim();
  if (!t) {
    showMsg("붙여 넣은 내용이 없어요.", false);
    return;
  }
  importText(t);
});

refreshCount();
