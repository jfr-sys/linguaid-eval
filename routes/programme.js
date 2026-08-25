'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');
const { assertValidCpfType, getAction, CATALOGUE, getRsCode } = require('../config/catalogue');
const { isContratCadre } = require('../lib/contratCadre');
const coherence = require('../lib/coherence'); /* coherence-gate */


function calc5SkillLevel(c) {
  var rs = c.reportSummary || {};
  var od = c.oralData || {};
  var cefrMap = {'A1':0,'A1+':0.5,'A2':1,'A2+':1.5,'B1':2,'B1+':2.5,'B2':3,'B2+':3.5,'C1':4,'C1+':4.5,'C2':5};
  var cefrRev = {0:'A1',0.5:'A1+',1:'A2',1.5:'A2+',2:'B1',2.5:'B1+',3:'B2',3.5:'B2+',4:'C1',4.5:'C1+',5:'C2'};
  var levels = [rs.grammarLevel, rs.writingLevel, rs.readingLevel, od.listeningLevel, od.speakingLevel]
    .map(function(l){ return cefrMap[l]; })
    .filter(function(n){ return typeof n === 'number'; });
  /* PREREQ_LEVEL_PERSIST (2026-08-24): the overallLevel fallback used to be
     returned unvalidated. A report generated from an empty test can contain
     prose there ("Undetermined - Estimated A2+ to B1"), which then lands in a
     CEFR field in the programme, proposition and convention. Only a real CEFR
     token is acceptable; anything else is no level at all. */
  var safeOverall = (function() {
    var o = String(rs.overallLevel == null ? '' : rs.overallLevel).trim();
    return cefrMap[o] === undefined ? '' : o;
  })();
  if (levels.length === 5) {
    var avg = levels.reduce(function(a,b){return a+b;},0) / 5;
    var rounded = Math.round(avg * 2) / 2;
    return cefrRev[rounded] || safeOverall;
  }
  return safeOverall;
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
  // CPF_FLAG_ASSERT_TYPE (2026-07-30): choosing a CPF type IS declaring the
  // dossier CPF - without this, candidates whose flag wasn't already on
  // (e.g. legal intake) land in the ghost state CPF_GHOST_DATA_CHECK blocks.
  candidates[idx].oralData.isCPF = true;
  /* RS7637 registry (2026-07-27): stamp the RS code once, at the moment
     cpfType is chosen. Never overwrite an already-stamped rsCode — that
     would flip an in-flight dossier's referential mid-pipeline. */
  if (!candidates[idx].oralData.rsCode) {
    candidates[idx].oralData.rsCode = getRsCode(cpfType);
  }
  saveCandidates(candidates);
  res.json({ success: true, cpfType: cpfType, rsCode: candidates[idx].oralData.rsCode });
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
  // CPF_FLAG_ASSERT_ACTION (2026-07-30): same assertion as the cpf-type
  // route - selecting an EDOF catalogue action only makes sense on a CPF
  // dossier, so make the flag consistent here too (covers candidates whose
  // cpfType predates the cpf-type fix).
  candidates[idx].oralData.isCPF = true;
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
      /* PREREQ_LEVEL_PERSIST (2026-08-24): an explicitly edited level wins
         over the recompute; untouched, the 5-skill average still governs. */
      prereqLevel: (od.prereqLevelManual && od.prereqLevel) || calc5SkillLevel(c) || od.prereqLevel || '',
      targetLevel: od.targetLevel || '',
      totalHours: String(od.totalHours || 10),
      coachingHours: String(od.coachingHours || od.totalHours || 10),
      homeworkHours: String(od.homeworkHours || 0),
      isCPF: !!(od.isCPF),
      cpfType: od.cpfType || null,
      /* RS7637 registry (2026-07-27): threaded through to
         fill_programme_final.py so the programme docx renders the
         candidate's own stamped RS code, not a hardcoded one. */
      rsCode: getRsCode(od.cpfType, od.rsCode) || null,
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

  // NIVEAU_VISE_FIX (2026-07-03): the Python generator needs courseType to
  // decide whether "Niveau vise" belongs in the document. Neither
  // payload-building branch above sets it, so backfill unconditionally here.
  if (!payload.courseType) payload.courseType = c.courseType || '';

  // FAILSAFE: block CPF generation if cpfType is missing or unrecognised
  if (payload.isCPF) {
    try {
      assertValidCpfType(payload.cpfType);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  /* coherence-gate: block programme generation on incoherent hours/dates */
  var cohProg = coherence.checkCoherence({ oralData: {
    totalHours: payload.totalHours, coachingHours: payload.coachingHours,
    homeworkHours: payload.homeworkHours, dateStart: payload.dateStart, dateEnd: payload.dateEnd
  } }, {});
  if (!cohProg.ok) return res.status(400).json({ error: cohProg.errors.join(' ') });

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
    /* coherence-derive: persist ALL hour components so downstream documents read the same numbers */
    if (payload.coachingHours !== undefined && payload.coachingHours !== '') candidates2[cidx].oralData.coachingHours = parseInt(payload.coachingHours, 10) || 0;
    if (payload.homeworkHours !== undefined && payload.homeworkHours !== '') candidates2[cidx].oralData.homeworkHours = parseInt(payload.homeworkHours, 10) || 0;
    coherence.deriveTotal(candidates2[cidx].oralData);
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
      if (ci > -1) {
        cands[ci].status = 'programme_done';
        /* PROGRAMME_MATCH_CHECK (2026-07-27): snapshot the exact values
           used to fill this programme, so send-proposition-email can
           later verify the proposition still agrees with it. */
        cands[ci].programmeSnapshot = {
          isCPF: payload.isCPF, cpfType: payload.cpfType, rsCode: payload.rsCode,
          objectives: payload.objectives, totalHours: payload.totalHours,
          coachingHours: payload.coachingHours, homeworkHours: payload.homeworkHours,
          targetLevel: payload.targetLevel, trainingTitle: payload.trainingTitle,
          dateStart: payload.dateStart, dateEnd: payload.dateEnd,
          generatedAt: new Date().toISOString()
        };
        saveCandidates(cands);
      }

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

  /* PROPOSITION_COHERENCE_GATE (2026-08-24): the proposition document is built
     from the stored hours, dates and price - the same fields the convention and
     send-proposal routes gate on. Without this, a dossier whose hours do not add
     up produced a PDF on disk and a downloadable link, and was only caught later
     at send time. Placed before the Anthropic call so it fails fast and free. */
  var cohPropDoc = coherence.checkCoherence(c, { requirePrice: true });
  if (!cohPropDoc.ok) return res.status(400).json({ error: cohPropDoc.errors.join(' ') });

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
      "Conduire une n\xe9gociation, formuler ou r\xe9pondre \xe0 des propositions, et d\xe9fendre les int\xe9r\xeats de son client"
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
  // CAJA_RENEWAL_RESUME_FIX (2026-07-30): skip the AI call for CAJA
  // renewals - there's no oral/questionnaire data to summarize (this is a
  // direct continuation, not a first evaluation), and the AI's honest
  // "no data" fallback ("ce qui ne me permet pas de formuler un resume
  // personnalise") reads as an error to a returning client Linguaid
  // already knows well.
  if (c.isRenewal && cpfType === 'CAJA') {
    resumeSituation = 'Nous connaissons d\xe9j\xe0 parfaitement votre profil\u00a0: cette formation sera construite dans la continuit\xe9 de la pr\xe9c\xe9dente.';
  } else {
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
    /* PREREQ_LEVEL_PERSIST (2026-08-24) */
    prereqLevel: (od.prereqLevelManual && od.prereqLevel) || calc5SkillLevel(c) || od.prereqLevel || '',
    targetLevel: od.targetLevel || '',
    totalHours: String(od.totalHours || ''),
    coachingHours: String(od.coachingHours || ''),
    homeworkHours: String(od.homeworkHours || '0'),
    dateStart: fmtDateFr(od.dateStart),
    dateEnd: fmtDateFr(od.dateEnd),
    objectives,
    resumeSituation,
    price: priceInt ? String(priceInt) : String(price),
    edofMCFLink: od.edofMCFLink || '',
    /* RS7637 registry (2026-07-27): pass the candidate's stamped RS code
       through to fill_proposition.py — never let the Python filler
       hardcode an RS number itself. */
    rsCode: getRsCode(cpfType, od.rsCode),
    // TIERS_WORDING_FIX (2026-07-03): client already sends this on every
    // generate-proposition call - forward it so the generator can write
    // third-person prose for non-CPF proposals addressed to a third party.
    // (firstName/lastName are already sent above - not duplicated here.)
    recipientType: req.body.recipientType || 'learner',
    // RENEWAL_PROPDATA_FLAG (2026-07-30): lets fill_proposition.py apply
    // the renewal-specific layout (no niveau line, credit-dependent CPF
    // funding wording).
    isRenewal: !!c.isRenewal
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
        /* PROGRAMME_MATCH_CHECK (2026-07-27): snapshot the exact values
           used to fill this proposition, compared against
           programmeSnapshot before send-proposition-email is allowed to
           actually dispatch anything. */
        cands2[ci2].propositionSnapshot = {
          isCPF: propData.isCPF, cpfType: propData.cpfType, rsCode: propData.rsCode,
          objectives: propData.objectives, totalHours: propData.totalHours,
          coachingHours: propData.coachingHours, homeworkHours: propData.homeworkHours,
          targetLevel: propData.targetLevel, trainingTitle: od.trainingTitle || '',
          dateStart: od.dateStart || '', dateEnd: od.dateEnd || '',
          price: propData.price,
          generatedAt: new Date().toISOString()
        };
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

  // CADRE_TIERS_REINTRODUCED (2026-07-03): learner-direct is 100%
  // bulletproof blocked for cadre companies, no override, ever. Third-party
  // sends ARE allowed - falls through to the normal tiers validation below
  // (recipientEmail required + format-checked), unchanged.
  if (isContratCadre(c.company)) {
    const cadreRecipientType = req.body.recipientType || 'learner';
    if (cadreRecipientType !== 'hr') {
      return res.status(400).json({ error: 'Contrat cadre : aucun envoi direct \u00e0 l\u2019apprenant n\u2019est jamais autoris\u00e9 pour ' + (c.company || '') + '. Utilisez le mode tiers avec un email valide.' });
    }
  }

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

  /* PROGRAMME_MATCH_CHECK (2026-07-27): block the SEND - not generation of
     either document - if the last-generated programme and proposition
     disagree on CPF status, objectives, hours, or target level. */
  var cohMatch = coherence.checkProgrammeMatch(c);
  if (!cohMatch.ok) return res.status(400).json({ error: cohMatch.errors.join(' ') });

  /* coherence-gate: no proposition from incoherent hours/price/dates */
  var cohProp = coherence.checkCoherence(c, { requirePrice: true });
  if (!cohProp.ok) return res.status(400).json({ error: cohProp.errors.join(' ') });

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
      /* PREREQ_LEVEL_PERSIST (2026-08-24): these three were sent by the page
         but never stored, so every edit was lost on reload. */
      prereqLevel: body.prereqLevel !== undefined ? body.prereqLevel : oral.prereqLevel,
      prereqLevelManual: body.prereqLevelManual !== undefined ? !!body.prereqLevelManual : oral.prereqLevelManual,
      targetLevel: body.targetLevel !== undefined ? body.targetLevel : oral.targetLevel,
      location: body.location !== undefined ? body.location : oral.location,
      coachingHours: body.coachingHours !== undefined ? body.coachingHours : oral.coachingHours,
      homeworkHours: body.homeworkHours !== undefined ? body.homeworkHours : oral.homeworkHours,
      totalHours: body.totalHours !== undefined ? body.totalHours : oral.totalHours,
      dateStart: body.dateStart !== undefined ? body.dateStart : oral.dateStart,
      dateEnd: body.dateEnd !== undefined ? body.dateEnd : oral.dateEnd,
      additionalNotes: body.additionalNotes !== undefined ? body.additionalNotes : oral.additionalNotes
    });
    coherence.deriveTotal(candidates[idx].oralData); /* coherence-derive */
    saveCandidates(candidates);
    res.json({ success: true });
  } catch(err) {
    console.error('save-programme-data error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------------------------------------------------------
// POST /api/rewrite-objectives/:id                          [BLOOM_OBJECTIVES]
// Rewrites vague free-text (non-CPF) pedagogical objectives into observable,
// evaluable objectives built on Bloom taxonomy, and returns the evaluation
// modality for each one.
// Returns PROPOSALS ONLY - nothing is written to candidates.json here. The
// page applies the accepted ones and persists them through
// POST /api/save-programme-data/:id.
// CPF objectives are locked to the certification referential and are never
// touched by this route.
// ---------------------------------------------------------------------------
router.post('/api/rewrite-objectives/:id', async function (req, res) {
  const candidates = getCandidates();
  const c = candidates.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  if (body.isCPF === true) {
    return res.status(400).json({
      error: 'Objectifs CPF verrouilles sur le referentiel de certification - reformulation interdite.'
    });
  }

  const source = (body.objectives || [])
    .map(function (o) { return String(o == null ? '' : o).trim(); })
    .filter(Boolean);
  if (!source.length) return res.status(400).json({ error: 'Aucun objectif a reformuler.' });
  if (source.length > 12) return res.status(400).json({ error: 'Trop d objectifs (max 12).' });

  const od = c.oralData || {};
  const goals = (od.validatedGoals || [])
    .map(function (g) { return (g && g.goal) ? g.goal : g; })
    .filter(Boolean).join(', ');
  const topicList = (body.topics && body.topics.length ? body.topics : (od.topics || [])).join(', ');

  // The page shows CEFR levels as "B2 (3)" - keep only the CEFR token.
  const cefrOnly = function (v) {
    const s = String(v == null ? '' : v).trim();
    const m = s.match(/^(A1\+?|A2\+?|B1\+?|B2\+?|C1\+?|C2)/i);
    return m ? m[1].toUpperCase() : s;
  };
  const prereq = cefrOnly(body.prereqLevel || od.prereqLevel || calc5SkillLevel(c)) || 'non precise';
  const target = cefrOnly(body.targetLevel || od.targetLevel) || 'non precise';
  const coaching = body.coachingHours || od.coachingHours || 'non precise';
  const homework = body.homeworkHours || od.homeworkHours || 0;
  const isLegal = (c.courseType === 'legal') || (od.intakeType === 'legal');

  const prompt = [
    'Tu es ingenieur pedagogique, specialiste de la formation professionnelle en anglais et de la conformite Qualiopi.',
    'On te donne des objectifs pedagogiques rediges de maniere vague et non evaluable.',
    'Reecris-les en objectifs OPERATIONNELS et EVALUABLES, fondes sur la taxonomie de Bloom.',
    '',
    'REGLES IMPERATIVES:',
    '1. Chaque objectif commence par un verbe d action observable a l infinitif (rediger, animer, presenter, argumenter, negocier, synthetiser, reformuler, structurer, comparer, justifier, adapter, concevoir, arbitrer...).',
    '2. Verbes INTERDITS comme verbe principal, car non evaluables: comprendre, connaitre, savoir, maitriser, ameliorer, developper, acquerir, se familiariser, prendre confiance, etre sensibilise, etre a l aise.',
    '3. Chaque objectif contient trois elements: (a) la performance observable, (b) la condition ou le contexte professionnel reel du candidat, (c) le critere de reussite mesurable (niveau CECRL vise, degre de precision, autonomie, duree, tolerance aux erreurs, effet produit sur l interlocuteur).',
    '4. Chaque objectif doit etre atteignable compte tenu du niveau de depart, du niveau cible et du volume horaire indiques.',
    '5. Repartis les objectifs sur des niveaux de Bloom differents et progressifs, majoritairement Appliquer, Analyser, Evaluer, Creer. N utilise Memoriser pour aucun objectif.',
    '6. Longueur: 25 a 45 mots par objectif. Francais professionnel correct et accentue. Aucun jargon pedagogique dans le texte de l objectif lui-meme.',
    '7. Conserve l intention de l objectif d origine: tu le rends mesurable, tu ne changes pas de sujet.',
    isLegal
      ? '8. Contexte anglais juridique des affaires: ancre les objectifs dans des situations juridiques reelles (contrats, clauses, conseil client, negociation, notes et memos).'
      : '8. Contexte anglais professionnel des affaires: ancre les objectifs dans des situations de travail reelles (reunions, visio, emails, presentations, echanges clients ou fournisseurs).',
    '',
    'PROFIL DU CANDIDAT:',
    '- Poste: ' + (c.jobtitle || 'non precise'),
    '- Departement: ' + (c.dept || 'non precise'),
    '- Entreprise: ' + (c.company || 'non precisee'),
    '- Secteur / type de parcours: ' + (isLegal ? 'anglais juridique' : 'anglais professionnel des affaires'),
    '- Niveau de depart (CECRL): ' + prereq,
    '- Niveau cible (CECRL): ' + target,
    '- Volume: ' + coaching + ' h de coaching individuel' + (parseInt(homework, 10) > 0 ? ' + ' + homework + ' h de travaux personnels' : ''),
    '- Objectifs valides lors du bilan oral: ' + (goals || 'non precises'),
    '- Themes de coaching selectionnes: ' + (topicList || 'non selectionnes'),
    '',
    'OBJECTIFS ACTUELS A REFORMULER (' + source.length + '):',
  ].concat(source.map(function (s, i) { return (i + 1) + '. ' + s; })).concat([
    '',
    'Pour chaque objectif, produis:',
    '- "objective": le texte reformule, celui qui figurera tel quel dans le programme de formation',
    '- "bloom": le niveau de Bloom vise, exactement un de: Comprendre, Appliquer, Analyser, Evaluer, Creer',
    '- "verb": le verbe d action principal utilise',
    '- "evaluation": comment cet objectif sera concretement evalue en fin de parcours (une phrase courte: mise en situation, tache a produire, grille appliquee)',
    '',
    'Reponds UNIQUEMENT avec un objet JSON valide de la forme:',
    '{"objectives":[{"objective":"...","bloom":"...","verb":"...","evaluation":"..."}]}',
    'Exactement ' + source.length + ' elements, dans le meme ordre que les objectifs actuels.',
    'Aucun texte avant ou apres le JSON. Pas de markdown.'
  ]).join('\n');

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    });
    const raw = msg.content[0].text.trim()
      .replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(raw);
    let list = Array.isArray(parsed) ? parsed : parsed.objectives;
    if (!Array.isArray(list)) throw new Error('Invalid response format');

    list = list.map(function (o, i) {
      if (typeof o === 'string') o = { objective: o };
      o = o || {};
      return {
        original:   source[i] || '',
        objective:  String(o.objective  == null ? '' : o.objective).trim(),
        bloom:      String(o.bloom      == null ? '' : o.bloom).trim(),
        verb:       String(o.verb       == null ? '' : o.verb).trim(),
        evaluation: String(o.evaluation == null ? '' : o.evaluation).trim()
      };
    }).filter(function (o) { return o.objective; });

    if (!list.length) throw new Error('Empty rewrite');
    res.json({ success: true, objectives: list });
  } catch (e) {
    console.error('rewrite-objectives error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;
