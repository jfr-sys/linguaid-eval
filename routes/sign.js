// routes/sign.js
// Client-facing convention signing route
// Public: /sign/:token

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const DATA_PATH = path.join(__dirname, '../data/candidates.json');
const CONV_DIR  = path.join(__dirname, '../data/conventions');

function loadCandidates() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function saveCandidates(candidates) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(candidates, null, 2));
}
function findByConventionToken(token) {
  const candidates = loadCandidates();
  return candidates.find(c =>
    c.conventionData && (c.conventionData.token === token || c.conventionData.signingToken === token)
  );
}

// GET /sign/:token — serve signing page
router.get('/:token', (req, res) => {
  const { token } = req.params;
  const candidate = findByConventionToken(token);

  if (!candidate) {
    return res.status(404).send('<h2>Lien invalide ou expiré.</h2>');
  }
  if (candidate.conventionData.signedAt) {
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center">
        <h2>✅ Document déjà signé</h2>
        <p>Cette convention a été signée le ${new Date(candidate.conventionData.signedAt).toLocaleDateString('fr-FR')}.</p>
        <p>Vous pouvez fermer cette fenêtre.</p>
      </body></html>
    `);
  }

  res.sendFile(path.join(__dirname, '../views/sign.html'));
});

// GET /sign/:token/pdf — serve the unsigned PDF for preview
router.get('/:token/pdf', (req, res) => {
  const { token } = req.params;
  const candidate = findByConventionToken(token);
  if (!candidate) return res.status(404).send('Not found');

  const pdfPath = candidate.conventionData.pdfPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return res.status(404).send('PDF not found');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

// GET /sign/:token/info — return candidate name for the signing page
router.get('/:token/info', (req, res) => {
  const { token } = req.params;
  const candidate = findByConventionToken(token);
  if (!candidate) return res.status(404).json({ error: 'Invalid token' });
  if (candidate.conventionData.signedAt) {
    return res.json({ alreadySigned: true });
  }
  res.json({
    candidateName: candidate.name,
    trainingType: candidate.conventionData.trainingType,
    signatoryName: candidate.conventionData.signatory || "",
    signatoryName: candidate.conventionData.signatory || "",
  });
});

// POST /sign/:token/submit — receive signature and finalize
router.post('/:token/submit', express.json({ limit: '5mb' }), (req, res) => {
  const { token } = req.params;
  const { typedName, signatureImg } = req.body;

  if (!typedName || !signatureImg) {
    return res.status(400).json({ error: 'Missing typedName or signatureImg' });
  }

  const candidates = loadCandidates();
  const idx = candidates.findIndex(c =>
    c.conventionData && (c.conventionData.token === token || c.conventionData.signingToken === token)
  );
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });
  if (candidates[idx].conventionData.signedAt) {
    return res.status(409).json({ error: 'Already signed' });
  }

  const pdfPath = candidates[idx].conventionData.pdfPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return res.status(500).json({ error: 'Convention PDF not found on server' });
  }

  const timestamp = new Date().toISOString();
  const signerIp  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const signedPdfPath = pdfPath.replace('.pdf', '_signed.pdf');

  const embedArgs = JSON.stringify({
    pdfPath,
    signatureImg,
    typedName,
    timestamp,
    signerIp,
    outputPath: signedPdfPath,
  });

  execFile('python3', ['/home/debian/embed_signature.py', embedArgs], (err, stdout, stderr) => {
    if (err) {
      console.error('embed_signature error:', stderr, stdout);
      return res.status(500).json({ error: 'Failed to embed signature' });
    }

    let result;
    try { result = JSON.parse(stdout); } catch(e) {
      return res.status(500).json({ error: 'Invalid response from signature script' });
    }
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Update candidate record
    candidates[idx].conventionData.signedAt      = timestamp;
    candidates[idx].conventionData.signerIp       = signerIp;
    candidates[idx].conventionData.typedName      = typedName;
    candidates[idx].conventionData.signedPdfPath  = signedPdfPath;
    saveCandidates(candidates);

    // Notify Joss
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    const candidateName = candidates[idx].name;
    transporter.sendMail({
      from: 'noreply@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: `✅ Convention signée — ${candidateName}`,
      text: `La convention de formation de ${candidateName} a été signée électroniquement.\n\nSignataire : ${typedName}\nDate : ${new Date(timestamp).toLocaleString('fr-FR')}\nIP : ${signerIp}\n\nLe PDF signé est disponible dans l'application.`,
    }).catch(e => console.error('Email notification failed:', e));

    res.json({ success: true });
  });
});

// GET /sign/:token/signed-pdf — serve the signed PDF for download
router.get('/:token/signed-pdf', (req, res) => {
  const { token } = req.params;
  const candidate = findByConventionToken(token);
  if (!candidate) return res.status(404).send('Not found');

  const signedPdfPath = candidate.conventionData.signedPdfPath;
  if (!signedPdfPath || !fs.existsSync(signedPdfPath)) {
    return res.status(404).send('Signed PDF not found');
  }
  const name = (candidate.name || 'convention').replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="convention_signee_${name}.pdf"`);
  res.sendFile(signedPdfPath);
});

// ── Attestation signing routes ────────────────────────────────────────────────
function findByAttestToken(token) {
  var candidates = loadCandidates();
  return candidates.find(function(c) { return c.attestationSignToken === token; });
}

router.get('/attestation/:token', function(req, res) {
  var token = req.params.token;
  var candidate = findByAttestToken(token);
  if (!candidate) return res.status(404).send('<h2>Lien invalide ou expiré.</h2>');
  if (candidate.attestationSignedAt) {
    return res.status(200).send('<html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center"><h2>✅ Document déjà signé</h2><p>Cette attestation a été signée le ' + new Date(candidate.attestationSignedAt).toLocaleDateString('fr-FR') + '.</p><p>Vous pouvez fermer cette fenêtre.</p></body></html>');
  }
  res.sendFile(path.join(__dirname, '../views/sign.html'));
});

router.get('/attestation/:token/pdf', function(req, res) {
  var token = req.params.token;
  var candidate = findByAttestToken(token);
  if (!candidate) return res.status(404).send('Not found');
  var pdfPath = candidate.attestationPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) return res.status(404).send('PDF not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

router.get('/attestation/:token/info', function(req, res) {
  var token = req.params.token;
  var candidate = findByAttestToken(token);
  if (!candidate) return res.status(404).json({ error: 'Invalid token' });
  if (candidate.attestationSignedAt) return res.json({ alreadySigned: true });
  res.json({
    candidateName: candidate.name,
    trainingType: 'Attestation de réalisation – Travaux personnels',
    signatoryName: candidate.name,
    isAttestation: true,
  });
});

router.post('/attestation/:token/submit', express.json({ limit: '5mb' }), function(req, res) {
  var token = req.params.token;
  var candidates = loadCandidates();
  var idx = candidates.findIndex(function(c) { return c.attestationSignToken === token; });
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });
  if (candidates[idx].attestationSignedAt) return res.json({ success: true, alreadySigned: true });

  var signatureImg = req.body.signatureImg || req.body.signature;
  var typedName = req.body.typedName || candidates[idx].name;
  var timestamp = new Date().toISOString();
  var signerIp = req.ip || req.connection.remoteAddress;

  var unsignedPdf = candidates[idx].attestationPath;
  if (unsignedPdf && !unsignedPdf.startsWith('/')) {
    unsignedPdf = require('path').join(__dirname, '..', unsignedPdf);
  }
  var signedPdf = unsignedPdf.replace('_attestation_quiz.pdf', '_attestation_quiz_signe.pdf');

  var embedArgs = JSON.stringify({
    pdfPath: unsignedPdf,
    signatureImg: signatureImg,
    typedName: typedName,
    timestamp: timestamp,
    signerIp: signerIp,
    outputPath: signedPdf,
    isAttestation: true,
  });

  execFile('python3', ['/home/debian/embed_signature.py', embedArgs], function(err, stdout, stderr) {
    if (err) { console.error('embed_signature error:', stderr); return res.status(500).json({ error: 'Failed to embed signature' }); }
    var result;
    try { result = JSON.parse(stdout); } catch(e) { return res.status(500).json({ error: 'Invalid response' }); }
    if (!result.success) return res.status(500).json({ error: result.error });

    candidates[idx].attestationSignedAt = timestamp;
    candidates[idx].attestationSignerIp = signerIp;
    candidates[idx].attestationTypedName = typedName;
    candidates[idx].attestationSignedPdfPath = signedPdf;
    candidates[idx].attestationSigImg = signatureImg;
    saveCandidates(candidates);

    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    transporter.sendMail({
      from: 'noreply@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: '✅ Attestation signée — ' + candidates[idx].name,
      text: 'L\'attestation de ' + candidates[idx].name + ' a été signée électroniquement.\n\nSignataire : ' + typedName + '\nDate : ' + new Date(timestamp).toLocaleString('fr-FR') + '\nIP : ' + signerIp,
      attachments: [{ filename: 'attestation_signee.pdf', path: signedPdf }],
    }).catch(function(e) { console.error('Email notification failed:', e); });

    res.json({ success: true });
  });
});

router.get('/attestation/:token/signed-pdf', function(req, res) {
  var token = req.params.token;
  var candidate = findByAttestToken(token);
  if (!candidate) return res.status(404).send('Not found');
  var signedPdfPath = candidate.attestationSignedPdfPath;
  if (!signedPdfPath || !fs.existsSync(signedPdfPath)) return res.status(404).send('Signed PDF not found');
  var name = (candidate.name || 'attestation').replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="attestation_signee_' + name + '.pdf"');
  res.sendFile(signedPdfPath);
});


// ── Standalone attestation signing ──────────────────────────────────────────
function getStandaloneStore() {
  var p = require('path').join(__dirname, '../data/attestations/standalone_tokens.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return {}; }
}
function saveStandaloneStore(store) {
  var p = require('path').join(__dirname, '../data/attestations/standalone_tokens.json');
  fs.writeFileSync(p, JSON.stringify(store, null, 2));
}

router.get('/standalone/:token', function(req, res) {
  var store = getStandaloneStore();
  var rec = store[req.params.token];
  if (!rec) return res.status(404).send('<h2>Lien invalide ou expiré.</h2>');
  if (rec.signedAt) return res.send('<html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center"><h2>✅ Document déjà signé</h2><p>Cette attestation a été signée le ' + new Date(rec.signedAt).toLocaleDateString("fr-FR") + '.</p></body></html>');
  res.sendFile(require('path').join(__dirname, '../views/sign.html'));
});

router.get('/standalone/:token/pdf', function(req, res) {
  var store = getStandaloneStore();
  var rec = store[req.params.token];
  if (!rec || !fs.existsSync(rec.attestationPath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(rec.attestationPath);
});

router.get('/standalone/:token/info', function(req, res) {
  var store = getStandaloneStore();
  var rec = store[req.params.token];
  if (!rec) return res.status(404).json({ error: 'Invalid token' });
  if (rec.signedAt) return res.json({ alreadySigned: true });
  res.json({ candidateName: rec.name, signatoryName: rec.name, isAttestation: true });
});

router.post('/standalone/:token/submit', express.json({ limit: '5mb' }), function(req, res) {
  var token = req.params.token;
  var store = getStandaloneStore();
  var rec = store[token];
  if (!rec) return res.status(404).json({ error: 'Invalid token' });
  if (rec.signedAt) return res.json({ success: true, alreadySigned: true });

  var signatureImg = req.body.signatureImg || req.body.signature;
  var typedName = req.body.typedName || rec.name;
  var timestamp = new Date().toISOString();
  var signerIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  var unsignedPdf = rec.attestationPath;
  var signedPdf = unsignedPdf.replace('_standalone.pdf', '_standalone_signe.pdf');

  var embedArgs = JSON.stringify({
    pdfPath: unsignedPdf, signatureImg: signatureImg, typedName: typedName,
    timestamp: timestamp, signerIp: signerIp, outputPath: signedPdf, isAttestation: true,
  });

  execFile('python3', ['/home/debian/embed_signature.py', embedArgs], function(err, stdout, stderr) {
    if (err) { console.error('embed_signature error:', stderr); return res.status(500).json({ error: 'Failed to embed signature' }); }
    var result;
    try { result = JSON.parse(stdout); } catch(e) { return res.status(500).json({ error: 'Invalid response' }); }
    if (!result.success) return res.status(500).json({ error: result.error });

    store[token].signedAt = timestamp;
    store[token].signerIp = signerIp;
    store[token].typedName = typedName;
    store[token].signedPdfPath = signedPdf;
    store[token].sigImg = signatureImg;
    saveStandaloneStore(store);

    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    transporter.sendMail({
      from: 'noreply@linguaid.net', to: 'jfr@linguaid.net, rma@linguaid.net',
      subject: '✅ Attestation signée — ' + rec.name,
      text: 'Attestation standalone signée par ' + typedName + '\nDate : ' + new Date(timestamp).toLocaleString('fr-FR') + '\nIP : ' + signerIp,
      attachments: [{ filename: 'attestation_signee_' + rec.name.replace(/\s+/g,'_') + '.pdf', path: signedPdf }],
    }).catch(function(e) { console.error('Email error:', e); });

    res.json({ success: true });
  });
});

router.get('/standalone/:token/signed-pdf', function(req, res) {
  var store = getStandaloneStore();
  var rec = store[req.params.token];
  if (!rec || !rec.signedPdfPath || !fs.existsSync(rec.signedPdfPath)) return res.status(404).send('Not found');
  var name = (rec.name || 'attestation').replace(/\s+/g, '_');
  res.setHeader('Content-Disposition', 'attachment; filename="attestation_signee_' + name + '.pdf"');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(rec.signedPdfPath);
});




// -- Mission confirmation signing routes -------------------------------------
function findByMissionToken(token) {
  var candidates = loadCandidates();
  return candidates.find(function(c) { return c.missionData && c.missionData.confirmationToken === token; });
}

router.get('/mission/:token', function(req, res) {
  var token = req.params.token;
  var candidate = findByMissionToken(token);
  if (!candidate) return res.status(404).send('<h2>Lien invalide ou expiré.</h2>');
  if (candidate.missionData.confirmationSignedAt) {
    return res.status(200).send('<html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center"><h2>Document deja signe</h2><p>Cette confirmation de mission a ete signee le ' + new Date(candidate.missionData.confirmationSignedAt).toLocaleDateString('fr-FR') + '.</p></body></html>');
  }
  res.sendFile(path.join(__dirname, '../views/sign.html'));
});

router.get('/mission/:token/pdf', function(req, res) {
  var candidate = findByMissionToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  var pdfPath = candidate.missionData.confirmationPath;
  if (!pdfPath || !fs.existsSync(pdfPath)) return res.status(404).send('PDF not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

router.get('/mission/:token/info', function(req, res) {
  var candidate = findByMissionToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: 'Invalid token' });
  if (candidate.missionData.confirmationSignedAt) return res.json({ alreadySigned: true });
  res.json({
    candidateName: candidate.name,
    trainingType: 'Confirmation de mission',
    signatoryName: '',
    isMission: true,
    devisUrl: (candidate.missionData.devisPath && fs.existsSync(candidate.missionData.devisPath)) ? ('/sign/mission/' + req.params.token + '/devis-pdf') : null,
  });
});

router.get('/mission/:token/devis-pdf', function(req, res) {
  var candidate = findByMissionToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  var p = candidate.missionData.devisPath;
  if (!p || !fs.existsSync(p)) return res.status(404).send('Devis not available');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="devis.pdf"');
  res.sendFile(p);
});

router.post('/mission/:token/submit', express.json({ limit: '5mb' }), function(req, res) {
  var token = req.params.token;
  var candidates = loadCandidates();
  var idx = candidates.findIndex(function(c) { return c.missionData && c.missionData.confirmationToken === token; });
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });
  if (candidates[idx].missionData.confirmationSignedAt) return res.json({ success: true, alreadySigned: true });

  var signatureImg = req.body.signatureImg || req.body.signature;
  var typedName = req.body.typedName || candidates[idx].name;
  var timestamp = new Date().toISOString();
  var signerIp = req.ip || req.connection.remoteAddress;

  var unsignedPdf = candidates[idx].missionData.confirmationPath;
  var signedPdf = unsignedPdf.replace('.pdf', '_signed.pdf');

  var embedArgs = JSON.stringify({
    pdfPath: unsignedPdf,
    signatureImg: signatureImg,
    typedName: typedName,
    timestamp: timestamp,
    signerIp: signerIp,
    outputPath: signedPdf,
  });

  execFile('python3', ['/home/debian/embed_signature_mission.py', embedArgs], function(err, stdout, stderr) {
    if (err) { console.error('embed_signature_mission error:', stderr); return res.status(500).json({ error: 'Failed to embed signature' }); }
    var result;
    try { result = JSON.parse(stdout); } catch(e) { return res.status(500).json({ error: 'Invalid response' }); }
    if (!result.success) return res.status(500).json({ error: result.error });

    candidates[idx].missionData.confirmationSignedAt = timestamp;
    candidates[idx].missionData.confirmationSignerIp = signerIp;
    candidates[idx].missionData.confirmationTypedName = typedName;
    candidates[idx].missionData.confirmationSignedPdfPath = signedPdf;
    saveCandidates(candidates);

    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ host: 'localhost', port: 25, secure: false, tls: { rejectUnauthorized: false } });
    transporter.sendMail({
      from: 'noreply@linguaid.net',
      to: 'jfr@linguaid.net',
      subject: 'Confirmation de mission signee - ' + candidates[idx].name,
      text: 'La confirmation de mission de ' + candidates[idx].name + ' a ete signee par ' + typedName + ' le ' + new Date(timestamp).toLocaleString('fr-FR') + '.',
      attachments: [{ filename: 'confirmation_signee.pdf', path: signedPdf }],
    }).catch(function(e) { console.error('Email notification failed:', e); });

    res.json({ success: true });
  });
});

router.get('/mission/:token/signed-pdf', function(req, res) {
  var candidate = findByMissionToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  var signedPdfPath = candidate.missionData.confirmationSignedPdfPath;
  if (!signedPdfPath || !fs.existsSync(signedPdfPath)) return res.status(404).send('Signed PDF not found');
  var name = (candidate.name || 'mission').replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="confirmation_mission_signee_' + name + '.pdf"');
  res.sendFile(signedPdfPath);
});



// -- Devis bon-pour-accord signing (Linguaid side) ---------------------------
function findByDevisSignToken(token) {
  var candidates = loadCandidates();
  return candidates.find(function(c) { return c.missionData && c.missionData.devisSignToken === token; });
}

router.get('/devis/:token', function(req, res) {
  var candidate = findByDevisSignToken(req.params.token);
  if (!candidate) return res.status(404).send('<h2>Lien invalide ou expir\u00e9.</h2>');
  if (candidate.missionData.devisSignedAt) {
    var next = candidate.missionData.confirmationToken ? ('<p><a href="/sign/mission/' + candidate.missionData.confirmationToken + '">Continuer vers la confirmation de mission</a></p>') : '';
    return res.status(200).send('<html><body style="font-family:sans-serif;max-width:600px;margin:60px auto;text-align:center"><h2>Bon pour accord d\u00e9j\u00e0 sign\u00e9</h2><p>Ce devis a \u00e9t\u00e9 accept\u00e9 le ' + new Date(candidate.missionData.devisSignedAt).toLocaleDateString('fr-FR') + '.</p>' + next + '</body></html>');
  }
  res.sendFile(path.join(__dirname, '../views/sign.html'));
});

router.get('/devis/:token/pdf', function(req, res) {
  var candidate = findByDevisSignToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  var p = candidate.missionData.devisPath;
  if (!p || !fs.existsSync(p)) return res.status(404).send('PDF not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(p);
});

router.get('/devis/:token/info', function(req, res) {
  var candidate = findByDevisSignToken(req.params.token);
  if (!candidate) return res.status(404).json({ error: 'Invalid token' });
  if (candidate.missionData.devisSignedAt) return res.json({ alreadySigned: true });
  res.json({
    candidateName: candidate.name,
    trainingType: 'Bon pour accord \u2014 devis formateur',
    signatoryName: 'Linguaid France SAS',
    isDevisAccept: true,
  });
});

router.post('/devis/:token/submit', express.json({ limit: '5mb' }), function(req, res) {
  var token = req.params.token;
  var candidates = loadCandidates();
  var idx = candidates.findIndex(function(c) { return c.missionData && c.missionData.devisSignToken === token; });
  if (idx === -1) return res.status(404).json({ error: 'Invalid token' });
  var md0 = candidates[idx].missionData;
  if (md0.devisSignedAt) return res.json({ success: true, alreadySigned: true, trainerSigningUrl: md0.confirmationToken ? ('https://eval.linguaid.net/sign/mission/' + md0.confirmationToken) : null });

  var typedName = 'Linguaid France SAS';
  var timestamp = new Date().toISOString();
  var signerIp = req.ip || req.connection.remoteAddress;
  var unsignedPdf = md0.devisPath;
  var signedPdf = unsignedPdf.replace('.pdf', '_bpa.pdf');

  var embedArgs = JSON.stringify({
    pdfPath: unsignedPdf, useCachet: true,
    timestamp: timestamp, signerIp: signerIp, outputPath: signedPdf,
  });

  execFile('python3', ['/home/debian/embed_signature_devis.py', embedArgs], function(err, stdout, stderr) {
    if (err) { console.error('embed_signature_devis error:', stderr); return res.status(500).json({ error: 'Failed to embed signature' }); }
    var result;
    try { result = JSON.parse(stdout); } catch(e) { return res.status(500).json({ error: 'Invalid response' }); }
    if (!result.success) return res.status(500).json({ error: result.error });

    var cands2 = loadCandidates();
    var i2 = cands2.findIndex(function(c) { return c.missionData && c.missionData.devisSignToken === token; });
    if (i2 === -1) return res.status(404).json({ error: 'Candidate vanished' });
    var c2 = cands2[i2];
    var md = c2.missionData;
    md.devisSignedAt = timestamp;
    md.devisSignedPdfPath = signedPdf;
    md.devisLinguaidTypedName = typedName;
    md.devisLinguaidSignerIp = signerIp;

    // Generate the confirmation de mission now that the devis is accepted
    var trainerContracts2 = require('../lib/trainerContracts');
    var contract = trainerContracts2.getTrainerContract(md.trainerKey);
    if (!contract) { saveCandidates(cands2); return res.status(500).json({ error: 'Formateur non configure' }); }
    var od = c2.oralData || {};
    var crypto2 = require('crypto');
    var confirmationToken = crypto2.randomBytes(16).toString('hex');
    var today = new Date().toLocaleDateString('fr-FR');
    var args2 = {
      trainerName: contract.businessName,
      trainerStatus: contract.status,
      trainerSiret: contract.siret,
      trainerAddress: contract.address,
      candidateName: c2.name || '',
      coachingHours: (od.coachingHours || od.totalHours || 0) + '.00',
      homeworkHours: (od.homeworkHours || 0) + '.00',
      format: 'A distance (visioconference et travail asynchrone)',
      missionDates: od.dateStart ? ('a compter du ' + od.dateStart) : '',
      devisDate: md.devisUploadedAt ? new Date(md.devisUploadedAt).toLocaleDateString('fr-FR') : today,
      devisTotal: md.devisTotal,
      signCity: 'Saint-Cyprien',
      today: today,
      contractDate: contract.contractDate,
      avenantDate: contract.avenantDate,
      outDir: path.join(__dirname, '../data/missions'),
      id: c2.id,
    };
    execFile('python3', ['/home/debian/fill_confirmation_mission.py', JSON.stringify(args2)], { timeout: 60000 }, function(err2, stdout2, stderr2) {
      if (err2) { console.error('fill_confirmation_mission error:', stderr2, stdout2); saveCandidates(cands2); return res.status(500).json({ error: 'Devis signe mais generation de la confirmation a echoue' }); }
      var r2;
      try { r2 = JSON.parse(stdout2.trim()); } catch(e) { saveCandidates(cands2); return res.status(500).json({ error: 'Invalid output' }); }
      if (!r2.success) { saveCandidates(cands2); return res.status(500).json({ error: r2.error }); }
      md.acceptedAt = timestamp;
      md.confirmationPath = r2.pdfPath;
      md.confirmationToken = confirmationToken;
      saveCandidates(cands2);
      res.json({ success: true, trainerSigningUrl: 'https://eval.linguaid.net/sign/mission/' + confirmationToken });
    });
  });
});

router.get('/devis/:token/signed-pdf', function(req, res) {
  var candidate = findByDevisSignToken(req.params.token);
  if (!candidate) return res.status(404).send('Not found');
  var p = candidate.missionData.devisSignedPdfPath;
  if (!p || !fs.existsSync(p)) return res.status(404).send('Signed PDF not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="devis_bon_pour_accord.pdf"');
  res.sendFile(p);
});

module.exports = router;
