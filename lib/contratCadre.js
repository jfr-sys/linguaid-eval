// lib/contratCadre.js — companies with a framework agreement (contrat cadre).
// No candidate at these companies ever receives a proposal or convention to
// sign; documents are generated for internal records only. Sending, signing
// tokens, reminders and progress-bar signing steps are all disabled for them.
// This is company-level and takes priority over CPF status.
// To add a new cadre company: add its name below. Nothing else needs to change.
var CONTRAT_CADRE_COMPANIES = ['B. Braun Medical', 'HEC Paris', 'Groupe Reference'];

function normKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

var CONTRAT_CADRE_KEYS = CONTRAT_CADRE_COMPANIES.map(normKey);

function isContratCadre(companyRaw) {
  return CONTRAT_CADRE_KEYS.indexOf(normKey(companyRaw)) !== -1;
}

module.exports = { isContratCadre, CONTRAT_CADRE_COMPANIES };
