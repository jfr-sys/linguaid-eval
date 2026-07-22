const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const USERS = [
  { id: 1, name: 'Joss', username: 'joss', password: bcrypt.hashSync('linguaid2026', 10), role: 'admin' },
  { id: 2, name: 'Caz', username: 'caz', password: bcrypt.hashSync('linguaid2026', 10), role: 'evaluator' },
  { id: 3, name: 'Romina', username: 'romina', password: bcrypt.hashSync('cMxYT6pYVhpc', 10), role: 'evaluator' },
];

router.get('/', (req, res) => res.redirect('/candidates'));

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/candidates');
  res.sendFile(require('path').join(__dirname, '../views/login.html'));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.redirect('/login?error=1');
  }
  req.session.user = { id: user.id, name: user.name, role: user.role };
  res.redirect('/candidates');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});


// Claude bridge - allows remote file operations
const CLAUDE_TOKEN = process.env.CLAUDE_BRIDGE_TOKEN;
router.post('/claude-bridge', express.json(), (req, res) => {
  if (!CLAUDE_TOKEN || req.headers['x-claude-token'] !== CLAUDE_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { action, path: filePath, content } = req.body;
  const fs = require('fs');
  const { execSync } = require('child_process');
  const safePath = '/var/www/vhosts/linguaid.net/eval.linguaid.net/app/';
  
  try {
    if (action === 'read') {
      const data = fs.readFileSync(filePath, 'utf8');
      return res.json({ success: true, content: data });
    }
    if (action === 'write') {
      fs.writeFileSync(filePath, content, 'utf8');
      return res.json({ success: true });
    }
    if (action === 'exec') {
      const out = execSync(filePath, { cwd: safePath, timeout: 30000 }).toString();
      return res.json({ success: true, output: out });
    }
    if (action === 'list') {
      const files = fs.readdirSync(filePath);
      return res.json({ success: true, files });
    }
    res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
