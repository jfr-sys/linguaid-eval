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
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
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
  const publicPaths = ["/login", "/oral/", "/sign/", "/api/", "/quiz/", "/attest-form", "/form-languexpert"];
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
const programmeRoutes = require('./routes/programme');
app.use('/', programmeRoutes);
app.use('/oral', require('./routes/oral'));
app.get('/quiz/:token', function(req, res) { res.sendFile(require('path').join(__dirname, 'views/quiz.html')); });
app.use('/sign', require('./routes/sign'));
app.get('/form-languexpert', function(req, res) { res.sendFile(require('path').join(__dirname, 'views/form-languexpert.html')); });
app.get('/attest-form', function(req, res) { res.sendFile(require('path').join(__dirname, 'views/attest-form.html')); });


// ── Daily oral reminder cron ──────────────────────────────────────────────────
// Every day at 09:00, remind candidates who received a Calendly link but haven't
// booked yet. Sends every 3 days. Stops once oralBookedAt is set or oral is done.
const cron = require('node-cron');
const nodemailerCron = require('nodemailer');
const transporterCron = nodemailerCron.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
const CALENDLY_LINKS = {
  Hannah: 'https://calendly.com/coursdanglais24/english-oral-test',
  Anna:   'https://calendly.com/ajmalzy/30min',
  Louise: 'https://calendly.com/linguaid/formation-anglais',
  Joss:   'https://calendly.com/coursdanglais24/english-oral-test',
};

cron.schedule('0 9 * * *', function() {
  try {
    const dataPath = path.join(__dirname, 'data/candidates.json');
    const candidates = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let updated = false;

    candidates.forEach(function(c) {
      // Only chase candidates who: have a link sent, haven't booked, and aren't oral_done+
      if (!c.oralLinkSentAt) return;
      if (c.oralBookedAt) return;
      const doneStatuses = ['oral_done', 'final_report_done', 'programme_done'];
      if (doneStatuses.includes(c.status)) return;

      const lastReminder = c.oralLastReminderAt ? new Date(c.oralLastReminderAt).getTime() : new Date(c.oralLinkSentAt).getTime();
      if (now - lastReminder < THREE_DAYS_MS) return;

      // Send nudge
      const firstName = (c.name || '').split(' ')[0];
      const evaluator = c.oralEvaluator || 'Hannah';
      const calendlyUrl = CALENDLY_LINKS[evaluator] || CALENDLY_LINKS.Hannah;
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
        + '<p>Bonjour ' + firstName + ',</p>'
        + '<p>Petit rappel : votre entretien oral reste \u00e0 r\u00e9server. Cela ne prend que quelques secondes :</p>'
        + '<p><a href="' + calendlyUrl + '" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">R\u00e9server mon cr\u00e9neau</a></p>'
        + '<p>Bien cordialement,</p>'
        + '<img src="https://eval.linguaid.net/signature_joss.png" alt="Joss Frimond" style="max-width:400px;display:block;margin-top:8px">'
        + '</div>';

      transporterCron.sendMail({
        from: 'eval@linguaid.net',
        to: c.email,
        subject: 'Rappel : r\u00e9servez votre entretien oral',
        html: html,
      }, function(err) {
        if (err) { console.error('Reminder cron mail error', c.email, err); return; }
        console.log('Reminder sent to', c.name, c.email);
      });

      c.oralLastReminderAt = new Date().toISOString();
      updated = true;
    });

    if (updated) {
      fs.writeFileSync(dataPath, JSON.stringify(candidates, null, 2));
    }
  } catch(e) {
    console.error('Reminder cron error:', e);
  }
});
console.log('Oral reminder cron scheduled (daily 09:00)');

app.listen(PORT, () => {
  console.log(`Linguaid Eval running on port ${PORT}`);
});
