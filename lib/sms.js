/* OVH_SMS_20260917
   Single outbound SMS helper backed by the OVHcloud SMS API (eu.api.ovh.com).
   No npm dependency: requests are signed by hand per the OVH API spec
   ($1$ + sha1(AS+CK+METHOD+URL+BODY+TIMESTAMP)).

   .env keys (all required for sending; absent => isConfigured() false):
     OVH_APP_KEY          application key
     OVH_APP_SECRET       application secret
     OVH_CONSUMER_KEY     consumer key (rights: GET /sms/*, POST /sms/*\/jobs)
     OVH_SMS_SERVICE      SMS service name, e.g. sms-ab12345-1
     OVH_SMS_SENDER       validated alphanumeric sender, default LINGUAID
     OVH_API_ENDPOINT     default https://eu.api.ovh.com/1.0

   Public API:
     isConfigured()                  -> boolean
     normalisePhone(raw, defaultCc)  -> E.164 string or ''
     sendSms({ to, message, tag })   -> Promise<{ ok, ids, credits, invalid }>
*/

var https = require('https');
var crypto = require('crypto');

var ENDPOINT = process.env.OVH_API_ENDPOINT || 'https://eu.api.ovh.com/1.0';
var timeDelta = null; // server-time delta cached after first /auth/time call

function cfg() {
  return {
    ak: process.env.OVH_APP_KEY || '',
    as: process.env.OVH_APP_SECRET || '',
    ck: process.env.OVH_CONSUMER_KEY || '',
    service: process.env.OVH_SMS_SERVICE || '',
    sender: process.env.OVH_SMS_SENDER || 'LINGUAID'
  };
}

function isConfigured() {
  var c = cfg();
  return !!(c.ak && c.as && c.ck && c.service);
}

/* "06 12 34 56 78" -> +33612345678 ; "0039 320 7958909" -> +39320...
   "+33 6..." -> +336... ; "0033..." -> +33... ; anything unparseable -> '' */
function normalisePhone(raw, defaultCc) {
  var cc = defaultCc || '33';
  var s = String(raw || '').replace(/[\s.\-()\/]/g, '');
  if (!s) return '';
  if (s.indexOf('+') === 0) s = s.slice(1);
  else if (s.indexOf('00') === 0) s = s.slice(2);
  else if (s.indexOf('0') === 0 && s.length === 10) s = cc + s.slice(1);
  if (!/^[1-9][0-9]{7,14}$/.test(s)) return '';
  return '+' + s;
}

function rawRequest(method, urlPath, body) {
  return new Promise(function(resolve, reject) {
    var url = new URL(ENDPOINT + urlPath);
    var data = body ? JSON.stringify(body) : '';
    var opts = {
      method: method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(d) { chunks.push(d); });
      res.on('end', function() {
        var txt = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = txt ? JSON.parse(txt) : null; } catch (e) { parsed = txt; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function() { req.destroy(new Error('OVH API timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

function signedRequest(method, urlPath, body) {
  var c = cfg();
  if (!isConfigured()) return Promise.reject(new Error('SMS non configur\u00e9 (variables OVH_* absentes du .env)'));
  var pre = timeDelta === null
    ? rawRequest('GET', '/auth/time').then(function(r) {
        var t = parseInt(r.body, 10);
        timeDelta = isNaN(t) ? 0 : t - Math.floor(Date.now() / 1000);
      })
    : Promise.resolve();
  return pre.then(function() {
    var ts = String(Math.floor(Date.now() / 1000) + timeDelta);
    var data = body ? JSON.stringify(body) : '';
    var fullUrl = ENDPOINT + urlPath;
    var toSign = [c.as, c.ck, method, fullUrl, data, ts].join('+');
    var sig = '$1$' + crypto.createHash('sha1').update(toSign).digest('hex');
    return new Promise(function(resolve, reject) {
      var url = new URL(fullUrl);
      var opts = {
        method: method,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'X-Ovh-Application': c.ak,
          'X-Ovh-Consumer': c.ck,
          'X-Ovh-Timestamp': ts,
          'X-Ovh-Signature': sig
        }
      };
      var req = https.request(opts, function(res) {
        var chunks = [];
        res.on('data', function(d) { chunks.push(d); });
        res.on('end', function() {
          var txt = Buffer.concat(chunks).toString('utf8');
          var parsed = null;
          try { parsed = txt ? JSON.parse(txt) : null; } catch (e) { parsed = txt; }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
          var msg = (parsed && parsed.message) ? parsed.message : ('HTTP ' + res.statusCode);
          reject(new Error('OVH SMS: ' + msg));
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, function() { req.destroy(new Error('OVH API timeout')); });
      if (data) req.write(data);
      req.end();
    });
  });
}

/* GSM 03.38 basic set (with the French letters it covers); anything outside
   forces 8bit/UCS-2 coding, which halves the per-segment length. */
var GSM7 = /^[A-Za-z0-9 @\u00a3$\u00a5\u00e8\u00e9\u00f9\u00ec\u00f2\u00c7\n\u00d8\u00f8\r\u00c5\u00e5\u0394_\u03a6\u0393\u039b\u03a9\u03a0\u03a8\u03a3\u0398\u039e\u00c6\u00e6\u00df\u00c9!"#\u00a4%&'()*+,\-.\/:;<=>?\u00a1\u00c4\u00d6\u00d1\u00dc\u00a7\u00bf\u00e4\u00f6\u00f1\u00fc\u00e0^{}\\\[~\]|\u20ac]*$/;

function sendSms(opts) {
  opts = opts || {};
  var c = cfg();
  var to = normalisePhone(opts.to);
  var message = String(opts.message || '').trim();
  if (!to) return Promise.reject(new Error('Num\u00e9ro de t\u00e9l\u00e9phone invalide: ' + (opts.to || '(vide)')));
  if (!message) return Promise.reject(new Error('Message SMS vide'));
  var body = {
    message: message,
    receivers: [to],
    sender: c.sender,
    noStopClause: true,           // transactional: no STOP footer
    coding: GSM7.test(message) ? '7bit' : '8bit',
    charset: 'UTF-8',
    class: 'phone',
    priority: 'high',
    validityPeriod: 2880
  };
  if (opts.tag) body.tag = String(opts.tag).slice(0, 20);
  return signedRequest('POST', '/sms/' + encodeURIComponent(c.service) + '/jobs', body)
    .then(function(r) {
      r = r || {};
      var invalid = r.invalidReceivers || [];
      if (invalid.length) throw new Error('OVH SMS: destinataire refus\u00e9 ' + invalid.join(', '));
      return { ok: true, to: to, ids: r.ids || [], credits: r.totalCreditsRemoved || 0, invalid: invalid };
    });
}

/* Remaining credits, for a quick health check (GET /sms/{service}). */
function getCredits() {
  var c = cfg();
  return signedRequest('GET', '/sms/' + encodeURIComponent(c.service)).then(function(r) {
    return (r && typeof r.creditsLeft !== 'undefined') ? r.creditsLeft : null;
  });
}

module.exports = { isConfigured: isConfigured, normalisePhone: normalisePhone, sendSms: sendSms, getCredits: getCredits };
