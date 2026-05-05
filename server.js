require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev';

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error opening database:', err);
  else console.log('Connected to SQLite database.');
});

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    username TEXT,
    title TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    username TEXT,
    role TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configure OpenAI to use GitHub Models
const openai = new OpenAI({
  apiKey: process.env.GITHUB_TOKEN,
  baseURL: 'https://models.inference.ai.azure.com'
});

const SYSTEM_PROMPT = `You are SmartEduBot, an AI-Powered Context-Aware College and Placement Assistance Chatbot. Your goal is to help students prepare for their placements, college coursework, and interviews.
You should be professional, encouraging, and knowledgeable.
You can help with:
1. DSA (Data Structures and Algorithms) questions (arrays, strings, trees, etc.) - provide hints first, then solutions if asked.
2. Aptitude questions - provide numerical or logical reasoning questions and evaluate answers.
3. Mock interview mode - ask HR questions, wait for the user's answer, and evaluate their response with constructive feedback.

If the user wants a mock interview, start by asking a typical HR question and wait for their response. Evaluate it, then ask the next one.
Always be concise but informative.`;

// Middleware for token authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) return res.status(401).json({ error: 'Access denied. No auth token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired auth token. Please login again.' });
    req.user = user; 
    next();
  });
};

// --- AUTH ENDPOINTS ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Username already exists' });
        }
        return res.status(500).json({ error: 'Database error during registration' });
      }
      
      const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ message: 'Registered successfully', token });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, row.password);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  });
});

// Helper functions for DB
const getSessionsFromDB = (username) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM sessions WHERE username = ? ORDER BY updated_at DESC`, [username], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const getHistoryFromDB = (sessionId) => {
  return new Promise((resolve, reject) => {
    db.all(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC`, [sessionId], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const saveMessageToDB = (sessionId, username, role, content) => {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO messages (session_id, username, role, content) VALUES (?, ?, ?, ?)`, 
      [sessionId, username, role, content], function(err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
};

const ensureSessionExists = (sessionId, username, firstMessage) => {
  return new Promise((resolve, reject) => {
    db.get(`SELECT id FROM sessions WHERE id = ?`, [sessionId], (err, row) => {
      if (err) return reject(err);
      if (!row) {
        // Create new session, use first few words of message as title
        let title = firstMessage.substring(0, 30);
        if (firstMessage.length > 30) title += '...';
        
        db.run(`INSERT INTO sessions (id, username, title) VALUES (?, ?, ?)`, [sessionId, username, title], (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      } else {
        // Update the timestamp
        db.run(`UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [sessionId], (err) => {
          if (err) reject(err);
          else resolve(false);
        });
      }
    });
  });
};

// --- CHAT ENDPOINTS ---
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await getSessionsFromDB(req.user.username);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve sessions' });
  }
});

app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const username = req.user.username;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    // 1. Ensure session exists, update title if new
    await ensureSessionExists(sessionId, username, message);

    // 2. Save user message to DB
    await saveMessageToDB(sessionId, username, 'user', message);

    // 3. Retrieve conversation history
    const history = await getHistoryFromDB(sessionId);

    // 4. Prepare messages for OpenAI
    let messagesToSend = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
    ];

    if (messagesToSend.length > 21) {
       messagesToSend = [
         messagesToSend[0], 
         ...messagesToSend.slice(messagesToSend.length - 20)
       ];
    }

    // 5. Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messagesToSend,
      temperature: 0.7,
    });

    const botMessage = response.choices[0].message.content;
    
    // 6. Save bot response to DB
    await saveMessageToDB(sessionId, username, 'assistant', botMessage);

    res.json({ response: botMessage });
  } catch (error) {
    console.error('Error with OpenAI API or DB:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your request.',
      details: error.message 
    });
  }
});

app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const history = await getHistoryFromDB(sessionId);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    
    db.get(`SELECT COUNT(*) as totalMessages FROM messages WHERE username = ? AND role = 'user'`, [username], (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      
      db.get(`SELECT COUNT(*) as totalSessions FROM sessions WHERE username = ?`, [username], (err, sessRow) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        res.json({
          username: username,
          totalMessages: row.totalMessages,
          totalSessions: sessRow.totalSessions
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
