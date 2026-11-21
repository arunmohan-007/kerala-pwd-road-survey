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
        "Listed roads covered", "New roads added", "New roads completed")
KEYS = ("listed", "start", "intermediate", "end", "covered", "new", "newCompleted")


def stamp(value):
    return value[:19].replace("T", " ") + " IST"


def table(first, rows, total):
    values = [[first, *HEAD]]
    values += [[r["name"], *(f"{r[key]:,}" for key in KEYS)] for r in [*rows, total]]
    result = Table(values, colWidths=[156, 66, 66, 100, 65, 109, 94, 108], repeatRows=1)
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


def new_road_reports(report, footer, title, body):
    folder = HERE / "docs" / "new-road-pdfs"
    folder.mkdir(exist_ok=True)
    published = set()
    cell = ParagraphStyle("New road cell", parent=body, fontSize=9, leading=12)
    headings = ["Sl. No.", "Division / district", "Section", "Newly added road", "Point ID", "Status", "Remarks"]

    def write(key, area, roads):
        story = [Paragraph("New Roads Report", title), Paragraph(escape(area), body),
                 Paragraph(f"{len(roads)} added | {sum(road[4] == 'Completed' for road in roads)} completed"
                           f" | Verified through {stamp(report['sourceThrough'])}", body),
                 Spacer(1, 11)]
        if roads:
            rows = [headings]
            rows.extend([Paragraph(escape(str(value)), cell) for value in (i, *row)]
                        for i, row in enumerate(roads, 1))
            grid = Table(rows, colWidths=[46, 116, 102, 213, 145, 66, 76], repeatRows=1, splitInRow=1)
            grid.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story.append(grid)
        target = folder / f"{key}.pdf"
        temporary = target.with_suffix(".pdf.tmp")
        SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=32,
                          rightMargin=32, topMargin=32, bottomMargin=37,
                          title=f"New Roads Report - {area}").build(
                              story, onFirstPage=footer, onLaterPages=footer)
        temporary.replace(target)
        published.add(target)

    statewide = []
    for i, division in enumerate(report["divisions"], 1):
        division_roads = []
        for j, section in enumerate(division["sections"], 1):
            roads = [(division["name"], section["name"], road["name"],
                      ", ".join(road.get("pointIds", [])),
                      "Completed" if road["completed"] else "Incomplete", road["remarks"])
                     for road in section.get("newRoadList", []) if not road["inRegister"]]
            if roads:
                write(f"{i}-{j}", f'{division["name"]} / {section["name"]}', roads)
            division_roads.extend(roads)
        if division_roads:
            write(i, division["name"], division_roads)
        statewide.extend(division_roads)
    write("statewide", "Kerala", statewide)
    write("empty", "No new roads in the selected area", [])
    for stale in set(folder.glob("*.pdf")) - published:
        stale.unlink()


def section_reports(report, footer, title, body):
    folder = HERE / "docs" / "section-pdfs"
    folder.mkdir(exist_ok=True)
    published = set()
    cell = ParagraphStyle("Road details", parent=body, fontSize=9, leading=12)
    for division_index, division in enumerate(report["divisions"], 1):
        for section_index, section in enumerate(division["sections"], 1):
            story = [
                Paragraph(escape(division["name"]), body),
                Paragraph(escape(section["name"]), title),
                Paragraph("Road-wise report | Cloud verified " + stamp(division["verifiedAt"]), body),
                Paragraph(f'{section["new"]} new roads added | {section["newCompleted"]} completed', body),
                Spacer(1, 11),
            ]
            roads = section.get("roads", [])
            if roads:
                rows = [["Road name", "Start points", "End points", "Intermediate points", "Stretch limits"]]
                for road in roads:
                    row = [Paragraph(escape(road.get("name") or "Unnamed road"), cell)]
                    for key in ("start", "end", "intermediate", "stretch"):
                        points = road.get(key, [])
                        lines = [str(len(points)) if points else "-"]
                        lines.extend(escape(location) for location in points if location)
                        row.append(Paragraph("<br/>".join(lines), cell))
                    rows.append(row)
                details = Table(rows, colWidths=[184, 136, 136, 154, 154],
                                repeatRows=1, splitInRow=1)
                details.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(details)
            else:
                story.append(Paragraph("No road details available for this section.", body))
            target = folder / f"{division_index}-{section_index}.pdf"
            temporary = target.with_suffix(".pdf.tmp")
            SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=32,
                              rightMargin=32, topMargin=32, bottomMargin=37,
                              title=section["name"] + " - Road-wise report").build(
                                  story, onFirstPage=footer, onLaterPages=footer)
            temporary.replace(target)
            published.add(target)
    for stale in set(folder.glob("*.pdf")) - published:
        stale.unlink()


def main(source):
    report = json.loads(source.read_text(encoding="utf-8"))
    styles = getSampleStyleSheet()
    title = ParagraphStyle("Report title", parent=styles["Title"], alignment=0,
                           fontSize=25, leading=29, textColor=INK)
    body = styles["BodyText"]
    story = []

    def heading(text, detail):
        story.extend([Paragraph("KERALA PWD AND KHRI  |  ROAD NETWORK SURVEY", body),
                      Paragraph(escape(text), title), Paragraph(escape(detail), body),
                      Spacer(1, 11)])

    updated = "Last updated " + stamp(report["updatedAt"])
    heading("Kerala division summary", updated + "  |  " + report["mode"] +
            " through " + stamp(report["sourceThrough"]))
    story.append(table("Division", report["divisions"], report["total"]))
    story.extend([Spacer(1, 4), Paragraph(
        "Listed roads covered requires at least one Start and one End point matched to the same listed road. "
        "New roads added counts manually entered roads outside the register. "
        "A new road is completed once it has a start and an end point. "
        "Cloud snapshots exclude submissions that have yet to sync. "
        "Points recorded by RMMS Cell, RMMS Cell 2, or RMMS Cell 3 are excluded from this and future reports. "
        f'Unclassified points: {report["total"]["unknown"]:,}. '
        f'Road match or identity flags: {report["total"]["review"]:,}. '
        f'RMMS or trial points excluded: {report["total"]["excluded"]:,}.', body)])
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
    section_reports(report, footer, title, body)
    new_road_reports(report, footer, title, body)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
