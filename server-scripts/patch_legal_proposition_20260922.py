#!/usr/bin/env python3
"""LEGAL_PROPOSITION_20260922 - three fixes for the legal English flow.

1. routes/programme.js   LEGAL_RESUME_INTAKE_20260922
   generate-proposition fed the AI resume only validatedGoals/criteria (classic
   oral form). The legal intake form sends legalDomains/dominantSkills/blockers/
   priorityGaps/notes -> the AI wrote "informations insuffisantes" for every
   legal candidate. Now feeds the intake + prospect-questionnaire fields.
2. views/candidate.html  PARCOURS_EMAIL_20260922
   Step 6 e-mail ignored the two-module parcours (Budget 1650 + Etape 2
   facultative) while the PDF carried M1+M2. Email now reuses the parcours calc.
   Also lowercases the first letter of the AI resume after "Suite a notre echange,".
3. routes/candidates.js + views/new_legal.html  INTAKE_LINK_20260922
   Success screen after creating a legal candidate linked /oral/<oralToken>
   (generic form). Now generates intakeToken at creation and links
   /oral/intake/<intakeToken>.

Idempotent: each edit checks its marker and prints SKIP when already applied.
Exact string anchors; aborts with diagnostics if an anchor is missing.
"""
import os, sys, shutil, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAMP = time.strftime('%Y%m%d_%H%M%S')

def rd(p):
    with open(p, encoding='utf-8') as f: return f.read()
def wr(p, s):
    shutil.copy2(p, p + '.bak_' + STAMP)
    with open(p, 'w', encoding='utf-8') as f: f.write(s)

def apply(relpath, marker, edits):
    p = os.path.join(ROOT, relpath)
    s = rd(p)
    if marker in s:
        print('SKIP  %s (%s already applied)' % (relpath, marker)); return
    for old, new in edits:
        n = s.count(old)
        if n != 1:
            print('ABORT %s: anchor found %d times:\n---\n%s\n---' % (relpath, n, old[:300])); sys.exit(1)
        s = s.replace(old, new)
    wr(p, s)
    print('OK    %s (%s)' % (relpath, marker))

# ---------------------------------------------------------------- 1. programme.js
OLD1 = """    const goals = (od.validatedGoals || []).map(g => g.goal || g).join(', ');
    const criteria = (od.criteria || []).map(cr => typeof cr === 'object' ? (cr.comment || '') : cr).filter(Boolean).join('. ');
    const prompt = [
      'Tu es expert en formation professionnelle en anglais.',
      "R\\xe9dige 1 \\xe0 2 phrases courtes (max 40 mots total) qui r\\xe9sument les besoins et objectifs du candidat, \\xe0 partir des informations suivantes.",
      'Commence par \\u00ab\\u00a0j\\u2019ai bien not\\xe9\\u00a0\\u00bb ou expression similaire, en fran\\xe7ais.',
      'Ne mentionne pas de niveaux CECRL, pas de certifications, pas de pr\\xe9nom.',
      '',
      'Poste : ' + (c.jobtitle || 'non pr\\xe9cis\\xe9'),
      'Entreprise : ' + (c.company || 'non pr\\xe9cis\\xe9e'),
      'Objectifs valid\\xe9s : ' + (goals || 'non pr\\xe9cis\\xe9s'),
      'Observations \\xe9valuateur : ' + (criteria || 'non pr\\xe9cis\\xe9es'),
      '',
      'R\\xe9ponds uniquement avec les 1-2 phrases, sans pr\\xe9ambule ni ponctuation finale superflue.'
    ].join('\\n');"""
NEW1 = """    const goals = (od.validatedGoals || []).map(g => g.goal || g).join(', ');
    const criteria = (od.criteria || []).map(cr => typeof cr === 'object' ? (cr.comment || '') : cr).filter(Boolean).join('. ');
    /* LEGAL_RESUME_INTAKE_20260922: the legal intake form (oral_intake.html)
       never sends validatedGoals/criteria - it sends legalDomains,
       dominantSkills, blockers, priorityGaps, notes, usagePct, lawyerType -
       and the candidate record carries the prospect questionnaire (goals,
       legalDocs, currentUsage, upcomingEvent). Feeding only the classic
       fields made the AI write "informations insuffisantes" for every
       legal candidate. */
    const isLegalIntake = (od.intakeType === 'legal_intake') || (c.courseType === 'legal' && !goals && !criteria);
    const legalLines = isLegalIntake ? [
      'Profil : ' + (od.lawyerType || c.lawyerType || 'non pr\\xe9cis\\xe9'),
      'Domaines juridiques : ' + (od.legalDomains || c.legalDomains || 'non pr\\xe9cis\\xe9s'),
      'Documents r\\xe9dig\\xe9s : ' + (c.legalDocs || 'non pr\\xe9cis\\xe9s'),
      'Usage actuel de l\\u2019anglais : ' + (c.currentUsage || 'non pr\\xe9cis\\xe9') + (od.usagePct ? ' (' + od.usagePct + '% du temps)' : ''),
      'Comp\\xe9tences dominantes : ' + (od.dominantSkills || 'non pr\\xe9cis\\xe9es'),
      'Objectifs d\\xe9clar\\xe9s : ' + ((Array.isArray(c.goals) && c.goals.length) ? c.goals.join(', ') : (c.mainGoal || 'non pr\\xe9cis\\xe9s')),
      'Points bloquants : ' + (od.blockers || 'non pr\\xe9cis\\xe9s'),
      'Lacunes prioritaires : ' + (od.priorityGaps || 'non pr\\xe9cis\\xe9es'),
      'Ech\\xe9ance / \\xe9v\\xe9nement : ' + (c.upcomingEvent || 'aucun'),
      'Notes entretien : ' + (od.notes || 'aucune')
    ] : [
      'Objectifs valid\\xe9s : ' + (goals || 'non pr\\xe9cis\\xe9s'),
      'Observations \\xe9valuateur : ' + (criteria || 'non pr\\xe9cis\\xe9es')
    ];
    const prompt = [
      'Tu es expert en formation professionnelle en anglais.',
      "R\\xe9dige 1 \\xe0 2 phrases courtes (max 40 mots total) qui r\\xe9sument les besoins et objectifs du candidat, \\xe0 partir des informations suivantes.",
      'Commence par \\u00ab\\u00a0j\\u2019ai bien not\\xe9\\u00a0\\u00bb ou expression similaire, en fran\\xe7ais.',
      'Ne mentionne pas de niveaux CECRL, pas de certifications, pas de pr\\xe9nom.',
      'Ne dis jamais que les informations sont insuffisantes : r\\xe9sume ce qui est fourni.',
      '',
      'Poste : ' + (c.jobtitle || 'non pr\\xe9cis\\xe9'),
      'Entreprise : ' + (c.company || 'non pr\\xe9cis\\xe9e')
    ].concat(legalLines).concat([
      '',
      'R\\xe9ponds uniquement avec les 1-2 phrases, sans pr\\xe9ambule ni ponctuation finale superflue.'
    ]).join('\\n');"""
apply('routes/programme.js', 'LEGAL_RESUME_INTAKE_20260922', [(OLD1, NEW1)])

# ---------------------------------------------------------------- 2. candidate.html
OLD2a = """function renderParcours(d) {
  var calc = d.calc, st = d.stored || {};"""
NEW2a = """function renderParcours(d) {
  var calc = d.calc, st = d.stored || {};
  window.__parcoursData = d; /* PARCOURS_EMAIL_20260922: shared with buildEmailBody */"""
OLD2b = """    // Assemble
    var parts = [greeting, '', opening, '', formationBlock, '', coachDesc, '', contextLine];"""
NEW2b = """    /* PARCOURS_EMAIL_20260922: when the two-module parcours is enabled the
       proposition PDF already carries the M1 + M2 breakdown (lib/parcours.js
       describe()). The e-mail kept saying "Budget 1650" + "Etape 2
       (facultative)", contradicting the PDF. Reuse the same lines here. */
    var pcd = window.__parcoursData;
    var pcOn = !!(pcd && pcd.calc && pcd.calc.enabled && !thirdParty);
    if (pcOn) {
      var pc = pcd.calc, m1 = pc.modules[0], m2 = pc.modules[1], tt = pc.totals;
      formationBlock = '**Parcours CAJA en deux modules \\u2014 convention globale sur ' + pc.maxMonths + ' mois**\\n'
        + '\\u2013 Module 1\\u00a0: ' + m1.title + ' \\u2014 ' + m1.totalHours + ' heures (' + m1.coachingHours + ' h de coaching individuel' + (m1.homeworkHours ? ' + ' + m1.homeworkHours + ' h de travail guid\\xe9' : '') + ')\\n'
        + '\\u2013 Module 2\\u00a0: ' + m2.title + ' \\u2014 ' + m2.totalHours + ' heures (' + m2.coachingHours + ' h de coaching individuel' + (m2.homeworkHours ? ' + ' + m2.homeworkHours + ' h de travail guid\\xe9' : '') + ')\\n'
        + 'Chaque s\\xe9ance de coaching se d\\xe9roule en visioconf\\xe9rence avec ' + formateur + '.';
      budgetBlock = '**Budget du parcours\\u00a0: ' + pcEur(tt.price) + '**\\n'
        + '\\u2013 Module 1\\u00a0: ' + pcEur(m1.price) + (m1.route === 'CPF' ? ' (dont ' + pcEur(m1.cpfPart) + ' financ\\xe9s via le CPF)' : ' (r\\xe8glement direct en ' + m1.instalments + ' \\xe9ch\\xe9ances)') + '\\n'
        + '\\u2013 Module 2\\u00a0: ' + pcEur(m2.price) + (m2.route === 'CPF' ? ' (dont ' + pcEur(m2.cpfPart) + ' financ\\xe9s via le CPF)' : ' (r\\xe8glement direct en ' + m2.instalments + ' \\xe9ch\\xe9ances)') + '\\n'
        + '\\u2013 Reste \\xe0 votre charge sur l\\u2019ensemble du parcours\\u00a0: ' + pcEur(tt.learner) + (tt.forfait ? ' (participation forfaitaire de 150\\u00a0\\u20ac par module inscrit au CPF incluse)' : '')
        + (pc.direct && pc.direct.saving > 0 ? '\\n\\n\\xc0 titre de comparaison, les m\\xeames ' + tt.coachingHours + ' heures de coaching achet\\xe9es directement, hors certification, co\\xfbteraient ' + pcEur(pc.direct.comparator) + '\\u00a0: le parcours vous fait \\xe9conomiser ' + pcEur(pc.direct.saving) + ' et inclut deux certifications.' : '');
      etape2 = '**Deux certifications, une seule convention**\\n\\n'
        + '\\xc0 l\\u2019issue du Module 1, vous disposerez de l\\u2019attestation de niveau B2 requise comme pr\\xe9requis \\xe0 la certification \\u00ab\\u00a0CAJA \\u2013 Communiquer en anglais juridique des affaires\\u00a0\\u00bb (RS6810), que vous pr\\xe9parerez et passerez dans le cadre du Module 2. Les deux modules font l\\u2019objet d\\u2019une convention globale unique\\u00a0; l\\u2019inscription CPF ci-dessous concerne le Module 1, l\\u2019inscription du Module 2 se fera \\xe0 l\\u2019issue du premier.';
    }

    // Assemble
    var parts = [greeting, '', opening, '', formationBlock, '', coachDesc, '', contextLine];"""
OLD2c = """      : 'Suite \\xe0 notre \\xe9change, ' + resumeLine + 'Vous trouverez"""
NEW2c = """      : 'Suite \\xe0 notre \\xe9change, ' + (resumeLine ? resumeLine.charAt(0).toLowerCase() + resumeLine.slice(1) : '') + 'Vous trouverez"""
apply('views/candidate.html', 'PARCOURS_EMAIL_20260922', [(OLD2a, NEW2a), (OLD2b, NEW2b), (OLD2c, NEW2c)])

# ---------------------------------------------------------------- 3. candidates.js + new_legal.html
OLD3a = """      oralToken:       generateId(),
      createdAt:       new Date().toISOString()
    };

    candidates.push(candidate);
    saveCandidates(candidates);
    res.json({ success: true, id: candidate.id, candidateId: candidate.id, oralToken: candidate.oralToken });"""
NEW3a = """      oralToken:       generateId(),
      /* INTAKE_LINK_20260922: legal candidates are interviewed through
         /oral/intake/:intakeToken (oral_intake.html), not /oral/:oralToken.
         Generate the token here so the success screen can show the right link
         (same format as /api/send-intake-link, which reuses it). */
      intakeToken:     require('crypto').randomBytes(8).toString('hex'),
      createdAt:       new Date().toISOString()
    };

    candidates.push(candidate);
    saveCandidates(candidates);
    res.json({ success: true, id: candidate.id, candidateId: candidate.id, oralToken: candidate.oralToken, intakeToken: candidate.intakeToken });"""
apply('routes/candidates.js', 'INTAKE_LINK_20260922', [(OLD3a, NEW3a)])

OLD3b = "const oralUrl = `${window.location.origin}/oral/${data.oralToken}`;"
NEW3b = "const oralUrl = `${window.location.origin}/oral/intake/${data.intakeToken}`; /* INTAKE_LINK_20260922 */"
apply('views/new_legal.html', 'INTAKE_LINK_20260922', [(OLD3b, NEW3b)])

print('DONE')
