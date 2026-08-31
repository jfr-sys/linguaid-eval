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

module.exports = { transportOptions: transportOptions, describe: describe, replyTo: replyTo };
