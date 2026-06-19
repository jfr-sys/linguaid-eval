const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, Table, TableRow, TableCell, VerticalAlign, LevelFormat, Footer, ImageRun } = require('docx');

const dataDir = path.join(__dirname, '../data');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


function cefrLabel(level) {
  if (!level) return '';
  var map = {
    'A1': 'A1 (0)', 'A1+': 'A1+ (0.5)',
    'A2': 'A2 (1)', 'A2+': 'A2+ (1.5)',
    'B1': 'B1 (2)', 'B1+': 'B1+ (2.5)',
    'B2': 'B2 (3)', 'B2+': 'B2+ (3.5)',
    'C1': 'C1 (4)', 'C1+': 'C1+ (4.5)',
    'C2': 'C2 (5)'
  };
  // If already has number in brackets, return as-is
  if (/\(\d/.test(level)) return level;
  // Try exact match first
  var trimmed = level.trim();
  if (map[trimmed]) return map[trimmed];
  // Try to find embedded level
  for (var k in map) {
    if (trimmed === k) return map[k];
  }
  return level;
}

function getCandidates() {
  const file = path.join(dataDir, 'candidates.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveCandidates(candidates) {
  fs.writeFileSync(path.join(dataDir, 'candidates.json'), JSON.stringify(candidates, null, 2));
}

function markdownToDocx(text) {
  const children = [];
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('## ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: line.replace('## ', ''), bold: true, size: 26, color: '1F4E79', font: 'Arial' })]
      }));
    } else if (line.startsWith('### ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 160, after: 80 },
        children: [new TextRun({ text: line.replace('### ', ''), bold: true, size: 22, color: '2E75B6', font: 'Arial' })]
      }));
    } else if (line.startsWith('# ')) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 160 },
        children: [new TextRun({ text: line.replace('# ', ''), bold: true, size: 32, color: '1F4E79', font: 'Arial' })]
      }));
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.replace(/^[-*] /, '');
      const runs = parseInline(content);
      children.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing: { before: 40, after: 40 },
        children: runs
      }));
    } else if (line.match(/^\d+\. /)) {
      const content = line.replace(/^\d+\. /, '');
      const runs = parseInline(content);
      children.push(new Paragraph({
        numbering: { reference: 'numbers', level: 0 },
        spacing: { before: 40, after: 40 },
        children: runs
      }));
    } else if (line.startsWith('---') || line.startsWith('***')) {
      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } },
        spacing: { before: 160, after: 160 },
        children: [new TextRun('')]
      }));
    } else if (line.trim() === '') {
      children.push(new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun('')] }));
    } else {
      const runs = parseInline(line);
      children.push(new Paragraph({
        spacing: { before: 60, after: 60 },
        children: runs
      }));
    }
  }
  return children;
}

function parseInline(text) {
  const runs = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, font: 'Arial', size: 20 }));
    } else if (part.startsWith('*') && part.endsWith('*')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, font: 'Arial', size: 20 }));
    } else if (part.startsWith('`') && part.endsWith('`')) {
      runs.push(new TextRun({ text: part.slice(1, -1), font: 'Courier New', size: 18, color: '334155' }));
    } else if (part) {
      runs.push(new TextRun({ text: part, font: 'Arial', size: 20 }));
    }
  }
  return runs.length ? runs : [new TextRun({ text: '', font: 'Arial', size: 20 })];
}

function buildDocx(candidateName, reportText, language) {
  const isEN = language === 'en';
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'AEC6CF' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const headerRow = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [6000, 3360],
    rows: [new TableRow({
      children: [
        new TableCell({
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          width: { size: 6000, type: WidthType.DXA },
          children: [
            new Paragraph({ children: [new TextRun({ text: 'LINGUAID FRANCE', bold: true, size: 28, color: '1F4E79', font: 'Arial' })] }),
            new Paragraph({ children: [new TextRun({ text: isEN ? 'Professional English Language Assessment' : 'Évaluation Professionnelle en Langue Anglaise', size: 18, color: '666666', font: 'Arial' })] }),
          ]
        }),
        new TableCell({
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          width: { size: 3360, type: WidthType.DXA },
          children: [
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: isEN ? 'CONFIDENTIAL' : 'CONFIDENTIEL', size: 18, bold: true, color: 'C00000', font: 'Arial' })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: new Date().toLocaleDateString(isEN ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), size: 18, color: '666666', font: 'Arial' })] }),
          ]
        })
      ]
    })]
  });

  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '1F4E79', space: 4 } },
    children: [new TextRun({ text: isEN ? 'INITIAL ENGLISH LANGUAGE EVALUATION REPORT' : 'RAPPORT D\'ÉVALUATION INITIALE EN LANGUE ANGLAISE', bold: true, size: 36, color: '1F4E79', font: 'Arial' })]
  });

  const subtitlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 400 },
    children: [new TextRun({ text: candidateName, bold: true, size: 26, color: '2E75B6', font: 'Arial' })]
  });

  const legalNote = isEN ? '' : `\n\n---\n\n### Références réglementaires\n\nCe rapport a été établi conformément aux exigences du Cadre Commun Européen de Référence pour les Langues (CECRL) et aux dispositions relatives à la formation professionnelle continue prévues aux articles L.6313-1 et suivants du Code du travail. L'évaluation des besoins constitue un acte pédagogique préalable à toute action de formation linguistique professionnelle.\n\n**Organisme de formation :** Linguaid France SAS\n**Numéro de déclaration d'activité :** 91 66 01 620 66\n**Enregistrement :** Cet enregistrement ne vaut pas agrément de l'État.\n\n*Ce document est confidentiel et destiné exclusivement à l'entreprise commanditaire et au stagiaire concerné.*`;

  const bodyContent = markdownToDocx(reportText + legalNote);

  return new Document({
    numbering: {
      config: [
        { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ]
    },
    styles: {
      default: { document: { run: { font: 'Arial', size: 20, color: '1A1A1A' } } }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [headerRow, titlePara, subtitlePara, ...bodyContent]
    }]
  });
}

router.post('/generate-written/:id', async (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const c = candidates[idx];

  const prompt = `You are an expert English language evaluator for Linguaid France. Generate a detailed Initial English Language Evaluation Report based on the following written placement test data.

CANDIDATE:
Name: ${c.name}
Email: ${c.email}
Department: ${c.dept}
Job Title: ${c.jobtitle}
Test Date: ${c.testdate}

TEST SCORES:
Total MCQ Score: ${c.scores.total}/${c.scores.max} (${Math.round(100 * c.scores.total / c.scores.max)}%)

FREE WRITING RESPONSES:
Q39 (Current life/work): ${c.freewriting.q39}
Q40 (Hometown): ${c.freewriting.q40}
Q41 (Future plans): ${c.freewriting.q41}

SELF-REPORTED GOALS: ${c.goals.join('; ')}
OTHER NEEDS: ${c.otherNeeds}
AVAILABILITY: ${Object.entries(c.avail).map(([d,v]) => v ? d+': '+v : '').filter(Boolean).join(', ')}

Write a comprehensive report in English covering:
1. Overall CEFR level (based on MCQ score: 87%+=B2, 73%+=B1+, 60%+=B1, 47%+=A2+, 33%+=A2, below=A1)
2. Skill Assessment Overview (Grammar MCQ, Writing, Reading/Vocabulary, Overall)
3. Detailed Grammar analysis — what they got right, specific gaps with examples from their answers
4. Reading/Vocabulary assessment based on free writing quality
5. Writing assessment — analyse each free writing response in detail
6. Strengths
7. Areas for Improvement
8. Recommendations including target level, hours, and 3 Bloom's taxonomy learning objectives

Format with markdown: ## for section headers, ### for subsections, **bold** for key terms, - for bullet points.

After the report. IMPORTANT: Always refer to CEFR levels using the exact format provided in the data (e.g. "B1 (2)", "B1+ (2.5)", "B2 (3)"). Never use descriptive names like "Threshold" or "Upper Intermediate". For the overallLevel in the JSON block, calculate the mathematical average of grammar, writing and reading levels and round to the nearest valid level (A1, A1+, A2, A2+, B1, B1+, B2, B2+, C1, C1+, C2) — output ONE level only, never a range or slash format like "A2+/B1".

Also add a clearly delimited JSON block:
---SUMMARY_JSON---
{
  "grammarLevel": "B1",
  "writingLevel": "B1+",
  "readingLevel": "B1+",
  "overallLevel": "B1",
  "keyGaps": [
    "Passive voice (are produced, was decided)",
    "Conditional forms — 2nd and 3rd conditional",
    "Future perfect (will have + past participle)",
    "Discourse connectors — cause vs contrast (so/but)",
    "Advanced phrasal verbs (get on, get away with, look up)"
  ]
}
---END_SUMMARY_JSON---`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    });

    const fullText = message.content[0].text;
    let reportSummary = null;
    const jsonMatch = fullText.match(/---SUMMARY_JSON---\s*([\s\S]*?)\s*---END_SUMMARY_JSON---/);
    if (jsonMatch) {
      try { reportSummary = JSON.parse(jsonMatch[1].trim().replace(/^```[a-z]*\n?/,'').replace(/```$/,'').trim()); } catch(e) { console.error('JSON parse error:', e); }
    }
    const cleanReport = fullText.replace(/---SUMMARY_JSON---[\s\S]*?---END_SUMMARY_JSON---/, '').trim();

    candidates[idx].writtenReport = cleanReport;
    candidates[idx].reportSummary = reportSummary;
    candidates[idx].status = 'written_report_done';
    saveCandidates(candidates);

    res.json({ success: true, report: cleanReport, summary: reportSummary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate-final/:id', async (req, res) => {
  const candidates = getCandidates();
  const idx = candidates.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const c = candidates[idx];

  if (!c.writtenReport || !c.oralData) {
    return res.status(400).json({ error: 'Missing written report or oral assessment data' });
  }

  const oral = c.oralData;
  const summary = c.reportSummary || {};
  const validatedGoals = (oral.validatedGoals || []).map(g => `${g.goal} [${g.status}]`).join('\n');
  const validatedAvail = (oral.validatedAvail || []).map(a => `${a.day} ${a.time} [${a.status}]`).join(', ');

  const prompt = `You are an expert English language evaluator for Linguaid France. Generate a complete Final English Language Evaluation Report combining written test results and oral assessment.

CANDIDATE:
Name: ${c.name}
Email: ${c.email}
Department: ${c.dept}
Job Title: ${c.jobtitle}
Written Test Date: ${c.testdate}
Oral Session Date: ${oral.sessionDate || ''}
Evaluator: ${oral.evaluator || ''}

WRITTEN TEST SUMMARY:
Grammar Level: ${cefrLabel(summary.grammarLevel) || ''}
Writing Level: ${cefrLabel(summary.writingLevel) || ''}
Reading Level: ${cefrLabel(summary.readingLevel) || ''}
Overall Written Level: ${cefrLabel(summary.overallLevel) || ''}
Key Grammar Gaps: ${(summary.keyGaps || []).join('; ')}

FULL WRITTEN REPORT:
${c.writtenReport}

ORAL ASSESSMENT:
Listening Level: ${cefrLabel(oral.listeningLevel) || ''}
Speaking Level: ${cefrLabel(oral.speakingLevel) || ''}
Oral Criteria:
${Object.entries(oral.criteria || {}).map(([k,v]) => `  ${k}: ${v}`).join('\n')}
Oral Observations: ${oral.oralObs || oral.speakingObs || oral.listeningObs || ''}

VALIDATED GOALS:
${validatedGoals}
Goals Notes: ${oral.goalsNotes || ''}

VALIDATED AVAILABILITY: ${validatedAvail}
Confirmed Format: ${oral.confirmedFormat || ''}
Scheduling Notes: ${oral.schedNotes || ''}

EVALUATOR NOTES:
Professional Context: ${oral.contextObs || ''}
Learning Priorities: ${oral.prioritiesObs || ''}
Strengths: ${oral.strengths || ''}
Key Gaps: ${oral.gaps || ''}
Learner Profile: ${oral.profile || ''}

TRAINING PLAN:
Target Level: ${cefrLabel(oral.targetLevel) || ''}
Total Hours: ${oral.totalHours || ''}
Coaching Hours: ${oral.coachingHours || ''}
Homework Hours: ${oral.homeworkHours || ''}
Additional Notes: ${oral.additionalNotes || ''}

Generate a complete professional Final Evaluation Report with markdown formatting (## headers, ### subheaders, **bold**, - bullets) covering:
1. Executive summary with overall CEFR level across all 5 skills
2. Skill-by-skill assessment (Reading, Writing, Grammar, Listening, Speaking) with strengths and development areas
3. Exactly 3 operational learning objectives using Bloom's taxonomy action verbs
4. Training plan with hours breakdown, priority content areas, and confirmed scheduling
5. Professional evaluator narrative summary
6. Sign-off block with evaluator name, dates, and Linguaid France details`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 5000,
      messages: [{ role: 'user', content: prompt }]
    });

    const report = message.content[0].text.replace(/```[a-z]*\n/g, '').replace(/```/g, '');
    candidates[idx].finalReport = report;
    candidates[idx].status = 'final_report_done';

    // Extract objectives from the generated report and save to oralData
    try {
      const extractMsg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: 'Extract the 3 learning objectives from this evaluation report. Return ONLY a JSON array of 3 strings in French, each being the full objective text. No preamble, no markdown, no backticks. Report:\n' + report }]
      });
      const extractText = extractMsg.content[0].text.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
      const extracted = JSON.parse(extractText);
      if (Array.isArray(extracted) && extracted.length > 0) {
        if (!candidates[idx].oralData) candidates[idx].oralData = {};
        candidates[idx].oralData.objectives = extracted;
      }
    } catch(extractErr) {
      console.error('Objective extraction failed (non-fatal):', extractErr.message);
    }

    saveCandidates(candidates);

    res.json({ success: true, report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/download-written/:id/:lang', function(req, res) {
  var candidates = getCandidates();
  var cand = candidates.find(function(x) { return x.id === req.params.id; });
  if (!cand) return res.status(404).json({ error: 'Not found' });
  var lang = req.params.lang;
  var isEN = lang === 'en';
  if (!cand.writtenReport) return res.status(400).json({ error: 'No written report generated yet' });

  var reportText = cand.writtenReport;
  var parts = [cand.jobtitle, cand.company, cand.dept].filter(Boolean);
  var subtitle = cand.name + (parts.length ? ' - ' + parts.join(' - ') : '');
  var titleEN = 'INITIAL LANGUAGE EVALUATION REPORT';
  var titleFR = 'RAPPORT D EVALUATION LINGUISTIQUE INITIALE';

  var nodePath = require('path');
  var fs = require('fs');
  var execFile = require('child_process').execFile;
  var Anthropic = require('@anthropic-ai/sdk');
  var client2 = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  var tmpJson = '/tmp/written_' + req.params.id + '_' + lang + '.json';
  var tmpOut = '/tmp/written_' + req.params.id + '_' + lang + '.docx';
  var template = nodePath.join(__dirname, '../views/headed_notepaper.docx');
  var script = '/home/debian/fill_report.py';

  function generate(text) {
    var payload = { title: isEN ? titleEN : titleFR, subtitle: subtitle, content: text };
    fs.writeFileSync(tmpJson, JSON.stringify(payload));
    execFile('python3', [script, tmpJson, template, tmpOut], function(err, stdout, stderr) {
      if (err) { console.error('Report error:', stderr); return res.status(500).json({ error: stderr }); }
      try {
        var buffer = fs.readFileSync(tmpOut);
        var fname = 'Linguaid_Written_' + cand.name.replace(/\s+/g,'_') + '_' + (isEN ? 'EN' : 'FR') + '.docx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
        res.send(buffer);
        try { fs.unlinkSync(tmpJson); fs.unlinkSync(tmpOut); } catch(e2) {}
      } catch(e) { res.status(500).json({ error: e.message }); }
    });
  }

  if (!isEN) {
    var transPrompt = 'Translate and adapt into French for French professional context. CEFR to CECRL. Keep markdown formatting. Not assessed to Non evalue a ce stade. Do not use backtick code blocks. Report: ' + reportText;
    client2.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 6000,
      messages: [{ role: 'user', content: transPrompt }]
    }).then(function(msg) {
      generate(msg.content[0].text);
    }).catch(function(err) {
      res.status(500).json({ error: 'Translation failed: ' + err.message });
    });
  } else {
    generate(reportText);
  }
});


router.get('/download/:id/:lang', function(req, res) {
  var candidates = getCandidates();
  var cand = candidates.find(function(x) { return x.id === req.params.id; });
  if (!cand) return res.status(404).json({ error: 'Not found' });
  var lang = req.params.lang;
  var isEN = lang === 'en';
  if (!cand.finalReport) return res.status(400).json({ error: 'No final report generated yet' });

  var reportText = cand.finalReport;
  var parts = [cand.jobtitle, cand.company, cand.dept].filter(Boolean);
  var subtitle = cand.name + (parts.length ? ' - ' + parts.join(' - ') : '');
  var titleEN = 'INITIAL LANGUAGE EVALUATION REPORT';
  var titleFR = 'RAPPORT D EVALUATION LINGUISTIQUE INITIALE';

  var nodePath = require('path');
  var fs = require('fs');
  var execFile = require('child_process').execFile;
  var Anthropic = require('@anthropic-ai/sdk');
  var client2 = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  var tmpJson = '/tmp/report_' + req.params.id + '_' + lang + '.json';
  var tmpOut = '/tmp/report_' + req.params.id + '_' + lang + '.docx';
  var template = nodePath.join(__dirname, '../views/headed_notepaper.docx');
  var script = '/home/debian/fill_report.py';

  function generate(text) {
    var payload = { title: isEN ? titleEN : titleFR, subtitle: subtitle, content: text };
    fs.writeFileSync(tmpJson, JSON.stringify(payload));
    execFile('python3', [script, tmpJson, template, tmpOut], function(err, stdout, stderr) {
      if (err) { console.error('Report error:', stderr); return res.status(500).json({ error: stderr }); }
      try {
        var buffer = fs.readFileSync(tmpOut);
        var fname = 'Linguaid_Evaluation_' + cand.name.replace(/\s+/g,'_') + '_' + (isEN ? 'EN' : 'FR') + '.docx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
        res.send(buffer);
        try { fs.unlinkSync(tmpJson); fs.unlinkSync(tmpOut); } catch(e2) {}
      } catch(e) { res.status(500).json({ error: e.message }); }
    });
  }

  if (!isEN) {
    var transPrompt = 'Translate and adapt into French for French professional context. CEFR to CECRL. Keep markdown formatting. Not assessed to Non evalue a ce stade. Do not use backtick code blocks. Report: ' + reportText;
    client2.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 6000,
      messages: [{ role: 'user', content: transPrompt }]
    }).then(function(msg) {
      generate(msg.content[0].text);
    }).catch(function(err) {
      res.status(500).json({ error: 'Translation failed: ' + err.message });
    });
  } else {
    generate(reportText);
  }
});




function buildProgramme(p) {
  var NB = {style:BorderStyle.NONE,size:0,color:'FFFFFF'};
  var NO = {top:NB,bottom:NB,left:NB,right:NB};
  var BLU = '1F4E79';
  var LBLU = 'D6E4F0';
  var STRINGS = {
    subtitle: "A la fin de la formation, l'apprenant sera capable de (dans le cadre de son activité professionnelle) :",
    delivery: " heures de coaching individuel en visioconférence avec le formateur et ",
    delivery2: " heures de travail guidé en autonomie comprenant des activités pédagogiques structurées avec production de livrables.",
    content1: "Chaque cours sera préparé sur mesure par le consultant-formateur en fonction des besoins identifiés lors du test de positionnement.",
    content2: "Les sujets suivants seront traités :",
    content3: "Le travail guide en autonomie comprend des exercices de compréhension, de production écrite et orale ainsi que des activités d'entraînement à la certification.",
    means1: "Cours particuliers par visioconférence et travail guidé en autonomie comprenant des activités pédagogiques structurées (écrites et orales) avec production de livrables.",
    means1cpf: " Certification English 360 (RS6341) en fin de formation.",
    means2: "Animation par un formateur professionnel de langue maternelle ou de niveau C1 minimum sur le référentiel CECRL* (voir annexe) en anglais ayant une expérience de minimum 2 ans en tant que formateur en anglais en entreprise. Le formateur est formé régulièrement dans l'approche pédagogique de l'organisme de formation afin d'assurer un niveau de qualité et de professionnalisme.",
    suivi1: "Feuilles d'émargement pour les sessions en visioconférence",
    suivi2: "Suivi des activités réalisées en autonomie (livrables, résultats aux exercices et progression)",
    appre1: "Positionnement par test de niveau",
    appre2: "Évaluation formative continue durant la session",
    appre3: "Remise d'une attestation de fin de formation",
    appre4: "Questionnaire d'évaluation de la satisfaction en fin de formation",
    appre5: "Questionnaire d'impact de la formation à 2-3 mois",
    appre6: "Certification English 360 (RS6341)",
    secSuivi: "Suivi de l'exécution :",
    secAppre: "Appréciation des résultats :",
    secMoyens: "Moyens pédagogiques, techniques et d'encadrement mis en oeuvre",
    secMoyensTech: "Moyens pédagogiques et techniques :",
    secMoyensEnc: "Moyens d'encadrement :",
    secSuiviAppr: "Moyens permettant le suivi et l'appréciation des résultats",
    cecrl: "La formation s'inscrit dans le cadre du CECRL et permet d'evaluer la progression du niveau de l'apprenant.",
    footer: "Linguaid France SAS  |  2 rue Hergé, 66750 Saint Cyprien  |  RCS Perpignan B 539 682 187  |  NAF : 8559A  |  Enregistrée sous le numéro : 91 66 01 620 66  |  Cet enregistrement ne vaut pas agrément de l'Etat"
  };

  function tx(text, o) { return new TextRun(Object.assign({text:text,font:'Gill Sans MT',size:20,color:'1A1A1A'},o||{})); }
  function bx(text, o) { return tx(text, Object.assign({bold:true},o||{})); }

  function sectionTitle(text) {
    return new Paragraph({
      spacing:{before:280,after:120},
      border:{bottom:{style:BorderStyle.SINGLE,size:6,color:BLU,space:4}},
      children:[bx(text,{size:24,color:BLU})]
    });
  }

  function bullet(text) {
    return new Paragraph({
      numbering:{reference:'prog-bullets',level:0},
      spacing:{before:40,after:40},
      children:[tx(text)]
    });
  }

  var logoData = '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAEMBcoDASIAAhEBAxEB/8QAHQABAAICAwEBAAAAAAAAAAAAAAcIBQYBAwQCCf/EAFMQAAEDBAADBQMFCgwDBgYDAAEAAgMEBQYRBxIhCBMxQVEUImEyQnGRsRUXI1JicoGSocEWJDM0NjdTc3STstFDVIIYJjVVY+ElJ0Rkg6IoRfD/xAAbAQEAAgMBAQAAAAAAAAAAAAAAAQIDBAUGB//EADoRAQACAQIEAgQNBQADAQEAAAABAgMEEQUSITFBcSJRYZETFBUWIyQyMzSBobHBBkJS0fAlNUNTYv/aAAwDAQACEQMRAD8AuWiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICLguaPEj605m/jD60HKIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICEgDZOguHENaXOIAA2SVXrtB8bWWZ78fxuYSVZ92WVh2GrY02myai/JSGHPnrhrzWSfn3E7GMQhd7dViSbXRkRDjv4qBcn7QV7uMr47XDHHBvTT4HSgytrqy5Vr62vqHyzPOySTray1ttF1qYu+p7fNJGPnAdF6nTcJ0+CN79Z9rzuo4lmyztTpDcJuI2W1T+Z1fKzf4shXppM5yhpB+6VQfpkK0yNj45DHIwseD1B8lkKfyXR+AxbdKw5s5skz9qUm2Dipk1E9pe8SgfjO2pZwvi7bbmW09zHcznpto6KtlKsnSjZHUj6Fp6jhunzR9nafY2MPEc+Gek7x7VzaWpgqoWywSNkYRsFp2u1Vw4f5vcLDURxSyOlpCdOb6BWCstzpbrQx1dLI1zXAEgHw+C8vrdDfS269Y9b0mi11NVHTpPqe1ERaLeEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARF11M0dPTvmlcGsY0kkoIh7TPEZuHYw+ho5dXCpHKAD1DT02qUGWeoqn1NTK6aaQkue49Stt45ZVPlvEKrqZZS6Ole6Fg300CtQi+Uvb8M0safDHrnu8xrs85ck+qEicE8Q/hjmdNQSkinHvPP0K7lpxSw22gjpILZTBjWgH3B1VV+yLWQQZsKeVzWve1xbtW7uM5p6KWVmucNJb8SuLxvLknPFN+jo8Lx0jFN/FAXaA4c0/fR3GwUwbM7ZfEwdNqHKuyXa1taa+kfHv4FXQsVJ3sPttU0Plm94hw3pefNbDa7vYqinq4IgeQ8hAAPNromk4vbDEYrRvHrY9TwuuaZyVnafUp1SrJ0niFsMvDbI4nzSU9LI+Fp20BnUhYP2eekqDBUxOikadFrhor0lM2PJ9md3ncmK+P7UbMjTeA2pD4V5JLabk2knlJppT4E9AVHlL4BZWlJHK4EgtOxpYs+Kuak0t4q4c1sN4vXvC00bg9jXtOw4bC5WrcNLs6549EZXblZ0P0LaV4fLjnFeaT4Pc4csZccXjxERFjZRERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERARF8ve1g25zWj4nSD6ReeSuo4x79XAP+sLyS320xfLr4R/1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xRtJPyj1b9HoptRQlqmAWGXF8elpZi1z2jmLh4u0PNafiVHLld0yW5nbPb6V1Ixx8iOilp7Q9hY4bDhoheS02uhtUBgoYGwxlxcQPUoI0tmC3yOxstnfQMNI3u2PHQvHqT5rO4lhRtOH1lrlbC+sn59SFu9E+HVb0iCGKfgwTFTsqp43l2/ajvq700u1/DCujrHxUz4WRiItY74ehUxIp3NkOWDhfdaFsL5Z4e8a4lvL4N+K9uP4Vd4LJeLNJIxr6utE3eeoHj1UrIkzuR0RbVYDcLfeX1VoMDWVMYidzD5J8yPRdb+GMtRkdvq6yYSQQxuE/Xq8nwKlZE3Gh8PsLqsavNTO50DqeTfJyj3hsrjIcTrblkE1WyRoDnbjJ+at9RQInrOFz6iaKkc9gou9E8oHQl4K9NRw8lguF/nZPSQ0VdTtjaX9OTQ8SpPWrZljVxvzHwRXh9LTSDUkYb8oKdxFGB49X5HU1sQe1othdTRSN6MePX4rP2ThTcKWCnkqamI1EU5k00+6BvyHqpOxqyUVhtcVDRxtaGtHO4Dq8+pWTTdCEclxC/WySsiog2RlwkD5XMGys9dMKr/4N2yGBwdJBO2Z7T1UoIo3Sj+54Q+/VlPX1z2t5RsNHQt6KPMQxCtrM3uNvqJmPou6kDO7Puh3lv4qwZ6jSwWK45BYnVb2P7x9RMZC7XhvyUwIusPB+6UtdRzVlXC9lLKX6B+WPQ+q9tHw1uFFlb6xj4pGTSGRvN1DB6fBTCibo2fFOzu4GM6ba0DovtEUJEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQf/9k=';

  var logoImg = new Paragraph({
    spacing:{before:0,after:160},
    children:[new ImageRun({data:Buffer.from(logoData,'base64'),transformation:{width:400,height:60},type:'png'})]
  });

  var isCPF = p.isCPF;
  var children = [
    logoImg,
    new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:200,after:80},children:[bx('Programme de formation professionnelle',{size:36,color:BLU})]}),
    new Paragraph({spacing:{before:0,after:400},children:[]}),
    sectionTitle('Intitulé de la formation'),
    new Paragraph({spacing:{before:120,after:240},children:[tx(p.trainingTitle,{size:22})]}),
    sectionTitle('Public visé'),
    new Paragraph({spacing:{before:120,after:80},children:[tx(p.candidateName + (p.jobtitle ? ' - ' + p.jobtitle : ''),{size:20})]}),
    new Paragraph({spacing:{before:0,after:240},children:[tx(p.dept||'',{size:20,color:'64748B'})]}),
    sectionTitle('Prérequis'),
    new Paragraph({spacing:{before:120,after:240},children:[tx('Niveau ' + p.prereqLevel + ' sur le referentiel CECRL (voir annexe)',{size:20})]}),
    sectionTitle('Objectif de niveau'),
    new Paragraph({spacing:{before:120,after:240},children:[tx('Niveau ' + p.targetLevel + ' sur le referentiel CECRL (voir annexe)',{size:20})]}),
    sectionTitle('Objectifs pédagogiques'),
    new Paragraph({spacing:{before:120,after:80},children:[tx(STRINGS.subtitle,{size:20})]}),
  ];

  (p.objectives||[]).forEach(function(o) { if (o.trim()) children.push(bullet(o)); });
  children.push(new Paragraph({spacing:{before:0,after:240},children:[]}));

  children.push(sectionTitle('Durée'));
  children.push(new Paragraph({spacing:{before:120,after:240},children:[tx(p.totalHours + ' heures',{size:20})]}));

  if (p.dateStart || p.dateEnd) {
    children.push(sectionTitle('Dates'));
    var dateStr = '';
    if (p.dateStart && p.dateEnd) {
      dateStr = 'Du ' + new Date(p.dateStart).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}) + ' au ' + new Date(p.dateEnd).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
    } else if (p.dateStart) {
      dateStr = 'A partir du ' + new Date(p.dateStart).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
    }
    children.push(new Paragraph({spacing:{before:120,after:240},children:[tx(dateStr,{size:20})]}));
  }

  children.push(sectionTitle('Lieu'));
  children.push(new Paragraph({spacing:{before:120,after:240},children:[tx(p.location||'A distance',{size:20})]}));

  children.push(sectionTitle('Déroulement de la formation'));
  children.push(new Paragraph({spacing:{before:120,after:240},children:[tx(p.coachingHours + STRINGS.delivery + p.homeworkHours + STRINGS.delivery2,{size:20})]}));

  children.push(sectionTitle('Contenu de la formation'));
  children.push(new Paragraph({spacing:{before:120,after:80},children:[tx(STRINGS.content1,{size:20})]}));
  children.push(new Paragraph({spacing:{before:80,after:80},children:[tx(STRINGS.content2,{size:20})]}));
  (p.topics||[]).forEach(function(t) { children.push(bullet(t)); });
  if (p.customTopics && p.customTopics.trim()) {
    p.customTopics.split('\n').forEach(function(t) { if (t.trim()) children.push(bullet(t.trim())); });
  }
  if (isCPF) { children.push(new Paragraph({spacing:{before:80,after:240},children:[tx(STRINGS.content3,{size:20})]})); }
  children.push(new Paragraph({spacing:{before:0,after:240},children:[]}));

  children.push(sectionTitle(STRINGS.secMoyens));
  children.push(new Paragraph({spacing:{before:120,after:80},children:[bx(STRINGS.secMoyensTech,{size:20}),tx(' ' + STRINGS.means1 + (isCPF ? STRINGS.means1cpf : ''),{size:20})]}));
  children.push(new Paragraph({spacing:{before:80,after:240},children:[bx(STRINGS.secMoyensEnc,{size:20}),tx(' ' + STRINGS.means2,{size:20})]}));

  children.push(sectionTitle(STRINGS.secSuiviAppr));
  children.push(new Paragraph({spacing:{before:120,after:80},children:[bx(STRINGS.secSuivi,{size:20})]}));
  children.push(bullet(STRINGS.suivi1));
  children.push(bullet(STRINGS.suivi2));
  children.push(new Paragraph({spacing:{before:80,after:80},children:[bx(STRINGS.secAppre,{size:20})]}));
  children.push(bullet(STRINGS.appre1));
  children.push(bullet(STRINGS.appre2));
  children.push(bullet(STRINGS.appre3));
  children.push(bullet(STRINGS.appre4));
  children.push(bullet(STRINGS.appre5));
  if (isCPF) { children.push(bullet(STRINGS.appre6)); }

  if (p.additionalNotes && p.additionalNotes.trim()) {
    children.push(new Paragraph({spacing:{before:0,after:240},children:[]}));
    children.push(sectionTitle('Notes complémentaires'));
    children.push(new Paragraph({spacing:{before:120,after:240},children:[tx(p.additionalNotes,{size:20,italics:true,color:'475569'})]}));
  }

  children.push(new Paragraph({spacing:{before:400,after:0},children:[]}));
  children.push(new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:160},children:[bx('Référentiel de niveau CECRL',{size:28,color:BLU})]}));
  var cecrlLevels = [
    {cat:'Utilisateur élémentaire',items:['A1 : Peut comprendre et utiliser des expressions simples et se presenter.','A2 : Peut communiquer lors de taches simples et decrire son environnement immediat.']},
    {cat:'Utilisateur indépendant',items:['B1 : Peut comprendre les points essentiels et s\'exprimer de maniere simple sur des sujets familiers.','B2 : Peut communiquer avec aisance dans un contexte professionnel et s\'exprimer de facon claire et detaillee.']},
    {cat:'Utilisateur expérimenté',items:['C1 : Peut s\'exprimer de maniere fluide, structuree et efficace dans un contexte professionnel.','C2 : Peut comprendre et s\'exprimer avec precision sur des sujets complexes.']},
  ];
  cecrlLevels.forEach(function(l) {
    children.push(new Paragraph({spacing:{before:120,after:60},children:[bx(l.cat,{size:20,color:BLU})]}));
    l.items.forEach(function(item) {
      var parts = item.split(':');
      children.push(new Paragraph({spacing:{before:40,after:40},children:[bx(parts[0]+':',{size:19}),tx(parts.slice(1).join(':'),{size:19})]}));
    });
  });

  return new Document({
    numbering:{config:[
      {reference:'prog-bullets',levels:[{level:0,format:LevelFormat.BULLET,text:'\u2197',alignment:AlignmentType.LEFT,style:{paragraph:{indent:{left:560,hanging:280}}}}]},
    ]},
    styles:{'default':{document:{run:{font:'Gill Sans MT',size:20,color:'1A1A1A'}}}},
    sections:[{
      properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},
      footers:{'default':new Footer({children:[new Paragraph({border:{top:{style:BorderStyle.SINGLE,size:4,color:'DDDDDD',space:4}},alignment:AlignmentType.CENTER,children:[new TextRun({text:STRINGS.footer,size:16,color:'94A3B8',font:'Gill Sans MT'})]})]})},
      children:children
    }]
  });
}

router.get('/generate-programme/:id', async function(req, res) {
  var candidates = getCandidates();
  var c = candidates.find(function(cand) { return cand.id === req.params.id; });
  if (!c) return res.status(404).json({ error: 'Not found' });
  var payload;
  if (req.query.data) {
    try { payload = JSON.parse(req.query.data); } catch(e) { return res.status(400).json({ error: 'Invalid data' }); }
  } else {
    var od = c.oralData || {};
    payload = { candidateName: c.name, jobtitle: c.jobtitle || '', dept: c.dept || '', company: c.company || '', prereqLevel: (c.reportSummary || {}).overallLevel || od.prereqLevel || od.listeningLevel || '', targetLevel: od.targetLevel || '', totalHours: String(od.totalHours || 10), coachingHours: String(od.coachingHours || od.totalHours || 10), homeworkHours: String(od.homeworkHours || 0), isCPF: false, topics: od.topics || [], objectives: od.objectives || od.validatedGoals || [], dateStart: od.dateStart || '', dateEnd: od.dateEnd || '', trainingTitle: od.trainingTitle || (c.courseType === 'legal' ? 'Formation en Anglais Juridique' : '') };
  }
  
  var { execFile } = require('child_process');
  var path = require('path');
  var tmpJson = '/tmp/prog_' + req.params.id + '.json';
  var tmpOut = '/tmp/prog_' + req.params.id + '.docx';
  var template = path.join(__dirname, '../views/template_programme.docx');
  var script = '/home/debian/fill_programme_final.py';
  
  // Build dateStr
  var dateStr = 'Dates à définir';
  if (payload.dateStart && payload.dateEnd) {
    var ds = new Date(payload.dateStart);
    var de = new Date(payload.dateEnd);
    var months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    dateStr = 'Du ' + ds.getDate() + ' ' + months[ds.getMonth()] + ' ' + ds.getFullYear() + ' au ' + de.getDate() + ' ' + months[de.getMonth()] + ' ' + de.getFullYear();
  }
  payload.dateStr = dateStr;
  
  console.log('PROGRAMME PAYLOAD:', JSON.stringify({isCPF: payload.isCPF, topicsCount: (payload.topics||[]).length, topics: payload.topics}));
  // Save dates to candidate record
  var candidates2 = getCandidates();
  var cidx = candidates2.findIndex(function(x) { return x.id === req.params.id; });
  if (cidx >= 0 && payload.dateStart) {
    candidates2[cidx].oralData.dateStart = payload.dateStart;
    candidates2[cidx].oralData.dateEnd = payload.dateEnd || payload.dateStart;
    if (payload.targetLevel) candidates2[cidx].oralData.targetLevel = payload.targetLevel;
    if (payload.totalHours) candidates2[cidx].oralData.totalHours = parseInt(payload.totalHours, 10) || payload.totalHours;
    if (payload.topics && payload.topics.length) candidates2[cidx].oralData.topics = payload.topics;
    saveCandidates(candidates2);
  }
  require('fs').writeFileSync(tmpJson, JSON.stringify(payload));
  
  // Update fill script to accept args
  execFile('python3', [script, tmpJson, template, tmpOut], function(err, stdout, stderr) {
    if (err) {
      console.error('Programme script error:', stderr);
      return res.status(500).json({ error: 'Programme generation failed: ' + stderr });
    }
    try {
      var fs2 = require('fs');
      var buffer = fs2.readFileSync(tmpOut);
      var safeName = (payload.candidateName || 'Candidat').replace(/\s+/g, '_');
      var filename = 'Programme_formation_' + safeName + '.docx';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      res.send(buffer);
      // Save permanent copy and convert to PDF
      var progDir = path.join(__dirname, '../data/programmes');
      if (!fs2.existsSync(progDir)) fs2.mkdirSync(progDir, { recursive: true });
      var permDocx = path.join(progDir, req.params.id + '.docx');
      var permPdf  = path.join(progDir, req.params.id + '.pdf');
      fs2.copyFileSync(tmpOut, permDocx);
      // Convert to PDF via LibreOffice
      execFile('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', progDir, permDocx], function(pdfErr) {
        if (pdfErr) console.error('Programme PDF conversion failed:', pdfErr);
        else {
          // Save PDF path to candidate
          var cands3 = getCandidates();
          var ci3 = cands3.findIndex(function(x) { return x.id === req.params.id; });
          if (ci3 > -1) { cands3[ci3].programmePdfPath = permPdf; saveCandidates(cands3); }
        }
      });
      fs2.unlinkSync(tmpJson);
      fs2.unlinkSync(tmpOut);
      // Mark programme as done
      var cands = getCandidates();
      var cidx = cands.findIndex(function(x) { return x.id === req.params.id; });
      if (cidx > -1) { cands[cidx].status = 'programme_done'; saveCandidates(cands); }
    } catch(e) {
      res.status(500).json({ error: 'Failed to read output: ' + e.message });
    }
  });
});




router.post('/suggest-topics/:id', async (req, res) => {
  const candidates = getCandidates();
  const c = candidates.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const topics = req.body.topics || [];
  const objectives = req.body.objectives || [];
  const report = (c.finalReport || c.writtenReport || '').substring(0, 3000);
  if (!report) return res.status(400).json({ error: 'No report available' });
  const topicList = topics.map((t,i) => (i+1)+'. '+t).join('\n');
  const objList = objectives.map((o,i) => (i+1)+'. '+o).join('\n');
  const prompt = 'Based on this English evaluation report, select the most relevant training topics and suggest 3 learning objectives.\n\nAVAILABLE TOPICS:\n' + topicList + '\n\nAVAILABLE OBJECTIVES:\n' + objList + '\n\nREPORT:\n' + report + '\n\nRespond ONLY with valid JSON: {"topics": ["exact topic name"], "objectives": ["exact objective"]}';
  try {
    const msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    const text = msg.content[0].text.trim().replace(/^```[a-z]*\n?/,'').replace(/```$/,'').trim();
    res.json({ success: true, ...JSON.parse(text) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


router.get('/download-convention-signed/:id', function(req, res) {
  var candidates = getCandidates();
  var candidate = candidates.find(function(c) { return c.id === req.params.id; });
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  var path = require('path');
  var fs = require('fs');
  var pdfPath = (candidate.conventionData && candidate.conventionData.signedPdfPath) || '';
  if (!pdfPath || !fs.existsSync(pdfPath)) return res.status(404).json({ error: 'Signed PDF not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="convention_signee_' + (candidate.name||'').replace(/\s+/g,'_') + '.pdf"');
  fs.createReadStream(pdfPath).pipe(res);
});

router.get('/download-convention-signed/:id', function(req, res) {
  var candidates = getCandidates();
  var candidate = candidates.find(function(c) { return c.id === req.params.id; });
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  var path = require('path');
  var fs = require('fs');
  var pdfPath = (candidate.conventionData && candidate.conventionData.signedPdfPath) || '';
  if (!pdfPath || !fs.existsSync(pdfPath)) return res.status(404).json({ error: 'Signed PDF not found' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="convention_signee_' + (candidate.name||'').replace(/\s+/g,'_') + '.pdf"');
  fs.createReadStream(pdfPath).pipe(res);
});

router.get('/download-convention/:id', (req, res) => {
  const candidate = getCandidates().find(c => c.id === req.params.id);
  if (!candidate) return res.status(404).json({ error: 'Not found' });
  const cd = candidate.conventionData;
  if (!cd) return res.status(404).json({ error: 'No convention generated' });
  const pdfPath = cd.signedPdfPath || cd.pdfPath;
  if (!pdfPath || !require('fs').existsSync(pdfPath)) return res.status(404).json({ error: 'PDF not found' });
  const signed   = !!cd.signedPdfPath;
  const filename = `convention_${candidate.name.replace(/\s+/g,'_')}${signed?'_signe':''}.pdf`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

// POST /api/save-convention/:id
router.post('/save-convention/:id', function(req, res) {
  var candidates = getCandidates();
  var idx = candidates.findIndex(function(x){ return x.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  var existing = candidates[idx].conventionData || {};
  candidates[idx].conventionData = Object.assign(existing, req.body);
  saveCandidates(candidates);
  res.json({ success: true });
});

// POST /api/generate-convention/:id
router.post('/generate-convention/:id', function(req, res) {
  var candidates = getCandidates();
  var idx = candidates.findIndex(function(x){ return x.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  var c = candidates[idx];
  var cd = c.conventionData || {};
  var od = c.oralData || {};
  var sendEmail = !(req.body && req.body.sendEmail === false);
  var execFile = require('child_process').execFile;
  var crypto = require('crypto');
  var signingToken = cd.signingToken || crypto.randomBytes(20).toString('hex');
  var isCPF = cd.isCPF || false;
  var tt = od.legalTrainingType || (isCPF ? 'CPF' : 'NON_CPF');
  var tplKey = tt === 'CAJA' ? 'CAJA' : tt === 'E360' ? 'E360' : 'NON_CPF';
  // Format dates as French string - prefer oralData (updated when programme regenerated)
  var MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  function fmtDateFr(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getUTCDate() + ' ' + MONTHS_FR[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  var dateStart = od.dateStart || cd.dateStart || '';
  var dateEnd = od.dateEnd || cd.dateEnd || '';
  var dateStr = '';
  if (dateStart && dateEnd) {
    dateStr = 'du ' + fmtDateFr(dateStart) + ' au ' + fmtDateFr(dateEnd);
  } else if (dateStart) {
    dateStr = 'a partir du ' + fmtDateFr(dateStart);
  }
  var data = {
    candidateName: c.name || '',
    civility: cd.civility || 'Madame',
    companyName: c.company || '',
    companySiret: cd.siret || '',
    totalHours: String(od.totalHours || ''),
    coachingHours: String(od.coachingHours || ''),
    homeworkHours: String(od.homeworkHours || ''),
    prereqLevel: (c.reportSummary || {}).overallLevel || '',
    targetLevel: od.targetLevel || '',
    location: 'A distance',
    dateStart: dateStart,
    dateEnd: dateEnd,
    dateStr: dateStr,
    price: String(cd.price || ''),
    signatory: cd.signatory || '',
    signingToken: signingToken,
    trainingType: tplKey,
    courseType: c.courseType || '',
    trainingTitle: od.trainingTitle || (isCPF ? 'Communiquer en anglais professionnel - English 360 - Niveau B2' : (c.courseType === 'legal' ? 'Formation en Anglais Juridique' : 'Formation en Anglais Professionnel'))
  };
  execFile('python3', ['/home/debian/fill_convention2.py', JSON.stringify(data)], { timeout: 90000 }, function(err, stdout, stderr) {
    if (err) { console.error('fill_convention2 error:', stderr, stdout); return res.status(500).json({ error: 'Convention generation failed: ' + stderr }); }
    var result;
    try { result = JSON.parse(stdout.trim()); } catch(e) { return res.status(500).json({ error: 'Invalid fill_convention2 output: ' + stdout }); }
    if (result.success === false) return res.status(500).json({ error: result.error });
    candidates[idx].conventionData = Object.assign(cd, { pdfPath: result.pdfPath, signingToken: signingToken, generatedAt: new Date().toISOString() });
    saveCandidates(candidates);
    if (!sendEmail) return res.json({ success: true, pdfPath: result.pdfPath });
    var signingUrl = 'https://eval.linguaid.net/sign/' + signingToken;
    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    transporter.sendMail({
      from: 'jfr@linguaid.net',
      to: cd.signatoryEmail || c.email,
      subject: 'Convention de formation - ' + c.name + ' - Linguaid France',
      html: '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6"><p>Bonjour ' + (cd.civility || 'Madame') + ' ' + (cd.signatory || c.name) + ',</p><p>Suite à l’évaluation linguistique de ' + c.name + ', nous avons le plaisir de vous adresser la convention de formation suivante :</p><ul><li><strong>Formation :</strong> ' + ((c.oralData||{}).trainingTitle || 'Formation en Anglais') + '</li><li><strong>Durée :</strong> ' + ((c.oralData||{}).totalHours || '—') + 'h</li><li><strong>Dates :</strong> du ' + (dateStart ? fmtDateFr(dateStart) : '—') + ' au ' + (dateEnd ? fmtDateFr(dateEnd) : '—') + '</li><li><strong>Tarif HT :</strong> ' + (cd.price || '—') + ' €</li></ul><p>Pour valider cette convention, veuillez cliquer sur le lien ci-dessous et signer électroniquement :</p><p><a href="' + signingUrl + '" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Signer la convention</a></p><p>Ou copiez ce lien dans votre navigateur : <a href="' + signingUrl + '">' + signingUrl + '</a></p><p>N’hésitez pas à nous contacter pour toute question.</p><p>Bien cordialement,</p><img src="https://eval.linguaid.net/signature_joss.png" style="max-width:400px"></div>'
    }, function(mailErr) {
      if (mailErr) console.error('Mail error:', mailErr);
      res.json({ success: true, signingUrl: signingUrl, pdfPath: result.pdfPath });
    });
  });
});
router.post('/send-oral-link/:id', function(req, res) {
  var candidates = JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));
  var c = candidates.find(function(x) { return x.id === req.params.id; });
  if (!c) return res.status(404).json({ error: 'Candidate not found' });
  var emails = { Louise: 'lga@linguaid.net', Hannah: 'coursdanglais24@gmail.com', Anna: 'ajmalzy@gmail.com', Joss: 'jfr@linguaid.net' };
  var evaluator = req.body.evaluator;
  var toEmail = emails[evaluator];
  if (!toEmail) return res.status(400).json({ error: 'Unknown evaluator' });
  var oralUrl = 'https://eval.linguaid.net/oral/' + c.oralToken;
  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
  var body = ['Bonjour ' + evaluator + ',', '', 'Please find the oral assessment link for ' + c.name + ':', '', oralUrl, '', 'Best regards,', 'Linguaid Eval'].join('\n');
  transporter.sendMail({ from: 'eval@linguaid.net', to: toEmail, subject: 'Oral assessment - ' + c.name, text: body }, function(err) {
    if (err) { console.error('sendMail error:', err); return res.status(500).json({ error: err.message }); }
    var idx = candidates.findIndex(function(x) { return x.id === req.params.id; });
    candidates[idx].oralEmailSentTo = evaluator;
    saveCandidates(candidates);
    res.json({ ok: true });
  });
});

router.post('/parse-legal-questionnaire', async function(req, res) {
  var text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    var prompt = [
      'Extract all available information from this French legal English prospect questionnaire text.',
      'Return ONLY a valid JSON object with these exact keys (use null if not found, do not omit keys):',
      'name, email, phone, region, lawyerType (avocat/juriste/other), jobtitle, company, experience (years as number),',
      'legalDomains (string), legalDocs (string), selfLevelOral (string), selfLevelWriting (string),',
      'currentUsage (string describing current English usage at work),',
      'mediaVO (string: oui/non/parfois or similar),',
      'goalType (oral/ecrit/les deux),',
      'mainGoal (string, their main objective in their own words),',
      'upcomingEvent (string or null),',
      'otherNeeds (string),',
      'financingMode (string: CPF/employeur/personnel/je ne sais pas or similar),',
      'cpfCreated (string: oui/non or null),',
      'source (how they heard about the trainer),',
      'dept (null), goals (array of strings summarising their objectives)',
      '',
      'Questionnaire text:',
      text
    ].join('\n');
    var msg = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] });
    var raw = msg.content[0].text.replace(/```json|```/g, '').trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(e) {
    console.error('parse-legal-questionnaire error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/generate-programme-legal/:id', function(req, res) {
  res.redirect('/candidates/' + req.params.id + '/programme');
});

// Typeform webhook - fired when candidate completes the test
router.post('/typeform-webhook', function(req, res) {
  var payload = req.body;
  var form_response = payload.form_response || payload;
  var answers = form_response.answers || [];
  var score = (form_response.calculated || {}).score || 0;
  var max = 26;

  function getAnswer(fieldId) {
    var a = answers.find(function(x) { return x.field && x.field.id === fieldId; });
    if (!a) return null;
    if (a.type === 'text' || a.type === 'email') return a[a.type] || null;
    if (a.type === 'choice') return (a.choice || {}).label || null;
    if (a.type === 'choices') return a.choices || null;
    if (a.type === 'boolean') return a.boolean;
    return null;
  }

  var name = getAnswer('9oDCQhgIKUCa') || 'Unknown';
  var email = getAnswer('ewBvfryvLC6C') || '';
  var company = getAnswer('nHNnnVsELnI1') || '';
  var dept = getAnswer('REMkImqUgjz6') || '';
  var jobtitle = getAnswer('71SDBs9cYd2p') || '';
  var otherNeeds = getAnswer('tBwFQiTenYCQ') || '';
  var q39 = getAnswer('9xeyds9qFwxc') || '';
  var q40 = getAnswer('tBc5ipiPSw9t') || '';
  var q41 = getAnswer('hTuJurZ183Mn') || '';

  // Goals from choices field
  var goalsRaw = getAnswer('injrb1qptVqY');
  var goals = [];
  if (goalsRaw && goalsRaw.labels) goals = goalsRaw.labels;
  else if (goalsRaw && Array.isArray(goalsRaw)) goals = goalsRaw;

  // Availability from multiple choice fields
  var availFields = ['iN5olqp16VhV','C35mLlYqvYE0','LC0qGNmYkYWf','4XE5Bjvzwa3o','iOiGSfDqDu5Y'];
  var avail = {};
  var days = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
  availFields.forEach(function(fid, i) {
    var v = getAnswer(fid);
    if (v && v.labels) avail[days[i]] = v.labels.join(', ');
    else if (v && Array.isArray(v)) avail[days[i]] = v.join(', ');
  });

  var candidates = JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));

  // Check if already exists (by email)
  var existing = candidates.find(function(x) { return x.email && x.email.toLowerCase() === email.toLowerCase(); });
  if (existing && existing.status !== 'invited') {
    console.log('Typeform webhook: candidate already exists:', email);
    return res.json({ ok: true, message: 'already exists' });
  }

  var now = new Date().toISOString();
  var testdate = now.slice(0,10);

  if (existing && existing.status === 'invited') {
    // Update the invited candidate with test results
    var idx = candidates.findIndex(function(x) { return x.id === existing.id; });
    candidates[idx].status = 'csv_uploaded';
    candidates[idx].scores = { total: score, max: max };
    candidates[idx].freewriting = { q39: q39, q40: q40, q41: q41 };
    candidates[idx].goals = goals;
    candidates[idx].avail = avail;
    candidates[idx].otherNeeds = otherNeeds;
    candidates[idx].company = candidates[idx].company || company;
    candidates[idx].dept = candidates[idx].dept || dept;
    candidates[idx].jobtitle = candidates[idx].jobtitle || jobtitle;
    candidates[idx].testdate = testdate;
  } else {
    // Create new candidate from webhook
    var newId = require('crypto').randomBytes(6).toString('hex');
    candidates.push({
      id: newId,
      name: name,
      email: email,
      company: company,
      dept: dept,
      jobtitle: jobtitle,
      testdate: testdate,
      scores: { total: score, max: max },
      freewriting: { q39: q39, q40: q40, q41: q41 },
      goals: goals,
      avail: avail,
      otherNeeds: otherNeeds,
      status: 'csv_uploaded',
      oralToken: require('crypto').randomBytes(8).toString('hex'),
      createdAt: now
    });
  }

  saveCandidates(candidates);

  // Alert Joss
  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
  transporter.sendMail({
    from: 'eval@linguaid.net',
    to: 'jfr@linguaid.net',
    subject: 'Test completed - ' + name,
    text: name + ' (' + email + ') has completed the English test.\n\nScore: ' + score + '/' + max + '\n\nhttps://eval.linguaid.net/candidates'
  }, function(err) { if (err) console.error('alert mail error:', err); });

  res.json({ ok: true });
});

// Invite a candidate - send them the Typeform link
router.post('/invite-candidate', function(req, res) {
  var name = (req.body.name || '').trim();
  var email = (req.body.email || '').trim();
  var company = (req.body.company || '').trim();
  var jobtitle = (req.body.jobtitle || '').trim();
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  var candidates = JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));
  // Allow re-inviting - only block if currently in active pipeline (not yet finished)

  var now = new Date().toISOString();
  var newId = require('crypto').randomBytes(6).toString('hex');
  var candidate = {
    id: newId,
    name: name,
    email: email,
    company: company,
    jobtitle: jobtitle,
    dept: '',
    testdate: '',
    scores: { total: 0, max: 26 },
    freewriting: { q39: '', q40: '', q41: '' },
    goals: [],
    avail: {},
    otherNeeds: '',
    status: 'invited',
    oralToken: require('crypto').randomBytes(8).toString('hex'),
    createdAt: now,
    invitedAt: now,
    lastReminderAt: now
  };
  candidates.push(candidate);
  saveCandidates(candidates);

  var typeformUrl = 'https://form.typeform.com/to/XBcM6I1W';
  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
  var body = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
    + '<p>Bonjour ' + name + ',</p>'
    + '<p>Vous allez normalement suivre une formation en anglais avec nous. Avant la formation, nous avons besoin d\'évaluer votre niveau et vos besoins afin d\'établir le devis de formation et le programme personnalisé.</p>'
    + '<p>Pour démarrer, veuillez trouver le lien vers un test d\'anglais écrit. Ceci nous permettra d\'avoir une première appréciation de votre niveau. Par la suite, un membre de notre équipe vous contactera par téléphone pour la partie orale.</p>'
    + '<p>Comptez 20 minutes MAXIMUM au calme pour réaliser ce test. Pour toutes questions ou informations supplémentaires avant ou après, n\'hésitez pas à nous joindre directement.</p>'
    + '<p>Accès direct au test (le contenu est général, mais cela nous permet de mieux apprécier le niveau) :<br>'
    + '<a href="' + typeformUrl + '">' + typeformUrl + '</a></p>'
    + '<p>Etapes à suivre :</p>'
    + '<ul><li>Cliquez sur le lien ci-dessus</li><li>Remplissez les champs pour vous identifier</li><li>Répondez aux questions</li><li>Soumettez le test à la fin.</li></ul>'
    + '<p>Bon test !</p>'
    + '<p>Bien cordialement,</p>'
    + '<img src="https://eval.linguaid.net/signature_joss.png" alt="Joss Frimond - Linguaid" style="max-width:400px;display:block;margin-top:8px">'
    + '</div>';
  transporter.sendMail({
    from: 'eval@linguaid.net',
    to: email,
    subject: 'Votre test d\'anglais - Linguaid',
    html: body
  }, function(err) {
    if (err) { console.error('invite mail error:', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true, id: newId });
  });
});

// Parse end-of-course report PDF text to extract renewal data
router.post('/parse-eocr', async function(req, res) {
  var text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });
  try {
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    var prompt = [
      'Extract information from this end-of-course report (rapport de fin de cours) from a language school.',
      'Return ONLY valid JSON with these exact keys (null if not found):',
      '{',
      '  "name": "candidate full name (LASTNAME Firstname format)",',
      '  "company": "client/employer name",',
      '  "jobtitle": "position if present",',
      '  "prereqLevel": "current/final CEFR level as letter code only e.g. C1+ or B2 (NOT numeric like 4-5)",',
      '  "totalHours": number of hours as integer,',
      '  "courseType": "type of course e.g. Cours individuels par videoconference",',
      '  "objectives": ["array of specific learning objectives listed in the report"],',
      '  "strengths": "key strengths noted",',
      '  "improvements": "areas for improvement noted",',
      '  "globalComment": "overall comment/summary"',
      '}',
      '',
      'Report text:',
      text
    ].join('\n');
    var msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    var raw = msg.content[0].text.replace(/```json|```/g, '').trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(e) {
    console.error('parse-eocr error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Create a renewal candidate - pre-populated, goes straight to programme
router.post('/new-renewal', function(req, res) {
  var d = req.body;
  if (!d.name || !d.email) return res.status(400).json({ error: 'Name and email required' });

  var candidates = JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));
  var now = new Date().toISOString();
  var newId = require('crypto').randomBytes(6).toString('hex');

  // Build synthetic oralData so programme page has what it needs
  var oralData = {
    evaluator: 'Renewal',
    sessionDate: now.slice(0,10),
    listeningLevel: d.prereqLevel || '',
    speakingLevel: d.prereqLevel || '',
    targetLevel: d.targetLevel || '',
    totalHours: d.totalHours || '',
    coachingHours: d.coachingHours || '',
    homeworkHours: d.homeworkHours || '',
    dateStart: d.dateStart || '',
    dateEnd: d.dateEnd || '',
    validatedGoals: [],
    validatedAvail: [],
    criteria: {},
    strengths: d.strengths || '',
    gaps: d.improvements || '',
    profile: d.globalComment || '',
    additionalNotes: 'Renewal candidate - previous course data used'
  };

  // Build synthetic reportSummary
  var reportSummary = {
    overallLevel: d.prereqLevel || '',
    grammarLevel: d.prereqLevel || '',
    writingLevel: d.prereqLevel || '',
    readingLevel: d.prereqLevel || '',
    listeningLevel: d.prereqLevel || '',
    speakingLevel: d.prereqLevel || '',
    keyGaps: d.improvements || ''
  };

  // Build synthetic final report
  var finalReport = [
    '## Renewal — Previous Course Summary',
    '',
    '### Candidate Profile',
    d.globalComment || '',
    '',
    '### Strengths',
    d.strengths || '',
    '',
    '### Areas for Improvement',
    d.improvements || '',
    '',
    '## Learning Objectives',
    (d.objectives || []).map(function(o, i) { return (i+1) + '. ' + o; }).join('\n'),
    '',
    '## Training Recommendation',
    'Renewal course based on previous training. Starting level: ' + (d.prereqLevel || '') + '. Target level: ' + (d.targetLevel || '') + '.'
  ].join('\n');

  var candidate = {
    id: newId,
    name: d.name,
    email: d.email || '',
    company: d.company || '',
    dept: d.dept || '',
    jobtitle: d.jobtitle || '',
    testdate: now.slice(0,10),
    scores: { total: 0, max: 0 },
    freewriting: { q39: '', q40: '', q41: '' },
    goals: d.objectives || [],
    avail: {},
    otherNeeds: '',
    status: 'final_report_done',
    isRenewal: true,
    oralToken: require('crypto').randomBytes(8).toString('hex'),
    oralData: oralData,
    reportSummary: reportSummary,
    finalReport: finalReport,
    createdAt: now
  };

  candidates.push(candidate);
  saveCandidates(candidates);
  res.json({ ok: true, id: newId });
});


// Extract text from uploaded PDF (base64) using pdftotext
router.post('/extract-pdf-text', function(req, res) {
  var base64 = req.body.pdf;
  if (!base64) return res.status(400).json({ error: 'No PDF data' });
  var tmp = require('os').tmpdir() + '/eocr_' + Date.now() + '.pdf';
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
  var exec = require('child_process').exec;
  exec('pdftotext -layout "' + tmp + '" -', function(err, stdout, stderr) {
    fs.unlinkSync(tmp);
    if (err) return res.status(500).json({ error: 'pdftotext failed: ' + stderr });
    res.json({ ok: true, text: stdout });
  });
});
// Send Calendly booking link to candidate
router.post('/send-calendly-link/:id', function(req, res) {
  var candidates = JSON.parse(require('fs').readFileSync(require('path').join(dataDir, 'candidates.json'), 'utf8'));
  var candidate = candidates.find(function(c) { return c.id === req.params.id; });
  if (!candidate) return res.status(404).json({ error: 'Not found' });

  var evaluator = (req.body.evaluator || '').trim();
  var calendlyMap = {
    'Hannah': 'https://calendly.com/coursdanglais24/english-oral-test',
    'Anna':   'https://calendly.com/ajmalzy/30min',
    'Louise': 'https://calendly.com/coursdanglais24/english-oral-test',
    'Joss':   'https://calendly.com/coursdanglais24/english-oral-test'
  };
  var evaluatorEmails = { Louise: 'lga@linguaid.net', Hannah: 'coursdanglais24@gmail.com', Anna: 'ajmalzy@gmail.com', Joss: 'jfr@linguaid.net' };
  var calendlyUrl = calendlyMap[evaluator] || 'https://calendly.com/coursdanglais24/english-oral-test';
  var evaluatorEmail = evaluatorEmails[evaluator] || null;

  var firstName = candidate.name.split(' ')[0];
  var htmlBody = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
    + '<p>Bonjour ' + firstName + ',</p>'
    + '<p>Merci d&#39;avoir compl&eacute;t&eacute; votre test d&#39;anglais &eacute;crit.</p>'
    + '<p>Pour finaliser votre &eacute;valuation, nous vous invitons &agrave; r&eacute;server un cr&eacute;neau de 30 minutes pour la partie orale :</p>'
    + '<p><a href="' + calendlyUrl + '" style="background:#1F4E79;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">R&eacute;server mon cr&eacute;neau oral</a></p>'
    + '<p>Il s&#39;agit d&#39;un entretien informel en anglais d&#39;environ 30 minutes, qui nous permettra de mieux cerner votre niveau &agrave; l&#39;oral et vos besoins.</p>'
    + '<p>Bien cordialement,</p>'
    + '<img src="https://eval.linguaid.net/signature_joss.png" alt="Joss Frimond - Linguaid" style="max-width:400px;display:block;margin-top:8px">'
    + '</div>';

  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
  transporter.sendMail({
    from: 'eval@linguaid.net',
    to: candidate.email,
    cc: evaluatorEmail || undefined,
    subject: "Votre evaluation anglais - reservez votre entretien oral",
    html: htmlBody
  }, function(err) {
    if (err) { console.error('calendly mail error:', err); return res.status(500).json({ error: err.message }); }
    res.json({ ok: true });
  });
});


router.post('/parse-renewal-pdf', async (req, res) => {
  try {
    const pdfBase64 = req.body.pdfBase64;
    const type = req.body.type;
    if (!pdfBase64) return res.status(400).json({ error: 'No PDF data' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = type === 'report'
      ? 'Tu es un assistant qui extrait des informations structurees d un rapport de fin de formation en anglais professionnel. Reponds UNIQUEMENT en JSON valide, sans markdown ni backticks, avec ces champs: {"name":"...","email":null,"jobtitle":null,"company":null,"prereqLevel":"...","levelReached":"...","targetLevel":"...","totalHours":10,"coachingHours":10,"homeworkHours":0,"completedObjectives":[],"suggestedObjectives":[],"keyGaps":"...","otherNeeds":"..."}'
      : 'Tu es un assistant qui extrait des informations structurees d un programme de formation professionnelle en anglais. Reponds UNIQUEMENT en JSON valide, sans markdown ni backticks, avec ces champs: {"name":"...","email":null,"jobtitle":null,"company":null,"prereqLevel":"...","targetLevel":"...","totalHours":10,"coachingHours":10,"homeworkHours":0,"previousObjectives":[],"suggestedObjectives":[],"otherNeeds":"..."}';

    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
        }, {
          type: 'text',
          text: 'Extrais les informations de ce document et retourne uniquement le JSON demande.'
        }]
      }]
    });

    const raw = (response.content.find(b => b.type === 'text') || {}).text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    res.json({ success: true, data });
  } catch (err) {
    console.error('parse-renewal-pdf error:', err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/send-to-catherine/:id', function(req, res) {
  try {
    var candidates = getCandidates();
    var c = candidates.find(function(x){ return x.id === req.params.id; });
    if (!c) return res.status(404).json({ error: 'Not found' });
    var cd = c.conventionData || {};
    var od = c.oralData || {};
    var notes = (req.body && req.body.notes) || '';

    // Find programme PDF - check standard locations
    var fs = require('fs');
    var path = require('path');
    var programmePdf = null;
    var progDocx = '/tmp/prog_' + c.id + '.docx';
    // Convention PDF - use signed if available, otherwise unsigned
    var conventionPdf = cd.signedPdfPath || cd.pdfPath || null;

    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });

    var MONTHS_FR = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'];
    function fmtDate(iso) {
      if (!iso) return 'non defini';
      var d = new Date(iso);
      return d.getUTCDate() + ' ' + MONTHS_FR[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    var subject = 'Nouveau contrat ManageAll — ' + c.name;
    var signed = cd.signedAt ? ' (SIGNEE le ' + fmtDate(cd.signedAt) + ')' : ' (en attente de signature)';

    var html = '<div style="font-family:sans-serif;max-width:700px">' +
      '<h2 style="color:#1F4E79">Nouveau contrat a saisir dans ManageAll</h2>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:20px">' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600;width:200px">Apprenant</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + c.name + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Poste</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (c.jobtitle || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Entreprise</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (c.company || c.dept || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">SIRET</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.siret || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Email</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (c.email || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Formation</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (od.trainingTitle || (c.courseType === 'legal' ? 'Formation en Anglais Juridique' : 'Formation en Anglais Professionnel')) + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Heures</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (od.totalHours || '—') + 'h (' + (od.coachingHours || od.totalHours || '—') + 'h coaching + ' + (od.homeworkHours || 0) + 'h autonome)</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Dates</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">du ' + fmtDate(od.dateStart || cd.dateStart) + ' au ' + fmtDate(od.dateEnd || cd.dateEnd) + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Prix HT</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.price || '—') + ' €</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">CPF</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.isCPF ? 'Oui' : 'Non') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Signataire</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.signatory || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Tél apprenant</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.learnerTel || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Adresse entreprise</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.companyAddress || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">N° de commande</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + (cd.orderNumber || '—') + '</td></tr>' +
      '<tr><td style="padding:6px 12px;background:#f1f5f9;font-weight:600">Convention</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">' + signed + '</td></tr>' +
      (notes ? '<tr><td style="padding:6px 12px;background:#fef3c7;font-weight:600">Notes</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;background:#fef3c7">' + notes + '</td></tr>' : '') +
      '</table>' +
      '<p style="color:#666;font-size:13px">Email genere automatiquement depuis Linguaid Eval</p>' +
      '</div>';

    var attachments = [];
    if (conventionPdf && fs.existsSync(conventionPdf)) {
      var convLabel = cd.signedAt ? 'convention_signee_' : 'convention_';
      attachments.push({ filename: convLabel + c.name.replace(/\s+/g,'_') + '.pdf', path: conventionPdf });
    }
    // Use permanent programme PDF
    var progPdfPath = path.join(__dirname, '../data/programmes/' + c.id + '.pdf');
    if (fs.existsSync(progPdfPath)) {
      attachments.push({ filename: 'programme_' + c.name.replace(/\s+/g,'_') + '.pdf', path: progPdfPath });
    } else if (c.programmePdfPath && fs.existsSync(c.programmePdfPath)) {
      attachments.push({ filename: 'programme_' + c.name.replace(/\s+/g,'_') + '.pdf', path: c.programmePdfPath });
    }

    // Mark sentToCatherineAt
    var cands4 = getCandidates();
    var ci4 = cands4.findIndex(function(x){ return x.id === req.params.id; });
    if (ci4 > -1) {
      cands4[ci4].conventionData = Object.assign(cands4[ci4].conventionData || {}, { sentToCatherineAt: new Date().toISOString() });
      saveCandidates(cands4);
    }
    transporter.sendMail({
      from: 'nouvellecommande@linguaid.net',
      to: 'cfr@linguaid.net',
      cc: 'jfr@linguaid.net',
      subject: subject,
      html: html,
      attachments: attachments
    }, function(err) {
      if (err) { console.error('send-to-catherine error:', err); return res.status(500).json({ error: err.message }); }
      res.json({ success: true });
    });
  } catch(err) {
    console.error('send-to-catherine error:', err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/hec-webhook', function(req, res) {
  var payload = req.body;
  var form_response = payload.form_response || payload;
  var answers = form_response.answers || [];
  var variables = form_response.variables || [];

  function getVar(key) {
    var v = variables.find(function(x) { return x.key === key; });
    return v ? (v.number || 0) : 0;
  }

  function getAnswer(fieldId) {
    var a = answers.find(function(x) { return x.field && x.field.id === fieldId; });
    if (!a) return null;
    if (a.type === 'text') return a.text || null;
    if (a.type === 'email') return a.email || null;
    if (a.type === 'choice') return (a.choice || {}).label || null;
    if (a.type === 'choices') return a.choices || null;
    if (a.type === 'boolean') return a.boolean;
    return null;
  }

  var name = getAnswer('l87c4bwthARj') || 'Unknown';
  var email = getAnswer('wUnUJuOsrwu8') || '';
  var dept = getAnswer('fVSco3dwYncM') || '';
  var jobtitle = getAnswer('y8OH4vxEti1l') || '';
  var otherNeeds = getAnswer('LnlpjBLpA6LQ') || '';
  var q39 = getAnswer('TIlw5XoY07mx') || '';
  var q40 = getAnswer('Q7yeLsFkTmyJ') || '';
  var q41 = getAnswer('i0cAcNJJy3ZM') || '';

  var score = getVar('correct_answers');
  var max = getVar('max_score') || 30;

  // Goals
  var goalsRaw = getAnswer('D5oVbrWgm7KJ');
  var goals = [];
  if (goalsRaw && goalsRaw.labels) goals = goalsRaw.labels;
  else if (goalsRaw && Array.isArray(goalsRaw)) goals = goalsRaw;

  // Availability
  var availFieldIds = ['HzRZ2vy45K5c','Bu4VHwKlr7uD','nkZHwfggJUNS','cVg3STXAYxXr','zDpGYBth7olt'];
  var days = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
  var avail = {};
  availFieldIds.forEach(function(fid, i) {
    var v = getAnswer(fid);
    if (v && v.labels) avail[days[i]] = v.labels.join(', ');
    else if (v && Array.isArray(v)) avail[days[i]] = v.join(', ');
  });

  var candidates = JSON.parse(fs.readFileSync(path.join(dataDir, 'candidates.json'), 'utf8'));

  // Deduplicate by email
  var existing = candidates.find(function(x) { return x.email && x.email.toLowerCase() === email.toLowerCase(); });
  if (existing && existing.status !== 'invited') {
    console.log('HEC webhook: candidate already exists:', email);
    return res.json({ ok: true, message: 'already exists' });
  }

  var now = new Date().toISOString();
  var testdate = (form_response.submitted_at || now).slice(0, 10);

  if (existing && existing.status === 'invited') {
    var idx = candidates.findIndex(function(x) { return x.id === existing.id; });
    candidates[idx].status = 'csv_uploaded';
    candidates[idx].scores = { total: score, max: max };
    candidates[idx].freewriting = { q39: q39, q40: q40, q41: q41 };
    candidates[idx].goals = goals;
    candidates[idx].avail = avail;
    candidates[idx].otherNeeds = otherNeeds;
    candidates[idx].company = candidates[idx].company || 'HEC Paris';
    candidates[idx].dept = candidates[idx].dept || dept;
    candidates[idx].jobtitle = candidates[idx].jobtitle || jobtitle;
    candidates[idx].testdate = testdate;
  } else {
    var newId = require('crypto').randomBytes(6).toString('hex');
    candidates.push({
      id: newId,
      name: name,
      email: email,
      company: 'HEC Paris',
      dept: dept,
      jobtitle: jobtitle,
      testdate: testdate,
      scores: { total: score, max: max },
      freewriting: { q39: q39, q40: q40, q41: q41 },
      goals: goals,
      avail: avail,
      otherNeeds: otherNeeds,
      status: 'csv_uploaded',
      writtenReport: null,
      oralData: null,
      finalReport: null,
      oralToken: require('crypto').randomBytes(8).toString('hex'),
      createdAt: now
    });
  }

  saveCandidates(candidates);

  // Alert Joss
  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
  transporter.sendMail({
    from: 'eval@linguaid.net',
    to: 'jfr@linguaid.net',
    subject: 'HEC test completed - ' + name,
    text: name + ' (' + email + ') has completed the HEC English test.\n\nDept: ' + dept + '\nJob: ' + jobtitle + '\nScore: ' + score + '/' + max + '\n\nhttps://eval.linguaid.net/candidates'
  }, function(err) { if (err) console.error('HEC alert mail error:', err); });

  res.json({ ok: true });
});

module.exports = router;
