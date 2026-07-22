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
  return { ok: errors.length === 0, errors: errors };
}

module.exports = { checkCoherence: checkCoherence, deriveTotal: deriveTotal, normaliseHours: normaliseHours };
