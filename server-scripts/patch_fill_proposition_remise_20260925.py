#!/usr/bin/env python3
"""REMISE_NIVEAU_JURIDIQUE_20260925 - fill_proposition.py: a legal professional on
the GENERAL E360 course (remise a niveau) gets a third trainer profile in the
{{FORMATEUR}} line: a high-level coach used to working WITH lawyers (not a
former lawyer). Idempotent, anchor-checked, backup + ast check + auto-restore."""
import sys, shutil, datetime, ast
P = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_proposition.py'
MARK = 'REMISE_NIVEAU_JURIDIQUE_20260925'
s = open(P, encoding='utf-8').read()
if MARK in s:
    print('SKIP: already patched'); sys.exit(0)
a1 = 'FORMATEUR_LEGAL = ('
a2 = """            else:  # E360
                titre = TITRE_E360
                certification = certification_e360(rsCode)
                formateur = FORMATEUR_BUSINESS"""
for a in (a1, a2):
    if s.count(a) != 1:
        print('ANCHOR MISS (count=%d): %r' % (s.count(a), a[:60])); sys.exit(2)
s2 = s.replace(a1, '''# REMISE_NIVEAU_JURIDIQUE_20260925: legal public on the general E360 course
FORMATEUR_REMISE_JURIDIQUE = (
    "Coach anglophone natif de haut niveau, habitu\\u00e9 \\u00e0 travailler avec des avocats "
    "et des juristes, \\u00e0 distance en visioconf\\u00e9rence individuelle"
)
''' + a1, 1)
s2 = s2.replace(a2, a2 + """
                if courseType == 'legal':  # REMISE_NIVEAU_JURIDIQUE_20260925
                    formateur = FORMATEUR_REMISE_JURIDIQUE""", 1)
try:
    ast.parse(s2)
except SyntaxError as e:
    print('SYNTAX ERROR, nothing written:', e); sys.exit(3)
bak = P + '.bak_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy2(P, bak)
open(P, 'w', encoding='utf-8').write(s2)
print('PATCHED', P, '| backup', bak)
