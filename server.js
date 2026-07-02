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
  const publicPaths = ["/login", "/oral/", "/sign/", "/api/", "/quiz/", "/attest-form", "/form-languexpert", "/company-report/", "/mon-parcours/"];
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
app.get('/company-report/:token', function(req, res) { res.sendFile(require('path').join(__dirname, 'views/company_report.html')); });
app.get('/mon-parcours/:token', function(req, res) { res.sendFile(require('path').join(__dirname, 'views/mon_parcours.html')); });


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

// == DIGEST_AND_NUDGE_CRONS ===================================================
// Pure builders (no I/O) so behaviour is testable.
function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function digestEsc(x) { return ('' + (x == null ? '' : x)).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function digestTable(headers, rows) {
  return '<table style="border-collapse:collapse;margin:6px 0 18px" cellpadding="0" cellspacing="0">'
    + '<tr>' + headers.map(function(h) { return '<th style="background:#1F4E79;color:white;padding:6px 12px;font-size:12px;text-align:left">' + h + '</th>'; }).join('') + '</tr>'
    + rows.map(function(r) { return '<tr>' + r.map(function(v) { return '<td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px">' + digestEsc(v) + '</td>'; }).join('') + '</tr>'; }).join('')
    + '</table>';
}
function buildCazDigest(candidates) {
  var rows = candidates.filter(function(c) {
    var cd = c.conventionData || {};
    return cd.sentToCatherineAt && !cd.convocationSentAt;
  }).map(function(c) {
    var cd = c.conventionData || {};
    var od = c.oralData || {};
    return [c.name, c.company || '\u2014', (od.totalHours || '\u2014') + 'h', od.dateStart || '\u2014', daysSince(cd.sentToCatherineAt) + ' j'];
  });
  if (!rows.length) return null;
  return '<div style="font-family:Arial,sans-serif;color:#222"><p>Bonjour Catherine,</p>'
    + '<p><strong>' + rows.length + '</strong> commande(s) en attente de convocation :</p>'
    + digestTable(['Candidat', 'Entreprise', 'Heures', 'D\u00e9but pr\u00e9vu', 'Depuis'], rows)
    + '<p style="font-size:12px"><a href="https://eval.linguaid.net/candidates/suivi">Ouvrir le suivi</a></p></div>';
}
function buildJossDigest(candidates) {
  var secs = [];
  function sec(title, headers, rows) { if (rows.length) secs.push('<h3 style="font-size:14px;color:#1F4E79;margin:14px 0 2px">' + title + ' (' + rows.length + ')</h3>' + digestTable(headers, rows)); }
  var oralDone = [], finalDone = [], propStale = [], convStale = [], quizPending = [];
  candidates.forEach(function(c) {
    var cd = c.conventionData || {};
    if (c.status === 'oral_done') oralDone.push([c.name, c.company || '\u2014']);
    if (c.status === 'final_report_done') finalDone.push([c.name, c.company || '\u2014']);
    if (cd.proposalSentAt && !c.proposalAcceptedAt && !cd.proposalAcceptedAt && !cd.signedAt && daysSince(cd.proposalSentAt) > 5) propStale.push([c.name, c.company || '\u2014', daysSince(cd.proposalSentAt) + ' j']);
    if (cd.generatedAt && cd.signingToken && !cd.signedAt && daysSince(cd.generatedAt) > 3) convStale.push([c.name, c.company || '\u2014', daysSince(cd.generatedAt) + ' j']);
    if (c.quizSentAt && !c.quizCompletedAt) quizPending.push([c.name, c.company || '\u2014', daysSince(c.quizSentAt) + ' j']);
  });
  sec('Oraux effectu\u00e9s \u2014 rapport final \u00e0 g\u00e9n\u00e9rer', ['Candidat', 'Entreprise'], oralDone);
  sec('Rapports finaux pr\u00eats \u2014 programme \u00e0 cr\u00e9er', ['Candidat', 'Entreprise'], finalDone);
  sec('Propositions sans r\u00e9ponse (> 5 j)', ['Candidat', 'Entreprise', 'Depuis'], propStale);
  sec('Conventions non sign\u00e9es (> 3 j)', ['Candidat', 'Entreprise', 'Depuis'], convStale);
  sec('Questionnaires Volet 2 en attente', ['Candidat', 'Entreprise', 'Depuis'], quizPending);
  if (!secs.length) return null;
  return '<div style="font-family:Arial,sans-serif;color:#222"><p>Bonjour Joss,</p><p>Point du jour :</p>' + secs.join('')
    + '<p style="font-size:12px"><a href="https://eval.linguaid.net/candidates">Ouvrir la liste des candidats</a></p></div>';
}
// Nudge selectors: return candidates due a reminder today (3-day rhythm).
function dueConventionNudges(candidates, now) {
  var T = 3 * 86400000;
  return candidates.filter(function(c) {
    var cd = c.conventionData || {};
    if (!cd.signingToken || !cd.generatedAt || cd.signedAt) return false;
    var last = cd.conventionLastReminderAt || cd.generatedAt;
    return (now - new Date(last).getTime()) >= T;
  });
}
function dueQuizNudges(candidates, now) {
  var T = 3 * 86400000;
  return candidates.filter(function(c) {
    if (!c.quizToken || !c.quizSentAt || c.quizCompletedAt || c.attestationSignedAt) return false;
    var last = c.quizLastReminderAt || c.quizSentAt;
    return (now - new Date(last).getTime()) >= T;
  });
}

// 08:30 - team digests
cron.schedule('30 8 * * *', function() {
  try {
    const dataPath = path.join(__dirname, 'data/candidates.json');
    const candidates = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const cazHtml = buildCazDigest(candidates);
    if (cazHtml) transporterCron.sendMail({ from: 'eval@linguaid.net', to: 'cfr@linguaid.net', cc: 'jfr@linguaid.net',
      subject: 'Commandes en attente de convocation', html: cazHtml },
      function(err) { if (err) console.error('Caz digest mail error', err); else console.log('Caz digest sent'); });
    const jossHtml = buildJossDigest(candidates);
    if (jossHtml) transporterCron.sendMail({ from: 'eval@linguaid.net', to: 'jfr@linguaid.net',
      subject: 'Linguaid Eval \u2014 point du jour', html: jossHtml },
      function(err) { if (err) console.error('Joss digest mail error', err); else console.log('Joss digest sent'); });
  } catch (e) { console.error('Digest cron error:', e); }
});

// 08:45 - candidate nudges (convention signature + quiz), 3-day rhythm
cron.schedule('45 8 * * *', function() {
  try {
    const dataPath = path.join(__dirname, 'data/candidates.json');
    const candidates = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const now = Date.now();
    let updated = false;

    dueConventionNudges(candidates, now).forEach(function(c) {
      const cd = c.conventionData;
      const url = 'https://eval.linguaid.net/sign/' + cd.signingToken;
      if (!c.progressToken) { c.progressToken = require('crypto').randomBytes(16).toString('hex'); updated = true; }
      const progressUrl = 'https://eval.linguaid.net/mon-parcours/' + c.progressToken;
      const who = cd.isThirdParty ? ((cd.civility || 'Madame') + ' ' + (cd.signatory || '')) : ((cd.civility || '') + ' ' + (c.name || ''));
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
        + '<p>Bonjour ' + digestEsc(who).trim() + ',</p>'
        + '<p>Petit rappel : la convention de formation' + (cd.isThirdParty ? ' de ' + digestEsc(c.name) : '') + ' reste \u00e0 signer. Cela ne prend qu\u2019une minute :</p>'
        + '<p><a href="' + url + '" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Signer la convention</a></p>'
        + '<p style="font-size:12px;color:#666">Lien direct : <a href="' + url + '">' + url + '</a></p>'
        + '<p style="font-size:12px"><a href="' + progressUrl + '">Suivre l\u2019avancement de mon dossier</a></p>'
        + '<p>Bien cordialement,</p>'
        + '<img src="https://eval.linguaid.net/signature_joss.png" style="max-width:400px;display:block;margin-top:8px">'
        + '</div>';
      transporterCron.sendMail({ from: 'jfr@linguaid.net', to: cd.signatoryEmail || c.email,
        subject: 'Rappel : convention de formation \u00e0 signer \u2014 ' + c.name, html: html },
        function(err) { if (err) console.error('Convention nudge mail error', c.email, err); else console.log('Convention nudge sent for', c.name); });
      cd.conventionLastReminderAt = new Date().toISOString();
      updated = true;
    });

    dueQuizNudges(candidates, now).forEach(function(c) {
      const url = 'https://eval.linguaid.net/quiz/' + c.quizToken;
      if (!c.progressToken) { c.progressToken = require('crypto').randomBytes(16).toString('hex'); updated = true; }
      const progressUrl = 'https://eval.linguaid.net/mon-parcours/' + c.progressToken;
      const firstName = (c.name || '').split(' ')[0];
      const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
        + '<p>Bonjour ' + digestEsc(firstName) + ',</p>'
        + '<p>Petit rappel : votre questionnaire de fin de module reste \u00e0 compl\u00e9ter. Vos r\u00e9ponses d\u00e9clenchent l\u2019\u00e9dition de votre attestation :</p>'
        + '<p><a href="' + url + '" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Acc\u00e9der au questionnaire</a></p>'
        + '<p style="font-size:12px;color:#666">Lien direct : <a href="' + url + '">' + url + '</a></p>'
        + '<p style="font-size:12px"><a href="' + progressUrl + '">Suivre l\u2019avancement de mon dossier</a></p>'
        + '<p>Bien cordialement,</p>'
        + '<p><strong>Catherine Frimond-Laubi\u00e8s</strong><br>Responsable suivi<br>cfr@linguaid.net</p>'
        + '</div>';
      transporterCron.sendMail({ from: 'cfr@linguaid.net', to: c.email,
        subject: 'Rappel : questionnaire de fin de module', html: html },
        function(err) { if (err) console.error('Quiz nudge mail error', c.email, err); else console.log('Quiz nudge sent for', c.name); });
      c.quizLastReminderAt = new Date().toISOString();
      updated = true;
    });

    if (updated) fs.writeFileSync(dataPath, JSON.stringify(candidates, null, 2));
  } catch (e) { console.error('Nudge cron error:', e); }
});
console.log('Digest crons scheduled (08:30 team, 08:45 candidate nudges)');
// == END DIGEST_AND_NUDGE_CRONS ===============================================


app.listen(PORT, () => {
  console.log(`Linguaid Eval running on port ${PORT}`);
});
