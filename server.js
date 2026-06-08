const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.set("trust proxy", 1);
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'linguaid2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Auth middleware
app.use((req, res, next) => {
  const publicPaths = ["/login", "/oral/", "/sign/", "/api/"];
  const isPublic = publicPaths.some(p => req.path.startsWith(p));
  if (!req.session.user && !isPublic) {
    return res.redirect('/login');
  }
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/candidates', require('./routes/candidates'));
app.use('/api', require('./routes/api'));
app.use('/oral', require('./routes/oral'));
app.use('/sign', require('./routes/sign'));

app.listen(PORT, () => {
  console.log(`Linguaid Eval running on port ${PORT}`);
});
