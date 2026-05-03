const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const sessionsByToken = new Map();
const liveSessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "GET" && pathname === "/") return sendFile(res, path.join(PUBLIC_DIR, "index.html"));
    if (req.method === "GET" && pathname === "/admin") return sendFile(res, path.join(PUBLIC_DIR, "admin.html"));
    if (req.method === "GET" && pathname === "/participant") return sendFile(res, path.join(PUBLIC_DIR, "participant.html"));
    if (req.method === "GET" && pathname.startsWith("/join/")) return sendFile(res, path.join(PUBLIC_DIR, "participant.html"));
    if (req.method === "GET" && pathname === "/events/admin") return adminEvents(req, res, url);
    if (req.method === "GET" && pathname === "/events/participant") return participantEvents(req, res, url);
    if (pathname.startsWith("/api/")) return apiRoute(req, res, url);

    const staticPath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (req.method === "GET" && staticPath.startsWith(PUBLIC_DIR)) return sendFile(res, staticPath);
    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error." });
  }
});

async function apiRoute(req, res, url) {
  const pathname = url.pathname;
  if (req.method === "POST" && pathname === "/api/admin/register") return registerAdmin(req, res);
  if (req.method === "POST" && pathname === "/api/admin/login") return loginAdmin(req, res);
  if (req.method === "POST" && pathname === "/api/admin/logout") return logoutAdmin(req, res);
  if (req.method === "GET" && pathname === "/api/admin/me") return currentAdmin(req, res);
  if (req.method === "GET" && pathname === "/api/quizzes") return listQuizzes(req, res);
  if (req.method === "POST" && pathname === "/api/quizzes") return createQuiz(req, res);
  if (req.method === "POST" && pathname === "/api/participant/join") return joinParticipant(req, res);
  if (req.method === "POST" && pathname === "/api/answer") return submitAnswer(req, res);
  if (req.method === "POST" && pathname === "/api/session/start") return startLiveQuiz(req, res);
  if (req.method === "POST" && pathname === "/api/session/next") return nextQuestion(req, res);
  if (req.method === "POST" && pathname === "/api/session/skip") return skipQuestion(req, res);

  const publicMatch = pathname.match(/^\/api\/quizzes\/([^/]+)\/public$/);
  if (req.method === "GET" && publicMatch) return publicQuizInfo(req, res, publicMatch[1]);

  const qrMatch = pathname.match(/^\/api\/quizzes\/([^/]+)\/qr$/);
  if (req.method === "GET" && qrMatch) return redirectQr(req, res, qrMatch[1]);

  sendJson(res, 404, { error: "API route not found." });
}

async function readStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const store = JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
    return {
      admins: Array.isArray(store.admins) ? store.admins : [],
      quizzes: Array.isArray(store.quizzes) ? store.quizzes : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const fresh = { admins: [], quizzes: [] };
    await writeStore(fresh);
    return fresh;
  }
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

async function sendFile(res, filePath) {
  try {
    const ext = path.extname(filePath);
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(file);
  } catch {
    sendJson(res, 404, { error: "File not found." });
  }
}

function origin(req) {
  return `http://${req.headers.host}`;
}

function getCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((pair) => {
    const [key, ...value] = pair.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function setCookie(res, name, value, options = "") {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; ${options}`);
}

function adminFromRequest(req) {
  const token = getCookies(req).adminToken;
  return token ? sessionsByToken.get(token) : null;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 120000, 64, "sha512", (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("hex"));
    });
  });
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt] = stored.split(":");
  const attempted = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(attempted));
}

async function registerAdmin(req, res) {
  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (username.length < 3 || password.length < 4) {
    return sendJson(res, 400, { error: "Use a username of 3+ characters and password of 4+ characters." });
  }
  const store = await readStore();
  if (store.admins.some((admin) => admin.username.toLowerCase() === username.toLowerCase())) {
    return sendJson(res, 409, { error: "That username is already registered." });
  }
  const admin = { id: crypto.randomUUID(), username, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
  store.admins.push(admin);
  await writeStore(store);
  createAdminSession(res, admin);
  sendJson(res, 200, { username });
}

async function loginAdmin(req, res) {
  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const store = await readStore();
  const admin = store.admins.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return sendJson(res, 401, { error: "Invalid username or password." });
  }
  createAdminSession(res, admin);
  sendJson(res, 200, { username: admin.username });
}

function createAdminSession(res, admin) {
  const token = crypto.randomUUID();
  sessionsByToken.set(token, { id: admin.id, username: admin.username });
  setCookie(res, "adminToken", token, "Max-Age=28800");
}

function logoutAdmin(req, res) {
  const token = getCookies(req).adminToken;
  if (token) sessionsByToken.delete(token);
  setCookie(res, "adminToken", "", "Max-Age=0");
  sendJson(res, 200, { ok: true });
}

function currentAdmin(req, res) {
  const admin = adminFromRequest(req);
  sendJson(res, 200, admin ? { loggedIn: true, username: admin.username } : { loggedIn: false });
}

async function listQuizzes(req, res) {
  const admin = adminFromRequest(req);
  if (!admin) return sendJson(res, 401, { error: "Please log in as admin." });
  const store = await readStore();
  const quizzes = store.quizzes.filter((quiz) => quiz.adminId === admin.id).map((quiz) => publicQuiz(quiz, req));
  sendJson(res, 200, { quizzes });
}

async function createQuiz(req, res) {
  const admin = adminFromRequest(req);
  if (!admin) return sendJson(res, 401, { error: "Please log in as admin." });
  try {
    const body = await readBody(req);
    const title = String(body.title || "").trim();
    const timePerQuestion = Number(body.timePerQuestion);
    if (!title) throw new Error("Quiz title is required.");
    if (!Number.isInteger(timePerQuestion) || timePerQuestion < 5 || timePerQuestion > 120) {
      throw new Error("Question time must be between 5 and 120 seconds.");
    }
    const store = await readStore();
    const quiz = {
      id: crypto.randomUUID(),
      adminId: admin.id,
      title,
      code: crypto.randomBytes(3).toString("hex").toUpperCase(),
      timePerQuestion,
      questions: normalizeQuestions(body.questions),
      published: true,
      createdAt: new Date().toISOString()
    };
    store.quizzes.push(quiz);
    await writeStore(store);
    sendJson(res, 200, { quiz: publicQuiz(quiz, req) });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function normalizeQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) throw new Error("Add at least one question.");
  return rawQuestions.map((question, index) => {
    const text = String(question.text || "").trim();
    const options = (question.options || []).map((option) => String(option || "").trim());
    const correctIndex = Number(question.correctIndex);
    if (!text) throw new Error(`Question ${index + 1} is missing text.`);
    if (options.length !== 4 || options.some((option) => !option)) throw new Error(`Question ${index + 1} must have four options.`);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error(`Question ${index + 1} needs one correct option.`);
    return { id: crypto.randomUUID(), text, options, correctIndex };
  });
}

function publicQuiz(quiz, req) {
  const link = `${origin(req)}/join/${quiz.code}`;
  return { ...quiz, link, questionCount: quiz.questions.length };
}

async function publicQuizInfo(req, res, code) {
  const quiz = await findQuiz(code);
  if (!quiz) return sendJson(res, 404, { error: "Quiz not found." });
  sendJson(res, 200, { quiz: { title: quiz.title, code: quiz.code, questionCount: quiz.questions.length, timePerQuestion: quiz.timePerQuestion } });
}

async function redirectQr(req, res, code) {
  const quiz = await findQuiz(code);
  if (!quiz) return sendJson(res, 404, { error: "Quiz not found." });
  const link = encodeURIComponent(`${origin(req)}/join/${quiz.code}`);
  res.writeHead(302, { Location: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${link}` });
  res.end();
}

async function findQuiz(code) {
  const store = await readStore();
  return store.quizzes.find((item) => item.code.toUpperCase() === String(code || "").toUpperCase());
}

async function joinParticipant(req, res) {
  const body = await readBody(req);
  const quiz = await findQuiz(body.code);
  if (!quiz) return sendJson(res, 404, { error: "Quiz not found." });
  const name = String(body.name || "").trim().slice(0, 30);
  if (!name) return sendJson(res, 400, { error: "Please enter your name." });
  const live = getLiveSession(quiz);
  const participant = { id: crypto.randomUUID(), name, score: 0, avatar: makeAvatar(name), joinedAt: Date.now() };
  live.participants.set(participant.id, participant);
  broadcast(live, "session:update", sessionSnapshot(live));
  sendJson(res, 200, { participant, session: sessionSnapshot(live), question: live.state === "question" ? currentQuestionPayload(live) : null });
}

async function adminEvents(req, res, url) {
  const admin = adminFromRequest(req);
  const quiz = await findQuiz(url.searchParams.get("code"));
  if (!admin || !quiz || quiz.adminId !== admin.id) return sendJson(res, 401, { error: "Not authorized." });
  const live = getLiveSession(quiz);
  addClient(res, live, `admin-${crypto.randomUUID()}`);
  writeEvent(res, "session:update", sessionSnapshot(live));
}

async function participantEvents(req, res, url) {
  const quiz = await findQuiz(url.searchParams.get("code"));
  if (!quiz) return sendJson(res, 404, { error: "Quiz not found." });
  const participantId = url.searchParams.get("participantId");
  const live = getLiveSession(quiz);
  if (!live.participants.has(participantId)) return sendJson(res, 404, { error: "Participant not active." });
  addClient(res, live, participantId, () => {
    live.participants.delete(participantId);
    live.answers.delete(participantId);
    broadcast(live, "session:update", sessionSnapshot(live));
  });
  writeEvent(res, "session:update", sessionSnapshot(live));
  if (live.state === "question") writeEvent(res, "question:start", currentQuestionPayload(live));
}

function addClient(res, live, key, onClose) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  live.clients.set(key, res);
  res.write(": connected\n\n");
  res.on("close", () => {
    live.clients.delete(key);
    if (onClose) onClose();
  });
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(live, event, data) {
  for (const client of live.clients.values()) writeEvent(client, event, data);
}

function getLiveSession(quiz) {
  if (!liveSessions.has(quiz.code)) {
    liveSessions.set(quiz.code, {
      code: quiz.code,
      quiz,
      state: "lobby",
      currentIndex: -1,
      questionStartedAt: null,
      timer: null,
      participants: new Map(),
      answers: new Map(),
      clients: new Map()
    });
  }
  const live = liveSessions.get(quiz.code);
  live.quiz = quiz;
  return live;
}

function sessionSnapshot(live) {
  return {
    code: live.code,
    title: live.quiz.title,
    state: live.state,
    currentIndex: live.currentIndex,
    totalQuestions: live.quiz.questions.length,
    timePerQuestion: live.quiz.timePerQuestion,
    leaderboard: [...live.participants.values()]
      .map(({ id, name, score, avatar }) => ({ id, name, score, avatar }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    answeredCount: live.answers.size,
    participantCount: live.participants.size
  };
}

function currentQuestionPayload(live, reveal = false) {
  const question = live.quiz.questions[live.currentIndex];
  if (!question) return null;
  return {
    index: live.currentIndex,
    total: live.quiz.questions.length,
    text: question.text,
    options: question.options,
    timePerQuestion: live.quiz.timePerQuestion,
    startedAt: live.questionStartedAt,
    reveal,
    correctIndex: reveal ? question.correctIndex : null
  };
}

async function startLiveQuiz(req, res) {
  const live = await manageableLive(req, res);
  if (!live) return;
  for (const participant of live.participants.values()) participant.score = 0;
  live.currentIndex = -1;
  moveNext(live);
  sendJson(res, 200, { ok: true });
}

async function nextQuestion(req, res) {
  const live = await manageableLive(req, res);
  if (!live) return;
  if (live.state === "question") endQuestion(live, "admin-next");
  moveNext(live);
  sendJson(res, 200, { ok: true });
}

async function skipQuestion(req, res) {
  const live = await manageableLive(req, res);
  if (!live) return;
  if (live.state === "question") {
    clearQuestionTimer(live);
    live.state = "leaderboard";
    broadcast(live, "question:end", { reason: "skip", question: currentQuestionPayload(live, true), answers: Object.fromEntries(live.answers) });
  }
  moveNext(live);
  sendJson(res, 200, { ok: true });
}

async function manageableLive(req, res) {
  const admin = adminFromRequest(req);
  if (!admin) {
    sendJson(res, 401, { error: "Please log in as admin." });
    return null;
  }
  const body = await readBody(req);
  const quiz = await findQuiz(body.code);
  if (!quiz || quiz.adminId !== admin.id) {
    sendJson(res, 403, { error: "You cannot manage this quiz." });
    return null;
  }
  return getLiveSession(quiz);
}

async function submitAnswer(req, res) {
  const body = await readBody(req);
  const live = liveSessions.get(String(body.code || "").toUpperCase());
  if (!live || live.state !== "question") return sendJson(res, 400, { error: "Question is not active." });
  if (!live.participants.has(body.participantId)) return sendJson(res, 404, { error: "Join the quiz first." });
  if (live.answers.has(body.participantId)) return sendJson(res, 200, { ok: true, alreadyAnswered: true });
  live.answers.set(body.participantId, { selectedIndex: Number(body.selectedIndex), elapsedMs: Date.now() - live.questionStartedAt, scored: false });
  broadcast(live, "session:update", sessionSnapshot(live));
  if (live.answers.size >= live.participants.size && live.participants.size > 0) endQuestion(live, "all-answered");
  sendJson(res, 200, { ok: true });
}

function moveNext(live) {
  if (live.currentIndex + 1 >= live.quiz.questions.length) {
    clearQuestionTimer(live);
    live.state = "finished";
    broadcast(live, "quiz:finished", sessionSnapshot(live));
    broadcast(live, "session:update", sessionSnapshot(live));
    return;
  }
  startQuestion(live, live.currentIndex + 1);
}

function startQuestion(live, index) {
  clearQuestionTimer(live);
  live.currentIndex = index;
  live.state = "question";
  live.answers.clear();
  live.questionStartedAt = Date.now();
  broadcast(live, "question:start", currentQuestionPayload(live));
  broadcast(live, "session:update", sessionSnapshot(live));
  live.timer = setTimeout(() => endQuestion(live, "timer"), live.quiz.timePerQuestion * 1000);
}

function endQuestion(live, reason) {
  if (live.state !== "question") return;
  clearQuestionTimer(live);
  const question = live.quiz.questions[live.currentIndex];
  const limit = live.quiz.timePerQuestion * 1000;
  for (const [participantId, answer] of live.answers.entries()) {
    const participant = live.participants.get(participantId);
    if (!participant || answer.scored) continue;
    if (answer.selectedIndex === question.correctIndex) {
      participant.score += 10 + Math.round(Math.max(0, (limit - answer.elapsedMs) / limit) * 10);
    }
    answer.scored = true;
  }
  live.state = "leaderboard";
  broadcast(live, "question:end", { reason, question: currentQuestionPayload(live, true), answers: Object.fromEntries(live.answers) });
  broadcast(live, "session:update", sessionSnapshot(live));
}

function clearQuestionTimer(live) {
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;
}

function makeAvatar(name) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  const gradients = [
    "linear-gradient(135deg, #2563eb, #7c3aed)",
    "linear-gradient(135deg, #0f766e, #2563eb)",
    "linear-gradient(135deg, #0891b2, #4f46e5)",
    "linear-gradient(135deg, #7c3aed, #db2777)"
  ];
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % gradients.length;
  return { initials: initials || "U", gradient: gradients[hash] };
}

server.listen(PORT, () => {
  console.log(`Quiz app running at http://localhost:${PORT}`);
});
