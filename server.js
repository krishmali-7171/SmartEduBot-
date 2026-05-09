require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// OpenAI config (GitHub Models)
const openai = new OpenAI({
  baseURL: 'https://models.github.ai/inference',
  apiKey: process.env.GITHUB_TOKEN
});

const SYSTEM_PROMPT = `You are SmartEduBot, an AI-Powered Context-Aware College and Placement Assistance Chatbot.
Help students with DSA, aptitude, and interviews.
Be concise and helpful.`;

let db;

// Initialize Database
async function initDB() {
  db = await open({
    filename: './database.sqlite',
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
}

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

// 🧑 REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) return res.status(400).json({ error: 'User exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🔑 LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📊 PROFILE
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id FROM users WHERE username = ?', [req.user.username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessionsCount = await db.get('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [user.id]);
    const messagesCount = await db.get(`
      SELECT COUNT(*) as count FROM messages 
      JOIN sessions ON messages.session_id = sessions.id 
      WHERE sessions.user_id = ?
    `, [user.id]);

    res.json({
      username: req.user.username,
      totalSessions: sessionsCount.count || 0,
      totalMessages: messagesCount.count || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📚 SESSIONS
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const user = await db.get('SELECT id FROM users WHERE username = ?', [req.user.username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessions = await db.all('SELECT id, title FROM sessions WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    res.json({ sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 📜 HISTORY
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

    const user = await db.get('SELECT id FROM users WHERE username = ?', [req.user.username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Verify session belongs to user
    const session = await db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
    if (!session) return res.json({ history: [] });

    const history = await db.all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC', [sessionId]);
    res.json({ history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// 🤖 CHAT
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || !sessionId) return res.status(400).json({ error: 'Missing message or sessionId' });

    const user = await db.get('SELECT id FROM users WHERE username = ?', [req.user.username]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Ensure session exists, or create it
    let session = await db.get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
    if (!session) {
      const title = message.substring(0, 30) + (message.length > 30 ? '...' : '');
      await db.run('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)', [sessionId, user.id, title]);
    }

    // Save user message
    await db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'user', message]);

    // Fetch previous context
    const previousChats = await db.all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 20', [sessionId]);
    
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...previousChats.map(c => ({ role: c.role, content: c.content }))
    ];

    const response = await openai.chat.completions.create({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: 1.0,
      top_p: 1.0,
      max_tokens: 1000,
    });

    const botReply = response.choices[0].message.content;

    // Save bot reply
    await db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'assistant', botReply]);

    res.json({ response: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI error' });
  }
});

// 🚀 START SERVER
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
});