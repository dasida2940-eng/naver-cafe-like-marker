// 표시 방식이 "배경만"이면 하트 모양 선택은 쓸 일이 없으므로 흐리게
function updateStyleSection(mode) {
  document.getElementById("style").classList.toggle("off", mode === "bg");
}

chrome.storage.local.get(["displayMode", "heartStyle", "likedArticles"], (r) => {
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
