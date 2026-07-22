// lib/trainerContracts.js
// Per-trainer business + contract identity for the mission pipeline
// (demande de mission / devis / confirmation de mission).
// A trainer entry is `null` until their SIRET/contract/avenant info is on
// file - generateMissionBrief() refuses to proceed for an unconfigured
// trainer rather than silently falling through.

const TRAINER_CONTRACTS = {
  anna: {
    businessName: "Anna Malzy Training",
    status: "micro-entrepreneur",
    siret: "848 406 260 00028",
    tel: "+33 (0)7 70 00 02 06",
    address: "Anna Malzy Training, 13 Avenue de Maignon, 64600 Anglet",
    declarationNumber: "75640581264",
    place: "Anglet",
    contractDate: "1er mars 2023",
    avenantDate: "15 mars 2024",
  },
  hannah: null,
  leone: null,
  stephanie: null,
  natasha: null,
  louisek: null,
  louiseg: null,
  lynsey: null,
};

function isConfigured(trainerKey) {
  return !!TRAINER_CONTRACTS[trainerKey];
}

function getTrainerContract(trainerKey) {
  return TRAINER_CONTRACTS[trainerKey] || null;
}

module.exports = { TRAINER_CONTRACTS, isConfigured, getTrainerContract };
