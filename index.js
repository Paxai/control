import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const commands = {}; // { laptop: 'komenda', pc: 'komenda' }
const results = {};  // { laptop: 'wynik', pc: 'wynik' }

app.post('/command', (req, res) => {
  const { command, client } = req.body;
  if (!command || !client) return res.status(400).send('Brakuje danych');
  commands[client] = command;
  console.log(`Nowa komenda dla ${client}: ${command}`);
  res.sendStatus(200);
});

app.get('/command', (req, res) => {
  const client = req.query.client;
  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    return res.send(cmd);
  }
  res.status(204).send(); // brak
});

app.post('/result', (req, res) => {
  const { result, client } = req.body;
  if (!result || !client) return res.status(400).send('Brakuje danych');
  results[client] = result;
  console.log(`Wynik od ${client}: ${result}`);
  res.sendStatus(200);
});

app.get('/result', (req, res) => {
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
