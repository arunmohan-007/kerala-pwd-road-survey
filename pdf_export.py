"""Create a downloadable report with a statewide summary and section detail."""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

HERE = Path(__file__).resolve().parent
INK = colors.HexColor("#103830")
GREEN = colors.HexColor("#176447")
LIGHT = colors.HexColor("#EAF5EE")
HEAD = ("Roads in list", "Start points", "Intermediate points", "End points",
        "Listed roads covered", "New roads")
KEYS = ("listed", "start", "intermediate", "end", "covered", "new")


def stamp(value):
    return value[:19].replace("T", " ") + " IST"


def table(first, rows, total):
    values = [[first, *HEAD]]
    values += [[r["name"], *(f"{r[key]:,}" for key in KEYS)] for r in [*rows, total]]
    result = Table(values, colWidths=[204, 78, 77, 102, 69, 113, 66], repeatRows=1)
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT]),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#D6EFE1")),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return result


def main(source):
    report = json.loads(source.read_text(encoding="utf-8"))
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Report title", parent=styles["Title"], alignment=0,
                           fontSize=25, leading=29, textColor=INK)
    body = styles["BodyText"]
    story = []

    def heading(text, detail):
        story.extend([Paragraph("KERALA PWD &amp; KHRI  |  ROAD NETWORK SURVEY", body),
                      Paragraph(escape(text), title), Paragraph(escape(detail), body),
                      Spacer(1, 11)])

    updated = "Last updated " + stamp(report["updatedAt"])
    heading("Kerala division summary", updated + "  |  " + report["mode"] +
            " through " + stamp(report["sourceThrough"]))
    story.append(table("Division", report["divisions"], report["total"]))
    story.extend([Spacer(1, 13), Paragraph(
        "Listed roads covered requires at least one Start and one End point matched to the same listed road. "
        "New roads counts distinct manually entered road identities absent from the register. "
        "Cloud snapshots exclude submissions that have yet to sync.", body)])
    story.append(Paragraph(
        f'Unclassified points: {report["total"]["unknown"]:,}. '
        f'Road match or identity flags: {report["total"]["review"]:,}. '
        f'Trial points excluded: {report["total"]["excluded"]:,}.', body))
    for division in report["divisions"]:
        story.append(PageBreak())
        heading(division["name"] + " - PWD section report", updated + "  |  Cloud verified " +
                stamp(division["verifiedAt"]))
        story.append(table("PWD section", division["sections"],
                           {**division, "name": "Division total"}))

    def footer(canvas, doc):
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica", 9)
        canvas.drawString(39, 23, "Kerala Public Works Department  /  Kerala Highway Research Institute")
        canvas.drawRightString(doc.pagesize[0] - 39, 23, str(doc.page))

    target = HERE / "docs" / "road-survey.pdf"
    temporary = target.with_suffix(".pdf.tmp")
    SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=32,
                      rightMargin=32, topMargin=32, bottomMargin=37,
                      title="Kerala PWD and KHRI - Road Network Survey").build(
                          story, onFirstPage=footer, onLaterPages=footer)
    temporary.replace(target)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
