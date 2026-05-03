let activeCode = "";
let selectedIndex = null;
let revealMode = false;
let tickTimer = null;
let participantId = "";
let events = null;

const codeFromPath = location.pathname.startsWith("/join/") ? location.pathname.split("/").pop() : "";
if (codeFromPath) $("[name=code]").value = codeFromPath.toUpperCase();

$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  activeCode = String(form.get("code") || "").trim().toUpperCase();
  try {
    const response = await api("/api/participant/join", {
      method: "POST",
      body: JSON.stringify({ code: activeCode, name })
    });
    participantId = response.participant.id;
    $("#joinView").classList.add("hidden");
    $("#quizView").classList.remove("hidden");
    $("#quizTitle").textContent = response.session.title;
    $("#myAvatar").textContent = response.participant.avatar.initials;
    $("#myAvatar").style.background = response.participant.avatar.gradient;
    renderParticipantSession(response.session);
    if (response.question) renderQuestion(response.question);
    connectEvents();
  } catch (error) {
    toast(error.message, "error");
  }
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource(`/events/participant?code=${encodeURIComponent(activeCode)}&participantId=${encodeURIComponent(participantId)}`);
  events.addEventListener("session:update", (event) => renderParticipantSession(JSON.parse(event.data)));
  events.addEventListener("question:start", (event) => renderQuestion(JSON.parse(event.data)));
  events.addEventListener("question:end", (event) => showFeedback(JSON.parse(event.data)));
  events.addEventListener("quiz:finished", (event) => {
    const session = JSON.parse(event.data);
    stopTimer();
    $("#questionMeta").textContent = "Quiz completed";
    $("#questionArea").innerHTML = '<div class="notice">Quiz completed. Final scores are shown on the leaderboard.</div>';
    renderParticipantSession(session);
  });
  events.onerror = () => toast("Live connection interrupted. Rejoin if the leaderboard stops updating.", "error");
}

function renderParticipantSession(session) {
  if (!session || (activeCode && session.code !== activeCode)) return;
  renderLeaderboard(session.leaderboard, $("#participantLeaderboard"));
  if (session.state === "lobby") {
    $("#questionMeta").textContent = "Waiting for admin to start.";
  }
  if (session.state === "leaderboard") {
    $("#questionMeta").textContent = "Leaderboard is live. Next question starts soon.";
  }
}

function renderQuestion(question) {
  if (!question) return;
  selectedIndex = null;
  revealMode = false;
  $("#questionMeta").textContent = `Question ${question.index + 1} of ${question.total}`;
  $("#questionArea").innerHTML = `
    <h2>${escapeHtml(question.text)}</h2>
    <div class="stack" id="answerOptions">
      ${question.options.map((option, index) => `
        <button class="answer-option" data-index="${index}" type="button">
          <strong>${String.fromCharCode(65 + index)}.</strong>
          <span>${escapeHtml(option)}</span>
        </button>
      `).join("")}
    </div>
    <div class="status" id="answerStatus">Choose one answer before the timer ends.</div>
  `;
  $$(".answer-option").forEach((button) => {
    button.addEventListener("click", () => submitAnswer(Number(button.dataset.index)));
  });
  startTimer(question.startedAt, question.timePerQuestion);
}

function submitAnswer(index) {
  if (revealMode || selectedIndex !== null) return;
  selectedIndex = index;
  $$(".answer-option").forEach((button) => button.classList.toggle("selected", Number(button.dataset.index) === index));
  $("#answerStatus").textContent = "Answer submitted. Feedback appears after the timer ends.";
  api("/api/answer", {
    method: "POST",
    body: JSON.stringify({ code: activeCode, participantId, selectedIndex: index })
  }).catch((error) => {
    $("#answerStatus").textContent = error.message;
  });
}

function showFeedback(payload) {
  if (!payload?.question) return;
  stopTimer();
  revealMode = true;
  const correctIndex = payload.question.correctIndex;
  $$(".answer-option").forEach((button) => {
    const index = Number(button.dataset.index);
    button.disabled = true;
    if (index === correctIndex) button.classList.add("correct");
    if (selectedIndex === index && selectedIndex !== correctIndex) button.classList.add("incorrect");
  });
  $("#questionMeta").textContent = "Time ended. Review the answer.";
  $("#answerStatus").textContent = selectedIndex === correctIndex
    ? "Correct answer."
    : "Incorrect answer. The correct option is highlighted in green.";
  $("#timerBar").style.width = "0%";
}

function startTimer(startedAt, seconds) {
  stopTimer();
  const totalMs = seconds * 1000;
  const update = () => {
    const elapsed = Date.now() - startedAt;
    const percent = Math.max(0, 100 - (elapsed / totalMs) * 100);
    $("#timerBar").style.width = `${percent}%`;
    if (percent <= 0) stopTimer();
  };
  update();
  tickTimer = setInterval(update, 250);
}

function stopTimer() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}
