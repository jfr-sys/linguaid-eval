#!/usr/bin/env python3
"""ORAL_TIMELINE_20260925 - parse_booking.py: also pass the Calendly host
(evaluator) and the event start line to /api/calendly-webhook so the
candidate record can store oralBookedWith / oralSlotAt. Idempotent."""
import sys, shutil, datetime, ast
P = sys.argv[1] if len(sys.argv) > 1 else '/home/debian/parse_booking.py'
MARK = 'ORAL_TIMELINE_20260925'
s = open(P, encoding='utf-8').read()
if MARK in s:
    print('SKIP: already patched'); sys.exit(0)
old = "payload = json.dumps({'email': email, 'bookedAt': ''}).encode('utf-8')"
if s.count(old) != 1:
    print('ANCHOR MISS: payload line count =', s.count(old)); sys.exit(2)
new = '''# ORAL_TIMELINE_20260925: identify the Calendly host (our evaluator) and the slot.
# Calendly confirmations name the host in the body ("Hannah Durant", "with Anna ...")
# and the invitee is in To:, so the first evaluator first name found in the text
# that is NOT the invitee's own name is the host. Best effort - blank when unsure.
EVALUATORS = ['Hannah', 'Anna', 'Louise', 'Joss']
low = raw.lower()
host = ''
for _ev in EVALUATORS:
    if re.search(r'\\b' + _ev.lower() + r'\\b', low):
        host = _ev
        break
slot = ''
_m = re.search(r'(?:Event\\s*Date/Time|Date/Time|When|Quand|Date et heure)\\s*[:\\-]\\s*(.+)', raw, re.IGNORECASE)
if _m:
    slot = _m.group(1).strip()[:120]
else:
    _m = re.search(r'(\\d{1,2}:\\d{2}\\s*(?:am|pm)?[^\\n]{0,60}\\b20\\d{2})', raw, re.IGNORECASE)
    if _m:
        slot = _m.group(1).strip()[:120]
logging.info('Host guess: %s | slot: %s', host, slot)
payload = json.dumps({'email': email, 'bookedAt': '', 'evaluator': host, 'eventStart': slot}).encode('utf-8')'''
bak = P + '.bak_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
shutil.copy2(P, bak)
s2 = s.replace(old, new)
try:
    ast.parse(s2)
except SyntaxError as e:
    print('SYNTAX ERROR after patch, restoring:', e); shutil.copy2(bak, P); sys.exit(3)
open(P, 'w', encoding='utf-8').write(s2)
print('PATCHED', P, '| backup', bak)
