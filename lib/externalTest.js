/* EXTERNAL_TEST_20260925
   A candidate may arrive with a level test taken elsewhere (ELAO for a Safran
   recruitment, TOEIC, Linguaskill, Bright, ...) and refuse to sit ours. The
   report is uploaded, its five skill levels become the MEASURED evidence:
     grammar / writing / reading  -> c.reportSummary (what the written report and
                                     calc5SkillLevel read)
     listening / speaking         -> c.oralData when the external oral is used
                                     (useEvaluatorOral=false); otherwise the
                                     evaluator oral via Calendly follows as usual.
   Shape: c.externalTest = { provider, ref, date, context, overall,
     skills:{grammar,writing,reading,listening,speaking}, modules:[{name,level,score}],
     notes, pdfPath, useEvaluatorOral, addedAt, addedBy } */

var PROVIDERS = ['ELAO', 'TOEIC', 'Linguaskill', 'Bright', 'Pipplet', 'IELTS', 'Cambridge', 'Autre'];
var CEFR = ['A1', 'A1+', 'A2', 'A2+', 'B1', 'B1+', 'B2', 'B2+', 'C1', 'C1+', 'C2'];

function normLevel(v) {
  var s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
  var m = s.match(/^(A1|A2|B1|B2|C1|C2)(\+?)/);
  if (!m) return '';
  return m[1] + m[2];
}
function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

/* Validates + normalises the payload from the form. Throws Error(message) on a hard fault. */
function normalise(data) {
  data = data || {};
  var skills = data.skills || {};
  var out = {
    provider: PROVIDERS.indexOf(String(data.provider || '').trim()) !== -1 ? String(data.provider).trim() : (isBlank(data.provider) ? 'Autre' : String(data.provider).trim()),
    providerOther: String(data.providerOther || '').trim(),
    ref: String(data.ref || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) ? String(data.date) : '',
    context: String(data.context || '').trim(),
    overall: normLevel(data.overall),
    skills: {
      grammar: normLevel(skills.grammar), writing: normLevel(skills.writing), reading: normLevel(skills.reading),
      listening: normLevel(skills.listening), speaking: normLevel(skills.speaking)
    },
    modules: Array.isArray(data.modules) ? data.modules.filter(function (m) { return m && !isBlank(m.name); }).map(function (m) {
      return { name: String(m.name).trim(), level: normLevel(m.level), score: isBlank(m.score) ? '' : String(m.score).trim() };
    }) : [],
    notes: String(data.notes || '').trim(),
    useEvaluatorOral: !!data.useEvaluatorOral
  };
  var have = ['grammar', 'writing', 'reading'].filter(function (k) { return out.skills[k]; });
  if (!out.overall && !have.length) throw new Error('Indiquez au moins le niveau global ou les niveaux grammaire / écrit / lecture.');
  if (!out.useEvaluatorOral && !(out.skills.listening || out.skills.speaking)) {
    throw new Error('Sans oral évaluateur, le test externe doit fournir au moins un niveau de compréhension ou d’expression orale.');
  }
  /* fill missing written skills from overall so calc5SkillLevel has five values */
  ['grammar', 'writing', 'reading'].forEach(function (k) { if (!out.skills[k] && out.overall) out.skills[k] = out.overall; });
  if (!out.overall) {
    var map = {}; CEFR.forEach(function (l, i) { map[l] = i / 2; });
    var nums = have.map(function (k) { return map[out.skills[k]]; });
    var avg = nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
    out.overall = CEFR[Math.round(avg * 2)] || '';
  }
  return out;
}

/* Applies the external test to the record. Idempotent per call (re-apply overwrites). */
function apply(c, data, opts) {
  opts = opts || {};
  var now = opts.now || new Date().toISOString();
  var ext = normalise(data);
  var prev = c.externalTest || {};
  ext.pdfPath = data && data.pdfPath ? data.pdfPath : (prev.pdfPath || '');
  ext.addedAt = prev.addedAt || now;
  ext.updatedAt = now;
  ext.addedBy = opts.by || prev.addedBy || 'joss';
  c.externalTest = ext;
  var label = ext.provider === 'Autre' && ext.providerOther ? ext.providerOther : ext.provider;

  /* written skills -> reportSummary; protected like hand-entered levels */
  var rs = Object.assign({}, c.reportSummary || {});
  rs.grammarLevel = ext.skills.grammar; rs.writingLevel = ext.skills.writing; rs.readingLevel = ext.skills.reading;
  rs.overallLevel = ext.overall;
  rs.source = 'external_test'; rs.externalProvider = label; rs.externalRef = ext.ref; rs.externalDate = ext.date;
  c.reportSummary = rs;
  c.levelsManuallyEditedAt = now;
  if (ext.date && !c.testdate) c.testdate = ext.date;

  /* oral skills -> oralData unless the evaluator will assess orally */
  if (!ext.useEvaluatorOral) {
    var od = (c.oralData && typeof c.oralData === 'object') ? c.oralData : {};
    if (od.intakeType === 'legal_intake') { /* legacy interview-only shape: leave it to detachIntakeFromOral upstream */ }
    od.listeningLevel = ext.skills.listening || od.listeningLevel || '';
    od.speakingLevel = ext.skills.speaking || od.speakingLevel || '';
    od.evaluator = od.evaluator || ('Test externe ' + label + (ext.ref ? ' n° ' + ext.ref : ''));
    od.sessionDate = od.sessionDate || ext.date || '';
    od.source = 'external_test';
    od.oralObs = od.oralObs || ('Niveaux oraux issus du test externe ' + label + (ext.ref ? ' n° ' + ext.ref : '') + (ext.date ? ' du ' + ext.date : '') + '. Aucun entretien oral Linguaid.');
    c.oralData = od;
    c.oralBookedAt = c.oralBookedAt || now; c.oralBookedBy = c.oralBookedBy || 'external_test'; c.oralBookedWith = c.oralBookedWith || label;
    var order = ['invited', 'csv_uploaded', 'written_report_done', 'oral_done', 'final_report_done', 'programme_done'];
    if (order.indexOf(c.status) < order.indexOf('oral_done')) c.status = 'oral_done';
  } else {
    if (!c.status || c.status === 'invited') c.status = 'csv_uploaded';
  }
  return ext;
}

function hasExternalTest(c) {
  var e = c && c.externalTest;
  return !!(e && (e.overall || (e.skills && (e.skills.grammar || e.skills.reading || e.skills.writing))));
}

function label(c) {
  var e = c.externalTest || {};
  var p = e.provider === 'Autre' && e.providerOther ? e.providerOther : e.provider;
  return [p, e.ref ? 'n° ' + e.ref : '', e.date ? '(' + e.date + ')' : ''].filter(Boolean).join(' ');
}

/* Prompt block for the report generators */
function promptBlock(c) {
  if (!hasExternalTest(c)) return '';
  var e = c.externalTest;
  var v = function (x) { return isBlank(x) ? 'not provided' : String(x); };
  var mods = (e.modules || []).map(function (m) { return '  - ' + m.name + ': ' + (m.level || '?') + (m.score ? ' (' + m.score + ')' : ''); }).join('\n');
  return [
    'EXTERNAL LEVEL TEST (provided by the candidate - a MEASURED result, not a Linguaid test):',
    'Provider: ' + label(c),
    'Context: ' + v(e.context),
    'Overall level: ' + v(e.overall),
    'Grammar: ' + v(e.skills.grammar) + ' | Writing: ' + v(e.skills.writing) + ' | Reading: ' + v(e.skills.reading) + ' | Listening: ' + v(e.skills.listening) + ' | Speaking: ' + v(e.skills.speaking),
    mods ? 'Module detail as printed on the report:\n' + mods : '',
    e.notes ? 'Points noted on the report: ' + e.notes : '',
    'RULES: cite this test by provider and reference. Use its levels as given - never re-grade them, never invent sample errors or quotations; the report gives categories only (e.g. grammar points to improve), so stay at that level of generality. Say plainly that no Linguaid written test was sat.'
  ].filter(Boolean).join('\n');
}

module.exports = { PROVIDERS: PROVIDERS, CEFR: CEFR, normLevel: normLevel, normalise: normalise, apply: apply, hasExternalTest: hasExternalTest, label: label, promptBlock: promptBlock };
