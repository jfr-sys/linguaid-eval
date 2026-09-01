'use strict';
/* coherence-gate library (2026-07-22)
 * Single source of truth for hours/price/date coherence. Called by the
 * proposition, programme and convention generation routes so that no
 * document can ever be produced from internally inconsistent data, and by
 * save routes to derive totalHours from its components.
 */

function normaliseHours(od) {
  od = od || {};
  var total = parseInt(od.totalHours, 10) || 0;
  var ch = parseInt(od.coachingHours, 10);
  var hw = parseInt(od.homeworkHours, 10);
  if (isNaN(ch)) ch = total; // legacy records: coaching defaults to total
  if (isNaN(hw)) hw = 0;
  return { total: total, coaching: ch, homework: hw };
}

/* Recompute totalHours from components after any hours save. Components are
 * the source of truth; a lone totalHours (no components) is kept as an int. */
function deriveTotal(od) {
  od = od || {};
  var ch = parseInt(od.coachingHours, 10);
  var hw = parseInt(od.homeworkHours, 10);
  if (!isNaN(ch)) {
    od.coachingHours = ch;
    if (!isNaN(hw)) od.homeworkHours = hw; else hw = 0;
    od.totalHours = ch + hw;
  } else if (od.totalHours !== undefined && od.totalHours !== null && od.totalHours !== '') {
    od.totalHours = parseInt(od.totalHours, 10) || od.totalHours;
  }
  return od;
}

/* checkCoherence(candidate, opts) -> { ok, errors: [...] }
 * opts.requirePrice: true for money documents (proposition, convention). */
function checkCoherence(c, opts) {
  opts = opts || {};
  var od = (c && c.oralData) || {};
  var cd = (c && c.conventionData) || {};
  var errors = [];
  var h = normaliseHours(od);
  if (!h.total || h.total <= 0) {
    errors.push('Heures totales manquantes ou nulles.');
  } else if (h.total !== h.coaching + h.homework) {
    errors.push('Heures incoh\u00e9rentes : total ' + h.total + 'h \u2260 coaching ' + h.coaching + 'h + travaux ' + h.homework + 'h. Corrigez les heures avant de g\u00e9n\u00e9rer le document.');
  }
  var ds = od.dateStart || cd.dateStart || '';
  var de = od.dateEnd || cd.dateEnd || '';
  if (ds && de && new Date(ds) > new Date(de)) {
    errors.push('Dates incoh\u00e9rentes : d\u00e9but ' + ds + ' post\u00e9rieur \u00e0 la fin ' + de + '.');
  }
  if (opts.requirePrice) {
    var price = parseInt(cd.price || od.edofPrice || od.price || 0, 10) || 0;
    if (price <= 0) {
      errors.push('Prix manquant ou nul \u2014 g\u00e9n\u00e9rez d\u2019abord le programme (qui fixe le prix) ou saisissez le prix.');
    }
  }
  // CPF_GHOST_DATA_CHECK (2026-07-27): the "Formation CPF" toggle only ever
  // sets isCPF - it never clears cpfType/edofActionId/edofPrice or
  // already-saved CPF-referential objectives when switched off. Without
  // this check a candidate can carry isCPF=false alongside leftover CPF
  // data, and the proposition/programme/convention generators each read a
  // different mix of that data - producing documents that silently
  // disagree with each other (e.g. locked CPF objectives but "Aucune
  // certification"). Mirrors the existing isCPF=true+cpfType-missing
  // failsafe for the opposite direction.
  if (!od.isCPF && (od.cpfType || od.edofActionId || od.edofPrice)) {
    errors.push('Formation CPF d\u00e9sactiv\u00e9e mais des donn\u00e9es CPF sont encore enregistr\u00e9es (cpfType/action EDOF/prix). R\u00e9activez le bascule CPF ou effacez ces donn\u00e9es avant de g\u00e9n\u00e9rer un document.');
  }
  return { ok: errors.length === 0, errors: errors };
}

/* PROGRAMME_MATCH_CHECK (2026-07-27): compares the field values actually
 * used at last programme generation (c.programmeSnapshot) against those
 * used at last proposition generation (c.propositionSnapshot). Both
 * snapshots are written verbatim by their respective generation routes -
 * this function only diffs them, it never recomputes anything itself, so
 * it can never silently disagree with what either document actually says.
 *
 * Returns { ok, errors: [...] }. If either snapshot is missing (document
 * never generated), that itself is reported as an error - there is
 * nothing to send yet.
 */
function checkProgrammeMatch(c) {
  var prog = c && c.programmeSnapshot;
  var prop = c && c.propositionSnapshot;
  var errors = [];
  if (!prog) {
    errors.push('Aucun programme n\u2019a encore \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9 pour ce candidat.');
  }
  if (!prop) {
    errors.push('Aucune proposition n\u2019a encore \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e pour ce candidat.');
  }
  if (!prog || !prop) {
    return { ok: false, errors: errors };
  }

  function norm(v) { return (v === undefined || v === null) ? '' : String(v); }
  /* SNAPSHOT_NUMERIC_COMPARE (2026-08-25): hours and price were compared as
     strings, so a side that defaults empty to '0' and a side that defaults it
     to '' reported a mismatch for the same zero. Compare quantities as numbers:
     '', null, undefined, 0 and '0' are one value; 10 and 15 still differ. */
  function normNum(v) {
    if (v === undefined || v === null || String(v).trim() === '') return 0;
    var n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? String(v) : n;
  }
  /* OBJECTIVE_TYPOGRAPHY_NORM (2026-09-01)
     The programme and proposition generators apply different French
     typographic conventions to the same objective text: one writes a no-break
     space before a colon and a curly apostrophe, the other a plain space and a
     straight apostrophe. The wording is identical, only the glyphs differ, and
     regenerating cannot reconcile them because each side reapplies its own
     convention. Fold those glyphs together before comparing.

     This does not weaken the gate: different wording, different order or a
     different number of objectives still block the send. */
  function normText(s) {
    return String((s === undefined || s === null) ? '' : s)
      .replace(/[\u00a0\u202f\u2009]/g, ' ')    /* no-break / narrow spaces */
      .replace(/[\u2018\u2019\u02bc]/g, "'")    /* curly apostrophes */
      .replace(/[\u201c\u201d]/g, '"')           /* curly double quotes */
      .replace(/\s+/g, ' ')
      .trim();
  }
  function normArr(v) {
    return JSON.stringify((Array.isArray(v) ? v : []).map(function (o) {
      return (typeof o === 'string') ? normText(o) : o;
    }));
  }

  var fieldChecks = [
    ['isCPF',         function(s) { return norm(!!s.isCPF); },      'statut CPF'],
    ['cpfType',       function(s) { return norm(s.cpfType); },      'type de certification CPF'],
    ['rsCode',        function(s) { return norm(s.rsCode); },       'code de certification (RS)'],
    /* SNAPSHOT_NUMERIC_COMPARE (2026-08-25) */
    ['totalHours',    function(s) { return normNum(s.totalHours); },   'heures totales'],
    ['coachingHours', function(s) { return normNum(s.coachingHours); },'heures de coaching'],
    ['homeworkHours', function(s) { return normNum(s.homeworkHours); },'heures de travaux en autonomie'],
    ['targetLevel',   function(s) { return norm(s.targetLevel); },  'niveau vis\u00e9'],
  ];
  fieldChecks.forEach(function(fc) {
    var getter = fc[1], label = fc[2];
    if (getter(prog) !== getter(prop)) errors.push(label);
  });
  if (normArr(prog.objectives) !== normArr(prop.objectives)) errors.push('objectifs p\u00e9dagogiques');

  if (errors.length) {
    return {
      ok: false,
      errors: ['La proposition et le programme ne correspondent plus (' + errors.join(', ') + '). R\u00e9g\u00e9n\u00e9rez le programme et/ou la proposition pour qu\u2019ils correspondent avant l\u2019envoi.']
    };
  }
  return { ok: true, errors: [] };
}

/* CONVENTION_MATCH_CHECK (2026-07-27): compares propositionSnapshot (the
 * accepted proposal) against `current` - the values about to fill the
 * convention right now. Convention generation and sending are the same
 * action, so callers gate GENERATION on this. Diffs snapshots only; never
 * recomputes. */
function checkConventionMatch(c, current) {
  var prop = c && c.propositionSnapshot;
  if (!prop) {
    return { ok: false, errors: ['Aucune proposition n\u2019a encore \u00e9t\u00e9 g\u00e9n\u00e9r\u00e9e pour ce candidat \u2014 g\u00e9n\u00e9rez et faites accepter une proposition avant de g\u00e9n\u00e9rer la convention.'] };
  }
  current = current || {};
  function norm(v) { return (v === undefined || v === null) ? '' : String(v); }
  /* SNAPSHOT_NUMERIC_COMPARE (2026-08-25): see checkProgrammeMatch. The
     proposition builds homeworkHours as String(x || '0') and the convention as
     String(x || ''), so every zero-TP dossier - the normal shape of a non-CPF
     company deal - failed this gate for a difference that did not exist. */
  function normNum(v) {
    if (v === undefined || v === null || String(v).trim() === '') return 0;
    var n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? String(v) : n;
  }
  var NUMERIC_FIELDS = { totalHours: 1, coachingHours: 1, homeworkHours: 1, price: 1 };
  var errors = [];
  var checks = [
    ['isCPF', 'statut CPF'], ['cpfType', 'type de certification CPF'],
    ['rsCode', 'code de certification (RS)'], ['totalHours', 'heures totales'],
    ['coachingHours', 'heures de coaching'], ['homeworkHours', 'heures de travaux en autonomie'],
    ['targetLevel', 'niveau vis\u00e9'], ['trainingTitle', 'intitul\u00e9 de la formation'],
    ['dateStart', 'date de d\u00e9but'], ['dateEnd', 'date de fin'], ['price', 'prix'],
  ];
  checks.forEach(function(fc) {
    var cmp = NUMERIC_FIELDS[fc[0]] ? normNum : norm;
    if (cmp(prop[fc[0]]) !== cmp(current[fc[0]])) errors.push(fc[1]);
  });
  if (errors.length) {
    return { ok: false, errors: ['La convention ne correspond plus \u00e0 la proposition accept\u00e9e (' + errors.join(', ') + '). V\u00e9rifiez et, si n\u00e9cessaire, r\u00e9g\u00e9n\u00e9rez la proposition avant de g\u00e9n\u00e9rer la convention.'] };
  }
  return { ok: true, errors: [] };
}

module.exports = { checkCoherence: checkCoherence, deriveTotal: deriveTotal, normaliseHours: normaliseHours, checkProgrammeMatch: checkProgrammeMatch, checkConventionMatch: checkConventionMatch };
