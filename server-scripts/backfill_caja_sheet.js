// server-scripts/backfill_caja_sheet.js — CAJA_SHEET backfill (2026-09-10)
// One-off: pushes every CAJA candidate who already received a convocation to
// the Suivi CAJA sheet (upsert by candidate_id, so safe to re-run).
// Usage (from app dir): node server-scripts/backfill_caja_sheet.js [--dry]
require('dotenv').config();
var path = require('path');
var fs = require('fs');
var sheet = require('../lib/cajaSheet');

var dry = process.argv.indexOf('--dry') > -1;
var file = path.join(__dirname, '../data/candidates.json');
var candidates = JSON.parse(fs.readFileSync(file, 'utf8'));
var todo = candidates.filter(function(c){
  return sheet.isCAJA(c) && c.conventionData && c.conventionData.convocationSentAt;
});
console.log('CAJA candidates with a convocation: ' + todo.length + (dry ? ' (dry run)' : ''));

(async function(){
  var sent = 0;
  for (var i = 0; i < todo.length; i++) {
    var c = todo[i];
    if (dry) { console.log(JSON.stringify(sheet.buildRow(c, (c.conventionData||{}).convocTrainer))); continue; }
    var ok = await sheet.pushConvocation(c, (c.conventionData||{}).convocTrainer);
    if (ok) sent++;
    await new Promise(function(r){ setTimeout(r, 1200); }); // be gentle with Apps Script
  }
  console.log('done: ' + sent + '/' + todo.length + ' rows sent');
})();
