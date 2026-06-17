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
    c.conventionData && c.conventionData.token === token
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

module.exports = router;
