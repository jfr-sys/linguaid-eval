#!/usr/bin/env python3
# Attestation de fin de formation (Art. L.6353-1 du Code du travail)
# Generated automatically after the stagiaire signs the attestation de réalisation.
import json, sys, os
from datetime import datetime
from fpdf import FPDF

data = json.load(open(sys.argv[1]))

name = str(data['name'] or '')
company = str(data.get('company', '') or '')
jobtitle = str(data.get('jobtitle', '') or '')
training_title = str(data.get('trainingTitle', '') or '')
date_start = str(data.get('dateStart', '') or '')
date_end = str(data.get('dateEnd', '') or '')
duration_total = data.get('durationTotal', 18)
pdf_path = data['pdfPath']

def fmt_date_fr(d):
    if not d: return ''
    try:
        return datetime.fromisoformat(d).strftime('%d/%m/%Y')
    except Exception:
        return d

try:
    issued = datetime.fromisoformat(str(data.get('signedAt', '')).replace('Z', ''))
except Exception:
    issued = datetime.now()
issued_str = issued.strftime('%d/%m/%Y')

header_img = '/home/debian/linguaid_logo_header.png'
languexpert_img = '/home/debian/languexpert_logo.png'
stamp_img = '/home/debian/linguaid_stamp.jpeg'

def find_font(fname):
    import subprocess
    r = subprocess.run(['find', '/usr/share/fonts', '-name', f'*{fname}*', '-type', 'f'],
                       capture_output=True, text=True)
    lines = [l for l in r.stdout.strip().split('\n') if l and '.ttf' in l.lower()]
    return lines[0] if lines else None

font_regular = find_font('DejaVuSans.ttf') or find_font('DejaVuSans-Regular')
font_bold = find_font('DejaVuSans-Bold')

class PDF(FPDF):
    def header(self):
        if os.path.exists(header_img):
            self.image(header_img, x=10, y=6, w=52)
        # LangueXpert logo removed (2026-07-31)
        self.set_y(30)
        self.ln(4)

    def footer(self):
        self.set_y(-28)
        self.set_draw_color(31, 78, 121)
        self.set_line_width(0.3)
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(3)
        self.set_font('DejaVu', '', 7.5)
        self.set_text_color(100, 100, 100)
        self.cell(0, 4, 'Linguaid France SAS  |  2 rue Hergé, 66750 Saint Cyprien  |  T: 04 68 88 49 91  |  E: certification@linguaid.net', new_x='LMARGIN', new_y='NEXT', align='C')
        self.cell(0, 4, 'RCS Perpignan B 539 682 187  |  NAF : 8559A  |  O.F. déclaré sous le numéro : 91 66 01 620 66', new_x='LMARGIN', new_y='NEXT', align='C')
        self.cell(0, 4, "Cet enregistrement ne vaut pas agrément de l'État", new_x='LMARGIN', new_y='NEXT', align='C')

pdf = PDF()
pdf.set_margins(15, 15, 15)
if font_regular:
    pdf.add_font('DejaVu', '', font_regular)
if font_bold:
    pdf.add_font('DejaVu', 'B', font_bold)
F = 'DejaVu' if font_regular else 'Helvetica'

pdf.add_page()
pdf.ln(2)

# Title
pdf.set_font(F, 'B', 18)
pdf.set_text_color(31, 78, 121)
pdf.cell(0, 10, 'ATTESTATION DE FIN DE FORMATION', new_x='LMARGIN', new_y='NEXT', align='C')
pdf.set_font(F, '', 10)
pdf.set_text_color(100, 100, 100)
pdf.cell(0, 6, 'Délivrée en application de l\u2019article L.6353-1 du Code du travail', new_x='LMARGIN', new_y='NEXT', align='C')
pdf.ln(4)

# Intro
pdf.set_font(F, '', 12)
pdf.set_text_color(40, 40, 40)
intro = (
    "Je, soussigné Joss Frimond, en qualité de Président de l'organisme "
    "de formation LINGUAID France SAS, enregistré sous le numéro d'organisme 91 66 01 620 66 "
    "auprès de la DREETS de Languedoc-Roussillon, atteste que :"
)
pdf.multi_cell(0, 6, intro, new_x='LMARGIN', new_y='NEXT')
pdf.ln(3)

# Stagiaire
pdf.set_font(F, 'B', 15)
pdf.set_text_color(31, 78, 121)
pdf.cell(0, 8, name, new_x='LMARGIN', new_y='NEXT', align='C')
if jobtitle or company:
    pdf.set_font(F, '', 11)
    pdf.set_text_color(80, 80, 80)
    line2 = ' – '.join(filter(None, [jobtitle, company]))
    pdf.cell(0, 6, line2, new_x='LMARGIN', new_y='NEXT', align='C')
pdf.ln(3)

pdf.set_font(F, '', 12)
pdf.set_text_color(40, 40, 40)
pdf.cell(0, 7, "a suivi l'action de formation suivante :", new_x='LMARGIN', new_y='NEXT', align='C')
pdf.ln(3)
pdf.set_font(F, 'B', 13)
pdf.set_text_color(31, 78, 121)
pdf.cell(0, 8, training_title, new_x='LMARGIN', new_y='NEXT', align='C')
pdf.ln(3)

# Details block
pdf.set_font(F, '', 11)
pdf.set_text_color(40, 40, 40)
rows = [
    ("Nature de l'action", "Action de formation (art. L.6313-1 du Code du travail)"),
    ("Période", f"du {fmt_date_fr(date_start)} au {fmt_date_fr(date_end)}"),
    ("Durée totale", f"{duration_total} heures"),
    ("Objectifs", "Concevoir, animer et évaluer des dispositifs de formation linguistique "
                  "innovants, en mobilisant les compétences suivantes : 1. Concevoir des parcours "
                  "de formation sur mesure avec l'IA et les outils numériques – 2. Créer des "
                  "contenus multimédias accessibles et engageants – 3. Animer des activités "
                  "collaboratives à distance – 4. Conduire des formations actives et "
                  "adaptatives – 5. Évaluer de façon intelligente et personnalisée – "
                  "6. Assurer une veille continue pour rester à la pointe de l'innovation."),
    ("Résultats de l'évaluation des acquis",
     "Les acquis de la formation ont fait l'objet d'une évaluation formative continue tout au "
     "long de la formation, puis d'une évaluation finale des compétences dans le cadre des "
     "épreuves de la certification « Former de manière innovante en langues vivantes » "
     "(dossier professionnel et entretien avec un jury)."),
]
for label, value in rows:
    pdf.set_font(F, 'B', 10)
    pdf.set_text_color(31, 78, 121)
    pdf.multi_cell(0, 5.5, label, new_x='LMARGIN', new_y='NEXT')
    pdf.set_font(F, '', 10)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 4.8, value, new_x='LMARGIN', new_y='NEXT')
    pdf.ln(1)

pdf.ln(2)
pdf.set_draw_color(200, 200, 200)
pdf.set_line_width(0.3)
pdf.line(15, pdf.get_y(), 195, pdf.get_y())
pdf.ln(4)

# Signature block — issuer only (this document is delivered by the OF, not co-signed)
sig_y = pdf.get_y()
pdf.set_xy(15, sig_y)
pdf.set_font(F, '', 10)
pdf.set_text_color(60, 60, 60)
pdf.cell(85, 5, f'Fait à Saint-Cyprien, le {issued_str}', new_x='LMARGIN', new_y='NEXT')
pdf.set_x(15)
pdf.cell(85, 5, 'Pour Linguaid France SAS', new_x='LMARGIN', new_y='NEXT')
pdf.set_x(15)
pdf.cell(85, 5, 'Joss Frimond', new_x='LMARGIN', new_y='NEXT')
pdf.set_x(15)
pdf.cell(85, 5, 'Président', new_x='LMARGIN', new_y='NEXT')
if os.path.exists(stamp_img):
    pdf.image(stamp_img, x=15, y=sig_y + 22, w=48)

pdf.output(pdf_path)
print('OK: ' + pdf_path)
