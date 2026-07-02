// lib/companies.js — canonical company registry
// Registry file: data/companies.json
// { "companies": { "<normkey>": { "canonical": "Name", "aliases": ["..."] } } }
var fs = require('fs');
var path = require('path');
var REGISTRY = path.join(__dirname, '../data/companies.json');

function normKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  } catch (e) {
    return { companies: {} };
  }
}

function saveRegistry(reg) {
  try {
    fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  } catch (e) {
    console.error('companies registry write error:', e.message);
  }
}

// Resolve a raw company name to its canonical form.
// Known name or alias -> canonical spelling. Unknown -> registered as new.
function canonicalCompany(raw) {
  var name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  var reg = loadRegistry();
  var key = normKey(name);
  if (reg.companies[key]) return reg.companies[key].canonical;
  var keys = Object.keys(reg.companies);
  for (var i = 0; i < keys.length; i++) {
    var e = reg.companies[keys[i]];
    var aliases = e.aliases || [];
    for (var j = 0; j < aliases.length; j++) {
      if (normKey(aliases[j]) === key) return e.canonical;
    }
  }
  reg.companies[key] = { canonical: name, aliases: [] };
  saveRegistry(reg);
  console.log('companies: registered new company "' + name + '"');
  return name;
}

function listCompanies() {
  var reg = loadRegistry();
  return Object.keys(reg.companies)
    .map(function(k) { return reg.companies[k].canonical; })
    .sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
}

module.exports = { canonicalCompany: canonicalCompany, listCompanies: listCompanies, normKey: normKey };
