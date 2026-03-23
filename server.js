const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-super-secret';
const DATA_DIR = process.env.DATA_DIR || '/data';
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'messenger.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join('/data', 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');

for (const dir of [DATA_DIR, UPLOADS_DIR, AVATARS_DIR, IMAGES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function createEmptyDb() {
  return {
    counters: { users: 0, chats: 0, messages: 0 },
    users: [],
    chats: [],
    messages: []
  };
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = createEmptyDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw || '{}');
    return {
      counters: data.counters || { users: 0, chats: 0, messages: 0 },
      users: Array.isArray(data.users) ? data.users : [],
      chats: Array.isArray(data.chats) ? data.chats : [],
      messages: Array.isArray(data.messages) ? data.messages : []
    };
  } catch (error) {
    console.error('Failed to read DB, backing up broken file.', error);
    const backup = `${DB_PATH}.broken-${Date.now()}`;
    try {
      fs.copyFileSync(DB_PATH, backup);
    } catch {}
    const empty = createEmptyDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2), 'utf8');
    return empty;
  }
}

let db = readDb();

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(kind) {
  db.counters[kind] = Number(db.counters[kind] || 0) + 1;
  return db.counters[kind];
}

function nowIso() {
  return new Date().toISOString();
}
app.get('/health', (_req, res) => {
  res.send('ok');
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

const storageFor = (dir) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

function imageFileFilter(_req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'));
  }
  cb(null, true);
}

const uploadAvatar = multer({
  storage: storageFor(AVATARS_DIR),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFileFilter
});

const uploadImage = multer({
  storage: storageFor(IMAGES_DIR),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: imageFileFilter
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, avatar_url: user.avatar_url || null },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(res, token) {
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie('auth_token');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name || user.username,
    bio: user.bio || '',
    avatar_url: user.avatar_url || null,
    created_at: user.created_at
  };
}
function getUserById(userId) {
  return publicUser(db.users.find((u) => u.id === Number(userId)) || null);
}

function getRawUserByUsername(username) {
  return db.users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase()) || null;
}

function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.id);
    if (!user) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function normalizePair(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? [x, y] : [y, x];
}

function ensurePrivateChat(userA, userB) {
  const [user1, user2] = normalizePair(userA, userB);
  let chat = db.chats.find((c) => c.user1_id === user1 && c.user2_id === user2);

  if (!chat) {
    chat = {
      id: nextId('chats'),
      user1_id: user1,
      user2_id: user2,
      created_at: nowIso()
    };
    db.chats.push(chat);
    saveDb();
  }

  return chat;
}

function getChatForUser(chatId, userId) {
  return db.chats.find((c) => c.id === Number(chatId) && (c.user1_id === Number(userId) || c.user2_id === Number(userId))) || null;
}

function getPartnerFromChat(chat, userId) {
  const partnerId = chat.user1_id === Number(userId) ? chat.user2_id : chat.user1_id;
  return getUserById(partnerId);
}

function serializeMessage(message) {
  const sender = getUserById(message.sender_id);
  return {
    id: message.id,
    chat_id: message.chat_id,
    sender_id: message.sender_id,
    sender_username: sender?.username || 'Unknown',
    sender_avatar_url: sender?.avatar_url || null,
    type: message.type,
    content: message.content,
    created_at: message.created_at
  };
}

const activeConnections = new Map();

function addConnection(userId, ws) {
  if (!activeConnections.has(userId)) {
    activeConnections.set(userId, new Set());
  }
  activeConnections.get(userId).add(ws);
}

function removeConnection(userId, ws) {
  if (!activeConnections.has(userId)) return;
  const set = activeConnections.get(userId);
  set.delete(ws);
  if (set.size === 0) {
    activeConnections.delete(userId);
  }
}

function sendToUser(userId, payload) {
  const set = activeConnections.get(userId);
  if (!set) return;
  const text = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(text);
    }
  }
}

function broadcastPresence() {
  const onlineUserIds = Array.from(activeConnections.keys());
  const text = JSON.stringify({ type: 'presence', onlineUserIds });
  for (const set of activeConnections.values()) {
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  }
}

app.post('/api/register', uploadAvatar.single('avatar'), async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = getRawUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
     id: nextId('users'),
     username,
     display_name: username,
     bio: '',
     password_hash: passwordHash,
     avatar_url: req.file ? `/uploads/avatars/${req.file.filename}` : null,
     created_at: nowIso()
    };

    db.users.push(user);
    saveDb();

    const safeUser = publicUser(user);
    const token = signToken(safeUser);
    setAuthCookie(res, token);

    res.json({ user: safeUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const userRow = getRawUserByUsername(username);

    if (!userRow) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = publicUser(userRow);
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/users/:id', authMiddleware, (req, res) => {
  const userId = Number(req.params.id);
  const user = getUserById(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
});

app.patch('/api/profile', authMiddleware, (req, res) => {
  try {
    const displayName = String(req.body.display_name || '').trim();
    const bio = String(req.body.bio || '').trim();

    if (displayName.length > 40) {
      return res.status(400).json({ error: 'Имя слишком длинное' });
    }

    if (bio.length > 160) {
      return res.status(400).json({ error: 'Описание слишком длинное' });
    }

    const userIndex = db.users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.users[userIndex].display_name = displayName || db.users[userIndex].username;
    db.users[userIndex].bio = bio || '';

    saveDb();

    res.json({ user: publicUser(db.users[userIndex]) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось обновить профиль' });
  }
});

app.get('/api/users', authMiddleware, (req, res) => {
  const onlineSet = new Set(activeConnections.keys());
  const users = db.users
    .filter((user) => user.id !== req.user.id)
    .sort((a, b) => a.username.localeCompare(b.username, 'ru', { sensitivity: 'base' }))
    .map((user) => ({ ...publicUser(user), is_online: onlineSet.has(user.id) }));

  res.json({ users });
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const onlineSet = new Set(activeConnections.keys());

  const chats = db.chats
    .filter((chat) => chat.user1_id === req.user.id || chat.user2_id === req.user.id)
    .map((chat) => {
      const partner = getPartnerFromChat(chat, req.user.id);
      const lastMessage = db.messages
        .filter((message) => message.chat_id === chat.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id)[0] || null;

      return {
        id: chat.id,
        partner,
        partner_is_online: partner ? onlineSet.has(partner.id) : false,
        last_message: lastMessage ? {
          id: lastMessage.id,
          type: lastMessage.type,
          content: lastMessage.content,
          created_at: lastMessage.created_at
        } : null,
        sort_time: lastMessage ? lastMessage.created_at : chat.created_at
      };
    })
    .sort((a, b) => new Date(b.sort_time) - new Date(a.sort_time))
    .map(({ sort_time, ...chat }) => chat);

  res.json({ chats });
});

app.post('/api/profile/avatar', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    const userIndex = db.users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.users[userIndex].avatar_url = `/uploads/avatars/${req.file.filename}`;
    saveDb();

    res.json({ user: publicUser(db.users[userIndex]) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Не удалось обновить аватар' });
  }
});

app.post('/api/chats', authMiddleware, (req, res) => {
  const otherUserId = Number(req.body.userId);
  if (!otherUserId || otherUserId === req.user.id) {
    return res.status(400).json({ error: 'Invalid target user' });
  }

  const otherUser = getUserById(otherUserId);
  if (!otherUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  const chat = ensurePrivateChat(req.user.id, otherUserId);
  res.json({ chat: { id: chat.id, partner: otherUser } });
});

app.get('/api/chats/:chatId/messages', authMiddleware, (req, res) => {
  const chatId = Number(req.params.chatId);
  const limit = Math.min(Number(req.query.limit || 100), 100);
  const chat = getChatForUser(chatId, req.user.id);

  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const messages = db.messages
    .filter((message) => message.chat_id === chatId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
    .slice(-limit)
    .map(serializeMessage);

  res.json({ messages });
});

app.post('/api/chats/:chatId/messages', authMiddleware, uploadImage.single('image'), (req, res) => {
  const chatId = Number(req.params.chatId);
  const chat = getChatForUser(chatId, req.user.id);
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  const text = String(req.body.text || '').trim();
  const hasImage = Boolean(req.file);
  if (!text && !hasImage) {
    return res.status(400).json({ error: 'Message is empty' });
  }

  const created = [];
  if (text) {
    created.push({
      id: nextId('messages'),
      chat_id: chatId,
      sender_id: req.user.id,
      type: 'text',
      content: text,
      created_at: nowIso()
    });
  }

  if (hasImage) {
    created.push({
      id: nextId('messages'),
      chat_id: chatId,
      sender_id: req.user.id,
      type: 'image',
      content: `/uploads/images/${req.file.filename}`,
      created_at: nowIso()
    });
  }

  db.messages.push(...created);
  saveDb();

  const partner = getPartnerFromChat(chat, req.user.id);
  const serialized = created.map(serializeMessage);

  for (const message of serialized) {
    sendToUser(req.user.id, { type: 'new_message', message });
    if (partner) sendToUser(partner.id, { type: 'new_message', message });
  }

  res.json({ messages: serialized });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
  res.status(500).json({ error: 'Unknown server error' });
});

function createServer() {
  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    console.log('HTTPS enabled');
    return https.createServer(options, app);
  }

  console.log('HTTPS certificates not found, starting in HTTP mode');
  return http.createServer(app);
}

const server = createServer();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const token = cookies.auth_token;
    if (!token) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = getUserById(payload.id);
    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.user = user;
    addConnection(user.id, ws);
    ws.send(JSON.stringify({
      type: 'connected',
      user,
      onlineUserIds: Array.from(activeConnections.keys())
    }));
    broadcastPresence();

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'typing' && Number.isInteger(data.chatId)) {
          const chat = getChatForUser(data.chatId, user.id);
          if (!chat) return;
          const partner = getPartnerFromChat(chat, user.id);
          if (!partner) return;
          sendToUser(partner.id, {
            type: 'typing',
            chatId: data.chatId,
            userId: user.id,
            username: user.username
          });
        }
      } catch (error) {
        console.error('WS message error', error);
      }
    });

    ws.on('close', () => {
      removeConnection(user.id, ws);
      broadcastPresence();
    });
  } catch (error) {
    ws.close(1008, 'Unauthorized');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
