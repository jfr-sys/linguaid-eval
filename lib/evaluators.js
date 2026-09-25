/* EVAL_CONFIRM_20260925 - one place for evaluator identities + the slot
   confirmation link. Evaluators confirm bookings themselves (one click, a
   date and a time) - no calendar access, no dependence on Calendly mail. */
var EVALUATORS = {
  Hannah: { email: 'coursdanglais24@gmail.com', calendly: 'https://calendly.com/coursdanglais24/english-oral-test' },
  Anna:   { email: 'ajmalzy@gmail.com',         calendly: 'https://calendly.com/ajmalzy/30min' },
  Louise: { email: 'lga@linguaid.net',           calendly: 'https://calendly.com/linguaid/formation-anglais' },
  Joss:   { email: 'jfr@linguaid.net',           calendly: 'https://calendly.com/coursdanglais24/english-oral-test' }
};
function emailOf(name) { var e = EVALUATORS[name]; return e ? e.email : null; }
function calendlyOf(name) { var e = EVALUATORS[name]; return (e && e.calendly) || EVALUATORS.Hannah.calendly; }
function nameForEmail(email) {
  var k = String(email || '').trim().toLowerCase();
  return Object.keys(EVALUATORS).find(function (n) { return EVALUATORS[n].email.toLowerCase() === k; }) || '';
}
function confirmUrl(c, evaluator) {
  return 'https://eval.linguaid.net/oral/confirm/' + c.oralToken + (evaluator ? '?e=' + encodeURIComponent(evaluator) : '');
}
/* HTML block appended to every email an evaluator receives about a candidate */
function confirmBlockHtml(c, evaluator) {
  var url = confirmUrl(c, evaluator);
  return '<div style="margin-top:18px;padding:12px 14px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;font-family:Arial,sans-serif;font-size:13px;color:#1f2937;line-height:1.5">'
    + '<strong>Once the oral is booked, please tell the platform when:</strong><br>'
    + '<a href="' + url + '" style="display:inline-block;margin-top:8px;background:#7c3aed;color:white;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Confirmer le créneau →</a>'
    + '<div style="font-size:11px;color:#6b7280;margin-top:6px">One click, a date and a time. This is what Joss sees on the candidate’s page — nothing else is read from your calendar.</div>'
    + '</div>';
}
module.exports = { EVALUATORS: EVALUATORS, emailOf: emailOf, calendlyOf: calendlyOf, nameForEmail: nameForEmail, confirmUrl: confirmUrl, confirmBlockHtml: confirmBlockHtml };
