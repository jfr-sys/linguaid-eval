/* NEEDS_ANALYSIS_20260925
   Joss's legal-English positioning interview is a NEEDS ANALYSIS, not the
   evaluator's oral. It lives in c.needsAnalysis and never shares a field with
   c.oralData (Hannah/Anna's level assessment).

   Two pathways decided at the end of the interview (needsAnalysis.nextStep):
     - 'report_only'  : no test. Legacy shape is kept for compatibility
                        (oralData carries the intake + intakeType:'legal_intake',
                        status 'oral_done') so generateLegalIntakeReport and the
                        programme routes keep working unchanged.
     - 'written_test' : the in-house written test (Typeform XBcM6I1W) is sent,
                        then the evaluator oral via Calendly. oralData stays
                        untouched; status stays at csv_uploaded until the test
                        arrives. Final report = standard combined report with a
                        "Professional Context & Needs" section from the interview.

   detachIntakeFromOral() converts a legacy report_only record into the
   written_test shape WITHOUT LOSING A SINGLE INTERVIEW FIELD - used both by
   POST /api/send-written-test/:id and by the one-off migration. */

var INTAKE_KEYS = ['interviewDate','lawyerType','usagePct','otherLangs','legalDomains',
  'dominantSkills','blockers','approxLevel','priorityGaps','notes','recommendedProgramme',
  'targetLevel','totalHours','dateStart','financing'];

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/* Field-by-field merge with blank guard: an empty incoming value never
   overwrites a populated one. Returns the merged object (new). */
function mergeNeeds(existing, incoming) {
  var base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? JSON.parse(JSON.stringify(existing)) : {};
  var body = (incoming && typeof incoming === 'object') ? incoming : {};
  Object.keys(body).forEach(function (k) {
    if (isBlank(body[k])) return;
    base[k] = body[k];
  });
  if (base.totalHours !== undefined && base.totalHours !== null && base.totalHours !== '') {
    var n = parseInt(base.totalHours, 10);
    if (!isNaN(n)) base.totalHours = n;
  }
  return base;
}

/* True when oralData holds ONLY Joss's intake (legacy shape) and no evaluator
   assessment has been layered on top. */
function oralIsLegacyIntakeOnly(c) {
  var od = (c && c.oralData) || null;
  if (!od || od.intakeType !== 'legal_intake') return false;
  if (!isBlank(od.listeningLevel) || !isBlank(od.speakingLevel)) return false;
  if (od.criteria && Object.keys(od.criteria).length) return false;
  return true;
}

/* Move the interview out of oralData into needsAnalysis. Verbatim copy, then
   assert, then clear. Returns {changed, preserved:[keys], error}. Never throws
   away data: on any mismatch nothing is modified. */
function detachIntakeFromOral(c, opts) {
  opts = opts || {};
  if (!oralIsLegacyIntakeOnly(c)) return { changed: false, preserved: [], reason: 'not legacy intake shape' };
  var od = c.oralData;
  var snapshot = JSON.parse(JSON.stringify(od));
  var copy = {};
  Object.keys(snapshot).forEach(function (k) { if (k !== 'intakeType') copy[k] = snapshot[k]; });
  var merged = mergeNeeds(c.needsAnalysis, copy);
  /* assert: every non-blank interview value is present and identical */
  var missing = [];
  Object.keys(copy).forEach(function (k) {
    if (isBlank(copy[k])) return;
    var a = JSON.stringify(merged[k]), b = JSON.stringify(copy[k]);
    if (a !== b) {
      /* totalHours may have been normalised "20" -> 20 */
      if (k === 'totalHours' && String(merged[k]) === String(copy[k])) return;
      missing.push(k);
    }
  });
  if (missing.length) return { changed: false, preserved: [], error: 'assert failed for ' + missing.join(', ') };
  merged.nextStep = 'written_test';
  merged.submittedAt = merged.submittedAt || snapshot.submittedAt || (snapshot.interviewDate ? snapshot.interviewDate + 'T00:00:00.000Z' : new Date().toISOString());
  merged.detachedFromOralAt = new Date().toISOString();
  merged.legacyOralData = snapshot; /* belt and braces: the original object, untouched */
  c.needsAnalysis = merged;
  c.oralData = null;
  if (c.status === 'oral_done') c.status = (c.writtenReport ? 'written_report_done' : 'csv_uploaded');
  return { changed: true, preserved: Object.keys(copy) };
}

function hasNeedsAnalysis(c) {
  var na = c && c.needsAnalysis;
  return !!(na && typeof na === 'object' && Object.keys(na).some(function (k) { return INTAKE_KEYS.indexOf(k) !== -1 && !isBlank(na[k]); }));
}

/* Read the interview wherever it lives (new field first, legacy oralData second). */
function getInterview(c) {
  if (hasNeedsAnalysis(c)) return c.needsAnalysis;
  var od = (c && c.oralData) || null;
  if (od && od.intakeType === 'legal_intake') return od;
  return null;
}

/* Prompt block for the report generators. Empty string when no interview. */
function promptBlock(c) {
  var na = getInterview(c);
  if (!na) return '';
  var v = function (x) { return isBlank(x) ? 'not specified' : String(x); };
  return [
    'NEEDS-ANALYSIS INTERVIEW (conducted by Joss Frimond, Linguaid France, on ' + v(na.interviewDate) + ' - REPORTED information, not a test):',
    'Profile: ' + v(na.lawyerType),
    'Weekly English usage: ' + v(na.usagePct),
    'Other languages: ' + v(na.otherLangs),
    'Legal domains: ' + v(na.legalDomains),
    'Dominant skills required: ' + v(na.dominantSkills),
    'Main blockers (as described by the candidate): ' + v(na.blockers),
    'Interviewer level estimate from conversation (NOT a measured result - the test and oral below are the measurements): ' + v(na.approxLevel),
    'Priority gaps ticked by the interviewer (use these categories as written, do not decompose into invented specifics): ' + v(na.priorityGaps),
    'Interviewer notes: ' + v(na.notes),
    'Interviewer recommendation: programme ' + v(na.recommendedProgramme) + ', target ' + v(na.targetLevel) + ', ' + v(na.totalHours) + ' h, start ' + v(na.dateStart) + ', financing ' + v(na.financing)
  ].join('\n');
}

module.exports = {
  INTAKE_KEYS: INTAKE_KEYS,
  isBlank: isBlank,
  mergeNeeds: mergeNeeds,
  oralIsLegacyIntakeOnly: oralIsLegacyIntakeOnly,
  detachIntakeFromOral: detachIntakeFromOral,
  hasNeedsAnalysis: hasNeedsAnalysis,
  getInterview: getInterview,
  promptBlock: promptBlock
};
