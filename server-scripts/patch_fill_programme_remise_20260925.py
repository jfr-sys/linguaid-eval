#!/usr/bin/env python3
"""REMISE_NIVEAU_JURIDIQUE_20260925 - fill_programme_final.py: legal professional on
the GENERAL E360 course (remise a niveau). Reassure without claiming a legal
course: (1) Contenu de la formation - courses prepared by a coach used to working
with lawyers and juristes, role-plays drawn from the learner's legal environment;
(2) Moyens d'encadrement - one sentence appended (label formatting kept).
Idempotent, anchor-checked, backup + ast + auto-restore."""
import sys, shutil, datetime, ast
P = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_programme_final.py'
MARK = 'REMISE_NIVEAU_JURIDIQUE_20260925'
s = open(P, encoding='utf-8').read()
if MARK in s:
    print('SKIP: already patched'); sys.exit(0)
anchor = "    # Save and repack\n    tree.write(doc_path, xml_declaration=True, encoding='UTF-8', standalone=True)"
if s.count(anchor) != 1:
    print('ANCHOR MISS (count=%d)' % s.count(anchor)); sys.exit(2)
block = '''    # REMISE_NIVEAU_JURIDIQUE_20260925: legal public on the general E360 course
    if data.get('courseType') == 'legal' and data.get('cpfType') == 'E360':
        _p = find_para(root, 'Chaque cours sera pr\\xe9par\\xe9 sur mesure')
        if _p is not None:
            replace_text_in_para(_p, u'Chaque cours est pr\\xe9par\\xe9 sur mesure par un coach habitu\\xe9 \\xe0 travailler avec des avocats et des juristes\\u00a0: les mises en situation, \\xe0 l\\u2019\\xe9crit comme \\xe0 l\\u2019oral, s\\u2019appuient sur l\\u2019environnement professionnel juridique de l\\u2019apprenant.')
        _p = find_para(root, u'Moyens d\\u2019encadrement')
        if _p is not None:
            _ts = [t for t in _p.iter(q('t')) if t.text]
            if _ts:
                _ts[-1].text = _ts[-1].text.rstrip() + u' Pour ce parcours, le coach est habitu\\xe9 \\xe0 accompagner des professionnels du droit (avocats, juristes).'
                _ts[-1].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')

'''
s2 = s.replace(anchor, block + anchor, 1)
try:
    ast.parse(s2)
except SyntaxError as e:
    print('SYNTAX ERROR, nothing written:', e); sys.exit(3)
bak = P + '.bak_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy2(P, bak)
open(P, 'w', encoding='utf-8').write(s2)
print('PATCHED', P, '| backup', bak)
