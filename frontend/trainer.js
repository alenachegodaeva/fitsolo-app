// ============================================================
// ===== TRAINER.JS — работа с клиентами для тренера ==========
// ============================================================

(function () {
  'use strict';

  let clientsCache = [];
  let currentClientId = null;

  // ===== УТИЛИТЫ =====
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ===== ЗАГРУЗКА СПИСКА КЛИЕНТОВ =====
  async function loadClients() {
    const listEl = $('clients-list');
    const emptyEl = $('clients-empty');
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = "<p class='hint'>Загрузка…</p>";
    emptyEl.style.display = 'none';

    try {
      const res = await apiFetch('/api/trainer/clients');
      if (!res.ok) throw new Error('fetch failed');
      clientsCache = await res.json();

      if (!clientsCache.length) {
        listEl.innerHTML = '';
        emptyEl.style.display = 'block';
        return;
      }

      listEl.innerHTML = clientsCache.map(c => `
        <div class="client-card" data-id="${c.id}">
          <div class="client-card-main">
            <div class="client-name">${escapeHtml(c.name)}</div>
            <div class="client-meta">
              ${c.goal ? `🎯 ${escapeHtml(c.goal)}` : ''}
              ${c.weight ? ` · ⚖️ ${c.weight} кг` : ''}
              ${c.age ? ` · ${c.age} лет` : ''}
            </div>
            ${c.phone ? `<div class="client-phone">📞 ${escapeHtml(c.phone)}</div>` : ''}
            ${c.last_note_date ? `<div class="client-last-note">📝 ${formatDate(c.last_note_date)}: ${escapeHtml((c.last_note_text || '').slice(0, 60))}${(c.last_note_text || '').length > 60 ? '…' : ''}</div>` : ''}
          </div>
          ${c.status === 'archived' ? '<div class="client-badge">архив</div>' : ''}
        </div>
      `).join('');

      listEl.querySelectorAll('.client-card').forEach(card => {
        card.addEventListener('click', () => openClientDetails(+card.dataset.id));
      });
    } catch (err) {
      listEl.innerHTML = "<p class='hint'>Не удалось загрузить клиентов</p>";
      console.error('loadClients error:', err);
    }
  }

  // ===== ОТКРЫТИЕ МОДАЛКИ НОВОГО КЛИЕНТА =====
  function openNewClientModal() {
    const modal = $('client-modal');
    const title = $('client-modal-title');
    const form = $('client-form');
    if (!modal || !form) return;

    title.textContent = '👥 Новый клиент';
    form.reset();
    form.client_id.value = '';
    modal.style.display = 'flex';
    setTimeout(() => form.name.focus(), 100);
  }

  // ===== ОТКРЫТИЕ МОДАЛКИ РЕДАКТИРОВАНИЯ =====
  function openEditClientModal(client) {
    const modal = $('client-modal');
    const title = $('client-modal-title');
    const form = $('client-form');
    if (!modal || !form) return;

    title.textContent = '✏️ Редактировать клиента';
    form.client_id.value = client.id;
    form.name.value = client.name || '';
    form.phone.value = client.phone || '';
    form.email.value = client.email || '';
    form.goal.value = client.goal || '';
    form.age.value = client.age || '';
    form.height.value = client.height || '';
    form.weight.value = client.weight || '';
    form.notes.value = client.notes || '';
    modal.style.display = 'flex';
  }

  // ===== СОХРАНЕНИЕ КЛИЕНТА =====
  async function saveClient(e) {
    e.preventDefault();
    const form = e.target;
    const clientId = form.client_id.value;

    const body = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim() || null,
      email: form.email.value.trim() || null,
      goal: form.goal.value.trim() || null,
      age: form.age.value ? +form.age.value : null,
      height: form.height.value ? +form.height.value : null,
      weight: form.weight.value ? +form.weight.value : null,
      notes: form.notes.value.trim() || null,
    };

    if (!body.name) {
      showToast('Имя обязательно', 'error');
      return;
    }

    try {
      const url = clientId
        ? `/api/trainer/clients/${clientId}`
        : '/api/trainer/clients';
      const method = clientId ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('save failed');

      showToast(clientId ? 'Клиент обновлён ✓' : 'Клиент добавлен ✓', 'success');
      $('client-modal').style.display = 'none';
      await loadClients();
    } catch (err) {
      showToast('Не удалось сохранить', 'error');
      console.error('saveClient error:', err);
    }
  }

  // ===== ДЕТАЛИ КЛИЕНТА (открытие модалки) =====
  async function openClientDetails(clientId) {
    try {
      const res = await apiFetch(`/api/trainer/clients/${clientId}`);
      if (!res.ok) throw new Error('fetch failed');
      const client = await res.json();
      currentClientId = clientId;

      // Открываем "свою" модалку или создаём на лету
      let modal = $('client-details-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'client-details-modal';
        modal.className = 'modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
          <div class="modal-card" style="max-width:640px;">
            <button id="client-details-close" class="modal-close">✕</button>
            <div id="client-details-content"></div>
          </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#client-details-close').addEventListener('click', () => {
          modal.style.display = 'none';
        });
        modal.addEventListener('click', (e) => {
          if (e.target === modal) modal.style.display = 'none';
        });
      }

      renderClientDetails(client);
      modal.style.display = 'flex';
    } catch (err) {
      showToast('Не удалось загрузить клиента', 'error');
      console.error('openClientDetails error:', err);
    }
  }

  // ===== РЕНДЕР ДЕТАЛЕЙ КЛИЕНТА =====
  function renderClientDetails(client) {
    const el = $('client-details-content');
    if (!el) return;

    el.innerHTML = `
      <h3>${escapeHtml(client.name)}</h3>
      <div class="client-details-meta">
        ${client.goal ? `<span>🎯 ${escapeHtml(client.goal)}</span>` : ''}
        ${client.age ? `<span>${client.age} лет</span>` : ''}
        ${client.weight ? `<span>⚖️ ${client.weight} кг</span>` : ''}
        ${client.height ? `<span>📏 ${client.height} см</span>` : ''}
      </div>
      ${client.phone ? `<div class="client-details-line">📞 ${escapeHtml(client.phone)}</div>` : ''}
      ${client.email ? `<div class="client-details-line">✉️ ${escapeHtml(client.email)}</div>` : ''}
      ${client.notes ? `<div class="client-details-notes">${escapeHtml(client.notes)}</div>` : ''}

      <div class="client-details-actions">
        <button id="client-edit-btn" class="btn-secondary" type="button">✏️ Редактировать</button>
        <button id="client-delete-btn" class="btn-secondary danger" type="button">🗑 Удалить</button>
      </div>

      <h4 style="margin-top:20px;">📝 Заметки</h4>
      <form id="client-note-form" class="client-note-form">
        <textarea name="text" placeholder="Добавить заметку..." rows="2" required></textarea>
        <button type="submit">+ Добавить</button>
      </form>
      <div id="client-notes-list"></div>

      <h4 style="margin-top:20px;">📊 Замеры</h4>
      <form id="client-measurement-form" class="client-measurement-form">
        <div class="row">
          <input name="weight" type="number" step="0.1" placeholder="Вес">
          <input name="chest" type="number" step="0.1" placeholder="Грудь">
          <input name="waist" type="number" step="0.1" placeholder="Талия">
        </div>
        <div class="row">
          <input name="hips" type="number" step="0.1" placeholder="Бёдра">
          <input name="arm" type="number" step="0.1" placeholder="Рука">
          <input name="leg" type="number" step="0.1" placeholder="Нога">
        </div>
        <button type="submit">+ Добавить замер</button>
      </form>
      <div id="client-measurements-list"></div>
    `;

    // Кнопки
    el.querySelector('#client-edit-btn').addEventListener('click', () => {
      $('client-details-modal').style.display = 'none';
      openEditClientModal(client);
    });

    el.querySelector('#client-delete-btn').addEventListener('click', async () => {
      if (!confirm(`Удалить клиента «${client.name}»? Все заметки и замеры будут удалены.`)) return;
      try {
        const res = await apiFetch(`/api/trainer/clients/${client.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete failed');
        showToast('Клиент удалён', 'success');
        $('client-details-modal').style.display = 'none';
        await loadClients();
      } catch (err) {
        showToast('Не удалось удалить', 'error');
      }
    });

    // Формы
    el.querySelector('#client-note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      try {
        const res = await apiFetch(`/api/trainer/clients/${client.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('save failed');
        e.target.reset();
        showToast('Заметка добавлена ✓', 'success');
        await openClientDetails(client.id);
      } catch (err) {
        showToast('Не удалось добавить заметку', 'error');
      }
    });

    el.querySelector('#client-measurement-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        weight: f.weight.value ? +f.weight.value : null,
        chest: f.chest.value ? +f.chest.value : null,
        waist: f.waist.value ? +f.waist.value : null,
        hips: f.hips.value ? +f.hips.value : null,
        arm: f.arm.value ? +f.arm.value : null,
        leg: f.leg.value ? +f.leg.value : null,
      };
      if (!Object.values(body).some(v => v != null)) {
        showToast('Заполни хотя бы одно поле', 'error');
        return;
      }
      try {
        const res = await apiFetch(`/api/trainer/clients/${client.id}/measurements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('save failed');
        f.reset();
        showToast('Замер добавлен ✓', 'success');
        await openClientDetails(client.id);
      } catch (err) {
        showToast('Не удалось добавить замер', 'error');
      }
    });

    // Рендерим списки
    renderNotes(client.notes_list || []);
    renderMeasurements(client.measurements || []);
  }

  function renderNotes(notes) {
    const el = $('client-notes-list');
    if (!el) return;
    if (!notes.length) {
      el.innerHTML = "<p class='hint'>Заметок пока нет</p>";
      return;
    }
    el.innerHTML = notes.map(n => `
      <div class="client-note-item">
        <div class="client-note-date">${formatDate(n.date)}</div>
        <div class="client-note-text">${escapeHtml(n.text)}</div>
        <button class="client-note-del" data-id="${n.id}" type="button">✕</button>
      </div>
    `).join('');

    el.querySelectorAll('.client-note-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить заметку?')) return;
        try {
          const res = await apiFetch(`/api/trainer/notes/${btn.dataset.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
          showToast('Заметка удалена', 'success');
          await openClientDetails(currentClientId);
        } catch (err) {
          showToast('Не удалось удалить', 'error');
        }
      });
    });
  }

  function renderMeasurements(measurements) {
    const el = $('client-measurements-list');
    if (!el) return;
    if (!measurements.length) {
      el.innerHTML = "<p class='hint'>Замеров пока нет</p>";
      return;
    }

    el.innerHTML = `
      <table class="measurements-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Вес</th>
            <th>Грудь</th>
            <th>Талия</th>
            <th>Бёдра</th>
            <th>Рука</th>
            <th>Нога</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${measurements.map(m => `
            <tr>
              <td>${formatDate(m.date)}</td>
              <td>${m.weight ?? '—'}</td>
              <td>${m.chest ?? '—'}</td>
              <td>${m.waist ?? '—'}</td>
              <td>${m.hips ?? '—'}</td>
              <td>${m.arm ?? '—'}</td>
              <td>${m.leg ?? '—'}</td>
              <td><button class="meas-del" data-id="${m.id}" type="button">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    el.querySelectorAll('.meas-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить замер?')) return;
        try {
          const res = await apiFetch(`/api/trainer/measurements/${btn.dataset.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
          showToast('Замер удалён', 'success');
          await openClientDetails(currentClientId);
        } catch (err) {
          showToast('Не удалось удалить', 'error');
        }
      });
    });
  }

  // ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
  document.addEventListener('click', (e) => {
    if (e.target.id === 'client-add-btn') {
      openNewClientModal();
      return;
    }
    if (e.target.id === 'client-modal-close') {
      $('client-modal').style.display = 'none';
      return;
    }
    const clientTab = e.target.closest('.tab[data-tab="clients"]');
    if (clientTab) {
      loadClients();
      return;
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'client-form') {
      saveClient(e);
    }
  });

  // Экспортируем
  window.loadClients = loadClients;
})();