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


/* SECURITY_P1 (2026-07-27): the /claude-bridge remote file/exec endpoint
   was removed - it allowed arbitrary shell execution and unconfined
   filesystem read/write (audit finding D1). */

module.exports = router;
