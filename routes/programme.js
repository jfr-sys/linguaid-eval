'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');
const { assertValidCpfType, getAction, CATALOGUE } = require('../config/catalogue');


function calc5SkillLevel(c) {
  var rs = c.reportSummary || {};
  var od = c.oralData || {};
  var cefrMap = {'A1':0,'A1+':0.5,'A2':1,'A2+':1.5,'B1':2,'B1+':2.5,'B2':3,'B2+':3.5,'C1':4,'C1+':4.5,'C2':5};
  var cefrRev = {0:'A1',0.5:'A1+',1:'A2',1.5:'A2+',2:'B1',2.5:'B1+',3:'B2',3.5:'B2+',4:'C1',4.5:'C1+',5:'C2'};
  var levels = [rs.grammarLevel, rs.writingLevel, rs.readingLevel, od.listeningLevel, od.speakingLevel]
    .map(function(l){ return cefrMap[l]; })
    .filter(function(n){ return typeof n === 'number'; });
  if (levels.length === 5) {
    var avg = levels.reduce(function(a,b){return a+b;},0) / 5;
    var rounded = Math.round(avg * 2) / 2;
    return cefrRev[rounded] || rs.overallLevel || '';
  }
  return rs.overallLevel || '';
}

const dataDir = path.join(__dirname, '../data');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getCandidates() {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));
}
function saveCandidates(data) {
  fs.writeFileSync(path.join(dataDir, 'candidates.json'), JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// POST /candidates/api/:id/cpf-type
// Saves cpfType to oralData. Resets edofActionId if type changes.
// ---------------------------------------------------------------------------
router.post('/api/candidates/api/:id/cpf-type', function(req, res) {
  var candidates = getCandidates();
  var idx = candidates.findIndex(function(x) { return x.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  var cpfType = req.body.cpfType;
  var validTypes = ['E360', 'E360_LEGAL', 'CAJA'];
  if (!validTypes.includes(cpfType)) {
    return res.status(400).json({ error: 'Invalid cpfType: ' + cpfType });
  }
  if (!candidates[idx].oralData) candidates[idx].oralData = {};
  // Reset EDOF action if type changed
  if (candidates[idx].oralData.cpfType !== cpfType) {
    candidates[idx].oralData.edofActionId = null;
    candidates[idx].oralData.edofPrice = null;
    candidates[idx].oralData.edofMCFLink = null;
  }
  candidates[idx].oralData.cpfType = cpfType;
  saveCandidates(candidates);
  res.json({ success: true, cpfType: cpfType });
});

// ---------------------------------------------------------------------------
// POST /candidates/api/:id/edof-action
// Saves selected EDOF action and derives hours/price/link from catalogue.
// ---------------------------------------------------------------------------
router.post('/api/candidates/api/:id/edof-action', function(req, res) {
  var candidates = getCandidates();
  var idx = candidates.findIndex(function(x) { return x.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  var od = candidates[idx].oralData || {};
  var cpfType = od.cpfType;
  if (!cpfType) return res.status(400).json({ error: 'cpfType must be set before selecting an EDOF action' });
  var actionId = req.body.edofActionId;
  var action = getAction(cpfType, actionId);
  if (!action) {
    return res.status(400).json({ error: 'Action ' + actionId + ' not found in catalogue for cpfType ' + cpfType });
  }
  if (!candidates[idx].oralData) candidates[idx].oralData = {};
  candidates[idx].oralData.edofActionId   = action.id;
  candidates[idx].oralData.totalHours     = action.totalHours;
  candidates[idx].oralData.coachingHours  = action.coachingHours;
  candidates[idx].oralData.homeworkHours  = action.tpHours;
  candidates[idx].oralData.edofPrice      = action.price;
  candidates[idx].oralData.edofMCFLink    = action.link;
  saveCandidates(candidates);
  res.json({ success: true, action: action });
});

// ---------------------------------------------------------------------------
// GET /api/catalogue/:cpfType
// Returns available EDOF actions for a given cpfType (used by programme.html)
// ---------------------------------------------------------------------------
router.get('/api/catalogue/:cpfType', function(req, res) {
  var cpfType = req.params.cpfType;
  var actions = CATALOGUE[cpfType];
  if (!actions) return res.status(400).json({ error: 'Unknown cpfType: ' + cpfType });
  res.json({ success: true, cpfType: cpfType, actions: actions });
});

// ---------------------------------------------------------------------------
// POST /suggest-topics/:id
// AI suggestion of topics and objectives from the evaluation report
// ---------------------------------------------------------------------------
router.post('/api/suggest-topics/:id', async function(req, res) {
  var candidates = getCandidates();
  var c = candidates.find(function(x) { return x.id === req.params.id; });
  if (!c) return res.status(404).json({ error: 'Not found' });
  var topics = req.body.topics || [];
  var objectives = req.body.objectives || [];
  var report = (c.finalReport || c.writtenReport || '').substring(0, 3000);
  if (!report) return res.status(400).json({ error: 'No report available' });
  var topicList = topics.map(function(t, i) { return (i + 1) + '. ' + t; }).join('\n');
  var objList = objectives.map(function(o, i) { return (i + 1) + '. ' + o; }).join('\n');
  var prompt = 'Based on this English evaluation report, select the most relevant training topics and suggest 3 learning objectives.\n\nAVAILABLE TOPICS:\n' + topicList + '\n\nAVAILABLE OBJECTIVES:\n' + objList + '\n\nREPORT:\n' + report + '\n\nRespond ONLY with valid JSON: {"topics": ["exact topic name"], "objectives": ["exact objective"]}';
  try {
    var msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    var text = msg.content[0].text.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    res.json({ success: true, ...JSON.parse(text) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// GET /generate-programme/:id
// Main programme document generation — calls fill_programme_final.py
// FAILSAFE: blocks generation if isCPF=true and cpfType is missing/invalid
// ---------------------------------------------------------------------------
router.get('/api/generate-programme/:id', async function(req, res) {
  var candidates = getCandidates();
  var c = candidates.find(function(cand) { return cand.id === req.params.id; });
  if (!c) return res.status(404).json({ error: 'Not found' });

  var payload;
  if (req.query.data) {
    try { payload = JSON.parse(req.query.data); } catch (e) { return res.status(400).json({ error: 'Invalid data' }); }
  } else {
    var od = c.oralData || {};
    payload = {
      candidateName: c.name,
      jobtitle: c.jobtitle || '',
      dept: c.dept || '',
      company: c.company || '',
      prereqLevel: calc5SkillLevel(c) || od.prereqLevel || '',
      targetLevel: od.targetLevel || '',
      totalHours: String(od.totalHours || 10),
      coachingHours: String(od.coachingHours || od.totalHours || 10),
      homeworkHours: String(od.homeworkHours || 0),
      isCPF: !!(od.isCPF),
      cpfType: od.cpfType || null,
      edofActionId: od.edofActionId || null,
      edofPrice: od.edofPrice || null,
      edofMCFLink: od.edofMCFLink || null,
      topics: od.topics || [],
      objectives: od.objectives || od.validatedGoals || [],
      dateStart: od.dateStart || '',
      dateEnd: od.dateEnd || '',
      trainingTitle: od.trainingTitle || (c.courseType === 'legal' ? 'Formation en Anglais Juridique' : 'Formation en Anglais Professionnel')
    };
  }

  // FAILSAFE: block CPF generation if cpfType is missing or unrecognised
  if (payload.isCPF) {
    try {
      assertValidCpfType(payload.cpfType);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  var tmpJson = '/tmp/prog_' + req.params.id + '.json';
  var tmpOut  = '/tmp/prog_' + req.params.id + '.docx';
  var template = path.join(__dirname, '../views/template_programme.docx');
  var script   = '/home/debian/fill_programme_final.py';

  // Build dateStr
  var dateStr = 'Dates \u00e0 d\u00e9finir';
  if (payload.dateStart && payload.dateEnd) {
    var ds = new Date(payload.dateStart);
    var de = new Date(payload.dateEnd);
    var months = ['janvier', 'f\u00e9vrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'ao\u00fbt', 'septembre', 'octobre', 'novembre', 'd\u00e9cembre'];
    dateStr = 'Du ' + ds.getDate() + ' ' + months[ds.getMonth()] + ' ' + ds.getFullYear() + ' au ' + de.getDate() + ' ' + months[de.getMonth()] + ' ' + de.getFullYear();
  }
  payload.dateStr = dateStr;

  console.log('PROGRAMME PAYLOAD:', JSON.stringify({ isCPF: payload.isCPF, cpfType: payload.cpfType, edofActionId: payload.edofActionId, topicsCount: (payload.topics || []).length, topics: payload.topics }));

  // Save dates and EDOF fields to candidate record
  var candidates2 = getCandidates();
  var cidx = candidates2.findIndex(function(x) { return x.id === req.params.id; });
  if (cidx >= 0 && payload.dateStart) {
    candidates2[cidx].oralData.dateStart = payload.dateStart;
    candidates2[cidx].oralData.dateEnd   = payload.dateEnd || payload.dateStart;
    if (payload.targetLevel)  candidates2[cidx].oralData.targetLevel  = payload.targetLevel;
    if (payload.totalHours)   candidates2[cidx].oralData.totalHours   = parseInt(payload.totalHours, 10) || payload.totalHours;
    if (payload.topics && payload.topics.length) candidates2[cidx].oralData.topics = payload.topics;
    if (Array.isArray(payload.objectiveSuffixes)) candidates2[cidx].oralData.objectiveSuffixes = payload.objectiveSuffixes;
    if (payload.trainingTitle) candidates2[cidx].oralData.trainingTitle = payload.trainingTitle;
    saveCandidates(candidates2);
  }

  fs.writeFileSync(tmpJson, JSON.stringify(payload));

  execFile('python3', [script, tmpJson, template, tmpOut], function(err, stdout, stderr) {
    if (err) {
      console.error('Programme script error:', stderr);
      return res.status(500).json({ error: 'Programme generation failed: ' + stderr });
    }
    try {
      var buffer = fs.readFileSync(tmpOut);
      var safeName = (payload.candidateName || 'Candidat').replace(/\s+/g, '_');
      var filename = 'Programme_formation_' + safeName + '.docx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      res.send(buffer);

      // Save permanent copy and convert to PDF
      var progDir = path.join(__dirname, '../data/programmes');
      if (!fs.existsSync(progDir)) fs.mkdirSync(progDir, { recursive: true });
      var permDocx = path.join(progDir, req.params.id + '.docx');
      var permPdf  = path.join(progDir, req.params.id + '.pdf');
      fs.copyFileSync(tmpOut, permDocx);

      execFile('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', progDir, permDocx], function(pdfErr) {
        if (pdfErr) {
          console.error('Programme PDF conversion failed:', pdfErr);
        } else {
          var cands3 = getCandidates();
          var ci3 = cands3.findIndex(function(x) { return x.id === req.params.id; });
          if (ci3 > -1) { cands3[ci3].programmePdfPath = permPdf; saveCandidates(cands3); }
        }
      });

      fs.unlinkSync(tmpJson);
      fs.unlinkSync(tmpOut);

      // Mark programme as done
      var cands = getCandidates();
      var ci = cands.findIndex(function(x) { return x.id === req.params.id; });
      if (ci > -1) { cands[ci].status = 'programme_done'; saveCandidates(cands); }

    } catch (e) {
      res.status(500).json({ error: 'Failed to read output: ' + e.message });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /generate-programme-legal/:id
// Redirects to programme page (legal courses use same flow)
// ---------------------------------------------------------------------------
router.get('/api/generate-programme-legal/:id', function(req, res) {
  res.redirect('/candidates/' + req.params.id + '/programme');
});

// ---------------------------------------------------------------------------
// POST /api/personalise-objectives/:id
// AI-generated personalisation suffixes for CPF referential objectives.
// Returns one short contextualising phrase per objective based on candidate profile.
// FAILSAFE: never replaces base objectives, only adds context.
// ---------------------------------------------------------------------------
router.post('/api/personalise-objectives/:id', async function(req, res) {
  const candidates = getCandidates();
  const c = candidates.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const { cpfType, topics, targetLevel } = req.body;
  const validTypes = ['E360', 'E360_LEGAL', 'CAJA'];
  if (!validTypes.includes(cpfType)) {
    return res.status(400).json({ error: 'Invalid cpfType: ' + cpfType });
  }

  const REFERENTIAL_OBJECTIVES = {"E360": ["Dialoguer en anglais pour échanger des informations pertinentes dans un contexte professionnel", "Prendre la parole en continu pour transmettre et partager des informations en milieu professionnel", "Comprendre des communications orales en anglais et identifier des informations pertinentes en contexte professionnel", "Composer des textes professionnels en anglais adaptés au contexte et au public", "Analyser des textes professionnels en anglais pour en extraire et utiliser l’information pertinente"], "E360_LEGAL": ["Dialoguer en anglais pour échanger des informations pertinentes dans un contexte juridique professionnel", "Prendre la parole en continu pour transmettre et partager des informations dans un milieu juridique anglophone", "Comprendre des communications orales en anglais et identifier des informations pertinentes dans un contexte juridique", "Composer des textes professionnels en anglais adaptés au contexte et aux interlocuteurs juridiques", "Analyser des textes professionnels juridiques en anglais pour en extraire et utiliser l’information pertinente"], "CAJA": ["Se présenter dans un cadre professionnel et établir un bon contact avec un client, un collègue ou un confrère", "Mener un premier entretien pour comprendre la situation, poser les bonnes questions et identifier les attentes", "Expliquer une problématique juridique, proposer des options et aider à la prise de décision", "Rédiger des documents professionnels adaptés au contexte : emails, lettres, notes d’avocat", "Corriger ou rédiger des clauses contractuelles claires, précises et structurées", "Conduire une négociation, formuler ou répondre à des propositions, et défendre les intérêts de son client"]};

  const bases = REFERENTIAL_OBJECTIVES[cpfType] || [];
  const od = c.oralData || {};
  const goals = (od.validatedGoals || []).map(g => g.goal || g).join(', ');
  const topicList = (topics || []).join(', ');

  const prompt = [
    'Tu es expert en formation professionnelle en anglais (certifications CPF francaises).',
    'Pour chacun des ' + bases.length + ' objectifs pedagogiques suivants, genere UNE courte phrase de personnalisation (15 mots maximum) qui ancre l objectif dans le contexte professionnel du candidat.',
    'La phrase DOIT completer l objectif de base sans le remplacer ni le contredire.',
    'La phrase commence par "notamment", "en particulier", "dans le cadre de", "pour" ou expression similaire.',
    'Si le contexte est insuffisant pour personnaliser un objectif, retourne une chaine vide "" pour cet objectif.',
    '',
    'Profil candidat:',
    '- Poste: ' + (c.jobtitle || 'non precise'),
    '- Departement: ' + (c.dept || 'non precise'),
    '- Entreprise: ' + (c.company || 'non precisee'),
    '- Objectifs valides lors du bilan oral: ' + (goals || 'non precises'),
    '- Themes de coaching selectionnes: ' + (topicList || 'non selectionnes'),
    '- Niveau cible: ' + (targetLevel || 'non precise'),
    '',
    'Objectifs de base du referentiel ' + (cpfType === 'CAJA' ? 'RS6810' : 'RS6341') + ':',
    ...bases.map((b, i) => (i+1) + '. ' + b),
    '',
    'Reponds UNIQUEMENT avec un objet JSON valide: {"suffixes": ["phrase1", "phrase2", ...]}',
    'Exactement ' + bases.length + ' elements dans le tableau, dans le meme ordre que les objectifs.',
    'Ne mets aucun texte avant ou apres le JSON. Pas de markdown.',
  ].join('\n');

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    const raw = msg.content[0].text.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.suffixes)) throw new Error('Invalid response format');
    // Save suffixes to oralData so they persist across page reloads
    const cands2 = getCandidates();
    const ci2 = cands2.findIndex(x => x.id === req.params.id);
    if (ci2 > -1) {
      if (!cands2[ci2].oralData) cands2[ci2].oralData = {};
      cands2[ci2].oralData.objectiveSuffixes = parsed.suffixes;
      cands2[ci2].oralData.cpfType = cpfType;
      saveCandidates(cands2);
    }
    res.json({ success: true, suffixes: parsed.suffixes, cpfType: cpfType });
  } catch (e) {
    console.error('personalise-objectives error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const nodemailer = require('nodemailer');
const os = require('os');

function getTransporter() {
  return nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
}

const SIGNATURE_HTML = '<br><img src="https://eval.linguaid.net/signature_joss.png" alt="Joss Frimond - Linguaid" style="max-width:400px;display:block;margin-top:8px">';

const MONTHS_FR = ['janvier','f\xe9vrier','mars','avril','mai','juin','juillet','ao\xfbt','septembre','octobre','novembre','d\xe9cembre'];
function fmtDateFr(iso) {
  if (!iso) return '\xe0 d\xe9finir';
  const d = new Date(iso);
  return d.getUTCDate() + ' ' + MONTHS_FR[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// ---------------------------------------------------------------------------
// POST /api/generate-proposition/:id
// Fills PROPOSITION_TEMPLATE.docx, converts to PDF via LibreOffice
// Stores docx at data/propositions/:id.docx and pdf at data/propositions/:id.pdf
// ---------------------------------------------------------------------------
router.post('/api/generate-proposition/:id', async function(req, res) {
  const candidates = getCandidates();
  const c = candidates.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const od = c.oralData || {};
  const cd = c.conventionData || {};
  const rs = c.finalReportSummary || c.reportSummary || {};
  const isCPF = !!(od.isCPF);
  const cpfType = od.cpfType || '';
  const isLegal = c.courseType === 'legal' || cpfType === 'E360_LEGAL' || cpfType === 'CAJA';

  // Build objectives with suffixes
  const REFERENTIAL_OBJECTIVES = {
    'E360': [
      'Dialoguer en anglais pour \xe9changer des informations pertinentes dans un contexte professionnel',
      'Prendre la parole en continu pour transmettre et partager des informations en milieu professionnel',
      'Comprendre des communications orales en anglais et identifier des informations pertinentes en contexte professionnel',
      'Composer des textes professionnels en anglais adapt\xe9s au contexte et au public',
      "Analyser des textes professionnels en anglais pour en extraire et utiliser l'information pertinente"
    ],
    'E360_LEGAL': [
      'Dialoguer en anglais pour \xe9changer des informations pertinentes dans un contexte juridique professionnel',
      'Prendre la parole en continu pour transmettre et partager des informations dans un milieu juridique anglophone',
      'Comprendre des communications orales en anglais et identifier des informations pertinentes dans un contexte juridique',
      'Composer des textes professionnels en anglais adapt\xe9s au contexte et aux interlocuteurs juridiques',
      "Analyser des textes professionnels juridiques en anglais pour en extraire et utiliser l'information pertinente"
    ],
    'CAJA': [
      'Se pr\xe9senter dans un cadre professionnel et \xe9tablir un bon contact avec un client, un coll\xe8gue ou un confr\xe8re',
      'Mener un premier entretien pour comprendre la situation, poser les bonnes questions et identifier les attentes',
      'Expliquer une probl\xe9matique juridique, proposer des options et aider \xe0 la prise de d\xe9cision',
      "R\xe9diger des documents professionnels adapt\xe9s au contexte\u00a0: emails, lettres, notes d'avocat",
      'Corriger ou r\xe9diger des clauses contractuelles claires, pr\xe9cises et structur\xe9es',
      "Conduire une n\xe9gociation, formuler ou r\xe9pondre \xe0 des propositions, et d\xe9fendre les int\xe9r\xeats du client"
    ]
  };

  let objectives = od.objectives || [];
  if (isCPF && cpfType && REFERENTIAL_OBJECTIVES[cpfType]) {
    const bases = REFERENTIAL_OBJECTIVES[cpfType];
    const suffixes = od.objectiveSuffixes || [];
    objectives = bases.map((base, i) => {
      const suffix = (suffixes[i] || '').trim();
      return suffix ? base + ', ' + suffix : base;
    });
  }

  // Price
  const price = req.body.price || cd.price || od.edofPrice || '';
  let priceInt = parseInt(price, 10) || 0;
  if (!priceInt && !isCPF) {
    const ch = parseInt(od.coachingHours, 10) || 0;
    const hw = parseInt(od.homeworkHours, 10) || 0;
    priceInt = isLegal ? (ch * 132 + (hw > 0 ? 200 : 0)) : (ch * 90 + hw * 30);
  }

  // ── Persist the confirmed price NOW — this is the earliest point in the
  //    pipeline it is known, and the only reliable write point (see patch
  //    header). Never write a zero/blank over an existing saved price.
  if (priceInt > 0) {
    const priceIdx = candidates.findIndex(x => x.id === req.params.id);
    if (priceIdx > -1) {
      candidates[priceIdx].conventionData = candidates[priceIdx].conventionData || {};
      candidates[priceIdx].conventionData.price = String(priceInt);
      saveCandidates(candidates);
    }
  }

  // AI-generated needs summary
  let resumeSituation = '';
  try {
    const goals = (od.validatedGoals || []).map(g => g.goal || g).join(', ');
    const criteria = (od.criteria || []).map(cr => typeof cr === 'object' ? (cr.comment || '') : cr).filter(Boolean).join('. ');
    const prompt = [
      'Tu es expert en formation professionnelle en anglais.',
      "R\xe9dige 1 \xe0 2 phrases courtes (max 40 mots total) qui r\xe9sument les besoins et objectifs du candidat, \xe0 partir des informations suivantes.",
      'Commence par \u00ab\u00a0j\u2019ai bien not\xe9\u00a0\u00bb ou expression similaire, en fran\xe7ais.',
      'Ne mentionne pas de niveaux CECRL, pas de certifications, pas de pr\xe9nom.',
      '',
      'Poste : ' + (c.jobtitle || 'non pr\xe9cis\xe9'),
      'Entreprise : ' + (c.company || 'non pr\xe9cis\xe9e'),
      'Objectifs valid\xe9s : ' + (goals || 'non pr\xe9cis\xe9s'),
      'Observations \xe9valuateur : ' + (criteria || 'non pr\xe9cis\xe9es'),
      '',
      'R\xe9ponds uniquement avec les 1-2 phrases, sans pr\xe9ambule ni ponctuation finale superflue.'
    ].join('\n');

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }]
    });
    resumeSituation = msg.content[0].text.trim();
  } catch (e) {
    console.error('generate-proposition AI error:', e.message);
    resumeSituation = '';
  }

  // Build data payload for fill_proposition.py
  const nameParts = (c.name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const propData = {
    isCPF,
    cpfType,
    courseType: c.courseType || '',
    civility: cd.civility || (isLegal ? 'Ma\xeetre' : 'Madame'),
    firstName,
    lastName,
    candidateName: c.name || '',
    company: c.company || c.dept || '',
    email: c.email || '',
    prereqLevel: calc5SkillLevel(c) || od.prereqLevel || '',
    targetLevel: od.targetLevel || '',
    totalHours: String(od.totalHours || ''),
    coachingHours: String(od.coachingHours || ''),
    homeworkHours: String(od.homeworkHours || '0'),
    dateStart: fmtDateFr(od.dateStart),
    dateEnd: fmtDateFr(od.dateEnd),
    objectives,
    resumeSituation,
    price: priceInt ? String(priceInt) : String(price),
    edofMCFLink: od.edofMCFLink || ''
  };

  // Paths
  const propDir = path.join(__dirname, '../data/propositions');
  if (!fs.existsSync(propDir)) fs.mkdirSync(propDir, { recursive: true });

  const tmpJson = path.join(os.tmpdir(), 'prop_' + c.id + '.json');
  const docxOut = path.join(propDir, c.id + '.docx');
  const pdfOut  = path.join(propDir, c.id + '.pdf');
  const template = path.join(__dirname, '../views/PROPOSITION_TEMPLATE.docx');
  const script = '/home/debian/fill_proposition.py';

  fs.writeFileSync(tmpJson, JSON.stringify(propData, null, 2));

  execFile('python3', [script, tmpJson, template, docxOut], function(err, stdout, stderr) {
    if (err) {
      console.error('fill_proposition error:', stderr);
      return res.status(500).json({ error: 'Proposition generation failed: ' + stderr });
    }

    // Convert docx to PDF via LibreOffice
    execFile('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', propDir, docxOut], { timeout: 30000 }, function(errPdf, stdoutPdf, stderrPdf) {
      // LibreOffice outputs to same dir with .pdf extension
      const soOut = path.join(propDir, path.basename(docxOut).replace('.docx', '.pdf'));
      if (errPdf || !fs.existsSync(soOut)) {
        console.error('LibreOffice proposition error:', stderrPdf);
        return res.status(500).json({ error: 'PDF conversion failed: ' + stderrPdf });
      }
      if (soOut !== pdfOut) {
        fs.renameSync(soOut, pdfOut);
      }

      // Save propositionPdfPath to candidate
      const cands2 = getCandidates();
      const ci2 = cands2.findIndex(x => x.id === req.params.id);
      if (ci2 > -1) {
        cands2[ci2].propositionPdfPath = pdfOut;
        cands2[ci2].propositionDocxPath = docxOut;
        cands2[ci2].propositionGeneratedAt = new Date().toISOString();
        saveCandidates(cands2);
      }

      res.json({ success: true, pdfPath: pdfOut, resumeSituation });
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/send-proposition-email/:id
// Sends proposition email with 3 PDF attachments: proposition + programme + rapport
// Body: { recipientEmail, recipientType ('learner'|'hr'), emailBody (edited by user) }
// ---------------------------------------------------------------------------
router.post('/api/send-proposition-email/:id', async function(req, res) {
  const candidates = getCandidates();
  const c = candidates.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const od = c.oralData || {};
  const isCPF = !!(od.isCPF);
  const cpfType = od.cpfType || '';
  const isLegal = c.courseType === 'legal' || cpfType === 'E360_LEGAL' || cpfType === 'CAJA';

  const recipientType  = req.body.recipientType || 'learner';  // 'learner' | 'hr'
  // CRITICAL: never fall back to the learner's email when sending to a
  // third party. Fallback to c.email is learner-mode-only.
  const recipientEmail = recipientType === 'hr'
    ? (req.body.recipientEmail || '')
    : (req.body.recipientEmail || c.email);
  const emailBody      = req.body.emailBody || '';             // pre-edited HTML body from UI

  if (!recipientEmail) {
    return res.status(400).json({
      error: recipientType === 'hr'
        ? 'Adresse email du tiers manquante - aucun email ne peut \u00eatre envoy\u00e9'
        : 'No recipient email'
    });
  }
  // Basic sanity check - reject obviously malformed addresses outright
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return res.status(400).json({ error: 'Adresse email invalide: ' + recipientEmail });
  }
  // FINANCIAL PRIVACY GUARD: a company-attached candidate's proposition goes
  // to the third party by default. Learner-mode sends require an explicit,
  // user-confirmed override flag - never a silent default.
  const guardCompany = ((c.company || '')).trim();
  const guardRealCo = guardCompany && guardCompany.toLowerCase() !== 'particulier';
  if (recipientType === 'learner' && guardRealCo && req.body.learnerOverride !== true) {
    return res.status(400).json({ error: 'Ce candidat est rattach\u00e9 \u00e0 \u00ab ' + guardCompany + ' \u00bb : la proposition financi\u00e8re part au tiers par d\u00e9faut. Confirmez explicitement l\u2019envoi \u00e0 l\u2019apprenant.' });
  }
  if (!emailBody) return res.status(400).json({ error: 'No email body' });

  // ── Subject line by template type ──────────────────────────────────────
  let subject;
  if (isCPF) {
    if (cpfType === 'CAJA')       subject = 'Votre formation en anglais juridique des affaires \u2013 certification CAJA (CPF)';
    else if (cpfType === 'E360_LEGAL') subject = 'Votre formation en anglais professionnel \u2013 parcours adapt\xe9 aux professionnels du droit (CPF)';
    else                          subject = 'Votre formation en anglais professionnel avec la certification English 360 (CPF)';
  } else {
    if (recipientType === 'hr')   subject = 'Proposition de formation en anglais ' + (isLegal ? 'juridique' : 'professionnel') + ' \u2013 ' + (c.name || '');
    else                          subject = 'Votre proposition de formation en anglais ' + (isLegal ? 'juridique' : 'professionnel');
  }

  // ── HTML body: convert plain text line breaks to HTML, add signature ───
  const htmlBody = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7">'
    + emailBody
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
    + SIGNATURE_HTML
    + '</div>';

  // ── Collect attachments ─────────────────────────────────────────────────
  const attachments = [];
  const safeName = (c.name || 'candidat').replace(/\s+/g, '_');

  // 1. Proposition PDF
  const propPdf = path.join(__dirname, '../data/propositions/' + c.id + '.pdf');
  if (fs.existsSync(propPdf)) {
    attachments.push({ filename: 'proposition_' + safeName + '.pdf', path: propPdf });
  } else {
    return res.status(400).json({ error: 'Proposition PDF not found \u2014 please generate it first' });
  }

  // 2. Programme PDF
  const progPdf = path.join(__dirname, '../data/programmes/' + c.id + '.pdf');
  if (fs.existsSync(progPdf)) {
    attachments.push({ filename: 'programme_formation_' + safeName + '.pdf', path: progPdf });
  }

  // 3. Rapport d'évaluation (FR preferred)
  const reportPdfFr = path.join(__dirname, '../data/finalReports/' + c.id + '_fr.pdf');
  const reportPdfEn = path.join(__dirname, '../data/finalReports/' + c.id + '_en.pdf');
  if (fs.existsSync(reportPdfFr)) {
    attachments.push({ filename: 'rapport_evaluation_' + safeName + '.pdf', path: reportPdfFr });
  } else if (fs.existsSync(reportPdfEn)) {
    attachments.push({ filename: 'rapport_evaluation_' + safeName + '.pdf', path: reportPdfEn });
  }

  // ── Send ────────────────────────────────────────────────────────────────
  const transporter = getTransporter();
  transporter.sendMail({
    from: 'jfr@linguaid.net',
    to: recipientEmail,
    cc: 'jfr@linguaid.net',
    subject,
    html: '<p>' + htmlBody + '</p>',
    attachments
  }, function(err) {
    if (err) {
      console.error('send-proposition-email error:', err);
      return res.status(500).json({ error: err.message });
    }

    // Save sentPropositionAt
    const cands3 = getCandidates();
    const ci3 = cands3.findIndex(x => x.id === req.params.id);
    if (ci3 > -1) {
      cands3[ci3].sentPropositionAt = new Date().toISOString();
      cands3[ci3].sentPropositionTo = recipientEmail;
      cands3[ci3].conventionData = cands3[ci3].conventionData || {};
      cands3[ci3].conventionData.proposalSentAt = new Date().toISOString();
      cands3[ci3].conventionData.proposalRecipient = recipientEmail;
      cands3[ci3].conventionData.isThirdParty = !!(req.body && req.body.thirdPartyEmail);
      saveCandidates(cands3);
    }

    res.json({ success: true, to: recipientEmail, attachments: attachments.map(a => a.filename) });
  });
});


router.post('/api/save-programme-data/:id', function(req, res) {
  try {
    var candidates = getCandidates();
    var idx = candidates.findIndex(function(x){ return x.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    var body = req.body || {};
    var oral = candidates[idx].oralData || {};
    candidates[idx].oralData = Object.assign(oral, {
      objectives: body.objectives !== undefined ? body.objectives : oral.objectives,
      objectiveSuffixes: body.objectiveSuffixes !== undefined ? body.objectiveSuffixes : oral.objectiveSuffixes,
      topics: body.topics !== undefined ? body.topics : oral.topics,
      customTopics: body.customTopics !== undefined ? body.customTopics : oral.customTopics,
      trainingTitle: body.trainingTitle !== undefined ? body.trainingTitle : oral.trainingTitle,
      coachingHours: body.coachingHours !== undefined ? body.coachingHours : oral.coachingHours,
      homeworkHours: body.homeworkHours !== undefined ? body.homeworkHours : oral.homeworkHours,
      totalHours: body.totalHours !== undefined ? body.totalHours : oral.totalHours,
      dateStart: body.dateStart !== undefined ? body.dateStart : oral.dateStart,
      dateEnd: body.dateEnd !== undefined ? body.dateEnd : oral.dateEnd,
      additionalNotes: body.additionalNotes !== undefined ? body.additionalNotes : oral.additionalNotes
    });
    saveCandidates(candidates);
    res.json({ success: true });
  } catch(err) {
    console.error('save-programme-data error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
