// lib/trainerContracts.js
// Per-trainer business + contract identity for the mission pipeline.
// A trainer entry is `null` until their info is on file - the brief
// generation refuses to proceed for an unconfigured trainer.
// tel/declarationNumber/tvaNumber are optional (empty -> line dropped).
// tva: true  -> devis renders HT amounts + TVA 20% + total TTC and carries
//               the TVA number; the "TVA non applicable art. 293 B" mention
//               is replaced (would be false for a TVA-registered trainer).
// tva: false -> franchise en base: amounts TTC + article 293 B mention.

// TESTING PHASE TOGGLE: while false, no email is CC'd or sent to any
// trainer by the platform (currently gates the convocation CC). Flip to
// true + pm2 restart to restore trainer emails.
const TRAINER_EMAILS_ENABLED = false;

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
    tva: false,
  },
  hannah: {
    businessName: "Hannah Durrant",
    status: "profession libérale",
    siret: "793 395 518 00012",
    tel: "",
    address: "Cercles, 24320 La Tour Blanche-Cercles",
    declarationNumber: "",
    place: "La Tour Blanche-Cercles",
    contractDate: "13 avril 2021",
    avenantDate: "15 mars 2024",
    tva: false,
  },
  leone: {
    businessName: "Leone Crinnion EI",
    status: "entrepreneur individuel",
    siret: "845 032 374 00025",
    tel: "",
    address: "11 Avenue Armand Lanoux, Apt 35 Port D'Attache, 66750 Saint-Cyprien",
    declarationNumber: "",
    place: "Saint-Cyprien",
    contractDate: "15 avril 2021",
    avenantDate: "18 mars 2024",
    tva: false,
  },
  stephanie: {
    businessName: "Stéphanie Cooper-Slockyj",
    status: "profession libérale",
    siret: "439 074 758 00020",
    tel: "",
    address: "22 rue Saint Anselme, 27800 Le Bec Hellouin",
    declarationNumber: "",
    place: "Le Bec Hellouin",
    contractDate: "31 mars 2021",
    avenantDate: "15 mars 2024",
    tva: true,
    tvaNumber: "FR 79439074758",
  },
  lynsey: {
    businessName: "Lynsey Redfern",
    status: "profession libérale",
    siret: "751 335 381 00032",
    tel: "",
    address: "Le Manet C, 43 chemin du Lautin, 06800 Cagnes-sur-Mer",
    declarationNumber: "",
    place: "Cagnes-sur-Mer",
    contractDate: "31 mars 2021",
    avenantDate: "15 mars 2024",
    tva: true,
    tvaNumber: "FR 83751335381",
  },
  louiseg: {
    businessName: "Louise Garavaglia",
    status: "profession libérale",
    siret: "401 394 184 00048",
    tel: "",
    address: "7 Route de la Corniche, 29630 Plougasnou",
    declarationNumber: "",
    place: "Plougasnou",
    contractDate: "2 janvier 2024",
    avenantDate: "18 mars 2024",
    tva: false,
  },
  natasha: null,
  louisek: null,
};

function isConfigured(trainerKey) {
  return !!TRAINER_CONTRACTS[trainerKey];
}

function getTrainerContract(trainerKey) {
  return TRAINER_CONTRACTS[trainerKey] || null;
}

module.exports = { TRAINER_CONTRACTS, isConfigured, getTrainerContract, TRAINER_EMAILS_ENABLED };
