require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';

// In-memory user store (temporary)
const users = [];

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// OpenAI config (GitHub Models)
const openai = new OpenAI({
  apiKey: process.env.GITHUB_TOKEN,
  baseURL: 'https://models.inference.ai.azure.com'
});

const SYSTEM_PROMPT = `You are SmartEduBot, an AI-Powered Context-Aware College and Placement Assistance Chatbot.
Help students with DSA, aptitude, and interviews.
Be concise and helpful.`;

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
  const { username, password } = req.body;

  const existingUser = users.find(u => u.username === username);
  if (existingUser) return res.status(400).json({ error: 'User exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  users.push({ username, password: hashedPassword });

  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token });
});

// 🔑 LOGIN
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token });
});

// 🤖 CHAT
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
    });

    const botReply = response.choices[0].message.content;

    res.json({ response: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI error' });
  }
});

// 🚀 START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});