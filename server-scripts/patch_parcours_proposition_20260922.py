#!/usr/bin/env python3
"""PARCOURS_PROPOSITION_20260922 - proposition PDF for the two-module parcours.

Target: /home/debian/fill_proposition.py (server-only; mirror in
server-scripts-snapshot/fill_proposition.py.snapshot). Pass the target path as
argv[1]; default is /home/debian/fill_proposition.py.

Before: PARCOURS_CAJA_20260911 left sections 2/3 describing Module 1 only and
dumped the whole parcours breakdown (bold) into the {{ETAPE_2}} slot between
section 3 and 4. Joss (22 Sept 2026): sections 2 and 3 must read as one
continued course, financing details belong in section 4 and not all in bold.

After, when data['parcours'] is present:
  - title: "Proposition de parcours de formation en anglais juridique des
    affaires - deux modules"
  - section 2 table: Duree totale = parcours total (both modules, max months),
    two extra rows "Module 1" / "Module 2" (title, hours, dates), coaching and
    travail guide totals with per-module split, Periode over the parcours,
    Certification = both certifications
  - section 3: heading "A l issue de ce parcours", Module 1 objectives (as
    sent, personalised) then Module 2 objectives (CAJA referential), each
    under a bold module sub-label
  - {{ETAPE_2}} slot: one short line on the B2 attestation being the CAJA
    prerequisite (bold style of the template, one line only)
  - section 4 CPF table: three rows (Module 1, Module 2, Total du parcours)
    with amount cells; then the per-module funding lines and the comparison
    line as PLAIN paragraphs (style copied from the "Lien d inscription CPF"
    paragraph, not from the bold ETAPE_2 paragraph)

Idempotent (marker PARCOURS_PROPOSITION_20260922), exact anchors, backup.
"""
import os, sys, shutil, time, ast

TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_proposition.py'
MARKER = 'PARCOURS_PROPOSITION_20260922'

src = open(TARGET, encoding='utf-8').read()
if MARKER in src:
    print('SKIP  %s already applied' % TARGET); sys.exit(0)

def sub(old, new, label):
    global src
    n = src.count(old)
    if n != 1:
        print('ABORT anchor %s found %d times' % (label, n)); sys.exit(1)
    src = src.replace(old, new)

# 1. CAJA referential objectives available to the filler (Module 2 list)
OLD1 = "# ── Title strings ─"
NEW1 = '''# PARCOURS_PROPOSITION_20260922: Module 2 (CAJA, RS6810) referential objectives,
# identical to REFERENTIAL_OBJECTIVES.CAJA in routes/programme.js.
CAJA_OBJECTIVES = [
    u"Se pr\\u00e9senter dans un cadre professionnel et \\u00e9tablir un bon contact avec un client, un coll\\u00e8gue ou un confr\\u00e8re",
    u"Mener un premier entretien pour comprendre la situation, poser les bonnes questions et identifier les attentes",
    u"Expliquer une probl\\u00e9matique juridique, proposer des options et aider \\u00e0 la prise de d\\u00e9cision",
    u"R\\u00e9diger des documents professionnels adapt\\u00e9s au contexte\\u00a0: emails, lettres, notes d\\u2019avocat",
    u"Corriger ou r\\u00e9diger des clauses contractuelles claires, pr\\u00e9cises et structur\\u00e9es",
    u"Conduire une n\\u00e9gociation, formuler ou r\\u00e9pondre \\u00e0 des propositions, et d\\u00e9fendre les int\\u00e9r\\u00eats de son client",
]
TITRE_PARCOURS = u"Proposition de parcours de formation en anglais juridique des affaires \\u2013 deux modules"

def _eur(n):
    try:
        v = float(n)
    except (TypeError, ValueError):
        return u'\\u2014'
    s = ('%.2f' % v)
    if s.endswith('.00'):
        s = s[:-3]
    ip, _, dp = s.partition('.')
    ip = '{:,}'.format(int(ip)).replace(',', u'\\u00a0')
    return (ip + (',' + dp if dp else '')) + u'\\u00a0\\u20ac'

def _fmt_date_fr(iso):
    if not iso:
        return u''
    try:
        y, m, d = str(iso)[:10].split('-')
        mois = [u'janvier', u'f\\u00e9vrier', u'mars', u'avril', u'mai', u'juin', u'juillet', u'ao\\u00fbt', u'septembre', u'octobre', u'novembre', u'd\\u00e9cembre']
        return u'%d %s %s' % (int(d), mois[int(m) - 1], y)
    except Exception:
        return str(iso)

def _row_of(p):
    el = p
    for _ in range(6):
        if el is None:
            return None
        if el.tag == q('tr'):
            return el
        el = el.getparent()
    return None

def _set_cell_texts(tr, cell_idx, texts):
    """Set the paragraphs of table cell cell_idx to texts (list); extra paragraphs cleared."""
    tcs = list(tr.iter(q('tc')))
    if cell_idx >= len(tcs):
        return
    ps = list(tcs[cell_idx].iter(q('p')))
    for i, p in enumerate(ps):
        set_para_text(p, texts[i] if i < len(texts) else u'')

# ── Title strings ─'''
sub(OLD1, NEW1, 'title strings')

# 2. title in parcours mode
OLD2 = """            elif cpfType == 'E360_LEGAL':
                titre = TITRE_E360_LEGAL
                certification = certification_e360(rsCode)
                formateur = FORMATEUR_LEGAL"""
NEW2 = """            elif cpfType == 'E360_LEGAL':
                titre = TITRE_E360_LEGAL
                certification = certification_e360(rsCode)
                formateur = FORMATEUR_LEGAL
                if parcours and parcours.get('calc'):
                    titre = TITRE_PARCOURS  # PARCOURS_PROPOSITION_20260922"""
sub(OLD2, NEW2, 'title parcours')

# 3. replace the old ETAPE_2 dump with the full sections 2/3/4 rework
OLD3 = """        etape2_p = find_para_with(root, '{{ETAPE_2}}')
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
        etape2_p = find_para_with(root, '{{ETAPE_2}}')"""
NEW3 = """        # PARCOURS_PROPOSITION_20260922: two-module parcours rendered as ONE
        # continued course (sections 2 and 3), financing detail in section 4.
        etape2_p = find_para_with(root, '{{ETAPE_2}}')
        if etape2_p is not None and parcours and parcours.get('calc') and parcours['calc'].get('modules'):
            _pc = parcours['calc']; _m1, _m2 = _pc['modules'][0], _pc['modules'][1]; _tt = _pc.get('totals') or {}
            _months = str(_pc.get('maxMonths', 12))
            _m1_title = _m1.get('title') or u'Anglais professionnel \\u2013 parcours juridique (English 360)'
            _m2_title = _m2.get('title') or u'Communiquer en anglais juridique des affaires (CAJA)'
            _m1_dates = (u'du ' + dateStart + u' au ' + dateEnd) if dateStart and dateEnd else u''
            _m2_start = _fmt_date_fr(_m2.get('dateStart'))
            _m2_dates = (u'\\u00e0 partir du ' + _m2_start) if _m2_start else u'\\u00e0 l\\u2019issue du Module 1'
            def _h(n):
                try: return str(int(float(n)))
                except (TypeError, ValueError): return str(n or '')
            # -- section 2 table -------------------------------------------------
            _p_total = find_para_with(root, u'Dur\\u00e9e totale')
            _tr_total = _row_of(_p_total) if _p_total is not None else None
            if _tr_total is not None:
                _set_cell_texts(_tr_total, 1, [_h(_tt.get('totalHours')) + u' heures \\u2013 parcours en deux modules sur ' + _months + u' mois maximum'])
                _tr_m1 = deepcopy(_tr_total); _tr_m2 = deepcopy(_tr_total)
                _set_cell_texts(_tr_m1, 0, [u'Module 1'])
                _set_cell_texts(_tr_m1, 1, [_m1_title + u' \\u2013 ' + _h(_m1.get('totalHours')) + u' h' + (u' \\u2013 ' + _m1_dates if _m1_dates else u'')])
                _set_cell_texts(_tr_m2, 0, [u'Module 2'])
                _set_cell_texts(_tr_m2, 1, [_m2_title + u' \\u2013 ' + _h(_m2.get('totalHours')) + u' h \\u2013 ' + _m2_dates])
                _tr_total.addnext(_tr_m1); _tr_m1.addnext(_tr_m2)
            _p_coach = find_para_with(root, u'Coaching individuel')
            _tr = _row_of(_p_coach) if _p_coach is not None else None
            if _tr is not None:
                _tcs = list(_tr.iter(q('tc')))
                _ps = list(_tcs[1].iter(q('p'))) if len(_tcs) > 1 else []
                if _ps:
                    set_para_text(_ps[0], _h(_tt.get('coachingHours')) + u' heures en visioconf\\u00e9rence (' + _h(_m1.get('coachingHours')) + u' h par module)')
            _p_hw = find_para_with(root, u'Travail guid\\u00e9 en autonomie')
            _tr = _row_of(_p_hw) if _p_hw is not None else None
            if _tr is not None:
                _hw_tot = (float(_m1.get('homeworkHours') or 0) + float(_m2.get('homeworkHours') or 0))
                _set_cell_texts(_tr, 1, [_h(_hw_tot) + u' heures (' + _h(_m1.get('homeworkHours')) + u' h par module)'])
            _p_per = find_para_with(root, u'P\\u00e9riode')
            _tr = _row_of(_p_per) if _p_per is not None else None
            if _tr is not None:
                _set_cell_texts(_tr, 1, [u'Module 1 ' + _m1_dates + u' \\u00b7 Module 2 ' + _m2_dates + u' \\u2013 parcours r\\u00e9alis\\u00e9 sur ' + _months + u' mois maximum'])
            _p_cert = find_para_with(root, u'Certification')
            _tr = _row_of(_p_cert) if _p_cert is not None else None
            if _tr is not None:
                _set_cell_texts(_tr, 1, [u'Module 1\\u00a0: ' + certification_e360(rsCode) + u' \\u00b7 Module 2\\u00a0: ' + CERTIFICATION_CAJA])
            # -- section 3 objectives --------------------------------------------
            _cap = find_para_with(root, u'vous serez capable de')
            if _cap is not None:
                replace_in_para(_cap, u'de cette formation', u'de ce parcours')
            # objectives were already substituted above -> locate the paragraphs by their text
            _obj_ps = [find_para_with(root, o) for o in (objectives or [])[:6]]
            _obj_ps = [p for p in _obj_ps if p is not None]
            _obj_template = deepcopy(_obj_ps[0]) if _obj_ps else None
            _label_template = deepcopy(etape2_p)
            if _obj_template is not None:
                # remove the template placeholders, rebuild the block after the heading
                _anchor = _cap if _cap is not None else _obj_ps[0].getprevious()
                for p in _obj_ps:
                    remove_para(p)
                _prev = _anchor
                _seq = []
                _seq.append((_label_template, u'Module 1 \\u2013 ' + _m1_title))
                for o in (objectives or [])[:6]:
                    _seq.append((_obj_template, o))
                _seq.append((_label_template, u'Module 2 \\u2013 ' + _m2_title))
                for o in CAJA_OBJECTIVES:
                    _seq.append((_obj_template, o))
                for _tpl, _txt in _seq:
                    _np = deepcopy(_tpl); set_para_text(_np, _txt); _prev.addnext(_np); _prev = _np
            # -- ETAPE_2 slot: one line ------------------------------------------
            set_para_text(etape2_p, u'Parcours en deux modules sous une convention globale\\u00a0: l\\u2019attestation de niveau B2 d\\u00e9livr\\u00e9e \\u00e0 l\\u2019issue du Module 1 constitue le pr\\u00e9requis de la certification CAJA pr\\u00e9par\\u00e9e au Module 2.')
            # -- section 4: CPF table + plain funding lines ----------------------
            _p_bud = find_para_with(root, u'Budget total')
            _tr_bud = _row_of(_p_bud) if _p_bud is not None else None
            _p_forf = find_para_with(root, u'Participation forfaitaire')
            _tr_forf = _row_of(_p_forf) if _p_forf is not None else None
            if _tr_bud is not None and _tr_forf is not None:
                _tr_m2r = deepcopy(_tr_forf)  # light row style for Module 2; Total keeps the light row too
                _set_cell_texts(_tr_bud, 0, [u'Module 1 \\u2013 English 360', _eur(_m1.get('price')) + u' NET DE TAXES'])
                _set_cell_texts(_tr_bud, 1, [u'Prise en charge CPF', _eur(_m1.get('cpfPart'))])
                _set_cell_texts(_tr_m2r, 0, [u'Module 2 \\u2013 CAJA', _eur(_m2.get('price')) + u' NET DE TAXES'])
                _set_cell_texts(_tr_m2r, 1, [u'Prise en charge CPF', _eur(_m2.get('cpfPart'))])
                _tr_bud.addnext(_tr_m2r)
                _set_cell_texts(_tr_forf, 0, [u'Total du parcours', _eur(_tt.get('price')) + u' NET DE TAXES'])
                _set_cell_texts(_tr_forf, 1, [u'Reste \\u00e0 votre charge', _eur(_tt.get('learner')) + u' (dont ' + _eur(_tt.get('forfait')) + u' de participation forfaitaire)'])
            _p_lien = find_para_with(root, u'Lien d\\u2019inscription CPF')
            if _p_lien is not None:
                _plain = deepcopy(_p_lien)
                def _fund(m, label):
                    if m.get('route') == 'CPF':
                        return (label + u'\\u00a0: ' + _eur(m.get('cpfPart')) + u' pris en charge par le CPF'
                                + ((u', ' + _eur(m.get('remainder')) + u' de compl\\u00e9ment') if float(m.get('remainder') or 0) > 0 else u'')
                                + u' et ' + _eur(m.get('forfait')) + u' de participation forfaitaire, soit ' + _eur(m.get('learnerPays'))
                                + u' \\u00e0 votre charge, r\\u00e9gl\\u00e9s lors de l\\u2019inscription sur Mon Compte Formation.')
                    return (label + u'\\u00a0: r\\u00e8glement direct de ' + _eur(m.get('price')) + u' en ' + str(m.get('instalments') or 1)
                            + u' \\u00e9ch\\u00e9ances mensuelles (aucune participation forfaitaire).')
                _lines = [_fund(_m1, u'Module 1'), _fund(_m2, u'Module 2')]
                _dir = _pc.get('direct') or {}
                if float(_dir.get('saving') or 0) > 0:
                    _lines.append(u'\\u00c0 titre de comparaison, les m\\u00eames ' + _h(_tt.get('coachingHours')) + u' heures de coaching achet\\u00e9es directement, hors certification, co\\u00fbteraient ' + _eur(_dir.get('comparator')) + u'\\u00a0: le parcours vous fait \\u00e9conomiser ' + _eur(_dir.get('saving')) + u' et inclut deux certifications.')
                _lines.append(u'L\\u2019inscription CPF ci-dessous concerne le Module 1\\u00a0; celle du Module 2 se fait \\u00e0 l\\u2019issue du premier, dans le cadre de la m\\u00eame convention.')
                _prev = _p_lien.getprevious()
                if _prev is None:
                    _prev = _p_lien
                _first = True
                for _ln in _lines:
                    _np = deepcopy(_plain); set_para_text(_np, _ln)
                    if _first and _prev is _p_lien:
                        _p_lien.addprevious(_np)
                    else:
                        _prev.addnext(_np)
                    _prev = _np; _first = False
            etape2_p = None
        etape2_p = find_para_with(root, '{{ETAPE_2}}')"""
sub(OLD3, NEW3, 'etape2 block')

ast.parse(src)
shutil.copy2(TARGET, TARGET + '.bak_' + time.strftime('%Y%m%d_%H%M%S'))
open(TARGET, 'w', encoding='utf-8').write(src)
print('OK    %s (%s)' % (TARGET, MARKER))
