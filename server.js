require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

let sqlite3, open;
try {
  sqlite3 = require('sqlite3');
  open = require('sqlite').open;
} catch (e) {
  console.warn("sqlite3 native module not loaded, using in-memory database fallback:", e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function getAIResponse(messages) {
  const token = (process.env.GITHUB_TOKEN || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || "").trim();
  
  if (!token || token === 'dummy-key') {
    return "AI Bot Configuration Note: Please verify your GITHUB_TOKEN or OPENAI_API_KEY environment variable in Vercel project settings.";
  }

  // 1. Primary: GitHub Models via Azure AI inference endpoint
  try {
    const endpoint = process.env.OPENAI_BASE_URL 
      ? (process.env.OPENAI_BASE_URL.endsWith('/chat/completions') ? process.env.OPENAI_BASE_URL : `${process.env.OPENAI_BASE_URL}/chat/completions`)
      : "https://models.inference.ai.azure.com/chat/completions";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        messages,
        model: process.env.AI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
    } else {
      const errText = await res.text();
      console.error("GitHub Models Azure AI status:", res.status, errText);
    }
  } catch (err) {
    console.error("GitHub Models Azure AI fetch error:", err.message);
  }

  // 2. Groq API fallback (Free instant AI models)
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        messages,
        model: "llama-3.1-8b-instant",
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
    }
  } catch (err) {}

  // 3. OpenRouter API fallback
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        messages,
        model: "google/gemini-2.0-flash-lite-001:free",
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
    }
  } catch (err) {}

  // 4. Standard OpenAI API fallback
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        messages,
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }
    } else {
      const errText = await res.text();
      console.error("OpenAI API status:", res.status, errText);
    }
  } catch (err) {
    console.error("OpenAI API fetch error:", err.message);
  }

  return "SmartEduBot AI Notice: The AI service could not authenticate with your current token. Please verify that your GITHUB_TOKEN or OPENAI_API_KEY in Vercel Environment Variables is valid.";
}

const SYSTEM_PROMPT = `You are SmartEduBot, an AI-Powered Context-Aware College and Placement Assistance Chatbot.
Help students with DSA, aptitude, and interviews.
Be concise and helpful.`;

let db = null;
const memoryStore = {
  users: [],
  sessions: [],
  messages: []
};

// Initialize Database
async function initDB() {
  if (db || !sqlite3 || !open) return;
  try {
    const dbPath = process.env.VERCEL || process.env.NODE_ENV === 'production' 
      ? '/tmp/database.sqlite' 
      : './database.sqlite';

    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
    `);
  } catch (err) {
    console.error("DB init failed, using in-memory store fallback:", err.message);
    db = null;
  }
}

async function dbGet(sql, params = []) {
  if (db) return await db.get(sql, params);
  
  if (sql.includes('FROM users WHERE username = ?')) {
    return memoryStore.users.find(u => u.username === params[0]) || null;
  }
  if (sql.includes('SELECT id FROM users WHERE username = ?')) {
    const u = memoryStore.users.find(u => u.username === params[0]);
    return u ? { id: u.id } : null;
  }
  if (sql.includes('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?')) {
    const count = memoryStore.sessions.filter(s => s.user_id === params[0]).length;
    return { count };
  }
  if (sql.includes('SELECT COUNT(*) as count FROM messages')) {
    const userSessionIds = memoryStore.sessions.filter(s => s.user_id === params[0]).map(s => s.id);
    const count = memoryStore.messages.filter(m => userSessionIds.includes(m.session_id)).length;
    return { count };
  }
  if (sql.includes('SELECT * FROM sessions WHERE id = ? AND user_id = ?')) {
    return memoryStore.sessions.find(s => s.id === params[0] && s.user_id === params[1]) || null;
  }
  return null;
}

async function dbRun(sql, params = []) {
  if (db) return await db.run(sql, params);

  if (sql.includes('INSERT INTO users')) {
    const id = memoryStore.users.length + 1;
    memoryStore.users.push({ id, username: params[0], password: params[1] });
    return { lastID: id };
  }
  if (sql.includes('INSERT INTO sessions')) {
    memoryStore.sessions.push({ id: params[0], user_id: params[1], title: params[2], created_at: new Date() });
    return {};
  }
  if (sql.includes('INSERT INTO messages')) {
    memoryStore.messages.push({ session_id: params[0], role: params[1], content: params[2], timestamp: new Date() });
    return {};
  }
}

async function dbAll(sql, params = []) {
  if (db) return await db.all(sql, params);

  if (sql.includes('SELECT id, title FROM sessions')) {
    return memoryStore.sessions
      .filter(s => s.user_id === params[0])
      .map(s => ({ id: s.id, title: s.title }));
  }
  if (sql.includes('SELECT role, content FROM messages WHERE session_id = ?')) {
    return memoryStore.messages
      .filter(m => m.session_id === params[0])
      .map(m => ({ role: m.role, content: m.content }));
  }
  return [];
}

app.use(async (req, res, next) => {
  if (!db && sqlite3 && open) {
    await initDB();
  }
  next();
});

// 🔐 AUTH MIDDLEWARE
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'No token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

async function ensureUser(username, rawPassword = null) {
  let user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    const hashedPassword = rawPassword ? await bcrypt.hash(rawPassword, 10) : 'autocreated';
    await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
    user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      user = { id: 1, username, password: hashedPassword };
    }
  }
  return user;
}

// 🧑 REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const existingUser = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) return res.status(400).json({ error: 'User exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔑 LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    let user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      user = await ensureUser(username, password);
    } else {
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📊 PROFILE
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await ensureUser(req.user.username);

    const sessionsCount = await dbGet('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [user.id]);
    const messagesCount = await dbGet(`
      SELECT COUNT(*) as count FROM messages 
      JOIN sessions ON messages.session_id = sessions.id 
      WHERE sessions.user_id = ?
    `, [user.id]);

    res.json({
      username: req.user.username,
      totalSessions: sessionsCount ? (sessionsCount.count || 0) : 0,
      totalMessages: messagesCount ? (messagesCount.count || 0) : 0
    });
  } catch (err) {
    console.error("Profile error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📚 SESSIONS
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const user = await ensureUser(req.user.username);

    const sessions = await dbAll('SELECT id, title FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    res.json({ sessions: sessions || [] });
  } catch (err) {
    console.error("Sessions error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📜 HISTORY
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const user = await ensureUser(req.user.username);

    const session = await dbGet('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
    if (!session) return res.json({ history: [] });

    const history = await dbAll('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC', [sessionId]);
    res.json({ history: history || [] });
  } catch (err) {
    console.error("History error:", err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🤖 CHAT
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.status(400).json({ error: 'Missing message or sessionId' });

    const user = await ensureUser(req.user.username);

    let session = await dbGet('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
    if (!session) {
      const title = message.substring(0, 30) + (message.length > 30 ? '...' : '');
      await dbRun('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)', [sessionId, user.id, title]);
    }

    await dbRun('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'user', message]);

    const previousChats = await dbAll('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 20', [sessionId]);
    
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(previousChats || []).map(c => ({ role: c.role, content: c.content }))
    ];

    const botReply = await getAIResponse(messages);

    await dbRun('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'assistant', botReply]);

    res.json({ response: botReply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: 'AI error: ' + (err.message || 'Server error') });
  }
});

// START SERVER 
initDB().catch(err => {
  console.error("Failed to initialize database:", err);
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
