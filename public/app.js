let state = {
  mode: 'employe', // 'employe' | 'gerant'
  view: 'staff', // 'staff' | 'client'
  tab: 'salles',
  config: null,
  bookings: [],
  modal: null,
  loading: true,
  managerPin: null, // gardé en mémoire seulement après vérification
  clientMsg: null,
  clientActiveBookingId: null,
  caisseDate: new Date().toISOString().slice(0, 10),
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || 'Erreur serveur');
  return data;
}

async function loadState() {
  try {
    if (state.mode === 'gerant' && state.managerPin) {
      const data = await api(`/api/admin/state?pin=${encodeURIComponent(state.managerPin)}`);
      state.config = data.config;
      state.bookings = data.bookings;
    } else {
      const data = await api('/api/state');
      state.config = data.config;
      state.bookings = data.bookings;
    }
  } catch (e) {
    console.error('Erreur de chargement', e);
  }
}

async function refreshAndRender() {
  await loadState();
  state.loading = false;
  render();
}

function formatMoney(n) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA'; }
function pad(n) { return n.toString().padStart(2, '0'); }
function formatClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function formatDT(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function formatTimeOnly(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Doit rester cohérent avec la logique du serveur (server.js / computeBilling)
function computeBillingPreview(startISO, endISO, rate, dailyRate) {
  const ms = new Date(endISO) - new Date(startISO);
  let minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes <= 70) return { minutes, amount: rate * 1, label: '1 heure' };
  if (minutes <= 130) return { minutes, amount: rate * 2, label: '2 heures' };
  if (minutes <= 190) return { minutes, amount: rate * 3 * 0.8, label: '3 heures (-20%)' };
  const amount = dailyRate && dailyRate > 0 ? dailyRate : rate * 3 * 0.8;
  return { minutes, amount, label: dailyRate && dailyRate > 0 ? 'Tarif journalier' : '3h (-20%) — tarif journalier non configuré' };
}

function activeForRoom(roomId) {
  return state.bookings.find(b => b.roomId === roomId && (b.status === 'en_cours' || b.status === 'en_attente')) || null;
}

// ---------- Actions ----------

function openModal(type, payload) { state.modal = { type, payload: payload || {} }; render(); }
function closeModal() { state.modal = null; render(); }

function startTicketFlow(roomId) {
  const room = state.config.rooms.find(r => r.id === roomId);
  openModal('start', { roomId, roomName: room.name });
}

async function confirmIssueTicket(roomId, employeeId, client) {
  try {
    const booking = await api('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, employeeId, client }),
    });
    await loadState();
    openModal('ticket-created', { booking });
  } catch (e) { alert(e.message); }
}

async function cancelPendingTicket(bookingId) {
  try {
    await api(`/api/tickets/${bookingId}/cancel`, { method: 'POST' });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}

function endBookingFlow(bookingId) {
  const booking = state.bookings.find(b => b.id === bookingId);
  openModal('end', { bookingId, booking });
}

async function confirmEnd(bookingId, employeeId, paid, paymentMethod) {
  try {
    const finished = await api(`/api/bookings/${bookingId}/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, paid, paymentMethod }),
    });
    await loadState();
    openModal('receipt', { booking: finished });
  } catch (e) { alert(e.message); }
}

async function cancelBookingGerant(bookingId, reason) {
  try {
    await api(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, pin: state.managerPin }),
    });
    closeModal();
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}

async function togglePaid(bookingId) {
  try {
    await api(`/api/bookings/${bookingId}/toggle-paid`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}

async function tryEnterGerant(pin) {
  try {
    await api('/api/gerant/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    state.managerPin = pin;
    state.mode = 'gerant';
    state.tab = 'salles';
    closeModal();
    await refreshAndRender();
  } catch (e) {
    alert('Code incorrect.');
  }
}

function exitGerant() {
  state.mode = 'employe';
  state.managerPin = null;
  state.tab = 'salles';
  refreshAndRender();
}

function openClientView() { state.view = 'client'; state.clientMsg = null; state.clientActiveBookingId = null; render(); }
function closeClientView() { state.view = 'staff'; refreshAndRender(); }

async function submitClientCode(codeRaw) {
  const code = (codeRaw || '').trim();
  try {
    const booking = await api('/api/tickets/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    state.clientMsg = { type: 'success', text: `Session démarrée pour ${booking.roomName} à ${formatTimeOnly(booking.startTime)}.` };
    state.clientActiveBookingId = booking.id;
    state.bookings = state.bookings.filter(b => b.id !== booking.id).concat(booking);
    render();
  } catch (e) {
    state.clientMsg = { type: 'error', text: e.message };
    render();
  }
}

// Config
async function addRoom(name, rate, dailyRate) {
  try {
    await api('/api/config/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rate, dailyRate, pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function removeRoom(id) {
  try {
    await api(`/api/config/rooms/${id}?pin=${encodeURIComponent(state.managerPin)}`, { method: 'DELETE' });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function updateRoomRate(id, rate, dailyRate) {
  try {
    await api(`/api/config/rooms/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate, dailyRate, pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function addEmployee(name) {
  if (!name.trim()) return;
  try {
    await api('/api/config/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function removeEmployee(id) {
  try {
    await api(`/api/config/employees/${id}?pin=${encodeURIComponent(state.managerPin)}`, { method: 'DELETE' });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function changePin(newPin) {
  try {
    await api('/api/config/pin', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPin: state.managerPin, newPin }),
    });
    state.managerPin = newPin;
    alert('Code Gérant mis à jour.');
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function changeCenterName(name) {
  try {
    await api('/api/config/center-name', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}
async function exportBackup() {
  try {
    const res = await fetch(`/api/admin/export?pin=${encodeURIComponent(state.managerPin)}`);
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Erreur serveur'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registre-locations-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Échec du téléchargement : ' + e.message); }
}

function importBackupFromFile(file) {
  if (!file) { alert('Choisissez un fichier de sauvegarde.'); return; }
  if (!confirm('Cette action va REMPLACER toutes les données actuelles par celles du fichier sélectionné. Continuer ?')) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      await api('/api/admin/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: state.managerPin, data }),
      });
      alert('Données restaurées avec succès.');
      await refreshAndRender();
    } catch (e) { alert('Échec de la restauration : ' + e.message); }
  };
  reader.readAsText(file);
}

async function changeTicketValidity(minutes) {
  try {
    await api('/api/config/ticket-validity', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes, pin: state.managerPin }),
    });
    await refreshAndRender();
  } catch (e) { alert(e.message); }
}

// ---------- Render ----------

function render() {
  const app = document.getElementById('app');
  if (state.loading) { app.innerHTML = '<div class="empty">Chargement…</div>'; return; }
  if (state.view === 'client') {
    app.innerHTML = renderClientView();
    attachHandlers();
    return;
  }
  app.innerHTML = `
    ${renderHeader()}
    ${renderTabs()}
    <div>${renderTabContent()}</div>
    ${state.modal ? renderModal() : ''}
  `;
  attachHandlers();
}

function renderHeader() {
  return `
    <header>
      <div>
        <div class="title">${escapeHtml(state.config.centerName)}</div>
        <div class="subtitle">Registre des locations horaires</div>
      </div>
      <div class="mode-box">
        <button class="btn ghost small" data-act="open-client">📱 Espace client</button>
        <span class="badge ${state.mode === 'gerant' ? 'gerant' : 'employe'}">${state.mode === 'gerant' ? '🔓 Mode Gérant' : 'Mode Employé'}</span>
        ${state.mode === 'gerant'
          ? `<button class="btn ghost small" data-act="exit-gerant">Quitter</button>`
          : `<button class="btn ghost small" data-act="open-pin">Mode Gérant</button>`}
      </div>
    </header>
  `;
}

function renderTabs() {
  const tabsEmploye = [['salles', 'Salles'], ['historique', 'Historique du jour']];
  const tabsGerant = [['salles', 'Salles'], ['historique', 'Historique'], ['caisse', 'Clôture de caisse'], ['rapports', 'Rapports'], ['journal', 'Journal'], ['config', 'Configuration']];
  const tabs = state.mode === 'gerant' ? tabsGerant : tabsEmploye;
  return `<div class="tabs">${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>`;
}

function renderTabContent() {
  if (state.tab === 'salles') return renderSalles();
  if (state.tab === 'historique') return renderHistorique();
  if (state.tab === 'caisse' && state.mode === 'gerant') return renderCaisse();
  if (state.tab === 'rapports' && state.mode === 'gerant') return renderRapports();
  if (state.tab === 'journal' && state.mode === 'gerant') return renderJournal();
  if (state.tab === 'config' && state.mode === 'gerant') return renderConfig();
  return renderSalles();
}

function renderSalles() {
  let banner = '';
  if (state.config.employees.length === 0) {
    banner += `<div class="banner">Aucun employé n'est configuré. Passez en Mode Gérant → Configuration pour en ajouter avant d'émettre un ticket.</div>`;
  }
  banner += `<div class="code-note">Le chrono ne démarre que lorsque le client saisit son code dans l'Espace client. Tant que le code n'est pas activé, la salle reste en attente et rien n'est facturé.</div>`;
  return banner + roomsGrid();
}

function roomsGrid() {
  if (state.config.rooms.length === 0) return `<div class="empty">Aucune salle configurée.</div>`;
  return `<div class="rooms-grid">${state.config.rooms.map(room => {
    const b = activeForRoom(room.id);
    if (!b) {
      return `
      <div class="room-card">
        <div class="rname">${escapeHtml(room.name)}</div>
        <div class="rrate">${formatMoney(room.rate)} / heure</div>
        <div class="status-pill free">Libre</div>
        <div class="actions"><button class="btn small" data-act="start" data-room="${room.id}">Émettre un ticket</button></div>
      </div>`;
    }
    if (b.status === 'en_attente') {
      return `
      <div class="room-card pending">
        <div class="rname">${escapeHtml(room.name)}</div>
        <div class="rrate">${formatMoney(room.rate)} / heure</div>
        <div class="status-pill wait">Ticket #${String(b.ticketNumber || '-').padStart(4, '0')} en attente</div>
        <div class="code-display">${b.code}</div>
        <div class="meta-line">Client : ${escapeHtml(b.client)}</div>
        <div class="meta-line">Émis par ${escapeHtml(b.employeeName)} — expire à ${formatTimeOnly(b.ticketExpiresAt)}</div>
        <div class="actions">
          <button class="btn ghost small" data-act="cancel-ticket" data-booking="${b.id}">Annuler le ticket</button>
        </div>
      </div>`;
    }
    const elapsed = Date.now() - new Date(b.startTime).getTime();
    const preview = computeBillingPreview(b.startTime, new Date().toISOString(), b.rate, b.dailyRate);
    return `
      <div class="room-card occupied">
        <div class="rname">${escapeHtml(room.name)}</div>
        <div class="rrate">${formatMoney(room.rate)} / heure</div>
        <div class="status-pill busy">Occupée — Ticket #${String(b.ticketNumber || '-').padStart(4, '0')}</div>
        <div class="timer" data-timer="${b.startTime}">${formatClock(elapsed)}</div>
        <div class="amount-preview" data-preview="${b.startTime}|${b.rate}|${b.dailyRate || 0}">${preview.label} — ${formatMoney(preview.amount)}</div>
        <div class="meta-line">Client : ${escapeHtml(b.client)}</div>
        <div class="meta-line">Code ${b.code} activé à ${formatTimeOnly(b.startTime)}</div>
        <div class="actions"><button class="btn small" data-act="end" data-booking="${b.id}">Terminer</button></div>
      </div>`;
  }).join('')}</div>`;
}

function todaysBookings() {
  const today = new Date().toDateString();
  return state.bookings.filter(b => new Date(b.createdAt).toDateString() === today && b.status !== 'en_cours' && b.status !== 'en_attente')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function statusTag(b) {
  if (b.status === 'annulee') return '<span class="tag cancelled">Annulée</span>';
  if (b.status === 'expiree') return '<span class="tag expired">Ticket expiré</span>';
  if (b.status === 'en_attente') return '<span class="tag waiting">En attente</span>';
  return b.paid ? '<span class="tag paid">Payé</span>' : '<span class="tag unpaid">Non payé</span>';
}

function renderHistorique() {
  const list = state.mode === 'gerant'
    ? [...state.bookings].filter(b => b.status !== 'en_cours' && b.status !== 'en_attente').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    : todaysBookings();
  if (list.length === 0) return `<div class="empty">Aucune location terminée pour l'instant.</div>`;
  return `<table><thead><tr>
      <th>Ticket</th><th>Salle</th><th>Client</th><th>Employé (ticket)</th><th>Employé (fin)</th>
      <th>Début (code activé)</th><th>Fin</th><th>Facturation</th><th>Montant</th><th>Statut</th>${state.mode === 'gerant' ? '<th>Actions</th>' : ''}
    </tr></thead><tbody>
    ${list.map(b => `
      <tr>
        <td class="num">#${String(b.ticketNumber || '-').padStart(4, '0')}</td>
        <td>${escapeHtml(b.roomName)}</td>
        <td>${escapeHtml(b.client)}</td>
        <td>${escapeHtml(b.employeeName)}</td>
        <td>${escapeHtml(b.closedByName || '-')}</td>
        <td class="num">${b.startTime ? formatDT(b.startTime) : '-'}</td>
        <td class="num">${b.endTime ? formatDT(b.endTime) : '-'}</td>
        <td>${escapeHtml(b.billingLabel || '-')}</td>
        <td class="num">${b.amount != null ? formatMoney(b.amount) : '-'}</td>
        <td>${statusTag(b)}</td>
        ${state.mode === 'gerant' ? `<td>
            ${b.status === 'terminee' ? `<button class="btn ghost small" data-act="print-receipt" data-booking="${b.id}">🖨️ Reçu</button>` : ''}
            ${b.status === 'terminee' ? `<button class="btn ghost small" data-act="toggle-paid" data-booking="${b.id}">${b.paid ? 'Marquer non payé' : 'Marquer payé'}</button>` : ''}
            ${b.status === 'terminee' ? `<button class="btn danger small" data-act="cancel-open" data-booking="${b.id}">Annuler</button>` : ''}
          </td>` : ''}
      </tr>
    `).join('')}
  </tbody></table>`;
}

function renderCaisse() {
  const dayBookings = state.bookings.filter(b => b.status === 'terminee' && b.endTime && b.endTime.slice(0, 10) === state.caisseDate);
  const totalGeneral = dayBookings.reduce((s, b) => s + (b.amount || 0), 0);
  const byMethod = {};
  dayBookings.forEach(b => {
    const m = b.paymentMethod || 'Non précisé';
    byMethod[m] = (byMethod[m] || 0) + (b.amount || 0);
  });
  const byEmployee = {};
  dayBookings.forEach(b => {
    const key = b.closedByName || b.employeeName;
    byEmployee[key] = byEmployee[key] || { count: 0, total: 0, especes: 0, mobile: 0, autre: 0, impaye: 0 };
    byEmployee[key].count++;
    byEmployee[key].total += (b.amount || 0);
    if (!b.paid) byEmployee[key].impaye += (b.amount || 0);
    else if (b.paymentMethod === 'Espèces') byEmployee[key].especes += (b.amount || 0);
    else if (b.paymentMethod === 'Mobile Money') byEmployee[key].mobile += (b.amount || 0);
    else byEmployee[key].autre += (b.amount || 0);
  });
  const unpaid = dayBookings.filter(b => !b.paid).reduce((s, b) => s + (b.amount || 0), 0);

  return `
    <div class="config-block" style="margin-bottom:18px">
      <div class="field" style="margin-bottom:0">
        <label>Journée</label>
        <input type="date" id="caisse-date" value="${state.caisseDate}">
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Locations clôturées</div><div class="value">${dayBookings.length}</div></div>
      <div class="stat-card"><div class="label">Total encaissé</div><div class="value">${formatMoney(totalGeneral)}</div></div>
      <div class="stat-card ${unpaid > 0 ? 'alert' : ''}"><div class="label">Dont impayé</div><div class="value">${formatMoney(unpaid)}</div></div>
    </div>
    <div class="section-title">Répartition par mode de paiement</div>
    <table><thead><tr><th>Mode de paiement</th><th>Montant</th></tr></thead>
    <tbody>${Object.entries(byMethod).map(([m, amt]) => `<tr><td>${escapeHtml(m)}</td><td class="num">${formatMoney(amt)}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--ink-soft)">Aucune donnée pour cette date</td></tr>'}</tbody></table>
    <div class="section-title">Détail par employé (celui qui a clôturé)</div>
    <table><thead><tr><th>Employé</th><th>Locations</th><th>Espèces</th><th>Mobile Money</th><th>Autre</th><th>Impayé</th><th>Total</th></tr></thead>
    <tbody>${Object.entries(byEmployee).map(([name, d]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${d.count}</td>
        <td class="num">${formatMoney(d.especes)}</td>
        <td class="num">${formatMoney(d.mobile)}</td>
        <td class="num">${formatMoney(d.autre)}</td>
        <td class="num" style="${d.impaye > 0 ? 'color:var(--alert)' : ''}">${formatMoney(d.impaye)}</td>
        <td class="num">${formatMoney(d.total)}</td>
      </tr>
    `).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--ink-soft)">Aucune donnée pour cette date</td></tr>'}</tbody></table>
    <div class="hint" style="margin-top:10px">Le total "Espèces" est celui à retrouver physiquement en caisse pour cette journée. Comparez-le avec l'argent réellement compté à la clôture.</div>
    <div style="margin-top:14px"><button class="btn ghost small" data-act="print-caisse">🖨️ Imprimer ce rapport</button></div>
  `;
}

function renderRapports() {
  const list = state.bookings.filter(b => b.status === 'terminee');
  const cancelled = state.bookings.filter(b => b.status === 'annulee');
  const expired = state.bookings.filter(b => b.status === 'expiree');
  const totalRevenue = list.reduce((s, b) => s + (b.amount || 0), 0);
  const unpaid = list.filter(b => !b.paid).reduce((s, b) => s + (b.amount || 0), 0);

  const byEmployee = {};
  list.forEach(b => {
    byEmployee[b.employeeName] = byEmployee[b.employeeName] || { count: 0, revenue: 0, unpaid: 0, cancelled: 0, expired: 0 };
    byEmployee[b.employeeName].count++;
    byEmployee[b.employeeName].revenue += (b.amount || 0);
    if (!b.paid) byEmployee[b.employeeName].unpaid += (b.amount || 0);
  });
  cancelled.forEach(b => {
    byEmployee[b.employeeName] = byEmployee[b.employeeName] || { count: 0, revenue: 0, unpaid: 0, cancelled: 0, expired: 0 };
    byEmployee[b.employeeName].cancelled++;
  });
  expired.forEach(b => {
    byEmployee[b.employeeName] = byEmployee[b.employeeName] || { count: 0, revenue: 0, unpaid: 0, cancelled: 0, expired: 0 };
    byEmployee[b.employeeName].expired++;
  });

  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Locations terminées</div><div class="value">${list.length}</div></div>
      <div class="stat-card"><div class="label">Revenu total</div><div class="value">${formatMoney(totalRevenue)}</div></div>
      <div class="stat-card ${unpaid > 0 ? 'alert' : ''}"><div class="label">Montant impayé</div><div class="value">${formatMoney(unpaid)}</div></div>
      <div class="stat-card ${cancelled.length > 0 ? 'alert' : ''}"><div class="label">Locations annulées</div><div class="value">${cancelled.length}</div></div>
      <div class="stat-card ${expired.length > 0 ? 'alert' : ''}"><div class="label">Tickets jamais activés</div><div class="value">${expired.length}</div></div>
    </div>
    <div class="section-title">Répartition par employé</div>
    <table><thead><tr><th>Employé</th><th>Locations</th><th>Revenu généré</th><th>Impayé</th><th>Annulations</th><th>Tickets expirés</th></tr></thead>
    <tbody>${Object.entries(byEmployee).map(([name, d]) => `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td class="num">${d.count}</td>
        <td class="num">${formatMoney(d.revenue)}</td>
        <td class="num" style="${d.unpaid > 0 ? 'color:var(--alert)' : ''}">${formatMoney(d.unpaid)}</td>
        <td class="num" style="${d.cancelled > 0 ? 'color:var(--alert)' : ''}">${d.cancelled}</td>
        <td class="num" style="${d.expired > 0 ? 'color:var(--alert)' : ''}">${d.expired}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-soft)">Pas encore de données</td></tr>'}</tbody></table>
    <div class="hint">Un nombre élevé d'annulations, de tickets jamais activés ou d'impayés associés à un même employé mérite une vérification. Ces indicateurs ne remplacent pas un contrôle physique régulier des salles.</div>
  `;
}

function renderJournal() {
  const entries = [];
  state.bookings.forEach(b => {
    (b.history || []).forEach(h => {
      entries.push({ ...h, roomName: b.roomName, client: b.client });
    });
  });
  entries.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  if (entries.length === 0) return `<div class="empty">Aucune activité enregistrée.</div>`;
  return entries.map(e => `
    <div class="journal-entry">${formatDT(e.ts)} — <b>${escapeHtml(e.employee)}</b> · ${e.action} · ${escapeHtml(e.roomName)} (${escapeHtml(e.client)}) ${e.detail ? '— ' + escapeHtml(e.detail) : ''}</div>
  `).join('');
}

function renderConfig() {
  return `
    <div class="config-block">
      <div class="section-title" style="margin-top:0">Nom du centre</div>
      <div class="field"><input id="cfg-centername" value="${escapeAttr(state.config.centerName)}"></div>
      <button class="btn small" data-act="save-centername">Enregistrer</button>
    </div>

    <div class="config-block">
      <div class="section-title" style="margin-top:0">Salles et tarifs</div>
      <div class="hint" style="margin-bottom:8px">Le tarif journalier s'applique automatiquement au-delà de 3h10 de location.</div>
      ${state.config.rooms.map(r => `
        <div class="list-row">
          <span>${escapeHtml(r.name)}</span>
          <span class="row-flex" style="max-width:320px">
            <input type="number" data-room-rate="${r.id}" value="${r.rate}" placeholder="Tarif/h" style="width:90px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;">
            <input type="number" data-room-daily="${r.id}" value="${r.dailyRate || ''}" placeholder="Tarif jour" style="width:90px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;">
            <button class="btn ghost small" data-act="save-rate" data-room="${r.id}">OK</button>
            <button class="btn ghost small" data-act="remove-room" data-room="${r.id}">✕</button>
          </span>
        </div>
      `).join('')}
      <div class="row-flex" style="margin-top:10px">
        <input id="new-room-name" placeholder="Nom de la salle">
        <input id="new-room-rate" type="number" placeholder="Tarif / heure">
        <input id="new-room-daily" type="number" placeholder="Tarif journalier">
        <button class="btn small" data-act="add-room">Ajouter</button>
      </div>
    </div>

    <div class="config-block">
      <div class="section-title" style="margin-top:0">Employés</div>
      ${state.config.employees.length ? state.config.employees.map(e => `
        <div class="list-row"><span>${escapeHtml(e.name)}</span><button class="btn ghost small" data-act="remove-employee" data-emp="${e.id}">Retirer</button></div>
      `).join('') : '<div class="hint">Aucun employé pour l\'instant.</div>'}
      <div class="row-flex" style="margin-top:10px">
        <input id="new-emp-name" placeholder="Nom de l'employé">
        <button class="btn small" data-act="add-employee">Ajouter</button>
      </div>
    </div>

    <div class="config-block">
      <div class="section-title" style="margin-top:0">Ticket client</div>
      <div class="hint" style="margin-bottom:8px">Durée pendant laquelle le code remis au client reste valable pour activer sa location.</div>
      <div class="row-flex">
        <input id="new-ticket-validity" type="number" value="${state.config.ticketValidityMinutes}" placeholder="Minutes">
        <button class="btn small" data-act="save-ticket-validity">Enregistrer</button>
      </div>
    </div>

    <div class="config-block">
      <div class="section-title" style="margin-top:0">Sauvegarde des données</div>
      <div class="hint" style="margin-bottom:8px">Téléchargez régulièrement (ex : chaque semaine) une copie de vos données et conservez-la ailleurs — email, Google Drive, clé USB. C'est la protection la plus sûre contre toute perte, quel que soit l'hébergement utilisé.</div>
      <button class="btn small" data-act="export-backup">📥 Télécharger une sauvegarde maintenant</button>
      <div class="hint" style="margin-top:16px;margin-bottom:6px">Restaurer une sauvegarde (remplace toutes les données actuelles) :</div>
      <div class="row-flex">
        <input type="file" id="restore-file" accept="application/json">
        <button class="btn ghost small" data-act="import-backup">Restaurer</button>
      </div>
    </div>

    <div class="config-block">
      <div class="section-title" style="margin-top:0">Code Gérant</div>
      <div class="hint" style="margin-bottom:8px">Ce code protège l'accès aux rapports, au journal et aux annulations. Ne le partagez pas avec vos employés.</div>
      <div class="row-flex">
        <input id="new-pin" type="password" placeholder="Nouveau code (4 caractères min.)">
        <button class="btn small" data-act="change-pin">Changer le code</button>
      </div>
    </div>
  `;
}

function renderModal() {
  const { type, payload } = state.modal;
  if (type === 'pin') {
    return modalWrap('Accès Gérant', `
      <div class="field"><label>Code</label><input id="pin-input" type="password" autofocus></div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">Annuler</button>
        <button class="btn" data-act="submit-pin">Entrer</button>
      </div>
    `);
  }
  if (type === 'start') {
    return modalWrap(`Émettre un ticket — ${escapeHtml(payload.roomName)}`, `
      <div class="field"><label>Employé qui émet le ticket</label>
        <select id="start-emp">${state.config.employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Nom du client</label><input id="start-client" placeholder="Ex : M. Dossou"></div>
      <div class="hint">Un code sera généré et devra être saisi par le client dans l'Espace client, une fois arrivé dans la salle, pour démarrer le chrono.</div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">Annuler</button>
        <button class="btn" data-act="submit-start" data-room="${payload.roomId}">Générer le code</button>
      </div>
    `);
  }
  if (type === 'ticket-created') {
    const b = payload.booking;
    return modalWrap(`Ticket #${String(b.ticketNumber || '-').padStart(4, '0')} émis — ${escapeHtml(b.roomName)}`, `
      <div style="text-align:center">
        <div class="hint" style="font-family:var(--mono);font-size:13px;margin-bottom:6px">Ticket N° ${String(b.ticketNumber || '-').padStart(4, '0')}</div>
        <div class="code-display" style="font-size:36px">${b.code}</div>
        <div class="hint" style="margin-top:6px">Remettez ce code à ${escapeHtml(b.client)}. Il devra le saisir dans l'Espace client à son arrivée dans la salle. Valable jusqu'à ${formatTimeOnly(b.ticketExpiresAt)}.</div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-act="close-modal">Fermer</button>
      </div>
    `);
  }
  if (type === 'end') {
    const b = payload.booking;
    const billing = computeBillingPreview(b.startTime, new Date().toISOString(), b.rate, b.dailyRate);
    return modalWrap(`Terminer — ${escapeHtml(b.roomName)}`, `
      <div class="hint" style="margin-bottom:10px">Facturation : <b>${billing.label}</b> — Montant : <b>${formatMoney(billing.amount)}</b></div>
      <div class="field"><label>Employé qui clôture</label>
        <select id="end-emp">${state.config.employees.map(e => `<option value="${e.id}" ${e.id === b.employeeId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Mode de paiement</label>
        <select id="end-method"><option value="Espèces">Espèces</option><option value="Mobile Money">Mobile Money</option><option value="Autre">Autre</option></select>
      </div>
      <div class="field"><label><input type="checkbox" id="end-paid" checked style="width:auto;display:inline-block;margin-right:6px"> Paiement reçu maintenant</label></div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">Annuler</button>
        <button class="btn" data-act="submit-end" data-booking="${b.id}">Valider la clôture</button>
      </div>
    `);
  }
  if (type === 'cancel') {
    return modalWrap('Annuler la location', `
      <div class="field"><label>Motif de l'annulation (obligatoire)</label><textarea id="cancel-reason" placeholder="Ex : erreur de saisie, client parti sans utiliser la salle…"></textarea></div>
      <div class="hint">Cette action et son motif restent visibles dans le Journal.</div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">Retour</button>
        <button class="btn danger" data-act="submit-cancel" data-booking="${payload.bookingId}">Confirmer l'annulation</button>
      </div>
    `);
  }
  if (type === 'receipt') {
    const b = payload.booking;
    return modalWrap(`Location terminée — Ticket #${String(b.ticketNumber || '-').padStart(4, '0')}`, `
      <div class="hint" style="margin-bottom:10px">${escapeHtml(b.billingLabel || '')} — <b>${formatMoney(b.amount)}</b> — ${b.paid ? 'Payé' : 'Non payé'} (${escapeHtml(b.paymentMethod || '-')})</div>
      <div class="hint">Vous pouvez imprimer un reçu pour le client.</div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">Fermer</button>
        <button class="btn" data-act="print-receipt" data-booking="${b.id}">🖨️ Imprimer le reçu</button>
      </div>
    `);
  }
  return '';
}

function modalWrap(title, body) {
  return `<div class="modal-bg" data-act="modal-bg"><div class="modal" onclick="event.stopPropagation()"><h3>${title}</h3>${body}</div></div>`;
}

function renderClientView() {
  const activeId = state.clientActiveBookingId;
  const active = activeId ? state.bookings.find(b => b.id === activeId) : null;
  let center;
  if (active && active.status === 'en_cours') {
    center = `
      <h1>C'est parti !</h1>
      <p>${escapeHtml(active.roomName)} — votre session est en cours depuis ${formatTimeOnly(active.startTime)}.</p>
      <div class="client-timer" data-client-timer="${active.startTime}">00:00</div>
      <p>Vous pouvez suivre ici la durée écoulée. Rendez-vous à la réception à la fin de votre location.</p>
    `;
  } else {
    center = `
      <h1>Activer ma location</h1>
      <p>Saisissez le code à 5 chiffres remis à la réception pour démarrer le chrono de votre salle.</p>
      <input class="code-input" id="client-code-input" maxlength="5" inputmode="numeric" placeholder="•••••" autofocus>
      <div class="modal-actions" style="justify-content:center;margin-top:16px">
        <button class="btn" data-act="submit-client-code">Activer ma location</button>
      </div>
      ${state.clientMsg ? `<div class="${state.clientMsg.type === 'error' ? 'msg-error' : 'msg-success'}">${escapeHtml(state.clientMsg.text)}</div>` : ''}
    `;
  }
  return `
    <button class="client-back" data-act="close-client">← Quitter l'espace client</button>
    <div class="client-screen">${center}</div>
  `;
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function escapeAttr(s) { return escapeHtml(s); }

function printHtmlDocument(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=420,height=600');
  if (!w) { alert("L'impression a été bloquée par le navigateur. Autorisez les pop-ups pour ce site et réessayez."); return; }
  w.document.write(`
    <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
    <style>
      body{font-family:'Courier New',monospace;font-size:13px;color:#111;padding:16px;max-width:340px;margin:0 auto;}
      h1{font-size:16px;text-align:center;margin:0 0 4px;}
      .sub{text-align:center;font-size:11px;color:#555;margin-bottom:14px;}
      .line{border-top:1px dashed #999;margin:10px 0;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      td{padding:3px 0;vertical-align:top;}
      td.label{color:#555;}
      td.val{text-align:right;font-weight:bold;}
      .total{font-size:15px;margin-top:10px;}
      .center{text-align:center;}
    </style>
    </head><body>${bodyHtml}</body></html>
  `);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

function printReceipt(b) {
  const html = `
    <h1>${escapeHtml(state.config.centerName)}</h1>
    <div class="sub">Reçu de location — Ticket #${String(b.ticketNumber || '-').padStart(4, '0')}</div>
    <div class="line"></div>
    <table>
      <tr><td class="label">Salle</td><td class="val">${escapeHtml(b.roomName)}</td></tr>
      <tr><td class="label">Client</td><td class="val">${escapeHtml(b.client)}</td></tr>
      <tr><td class="label">Début</td><td class="val">${formatDT(b.startTime)}</td></tr>
      <tr><td class="label">Fin</td><td class="val">${formatDT(b.endTime)}</td></tr>
      <tr><td class="label">Facturation</td><td class="val">${escapeHtml(b.billingLabel || '')}</td></tr>
      <tr><td class="label">Paiement</td><td class="val">${escapeHtml(b.paymentMethod || '-')}</td></tr>
      <tr><td class="label">Statut</td><td class="val">${b.paid ? 'Payé' : 'Non payé'}</td></tr>
    </table>
    <div class="line"></div>
    <table><tr><td class="label total">Montant</td><td class="val total">${formatMoney(b.amount)}</td></tr></table>
    <div class="line"></div>
    <div class="center sub">Servi par ${escapeHtml(b.closedByName || b.employeeName)}<br>${formatDT(new Date().toISOString())}</div>
  `;
  printHtmlDocument(`Reçu #${b.ticketNumber || ''}`, html);
}

function printCaisseReport() {
  const dayBookings = state.bookings.filter(b => b.status === 'terminee' && b.endTime && b.endTime.slice(0, 10) === state.caisseDate);
  const total = dayBookings.reduce((s, b) => s + (b.amount || 0), 0);
  const byMethod = {};
  dayBookings.forEach(b => { const m = b.paymentMethod || 'Non précisé'; byMethod[m] = (byMethod[m] || 0) + (b.amount || 0); });
  const rows = dayBookings.map(b => `
    <tr><td class="label">#${String(b.ticketNumber || '-').padStart(4, '0')} ${escapeHtml(b.roomName)}</td><td class="val">${formatMoney(b.amount)}</td></tr>
  `).join('');
  const methodRows = Object.entries(byMethod).map(([m, amt]) => `<tr><td class="label">${escapeHtml(m)}</td><td class="val">${formatMoney(amt)}</td></tr>`).join('');
  const html = `
    <h1>${escapeHtml(state.config.centerName)}</h1>
    <div class="sub">Clôture de caisse — ${state.caisseDate}</div>
    <div class="line"></div>
    <table>${rows || '<tr><td colspan="2" class="center">Aucune location</td></tr>'}</table>
    <div class="line"></div>
    <table>${methodRows}</table>
    <div class="line"></div>
    <table><tr><td class="label total">Total</td><td class="val total">${formatMoney(total)}</td></tr></table>
    <div class="line"></div>
    <div class="center sub">Édité le ${formatDT(new Date().toISOString())}</div>
  `;
  printHtmlDocument(`Cloture de caisse ${state.caisseDate}`, html);
}

function attachHandlers() {
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.onclick = () => { state.tab = el.dataset.tab; render(); };
  });
  const caisseDateInput = document.getElementById('caisse-date');
  if (caisseDateInput) {
    caisseDateInput.onchange = () => { state.caisseDate = caisseDateInput.value; render(); };
  }
  document.querySelectorAll('[data-act]').forEach(el => {
    el.onclick = async (ev) => {
      const act = el.dataset.act;
      if (act === 'modal-bg' && ev.target === el) { closeModal(); return; }
      if (act === 'open-pin') openModal('pin');
      else if (act === 'close-modal') closeModal();
      else if (act === 'exit-gerant') exitGerant();
      else if (act === 'open-client') openClientView();
      else if (act === 'close-client') closeClientView();
      else if (act === 'print-caisse') printCaisseReport();
      else if (act === 'print-receipt') {
        const b = state.bookings.find(x => x.id === el.dataset.booking);
        if (b) printReceipt(b);
      }
      else if (act === 'submit-client-code') {
        const val = document.getElementById('client-code-input').value;
        await submitClientCode(val);
      }
      else if (act === 'submit-pin') { await tryEnterGerant(document.getElementById('pin-input').value); }
      else if (act === 'start') startTicketFlow(el.dataset.room);
      else if (act === 'submit-start') {
        await confirmIssueTicket(el.dataset.room, document.getElementById('start-emp').value, document.getElementById('start-client').value.trim());
      }
      else if (act === 'cancel-ticket') await cancelPendingTicket(el.dataset.booking);
      else if (act === 'end') endBookingFlow(el.dataset.booking);
      else if (act === 'submit-end') {
        const paid = document.getElementById('end-paid').checked;
        const method = document.getElementById('end-method').value;
        await confirmEnd(el.dataset.booking, document.getElementById('end-emp').value, paid, method);
      }
      else if (act === 'cancel-open') openModal('cancel', { bookingId: el.dataset.booking });
      else if (act === 'submit-cancel') {
        const reason = document.getElementById('cancel-reason').value.trim();
        if (!reason) { alert('Le motif est obligatoire.'); return; }
        await cancelBookingGerant(el.dataset.booking, reason);
      }
      else if (act === 'toggle-paid') await togglePaid(el.dataset.booking);
      else if (act === 'add-room') {
        const name = document.getElementById('new-room-name').value.trim();
        const rate = document.getElementById('new-room-rate').value;
        const daily = document.getElementById('new-room-daily').value;
        if (!name) { alert('Indiquez un nom de salle.'); return; }
        await addRoom(name, rate, daily);
      }
      else if (act === 'remove-room') await removeRoom(el.dataset.room);
      else if (act === 'save-rate') {
        const rateInput = document.querySelector(`[data-room-rate="${el.dataset.room}"]`);
        const dailyInput = document.querySelector(`[data-room-daily="${el.dataset.room}"]`);
        await updateRoomRate(el.dataset.room, rateInput.value, dailyInput.value);
      }
      else if (act === 'add-employee') {
        const name = document.getElementById('new-emp-name').value;
        await addEmployee(name);
      }
      else if (act === 'remove-employee') await removeEmployee(el.dataset.emp);
      else if (act === 'change-pin') {
        const val = document.getElementById('new-pin').value;
        await changePin(val);
      }
      else if (act === 'save-centername') {
        await changeCenterName(document.getElementById('cfg-centername').value.trim());
      }
      else if (act === 'save-ticket-validity') {
        await changeTicketValidity(document.getElementById('new-ticket-validity').value);
      }
    };
  });
}

// Chronos en direct (affichage seulement, la facturation réelle est calculée côté serveur)
setInterval(() => {
  document.querySelectorAll('[data-timer]').forEach(el => {
    el.textContent = formatClock(Date.now() - new Date(el.dataset.timer).getTime());
  });
  document.querySelectorAll('[data-preview]').forEach(el => {
    const [start, rate, dailyRate] = el.dataset.preview.split('|');
    const b = computeBillingPreview(start, new Date().toISOString(), Number(rate), Number(dailyRate));
    el.textContent = `${b.label} — ${formatMoney(b.amount)}`;
  });
  document.querySelectorAll('[data-client-timer]').forEach(el => {
    el.textContent = formatClock(Date.now() - new Date(el.dataset.clientTimer).getTime());
  });
}, 1000);

// Rafraîchissement périodique pour voir les actions des autres appareils
setInterval(() => {
  if (state.view === 'staff' && !state.modal) refreshAndRender();
}, 5000);

refreshAndRender();
