/* MAILER_ENV_TRANSPORT (2026-08-31)
   Single source of truth for outbound SMTP settings.

   Reads configuration from .env. With no SMTP_* variables set, this returns
   exactly the options that were previously hard-coded at 23 call sites:
   unauthenticated localhost:25. Setting SMTP_USER and SMTP_PASS switches the
   whole application to authenticated submission, which lets Plesk DKIM-sign
   outbound mail.

   .env keys:
     SMTP_HOST         default 'localhost'
     SMTP_PORT         default 25        (use 587 for authenticated submission)
     SMTP_USER         mailbox address, e.g. eval@linguaid.net
     SMTP_PASS         mailbox password
     SMTP_SECURE       'true' for implicit TLS (port 465 only); default false
     SMTP_REQUIRE_TLS  'false' to disable STARTTLS enforcement; default enforced

   dotenv is loaded by server.js before any route module is required, so
   process.env is already populated by the time this runs.
*/

function transportOptions() {
  var host = process.env.SMTP_HOST || 'localhost';
  var port = parseInt(process.env.SMTP_PORT || '25', 10);
  var user = process.env.SMTP_USER || '';
  var pass = process.env.SMTP_PASS || '';

  var opts = {
    host: host,
    port: isNaN(port) ? 25 : port,
    secure: (process.env.SMTP_SECURE === 'true'),
    // The Plesk certificate will not match 'localhost'; this mirrors the
    // previous hard-coded behaviour and is required for local submission.
    tls: { rejectUnauthorized: false }
  };

  if (user && pass) {
    opts.auth = { user: user, pass: pass };
    if (process.env.SMTP_SECURE !== 'true' &&
        process.env.SMTP_REQUIRE_TLS !== 'false') {
      opts.requireTLS = true;
    }
  }

  return opts;
}

/* Describes the active config without exposing the password. For diagnostics. */
function describe() {
  var o = transportOptions();
  return o.host + ':' + o.port +
         (o.auth ? ' authenticated as ' + o.auth.user : ' unauthenticated') +
         (o.requireTLS ? ' (STARTTLS enforced)' : '');
}


/* MAILER_REPLYTO (2026-08-31)
   Reply-To for mail sent From addresses that have no monitored mailbox
   (eval@, noreply@). Without this, a candidate hitting Reply writes into a
   void. Override with MAIL_REPLY_TO in .env. */
function replyTo() {
  return process.env.MAIL_REPLY_TO || 'jfr@linguaid.net';
}

/* MAILER_INTERNAL_SPLIT_20260901
   Per-recipient transport routing.

   Mail addressed only to @linguaid.net recipients is submitted to localhost:25
   and delivered by the local Postfix without ever leaving the server. Anything
   with at least one external recipient goes via the configured relay.

   Rationale: on 1 Sep 2026 every internal message to jfr@linguaid.net was
   silently suppressed by the relay after the server's own DMARC handler
   deferred relayed mail. Internal mail routed locally cannot be affected by a
   third-party suppression list, and does not consume relay quota.

   Set MAIL_INTERNAL_SPLIT=false in .env to disable and route everything
   through the relay again.
*/

var INTERNAL_DOMAIN = 'linguaid.net';

function internalTransportOptions() {
  return {
    host: 'localhost',
    port: 25,
    secure: false,
    ignoreTLS: true,
    tls: { rejectUnauthorized: false }
  };
}

function _addrList(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    var flat = [];
    for (var i = 0; i < v.length; i++) {
      flat = flat.concat(_addrList(v[i]));
    }
    return flat;
  }
  if (typeof v === 'object') return v.address ? [String(v.address)] : [];
  return String(v).split(',').map(function (s) { return s.trim(); })
                  .filter(function (s) { return s.length > 0; });
}

/* True only when there is at least one recipient and every one of them is
   on the internal domain. Mixed internal/external mail goes via the relay so
   the external recipient is never dropped. */
function allInternal(mailOptions) {
  if (!mailOptions) return false;
  var rcpts = _addrList(mailOptions.to)
                .concat(_addrList(mailOptions.cc))
                .concat(_addrList(mailOptions.bcc));
  if (rcpts.length === 0) return false;
  for (var i = 0; i < rcpts.length; i++) {
    var m = rcpts[i].match(/<([^>]+)>/);
    var addr = (m ? m[1] : rcpts[i]).toLowerCase().replace(/[\s>]+$/, '');
    var at = addr.lastIndexOf('@');
    if (at === -1) return false;
    if (addr.slice(at + 1) !== INTERNAL_DOMAIN) return false;
  }
  return true;
}

/* Drop-in replacement for nodemailer.createTransport(transportOptions()).
   Returns an object exposing sendMail/verify with the same signatures. */
function createTransport() {
  var nodemailer = require('nodemailer');
  var enabled = (process.env.MAIL_INTERNAL_SPLIT !== 'false');
  var external = nodemailer.createTransport(transportOptions());
  var internal = null;

  function pick(mailOptions) {
    if (!enabled) return external;
    if (!allInternal(mailOptions)) return external;
    if (!internal) internal = nodemailer.createTransport(internalTransportOptions());
    return internal;
  }

  return {
    sendMail: function (mailOptions, callback) {
      var t = pick(mailOptions);
      return t.sendMail(mailOptions, callback);
    },
    verify: function (callback) { return external.verify(callback); },
    externalTransport: external
  };
}

module.exports = { transportOptions: transportOptions, describe: describe, replyTo: replyTo,
                   internalTransportOptions: internalTransportOptions,
                   allInternal: allInternal, createTransport: createTransport };
