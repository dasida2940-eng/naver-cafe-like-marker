// 표시 방식이 "배경만"이면 하트 모양 선택은 쓸 일이 없으므로 흐리게
function updateStyleSection(mode) {
  document.getElementById("style").classList.toggle("off", mode === "bg");
}

// ---------- 켜기/끄기: 끄면 표시·기록·가져오기·이동이 모두 멈춤 ----------
const enabledBox = document.getElementById("enabled");
function showPower(on) {
  enabledBox.checked = on;
  document.body.classList.toggle("disabled", !on);
  document.getElementById("powerText").textContent = on ? "켜짐" : "꺼짐";
  document.getElementById("powerSub").textContent = on ? "좋아요한 글을 표시하고 기록해요" : "표시·기록이 모두 멈춰 있어요";
}
enabledBox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: enabledBox.checked });
  showPower(enabledBox.checked);
  setTimeout(() => { // ---------- 최근 좋아요한 글로 이동 (지금 탭의 게시판 목록과 주고받음) ----------
const jmsg = document.getElementById("jmsg");
const jbtns = document.getElementById("jbtns");
let jpoll = 0;
let wasJumping = false;
let jmissed = 0;
const askJump = (action, cb) => ask(action, {}, cb, "ncl-jump");

function refreshJump() {
  askJump("status", (res) => {
    clearTimeout(jpoll);
    // 페이지가 새로 로드되는 중에는 잠깐 대답이 없음
    if (!res && wasJumping && jmissed < 20) {
      jmissed++;
      jmsg.textContent = "다음 페이지를 불러오는 중…";
      jpoll = setTimeout(refreshJump, 500);
      return;
    }
    jmissed = 0;
    wasJumping = !!(res && res.jumping);
    if (!res) {
      jmsg.textContent = "카페 게시판 목록에서 이 창을 열면, 그 게시판에서 가장 최근에 좋아요한 글이 있는 페이지로 이동할 수 있어요.";
      buttons([], jbtns);
      return;
    }
    const s = res.status || {};
    if (res.jumping) {
      jmsg.textContent = `찾는 중… ${s.pages || 0}페이지 확인\n이 창을 닫아도 계속돼요.`;
      buttons([["중지", () => askJump("stop", () => setTimeout(refreshJump, 300))]], jbtns);
      jpoll = setTimeout(refreshJump, 500);
      return;
    }
    const msgs = {
      done: `${s.page}페이지로 이동했어요. 그 글을 표시해 뒀어요.`,
      notfound: "이 게시판에서는 좋아요한 글을 찾지 못했어요.",
      toofar: `${s.pages}페이지까지 찾아봤지만 없었어요.`,
      nolikes: "이 카페에 저장된 좋아요가 없어요.",
      empty: "목록을 찾지 못했어요. 목록이 다 뜬 뒤 다시 눌러 주세요.",
      stopped: "중지했어요.",
      interrupted: "페이지를 넘기지 못해 멈췄어요. 다시 눌러 주세요."
    };
    jmsg.textContent = msgs[s.state] || "이 게시판에서 가장 최근에 좋아요한 글이 있는 페이지로 이동해요. 1페이지부터 차례로 넘기며 찾아요.";
    buttons([["최근 좋아요한 글로 이동", () => askJump("start", () => setTimeout(refreshJump, 200)), true]], jbtns);
  });
}

refresh();
refreshJump(); refreshJump(); }, 300);
});

chrome.storage.local.get(["displayMode", "heartStyle", "likedArticles", "enabled"], (r) => {
  showPower(r.enabled !== false);
  const mode = r.displayMode || "bg";
  const style = r.heartStyle || "text";
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  document.querySelector(`input[name="heartStyle"][value="${style}"]`).checked = true;
  updateStyleSection(mode);
  const n = Object.keys(r.likedArticles || {}).length;
  document.getElementById("count").textContent = `저장된 좋아요 글: ${n}개`;
});

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    chrome.storage.local.set({ displayMode: input.value });
    updateStyleSection(input.value);
  });
});

document.querySelectorAll('input[name="heartStyle"]').forEach((input) => {
  input.addEventListener("change", () => {
    chrome.storage.local.set({ heartStyle: input.value });
  });
});

// ---------- 좋아요한 글 가져오기 (지금 탭의 카페 화면과 주고받음) ----------
function ask(action, extra, cb, type = "ncl-import") {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return cb(null);
    chrome.tabs.sendMessage(tab.id, { type, action, ...extra }, (res) => {
      void chrome.runtime.lastError; // 카페 화면이 아니면 대답이 없음
      cb(res || null);
    });
  });
}

const imsg = document.getElementById("imsg");
const ibtns = document.getElementById("ibtns");
let poll = 0;

function buttons(list, box = ibtns) {
  box.textContent = "";
  list.forEach(([label, fn, primary]) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (primary) b.className = "primary";
    b.addEventListener("click", fn);
    box.appendChild(b);
  });
}

function start(mode) {
  ask("start", { mode }, () => refresh());
}

function updateCount() {
  chrome.storage.local.get(["likedArticles"], (r) => {
    document.getElementById("count").textContent = `저장된 좋아요 글: ${Object.keys(r.likedArticles || {}).length}개`;
  });
}

let wasCrawling = false;
let missed = 0;
function refresh() {
  ask("status", {}, (res) => {
    clearTimeout(poll);
    updateCount();
    // 가져오는 중에 페이지가 새로 로드되면 잠깐 대답이 없음 → 조금 기다렸다가 다시 물어봄
    if (!res && wasCrawling && missed < 20) {
      missed++;
      imsg.textContent = "다음 페이지를 불러오는 중…";
      poll = setTimeout(refresh, 500);
      return;
    }
    missed = 0;
    wasCrawling = !!(res && res.crawling);
    if (!res) {
      imsg.innerHTML = "카페의 <b>나의 활동 → 좋아요한 글</b> 화면에서 이 창을 열면 버튼이 나와요. 그 카페에서 좋아요한 글(확장 설치 전 포함)을 가져와요.";
      buttons([]);
      return;
    }
    const s = res.status || {};
    if (res.crawling) {
      const pg = s.totalPages ? `${s.pages} / ${s.totalPages}페이지` : `${s.pages}페이지`;
      imsg.textContent = `가져오는 중… ${pg} (새로 ${s.added}개)\n이 창을 닫아도 계속돼요. 카페 화면을 벗어나면 멈춰요.\n그 탭을 화면에 띄워 두면 더 빨라요.`;
      buttons([["중지", () => ask("stop", {}, () => setTimeout(refresh, 300))]]);
      poll = setTimeout(refresh, 500);
      return;
    }
    let head = "";
    if (s.state === "done") head = s.added ? `${s.pages}페이지에서 새로 ${s.added}개를 가져왔어요.\n` : `${s.pages}페이지를 확인했어요. 새로 가져올 글이 없어요.\n`;
    else if (s.state === "empty") head = "목록에서 글을 찾지 못했어요. 목록이 다 뜬 뒤에 다시 눌러 주세요.\n";
    else if (s.state === "stopped" || s.state === "interrupted")
      head = `${s.state === "stopped" ? "중지했어요" : "중간에 멈췄어요"}. ${s.pages}페이지에서 새로 ${s.added}개를 가져왔어요.\n다음에 누르면 처음부터 끝까지 다시 읽어요.\n`;
    if (!res.onLikedTab) {
      imsg.textContent = head || "좋아요한 글 화면에서 다시 열어 주세요.";
      buttons([]);
      return;
    }
    if (res.complete) {
      const d = new Date(res.completeAt);
      imsg.textContent = head || `이 카페는 ${d.getMonth() + 1}월 ${d.getDate()}일에 모두 가져왔어요. 새로 생긴 좋아요만 빠르게 확인할 수 있어요.`;
      buttons([["새 좋아요만 확인", () => start("new"), true], ["전부 다시", () => start("full")]]);
    } else {
      imsg.textContent = head || "이 카페에서 좋아요한 글을 모두 가져와 목록에 표시해요. 글이 많으면 시간이 조금 걸려요.";
      buttons([["좋아요한 글 모두 가져오기", () => start("full"), true]]);
    }
  });
}

// ---------- 최근 좋아요한 글로 이동 (지금 탭의 게시판 목록과 주고받음) ----------
const jmsg = document.getElementById("jmsg");
const jbtns = document.getElementById("jbtns");
let jpoll = 0;
let wasJumping = false;
let jmissed = 0;
const askJump = (action, cb) => ask(action, {}, cb, "ncl-jump");

function refreshJump() {
  askJump("status", (res) => {
    clearTimeout(jpoll);
    // 페이지가 새로 로드되는 중에는 잠깐 대답이 없음
    if (!res && wasJumping && jmissed < 20) {
      jmissed++;
      jmsg.textContent = "다음 페이지를 불러오는 중…";
      jpoll = setTimeout(refreshJump, 500);
      return;
    }
    jmissed = 0;
    wasJumping = !!(res && res.jumping);
    if (!res) {
      jmsg.textContent = "카페 게시판 목록에서 이 창을 열면, 그 게시판에서 가장 최근에 좋아요한 글이 있는 페이지로 이동할 수 있어요.";
      buttons([], jbtns);
      return;
    }
    const s = res.status || {};
    if (res.jumping) {
      jmsg.textContent = `찾는 중… ${s.pages || 0}페이지 확인\n이 창을 닫아도 계속돼요.`;
      buttons([["중지", () => askJump("stop", () => setTimeout(refreshJump, 300))]], jbtns);
      jpoll = setTimeout(refreshJump, 500);
      return;
    }
    const msgs = {
      done: `${s.page}페이지로 이동했어요. 그 글을 표시해 뒀어요.`,
      notfound: "이 게시판에서는 좋아요한 글을 찾지 못했어요.",
      toofar: `${s.pages}페이지까지 찾아봤지만 없었어요.`,
      nolikes: "이 카페에 저장된 좋아요가 없어요.",
      empty: "목록을 찾지 못했어요. 목록이 다 뜬 뒤 다시 눌러 주세요.",
      stopped: "중지했어요.",
      interrupted: "페이지를 넘기지 못해 멈췄어요. 다시 눌러 주세요."
    };
    jmsg.textContent = msgs[s.state] || "이 게시판에서 가장 최근에 좋아요한 글이 있는 페이지로 이동해요. 1페이지부터 차례로 넘기며 찾아요.";
    buttons([["최근 좋아요한 글로 이동", () => askJump("start", () => setTimeout(refreshJump, 200)), true]], jbtns);
  });
}

refresh();
refreshJump();
