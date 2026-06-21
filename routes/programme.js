'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');
const { assertValidCpfType, getAction, CATALOGUE } = require('../config/catalogue');

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
      prereqLevel: (c.reportSummary || {}).overallLevel || od.prereqLevel || od.listeningLevel || '',
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

module.exports = router;
