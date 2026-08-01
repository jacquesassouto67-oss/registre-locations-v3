const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Sauvegarde externe optionnelle (fortement recommandée en ligne) : JSONbin.io
// Configurez JSONBIN_ID et JSONBIN_KEY dans les variables d'environnement du service.
// Sans ces variables, l'application fonctionne quand même, en local uniquement.
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultConfig() {
  return {
    centerName: 'Centre de loisirs',
    managerPin: '1234',
    ticketValidityMinutes: 20,
    nextTicketNumber: 1,
    rooms: [
      { id: uid(), name: 'Salle A', rate: 2000, dailyRate: 10000 },
      { id: uid(), name: 'Salle B', rate: 2000, dailyRate: 10000 },
      { id: uid(), name: 'Salle C', rate: 2500, dailyRate: 12000 },
      { id: uid(), name: 'Salle D', rate: 2500, dailyRate: 12000 },
    ],
    employees: [],
  };
}

function loadLocalData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const initial = { config: defaultConfig(), bookings: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Au démarrage : on essaie d'abord de récupérer les données depuis JSONbin
// (survit à un redéploiement ou un changement de machine), sinon on se
// rabat sur le fichier local.
async function loadData() {
  if (JSONBIN_ID && JSONBIN_KEY) {
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
        headers: { 'X-Master-Key': JSONBIN_KEY },
      });
      if (res.ok) {
        const json = await res.json();
        if (json && json.record && json.record.config) {
          console.log('Données restaurées depuis la sauvegarde JSONbin.');
          return json.record;
        }
      } else {
        console.error('JSONbin a répondu avec une erreur au démarrage:', res.status);
      }
    } catch (e) {
      console.error('Lecture JSONbin impossible au démarrage, on utilise le fichier local:', e.message);
    }
  }
  return loadLocalData();
}

function maybeDailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const backupFile = path.join(DATA_DIR, `backup-${today}.json`);
  if (!fs.existsSync(backupFile)) {
    try {
      fs.writeFileSync(backupFile, JSON.stringify(db, null, 2));
      cleanupOldBackups();
    }
    catch (e) { console.error('Sauvegarde quotidienne locale échouée:', e.message); }
  }
}

// Garde les 30 dernières sauvegardes quotidiennes locales, supprime le reste.
function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json'))
      .sort();
    const excess = files.length - 30;
    if (excess > 0) {
      files.slice(0, excess).forEach(f => fs.unlinkSync(path.join(DATA_DIR, f)));
    }
  } catch (e) { console.error('Nettoyage des anciennes sauvegardes échoué:', e.message); }
}

async function syncToJsonBin() {
  if (!JSONBIN_ID || !JSONBIN_KEY) return;
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
      body: JSON.stringify(db),
    });
    if (!res.ok) console.error('Sauvegarde JSONbin refusée, code', res.status);
  } catch (e) {
    console.error('Sauvegarde JSONbin échouée (les données restent sauvegardées localement):', e.message);
  }
}

// Écriture locale immédiate (rapide, ne bloque pas la réponse) + copie vers
// JSONbin en arrière-plan + une sauvegarde datée locale une fois par jour.
function saveData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    maybeDailyBackup();
  } catch (e) {
    console.error('Écriture locale échouée:', e.message);
  }
  syncToJsonBin();
}

let db;

function addHistory(booking, employee, action, detail) {
  booking.history = booking.history || [];
  booking.history.push({ ts: new Date().toISOString(), employee, action, detail: detail || '' });
}

function genCode() {
  const used = new Set(db.bookings.filter(b => b.status === 'en_attente').map(b => b.code));
  let code;
  do { code = String(Math.floor(10000 + Math.random() * 90000)); } while (used.has(code));
  return code;
}

// Facturation :
// 1-70 min -> 1h pleine due
// 71-130 min -> 2h pleines dues
// 131-190 min -> 3h dues, remise de 20%
// > 190 min -> tarif journalier de la salle
function computeBilling(startISO, endISO, rate, dailyRate) {
  const ms = new Date(endISO) - new Date(startISO);
  let minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes <= 70) {
    return { minutes, amount: rate * 1, label: '1 heure' };
  }
  if (minutes <= 130) {
    return { minutes, amount: rate * 2, label: '2 heures' };
  }
  if (minutes <= 190) {
    return { minutes, amount: rate * 3 * 0.8, label: '3 heures (-20%)' };
  }
  const amount = dailyRate && dailyRate > 0 ? dailyRate : rate * 3 * 0.8;
  return { minutes, amount, label: dailyRate && dailyRate > 0 ? 'Tarif journalier' : '3 heures (-20%) — tarif journalier non configuré' };
}

function expireStale() {
  const now = Date.now();
  let changed = false;
  db.bookings.forEach(b => {
    if (b.status === 'en_attente' && new Date(b.ticketExpiresAt).getTime() < now) {
      b.status = 'expiree';
      b.updatedAt = new Date().toISOString();
      addHistory(b, '(système)', 'expiration', `Ticket ${b.code} jamais activé`);
      changed = true;
    }
  });
  if (changed) saveData();
}
setInterval(expireStale, 30000);

function checkPin(req, res) {
  const pin = req.body && req.body.pin !== undefined ? req.body.pin : req.query.pin;
  if (pin !== db.config.managerPin) {
    res.status(403).json({ error: 'Code Gérant invalide' });
    return false;
  }
  return true;
}

function publicConfig() {
  const { managerPin, ...rest } = db.config;
  return rest;
}

// ---------- Routes publiques (Employé + Client) ----------

app.get('/api/state', (req, res) => {
  expireStale();
  const today = new Date().toDateString();
  const bookings = db.bookings.filter(b => {
    if (b.status === 'en_attente' || b.status === 'en_cours') return true;
    return new Date(b.createdAt).toDateString() === today;
  });
  res.json({ config: publicConfig(), bookings });
});

app.post('/api/tickets', (req, res) => {
  const { roomId, employeeId, client } = req.body;
  const room = db.config.rooms.find(r => r.id === roomId);
  const emp = db.config.employees.find(e => e.id === employeeId);
  if (!room || !emp) return res.status(400).json({ error: 'Salle ou employé invalide' });
  if (db.bookings.find(b => b.roomId === roomId && (b.status === 'en_attente' || b.status === 'en_cours'))) {
    return res.status(400).json({ error: 'Cette salle a déjà un ticket ou une location en cours' });
  }
  const now = new Date();
  const expires = new Date(now.getTime() + db.config.ticketValidityMinutes * 60000);
  if (!db.config.nextTicketNumber) db.config.nextTicketNumber = 1;
  const ticketNumber = db.config.nextTicketNumber;
  db.config.nextTicketNumber = ticketNumber + 1;
  const booking = {
    id: uid(), ticketNumber, roomId, roomName: room.name, rate: room.rate, dailyRate: room.dailyRate || 0,
    employeeId: emp.id, employeeName: emp.name, client: client || '(non précisé)',
    code: genCode(), ticketIssuedAt: now.toISOString(), ticketExpiresAt: expires.toISOString(),
    startTime: null, endTime: null, status: 'en_attente', amount: null, billingLabel: null,
    paid: false, paymentMethod: null, closedByName: null, cancelReason: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), history: [],
  };
  addHistory(booking, emp.name, 'emission_ticket', `Ticket #${String(ticketNumber).padStart(4, '0')} — Salle ${room.name}, client ${booking.client}, valable jusqu'à ${expires.toLocaleTimeString('fr-FR')}`);
  db.bookings.push(booking);
  saveData();
  res.json(booking);
});

app.post('/api/tickets/validate', (req, res) => {
  expireStale();
  const { code } = req.body;
  const booking = db.bookings.find(b => b.code === code && b.status === 'en_attente');
  if (!booking) return res.status(404).json({ error: 'Code invalide ou expiré. Merci de contacter la réception.' });
  const now = new Date().toISOString();
  booking.status = 'en_cours';
  booking.startTime = now;
  booking.updatedAt = now;
  addHistory(booking, booking.client, 'validation', 'Code activé par le client, chrono démarré');
  saveData();
  res.json(booking);
});

app.post('/api/tickets/:id/cancel', (req, res) => {
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b || b.status !== 'en_attente') return res.status(400).json({ error: 'Impossible' });
  b.status = 'annulee';
  b.cancelReason = 'Annulé avant activation par le client';
  b.updatedAt = new Date().toISOString();
  addHistory(b, b.employeeName, 'annulation_ticket', 'Ticket annulé avant activation');
  saveData();
  res.json(b);
});

app.post('/api/bookings/:id/end', (req, res) => {
  const { employeeId, paid, paymentMethod } = req.body;
  const b = db.bookings.find(x => x.id === req.params.id);
  const emp = db.config.employees.find(e => e.id === employeeId);
  if (!b || b.status !== 'en_cours' || !emp) return res.status(400).json({ error: 'Invalide' });
  const now = new Date().toISOString();
  const billing = computeBilling(b.startTime, now, b.rate, b.dailyRate);
  b.endTime = now;
  b.status = 'terminee';
  b.amount = billing.amount;
  b.billingLabel = billing.label;
  b.paid = !!paid;
  b.paymentMethod = paymentMethod;
  b.closedByName = emp.name;
  b.updatedAt = now;
  addHistory(b, emp.name, 'fin', `${billing.label} — ${Math.round(billing.amount).toLocaleString('fr-FR')} FCFA, ${paid ? 'payé' : 'non payé'} (${paymentMethod || '-'})`);
  saveData();
  res.json(b);
});

app.get('/api/billing-preview', (req, res) => {
  const b = db.bookings.find(x => x.id === req.query.id);
  if (!b) return res.status(404).end();
  const billing = computeBilling(b.startTime, new Date().toISOString(), b.rate, b.dailyRate);
  res.json(billing);
});

// ---------- Routes Gérant (protégées par code) ----------

app.post('/api/gerant/verify', (req, res) => {
  if (!checkPin(req, res)) return;
  res.json({ ok: true });
});

app.get('/api/admin/state', (req, res) => {
  if (!checkPin(req, res)) return;
  expireStale();
  res.json({ config: db.config, bookings: db.bookings });
});

app.post('/api/bookings/:id/cancel', (req, res) => {
  if (!checkPin(req, res)) return;
  const { reason } = req.body;
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b || !reason) return res.status(400).json({ error: 'Invalide' });
  b.status = 'annulee';
  b.cancelReason = reason;
  b.updatedAt = new Date().toISOString();
  addHistory(b, '(Gérant)', 'annulation', reason);
  saveData();
  res.json(b);
});

app.post('/api/bookings/:id/toggle-paid', (req, res) => {
  if (!checkPin(req, res)) return;
  const b = db.bookings.find(x => x.id === req.params.id);
  if (!b) return res.status(404).end();
  b.paid = !b.paid;
  b.updatedAt = new Date().toISOString();
  addHistory(b, '(Gérant)', 'modification', `Statut paiement -> ${b.paid ? 'payé' : 'non payé'}`);
  saveData();
  res.json(b);
});

app.post('/api/config/rooms', (req, res) => {
  if (!checkPin(req, res)) return;
  const { name, rate, dailyRate } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const room = { id: uid(), name, rate: Number(rate) || 0, dailyRate: Number(dailyRate) || 0 };
  db.config.rooms.push(room);
  saveData();
  res.json(room);
});

app.put('/api/config/rooms/:id', (req, res) => {
  if (!checkPin(req, res)) return;
  const r = db.config.rooms.find(x => x.id === req.params.id);
  if (!r) return res.status(404).end();
  if (req.body.rate !== undefined) r.rate = Number(req.body.rate) || 0;
  if (req.body.dailyRate !== undefined) r.dailyRate = Number(req.body.dailyRate) || 0;
  saveData();
  res.json(r);
});

app.delete('/api/config/rooms/:id', (req, res) => {
  if (!checkPin(req, res)) return;
  if (db.bookings.find(b => b.roomId === req.params.id && (b.status === 'en_attente' || b.status === 'en_cours'))) {
    return res.status(400).json({ error: 'Salle occupée, suppression impossible' });
  }
  db.config.rooms = db.config.rooms.filter(r => r.id !== req.params.id);
  saveData();
  res.json({ ok: true });
});

app.post('/api/config/employees', (req, res) => {
  if (!checkPin(req, res)) return;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const emp = { id: uid(), name };
  db.config.employees.push(emp);
  saveData();
  res.json(emp);
});

app.delete('/api/config/employees/:id', (req, res) => {
  if (!checkPin(req, res)) return;
  db.config.employees = db.config.employees.filter(e => e.id !== req.params.id);
  saveData();
  res.json({ ok: true });
});

app.put('/api/config/pin', (req, res) => {
  const { oldPin, newPin } = req.body;
  if (oldPin !== db.config.managerPin) return res.status(403).json({ error: 'Ancien code incorrect' });
  if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'Le code doit contenir au moins 4 caractères' });
  db.config.managerPin = newPin;
  saveData();
  res.json({ ok: true });
});

app.put('/api/config/center-name', (req, res) => {
  if (!checkPin(req, res)) return;
  db.config.centerName = req.body.name || db.config.centerName;
  saveData();
  res.json({ ok: true });
});

app.put('/api/config/ticket-validity', (req, res) => {
  if (!checkPin(req, res)) return;
  const m = Number(req.body.minutes);
  if (!m || m < 1) return res.status(400).json({ error: 'Durée invalide' });
  db.config.ticketValidityMinutes = m;
  saveData();
  res.json({ ok: true });
});

// ---------- Sauvegarde manuelle (export / restauration) ----------
// Couche de protection indépendante de l'hébergeur : le gérant peut à tout
// moment télécharger une copie complète des données, et la restaurer plus
// tard si besoin (ex : changement d'hébergeur, incident).

app.get('/api/admin/export', (req, res) => {
  if (!checkPin(req, res)) return;
  const filename = `registre-locations-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(db, null, 2));
});

app.post('/api/admin/import', (req, res) => {
  if (!checkPin(req, res)) return;
  const incoming = req.body.data;
  if (!incoming || !incoming.config || !Array.isArray(incoming.bookings)) {
    return res.status(400).json({ error: 'Fichier de sauvegarde invalide' });
  }
  db = incoming;
  saveData();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
(async () => {
  db = await loadData();
  if (!db.config.nextTicketNumber) db.config.nextTicketNumber = 1;
  app.listen(PORT, () => console.log(`Registre des locations démarré sur le port ${PORT}`));
})();
