#!/usr/bin/env python3
# TIERS_HEADER_20260918 - tiers-mode header + headings in fill_proposition.py (idempotent, anchor-checked)
# In tiers (hr) mode for a non-CPF proposal:
#   - the address block (civilite + nom, email) names the company contact, not the learner
#   - "1. Votre profil" -> "1. Profil de <learner>", "2. Votre programme sur mesure" -> "2. Programme sur mesure"
import sys, os, shutil, ast, time
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_proposition.py'
MARK = 'TIERS_HEADER_20260918'
src = open(TARGET, encoding='utf-8').read()
if MARK in src:
    print('SKIP: already patched'); sys.exit(0)

A1 = "        recipientType = data.get('recipientType', 'learner')\n"
A2 = "        substitutions = {\n            '{{TITRE}}':          titre,\n            '{{CIVILITE}}':       civility,\n            '{{NOM_COMPLET}}':    fullName,\n            '{{ENTREPRISE}}':     company,\n            '{{EMAIL}}':          email,\n"
A3 = "                sys.stderr.write('TIERS_WORDING_FIX: heading \"vous serez capable de\" not found - left unchanged\\n')\n"
for a in (A1, A2, A3):
    if src.count(a) != 1:
        print('ABORT: anchor not found exactly once:', repr(a)); sys.exit(1)

B1 = A1 + '''        # TIERS_HEADER_20260918: company contact for the address block in
        # tiers mode (sent by routes/programme.js from the picker / persisted
        # thirdParty* fields). Empty dict when absent or in learner mode.
        tiers = data.get('tiers') or {}
'''

B2 = '''        # TIERS_HEADER_20260918: non-CPF proposal addressed to a third party ->
        # header names the company contact; learner fields are the fallback
        # whenever the contact is incomplete, so nothing is ever left blank.
        hdr_civility, hdr_name, hdr_email = civility, fullName, email
        if (not isCPF) and recipientType == 'hr' and tiers:
            _tn = ((tiers.get('prenom') or '') + ' ' + (tiers.get('nom') or '')).strip()
            if _tn:
                hdr_name = _tn
                hdr_civility = (tiers.get('civility') or '').strip()
            if (tiers.get('email') or '').strip():
                hdr_email = tiers['email'].strip()

        substitutions = {
            '{{TITRE}}':          titre,
            '{{CIVILITE}} {{NOM_COMPLET}}': (hdr_civility + ' ' + hdr_name).strip(),
            '{{CIVILITE}}':       hdr_civility,
            '{{NOM_COMPLET}}':    hdr_name,
            '{{ENTREPRISE}}':     company,
            '{{EMAIL}}':          hdr_email,
'''

B3 = A3 + '''            # TIERS_HEADER_20260918: the two "Votre ..." section headings read
            # as addressed to the learner - reword for a third-party reader.
            for _old, _new in (('Votre profil', 'Profil de ' + fullName),
                               ('Votre programme sur mesure', 'Programme sur mesure')):
                _hp = find_para_with(root, _old)
                if _hp is not None:
                    replace_in_para(_hp, _old, _new)
                else:
                    sys.stderr.write('TIERS_HEADER_20260918: heading %r not found - left unchanged\\n' % _old)
'''

new = src.replace(A1, B1, 1).replace(A2, B2, 1).replace(A3, B3, 1)
for m in ('tiers = data.get', "'{{CIVILITE}} {{NOM_COMPLET}}'", "'Profil de ' + fullName"):
    if new.count(m) != 1:
        print('ABORT: post-check failed for', repr(m)); sys.exit(1)
ast.parse(new)
bak = TARGET + '.bak_' + time.strftime('%Y%m%d_%H%M%S')
shutil.copy2(TARGET, bak)
open(TARGET, 'w', encoding='utf-8').write(new)
print('PATCHED:', TARGET, 'backup:', bak)
