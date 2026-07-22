// routes/mission.js
// Public: /mission/:token (brief page) and /mission/:token/devis (trainer's devis submission)
// Step 11 of the pipeline: demande de mission -> trainer's devis -> Linguaid accepts -> confirmation de mission

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { getTrainerContract } = require('../lib/trainerContracts');
const CONVOC_TRAINERS_NAMES = { anna: 'Anna', hannah: 'Hannah', leone: 'Leone', stephanie: 'Stephanie', natasha: 'Natasha', louisek: 'Louise', louiseg: 'Louise', lynsey: 'Lynsey' };

const DATA_PATH = path.join(__dirname, '../data/candidates.json');
const MISSION_DIR = path.join(__dirname, '../data/missions');

function loadCandidates() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveCandidates(candidates) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(candidates, null, 2));
}
function findByBriefToken(token) {
  const candidates = loadCandidates();
  return candidates.find(c => c.missionData && c.missionData.briefToken === token);
}

// GET /mission/:token - brief page shell
router.get('/:token', (req, res) => {
  const candidate = findByBriefToken(req.params.token);
  if (!candidate) return res.status(404).send('<h2>Lien invalide ou expiré.</h2>');
  res.sendFile(path.join(__dirname, '../views/mission_brief.html'));
});

// GET /mission/:token/data - JSON for the brief page to render
router.get('/:token/data', (req, res) => {
  const candidate = findByBriefToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: 'Invalid token' });

  const od = candidate.oralData || {};
  const md = candidate.missionData || {};
  const trainerName = CONVOC_TRAINERS_NAMES[md.trainerKey] || '';

  res.json({
    trainerFirstName: trainerName,
    candidateName: candidate.name || '',
    candidateCompany: candidate.company || '',
    level: od.targetLevel || '',
    coachingHours: od.coachingHours || od.totalHours || 0,
    homeworkHours: od.homeworkHours || 0,
    format: 'À distance, plusieurs rythmes possibles',
    startDate: od.dateStart || '',
    objective: od.trainingTitle || '',
    hasProgramme: fs.existsSync(path.join(__dirname, '../data/programmes/' + candidate.id + '.pdf'))
      || !!(candidate.programmePdfPath && fs.existsSync(candidate.programmePdfPath)),
    hasReportEN: fs.existsSync(path.join(__dirname, '../data/finalReports/' + candidate.id + '_en.pdf')),
    devisAlreadySubmitted: !!md.devisUploadedAt,
    devisDraft: !!(md.devisDraftAt && !md.devisUploadedAt),
    devisTotal: md.devisTotal || null,
    devisRate: md.devisRate || null,
    devisHomeworkRate: md.devisHomeworkRate || null,
    confirmationSigned: !!md.confirmationSignedAt,
  });
});

// POST /mission/:token/devis - trainer submits their own rate; server computes
// amounts and generates the devis PDF (never pre-fills the rate itself)
router.post('/:token/devis', express.json(), (req, res) => {
  const token = req.params.token;
  const candidates = loadCandidates();
  const idx = candidates.findIndex(c => c.missionData && c.missionData.briefToken === token);
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });

  const c = candidates[idx];
  const md = c.missionData;
  if (md.devisUploadedAt) return res.status(409).json({ error: 'Devis already submitted' });

  const contract = getTrainerContract(md.trainerKey);
  if (!contract) return res.status(500).json({ error: 'Trainer business info not on file - contact Linguaid' });

  const { coachingRate, homeworkRate } = req.body || {};
  if (coachingRate == null || homeworkRate == null) {
    return res.status(400).json({ error: 'Missing coachingRate or homeworkRate' });
  }

  const od = c.oralData || {};
  const today = new Date().toLocaleDateString('fr-FR');
  const args = {
    trainerName: contract.businessName,
    trainerSiret: contract.siret,
    trainerTel: contract.tel,
    trainerAddress: contract.address,
    trainerDeclaration: contract.declarationNumber,
    trainerPlace: contract.place,
    today,
    candidateName: c.name || '',
    candidateCompany: c.company || '',
    coachingDate: od.dateStart || today,
    coachingRate,
    coachingHours: od.coachingHours || od.totalHours || 0,
    homeworkDate: od.dateStart || today,
    homeworkRate,
    homeworkHours: od.homeworkHours || 0,
    outDir: MISSION_DIR,
    id: c.id,
  };

  execFile('python3', ['/home/debian/fill_devis.py', JSON.stringify(args)], { timeout: 60000 }, (err, stdout, stderr) => {
    if (err) { console.error('fill_devis error:', stderr, stdout); return res.status(500).json({ error: 'Devis generation failed' }); }
    let result;
    try { result = JSON.parse(stdout.trim()); } catch (e) { return res.status(500).json({ error: 'Invalid fill_devis output' }); }
    if (!result.success) return res.status(500).json({ error: result.error });

    candidates[idx].missionData = Object.assign(md, {
      devisRate: coachingRate,
      devisHomeworkRate: homeworkRate,
      devisTotal: result.total,
      devisPath: result.pdfPath,
      devisDraftAt: new Date().toISOString(),
    });
    saveCandidates(candidates);

    return res.json({ success: true, total: result.total, draft: true });
  });
});

// Trainer confirms their reviewed devis - only now is it considered issued
router.post('/:token/devis-confirm', express.json(), (req, res) => {
  const candidates = loadCandidates();
  const idx = candidates.findIndex(c => c.missionData && c.missionData.briefToken === req.params.token);
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });
  const c = candidates[idx];
  const md = c.missionData;
  if (md.devisUploadedAt) return res.status(409).json({ error: 'Devis already submitted' });
  if (!md.devisDraftAt || !md.devisPath) return res.status(400).json({ error: 'No draft devis to confirm' });
  const contract = getTrainerContract(md.trainerKey);
  if (!contract) return res.status(500).json({ error: 'Trainer business info not on file' });

  md.devisUploadedAt = new Date().toISOString();
  const crypto = require('crypto');
  md.devisSignToken = crypto.randomBytes(16).toString('hex');
  saveCandidates(candidates);
  const result = { total: md.devisTotal };
  const devisSignUrl = 'https://eval.linguaid.net/sign/devis/' + md.devisSignToken;

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    transporter.sendMail({
      from: 'noreply@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: `Devis reçu — ${c.name} (${contract.businessName})`,
      text: `${contract.businessName} a soumis un devis pour ${c.name} : ${result.total} € TTC.\n\nÀ signer (bon pour accord) ici : ${devisSignUrl}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7"><p><strong>${contract.businessName}</strong> a soumis un devis pour <strong>${c.name}</strong> : <strong>${result.total} € TTC</strong>.</p><p><a href="${devisSignUrl}" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Signer le devis (bon pour accord)</a></p></div>`,
    }).catch(e => console.error('Internal notify failed:', e));

    res.json({ success: true, total: result.total });
});

// Token-gated devis PDF so the trainer can review their own document
router.get('/:token/devis-pdf', (req, res) => {
  const candidate = findByBriefToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  const md = candidate.missionData || {};
  if (!md.devisPath || !fs.existsSync(md.devisPath)) return res.status(404).send('Devis not available');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="devis.pdf"');
  res.sendFile(md.devisPath);
});

// Token-gated documents for the trainer's decision: programme (FR) + final report (EN)
router.get('/:token/programme', (req, res) => {
  const candidate = findByBriefToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  let p = path.join(__dirname, '../data/programmes/' + candidate.id + '.pdf');
  if (!fs.existsSync(p) && candidate.programmePdfPath && fs.existsSync(candidate.programmePdfPath)) p = candidate.programmePdfPath;
  if (!fs.existsSync(p)) return res.status(404).send('Programme not available');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="programme.pdf"');
  res.sendFile(p);
});

router.get('/:token/report-en', (req, res) => {
  const candidate = findByBriefToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  const p = path.join(__dirname, '../data/finalReports/' + candidate.id + '_en.pdf');
  if (!fs.existsSync(p)) return res.status(404).send('Report not available');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="evaluation_report_en.pdf"');
  res.sendFile(p);
});

module.exports = router;
