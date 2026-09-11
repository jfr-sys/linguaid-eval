#!/usr/bin/env python3
# PARCOURS_CAJA_20260911 - parcours breakdown in fill_proposition.py (idempotent, anchor-checked)
import sys, os, shutil, ast, time
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_proposition.py'
MARK = 'PARCOURS_CAJA_20260911'
src = open(TARGET, encoding='utf-8').read()
if MARK in src:
    print('SKIP: already patched'); sys.exit(0)

A1 = "        # Non-CPF price calc if not provided\n"
A2 = "        etape2_p = find_para_with(root, '{{ETAPE_2}}')\n        if etape2_p is not None:\n            if cpfType == 'E360_LEGAL':\n"
for a in (A1, A2):
    if src.count(a) != 1:
        print('ABORT: anchor not found exactly once:', repr(a)); sys.exit(1)

B1 = '''        # PARCOURS_CAJA_20260911: two-module parcours -> Module 1 funding split
        # comes from lib/parcours.js (CPF cap per dossier, forfait, remainder).
        parcours = data.get('parcours') or None
        if parcours and parcours.get('calc') and parcours['calc'].get('modules'):
            _m1 = parcours['calc']['modules'][0]
            try:
                cpf_montant = int(round(float(_m1.get('cpfPart') or 0)))
                reste_charge = int(round(float(_m1.get('learnerPays') or 0)))
                price_int = int(round(float(_m1.get('price') or price_int)))
            except (ValueError, TypeError):
                pass

'''
B2 = '''        etape2_p = find_para_with(root, '{{ETAPE_2}}')
        if etape2_p is not None and parcours and parcours.get('lines'):
            # PARCOURS_CAJA_20260911: replace the optional Etape 2 line with the
            # full parcours breakdown (one paragraph per line, same formatting).
            _lines = [u'Parcours CAJA en deux modules \\u2013 convention globale sur ' + str(parcours['calc'].get('maxMonths', 12)) + u' mois'] + list(parcours['lines'])
            set_para_text(etape2_p, _lines[0])
            _prev = etape2_p
            for _ln in _lines[1:]:
                _np = deepcopy(etape2_p)
                set_para_text(_np, _ln)
                _prev.addnext(_np)
                _prev = _np
            etape2_p = None
'''
src = src.replace(A1, B1 + A1)
src = src.replace(A2, B2 + A2)
ast.parse(src)
bak = TARGET + '.bak_' + time.strftime('%Y%m%d_%H%M%S')
shutil.copy2(TARGET, bak)
open(TARGET, 'w', encoding='utf-8').write(src)
print('PATCHED', TARGET, 'backup', bak)
