const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const coherence = require('../lib/coherence'); /* coherence-gate */

/* ORAL_SUBMIT_MERGE (2026-08-24)
   oralData used to be REPLACED by the submission payload, which destroyed every
   field written after the interview: cpfType, edofActionId, edofPrice, rsCode,
   edofMCFLink, trainingTitle, prereqLevel, targetLevel, objectives, topics,
   dateStart/dateEnd. The form stays authoritative for what it sends; anything
   it does not send survives.

   "Not sent" means undefined, null, or a blank string. 0 and false ARE values
   (homeworkHours 0 is real), and [] / {} ARE values (an evaluator clearing
   every goal must actually clear them). */
function mergeOralSubmission(existing, incoming) {
  var base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
  var body = (incoming && typeof incoming === 'object') ? incoming : {};
  var preserved = [];
  Object.keys(base).forEach(function (k) {
    var v = body[k];
    var absent = (v === undefined || v === null || (typeof v === 'string' && v.trim() === ''));
    if (absent && base[k] !== undefined && base[k] !== null && base[k] !== '') preserved.push(k);
  });
  Object.keys(body).forEach(function (k) {
    var v = body[k];
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v.trim() === '') return;
    base[k] = v;
  });
  if (preserved.length) {
    console.log('oral submit: preserved ' + preserved.length + ' field(s) not sent by the form -> ' + preserved.join(', '));
  }
  return coherence.deriveTotal(base);
}

const dataDir = path.join(__dirname, '../data');

const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 25,
  secure: false,
  tls: { rejectUnauthorized: false }
});

function getCandidates() {
  const file = path.join(dataDir, 'candidates.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveCandidates(candidates) {
  fs.writeFileSync(path.join(dataDir, 'candidates.json'), JSON.stringify(candidates, null, 2));
}

/* SECURITY_P1 (2026-07-27): /oral/preview routes removed - the public
   preview redirected to a REAL candidate's live token, exposing their
   name, email, scores and free-writing via /oral/data (audit D2). */

router.get('/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.oralToken === req.params.token);
  if (!candidate) return res.status(404).send('Assessment link not found or expired.');
  // Classic oral form for ALL candidates - the specialised legal flow lives
  // exclusively at /oral/intake/:token (Joss's needs-analysis intake).
  const formFile = 'oral.html';
  res.sendFile(path.join(__dirname, '../views', formFile));
});

router.get('/data/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.oralToken === req.params.token || c.intakeToken === req.params.token);
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  res.json({
    name: candidate.name,
    email: candidate.email || null,
    jobtitle: candidate.jobtitle,
    dept: candidate.dept,
    company: candidate.company,
    courseType: candidate.courseType,
    goals: candidate.goals,
    otherNeeds: candidate.otherNeeds,
    avail: candidate.avail,
    freewriting: candidate.freewriting,
    scores: candidate.scores,
    reportSummary: candidate.reportSummary || null,
    // Legal English fields from prospect questionnaire
    legalDomains:    candidate.legalDomains    || null,
    legalDocs:       candidate.legalDocs       || null,
    experience:      candidate.experience      || null,
    lawyerType:      candidate.lawyerType      || null,
    selfLevelWriting: candidate.selfLevelWriting || null,
    selfLevelOral:   candidate.selfLevelOral   || null,
    currentUsage:    candidate.currentUsage    || null,
    upcomingEvent:   candidate.upcomingEvent   || null,
    financingMode:   candidate.financingMode   || null,
    cpfCreated:      candidate.cpfCreated      || null,
  });
});

router.post('/submit/:token', async (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.oralToken === req.params.token);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  /* ORAL_SUBMIT_MERGE (2026-08-24): merge, never replace */
  candidates[idx].oralData = mergeOralSubmission(candidates[idx].oralData, req.body);
  candidates[idx].status = 'oral_done';

  /* LEGAL_ORAL_WRITTEN_LEVELS (2026-08-24)
     Written-skill levels supplied during the interview go straight into
     reportSummary, so no second pass through the Niveaux panel is needed.
     MERGE, never replace - and stamp levelsManuallyEditedAt so the guard in
     /api/generate-written protects them like any hand-entered level. */
  (function () {
    var VALID = ['A1','A1+','A2','A2+','B1','B1+','B2','B2+','C1','C1+','C2'];
    var b = req.body || {};
    var map = { grammarLevel: b.grammarLevel, writingLevel: b.writingLevel, readingLevel: b.readingLevel };
    var wrote = false;
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (!v || VALID.indexOf(v) === -1) return;      /* blank or junk: leave alone */
      candidates[idx].reportSummary = candidates[idx].reportSummary || {};
      candidates[idx].reportSummary[k] = v;
      wrote = true;
    });
    if (wrote) {
      candidates[idx].levelsManuallyEditedAt = new Date().toISOString();
      console.log('oral submit: written levels captured in interview for ' + candidates[idx].id);
    }
  })();

  saveCandidates(candidates);

  const candidate = candidates[idx];
  const evaluator = req.body.evaluator || 'Unknown evaluator';
  const candidateUrl = `https://eval.linguaid.net/candidates/${candidate.id}`;

  try {
    await transporter.sendMail({
      from: 'eval@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: `Oral assessment submitted — ${candidate.name}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1F4E79;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:white;font-size:20px;margin:0">linguaid eval</h1>
          </div>
          <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none">
            <h2 style="color:#1F4E79;font-size:18px;margin:0 0 16px">Oral assessment submitted</h2>
            <p style="color:#334155;font-size:15px;margin:0 0 24px">An evaluator has completed the oral assessment for <strong>${candidate.name}</strong>. The final report is ready to generate.</p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Candidate</td><td style="padding:8px 0;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${candidate.name}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Job title</td><td style="padding:8px 0;font-size:13px;border-bottom:1px solid #e2e8f0">${candidate.jobtitle || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Company</td><td style="padding:8px 0;font-size:13px;border-bottom:1px solid #e2e8f0">${candidate.dept || '—'}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Evaluator</td><td style="padding:8px 0;font-size:13px;border-bottom:1px solid #e2e8f0">${evaluator}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Session date</td><td style="padding:8px 0;font-size:13px">${req.body.sessionDate || '—'}</td></tr>
            </table>
            <a href="${candidateUrl}" style="display:inline-block;background:#1F4E79;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Generate final report →</a>
          </div>
        </div>
      `
    });
    console.log(`Email sent for ${candidate.name}`);
  } catch (err) {
    console.error('Email error:', err.message);
  }

  res.json({ success: true });
});


// ── Legal intake form routes ───────────────────────────────────────────────

router.get('/intake/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.intakeToken === req.params.token);
  if (!candidate) return res.status(404).send('Lien d\u2019entretien invalide ou expiré.');
  res.sendFile(path.join(__dirname, '../views/oral_intake.html'));
});

// /oral/data/:token already handles intakeToken — add fallback
router.get('/intake-data/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.intakeToken === req.params.token);
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: candidate.id,
    name: candidate.name,
    email: candidate.email || null,
    jobtitle: candidate.jobtitle,
    company: candidate.company,
    dept: candidate.dept,
    lawyerType: candidate.lawyerType || null,
    courseType: candidate.courseType,
  });
});

router.post('/submit-intake/:token', express.json(), async (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.intakeToken === req.params.token);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  /* ORAL_SUBMIT_MERGE (2026-08-24): merge, never replace */
  candidates[idx].oralData = mergeOralSubmission(candidates[idx].oralData, req.body);
  candidates[idx].status = 'oral_done';
  saveCandidates(candidates);

  const candidate = candidates[idx];
  const candidateUrl = 'https://eval.linguaid.net/candidates/' + candidate.id;

  try {
    await transporter.sendMail({
      from: 'eval@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: 'Entretien de positionnement enregistr\u00e9 \u2014 ' + candidate.name,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1F4E79;padding:24px 32px;border-radius:8px 8px 0 0">
            <h1 style="color:white;font-size:20px;margin:0">linguaid eval</h1>
          </div>
          <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none">
            <h2 style="color:#1F4E79;font-size:18px;margin:0 0 16px">Entretien de positionnement enregistr\u00e9</h2>
            <p style="color:#334155;font-size:15px;margin:0 0 24px">
              L\u2019entretien de positionnement pour <strong>${candidate.name}</strong> a \u00e9t\u00e9 enregistr\u00e9.
              Le rapport final est pr\u00eat \u00e0 \u00eatre g\u00e9n\u00e9r\u00e9.
            </p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Candidat</td><td style="padding:8px 0;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${candidate.name}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Poste</td><td style="padding:8px 0;font-size:13px;border-bottom:1px solid #e2e8f0">${candidate.jobtitle || '\u2014'}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">Entreprise</td><td style="padding:8px 0;font-size:13px;border-bottom:1px solid #e2e8f0">${candidate.company || '\u2014'}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-size:13px">Programme recommand\u00e9</td><td style="padding:8px 0;font-size:13px">${req.body.recommendedProgramme || '\u2014'}</td></tr>
            </table>
            <a href="${candidateUrl}" style="display:inline-block;background:#1F4E79;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">G\u00e9n\u00e9rer le rapport final \u2192</a>
          </div>
        </div>
      `
    });
  } catch (err) {
    console.error('Intake email error:', err.message);
  }

  res.json({ success: true });
});


module.exports = router;
