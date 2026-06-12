const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

router.get('/preview', (req, res) => {
  var fs = require('fs');
  var dataPath = require('path').join(__dirname, '../data/candidates.json');
  var candidates = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  // Find a candidate with oralData (already assessed) for a realistic preview
  var c = candidates.find(function(x) { return x.oralToken && x.oralData; }) || candidates.find(function(x) { return x.oralToken; });
  if (c) {
    res.redirect('/oral/preview/' + c.oralToken);
  } else {
    res.send('No candidates found for preview');
  }
});

router.get('/preview/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/oral_v2.html'));
});

router.get('/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.oralToken === req.params.token);
  if (!candidate) return res.status(404).send('Assessment link not found or expired.');
  // Serve legal English form for legal English candidates
  const isLegal = candidate.courseType === 'legal' || candidate.company === 'legal';
  const formFile = isLegal ? 'oral_legal.html' : 'oral.html';
  res.sendFile(path.join(__dirname, '../views', formFile));
});

router.get('/data/:token', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.oralToken === req.params.token);
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

  candidates[idx].oralData = req.body;
  candidates[idx].status = 'oral_done';
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

module.exports = router;
