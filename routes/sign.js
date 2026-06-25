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
      from: 'noreply@linguaid.net', to: 'jfr@linguaid.net',
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


module.exports = router;
