#!/usr/bin/env python3
# PARCOURS_CAJA_20260911 - global two-module convention in fill_convention2.py (idempotent, anchor-checked)
import sys, os, shutil, ast, time
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_convention2.py'
MARK = 'PARCOURS_CAJA_20260911'
src = open(TARGET, encoding='utf-8').read()
if MARK in src:
    print('SKIP: already patched'); sys.exit(0)

A1 = "    'E360':    os.path.join(VIEWS, 'CONVENTION_CPF_E360.docx'),\n}\n"
A2 = "    tpl_key = 'CAJA' if tt == 'CAJA' else 'E360' if tt == 'E360' else 'CPF' if tt == 'CPF' else 'NON_CPF'\n"
A3 = "        '{{PAYMENT_TERMS}}':    payment_terms(data),\n    }\n"
A4 = "def fill_convention(data):\n"
for a in (A1, A2, A3, A4):
    if src.count(a) != 1:
        print('ABORT: anchor not found exactly once:', repr(a)); sys.exit(1)

HELPER = '''# PARCOURS_CAJA_20260911: placeholders for CONVENTION_PARCOURS_CAJA.docx.
# data['parcours'] = { calc: <lib/parcours.js compute()>, lines: [...], fmt: {...} }
def _pc_eur(n):
    try:
        n = float(n)
    except Exception:
        return '\\u2014'
    s = ('%.2f' % n)
    if s.endswith('.00'):
        s = s[:-3]
    whole, _, dec = s.partition('.')
    whole = '{:,}'.format(int(whole)).replace(',', '\\u00a0')
    return (whole + (',' + dec if dec else '')) + '\\u00a0\\u20ac'
def _pc_date_str(m, fmt_date):
    ds, de = m.get('dateStart') or '', m.get('dateEnd') or ''
    if ds and de:
        return 'du ' + fmt_date(ds) + ' au ' + fmt_date(de)
    if ds:
        return '\\u00e0 partir du ' + fmt_date(ds)
    return 'dates \\u00e0 convenir entre les parties'
def parcours_reps(data):
    pc = (data.get('parcours') or {}).get('calc') or {}
    if not pc:
        return {}
    MFR = {1:'janvier',2:'f\\u00e9vrier',3:'mars',4:'avril',5:'mai',6:'juin',7:'juillet',8:'ao\\u00fbt',9:'septembre',10:'octobre',11:'novembre',12:'d\\u00e9cembre'}
    def fmt_date(iso):
        try:
            y, mo, d = str(iso)[:10].split('-')
            return str(int(d)) + ' ' + MFR[int(mo)] + ' ' + y
        except Exception:
            return str(iso)
    mods = pc.get('modules') or [{}, {}]
    m1, m2 = mods[0], mods[1]
    tot = pc.get('totals') or {}
    balance = pc.get('cpfBalance')
    if pc.get('balanceKnown') and balance is not None:
        funding = ('Sur la base du cr\\u00e9dit CPF constat\\u00e9 \\u00e0 la signature (' + _pc_eur(balance) + '), la prise en charge pr\\u00e9visionnelle est de '
                   + _pc_eur(m1.get('cpfPart')) + ' pour le Module 1 et ' + _pc_eur(m2.get('cpfPart')) + ' pour le Module 2, soit '
                   + _pc_eur(tot.get('learner')) + ' restant \\u00e0 la charge du stagiaire pour l\\u2019ensemble du parcours (compl\\u00e9ments et participations forfaitaires compris).')
    else:
        funding = ('La prise en charge par le CPF est plafonn\\u00e9e \\u00e0 ' + _pc_eur(pc.get('cpfCap')) + ' par module et d\\u00e9pend du cr\\u00e9dit disponible sur le compte du stagiaire au moment de chaque inscription\\u00a0; '
                   + 'sur la base d\\u2019une prise en charge maximale, ' + _pc_eur(tot.get('learner')) + ' resteraient \\u00e0 la charge du stagiaire pour l\\u2019ensemble du parcours.')
    n_inst = int(m2.get('instalments') or 4)
    if n_inst < 2:
        n_inst = 4
    try:
        m2_price = float(m2.get('price') or 0)
    except Exception:
        m2_price = 0
    base = round(m2_price / n_inst, 2)
    direct_terms = ('payable en ' + str(n_inst) + ' \\u00e9ch\\u00e9ances mensuelles de ' + _pc_eur(base) + ', la premi\\u00e8re \\u00e0 r\\u00e9ception de facture')
    dedit = '30\\u00a0% du prix du Module 2, soit ' + _pc_eur(round(m2_price * 0.3, 2))
    return {
        '{{M1_TITLE}}':            m1.get('title', ''),
        '{{M2_TITLE}}':            m2.get('title', ''),
        '{{M1_TOTAL_HOURS}}':      str(m1.get('totalHours', '')),
        '{{M2_TOTAL_HOURS}}':      str(m2.get('totalHours', '')),
        '{{PARCOURS_TOTAL_HOURS}}': str(tot.get('totalHours', '')),
        '{{M1_DATE_STR}}':         _pc_date_str(m1, fmt_date),
        '{{M2_DATE_STR}}':         _pc_date_str(m2, fmt_date),
        '{{M1_PRICE}}':            str(int(float(m1.get('price') or 0))),
        '{{M2_PRICE}}':            str(int(float(m2.get('price') or 0))),
        '{{PARCOURS_TOTAL}}':      str(int(float(tot.get('price') or 0))),
        '{{PARCOURS_MONTHS}}':     str(pc.get('maxMonths', 12)),
        '{{PARCOURS_FUNDING}}':    funding,
        '{{M2_DIRECT_TERMS}}':     direct_terms,
        '{{M2_DEDIT}}':            dedit,
    }
'''

src = src.replace(A1, "    'E360':    os.path.join(VIEWS, 'CONVENTION_CPF_E360.docx'),\n    'PARCOURS': os.path.join(VIEWS, 'CONVENTION_PARCOURS_CAJA.docx'),  # PARCOURS_CAJA_20260911\n}\n")
src = src.replace(A2, "    tpl_key = 'PARCOURS' if tt == 'PARCOURS' else 'CAJA' if tt == 'CAJA' else 'E360' if tt == 'E360' else 'CPF' if tt == 'CPF' else 'NON_CPF'  # PARCOURS_CAJA_20260911\n")
src = src.replace(A3, "        '{{PAYMENT_TERMS}}':    payment_terms(data),\n    }\n    reps.update(parcours_reps(data))  # PARCOURS_CAJA_20260911\n")
src = src.replace(A4, HELPER + "\n" + A4)

ast.parse(src)
bak = TARGET + '.bak_' + time.strftime('%Y%m%d_%H%M%S')
shutil.copy2(TARGET, bak)
open(TARGET, 'w', encoding='utf-8').write(src)
print('PATCHED', TARGET, 'backup', bak)
