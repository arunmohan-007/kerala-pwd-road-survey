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


def road_deletion_report(report):
    entries = report.get("roadDeletions", [])
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    rows = [["No.", "Division / district", "PWD section", "Road removed", "Verified"]]
    rows.extend([[str(index), *(Paragraph(escape(entry[field]), body)
                                for field in ("division", "section", "road", "verified"))]
                 for index, entry in enumerate(entries, 1)])
    listing = Table(rows, colWidths=[32, 130, 125, 325, 115], repeatRows=1)
    listing.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    target = HERE / "docs" / "road-deletion-report.pdf"
    temporary = target.with_suffix(".pdf.tmp")
    SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=36,
                      rightMargin=36, title="Road Deletion Report").build([
        Paragraph("Road Deletion Report", styles["Title"]),
        Paragraph(f"{len(entries)} road register removals", body),
        Spacer(1, 10),
        listing,
    ])
    temporary.replace(target)


def new_road_reports(report, footer, title, body, *, incomplete_only=False):
    folder = HERE / "docs" / ("incomplete-new-road-pdfs" if incomplete_only else "new-road-pdfs")
    report_title = "Incomplete New Roads Report" if incomplete_only else "New Roads Report"
    folder.mkdir(exist_ok=True)
    published = set()
    cell = ParagraphStyle("New road cell", parent=body, fontSize=9, leading=12)
    headings = ["Sl. No.", "Division / district", "Section", "Newly added road", "Point ID", "Status", "Remarks"]

    def write(key, area, roads):
        summary = (f"{len(roads)} incomplete" if incomplete_only else
                   f"{len(roads)} added | {sum(road[4] == 'Completed' for road in roads)} completed")
        story = [Paragraph(report_title, title), Paragraph(escape(area), body),
                 Paragraph(f"{summary} | Verified through {stamp(report['sourceThrough'])}", body),
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
                          title=f"{report_title} - {area}").build(
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
                     for road in section.get("newRoadList", [])
                     if not road["inRegister"] and (not incomplete_only or not road["completed"])]
            if roads:
                write(f"{i}-{j}", f'{division["name"]} / {section["name"]}', roads)
            division_roads.extend(roads)
        if division_roads:
            write(i, division["name"], division_roads)
        statewide.extend(division_roads)
    write("statewide", "Kerala", statewide)
    empty = "No incomplete new roads" if incomplete_only else "No new roads"
    write("empty", f"{empty} in the selected area", [])
    for stale in set(folder.glob("*.pdf")) - published:
        stale.unlink()


def incomplete_survey_reports(report):
    folder = HERE / "docs" / "incomplete-survey-pdfs"
    folder.mkdir(exist_ok=True)
    published = set()
    styles = getSampleStyleSheet()
    body = styles["BodyText"]

    def write(key, area, entries):
        road_label = "road" if len(entries) == 1 else "roads"
        story = [
            Paragraph("Incomplete Surveys", styles["Title"]),
            Paragraph(escape(area), body),
            Paragraph(f"{len(entries)} {road_label} | Verified through {stamp(report['sourceThrough'])}", body),
            Spacer(1, 12),
        ]
        rows = [["Road", "Division / district", "PWD section", "Missing points"]]
        rows.extend([Paragraph(escape(value), body) for value in entry] for entry in entries)
        grid = Table(rows, colWidths=[295, 156, 140, 153], repeatRows=1)
        grid.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), GREEN),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(grid)
        target = folder / f"{key}.pdf"
        temporary = target.with_suffix(".pdf.tmp")
        SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=36,
                          rightMargin=36, topMargin=32, bottomMargin=36,
                          title=f"Incomplete Surveys - {area}").build(story)
        temporary.replace(target)
        published.add(target)

    statewide = []
    by_section = {}
    for i, division in enumerate(report["divisions"], 1):
        division_entries = []
        for j, section in enumerate(division["sections"], 1):
            section_entries = []
            for road in section.get("roads", []):
                start, end = bool(road.get("start")), bool(road.get("end"))
                if start and end:
                    continue
                missing = "End missing" if start else "Start missing" if end else "Start and end missing"
                section_entries.append((road["name"] or "Unnamed road", division["name"],
                                        section["name"], missing))
            if section_entries:
                write(f"{i}-{j}", f'{division["name"]} / {section["name"]}', section_entries)
            by_section.setdefault(section["name"], []).extend(section_entries)
            division_entries.extend(section_entries)
        if division_entries:
            write(i, division["name"], division_entries)
        statewide.extend(division_entries)
    for i, (name, entries) in enumerate(by_section.items(), 1):
        if entries:
            write(f"section-{i}", name, entries)
    write("statewide", "Kerala", statewide)
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
                rows = [["Road name", "Start points", "End points", "Intermediate points", "Stretch limits", "Remarks"]]
                for road in roads:
                    row = [Paragraph(escape(road.get("name") or "Unnamed road"), cell)]
                    for key in ("start", "end", "intermediate", "stretch"):
                        points = road.get(key, [])
                        lines = [str(len(points)) if points else "-"]
                        lines.extend(escape(location) for location in points if location)
                        row.append(Paragraph("<br/>".join(lines), cell))
                    row.append(Paragraph(escape(road.get("remarks", "")), cell))
                    rows.append(row)
                details = Table(rows, colWidths=[150, 113, 113, 133, 133, 122],
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


def area_reports(report, footer, title, body):
    """Write standalone division and PWD section summaries."""
    division_folder = HERE / "docs" / "division-pdfs"
    section_folder = HERE / "docs" / "section-summary-pdfs"
    for folder in (division_folder, section_folder):
        folder.mkdir(exist_ok=True)
    published = set()

    def write(target, name, scope, verified, totals, rows, first_heading):
        coverage = (f'{totals["covered"] / totals["listed"]:.1%}'
                    if totals["listed"] else "No listed roads")
        story = [
            Paragraph(escape(scope), body),
            Paragraph(escape(name), title),
            Paragraph("Cloud verified " + stamp(verified), body),
            Spacer(1, 10),
            Paragraph(
                f'<b>Road completion:</b> {coverage} | {totals["covered"]:,} of '
                f'{totals["listed"]:,} listed roads have matched start and end points.', body),
            Spacer(1, 10),
            table(first_heading, [
                {**row, "name": Paragraph(escape(row["name"]), body)} for row in rows
            ], totals),
        ]
        temporary = target.with_suffix(".pdf.tmp")
        SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=32,
                          rightMargin=32, topMargin=32, bottomMargin=37,
                          title=f"{name} - {scope}").build(
                              story, onFirstPage=footer, onLaterPages=footer)
        temporary.replace(target)
        published.add(target)

    for i, division in enumerate(report["divisions"], 1):
        write(division_folder / f"{i}.pdf", division["name"], "Division survey summary",
              division["verifiedAt"], {**division, "name": "Division total"},
              division["sections"], "PWD section")
        for j, section in enumerate(division["sections"], 1):
            write(section_folder / f"{i}-{j}.pdf", section["name"],
                  "PWD section summary | " + division["name"], division["verifiedAt"],
                  {**section, "name": "Section total"}, [], "Survey counts")

    for folder in (division_folder, section_folder):
        for stale in set(folder.glob("*.pdf")) - published:
            stale.unlink()


def below_95_section_report(report, footer, title, body):
    sections = [(division["name"], section)
                for division in report["divisions"] for section in division["sections"]
                if section["listed"] > 0 and section["covered"] * 100 < section["listed"] * 95]
    sections.sort(key=lambda entry: (entry[1]["covered"] / entry[1]["listed"],
                                     entry[0].casefold(), entry[1]["name"].casefold()))
    heading = "PWD Sections Below 95% Completion"
    story = [
        Paragraph(heading, title),
        Paragraph(f"{len(sections)} sections statewide | Verified through {stamp(report['sourceThrough'])}", body),
        Paragraph("Road completion is the share of listed roads with matched start and end points.", body),
        Spacer(1, 12),
    ]
    if sections:
        rows = [["Rank", "Division / district", "PWD section", "Completion",
                 "Listed roads", "Roads covered", "Roads remaining"]]
        for rank, (division, section) in enumerate(sections, 1):
            listed, covered = section["listed"], section["covered"]
            rows.append([
                rank, Paragraph(escape(division), body), Paragraph(escape(section["name"]), body),
                f"{covered / listed:.1%}", f"{listed:,}", f"{covered:,}", f"{listed - covered:,}",
            ])
        grid = Table(rows, colWidths=[50, 156, 181, 88, 91, 97, 96], repeatRows=1)
        grid.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), GREEN),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("ALIGN", (3, 1), (-1, -1), "RIGHT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(grid)
    else:
        story.append(Paragraph("No PWD sections with listed roads are below 95% completion.", body))
    target = HERE / "docs" / "pwd-sections-below-95-percent.pdf"
    temporary = target.with_suffix(".pdf.tmp")
    SimpleDocTemplate(str(temporary), pagesize=landscape(A4), leftMargin=32, rightMargin=32,
                      topMargin=32, bottomMargin=37, title=heading).build(
                          story, onFirstPage=footer, onLaterPages=footer)
    temporary.replace(target)


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
    below_95_section_report(report, footer, title, body)
    area_reports(report, footer, title, body)
    section_reports(report, footer, title, body)
    new_road_reports(report, footer, title, body)
    new_road_reports(report, footer, title, body, incomplete_only=True)
    road_deletion_report(report)
    incomplete_survey_reports(report)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
