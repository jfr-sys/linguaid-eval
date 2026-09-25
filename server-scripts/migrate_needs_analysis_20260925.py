#!/usr/bin/env python3
"""NEEDS_ANALYSIS_20260925 - one-off migration for the two legal candidates whose
positioning interview (Joss) was stored as the oral, and whose written-test twin
was created via "Inviter un candidat".

For each SURVIVOR id:
  1. copy oralData -> needsAnalysis VERBATIM (minus the intakeType stamp),
     nextStep='written_test', keep the original object under legacyOralData
  2. assert every non-blank key/value is identical (abort + restore otherwise)
  3. oralData = None, status oral_done -> csv_uploaded
  4. fold the TWIN's invitation stamps onto the survivor (writtenTestSentAt =
     twin.invitedAt) - the invite mail really was sent from the twin
  5. delete the twin (it holds no test evidence - asserted)
Idempotent: a survivor already migrated is SKIPped. --dry-run prints and writes nothing.
"""
import json, sys, shutil, copy, datetime

DATA = '/var/www/vhosts/linguaid.net/eval.linguaid.net/app/data/candidates.json'
if len(sys.argv) > 2 and sys.argv[2]: DATA = sys.argv[2]
DRY = '--dry-run' in sys.argv

PAIRS = {  # survivor (legal intake record) : twin (invited via Inviter un candidat)
    'mugmvgoeyvrui': '0e825805b00e',   # François de Bastard
    'mue2az9fgb2iv': 'b99fc03b7256',   # Marianah FLORENTINE
}

def blank(v): return v is None or (isinstance(v, str) and v.strip() == '')

def has_evidence(c):
    sc = c.get('scores') or {}
    if (sc.get('total') or 0) > 0: return True
    fw = c.get('freewriting') or {}
    return any(not blank(v) for v in fw.values())

cs = json.load(open(DATA, encoding='utf-8'))
byid = {c['id']: c for c in cs}
print('records before:', len(cs))
changed = False
errors = []

for sid, tid in PAIRS.items():
    s = byid.get(sid); t = byid.get(tid)
    print('\n=== survivor', sid, (s or {}).get('name'), '| twin', tid, (t or {}).get('name'))
    if not s: errors.append('survivor missing ' + sid); continue
    od = s.get('oralData')
    if s.get('needsAnalysis') and (od is None):
        print('  SKIP: already migrated')
    elif not od or od.get('intakeType') != 'legal_intake':
        errors.append(sid + ': oralData is not a legal_intake stamp -> refusing'); continue
    elif not blank(od.get('listeningLevel')) or not blank(od.get('speakingLevel')):
        errors.append(sid + ': oralData holds evaluator levels -> refusing'); continue
    else:
        snap = copy.deepcopy(od)
        na = {k: copy.deepcopy(v) for k, v in snap.items() if k != 'intakeType'}
        # assert
        for k, v in snap.items():
            if k == 'intakeType' or blank(v): continue
            if json.dumps(na.get(k), ensure_ascii=False, sort_keys=True) != json.dumps(v, ensure_ascii=False, sort_keys=True):
                errors.append(sid + ': assert failed on ' + k)
        if errors: continue
        na['nextStep'] = 'written_test'
        na['submittedAt'] = (snap.get('interviewDate') or s.get('createdAt', '')[:10]) + 'T00:00:00.000Z'
        na['detachedFromOralAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
        na['legacyOralData'] = snap
        na['migration'] = 'NEEDS_ANALYSIS_20260925'
        s['needsAnalysis'] = na
        s['oralData'] = None
        if s.get('status') == 'oral_done': s['status'] = 'written_report_done' if s.get('writtenReport') else 'csv_uploaded'
        changed = True
        print('  preserved keys:', ', '.join(k for k in snap if k != 'intakeType'))
        print('  status ->', s['status'], '| oralData -> None')
    if t:
        if has_evidence(t):
            errors.append(tid + ': twin HAS test evidence -> refusing to delete (merge needed)'); continue
        if str(t.get('email', '')).strip().lower() != str(s.get('email', '')).strip().lower():
            errors.append(tid + ': twin email differs from survivor -> refusing'); continue
        inv = t.get('invitedAt') or t.get('createdAt')
        s['writtenTestSentAt'] = s.get('writtenTestSentAt') or inv
        s['invitedAt'] = s.get('invitedAt') or inv
        s['lastReminderAt'] = t.get('lastReminderAt') or s.get('lastReminderAt') or inv
        if not s.get('company') and t.get('company'): s['company'] = t['company']
        if not s.get('jobtitle') and t.get('jobtitle'): s['jobtitle'] = t['jobtitle']
        s['mergedTwinIds'] = sorted(set((s.get('mergedTwinIds') or []) + [tid]))
        cs = [c for c in cs if c['id'] != tid]
        changed = True
        print('  twin folded: writtenTestSentAt =', s['writtenTestSentAt'], '| twin deleted')
    else:
        print('  twin already gone')

if errors:
    print('\nERRORS - NOTHING WRITTEN:'); [print('  -', e) for e in errors]; sys.exit(2)
if not changed:
    print('\nnothing to do'); sys.exit(0)
if DRY:
    print('\nDRY RUN - nothing written. records after would be:', len(cs)); sys.exit(0)

bak = DATA + '.bak_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '_needs_analysis'
shutil.copy2(DATA, bak)
json.dump(cs, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
# post-write verification
chk = {c['id']: c for c in json.load(open(DATA, encoding='utf-8'))}
for sid, tid in PAIRS.items():
    s = chk[sid]; na = s['needsAnalysis']
    for k, v in na['legacyOralData'].items():
        if k == 'intakeType' or blank(v): continue
        assert json.dumps(na[k], ensure_ascii=False, sort_keys=True) == json.dumps(v, ensure_ascii=False, sort_keys=True), 'POST-WRITE MISMATCH ' + sid + ' ' + k
    assert s['oralData'] is None and tid not in chk
print('\nWRITTEN. backup:', bak, '| records after:', len(cs), '| post-write verification OK')
