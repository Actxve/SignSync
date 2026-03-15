const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const USERS_FILE = path.join(__dirname, 'users.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth API ─────────────────────────────────────────────────────────────────

// POST /api/register
app.post('/api/register', async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password)
    return res.status(400).json({ error: 'All fields are required.' });

  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email already in use.' });
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Username already taken.' });

  const hash = await bcrypt.hash(password, 10);
  users.push({ email: email.toLowerCase(), username, passwordHash: hash, createdAt: new Date().toISOString() });
  saveUsers(users);

  res.json({ ok: true, username });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

  res.json({ ok: true, username: user.username, email: user.email });
});

// ─── In-Memory Rooms ──────────────────────────────────────────────────────────
// rooms: Map<code, { host: WebSocket, guest: WebSocket | null }>

const rooms = new Map();

// ─── WebSocket Signaling ──────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;   // 'host' | 'guest'

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Room management ──────────────────────────────────────────────────
      case 'create-room': {
        let code;
        do { code = generateRoomCode(); } while (rooms.has(code));
        rooms.set(code, { host: ws, guest: null });
        ws.roomCode = code;
        ws.role = 'host';
        ws.send(JSON.stringify({ type: 'room-created', code }));
        break;
      }

      case 'join-room': {
        const { code } = msg;
        const room = rooms.get(code);
        if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' })); break; }
        if (room.guest) { ws.send(JSON.stringify({ type: 'error', message: 'Room is full.' })); break; }

        room.guest = ws;
        ws.roomCode = code;
        ws.role = 'guest';
        ws.send(JSON.stringify({ type: 'room-joined', code }));
        // Tell host a guest arrived so it starts the WebRTC offer
        room.host.send(JSON.stringify({ type: 'guest-joined' }));
        break;
      }

      // ── WebRTC signaling (relay to peer) ─────────────────────────────────
      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'sign_caption':
      case 'speech_caption': {
        const room = rooms.get(ws.roomCode);
        if (!room) break;
        const peer = ws.role === 'host' ? room.guest : room.host;
        if (peer && peer.readyState === peer.OPEN)
          peer.send(JSON.stringify(msg));
        break;
      }
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    // Notify peer and clean up
    const peer = ws.role === 'host' ? room.guest : room.host;
    if (peer && peer.readyState === peer.OPEN)
      peer.send(JSON.stringify({ type: 'peer-left' }));
    rooms.delete(code);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`✅ SignSync server running → http://localhost:${PORT}`);
});

// ─── Safety net — log crashes instead of silently dying ──────────────────────

process.on('uncaughtException', (err) => console.error('[CRASH] Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('[CRASH] Unhandled rejection:', err));
