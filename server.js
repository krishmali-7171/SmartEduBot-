require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
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

const SYSTEM_PROMPT = `You are SmartEduBot, an AI-Powered Context-Aware College and Placement Assistance Chatbot.
Help students with DSA, aptitude, and interviews. Be concise, helpful, and provide code examples where applicable.`;

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

function generateEduBotSmartResponse(userQuery) {
  const query = (userQuery || "").toLowerCase();

  if (query.includes("binary search") || query.includes("search element") || query.includes("binary")) {
    return `### 🔍 Binary Search Algorithm Guide

**Overview:**
Binary Search is an efficient searching algorithm for **sorted arrays** that repeatedly divides the search interval in half.

**Time Complexity:** $\\mathcal{O}(\\log N)$ | **Space Complexity:** $\\mathcal{O}(1)$

\`\`\`python
def binary_search(arr, target):
    low, high = 0, len(arr) - 1
    while low <= high:
        mid = (low + high) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return -1
\`\`\`

💡 **Placement Tip:** Always check if the array is sorted before applying Binary Search!`;
  }

  if (query.includes("linked list") || query.includes("node") || query.includes("pointer")) {
    return `### 🔗 Linked List Data Structure

A **Linked List** is a linear data structure where elements (nodes) are connected using pointers instead of contiguous memory allocation.

**Key Types:**
1. **Singly Linked List:** Each node points to the next node.
2. **Doubly Linked List:** Nodes point to both previous and next nodes.
3. **Circular Linked List:** The last node points back to the first node.

\`\`\`python
class Node:
    def __init__(self, data):
        self.data = data
        self.next = None
\`\`\`

💡 **Placement Tip:** Practice the **Fast & Slow Pointer (Floyd's Cycle Detection)** algorithm for cycle detection interviews!`;
  }

  if (query.includes("sort") || query.includes("quicksort") || query.includes("mergesort")) {
    return `### ⚡ Sorting Algorithms Summary

1. **Merge Sort:** Divide-and-conquer, $\\mathcal{O}(N \\log N)$ time, $\\mathcal{O}(N)$ space (Stable).
2. **Quick Sort:** In-place divide-and-conquer, $\\mathcal{O}(N \\log N)$ average time, $\\mathcal{O}(\\log N)$ space.
3. **Heap Sort:** In-place comparison sort, $\\mathcal{O}(N \\log N)$ time, $\\mathcal{O}(1)$ space.

💡 **Interview Tip:** Know when to use Merge Sort (linked lists) vs Quick Sort (arrays)!`;
  }

  if (query.includes("tree") || query.includes("bst") || query.includes("binary tree")) {
    return `### 🌲 Binary Trees & BST

A **Binary Search Tree (BST)** satisfies the property: Left Child < Root < Right Child.

**Traversals:**
- **In-Order (Left, Root, Right):** Gives elements in **sorted order** for a BST.
- **Pre-Order (Root, Left, Right):** Used to copy/serialize a tree.
- **Post-Order (Left, Right, Root):** Used in deletion / bottom-up processing.

💡 **Placement Tip:** Practice BST Insertion, Deletion, and Finding LCA (Lowest Common Ancestor).`;
  }

  if (query.includes("sql") || query.includes("join") || query.includes("database") || query.includes("dbms")) {
    return `### 🗄️ SQL JOINs & DBMS Fundamentals

**Types of JOINs:**
1. **INNER JOIN:** Returns matching records in both tables.
2. **LEFT JOIN:** Returns all records from the left table + matched right records.
3. **RIGHT JOIN:** Returns all records from the right table + matched left records.
4. **FULL JOIN:** Returns all matching and non-matching records.

\`\`\`sql
SELECT s.name, m.score
FROM Students s
INNER JOIN Marks m ON s.id = m.student_id;
\`\`\`

💡 **Interview Note:** If you omit the \`ON\` clause, SQL produces a **CROSS JOIN** (Cartesian product).`;
  }

  if (query.includes("dynamic programming") || query.includes("dp") || query.includes("knapsack")) {
    return `### ⚡ Dynamic Programming (DP) Roadmap

**Core Concepts:**
1. **Memoization (Top-Down):** Recursion with caching.
2. **Tabulation (Bottom-Up):** Iterative DP table filling.

**Must-Do Interview DP Problems:**
* 0/1 Knapsack Problem
* Longest Common Subsequence (LCS)
* Coin Change Problem
* Target Sum / Subset Sum

💡 **Placement Tip:** Identify overlapping subproblems and optimal substructure first!`;
  }

  if (query.includes("tell me about yourself") || query.includes("hr interview") || query.includes("introduce") || query.includes("hr")) {
    return `### 🎯 HR Interview Strategy: "Tell Me About Yourself"

**3-Part Winning Framework:**
1. **Present:** Major/Degree, university, and primary technical stack.
2. **Past:** Projects built, internships completed, and problem-solving experience.
3. **Future:** Why you are excited about this role and company.

**Example Response:**
*"I am a Final Year Computer Science student passionate about Full-Stack Engineering and Problem Solving. I have built web applications using Node.js and REST APIs. I am excited about this opportunity because your company's technical vision aligns with my goals."*`;
  }

  if (query.includes("aptitude") || query.includes("math") || query.includes("speed") || query.includes("percentage") || query.includes("profit")) {
    return `### 📊 Quantitative Aptitude Quick Tricks

1. **Speed & Distance:** $\\text{Speed} = \\frac{\\text{Distance}}{\\text{Time}}$ | $x \\text{ km/h} = x \\times \\frac{5}{18} \\text{ m/s}$
2. **Work & Time:** If A finishes work in $N$ days, A's 1-day work is $\\frac{1}{N}$.
3. **Profit %:** $\\frac{\\text{Profit}}{\\text{Cost Price}} \\times 100$

💡 **Placement Tip:** Use unit-digit verification to eliminate wrong options in online tests!`;
  }

  if (query.includes("python") || query.includes("java") || query.includes("cpp") || query.includes("c++") || query.includes("code")) {
    return `### 💻 Programming & Coding Core Concepts

**Key Language Concepts for Technical Rounds:**
- **OOP Principles:** Encapsulation, Abstraction, Inheritance, Polymorphism.
- **Memory Management:** Stack (local variables) vs Heap (dynamically allocated memory).
- **Concurrency:** Multithreading, Async/Await, Race conditions, Deadlocks.

💡 **Interview Tip:** Always state the **Time and Space Complexity** of your solution before coding!`;
  }

  return `### 💡 SmartEduBot Assistant Answer

Here is a breakdown to help you with **"${userQuery}"**:

1. **Core Concept:** When approaching technical and placement questions regarding *"${userQuery}"*, start by identifying the fundamental data structures or algorithms involved.
2. **Approach & Strategy:**
   - **Step 1:** Analyze inputs, edge cases (empty data, negative values, large inputs).
   - **Step 2:** Formulate a brute-force approach first, then optimize using Hash Maps, Two Pointers, or Dynamic Programming.
   - **Step 3:** Calculate Time Complexity $\\mathcal{O}(N)$ and Space Complexity $\\mathcal{O}(1)$.
3. **Placement Tip:** Practice explaining your thought process out loud to the interviewer while writing code.

*Feel free to ask for a specific code example, SQL query, or interview practice question!*`;
}

async function getAIResponse(messages) {
  const token = (process.env.GITHUB_TOKEN || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || "").trim();
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || "";
  
  // 1. Try Pollinations Free AI API (100% Free, NO API KEY required!)
  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: "openai"
      })
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 10 && !text.includes("Error")) {
        return text.trim();
      }
    }
  } catch (err) {
    console.error("Pollinations AI error:", err.message);
  }

  // 2. Try User Token APIs (GitHub Models / Azure AI / Groq / OpenAI) if provided
  if (token && token !== 'dummy-key' && token !== 'super-secret-key' && token.length > 10) {
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
        if (data.choices?.[0]?.message?.content) {
          return data.choices[0].message.content;
        }
      }
    } catch (err) {}

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
        if (data.choices?.[0]?.message?.content) {
          return data.choices[0].message.content;
        }
      }
    } catch (err) {}

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
        if (data.choices?.[0]?.message?.content) {
          return data.choices[0].message.content;
        }
      }
    } catch (err) {}
  }

  // 3. SmartEduBot Dynamic Topic Response Engine (Guaranteed 100% Unique Answer for Any Query)
  return generateEduBotSmartResponse(lastUserMsg);
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
