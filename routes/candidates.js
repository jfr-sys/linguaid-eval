const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { canonicalCompany } = require('../lib/companies');

const dataDir = path.join(__dirname, '../data');
const upload = multer({ dest: path.join(__dirname, '../uploads/') });

function getCandidates() {
  const file = path.join(dataDir, 'candidates.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveCandidates(candidates) {
  fs.writeFileSync(path.join(dataDir, 'candidates.json'), JSON.stringify(candidates, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/candidates.html'));
});

router.get('/suivi', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/suivi.html'));
});

router.get('/company-report', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/company_report.html'));
});

router.get('/new', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/upload.html'));
});

router.get('/new-legal', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/new_legal.html'));
});

router.get('/new-renewal', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/new_renewal.html'));
});

router.get('/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/candidate.html'));
});

router.get('/api/list', (req, res) => {
  res.json(getCandidates());
});

router.get('/api/:id', (req, res) => {
  const candidates = getCandidates();
  const candidate = candidates.find(c => c.id === req.params.id);
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  res.json(candidate);
});

router.post('/upload-csv', upload.single('csv'), (req, res) => {
  try {
    const content = fs.readFileSync(req.file.path, 'utf8');
    const records = parse(content, { columns: true, skip_empty_lines: true });
    const row = records[0];

    const candidates = getCandidates();
    const id = generateId();

    const avail = {
      lundi: row['Lundi'] || '',
      mardi: row['Mardi'] || '',
      mercredi: row['Mercredi'] || '',
      jeudi: row['Jeudi'] || '',
      vendredi: row['Vendredi'] || ''
    };

    const goals = [];
    const goalCols = [
      'Se présenter et présenter son poste dans un contexte professionnel',
      'Participer efficacement à un appel téléphonique professionnel',
      'Rédiger des courriels professionnels clairs et structurés',
      'Décrire son poste, son entreprise et ses activités principales',
      'Organiser, confirmer ou reporter un rendez-vous ou une réunion',
      'Engager une conversation informelle dans un contexte professionnel',
      'Expliquer un problème simple et proposer une solution',
      'Participer à une discussion ou une réunion courte en exprimant ses idées',
      'Comprendre et utiliser le vocabulaire essentiel de son domaine professionnel',
      'Comprendre et donner des consignes ou procédures simples',
      'Répondre avec aisance à des questions déstabilisantes lors d\'une présentation orale',
      'Préparer et présenter efficacement une prise de parole stratégique ou un pitch professionnel (mission, équipe, institution)',
      'Mener une négociation simple ou intermédiaire en défendant ses intérêts tout en trouvant un compromis professionnel'
    ];
    goalCols.forEach(g => { if (row[g] && row[g].trim()) goals.push(row[g]); });

    const candidate = {
      id,
      name: row['Votre nom complet'] || '',
      email: row['Email'] || '',
      dept: row["Votre département au sein de votre organisaion"] || row["Votre département au sein de votre organisation"] || row["Votre département au sein d HEC"] || '',
      company: row["Votre département au sein d HEC"] ? 'HEC Paris' : '',
      jobtitle: row["Votre poste (fonction)"] || row["Votre poste"] || '',
      testdate: (row['Submit Date (UTC)'] || '').split(' ')[0],
      avail,
      goals,
      otherNeeds: row["Avez-vous d'autres attentes ou besoins spécifiques pour cette formation ?"] || '',
      freewriting: {
        q39: row["What do you do in your life now?\n(For example: your job, your studies, your hobbies, or your sports) Maximum 150 mots par réponse"] || '',
        q40: row["Tell us about the place where you grew up.\n(Where is it? How long did you live there? What did you do there?) Maximum 150 mots par réponse"] || '',
        q41: row["What is one plan you have for the future?\n(For example: a holiday, a project, or something you want to do) Maximum 150 mots par réponse"] || ''
      },
      scores: {
        total: parseFloat(row['quiz_score'] || row['Score'] || row['correct_answers'] || '0'),
        max: parseFloat(row['max_score'] || '30')
      },
      status: 'csv_uploaded',
      writtenReport: null,
      oralData: null,
      finalReport: null,
      oralToken: generateId(),
      createdAt: new Date().toISOString()
    };

    candidates.push(candidate);
    saveCandidates(candidates);
    fs.unlinkSync(req.file.path);

    res.json({ success: true, id: candidate.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/api/:id/report', (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  candidates[idx].finalReport = req.body.finalReport;
  saveCandidates(candidates);
  res.json({ success: true });
});

router.get('/:id/programme', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../views/programme.html'));
});

router.post('/api/:id/identity', (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name','email','company','jobtitle','dept','courseType'];
  allowed.forEach(k => { if (req.body[k] !== undefined) candidates[idx][k] = (k === 'company') ? canonicalCompany(req.body[k]) : req.body[k]; });
  if (req.body.civility !== undefined) {
    if (!candidates[idx].conventionData) candidates[idx].conventionData = {};
    candidates[idx].conventionData.civility = req.body.civility;
  }
  saveCandidates(candidates);
  res.json({ success: true });
});

router.post('/api/:id/company', (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  candidates[idx].company = canonicalCompany(req.body.company || '');
  saveCandidates(candidates);
  res.json({ success: true });
});

// ── Legal English candidate intake ──────────────────────────────────────────

router.get('/new-legal', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/new_legal.html'));
});



router.post('/api/new-legal', (req, res) => {
  try {
    const candidates = getCandidates();
    const id = generateId();
    const d = req.body;

    const candidate = {
      id,
      courseType:      'legal',
      name:            d.name || '',
      email:           d.email || '',
      phone:           d.phone || '',
      region:          d.region || '',
      lawyerType:      d.lawyerType || '',
      jobtitle:        d.jobtitle || '',
      company:         canonicalCompany(d.company || ''),
      dept:            canonicalCompany(d.company || ''),
      experience:      d.experience || '',
      legalDomains:    d.legalDomains || '',
      legalDocs:       d.legalDocs || '',
      selfLevelOral:   d.selfLevelOral || '',
      selfLevelWriting: d.selfLevelWriting || '',
      currentUsage:    d.currentUsage || '',
      mediaVO:         d.mediaVO || '',
      goalType:        d.goalType || '',
      mainGoal:        d.mainGoal || '',
      goals:           d.goals || [],
      upcomingEvent:   d.upcomingEvent || '',
      otherNeeds:      d.otherNeeds || '',
      financingMode:   d.financingMode || '',
      cpfCreated:      d.cpfCreated || false,
      source:          d.source || '',
      // Business English fields set to empty for legal candidates
      testdate:        '',
      avail:           {},
      freewriting:     { q39: '', q40: '', q41: '' },
      scores:          { total: 0, max: 0 },
      status:          d.isRenewal ? 'oral_done' : 'csv_uploaded',
      isRenewal:       d.isRenewal || false,
      writtenReport:   null,
      reportSummary:   null,
      oralData:        d.isRenewal && d.oralData ? { ...d.oralData, totalHours: parseInt(d.oralData.totalHours,10)||10, coachingHours: parseInt(d.oralData.coachingHours,10)||10, homeworkHours: parseInt(d.oralData.homeworkHours,10)||0 } : null,
      finalReport:     null,
      conventionData:  null,
      oralToken:       generateId(),
      createdAt:       new Date().toISOString()
    };

    candidates.push(candidate);
    saveCandidates(candidates);
    res.json({ success: true, id: candidate.id, candidateId: candidate.id, oralToken: candidate.oralToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/:id/cpf', function(req, res) {
  var candidates = getCandidates();
  var idx = candidates.findIndex(function(x){ return x.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (!candidates[idx].oralData) candidates[idx].oralData = {};
  candidates[idx].oralData.isCPF = !!req.body.isCPF;
  saveCandidates(candidates);
  res.json({ success: true });
});

module.exports = router;

router.delete('/api/:id', (req, res) => {
  const candidates = getCandidates();
  const filtered = candidates.filter(c => c.id !== req.params.id);
  if (filtered.length === candidates.length) return res.status(404).json({ error: 'Not found' });
  saveCandidates(filtered);
  res.json({ success: true });
});
