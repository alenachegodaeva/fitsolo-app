const API = "https://103.76.53.84.nip.io";

// ===== ХРАНИЛИЩЕ =====
let token = localStorage.getItem("token");
let userId = localStorage.getItem("userId");
let chatHistory = [];
let statsCharts = [];
let currentPlan = null;
let exerciseBase = [];

// ===== УТИЛИТА: fetch с токеном =====
async function apiFetch(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (token) {
    opts.headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    logout();
    throw new Error("unauthorized");
  }
  return res;
}

// ===== TOAST =====
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ===== УТИЛИТЫ =====
function isCardio(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.startsWith("кардио") || n.startsWith("заминка") || n.includes("растяжка");
}

function formatLogEntry(l) {
  if (isCardio(l.exercise)) {
    return `<strong>${l.exercise}</strong> — ${l.weight} мин`;
  }
  return `<strong>${l.exercise}</strong> — ${l.weight}кг × ${l.reps} × ${l.sets}`;
}

function updateWeightPlaceholder(exerciseName) {
  const input = document.querySelector('#log-form input[name="weight"]');
  if (!input) return;
  input.placeholder = (exerciseName && isCardio(exerciseName)) ? "Минуты" : "Вес (кг)";
}

document.addEventListener("input", (e) => {
  if (e.target.type === "number" && e.target.value.startsWith("-")) {
    e.target.value = e.target.value.slice(1);
  }
});

// ===== БАЗА УПРАЖНЕНИЙ =====
async function loadExerciseBase() {
  try {
    const res = await fetch(`${API}/api/exercises`);
    exerciseBase = await res.json();
  } catch (err) {
    console.warn("Не удалось загрузить базу упражнений:", err);
  }
}

// ===== АВТОРИЗАЦИЯ =====
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function logout() {
  localStorage.removeItem("token");
  token = null;
  showScreen("auth");
}

document.getElementById("auth-tab-login").addEventListener("click", () => {
  document.getElementById("auth-tab-login").classList.add("active");
  document.getElementById("auth-tab-register").classList.remove("active");
  document.getElementById("login-form").style.display = "block";
  document.getElementById("register-form").style.display = "none";
});

document.getElementById("auth-tab-register").addEventListener("click", () => {
  document.getElementById("auth-tab-register").classList.add("active");
  document.getElementById("auth-tab-login").classList.remove("active");
  document.getElementById("register-form").style.display = "block";
  document.getElementById("login-form").style.display = "none";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const res = await fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: f.email.value.trim(),
        password: f.password.value,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Неверный email или пароль");
    }
    const data = await res.json();
    token = data.token;
    userId = String(data.user_id);
    localStorage.setItem("token", token);
    localStorage.setItem("userId", userId);
    f.reset();
    showToast("Вход выполнен ✓", "success");
    showMain();
  } catch (err) {
    showToast(err.message || "Ошибка входа", "error");
  }
});

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const equipment = [...f.querySelectorAll('fieldset:nth-of-type(1) input:checked')].map(i => i.value);
  const injuries  = [...f.querySelectorAll('fieldset:nth-of-type(2) input:checked')].map(i => i.value);

  const body = {
    email: f.email.value.trim(),
    password: f.password.value,
    name: f.name.value,
    gender: f.gender.value,
    age: +f.age.value,
    weight: +f.weight.value,
    height: +f.height.value,
    experience: f.experience.value,
    goal: f.goal.value,
    days_per_week: +f.days_per_week.value,
    equipment,
    injuries,
  };

  const oldId = localStorage.getItem("userId");
  if (oldId && !localStorage.getItem("token")) {
    if (confirm("Нашли старый профиль на этом устройстве. Привязать его к аккаунту, чтобы сохранить историю?")) {
      body.link_user_id = +oldId;
    }
  }

  try {
    const res = await fetch(`${API}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Не удалось зарегистрироваться");
    }
    const data = await res.json();
    token = data.token;
    userId = String(data.user_id);
    localStorage.setItem("token", token);
    localStorage.setItem("userId", userId);
    f.reset();
    showToast("Аккаунт создан ✓", "success");
    showMain();
  } catch (err) {
    showToast(err.message || "Ошибка регистрации", "error");
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  if (confirm("Выйти из аккаунта?")) {
    logout();
    showToast("Вы вышли", "success");
  }
});

// ===== PWA =====
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

function showInstallButton() {
  if (document.getElementById("install-btn")) return;
  const btn = document.createElement("button");
  btn.id = "install-btn";
  btn.className = "btn-secondary";
  btn.textContent = "📲 Установить приложение";
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:1000;";
  btn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") btn.remove();
    deferredPrompt = null;
  };
  document.body.appendChild(btn);
}

window.addEventListener("appinstalled", () => {
  const btn = document.getElementById("install-btn");
  if (btn) btn.remove();
});

// ===== ОНЛАЙН/ОФЛАЙН =====
window.addEventListener("online", () => { document.body.style.filter = ""; });
window.addEventListener("offline", () => {
  document.body.style.filter = "grayscale(0.5)";
});

// ===== ТЕМА =====
const themeToggle = document.getElementById("theme-toggle");
const savedTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);
themeToggle.textContent = savedTheme === "dark" ? "🌙" : "☀️";

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  themeToggle.textContent = next === "dark" ? "🌙" : "☀️";
  localStorage.setItem("theme", next);
  if (statsCharts.length) loadStats();
});

// ===== СТАРЫЙ ОНБОРДИНГ =====
const profileForm = document.getElementById("profile-form");
if (profileForm) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showToast("Используй форму регистрации", "error");
  });
}

// ===== ПОКАЗ ОСНОВНОГО ЭКРАНА =====
async function showMain() {
  showScreen("main");
  await loadProfileName();
  loadPlan();
  loadLogs();
  loadChatHistory();
  setupExerciseAutocomplete();
  loadAchievements();
}

async function loadProfileName() {
  try {
    const res = await apiFetch(`/api/profile/${userId}`);
    const p = await res.json();
    document.getElementById("profile-name").textContent = `👤 ${p.name}`;
  } catch (err) {
    document.getElementById("profile-name").textContent = "👤 Профиль";
  }
}

//// ===== ЛЕНДИНГ =====
function showLanding() {
  showScreen("landing");
}

function bindLanding() {
  const goAuth = () => {
    showScreen("auth");
  };
  ["landing-start", "landing-start-2", "landing-login"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", goAuth);
  });
}

// ===== СТАРТ =====
if (token) {
  apiFetch(`/api/me`)
    .then(res => res.ok ? showMain() : showLanding())
    .catch(() => showLanding());
} else {
  showLanding();
}
bindLanding();
loadExerciseBase();

// ===== ТАБЫ =====
document.querySelectorAll(".tab[data-tab]").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab[data-tab]").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(`tab-${t.dataset.tab}`).classList.add("active");
    if (t.dataset.tab === "stats") { loadStats(); loadAchievements(); loadPhotos(); loadMuscles()}
    if (t.dataset.tab === "nutrition") { loadNutrition(); loadMeals(); loadRecipes();}
    if (t.dataset.tab === "log") buildExercisePicker();
    if (t.dataset.tab === "calendar") { initCalendar(); }
  });
});

// ===== ПРОГРАММА =====
async function loadPlan() {
  try {
    const res = await apiFetch(`/api/plan/${userId}`);
    currentPlan = await res.json();
    localStorage.setItem("cachedPlan", JSON.stringify(currentPlan));
  } catch (err) {
    const cached = localStorage.getItem("cachedPlan");
    if (cached) {
      currentPlan = JSON.parse(cached);
    } else {
      return;
    }
  }

  const el = document.getElementById("plan-content");
  el.innerHTML = `<h2>Твоя программа (${formatSplit(currentPlan.split)})</h2>` +
    currentPlan.week.map(d => `
      <div class="day-card">
        <h3>День ${d.day}</h3>
        <div class="focus">${d.focus}</div>
        ${d.exercises.map(ex => `
          <div class="ex">
            <strong>${ex.name}</strong>
            ${ex.video ? `<a href="${ex.video}" target="_blank">▶ видео</a>` : ""}
            <div class="ex-meta">${ex.sets} × ${ex.reps}${ex.rest ? ` · отдых ${ex.rest}с` : ""}</div>
            ${ex.description ? `<div class="ex-desc">${ex.description}</div>` : ""}
          </div>
        `).join("") || "<div class='ex-meta'>Нет подходящих упражнений</div>"}
      </div>
    `).join("");

  buildExercisePicker();
}

function formatSplit(split) {
  const map = {
    "full_body": "фулбоди",
    "upper_lower": "верх/низ",
    "push_pull_legs": "push/pull/legs",
  };
  return map[split] || split;
}

document.getElementById("regen-btn").addEventListener("click", () => {
  if (confirm("Пересоздать программу? Текущая будет заменена.")) {
    loadPlan();
    showToast("Программа обновлена", "success");
  }
});

document.getElementById("export-btn").addEventListener("click", () => {
  if (!currentPlan) return;
  const w = window.open("", "_blank");
  const html = `
    <html><head><title>FitSolo — программа</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 30px; line-height: 1.5; }
      h1 { color: #4a8a6e; }
      .day { margin-bottom: 30px; page-break-inside: avoid; }
      .day h2 { color: #1a1d21; border-bottom: 2px solid #4a8a6e; padding-bottom: 6px; }
      .ex { margin: 8px 0; padding: 8px; background: #f5f7fa; border-radius: 6px; }
      .ex strong { color: #1a1d21; }
      .meta { color: #6b7280; font-size: 13px; }
      .desc { color: #6b7280; font-size: 12px; font-style: italic; margin-top: 4px; }
    </style></head><body>
    <h1>🏋️ FitSolo — твоя программа</h1>
    <p class="meta">Сплит: <strong>${formatSplit(currentPlan.split)}</strong></p>
    ${currentPlan.week.map(d => `
      <div class="day">
        <h2>День ${d.day} — ${d.focus}</h2>
        ${d.exercises.map(ex => `
          <div class="ex">
            <strong>${ex.name}</strong>
            <div class="meta">${ex.sets} × ${ex.reps}${ex.rest ? ` · отдых ${ex.rest}с` : ""}</div>
            ${ex.description ? `<div class="desc">${ex.description}</div>` : ""}
          </div>
        `).join("")}
      </div>
    `).join("")}
    </body></html>
  `;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
});

// ===== ЧАТ =====
async function loadChatHistory() {
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/chat/history/${userId}`);
    const history = await res.json();
    const box = document.getElementById("chat-messages");
    box.innerHTML = "";
    chatHistory = [];
    history.forEach(m => {
      addMsg(m.content, m.role === "user" ? "user" : "ai");
      chatHistory.push({ role: m.role, content: m.content });
    });
  } catch (err) {
    console.error("Чат:", err);
  }
}

async function clearChatHistory() {
  if (!userId) return;
  if (!confirm("Очистить всю историю чата с тренером?")) return;
  try {
    await apiFetch(`/api/chat/history/${userId}`, { method: "DELETE" });
    document.getElementById("chat-messages").innerHTML = "";
    chatHistory = [];
    addMsg("История очищена. Задай новый вопрос! 💪", "ai");
    showToast("История чата очищена", "success");
  } catch (err) {
    showToast("Не удалось очистить", "error");
  }
}

document.getElementById("clear-chat").addEventListener("click", clearChatHistory);

const chatBox = document.getElementById("chat-messages");

function addMsg(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.textContent = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

document.getElementById("chat-send").addEventListener("click", sendChat);
document.getElementById("chat-text").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendChat();
});

document.querySelectorAll(".quick-q").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("chat-text").value = btn.textContent;
    sendChat();
  });
});

async function sendChat() {
  const input = document.getElementById("chat-text");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMsg(text, "user");
  chatHistory.push({ role: "user", content: text });

  const loading = document.createElement("div");
  loading.className = "msg ai";
  loading.textContent = "Тренер печатает...";
  chatBox.appendChild(loading);
  chatBox.scrollTop = chatBox.scrollHeight;

  try {
    const res = await apiFetch(`/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: +userId, message: text, history: chatHistory }),
    });
    const data = await res.json();
    loading.remove();
    addMsg(data.reply, "ai");
    chatHistory.push({ role: "assistant", content: data.reply });
  } catch (err) {
    loading.remove();
    addMsg("⚠️ Ошибка соединения с сервером", "ai");
  }
}

// ===== ДНЕВНИК =====
document.getElementById("log-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;

  if (+f.weight.value < 0) { showToast("Вес не может быть отрицательным", "error"); return; }
  if (+f.reps.value < 1 || +f.sets.value < 1) { showToast("Повторы и подходы — минимум 1", "error"); return; }

  const payload = {
    user_id: +userId,
    exercise: f.exercise.value,
    weight: +f.weight.value,
    reps: +f.reps.value,
    sets: +f.sets.value,
  };

  try {
    const res = await apiFetch(`/api/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("server");
    f.reset();
    document.querySelectorAll(".exercise-chip").forEach(c => c.classList.remove("active"));
    updateWeightPlaceholder("");
    await loadLogs();
    loadAchievements();
    const firstItem = document.querySelector(".log-item");
    if (firstItem) {
      firstItem.classList.add("just-added");
      setTimeout(() => firstItem.classList.remove("just-added"), 1200);
    }
    showToast("Запись добавлена ✓", "success");
  } catch (err) {
    showToast("Не удалось сохранить запись", "error");
  }
});

let logPeriod = 7;

async function loadLogs() {
  const res = await apiFetch(`/api/logs/${userId}`);
  const allLogs = await res.json();

  let logs = allLogs;
  if (logPeriod > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - logPeriod);
    cutoff.setHours(0, 0, 0, 0);
    logs = allLogs.filter(l => new Date(l.date) >= cutoff);
  }

  logs.sort((a, b) => new Date(b.date) - new Date(a.date));

  const el = document.getElementById("logs-list");

  if (!logs.length) {
    el.innerHTML = "<p class='hint'>Пока нет записей за этот период</p>";
    return;
  }

  const groups = {};
  logs.forEach(l => {
    const d = new Date(l.date);
    const key = d.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  });

  const formatDate = (isoKey) => {
    const d = new Date(isoKey + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    if (d.getTime() === today.getTime()) return "Сегодня";
    if (d.getTime() === yest.getTime()) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  };

  el.innerHTML = Object.keys(groups).map(dateKey => `
    <div class="log-day-group">
      <div class="log-day-title">${formatDate(dateKey)}</div>
      ${groups[dateKey].map(l => `
        <div class="log-item">
          <div>${formatLogEntry(l)}</div>
          <div class="log-actions">
            <button class="log-repeat" title="Повторить"
              data-exercise="${l.exercise}"
              data-weight="${l.weight}"
              data-reps="${l.reps}"
              data-sets="${l.sets}">↻</button>
            <button class="log-delete" data-id="${l.id}" title="Удалить">✕</button>
          </div>
        </div>
      `).join("")}
    </div>
  `).join("");

  document.querySelectorAll(".log-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Удалить запись?")) {
        try {
          await apiFetch(`/api/log/${btn.dataset.id}`, { method: "DELETE" });
          await loadLogs();
          showToast("Запись удалена", "success");
        } catch (err) { showToast("Ошибка удаления", "error"); }
      }
    });
  });

  document.querySelectorAll(".log-repeat").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = document.getElementById("log-form");
      f.exercise.value = btn.dataset.exercise;
      f.weight.value = btn.dataset.weight;
      f.reps.value = btn.dataset.reps;
      f.sets.value = btn.dataset.sets;
      updateWeightPlaceholder(btn.dataset.exercise);
      document.getElementById("log-form").scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => f.weight.focus(), 300);
      showToast("Заполнено — измени и сохрани", "success");
    });
  });
}

document.querySelectorAll("#log-period-switch .btn-secondary").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#log-period-switch .btn-secondary").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    logPeriod = +btn.dataset.period;
    loadLogs();
  });
});

// ===== ЧИПЫ УПРАЖНЕНИЙ =====
function buildExercisePicker() {
  const picker = document.getElementById("exercise-picker");
  if (!picker) return;
  picker.innerHTML = "";
  if (!currentPlan || !currentPlan.week) return;

  const seen = new Set();
  const planExercises = [];
  currentPlan.week.forEach(day => {
    (day.exercises || []).forEach(ex => {
      if (ex.name && !seen.has(ex.name)) {
        seen.add(ex.name);
        planExercises.push(ex.name);
      }
    });
  });

  planExercises.forEach(name => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "exercise-chip";
    chip.textContent = name;
    chip.addEventListener("click", () => {
      const input = document.getElementById("log-exercise-input");
      input.value = name;
      picker.querySelectorAll(".exercise-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      updateWeightPlaceholder(name);
      document.querySelector('#log-form input[name="weight"]').focus();
    });
    picker.appendChild(chip);
  });
}

// ===== АВТОДОПОЛНЕНИЕ =====
function setupExerciseAutocomplete() {
  const input = document.getElementById("log-exercise-input");
  const dropdown = document.getElementById("exercise-dropdown");
  if (!input || !dropdown) return;

  input.addEventListener("input", () => {
    updateWeightPlaceholder(input.value);
    const q = input.value.trim().toLowerCase();
    dropdown.innerHTML = "";
    if (q.length < 1) return;

    const planNames = currentPlan?.week?.flatMap(d => (d.exercises || []).map(e => e.name)) || [];
    const planSet = new Set(planNames);
    const baseNames = exerciseBase.map(e => e.name).filter(Boolean);

    const combined = [
      ...planNames.map(name => ({ name, fromPlan: true })),
      ...baseNames.filter(n => !planSet.has(n)).map(name => ({ name, fromPlan: false })),
    ];

    const seen = new Set();
    const matches = combined.filter(item => {
      if (!item.name.toLowerCase().includes(q)) return false;
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    }).slice(0, 10);

    if (!matches.length) return;

    matches.forEach(item => {
      const el = document.createElement("div");
      el.className = "exercise-option";
      el.innerHTML = `${item.name}${item.fromPlan ? '<span class="ex-source">• из программы</span>' : ''}`;
      el.addEventListener("click", () => {
        input.value = item.name;
        dropdown.innerHTML = "";
        updateWeightPlaceholder(item.name);
        document.querySelector('#log-form input[name="weight"]').focus();
      });
      dropdown.appendChild(el);
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".exercise-search-wrap")) dropdown.innerHTML = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && dropdown.firstChild) {
      e.preventDefault();
      dropdown.firstChild.click();
    }
  });
}
// ===== ШАРИНГ ДОСТИЖЕНИЙ =====
const shareModal = document.getElementById("share-modal");
const shareCanvas = document.getElementById("share-canvas");
const shareModalClose = document.getElementById("share-modal-close");
const shareDownload = document.getElementById("share-download");
const shareNative = document.getElementById("share-native");

let currentShareBlob = null;

if (shareModalClose) {
  shareModalClose.addEventListener("click", () => {
    shareModal.style.display = "none";
  });
}

function openShareModal(ach, achievementsData) {
  if (!shareModal || !shareCanvas) return;

  const name = document.getElementById("profile-name").textContent.replace("👤 ", "").trim() || "Пользователь";
  const date = new Date().toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric"
  });
  const streak = achievementsData.streak || 0;
  const totalWorkouts = achievementsData.total_workouts || 0;

  drawShareCard({
    icon: ach.icon,
    title: ach.title,
    name,
    date,
    streak,
    totalWorkouts,
  });

  shareModal.style.display = "flex";

  shareCanvas.toBlob((blob) => {
    currentShareBlob = blob;
  }, "image/png");
}

function drawShareCard({ icon, title, name, date, streak, totalWorkouts }) {
  const ctx = shareCanvas.getContext("2d");
  const W = 1080, H = 1080;

  // Фон
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#14161a");
  grad.addColorStop(1, "#1c1f26");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Декоративные акценты (мягкие круги)
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#7fb89a";
  ctx.beginPath();
  ctx.arc(150, 200, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(950, 900, 350, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Иконка (эмодзи)
  ctx.font = "180px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, W / 2, 340);

  // Название достижения
  ctx.fillStyle = "#e8eaed";
  ctx.font = "bold 68px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(title, W / 2, 540);

  // Имя
  ctx.fillStyle = "#7fb89a";
  ctx.font = "500 48px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(name, W / 2, 640);

  // Дата
  ctx.fillStyle = "#8b929e";
  ctx.font = "400 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(date, W / 2, 700);

  // Доп. инфо (streak + всего тренировок)
  const extras = [];
  if (streak > 0) extras.push(`🔥 ${streak} дней подряд`);
  if (totalWorkouts > 0) extras.push(`💪 всего ${totalWorkouts} тренировок`);

  if (extras.length) {
    ctx.fillStyle = "#8b929e";
    ctx.font = "400 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(extras.join("   ·   "), W / 2, 760);
  }

  // Разделитель
  ctx.strokeStyle = "#2a2e37";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(140, 850);
  ctx.lineTo(W - 140, 850);
  ctx.stroke();

  // Бренд
  ctx.fillStyle = "#e8eaed";
  ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("🏋️ FitSolo", W / 2, 930);

  ctx.fillStyle = "#8b929e";
  ctx.font = "400 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("Твой ИИ-тренер", W / 2, 975);

  ctx.fillStyle = "#7fb89a";
  ctx.font = "400 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText("alenachegodaeva.github.io/fitsolo-app", W / 2, 1015);
}

if (shareDownload) {
  shareDownload.addEventListener("click", () => {
    if (!currentShareBlob) return;
    const url = URL.createObjectURL(currentShareBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fitsolo-achievement-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Картинка скачана ✓", "success");
  });
}

if (shareNative) {
  shareNative.addEventListener("click", async () => {
    if (!currentShareBlob) return;
    const file = new File([currentShareBlob], "fitsolo-achievement.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Моё достижение в FitSolo",
          text: "Смотри, чего я добился в FitSolo 💪",
        });
      } catch (err) {
        if (err.name !== "AbortError") {
          console.warn("Share failed:", err);
          showToast("Не удалось поделиться", "error");
        }
      }
    } else {
      // Фолбэк — скачиваем
      const url = URL.createObjectURL(currentShareBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fitsolo-achievement-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Скачано — поделись вручную", "success");
    }
  });
}
// ===== ГРУППЫ МЫШЦ =====
let musclesCache = null;
let musclesDays = 30;
let musclesMode = "silovye";  // "silovye" | "all"
let musclesChart = null;

async function loadMuscles(days = musclesDays) {
  musclesDays = days;
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/muscle-groups/${userId}?days=${days}`);
    if (!res.ok) throw new Error("muscle-groups fetch failed");
    musclesCache = await res.json();
    renderMuscles();
  } catch (err) {
    console.warn("Не удалось загрузить группы мышц:", err);
  }
}

function renderMuscles() {
  if (!musclesCache) return;

  const groups = musclesCache.groups || [];

  // Фильтр для диаграммы
  const visible = musclesMode === "silovye"
    ? groups.filter(g => !g.is_cardio)
    : groups.filter(g => g.exercises_count > 0);

  // ===== Диаграмма =====
  const ctx = document.getElementById("muscles-chart");
  if (!ctx) return;

  if (musclesChart) {
    musclesChart.destroy();
    musclesChart = null;
  }

  const colors = [
    "#7fb89a", "#e8a87c", "#c38d9e", "#85cdca",
    "#e27d60", "#b8b8ff", "#ffd97d", "#a0c4ff", "#9bc4a8",
  ];

  // Если нет данных — рисуем серый круг с подсказкой
  const hasData = visible.some(g => (g.tonnage || 0) > 0);
  if (!hasData) {
    musclesChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Нет данных"],
        datasets: [{
          data: [1],
          backgroundColor: ["#3a3d44"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
    });
  } else {
    musclesChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: visible.map(g => g.label),
        datasets: [{
          data: visible.map(g => g.tonnage || 0),
          backgroundColor: colors.slice(0, visible.length),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: getComputedStyle(document.documentElement)
                .getPropertyValue("--text").trim() || "#e8eaed",
              font: { size: 11 },
              boxWidth: 10,
              boxHeight: 10,
              padding: 8,
            },
          },
          tooltip: {
            callbacks: {
              label: (c) => {
                const g = visible[c.dataIndex];
                const pct = g.percent != null ? `${g.percent}%` : "—";
                return `${g.label}: ${g.tonnage || 0} кг (${pct})`;
              },
            },
          },
        },
      },
    });
  }

  // ===== Список с прогресс-барами =====
  const listEl = document.getElementById("muscles-list");
  if (!listEl) return;

  const visibleForList = musclesMode === "silovye"
    ? groups.filter(g => !g.is_cardio)
    : groups;

  const maxTonnage = Math.max(
    ...visibleForList.map(g => g.tonnage || 0),
    1
  );

  const statusLabels = {
    under: { text: "⚠️ отстаёт", cls: "under" },
    norm:  { text: "✓ норм",     cls: "norm" },
    over:  { text: "🔥 перекачано", cls: "over" },
  };

  listEl.innerHTML = visibleForList.map(g => {
    const tonnage = g.tonnage || 0;
    const width = (tonnage / maxTonnage) * 100;
    const st = g.status ? statusLabels[g.status] : null;
    const percent = g.percent != null ? `${g.percent}%` : "—";
    const count = g.exercises_count || 0;

    return `
      <div class="muscle-row">
        <div class="muscle-row-head">
          <span class="muscle-name">${g.label}</span>
          <span class="muscle-percent">${percent}</span>
        </div>
        <div class="muscle-bar-wrap">
          <div class="muscle-bar-fill" style="width:${width}%"></div>
        </div>
        <div class="muscle-row-foot">
          <span>${count} записей · ${tonnage} кг</span>
          ${st ? `<span class="muscle-status ${st.cls}">${st.text}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // ===== Рекомендации =====
  const recEl = document.getElementById("muscles-recommendations");
  if (!recEl) return;

  const recs = musclesCache.recommendations || [];
  if (!recs.length) {
    recEl.innerHTML = "";
    return;
  }

  recEl.innerHTML = `
    <div class="muscles-recs">
      <h4>💡 Рекомендации</h4>
      ${recs.map(r => `
        <div class="muscle-rec">
          <div class="muscle-rec-head">${r.text}</div>
          <div class="muscle-rec-ex">${(r.exercises || []).join(" · ")}</div>
        </div>
      `).join("")}
    </div>
  `;
}

// Кнопки периода и режима
document.addEventListener("click", (e) => {
  const periodBtn = e.target.closest("#muscles-period .btn-secondary");
  if (periodBtn) {
    document.querySelectorAll("#muscles-period .btn-secondary")
      .forEach(b => b.classList.remove("active"));
    periodBtn.classList.add("active");
    loadMuscles(+periodBtn.dataset.days);
    return;
  }

  const modeBtn = e.target.closest(".muscles-toggle .btn-secondary");
  if (modeBtn) {
    document.querySelectorAll(".muscles-toggle .btn-secondary")
      .forEach(b => b.classList.remove("active"));
    modeBtn.classList.add("active");
    musclesMode = modeBtn.dataset.mode;
    renderMuscles();
  }
});
// ===== СТАТИСТИКА =====
async function loadStats() {
  const res = await apiFetch(`/api/stats/${userId}`);
  const stats = await res.json();
  const el = document.getElementById("stats-content");

  statsCharts.forEach(c => c.destroy());
  statsCharts = [];

  if (!stats.length) {
    el.innerHTML = "<p class='hint'>Добавь записи в дневник, чтобы увидеть статистику 📈</p>";
    return;
  }

  const textColor = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();

  el.innerHTML = stats.map((s, i) => `
    <div class="stat-card">
      <div class="stat-header">
        <h3>${s.exercise}</h3>
        <span class="stat-max">${s.max_weight}${isCardio(s.exercise) ? " мин" : " кг"}</span>
      </div>
      <div class="stat-meta">
        <span>📊 Тоннаж: ${s.total_volume} кг</span>
        <span>💪 Тренировок: ${s.sessions}</span>
      </div>
      <div class="chart-wrapper"><canvas id="chart-${i}"></canvas></div>
    </div>
  `).join("");

  stats.forEach((s, i) => {
    const ctx = document.getElementById(`chart-${i}`);
    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: s.history.map(h => new Date(h.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })),
        datasets: [{
          label: isCardio(s.exercise) ? "Минуты" : "Вес (кг)",
          data: s.history.map(h => h.weight),
          borderColor: accent,
          backgroundColor: accent + "20",
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointBackgroundColor: accent,
          pointBorderColor: "transparent",
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(20, 22, 26, 0.95)",
            titleColor: "#e8eaed",
            bodyColor: "#e8eaed",
            borderColor: accent,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
            displayColors: false,
          }
        },
        scales: {
          x: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { ticks: { color: textColor, font: { size: 11 } }, grid: { color: textColor + "10" }, border: { display: false } }
        }
      }
    });
    statsCharts.push(chart);
  });
}

// ===== ДОСТИЖЕНИЯ =====
let achievementsCache = null;
let lastEarnedCount = parseInt(localStorage.getItem("lastEarnedCount") || "0");

async function loadAchievements() {
  try {
    const res = await apiFetch(`/api/achievements/${userId}`);
    const data = await res.json();
    achievementsCache = data;

    renderStreakBadge(data.streak, data.earned_count);
    renderAchievements(data);

    if (data.earned_count > lastEarnedCount) {
      showToast(`🏆 Новое достижение! (${data.earned_count}/${data.achievements.length})`, "success");
      localStorage.setItem("lastEarnedCount", String(data.earned_count));
      lastEarnedCount = data.earned_count;
    }
  } catch (err) {
    console.warn("Не удалось загрузить достижения:", err);
  }
}

function renderStreakBadge(streak, earnedCount) {
  const el = document.getElementById("streak-badge");
  if (!el) return;
  if (streak > 0) {
    el.textContent = `🔥 ${streak}`;
    el.style.display = "inline-flex";
  } else {
    el.style.display = "none";
  }
}

function renderAchievements(data) {
  const container = document.getElementById("achievements-block");
  if (!container) return;

  const percent = Math.round((data.earned_count / data.achievements.length) * 100);

  container.innerHTML = `
        <div class="achievements-grid">
      ${data.achievements.map(a => {
        const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
        return `
          <div class="achievement-card ${a.done ? "done" : ""}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-title">${a.title}</div>
            ${a.done
              ? `<div class="achievement-done-label">✓ Получено</div>
                 <button class="achievement-share" type="button" data-ach-id="${a.id}">📤 Поделиться</button>`
              : `<div class="achievement-progress">
                   <div class="achievement-bar"><div class="achievement-bar-fill" style="width:${pct}%"></div></div>
                   <div class="achievement-progress-text">${a.progress} / ${a.target}</div>
                 </div>`
            }
          </div>
        `;
      }).join("")}
    </div>
  `;

  // Кнопки "Поделиться" у достижений
  container.querySelectorAll(".achievement-share").forEach(btn => {
    btn.addEventListener("click", () => {
      const achId = btn.dataset.achId;
      const ach = data.achievements.find(x => x.id === achId);
      if (ach) openShareModal(ach, data);
    });
  });
}

// ===== ПИТАНИЕ =====
async function loadNutrition() {
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/nutrition/${userId}`);
    const n = await res.json();
    document.getElementById("nutrition-norm").innerHTML = `
      <div class="kbju-grid">
        <div class="kbju-card"><div class="label">Калории</div><div class="value cal">${n.target_calories}</div></div>
        <div class="kbju-card"><div class="label">Белки</div><div class="value protein">${n.protein} г</div></div>
        <div class="kbju-card"><div class="label">Жиры</div><div class="value fat">${n.fat} г</div></div>
        <div class="kbju-card"><div class="label">Углеводы</div><div class="value carbs">${n.carbs} г</div></div>
      </div>
    `;
  } catch (err) { console.error(err); }
}

async function loadMeals() {
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/meals/${userId}`);
    const meals = await res.json();

    const today = new Date().toDateString();
    const todayMeals = meals.filter(m => new Date(m.date).toDateString() === today);
    const total = todayMeals.reduce((acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      fat: acc.fat + (m.fat || 0),
      carbs: acc.carbs + (m.carbs || 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });

    const normRes = await apiFetch(`/api/nutrition/${userId}`);
    const norm = await normRes.json();
    const pct = Math.min(100, Math.round((total.calories / norm.target_calories) * 100));

    const listEl = document.getElementById("meals-list");
    listEl.innerHTML = `
      <div class="nutrition-progress">
        <div class="bar-info">
          <span>Съедено: <strong>${Math.round(total.calories)}</strong> / ${norm.target_calories} ккал</span>
          <span>${pct}%</span>
        </div>
        <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-info" style="margin-top:6px;">
          <span>Б: ${Math.round(total.protein)} / ${norm.protein}</span>
          <span>Ж: ${Math.round(total.fat)} / ${norm.fat}</span>
          <span>У: ${Math.round(total.carbs)} / ${norm.carbs}</span>
        </div>
      </div>
      ${todayMeals.length ? todayMeals.map(m => `
        <div class="meal-item">
          <div class="meal-info">
            <strong>${m.name}</strong> — ${m.grams} г
            <div class="meal-macros">${Math.round(m.calories)} ккал · Б ${m.protein} · Ж ${m.fat} · У ${m.carbs}</div>
          </div>
          <button class="meal-delete" data-id="${m.id}" title="Удалить">✕</button>
        </div>
      `).join("") : "<p class='hint'>Сегодня ещё ничего не добавлено</p>"}
    `;

    listEl.querySelectorAll(".meal-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (confirm("Удалить запись?")) {
          await apiFetch(`/api/meal/${btn.dataset.id}`, { method: "DELETE" });
          loadMeals();
          showToast("Приём пищи удалён", "success");
        }
      });
    });
  } catch (err) { console.error(err); }
}

// ===== ПОИСК ПРОДУКТОВ =====
const foodSearchInput = document.getElementById("food-search");
const foodDropdown = document.getElementById("food-dropdown");
let searchTimer = null;

foodSearchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = foodSearchInput.value.trim();
  if (q.length < 2) { foodDropdown.innerHTML = ""; return; }
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API}/api/foods?q=${encodeURIComponent(q)}`);
      const foods = await res.json();
      foodDropdown.innerHTML = foods.map(f => `
        <div class="food-item" data-name="${f.name}" data-cal="${f.calories}" data-p="${f.protein}" data-f="${f.fat}" data-c="${f.carbs}">
          <div>
            <div class="food-name">${f.name}</div>
            <div class="food-cat">${f.category}</div>
          </div>
          <div class="food-kbju">${f.calories} ккал · Б${f.protein} Ж${f.fat} У${f.carbs}</div>
        </div>
      `).join("");
      foodDropdown.querySelectorAll(".food-item").forEach(el => {
        el.addEventListener("click", () => pickFood(el.dataset));
      });
    } catch (err) { console.error(err); }
  }, 250);
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".food-search-wrap")) foodDropdown.innerHTML = "";
});

function pickFood(ds) {
  const form = document.getElementById("meal-form");
  form.name.value = ds.name;
  form.grams.value = 100;
  form.calories.value = ds.cal;
  form.protein.value = ds.p;
  form.fat.value = ds.f;
  form.carbs.value = ds.c;

  form.calories.dataset.base = ds.cal;
  form.protein.dataset.base = ds.p;
  form.fat.dataset.base = ds.f;
  form.carbs.dataset.base = ds.c;

  foodSearchInput.value = "";
  foodDropdown.innerHTML = "";
}

const mealForm = document.getElementById("meal-form");
mealForm.grams.addEventListener("input", recalcMacros);

function recalcMacros() {
  const form = document.getElementById("meal-form");
  const baseGrams = 100;
  const newGrams = parseFloat(form.grams.value) || 0;
  const k = newGrams / baseGrams;
  const baseCal = parseFloat(form.calories.dataset.base) || parseFloat(form.calories.value);
  const baseP = parseFloat(form.protein.dataset.base) || parseFloat(form.protein.value);
  const baseF = parseFloat(form.fat.dataset.base) || parseFloat(form.fat.value);
  const baseC = parseFloat(form.carbs.dataset.base) || parseFloat(form.carbs.value);

  form.calories.value = (baseCal * k).toFixed(1);
  form.protein.value = (baseP * k).toFixed(1);
  form.fat.value = (baseF * k).toFixed(1);
  form.carbs.value = (baseC * k).toFixed(1);
}

document.getElementById("meal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;

  const numFields = ["grams", "calories", "protein", "fat", "carbs"];
  for (const name of numFields) {
    if (+f[name].value < 0) { showToast("Значения не могут быть отрицательными", "error"); return; }
  }
  if (+f.grams.value < 1) { showToast("Граммы — минимум 1", "error"); return; }

  try {
    await apiFetch(`/api/meal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: +userId,
        name: f.name.value,
        grams: +f.grams.value,
        calories: +f.calories.value,
        protein: +f.protein.value,
        fat: +f.fat.value,
        carbs: +f.carbs.value,
      }),
    });
    f.reset();
    loadMeals();
    loadAchievements();
    showToast("Приём пищи добавлен ✓", "success");
  } catch (err) { showToast("Не удалось добавить", "error"); }
});

// ============================================================
// ===== ФОТО ПРОГРЕССА =======================================
// ============================================================

let photosCache = [];
let sliderIndex = 0;
let pendingPhotoBlob = null;

const cameraInput = document.getElementById("photo-input-camera");
const galleryInput = document.getElementById("photo-input-gallery");

const btnCamera = document.getElementById("photo-pick-camera");
if (btnCamera && cameraInput) {
  btnCamera.addEventListener("click", (e) => {
    e.preventDefault();
    cameraInput.click();
  });
}

const btnGallery = document.getElementById("photo-pick-gallery");
if (btnGallery && galleryInput) {
  btnGallery.addEventListener("click", (e) => {
    e.preventDefault();
    galleryInput.click();
  });
}

async function handlePhotoPick(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    pendingPhotoBlob = await compressImage(file, 1280, 0.82);
    photoPreview.src = URL.createObjectURL(pendingPhotoBlob);
    photoPreview.style.display = "block";
    photoPreviewPlaceholder.style.display = "none";
  } catch (err) {
    showToast("Не удалось обработать фото", "error");
    console.error(err);
  }
  e.target.value = "";
}

if (cameraInput) cameraInput.addEventListener("change", handlePhotoPick);
if (galleryInput) galleryInput.addEventListener("change", handlePhotoPick);

async function loadPhotos() {
  if (!userId) return;
  try {
    const res = await apiFetch(`/api/photos/${userId}`);
    photosCache = await res.json();
    renderPhotosSummary(photosCache);
    renderPhotosTimeline(photosCache);
    checkWeeklyPhotoReminder(photosCache);
  } catch (err) {
    console.warn("Не удалось загрузить фото:", err);
  }
}

function renderPhotosSummary(photos) {
  const el = document.getElementById("photos-summary");
  if (!el) return;

  if (!photos.length) {
    el.innerHTML = "";
    return;
  }

  const sorted = [...photos].sort((a, b) => new Date(a.date) - new Date(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const pinned = photos.find(p => p.is_pinned);

  let weightHtml = "";
  if (first.weight != null && last.weight != null && first.id !== last.id) {
    const diff = +(last.weight - first.weight).toFixed(1);
    const sign = diff > 0 ? "+" : "";
    const cls = diff < 0 ? "down" : diff > 0 ? "up" : "";
    weightHtml = `<div class="photos-diff ${cls}">${sign}${diff} кг</div>`;
  }

  el.innerHTML = `
    <div class="photos-summary-row">
      <div class="photos-summary-item">
        <div class="photos-summary-label">Всего фото</div>
        <div class="photos-summary-value">${photos.length}</div>
      </div>
      <div class="photos-summary-item">
        <div class="photos-summary-label">Старт</div>
        <div class="photos-summary-value">${first.weight != null ? first.weight + " кг" : "—"}</div>
      </div>
      <div class="photos-summary-item">
        <div class="photos-summary-label">Сейчас</div>
        <div class="photos-summary-value">${last.weight != null ? last.weight + " кг" : "—"}</div>
      </div>
      ${weightHtml ? `<div class="photos-summary-item">${weightHtml}</div>` : ""}
    </div>
    ${pinned ? `<div class="photos-pinned-hint">📌 Закреплено: ${formatPhotoDate(pinned.date)}</div>` : ""}
  `;
}

function renderPhotosTimeline(photos) {
  const el = document.getElementById("photos-timeline");
  const emptyEl = document.getElementById("photos-empty");
  if (!el || !emptyEl) return;

  if (!photos.length) {
    el.innerHTML = "";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";

  el.innerHTML = photos.map((p, i) => `
    <div class="photo-thumb ${p.is_pinned ? "pinned" : ""}" data-index="${i}">
      <img src="${API}${p.url}" alt="Фото ${i + 1}" loading="lazy">
      <div class="photo-thumb-date">${formatPhotoDate(p.date)}</div>
      ${p.is_pinned ? `<div class="photo-thumb-pin">📌</div>` : ""}
    </div>
  `).join("");

  el.querySelectorAll(".photo-thumb").forEach(thumb => {
    thumb.addEventListener("click", () => {
      sliderIndex = +thumb.dataset.index;
      openSlider(sliderIndex);
    });
  });
}

function formatPhotoDate(iso) {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0,0,0,0);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  const diffDays = Math.round((today - dd) / 86400000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

const photoModal = document.getElementById("photo-modal");
const photoPreview = document.getElementById("photo-preview");
const photoPreviewPlaceholder = document.getElementById("photo-preview-placeholder");
const photoUploadView = document.getElementById("photo-upload-view");
const photoViewView = document.getElementById("photo-view-view");
const photoWeightInput = document.getElementById("photo-weight");
const photoNoteInput = document.getElementById("photo-note");
const photoSaveBtn = document.getElementById("photo-save");

const photoAddBtn = document.getElementById("photo-add-btn");
if (photoAddBtn) photoAddBtn.addEventListener("click", openPhotoUpload);

const photoModalClose = document.getElementById("photo-modal-close");
if (photoModalClose) photoModalClose.addEventListener("click", closePhotoModal);

function openPhotoUpload() {
  pendingPhotoBlob = null;
  photoPreview.src = "";
  photoPreview.style.display = "none";
  photoPreviewPlaceholder.style.display = "flex";
  photoWeightInput.value = "";
  photoNoteInput.value = "";
  photoUploadView.style.display = "block";
  photoViewView.style.display = "none";
  photoModal.style.display = "flex";
}

function closePhotoModal() {
  photoModal.style.display = "none";
  pendingPhotoBlob = null;
}

function compressImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => { img.src = ev.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round(height * (maxSize / width));
        width = maxSize;
      } else if (height >= width && height > maxSize) {
        width = Math.round(width * (maxSize / height));
        height = maxSize;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")),
        "image/jpeg",
        quality
      );
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

if (photoSaveBtn) {
  photoSaveBtn.addEventListener("click", async () => {
    if (!pendingPhotoBlob) {
      showToast("Сначала выбери фото", "error");
      return;
    }
    photoSaveBtn.disabled = true;
    photoSaveBtn.textContent = "Сохраняю...";

    const fd = new FormData();
    fd.append("user_id", String(userId));
    fd.append("file", pendingPhotoBlob, `photo_${Date.now()}.jpg`);
    if (photoWeightInput.value) fd.append("weight", photoWeightInput.value);
    if (photoNoteInput.value.trim()) fd.append("note", photoNoteInput.value.trim());

    try {
      const res = await apiFetch(`/api/photos/upload`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error("upload failed");
      closePhotoModal();
      showToast("Фото добавлено ✓", "success");
      await loadPhotos();
    } catch (err) {
      showToast("Не удалось загрузить фото", "error");
      console.error(err);
    } finally {
      photoSaveBtn.disabled = false;
      photoSaveBtn.textContent = "Сохранить";
    }
  });
}

// ============================================================
// ===== СЛАЙДЕР ==============================================
// ============================================================

const slider = document.getElementById("photo-slider");
const sliderImg = document.getElementById("slider-img");
const sliderDate = document.getElementById("slider-date");
const sliderWeight = document.getElementById("slider-weight");
const sliderNote = document.getElementById("slider-note");
const sliderThumbs = document.getElementById("slider-thumbs");

const sliderClose = document.getElementById("slider-close");
if (sliderClose) sliderClose.addEventListener("click", closeSlider);
const sliderPrev = document.getElementById("slider-prev");
if (sliderPrev) sliderPrev.addEventListener("click", () => moveSlider(-1));
const sliderNext = document.getElementById("slider-next");
if (sliderNext) sliderNext.addEventListener("click", () => moveSlider(1));

function openSlider(index) {
  if (!photosCache.length) return;
  sliderIndex = Math.max(0, Math.min(index, photosCache.length - 1));
  slider.style.display = "flex";
  renderSlider();
}

function closeSlider() {
  slider.style.display = "none";
}

function moveSlider(delta) {
  if (!photosCache.length) return;
  sliderIndex = (sliderIndex + delta + photosCache.length) % photosCache.length;
  renderSlider();
}

function renderSlider() {
  const p = photosCache[sliderIndex];
  if (!p) return;
  sliderImg.src = `${API}${p.url}`;
  sliderDate.textContent = new Date(p.date).toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric"
  });
  sliderWeight.textContent = p.weight != null ? `⚖️ ${p.weight} кг` : "";
  sliderNote.textContent = p.note || "";

  sliderThumbs.innerHTML = photosCache.map((ph, i) => `
    <div class="slider-thumb ${i === sliderIndex ? "active" : ""}" data-i="${i}">
      <img src="${API}${ph.url}" alt="" loading="lazy">
    </div>
  `).join("");
  sliderThumbs.querySelectorAll(".slider-thumb").forEach(t => {
    t.addEventListener("click", () => {
      sliderIndex = +t.dataset.i;
      renderSlider();
    });
    if (+t.dataset.i === sliderIndex) {
      t.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  });
}

let touchStartX = 0;
if (slider) {
  slider.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  slider.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) moveSlider(dx < 0 ? 1 : -1);
  });
}

document.addEventListener("keydown", (e) => {
  if (slider && slider.style.display === "flex") {
    if (e.key === "ArrowLeft") moveSlider(-1);
    if (e.key === "ArrowRight") moveSlider(1);
    if (e.key === "Escape") closeSlider();
  }
});

// ============================================================
// ===== НАПОМИНАНИЕ ПРО ФОТО =================================
// ============================================================

function checkWeeklyPhotoReminder(photos) {
  if (!photos.length) return;
  const last = photos.reduce((a, b) => new Date(a.date) > new Date(b.date) ? a : b);
  const daysSince = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  if (daysSince < 7) return;

  const lastNotify = +localStorage.getItem("lastPhotoNotify") || 0;
  if (Date.now() - lastNotify < 86400000) return;

  localStorage.setItem("lastPhotoNotify", String(Date.now()));
  setTimeout(() => {
    showToast("📸 Пора сделать новое фото прогресса!", "success");
  }, 1500);
}

// ============================================================
// ===== УДАЛЕНИЕ / ЗАКРЕПЛЕНИЕ ФОТО ==========================
// ============================================================

const sliderDeleteBtn = document.getElementById("slider-delete");
const sliderPinBtn = document.getElementById("slider-pin");

if (sliderDeleteBtn) {
  sliderDeleteBtn.addEventListener("click", async () => {
    const p = photosCache[sliderIndex];
    if (!p) return;
    if (!confirm("Удалить это фото? Действие необратимо.")) return;

    sliderDeleteBtn.disabled = true;
    sliderDeleteBtn.textContent = "Удаляю...";

    try {
      const res = await apiFetch(`/api/photos/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      showToast("Фото удалено", "success");

      photosCache.splice(sliderIndex, 1);

      if (!photosCache.length) {
        closeSlider();
        loadPhotos();
        return;
      }

      if (sliderIndex >= photosCache.length) {
        sliderIndex = photosCache.length - 1;
      }
      renderSlider();
      loadPhotos();
    } catch (err) {
      showToast("Не удалось удалить фото", "error");
      console.error(err);
    } finally {
      sliderDeleteBtn.disabled = false;
      sliderDeleteBtn.textContent = "🗑 Удалить";
    }
  });
}

if (sliderPinBtn) {
  sliderPinBtn.addEventListener("click", async () => {
    const p = photosCache[sliderIndex];
    if (!p) return;

    if (p.is_pinned) {
      showToast("Это фото уже закреплено", "success");
      return;
    }

    sliderPinBtn.disabled = true;
    sliderPinBtn.textContent = "Закрепляю...";

    try {
      const res = await apiFetch(`/api/photos/${p.id}/pin`, { method: "POST" });
      if (!res.ok) throw new Error("pin failed");
      showToast("📌 Фото закреплено", "success");
      await loadPhotos();
      const newPinned = photosCache.find(x => x.is_pinned);
      if (newPinned) {
        sliderIndex = photosCache.findIndex(x => x.id === newPinned.id);
        renderSlider();
      }
    } catch (err) {
      showToast("Не удалось закрепить", "error");
      console.error(err);
    } finally {
      sliderPinBtn.disabled = false;
      sliderPinBtn.textContent = "📌 Закрепить";
    }
  });
}

// ============================================================
// ===== РЕДАКТИРОВАНИЕ ПРОФИЛЯ ===============================
// ============================================================

const editProfileModal = document.getElementById("edit-profile-modal");
const editProfileForm = document.getElementById("edit-profile-form");
const editProfileClose = document.getElementById("edit-profile-close");

document.getElementById("edit-profile").addEventListener("click", openEditProfile);
if (editProfileClose) {
  editProfileClose.addEventListener("click", () => {
    editProfileModal.style.display = "none";
  });
}

async function openEditProfile() {
  try {
    const res = await apiFetch(`/api/profile/${userId}`);
    if (!res.ok) throw new Error("profile fetch failed");
    const p = await res.json();

    const f = editProfileForm;
    if (!f) {
      showToast("Модалка не найдена — обнови страницу", "error");
      return;
    }

    f.name.value = p.name || "";
    f.gender.value = p.gender || "";
    f.age.value = p.age || "";
    f.weight.value = p.weight || "";
    f.height.value = p.height || "";
    f.experience.value = p.experience || "";
    f.goal.value = p.goal || "";
    f.days_per_week.value = p.days_per_week || "";

    f.querySelectorAll('input[name="equipment"]').forEach(cb => {
      cb.checked = (p.equipment || []).includes(cb.value);
    });

    f.querySelectorAll('input[name="injuries"]').forEach(cb => {
      cb.checked = (p.injuries || []).includes(cb.value);
    });
    initNotifications();
    editProfileModal.style.display = "flex";
  } catch (err) {
    showToast("Не удалось загрузить профиль", "error");
    console.error(err);
  }
}

if (editProfileForm) {
  editProfileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;

    const equipment = [...f.querySelectorAll('input[name="equipment"]:checked')].map(i => i.value);
    const injuries  = [...f.querySelectorAll('input[name="injuries"]:checked')].map(i => i.value);

    const body = {
      name: f.name.value.trim(),
      gender: f.gender.value,
      age: +f.age.value,
      weight: +f.weight.value,
      height: +f.height.value,
      experience: f.experience.value,
      goal: f.goal.value,
      days_per_week: +f.days_per_week.value,
      equipment,
      injuries,
    };

    try {
      const res = await apiFetch(`/api/profile/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("update failed");

      showToast("Профиль обновлён ✓", "success");
      editProfileModal.style.display = "none";

      await loadProfileName();
      loadNutrition();
    } catch (err) {
      showToast("Не удалось сохранить профиль", "error");
      console.error(err);
    }
  });
}

// ============================================================
// ===== КАЛЕНДАРЬ ТРЕНИРОВОК =================================
// ============================================================

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

let calendarState = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  initialized: false,
  cache: {},
  achievementsByDay: null,
};

function initCalendar() {
  if (!calendarState.initialized) {
    calendarState.initialized = true;

    document.getElementById("cal-prev").addEventListener("click", () => {
      calendarState.month -= 1;
      if (calendarState.month < 1) {
        calendarState.month = 12;
        calendarState.year -= 1;
      }
      renderCalendar();
    });

    document.getElementById("cal-next").addEventListener("click", () => {
      calendarState.month += 1;
      if (calendarState.month > 12) {
        calendarState.month = 1;
        calendarState.year += 1;
      }
      renderCalendar();
    });

    const todayBtn = document.getElementById("cal-today");
    if (todayBtn) {
      todayBtn.addEventListener("click", () => {
        const now = new Date();
        calendarState.year = now.getFullYear();
        calendarState.month = now.getMonth() + 1;
        renderCalendar();
      });
    }

    const dayClose = document.getElementById("day-modal-close");
    if (dayClose) {
      dayClose.addEventListener("click", () => {
        document.getElementById("day-modal").style.display = "none";
      });
    }

    const grid = document.getElementById("calendar-grid");
    if (grid) {
      let touchStartX = 0;
      let touchStartY = 0;

      grid.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      grid.addEventListener("touchend", (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) {
            calendarState.month -= 1;
            if (calendarState.month < 1) {
              calendarState.month = 12;
              calendarState.year -= 1;
            }
          } else {
            calendarState.month += 1;
            if (calendarState.month > 12) {
              calendarState.month = 1;
              calendarState.year += 1;
            }
          }
          renderCalendar();
        }
      }, { passive: true });
    }
  }
  renderCalendar();
}

async function renderCalendar() {
  const { year, month } = calendarState;

  document.getElementById("cal-title").textContent =
    `${MONTHS_RU[month - 1]} ${year}`;

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "<div class='hint' style='grid-column:1/-1;'>Загрузка…</div>";

  // Один раз подгружаем даты достижений
  if (calendarState.achievementsByDay === null) {
    try {
      const achRes = await apiFetch(`/api/achievements/dates/${userId}`);
      if (achRes.ok) {
        calendarState.achievementsByDay = await achRes.json();
      } else {
        calendarState.achievementsByDay = {};
      }
    } catch (err) {
      console.warn("Не удалось загрузить даты достижений:", err);
      calendarState.achievementsByDay = {};
    }
  }

  const cacheKey = `${year}-${String(month).padStart(2, "0")}`;
  let daysData = calendarState.cache[cacheKey];

  if (!daysData) {
    try {
      const res = await apiFetch(`/api/calendar/${userId}?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("calendar fetch failed");
      const data = await res.json();
      daysData = data.days || {};
      calendarState.cache[cacheKey] = daysData;
    } catch (err) {
      grid.innerHTML = "<div class='hint' style='grid-column:1/-1;'>Не удалось загрузить календарь</div>";
      console.error(err);
      return;
    }
  }

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();

  let startWeekday = firstDay.getDay();
  startWeekday = (startWeekday + 6) % 7;

  const today = new Date();
  const todayKey =
    today.getFullYear() === year && today.getMonth() + 1 === month
      ? today.getDate()
      : null;

  let html = "";

  for (let i = 0; i < startWeekday; i++) {
    html += `<div class="cal-cell empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const info = daysData[key] || { workouts: 0, meals: 0, photos: 0, calories: 0 };

    const hasWorkouts = info.workouts > 0;
    const hasMeals = info.meals > 0;
    const hasPhotos = info.photos > 0;
    const isToday = todayKey === day;

    const dayAchievements = (calendarState.achievementsByDay || {})[key] || [];
    const hasAchievement = dayAchievements.length > 0;

    const dots = [
      hasWorkouts ? '<span class="cal-dot workout"></span>' : "",
      hasMeals ? '<span class="cal-dot meal"></span>' : "",
      hasPhotos ? '<span class="cal-dot photo"></span>' : "",
    ].join("");

    const classes = ["cal-cell"];
    if (isToday) classes.push("today");
    if (hasWorkouts || hasMeals || hasPhotos) classes.push("has-activity");
    if (hasAchievement) classes.push("has-achievement");

    const star = hasAchievement
      ? `<div class="cal-star" title="Достижение: ${dayAchievements.length}">⭐</div>`
      : "";

    html += `
      <div class="${classes.join(" ")}" data-date="${key}">
        ${star}
        <div class="cal-num">${day}</div>
        <div class="cal-dots">${dots}</div>
      </div>
    `;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".cal-cell[data-date]").forEach(cell => {
    cell.addEventListener("click", () => {
      openDayModal(cell.dataset.date);
    });
  });
}

async function openDayModal(dateKey) {
  const modal = document.getElementById("day-modal");
  const title = document.getElementById("day-modal-title");
  const content = document.getElementById("day-modal-content");

  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  title.textContent = dt.toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  content.innerHTML = "<p class='hint'>Загрузка…</p>";
  modal.style.display = "flex";

  try {
    const res = await apiFetch(`/api/day/${userId}?date=${dateKey}`);
    if (!res.ok) throw new Error("day fetch failed");
    const data = await res.json();

    const isEmpty =
      !data.workouts.length && !data.meals.length && !data.photos.length;

    if (isEmpty) {
      content.innerHTML = "<p class='hint'>В этот день нет записей</p>";
      return;
    }

    let html = "";

    if (data.workouts.length) {
      html += `<div class="day-section">
        <h4>📝 Тренировки (${data.workouts.length})</h4>
        <ul class="day-list">`;
      data.workouts.forEach(w => {
        const isCardioEx = isCardio(w.exercise);
        const val = isCardioEx
          ? `${w.weight} мин`
          : `${w.weight}кг × ${w.reps} × ${w.sets}`;
        html += `<li><strong>${w.exercise}</strong> — ${val}</li>`;
      });
      html += `</ul></div>`;
    }

    if (data.meals.length) {
      const nt = data.nutrition_totals;
      html += `<div class="day-section">
        <h4>🍎 Питание</h4>
        <div class="day-nutrition">
          <strong>${nt.calories} ккал</strong>
          · Б ${nt.protein} · Ж ${nt.fat} · У ${nt.carbs}
        </div>
        <ul class="day-list">`;
      data.meals.forEach(m => {
        html += `<li>${m.name} — ${m.grams} г (${Math.round(m.calories)} ккал)</li>`;
      });
      html += `</ul></div>`;
    }

    if (data.photos.length) {
      html += `<div class="day-section">
        <h4>📸 Фото (${data.photos.length})</h4>
        <div class="day-photos">`;
      data.photos.forEach(p => {
        html += `
          <div class="day-photo">
            <img src="${API}${p.url}" alt="Фото" loading="lazy">
            ${p.weight != null ? `<div class="day-photo-weight">${p.weight} кг</div>` : ""}
          </div>
        `;
      });
      html += `</div></div>`;
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = "<p class='hint'>Не удалось загрузить данные дня</p>";
    console.error(err);
  }
}


// ============================================================
// ===== PUSH-УВЕДОМЛЕНИЯ =====================================
// ============================================================

let vapidPublicKeyCache = null;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
}

async function getVapidPublicKey() {
  if (vapidPublicKeyCache) return vapidPublicKeyCache;
  const res = await fetch(`${API}/api/push/public-key`);
  if (!res.ok) throw new Error("Не удалось получить VAPID-ключ");
  const data = await res.json();
  vapidPublicKeyCache = data.public_key;
  return vapidPublicKeyCache;
}

async function initNotifications() {
  const statusEl = document.getElementById("notif-status");
  const enableBtn = document.getElementById("notif-enable");
  const disableBtn = document.getElementById("notif-disable");
  const testBtn = document.getElementById("notif-test");
  const iosHint = document.getElementById("notif-ios-hint");

  if (!statusEl || !enableBtn || !disableBtn || !testBtn) return;

  // Сброс видимости
  enableBtn.style.display = "none";
  disableBtn.style.display = "none";
  testBtn.style.display = "none";
  if (iosHint) iosHint.style.display = "none";

  // Поддержка браузером
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.innerHTML = '<span class="hint">Уведомления не поддерживаются этим браузером</span>';
    return;
  }

  // iOS: проверяем, что PWA установлено
  if (isIOS() && !isStandalone()) {
    statusEl.innerHTML = '<span class="hint">На iPhone уведомления работают только в установленном приложении</span>';
    if (iosHint) iosHint.style.display = "block";
    return;
  }

  // Проверяем текущую подписку
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (sub) {
      statusEl.innerHTML = '<span class="hint" style="color:var(--accent);">✅ Уведомления включены</span>';
      disableBtn.style.display = "inline-flex";
      testBtn.style.display = "inline-flex";
    } else {
      statusEl.innerHTML = '<span class="hint">Уведомления выключены</span>';
      enableBtn.style.display = "inline-flex";
    }
  } catch (err) {
    statusEl.innerHTML = '<span class="hint">Ошибка проверки подписки</span>';
    console.warn("Notification init error:", err);
  }
}

async function enableNotifications() {
  const statusEl = document.getElementById("notif-status");
  const enableBtn = document.getElementById("notif-enable");

  if (enableBtn) {
    enableBtn.disabled = true;
    enableBtn.textContent = "Включаю...";
  }

  try {
    // 1. Разрешение
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Разрешение не выдано", "error");
      await initNotifications();
      return;
    }

    // 2. VAPID-ключ
    const publicKey = await getVapidPublicKey();

    // 3. Service Worker
    const reg = await navigator.serviceWorker.ready;

    // 4. Подписка
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // 5. Отправка на бэкенд
    const subJson = sub.toJSON();
    const res = await apiFetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: +userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      }),
    });

    if (!res.ok) throw new Error("subscribe failed");

    showToast("🔔 Уведомления включены ✓", "success");
    await initNotifications();
  } catch (err) {
    console.error("enableNotifications error:", err);
    showToast("Не удалось включить уведомления", "error");
    await initNotifications();
  } finally {
    if (enableBtn) {
      enableBtn.disabled = false;
      enableBtn.textContent = "🔔 Включить уведомления";
    }
  }
}

async function disableNotifications() {
  const disableBtn = document.getElementById("notif-disable");
  if (disableBtn) {
    disableBtn.disabled = true;
    disableBtn.textContent = "Отключаю...";
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (sub) {
      // Удаляем на бэкенде
      const subJson = sub.toJSON();
      await apiFetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: +userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys ? subJson.keys.p256dh : "",
          auth: subJson.keys ? subJson.keys.auth : "",
        }),
      });

      // Отписываемся локально
      await sub.unsubscribe();
    }

    showToast("Уведомления выключены", "success");
    await initNotifications();
  } catch (err) {
    console.error("disableNotifications error:", err);
    showToast("Не удалось выключить уведомления", "error");
    await initNotifications();
  } finally {
    if (disableBtn) {
      disableBtn.disabled = false;
      disableBtn.textContent = "🔕 Выключить";
    }
  }
}

async function sendTestNotification() {
  const testBtn = document.getElementById("notif-test");
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = "Отправляю...";
  }

  try {
    const res = await apiFetch(`/api/push/test/${userId}`, { method: "POST" });
    const data = await res.json();
    if (data.sent > 0) {
      showToast(`Тестовое уведомление отправлено (${data.sent})`, "success");
    } else {
      showToast("Не удалось отправить — подписка неактивна", "error");
    }
  } catch (err) {
    console.error("sendTestNotification error:", err);
    showToast("Ошибка отправки", "error");
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = "📤 Тестовое уведомление";
    }
  }
}

// Обработчики кнопок
document.addEventListener("click", (e) => {
  if (e.target.id === "notif-enable") enableNotifications();
  if (e.target.id === "notif-disable") disableNotifications();
  if (e.target.id === "notif-test") sendTestNotification();
});


// ============================================================
// ===== РЕЦЕПТЫ ===============================================
// ============================================================

let recipesCache = [];
let recipesFilter = "";
let currentRecipeSlug = null;

const RECIPE_CATEGORY_LABELS = {
  breakfast: "🌅 Завтрак",
  lunch: "☀️ Обед",
  dinner: "🌙 Ужин",
  snack: "🍎 Перекус",
  smoothie: "🥤 Смузи",
};

const RECIPE_TAG_LABELS = {
  high_protein: "💪 Белковое",
  low_cal: "🔥 Низкокал",
  quick: "⚡ Быстро",
  vegetarian: "🌱 Веган",
  bulk: "📈 Набор",
  cut: "✂️ Сушка",
};

async function loadRecipes(category = recipesFilter) {
  recipesFilter = category;
  const carousel = document.getElementById("recipes-carousel");
  const emptyEl = document.getElementById("recipes-empty");
  if (!carousel || !emptyEl) return;

  try {
    const url = category
      ? `${API}/api/recipes?category=${category}`
      : `${API}/api/recipes?limit=20`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("recipes fetch failed");
    recipesCache = await res.json();

    if (!recipesCache.length) {
      carousel.innerHTML = "";
      emptyEl.style.display = "block";
      emptyEl.textContent = "Нет рецептов в этой категории";
      return;
    }

    emptyEl.style.display = "none";
    renderRecipeCards(recipesCache);
  } catch (err) {
    console.warn("Не удалось загрузить рецепты:", err);
    emptyEl.style.display = "block";
    emptyEl.textContent = "Не удалось загрузить рецепты";
  }
}

function renderRecipeCards(recipes) {
  const carousel = document.getElementById("recipes-carousel");
  if (!carousel) return;

  carousel.innerHTML = recipes.map(r => `
    <div class="recipe-card" data-slug="${r.slug}">
      <div class="recipe-card-emoji">${recipeEmoji(r)}</div>
      <div class="recipe-card-body">
        <div class="recipe-card-name">${r.name}</div>
        <div class="recipe-card-meta">
          <span>${r.calories ? Math.round(r.calories) + " ккал" : ""}</span>
          ${r.time_min ? `<span>⏱ ${r.time_min} мин</span>` : ""}
        </div>
        <div class="recipe-card-macros">
          Б ${Math.round(r.protein || 0)} · Ж ${Math.round(r.fat || 0)} · У ${Math.round(r.carbs || 0)}
        </div>
      </div>
    </div>
  `).join("");

  carousel.querySelectorAll(".recipe-card").forEach(card => {
    card.addEventListener("click", () => {
      openRecipeModal(card.dataset.slug);
    });
  });
}

function recipeEmoji(r) {
  const cat = r.category;
  if (cat === "breakfast") return "🌅";
  if (cat === "lunch") return "☀️";
  if (cat === "dinner") return "🌙";
  if (cat === "snack") return "🍎";
  if (cat === "smoothie") return "🥤";
  return "🍽";
}

async function openRecipeModal(slug) {
  const modal = document.getElementById("recipe-modal");
  if (!modal) return;

  currentRecipeSlug = slug;

  const titleEl = document.getElementById("recipe-modal-title");
  const metaEl = document.getElementById("recipe-modal-meta");
  const tagsEl = document.getElementById("recipe-modal-tags");
  const ingEl = document.getElementById("recipe-modal-ingredients");
  const stepsEl = document.getElementById("recipe-modal-steps");

  // Сброс
  titleEl.textContent = "Загрузка…";
  metaEl.innerHTML = "";
  tagsEl.innerHTML = "";
  ingEl.innerHTML = "";
  stepsEl.innerHTML = "";
  modal.style.display = "flex";

  try {
    const res = await fetch(`${API}/api/recipes/${slug}`);
    if (!res.ok) throw new Error("recipe fetch failed");
    const r = await res.json();

    titleEl.textContent = r.name;

    metaEl.innerHTML = `
      <span>${RECIPE_CATEGORY_LABELS[r.category] || r.category}</span>
      ${r.time_min ? `<span>⏱ ${r.time_min} мин</span>` : ""}
      ${r.servings > 1 ? `<span>🍽 ${r.servings} порц.</span>` : ""}
    `;

    tagsEl.innerHTML = (r.tags || []).map(t =>
      `<span class="recipe-tag">${RECIPE_TAG_LABELS[t] || t}</span>`
    ).join("");

    ingEl.innerHTML = (r.ingredients || []).map(i =>
      `<li><span>${i.name}</span><span class="recipe-ing-grams">${i.grams} г</span></li>`
    ).join("");

    stepsEl.innerHTML = (r.steps || []).map(s =>
      `<li>${s}</li>`
    ).join("");

    // Запоминаем КБЖУ для кнопки «Добавить в дневник»
    modal.dataset.calories = r.calories || 0;
    modal.dataset.protein = r.protein || 0;
    modal.dataset.fat = r.fat || 0;
    modal.dataset.carbs = r.carbs || 0;
    modal.dataset.recipeName = r.name;
  } catch (err) {
    titleEl.textContent = "Ошибка загрузки";
    console.warn("openRecipeModal error:", err);
  }
}

function closeRecipeModal() {
  const modal = document.getElementById("recipe-modal");
  if (modal) modal.style.display = "none";
  currentRecipeSlug = null;
}

function addRecipeToDiary() {
  const modal = document.getElementById("recipe-modal");
  if (!modal) return;

  const name = modal.dataset.recipeName || "Рецепт FitSolo";
  const calories = +modal.dataset.calories || 0;
  const protein = +modal.dataset.protein || 0;
  const fat = +modal.dataset.fat || 0;
  const carbs = +modal.dataset.carbs || 0;

  // Заполняем форму приёма пищи
  const form = document.getElementById("meal-form");
  if (!form) return;

  form.name.value = name;
  form.grams.value = 100;
  form.calories.value = calories;
  form.protein.value = protein;
  form.fat.value = fat;
  form.carbs.value = carbs;

  // Обнуляем data-base, чтобы recalcMacros не сбивал
  form.calories.dataset.base = calories;
  form.protein.dataset.base = protein;
  form.fat.dataset.base = fat;
  form.carbs.dataset.base = carbs;

  closeRecipeModal();

  // Скролл к форме
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => form.grams.focus(), 300);

  showToast("Рецепт добавлен в форму ✓", "success");
}

// Обработчики
document.addEventListener("click", (e) => {
  // Кнопка «Все →»
  if (e.target.id === "recipes-all-btn") {
    // Показываем все — сбрасываем фильтр
    document.querySelectorAll(".recipe-filter-chip").forEach(ch => ch.classList.remove("active"));
    const allChip = document.querySelector('.recipe-filter-chip[data-cat=""]');
    if (allChip) allChip.classList.add("active");
    loadRecipes("");
    return;
  }

  // Кнопка фильтра
  const chip = e.target.closest(".recipe-filter-chip");
  if (chip) {
    document.querySelectorAll(".recipe-filter-chip").forEach(ch => ch.classList.remove("active"));
    chip.classList.add("active");
    loadRecipes(chip.dataset.cat);
    return;
  }

  // Закрытие модалки
  if (e.target.id === "recipe-modal-close") {
    closeRecipeModal();
    return;
  }

  // Кнопка «Добавить в дневник»
  if (e.target.id === "recipe-add-to-diary") {
    addRecipeToDiary();
    return;
  }
});

// Закрытие модалки по клику вне карточки
document.addEventListener("click", (e) => {
  const modal = document.getElementById("recipe-modal");
  if (modal && modal.style.display === "flex" && e.target === modal) {
    closeRecipeModal();
  }
});