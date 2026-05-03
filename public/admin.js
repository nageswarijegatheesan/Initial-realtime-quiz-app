let activeCode = null;
let events = null;

$("#addQuestionBtn").innerHTML = `${icon("plus")} Add Question`;
$("#startBtn").innerHTML = `${icon("play")} Start Quiz`;
$("#nextBtn").innerHTML = `${icon("next")} Next Question`;
$("#skipBtn").innerHTML = `${icon("skip")} Skip Question`;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function setAuthed(isAuthed) {
  $("#authView").classList.toggle("hidden", isAuthed);
  $("#dashboardView").classList.toggle("hidden", !isAuthed);
  $("#logoutBtn").classList.toggle("hidden", !isAuthed);
}

async function checkAuth() {
  const data = await api("/api/admin/me");
  setAuthed(data.loggedIn);
  if (data.loggedIn) {
    ensureQuestion();
    loadQuizzes();
  }
}

$$("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.authTab;
    $("#loginForm").classList.toggle("hidden", mode !== "login");
    $("#registerForm").classList.toggle("hidden", mode !== "register");
    $("#adminStatus").textContent = "";
  });
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    toast("Logged in successfully.");
    setAuthed(true);
    ensureQuestion();
    loadQuizzes();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/admin/register", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form))
    });
    toast("Account created.");
    setAuthed(true);
    ensureQuestion();
    loadQuizzes();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  setAuthed(false);
});

function ensureQuestion() {
  if ($("#questionList").children.length === 0) addQuestion();
}

function addQuestion() {
  const index = $("#questionList").children.length + 1;
  const card = document.createElement("section");
  card.className = "question-card stack";
  card.innerHTML = `
    <div class="row between">
      <h3>Question ${index}</h3>
      <button class="btn ghost remove-question" type="button">Remove</button>
    </div>
    <label class="field"><span>Question Text</span><textarea name="text" required></textarea></label>
    <div class="option-grid">
      ${[0, 1, 2, 3].map((item) => `
        <label class="field">
          <span>Option ${item + 1}</span>
          <input name="option${item}" required>
        </label>
      `).join("")}
    </div>
    <label class="field">
      <span>Correct Option</span>
      <select name="correctIndex">
        <option value="0">Option 1</option>
        <option value="1">Option 2</option>
        <option value="2">Option 3</option>
        <option value="3">Option 4</option>
      </select>
    </label>
  `;
  $(".remove-question", card).addEventListener("click", () => {
    card.remove();
    renumberQuestions();
  });
  $("#questionList").appendChild(card);
}

function renumberQuestions() {
  $$(".question-card").forEach((card, index) => {
    $("h3", card).textContent = `Question ${index + 1}`;
  });
}

$("#addQuestionBtn").addEventListener("click", addQuestion);

$("#quizForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const questions = $$(".question-card").map((card) => ({
    text: $("[name=text]", card).value,
    options: [0, 1, 2, 3].map((index) => $(`[name=option${index}]`, card).value),
    correctIndex: Number($("[name=correctIndex]", card).value)
  }));
  try {
    const payload = {
      title: form.get("title"),
      timePerQuestion: Number(form.get("timePerQuestion")),
      questions
    };
    await api("/api/quizzes", { method: "POST", body: JSON.stringify(payload) });
    event.currentTarget.reset();
    $("#questionList").innerHTML = "";
    ensureQuestion();
    await loadQuizzes();
    toast("Quiz published.");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#refreshBtn").addEventListener("click", loadQuizzes);

async function loadQuizzes() {
  const { quizzes } = await api("/api/quizzes");
  const list = $("#quizList");
  if (!quizzes.length) {
    list.innerHTML = '<div class="notice">Create your first quiz to get a code, link, and QR image.</div>';
    return;
  }
  list.innerHTML = quizzes.map((quiz) => `
    <article class="quiz-card">
      <div class="row between">
        <div>
          <h3>${escapeHtml(quiz.title)}</h3>
          <p class="muted">${quiz.questionCount} questions | ${quiz.timePerQuestion}s each</p>
        </div>
        <span class="code-pill">${quiz.code}</span>
      </div>
      <div class="row">
        <img class="qr" src="/api/quizzes/${quiz.code}/qr" alt="QR code for ${escapeHtml(quiz.title)}">
        <div class="stack">
          <input readonly value="${quiz.link}" aria-label="Quiz link">
          <div class="row">
            <a class="btn ghost" href="${quiz.link}" target="_blank">Open Link</a>
            <button class="btn primary manage-btn" data-code="${quiz.code}" data-title="${escapeHtml(quiz.title)}" type="button">Manage Live</button>
          </div>
        </div>
      </div>
    </article>
  `).join("");
  $$(".manage-btn").forEach((button) => {
    button.addEventListener("click", () => joinAdminSession(button.dataset.code, button.dataset.title));
  });
}

function joinAdminSession(code, title) {
  activeCode = code;
  if (events) events.close();
  events = new EventSource(`/events/admin?code=${encodeURIComponent(code)}`);
  events.addEventListener("session:update", (event) => renderSession(JSON.parse(event.data)));
  events.onerror = () => toast("Live connection interrupted. Refresh or select the quiz again.", "error");
  $("#sessionInfo").textContent = `${title} | Code ${code}`;
  $("#startBtn").disabled = false;
  $("#nextBtn").disabled = false;
  $("#skipBtn").disabled = false;
}

$("#startBtn").addEventListener("click", () => controlSession("/api/session/start"));
$("#nextBtn").addEventListener("click", () => controlSession("/api/session/next"));
$("#skipBtn").addEventListener("click", () => controlSession("/api/session/skip"));

async function controlSession(path) {
  if (!activeCode) return;
  try {
    await api(path, { method: "POST", body: JSON.stringify({ code: activeCode }) });
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderSession(session) {
  if (!session || session.code !== activeCode) return;
  $("#sessionStats").textContent = `${session.state.toUpperCase()} | Question ${Math.max(0, session.currentIndex + 1)} of ${session.totalQuestions} | ${session.answeredCount}/${session.participantCount} answered`;
  renderLeaderboard(session.leaderboard, $("#leaderboard"));
}

checkAuth().catch((error) => toast(error.message, "error"));
