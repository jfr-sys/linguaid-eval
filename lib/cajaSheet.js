// lib/cajaSheet.js — CAJA_SHEET (2026-09-10)
//
// Pushes one row per CAJA convocation to the "Convocations" tab of the
// "Suivi CAJA" Google Sheet, by POSTing JSON to the sheet's own Apps Script
// web app (which upserts by candidate_id). Chosen over the Sheets API so the
// platform needs no new Google OAuth scope.
//
// Fire-and-forget: never throws, never blocks or delays the convocation.
// Nothing in this module sends email.
//
// .env:
//   CAJA_SHEET_ENABLED=true
//   CAJA_SHEET_WEBAPP_URL=https://script.google.com/macros/s/.../exec
//   CAJA_SHEET_SECRET=<same value as the WEBHOOK_SECRET script property>

var https = require('https');
var url = require('url');

function parisIso(iso) {
  // "2026-09-10T10:12:33.000Z" -> "2026-09-10 12:12" (Europe/Paris)
  if (!iso) return '';
  try {
    var d = new Date(iso);
    var p = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).reduce(function(a, x){ a[x.type] = x.value; return a; }, {});
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  } catch (e) { return String(iso); }
}

function isCAJA(c) {
  return !!(c && c.oralData && c.oralData.cpfType === 'CAJA');
}

function buildRow(c, trainerKey, sentAt) {
  var cd = c.conventionData || {};
  var od = c.oralData || {};
  var parts = String(c.name || '').trim().split(/\s+/);
  var lastName = parts.length ? parts[parts.length - 1] : '';
  var firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  var company = c.company || '';
  try { company = require('./companies').canonicalCompany(company) || company; } catch (e) {}
  var funding = cd.isCPF ? 'CPF' : (cd.isThirdParty === true ? 'HR-financed' : 'learner-financed');
  var price = (cd.price != null && cd.price !== '') ? cd.price : (od.edofPrice != null ? od.edofPrice : '');
  return {
    candidate_id: c.id,
    convocation_sent_at: parisIso(sentAt || cd.convocationSentAt || ''),
    first_name: firstName,
    last_name: lastName,
    email: c.email || '',
    phone: c.phone || cd.learnerTel || '',
    company: company,
    job_title: c.jobtitle || '',
    edof_action: od.edofActionId || '',
    hours: od.totalHours || '',
    price_eur: price,
    trainer: trainerKey || cd.convocTrainer || '',
    training_start: cd.dateStart || od.dateStart || '',
    training_end: cd.dateEnd || od.dateEnd || '',
    cpf: cd.isCPF ? 'TRUE' : 'FALSE',
    funding: funding
  };
}

// Returns a Promise<boolean>; resolves false (never rejects) on any failure.
function pushConvocation(c, trainerKey, sentAt) {
  return new Promise(function(resolve) {
    try {
      if (String(process.env.CAJA_SHEET_ENABLED || '').toLowerCase() !== 'true') return resolve(false);
      var endpoint = process.env.CAJA_SHEET_WEBAPP_URL || '';
      var secret = process.env.CAJA_SHEET_SECRET || '';
      if (!endpoint || !secret) { console.error('CAJA sheet: CAJA_SHEET_WEBAPP_URL / CAJA_SHEET_SECRET missing'); return resolve(false); }
      if (!isCAJA(c)) return resolve(false);

      var payload = JSON.stringify({ secret: secret, row: buildRow(c, trainerKey, sentAt) });
      var u = url.parse(endpoint);
      var req = https.request({
        hostname: u.hostname, path: u.path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 15000
      }, function(res) {
        // Apps Script answers 200, or 302 (redirect to the response body) once the POST is processed.
        var ok = res.statusCode === 200 || res.statusCode === 302;
        res.resume();
        console.log('CAJA sheet: row ' + (ok ? 'sent' : 'FAILED ' + res.statusCode) + ' for ' + (c.name || c.id));
        resolve(ok);
      });
      req.on('timeout', function(){ req.destroy(new Error('timeout')); });
      req.on('error', function(err){ console.error('CAJA sheet push error:', err.message); resolve(false); });
      req.write(payload);
      req.end();
    } catch (err) {
      console.error('CAJA sheet push error:', err && err.message);
      resolve(false);
    }
  });
}

module.exports = { pushConvocation: pushConvocation, buildRow: buildRow, isCAJA: isCAJA };
