const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function toast(message, type = "info") {
  const target = $("#status") || $("#participantStatus") || $("#adminStatus");
  if (!target) return;
  target.textContent = message;
  target.style.color = type === "error" ? "#dc2626" : "";
}

function icon(name) {
  const icons = {
    user: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
    shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
    skip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 19 7-7-7-7M19 5v14"/></svg>'
  };
  return icons[name] || "";
}

function renderLeaderboard(items, target) {
  if (!target) return;
  if (!items || items.length === 0) {
    target.innerHTML = '<div class="notice">No active participants in this session.</div>';
    return;
  }
  target.innerHTML = items
    .map((item, index) => `
      <div class="leader-row">
        <div class="avatar" style="background:${item.avatar.gradient}">${item.avatar.initials}</div>
        <div>
          <strong>${index + 1}. ${escapeHtml(item.name)}</strong>
          <div class="muted">Active now</div>
        </div>
        <div class="score">${item.score}</div>
      </div>
    `)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
