chrome.storage.local.get(["displayMode", "likedArticles"], (r) => {
  const mode = r.displayMode || "bg";
  document.querySelector(`input[value="${mode}"]`).checked = true;
  const n = Object.keys(r.likedArticles || {}).length;
  document.getElementById("count").textContent = `저장된 좋아요 글: ${n}개`;
});

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    chrome.storage.local.set({ displayMode: input.value });
  });
});
