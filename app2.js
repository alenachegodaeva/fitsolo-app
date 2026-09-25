const API = "https://103.76.53.84.nip.io";
let userId = localStorage.getItem("userId");
let chatHistory = [];
let statsCharts = [];
// ===== PWA: Установка на телефон =====
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstallButton();
});

function showInstallButton() {
  if (document.getElementById('install-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'install-btn';
  btn.className = 'btn-secondary';
  btn.textContent = '📲 Установить приложение';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:1000;';
  btn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') btn.remove();
    deferredPrompt = null;
  };
  document.body.appendChild(btn);
}

window.addEventListener('appinstalled', () => {
  console.log('PWA установлено');
  const btn = document.getElementById('install-btn');
  if (btn) btn.remove();
});

// ===== Онлайн/офлайн статус =====
window.addEventListener('online', () => {
  document.body.style.filter = '';
});
window.addEventListener('offline', () => {
  document.body.style.filter = 'grayscale(0.5)';
  console.log('Офлайн — показываем кэш');
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
  // Обновить графики под новую тему
  if (statsCharts.length) loadStats();
});

// ===== ОНБОРДИНГ =====
document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const equipment = [...f.querySelectorAll('fieldset:nth-of-type(1) input:checked')].map(i => i.value);
  const injuries  = [...f.querySelectorAll('fieldset:nth-of-type(2) input:checked')].map(i => i.value);

  const profile = {
    name: f.name.value,
    gender: f.gender.value,
    age: +f.age.value,
    weight: +f.weight.value,
    height: +f.height.value,
    experience: f.experience.value,
    goal: f.goal.value,
    days_per_week: +f.days_per_week.value,
    equipment, injuries,
  };

  try {
    const res = await fetch(`${API}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    userId = data.user_id;
    localStorage.setItem("userId", userId);
    showMain();
  } catch (err) {
    alert("Ошибка соединения с сервером. Проверь, что бэкенд запущен.");
  }
});

// ===== ПОКАЗ ЭКРАНОВ =====
async function showMain() {
  document.getElementById("onboarding").classList.remove("active");
  document.getElementById("main").classList.add("active");
  await loadProfileName();
  loadPlan();
  loadLogs();
  loadChatHistory();
}

async function loadProfileName() {
  try {
    const res = await fetch(`${API}/api/profile/${userId}`);
    const p = await res.json();
    document.getElementById("profile-name").textContent = `👤 ${p.name}`;
  } catch (err) {
    document.getElementById("profile-name").textContent = "👤 Профиль";
  }
}

// Кнопка "Изменить профиль"
document.getElementById("edit-profile").addEventListener("click", () => {
  if (confirm("Изменить профиль? Потребуется заполнить анкету заново.")) {
    localStorage.removeItem("userId");
    location.reload();
  }
});

if (userId) showMain();

// ===== ТАБЫ =====
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    document.getElementById(`tab-${t.dataset.tab}`).classList.add("active");
    if (t.dataset.tab === "stats") loadStats();
    if (t.dataset.tab === "nutrition") loadNutrition();
  });
});

// ===== ПРОГРАММА =====
let currentPlan = null;

async function loadPlan() {
  try {
    const res = await fetch(`${API}/api/plan/${userId}`);
    currentPlan = await res.json();
    localStorage.setItem('cachedPlan', JSON.stringify(currentPlan));
  } catch (err) {
    const cached = localStorage.getItem('cachedPlan');
    if (cached) {
      currentPlan = JSON.parse(cached);
      console.log('Показываем программу из кэша');
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
}

function formatSplit(split) {
  const map = {
    "full_body": "фулбоди",
    "upper_lower": "верх/низ",
    "push_pull_legs": "push/pull/legs",
  };
  return map[split] || split;
}

// ===== КНОПКА "ПЕРЕСОЗДАТЬ" =====
document.getElementById("regen-btn").addEventListener("click", () => {
  if (confirm("Пересоздать программу? Текущая будет заменена.")) {
    loadPlan();
  }
});

// ===== ЭКСПОРТ PDF =====
document.getElementById("export-btn").addEventListener("click", () => {
  if (!currentPlan) return;
  const w = window.open("", "_blank");
  const html = `
    <html><head><title>FitSolo — программа</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 30px; line-height: 1.5; }
      h1 { color: #4caf50; }
      .day { margin-bottom: 30px; page-break-inside: avoid; }
      .day h2 { color: #1a2332; border-bottom: 2px solid #4caf50; padding-bottom: 6px; }
      .ex { margin: 8px 0; padding: 8px; background: #f5f7fa; border-radius: 6px; }
      .ex strong { color: #1a2332; }
      .meta { color: #5a6b7d; font-size: 13px; }
      .desc { color: #5a6b7d; font-size: 12px; font-style: italic; margin-top: 4px; }
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

// ===== ИИ-ЧАТ =====
// ===== ИСТОРИЯ ЧАТА =====
async function loadChatHistory() {
  if (!userId) return;
  try {
    const res = await fetch(`${API}/api/chat/history/${userId}`);
    const history = await res.json();
    const box = document.getElementById("chat-messages");
    box.innerHTML = "";
    chatHistory = [];
    history.forEach(m => {
      addMsg(m.content, m.role === "user" ? "user" : "ai");
      chatHistory.push({ role: m.role, content: m.content });
    });
  } catch (err) {
    console.error("Не удалось загрузить историю чата:", err);
  }
}

async function clearChatHistory() {
  if (!userId) return;
  if (!confirm("Очистить всю историю чата с тренером?")) return;
  try {
    await fetch(`${API}/api/chat/history/${userId}`, { method: "DELETE" });
    document.getElementById("chat-messages").innerHTML = "";
    chatHistory = [];
    addMsg("История очищена. Задай новый вопрос! 💪", "ai");
  } catch (err) {
    alert("Не удалось очистить историю");
  }
}
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
    const res = await fetch(`${API}/api/chat`, {
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
  await fetch(`${API}/api/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: +userId,
      exercise: f.exercise.value,
      weight: +f.weight.value,
      reps: +f.reps.value,
      sets: +f.sets.value,
    }),
  });
  f.reset();
  loadLogs();
});

async function loadLogs() {
  const res = await fetch(`${API}/api/logs/${userId}`);
  const logs = await res.json();
  document.getElementById("logs-list").innerHTML = logs.map(l => `
    <div class="log-item">
      <div>
        <strong>${l.exercise}</strong> — ${l.weight}кг × ${l.reps} × ${l.sets}
        <small>${new Date(l.date).toLocaleDateString("ru-RU")}</small>
      </div>
      <button class="log-delete" data-id="${l.id}" title="Удалить">✕</button>
    </div>
  `).join("") || "<p class='hint'>Пока нет записей</p>";

  document.querySelectorAll(".log-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Удалить запись?")) {
        await fetch(`${API}/api/log/${btn.dataset.id}`, { method: "DELETE" });
        loadLogs();
      }
    });
  });
}

// ===== СТАТИСТИКА =====
async function loadStats() {
  const res = await fetch(`${API}/api/stats/${userId}`);
  const stats = await res.json();
  const el = document.getElementById("stats-content");

  // Уничтожить старые графики
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
        <span class="stat-max">${s.max_weight} кг</span>
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
          label: "Вес (кг)",
          data: s.history.map(h => h.weight),
          borderColor: accent,
          backgroundColor: accent + "33",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: accent,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: textColor }, grid: { display: false } },
          y: { ticks: { color: textColor }, grid: { color: textColor + "22" } }
        }
      }
    });
    statsCharts.push(chart);
  });
}
  // ===== ПИТАНИЕ =====
async function loadNutrition() {
  if (!userId) return;
  try {
    const res = await fetch(`${API}/api/nutrition/${userId}`);
    const n = await res.json();
    const el = document.getElementById("nutrition-norm");
    el.innerHTML = `
      <div class="kbju-grid">
        <div class="kbju-card"><div class="label">Калории</div><div class="value cal">${n.target_calories}</div></div>
        <div class="kbju-card"><div class="label">Белки</div><div class="value protein">${n.protein} г</div></div>
        <div class="kbju-card"><div class="label">Жиры</div><div class="value fat">${n.fat} г</div></div>
        <div class="kbju-card"><div class="label">Углеводы</div><div class="value carbs">${n.carbs} г</div></div>
      </div>
    `;
  } catch (err) {
    console.error("Не удалось загрузить норму КБЖУ:", err);
  }
}

async function loadMeals() {
  if (!userId) return;
  try {
    const res = await fetch(`${API}/api/meals/${userId}`);
    const meals = await res.json();

    // считаем сумму за сегодня
    const today = new Date().toDateString();
    const todayMeals = meals.filter(m => new Date(m.date).toDateString() === today);
    const total = todayMeals.reduce((acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
      fat: acc.fat + (m.fat || 0),
      carbs: acc.carbs + (m.carbs || 0),
    }), { calories: 0, protein: 0, fat: 0, carbs: 0 });

    // норма
    const normRes = await fetch(`${API}/api/nutrition/${userId}`);
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
          await fetch(`${API}/api/meal/${btn.dataset.id}`, { method: "DELETE" });
          loadMeals();
        }
      });
    });
  } catch (err) {
    console.error("Не удалось загрузить приёмы пищи:", err);
  }
}

// обработчик формы еды
// ===== ПОИСК ПРОДУКТОВ =====
const foodSearchInput = document.getElementById("food-search");
const foodDropdown = document.getElementById("food-dropdown");
let searchTimer = null;

foodSearchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = foodSearchInput.value.trim();
  if (q.length < 2) {
    foodDropdown.innerHTML = "";
    return;
  }
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
    } catch (err) {
      console.error("Поиск продуктов не удался:", err);
    }
  }, 250);
});

// Клик вне поля — закрыть подсказки
document.addEventListener("click", (e) => {
  if (!e.target.closest(".food-search-wrap")) {
    foodDropdown.innerHTML = "";
  }
});

function pickFood(ds) {
  const form = document.getElementById("meal-form");
  form.name.value = ds.name;
  form.grams.value = 100;
  form.calories.value = ds.cal;
  form.protein.value = ds.p;
  form.fat.value = ds.f;
  form.carbs.value = ds.c;

  // Сохраняем базовые значения (на 100 г) для пересчёта
  form.calories.dataset.base = ds.cal;
  form.protein.dataset.base = ds.p;
  form.fat.dataset.base = ds.f;
  form.carbs.dataset.base = ds.c;

  foodSearchInput.value = "";
  foodDropdown.innerHTML = "";}
  // Пересчёт КБЖУ при изменении граммов
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
  await fetch(`${API}/api/meal`, {
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
});
// ===== КНОПКА "ИЗМЕНИТЬ ПРОФИЛЬ" =====
document.getElementById("edit-profile").addEventListener("click", () => {
  if (confirm("Изменить профиль? Потребуется заполнить анкету заново.")) {
    localStorage.removeItem("userId");
    location.reload();
  }
});
