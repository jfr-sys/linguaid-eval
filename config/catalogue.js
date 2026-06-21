'use strict';

// EDOF Catalogue — LinguAid France (SIRET 53968218700015)
// Source of truth for CPF action IDs, hours, prices, and MCF deep links.
// Used by: routes/programme.js, routes/proposition.js, fill_programme_final.py (via JSON payload)
//
// FAILSAFE: Any CPF programme generation must verify cpfType is one of:
//   'E360', 'E360_LEGAL', 'CAJA'
// If cpfType is missing or unrecognised, generation must be blocked.

const BASE_URL = 'https://www.moncompteformation.gouv.fr/espace-prive/html/#/formation/recherche';
const SIRET = '53968218700015';

function mcfLink(offerCode, actionId) {
  return `${BASE_URL}/${SIRET}_${offerCode}/${SIRET}_${actionId}`;
}

// ---------------------------------------------------------------------------
// E360 actions (RS6341) — standard business English
// All share offer code 'E360B2' in the MCF link
// ---------------------------------------------------------------------------
const E360_ACTIONS = [
  {
    id: 'E360B220HAP',
    label: '20h — 15h coaching + 5h TP — 1 600€',
    totalHours: 20,
    coachingHours: 15,
    tpHours: 5,
    price: 1600,
    link: mcfLink('E360B2', 'E360B220HAP'),
  },
  {
    id: 'E360B220H',
    label: '20h — 10h coaching + 10h TP — 1 650€',
    totalHours: 20,
    coachingHours: 10,
    tpHours: 10,
    price: 1650,
    link: mcfLink('E360B2', 'E360B220H'),
  },
  {
    id: 'E360B2',
    label: '25h — 25h coaching + 0h TP — 2 275€',
    totalHours: 25,
    coachingHours: 25,
    tpHours: 0,
    price: 2275,
    link: mcfLink('E360B2', 'E360B2'),
  },
  {
    id: 'E360B1-30H-VISIO',
    label: '30h — 30h coaching + 0h TP — 2 700€',
    totalHours: 30,
    coachingHours: 30,
    tpHours: 0,
    price: 2700,
    link: mcfLink('E360B2', 'E360B1-30H-VISIO'),
  },
  {
    id: 'E360B1-30H',
    label: '30h — 20h coaching + 10h TP — 2 950€',
    totalHours: 30,
    coachingHours: 20,
    tpHours: 10,
    price: 2950,
    link: mcfLink('E360B2', 'E360B1-30H'),
  },
  {
    id: 'E360B2-38H',
    label: '38h — 25h coaching + 13h TP — 2 500€',
    totalHours: 38,
    coachingHours: 25,
    tpHours: 13,
    price: 2500,
    link: mcfLink('E360B2', 'E360B2-38H'),
  },
  {
    id: 'E360B2-40H',
    label: '40h — 20h coaching + 20h TP — 2 350€',
    totalHours: 40,
    coachingHours: 20,
    tpHours: 20,
    price: 2350,
    link: mcfLink('E360B2', 'E360B2-40H'),
  },
  {
    id: 'E360B240H',
    label: '40h — 40h coaching + 0h TP — 3 550€',
    totalHours: 40,
    coachingHours: 40,
    tpHours: 0,
    price: 3550,
    link: mcfLink('E360B2', 'E360B240H'),
  },
  {
    id: 'E360B2-45H',
    label: '45h — 30h coaching + 15h TP — 3 075€',
    totalHours: 45,
    coachingHours: 30,
    tpHours: 15,
    price: 3075,
    link: mcfLink('E360B2', 'E360B2-45H'),
  },
  {
    id: 'E360B2-50H',
    label: '50h — 25h coaching + 25h TP — 2 640€',
    totalHours: 50,
    coachingHours: 25,
    tpHours: 25,
    price: 2640,
    link: mcfLink('E360B2', 'E360B2-50H'),
  },
  {
    id: 'E360B2-60H',
    label: '60h — 40h coaching + 20h TP — 4 050€',
    totalHours: 60,
    coachingHours: 40,
    tpHours: 20,
    price: 4050,
    link: mcfLink('E360B2', 'E360B2-60H'),
  },
];

// ---------------------------------------------------------------------------
// E360_LEGAL — E360 for lawyers (RS6341), locked to single action
// Positions E360 as precursor to CAJA (RS6810)
// ---------------------------------------------------------------------------
const E360_LEGAL_ACTIONS = [
  {
    id: 'E360B220H',
    label: '20h — 10h coaching + 10h TP — 1 650€ (offre avocats)',
    totalHours: 20,
    coachingHours: 10,
    tpHours: 10,
    price: 1650,
    link: mcfLink('E360B2', 'E360B220H'),
  },
];

// ---------------------------------------------------------------------------
// CAJA actions (RS6810) — legal English for lawyers
// TP is always fixed at 10h; coaching = totalHours - 10
// ---------------------------------------------------------------------------
const CAJA_ACTIONS = [
  {
    id: 'CAJA-15H',
    label: '15h — 5h coaching + 10h TP — 1 700€',
    totalHours: 15,
    coachingHours: 5,
    tpHours: 10,
    price: 1700,
    link: mcfLink('CAJA', 'CAJA-15H'),
  },
  {
    id: 'CAJA-20H',
    label: '20h — 10h coaching + 10h TP — 2 150€',
    totalHours: 20,
    coachingHours: 10,
    tpHours: 10,
    price: 2150,
    link: mcfLink('CAJA', 'CAJA-20H'),
  },
  {
    id: 'CAJA-25H',
    label: '25h — 15h coaching + 10h TP — 2 700€',
    totalHours: 25,
    coachingHours: 15,
    tpHours: 10,
    price: 2700,
    link: mcfLink('CAJA', 'CAJA-25H'),
  },
  {
    id: 'CAJA-30H',
    label: '30h — 20h coaching + 10h TP — 3 250€',
    totalHours: 30,
    coachingHours: 20,
    tpHours: 10,
    price: 3250,
    link: mcfLink('CAJA', 'CAJA-30H'),
  },
  {
    id: 'CAJA-38H',
    label: '38h — 28h coaching + 10h TP — 3 940€',
    totalHours: 38,
    coachingHours: 28,
    tpHours: 10,
    price: 3940,
    link: mcfLink('CAJA', 'CAJA-38H'),
  },
  {
    id: 'CAJA-40H',
    label: '40h — 30h coaching + 10h TP — 4 550€',
    totalHours: 40,
    coachingHours: 30,
    tpHours: 10,
    price: 4550,
    link: mcfLink('CAJA', 'CAJA-40H'),
  },
];

// ---------------------------------------------------------------------------
// Master catalogue object keyed by cpfType
// ---------------------------------------------------------------------------
const CATALOGUE = {
  E360:       E360_ACTIONS,
  E360_LEGAL: E360_LEGAL_ACTIONS,
  CAJA:       CAJA_ACTIONS,
};

// Valid cpfTypes — used by failsafe checks throughout the app
const VALID_CPF_TYPES = Object.keys(CATALOGUE);

/**
 * Look up a specific action by cpfType and actionId.
 * Returns the action object or null if not found.
 */
function getAction(cpfType, actionId) {
  const actions = CATALOGUE[cpfType];
  if (!actions) return null;
  return actions.find(a => a.id === actionId) || null;
}

/**
 * Failsafe: throws if cpfType is missing or unrecognised.
 * Call this at the top of any CPF document generation route.
 */
function assertValidCpfType(cpfType) {
  if (!cpfType || !VALID_CPF_TYPES.includes(cpfType)) {
    throw new Error(
      `CPF dossier bloqué : cpfType manquant ou non reconnu (valeur reçue : "${cpfType}"). ` +
      `Valeurs acceptées : ${VALID_CPF_TYPES.join(', ')}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Non-CPF pricing (commercial rates, no EDOF)
// ---------------------------------------------------------------------------
const NON_CPF_RATES = {
  businessCoaching:   90,   // €/h TTC
  businessTP:         30,   // €/h TTC
  legalCoaching:     132,   // €/h TTC
  legalTP:           200,   // flat fee TTC (Yes You Ken English)
};

/**
 * Calculate non-CPF price from hours and type.
 * @param {string} type - 'business' or 'legal'
 * @param {number} coachingHours
 * @param {number} tpHours
 * @returns {number} total price TTC
 */
function calcNonCpfPrice(type, coachingHours, tpHours) {
  if (type === 'legal') {
    return (coachingHours * NON_CPF_RATES.legalCoaching) +
           (tpHours > 0 ? NON_CPF_RATES.legalTP : 0);
  }
  return (coachingHours * NON_CPF_RATES.businessCoaching) +
         (tpHours * NON_CPF_RATES.businessTP);
}

module.exports = {
  CATALOGUE,
  VALID_CPF_TYPES,
  NON_CPF_RATES,
  getAction,
  assertValidCpfType,
  calcNonCpfPrice,
};
