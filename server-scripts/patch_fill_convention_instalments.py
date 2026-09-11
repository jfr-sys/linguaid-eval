#!/usr/bin/env python3
# INSTALMENTS_20260911 - add {{PAYMENT_TERMS}} to fill_convention2.py (idempotent, anchor-checked)
import sys, os, shutil, ast, time
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/fill_convention2.py'
MARK = 'INSTALMENTS_20260911'
src = open(TARGET, encoding='utf-8').read()
if MARK in src:
    print('SKIP: already patched'); sys.exit(0)

A1 = "def fill_convention(data):"
A2 = "        '{{RS_CODE}}':            data.get('rsCode') or 'RS7637',\n"
for a in (A1, A2):
    if src.count(a) != 1:
        print('ABORT: anchor not found exactly once:', repr(a)); sys.exit(1)

HELPER = '''# INSTALMENTS_20260911: payment schedule wording for Article 3.
# instalments 1 = legacy wording; 2-4 = monthly instalments, first one on
# receipt of invoice. Amounts split to the cent, last instalment absorbs
# the rounding so the total always equals the price.
def payment_terms(data):
    try:
        n = int(str(data.get('instalments') or 1))
    except Exception:
        n = 1
    n = max(1, min(4, n))
    if n == 1:
        return '\\u00e0 payer \\u00e0 r\\u00e9ception de facture'
    try:
        price = float(str(data.get('price', '')).replace('\\u20ac', '').replace(' ', '').replace(',', '.'))
    except Exception:
        price = 0
    def fmt(x):
        s = ('%.2f' % x)
        if s.endswith('.00'):
            s = s[:-3]
        return s.replace('.', ',') + ' \\u20ac'
    detail = ''
    if price > 0:
        base = round(price / n, 2)
        amounts = [base] * (n - 1) + [round(price - base * (n - 1), 2)]
        if len(set(amounts)) == 1:
            detail = ' de ' + fmt(base) + ' chacune'
        else:
            detail = ' (' + ', '.join(fmt(a) for a in amounts[:-1]) + ' et ' + fmt(amounts[-1]) + ')'
    return ('payables en ' + str(n) + ' \\u00e9ch\\u00e9ances mensuelles' + detail +
            ', la premi\\u00e8re \\u00e0 r\\u00e9ception de facture')

'''
LINE = "        '{{PAYMENT_TERMS}}':    payment_terms(data),\n"

new = src.replace(A1, HELPER + A1, 1).replace(A2, A2 + LINE, 1)
ast.parse(new)
bak = TARGET + '.bak_' + time.strftime('%Y%m%d_%H%M%S')
shutil.copy2(TARGET, bak)
open(TARGET, 'w', encoding='utf-8').write(new)
print('OK: patched', TARGET, '(backup', bak + ')')
