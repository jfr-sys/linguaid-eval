#!/usr/bin/env python3
"""EMAIL_ALIASES_20260925 - merge Marianah KOUMI (cba02f36d720, test-side record
created by the Typeform webhook under a different email) into Marianah
FLORENTINE (mue2az9fgb2iv, Joss's legal intake + needsAnalysis).

Survivor keeps: id, name FLORENTINE, courseType legal, primary email, phone,
intakeToken, needsAnalysis. Everything the test pipeline produced on KOUMI is
copied over; KOUMI's email becomes an alias; KOUMI's oralToken REPLACES the
survivor's unused one so the link already sent to Hannah keeps working.
Idempotent (SKIP when KOUMI is gone). --dry-run writes nothing.
"""
import json, sys, shutil, copy, datetime

DATA = '/var/www/vhosts/linguaid.net/eval.linguaid.net/app/data/candidates.json'
if len(sys.argv) > 2 and sys.argv[2]: DATA = sys.argv[2]
DRY = '--dry-run' in sys.argv
SURV, DUP = 'mue2az9fgb2iv', 'cba02f36d720'

def blank(v): return v is None or v == '' or v == [] or v == {}

cs = json.load(open(DATA, encoding='utf-8'))
byid = {c['id']: c for c in cs}
s, d = byid.get(SURV), byid.get(DUP)
if not s: print('survivor missing'); sys.exit(2)
if not d:
    print('SKIP: duplicate', DUP, 'already gone; survivor mergedTwinIds =', s.get('mergedTwinIds')); sys.exit(0)
assert 'KOUMI' in d.get('name', '') and 'FLORENTINE' in s.get('name', ''), 'unexpected names'
assert not s.get('writtenReport') and not s.get('oralData'), 'survivor already has test/oral data - refusing'
assert s.get('needsAnalysis'), 'survivor has no needsAnalysis - refusing'

na_before = json.dumps(s['needsAnalysis'], ensure_ascii=False, sort_keys=True)
snap_d = copy.deepcopy(d)

# 1. test pipeline data -> survivor (copy where survivor is blank or zero)
COPY = ['scores', 'freewriting', 'goals', 'avail', 'otherNeeds', 'testdate', 'writtenReport', 'reportSummary',
        'levelsManuallyEditedAt', 'oralLinkSentAt', 'oralLastReminderAt', 'oralEvaluator', 'oralEmailSentTo',
        'oralBookedAt', 'calendlyLinkSentAt']
copied = []
for k in COPY:
    v = d.get(k)
    if blank(v) or (k == 'scores' and not (v or {}).get('total')): continue
    cur = s.get(k)
    if k in ('scores', 'freewriting', 'goals', 'avail') or blank(cur) or (k == 'scores' and not (cur or {}).get('total')):
        s[k] = copy.deepcopy(v); copied.append(k)
# identity fields only where survivor is blank
for k in ['jobtitle', 'company', 'dept']:
    if blank(s.get(k)) and not blank(d.get(k)): s[k] = d[k]; copied.append(k)
# conventionData: merge shallow, survivor wins
if d.get('conventionData'):
    cd = dict(d['conventionData']); cd.update(s.get('conventionData') or {}); s['conventionData'] = cd; copied.append('conventionData')
# 2. email alias
alias = str(d.get('email', '')).strip().lower()
if alias and alias != str(s.get('email', '')).strip().lower():
    s['emailAliases'] = sorted(set((s.get('emailAliases') or []) + [alias])); copied.append('emailAliases')
# 3. oral token: Hannah already holds KOUMI's link
if d.get('oralToken'):
    s['oralTokenAliases'] = sorted(set((s.get('oralTokenAliases') or []) + [s.get('oralToken')]) - {None, ''})
    s['oralToken'] = d['oralToken']; copied.append('oralToken')
# 4. status
if s.get('writtenReport'): s['status'] = 'written_report_done'
if d.get('oralData'):
    s['oralData'] = copy.deepcopy(d['oralData']); s['status'] = 'oral_done'; copied.append('oralData')
s['mergedTwinIds'] = sorted(set((s.get('mergedTwinIds') or []) + [DUP]))
s['mergedFrom_' + DUP] = {'name': d.get('name'), 'email': d.get('email'), 'createdAt': d.get('createdAt'), 'mergedAt': datetime.datetime.utcnow().isoformat() + 'Z'}
cs = [c for c in cs if c['id'] != DUP]

# asserts
assert json.dumps(s['needsAnalysis'], ensure_ascii=False, sort_keys=True) == na_before, 'needsAnalysis CHANGED - abort'
assert s['name'] == 'Marianah FLORENTINE' and s['courseType'] == 'legal' and s['email'] == 'florentine.marianah@gmail.com'
assert s['scores'] == snap_d['scores'] and s['writtenReport'] == snap_d['writtenReport'] and s['reportSummary'] == snap_d['reportSummary']
assert s['oralToken'] == snap_d['oralToken'] and alias in s['emailAliases']

print('copied:', ', '.join(copied))
print('status ->', s['status'], '| email', s['email'], '| aliases', s['emailAliases'], '| oralToken', s['oralToken'], '| score', s['scores'])
print('needsAnalysis unchanged: True | records', len(byid), '->', len(cs))
if DRY: print('DRY RUN - nothing written'); sys.exit(0)
bak = DATA + '.bak_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '_koumi_merge'
shutil.copy2(DATA, bak)
json.dump(cs, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
chk = {c['id']: c for c in json.load(open(DATA, encoding='utf-8'))}
assert DUP not in chk and chk[SURV]['writtenReport'] == snap_d['writtenReport'] and json.dumps(chk[SURV]['needsAnalysis'], ensure_ascii=False, sort_keys=True) == na_before
print('WRITTEN. backup:', bak, '| post-write verification OK')
