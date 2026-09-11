/* PARCOURS_CAJA_20260911
   Parcours CAJA = Module 1 (E360 parcours juridique, CPF) + Module 2 (CAJA, CPF)
   under ONE global convention, over at most `maxMonths`.

   Funding rule per module (stated by Joss, 11 Sept 2026):
     - the CPF contributes at most `cpfCap` (1 500 EUR) per dossier, and never
       more than what is left in the learner's account;
     - the learner pays the `forfait` (150 EUR participation forfaitaire) plus
       everything above the CPF contribution, by card at the MCF checkout;
     - if the CPF contribution for a module would be zero (nothing left), the
       module is invoiced directly (no forfait) and paid in instalments.

   Everything here is pure computation - no I/O - so it can be unit-tested and
   reused by the intake, the candidate page, the proposition and the
   convention. */

var DEFAULTS = {
  cpfCap: 1500,
  forfait: 150,
  maxMonths: 12,
  directComparator: 2900,   // what the same 20 coaching hours + material would cost bought direct, no certification
  directInstalments: 4,
  modules: [
    { key: 'M1', label: 'Module 1', cpfType: 'E360_LEGAL', title: 'Anglais professionnel \u2013 parcours juridique (English 360)',
      totalHours: 20, coachingHours: 10, homeworkHours: 10, price: 1950 },
    { key: 'M2', label: 'Module 2', cpfType: 'CAJA', title: 'Communiquer en anglais juridique des affaires (CAJA)',
      totalHours: 20, coachingHours: 10, homeworkHours: 10, price: 2150 }
  ]
};

function num(v, d) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(',', '.')); return isFinite(n) ? n : (d == null ? 0 : d); }

/* Build a normalised parcours object from whatever is stored on the candidate
   (may be partial or absent). Never mutates the input. */
function normalise(stored) {
  var s = stored || {};
  var out = {
    enabled: !!s.enabled,
    cpfBalance: (s.cpfBalance === '' || s.cpfBalance == null) ? null : num(s.cpfBalance, 0),
    cpfCap: num(s.cpfCap, DEFAULTS.cpfCap),
    forfait: num(s.forfait, DEFAULTS.forfait),
    maxMonths: parseInt(s.maxMonths, 10) || DEFAULTS.maxMonths,
    directComparator: num(s.directComparator, DEFAULTS.directComparator),
    directInstalments: parseInt(s.directInstalments, 10) || DEFAULTS.directInstalments,
    modules: DEFAULTS.modules.map(function(m, i) {
      var sm = (s.modules && s.modules[i]) || {};
      return {
        key: m.key, label: m.label, cpfType: m.cpfType, title: sm.title || m.title,
        totalHours: parseInt(sm.totalHours, 10) || m.totalHours,
        coachingHours: parseInt(sm.coachingHours, 10) || m.coachingHours,
        homeworkHours: (sm.homeworkHours === 0 || sm.homeworkHours === '0') ? 0 : (parseInt(sm.homeworkHours, 10) || m.homeworkHours),
        price: num(sm.price, m.price),
        dateStart: sm.dateStart || '',
        dateEnd: sm.dateEnd || ''
      };
    }),
    signedAt: s.signedAt || null,
    createdAt: s.createdAt || null,
    updatedAt: s.updatedAt || null
  };
  return out;
}

/* Core calculation. Returns a fresh object; input is not mutated. */
function compute(stored) {
  var p = normalise(stored);
  var balance = p.cpfBalance == null ? null : p.cpfBalance;
  var running = balance == null ? Infinity : balance;   // unknown balance => assume the cap is available
  var totals = { price: 0, cpf: 0, remainder: 0, forfait: 0, learner: 0, coachingHours: 0, totalHours: 0 };
  var modules = p.modules.map(function(m) {
    var cpfPart = Math.max(0, Math.min(m.price, p.cpfCap, running));
    var route = cpfPart > 0 ? 'CPF' : 'DIRECT';
    var remainder = m.price - cpfPart;
    var forfait = route === 'CPF' ? p.forfait : 0;
    var learnerPays = remainder + forfait;
    var balanceBefore = running === Infinity ? null : running;
    running = running === Infinity ? Infinity : running - cpfPart;
    var instalment = route === 'DIRECT' ? Math.round(m.price / p.directInstalments * 100) / 100 : null;
    totals.price += m.price; totals.cpf += cpfPart; totals.remainder += remainder; totals.forfait += forfait; totals.learner += learnerPays;
    totals.coachingHours += m.coachingHours; totals.totalHours += m.totalHours;
    return Object.assign({}, m, {
      route: route, cpfPart: cpfPart, remainder: remainder, forfait: forfait, learnerPays: learnerPays,
      balanceBefore: balanceBefore, balanceAfter: running === Infinity ? null : running,
      instalments: route === 'DIRECT' ? p.directInstalments : 1, instalmentAmount: instalment
    });
  });
  var saving = p.directComparator - totals.learner;
  return {
    enabled: p.enabled, cpfBalance: balance, cpfCap: p.cpfCap, forfait: p.forfait, maxMonths: p.maxMonths,
    balanceKnown: balance != null, balanceEnd: running === Infinity ? null : running,
    modules: modules, totals: totals,
    direct: { comparator: p.directComparator, saving: saving },
    signedAt: p.signedAt, createdAt: p.createdAt, updatedAt: p.updatedAt
  };
}

function fmtEur(n) {
  if (n == null || !isFinite(n)) return '\u2014';
  var s = (Math.round(n * 100) / 100).toFixed(2);
  if (s.slice(-3) === '.00') s = s.slice(0, -3);
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  return parts.join(',') + '\u00a0\u20ac';
}

/* Plain-French lines for documents (proposition / convention / e-mails). */
function describe(calc) {
  var c = calc && calc.modules ? calc : compute(calc);
  var lines = [];
  c.modules.forEach(function(m) {
    var head = m.label + ' \u2013 ' + m.title + ' : ' + m.totalHours + ' h (' + m.coachingHours + ' h de coaching individuel'
      + (m.homeworkHours ? ' + ' + m.homeworkHours + ' h de travail guid\u00e9' : '') + '), ' + fmtEur(m.price) + '.';
    var fund;
    if (m.route === 'CPF') {
      fund = 'Financement : ' + fmtEur(m.cpfPart) + ' pris en charge par le CPF'
        + (m.remainder > 0 ? ', ' + fmtEur(m.remainder) + ' de compl\u00e9ment' : '')
        + ' et ' + fmtEur(m.forfait) + ' de participation forfaitaire obligatoire, soit ' + fmtEur(m.learnerPays) + ' \u00e0 votre charge, r\u00e9gl\u00e9s lors de l\u2019inscription sur Mon Compte Formation.';
    } else {
      fund = 'Financement : r\u00e9glement direct de ' + fmtEur(m.price) + ' en ' + m.instalments + ' \u00e9ch\u00e9ances mensuelles de ' + fmtEur(m.instalmentAmount) + ' (aucune participation forfaitaire).';
    }
    lines.push(head, fund);
  });
  lines.push('Total du parcours : ' + fmtEur(c.totals.price) + ', dont ' + fmtEur(c.totals.cpf) + ' financ\u00e9s par le CPF et ' + fmtEur(c.totals.learner) + ' \u00e0 votre charge sur ' + c.maxMonths + ' mois.');
  if (c.direct.saving > 0) {
    lines.push('\u00c0 titre de comparaison, les m\u00eames ' + c.totals.coachingHours + ' heures de coaching achet\u00e9es directement, hors certification, co\u00fbteraient ' + fmtEur(c.direct.comparator) + ' : le parcours vous fait \u00e9conomiser ' + fmtEur(c.direct.saving) + ' et inclut deux certifications.');
  }
  return lines;
}

module.exports = { DEFAULTS: DEFAULTS, normalise: normalise, compute: compute, describe: describe, fmtEur: fmtEur };
