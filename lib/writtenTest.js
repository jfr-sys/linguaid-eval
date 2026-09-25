/* NEEDS_ANALYSIS_20260925 - one place for the in-house written test invitation.
   The test is Linguaid's own Typeform questionnaire (form XBcM6I1W: 30 MCQ +
   3 free-writing prompts); it is NOT the certifier's test. The learner's email
   is passed as a Typeform hidden field so the webhook match is deterministic
   (ignored by Typeform if the form has no such hidden field - harmless). */

var TYPEFORM_ID = 'XBcM6I1W';

function testUrl(email) {
  var base = 'https://form.typeform.com/to/' + TYPEFORM_ID;
  var e = String(email || '').trim();
  return e ? base + '#email=' + encodeURIComponent(e) : base;
}

function inviteHtml(name, url, opts) {
  opts = opts || {};
  var intro = opts.afterInterview
    ? '<p>Suite à notre entretien, et comme convenu, voici le lien vers un test d’anglais écrit. Ceci nous permettra de compléter l’analyse de vos besoins par une première appréciation de votre niveau. Par la suite, un membre de notre équipe vous contactera pour la partie orale.</p>'
    : '<p>Vous allez normalement suivre une formation en anglais avec nous. Avant la formation, nous avons besoin d’évaluer votre niveau et vos besoins afin d’établir le devis de formation et le programme personnalisé.</p>'
      + '<p>Pour démarrer, veuillez trouver le lien vers un test d’anglais écrit. Ceci nous permettra d’avoir une première appréciation de votre niveau. Par la suite, un membre de notre équipe vous contactera par téléphone pour la partie orale.</p>';
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">'
    + '<p>Bonjour ' + name + ',</p>'
    + intro
    + '<p>Comptez 20 minutes MAXIMUM au calme pour réaliser ce test. Pour toutes questions ou informations supplémentaires avant ou après, n’hésitez pas à nous joindre directement.</p>'
    + '<p>Accès direct au test (le contenu est général, mais cela nous permet de mieux apprécier le niveau) :<br>'
    + '<a href="' + url + '">' + url + '</a></p>'
    + '<p>Etapes à suivre :</p>'
    + '<ul><li>Cliquez sur le lien ci-dessus</li><li>Remplissez les champs pour vous identifier</li><li>Répondez aux questions</li><li>Soumettez le test à la fin.</li></ul>'
    + '<p>Bon test !</p>'
    + '<p>Bien cordialement,</p>'
    + '<img src="https://eval.linguaid.net/signature_joss.png" alt="Joss Frimond - Linguaid" style="max-width:400px;display:block;margin-top:8px">'
    + '</div>';
}

/* Sends the invitation. cb(err). Does NOT persist anything - the caller stamps
   writtenTestSentAt / invitedAt / lastReminderAt and saves. */
function sendInvite(c, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  var mailer = require('./mailer');
  var transporter = mailer.createTransport();
  var url = testUrl(c.email);
  transporter.sendMail({
    from: 'eval@linguaid.net', replyTo: mailer.replyTo(),
    to: c.email,
    subject: 'Votre test d’anglais - Linguaid',
    html: inviteHtml(c.name, url, opts)
  }, function (err) { cb(err, url); });
}

function stampSent(c, now) {
  now = now || new Date().toISOString();
  c.writtenTestSentAt = now;
  c.invitedAt = c.invitedAt || now;
  c.lastReminderAt = now;
  return c;
}

module.exports = { TYPEFORM_ID: TYPEFORM_ID, testUrl: testUrl, inviteHtml: inviteHtml, sendInvite: sendInvite, stampSent: stampSent };
