"""Build survey reports from one complete verified QFieldCloud batch."""
import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKUPS = HERE.parent / "Daily Backups"
IST = timezone(timedelta(hours=5, minutes=30))
METRICS = ("listed", "start", "intermediate", "end", "covered", "new", "unknown", "review", "excluded")
TYPES = {"start", "intermediate", "end"}
STRETCH_LIMIT = re.compile(r"\b(?:start|end)\s+(?:point\s+)?of\s+stretch\b")
RMMS_COLLECTORS = {"rmmscell", "rmmscell2", "rmmscell3"}
# Varkala trial point identified by the report owner on 9 November 2026.
TRIAL_POINTS = {"b7761e13f1eb27a85d1526f2bb885a080ff747530e7e51de22c9d441bb456e75"}


def normalized(value):
    return " ".join(str(value or "").casefold().split())


def section_key(value):
    return re.sub(r"^roads section\s*,?\s*", "", normalized(value))


def label(value):
    return re.sub(r"^Roads Section\s*,?\s*", "", str(value or "").strip(),
                  flags=re.IGNORECASE) or "Unassigned section"


def row(name):
    return {"name": name, **dict.fromkeys(METRICS, 0)}


def total(name, rows):
    return {"name": name, **{key: sum(r[key] for r in rows) for key in METRICS}}


def division(manifest_path, name):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    layers = manifest["survey_point_counts"]
    if manifest["project"] != name or len(layers) != 1:
        raise ValueError(f"Unexpected survey sources for {name}")
    filename, expected = next(iter(layers.items()))
    data = manifest_path.parent / "Project" / filename
    record = next(record for record in manifest["files"] if record["name"] == filename)
    algorithm = "sha256" if record["sha256"] else "md5"
    with data.open("rb") as source:
        checksum = hashlib.file_digest(source, algorithm).hexdigest()
    if checksum != record["sha256" if algorithm == "sha256" else "md5sum"]:
        raise ValueError(f"Snapshot checksum failed for {name}")

    sections = {}
    register = defaultdict(list)
    endpoints = defaultdict(lambda: defaultdict(set))
    added = defaultdict(set)
    review = defaultdict(set)
    invalid = defaultdict(int)
    roads = defaultdict(dict)

    with closing(sqlite3.connect(data.as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        for (section,) in db.execute("SELECT PWD_Section FROM PWD_Sections"):
            key = section_key(section)
            if key and key != "unassigned pwd section":
                sections.setdefault(key, row(label(section)))
        for fid, section, road, road_class, number in db.execute(
            "SELECT fid,PWD_Section,Road_Name,Road_Class,Road_NUMBER FROM Road_Register"
        ):
            key = section_key(section)
            sections.setdefault(key, row(label(section)))["listed"] += 1
            roads[key][fid] = {"name": str(road or "").strip()}
            if key and normalized(road):
                register[key, normalized(road)].append((fid, normalized(road_class), normalized(number)))

        for point_id, section, road, selection, road_class, number, point_type, username, location, remarks in db.execute(
            "SELECT Point_ID,PWD_Section,Road_Name,Road_Selection,Road_Class,Road_NUMBER,Point_Type,Username,"
            "Location_Name,Remarks FROM Survey_Points ORDER BY fid"
        ):
            key = section_key(section)
            section_row = sections.setdefault(key, row(label(section)))
            fingerprint = hashlib.sha256(
                json.dumps([name, point_id, section, road, point_type], ensure_ascii=False).encode("utf-8")
            ).hexdigest()
            collector = re.sub(r"[\s_-]+", "", normalized(username))
            if collector in RMMS_COLLECTORS or fingerprint in TRIAL_POINTS:
                section_row["excluded"] += 1
                continue
            point_type = normalized(point_type)
            section_row[point_type if point_type in TYPES else "unknown"] += 1
            selected = normalized(selection)
            display_name = str(road or "").strip() or str(selection or "").strip()
            road, road_class, number = normalized(road) or selected, normalized(road_class), normalized(number)
            if not (key and road and road_class) or (road_class == "sh" and not number):
                invalid[key] += 1
                continue
            identity = (road, road_class, number if road_class == "sh" else "")
            candidates = register[key, road]
            matches = [fid for fid, cls, num in candidates
                       if (not cls or cls == road_class)
                       and (road_class != "sh" or not num or num == number)]
            if len(matches) == 1 and (not selected or selected == road):
                endpoints[key][matches[0], identity].add(point_type)
                road_row = roads[key][matches[0]]
            elif not candidates and not selected:
                added[key].add(identity)
                road_row = roads[key].setdefault(identity, {"name": display_name})
            else:
                review[key].add(identity)
                road_row = roads[key].setdefault(identity, {"name": display_name})
            if point_type in TYPES:
                column = point_type
                point_label = str(location or "").strip()
                if point_type == "intermediate" and STRETCH_LIMIT.search(normalized(remarks)):
                    column = "stretch"
                    point_label = " · ".join(filter(None, (point_label, str(remarks).strip())))
                road_row.setdefault(column, []).append(point_label)

    for key, section in sections.items():
        section["covered"] = len({fid for (fid, _), types in endpoints[key].items()
                                  if {"start", "end"} <= types})
        section["new"] = len(added[key] - review[key])
        section["review"] = len(review[key]) + invalid[key]
        for identity in added[key] - review[key]:
            roads[key][identity]["name"] += " (New)"
        section["roads"] = sorted(roads[key].values(), key=lambda road: road["name"].casefold())
    rows = sorted(sections.values(), key=lambda item: item["name"].casefold())
    result = total(name, rows)
    if sum(result[key] for key in TYPES | {"unknown", "excluded"}) != expected:
        raise ValueError(f"Snapshot point count did not reconcile for {name}")
    return {**result, "verifiedAt": manifest["verified_at"], "sections": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", help="Use this existing verified backup batch. Default downloads all 15.")
    args = parser.parse_args()
    config = json.loads((BACKUPS / "projects.json").read_text(encoding="utf-8-sig"))
    names = sorted(entry["project"] for entry in config)
    if len(set(names)) != 15:
        raise ValueError("Expected exactly 15 distinct configured projects")
    existing = set((BACKUPS / names[0]).glob("*/manifest.json"))
    if args.snapshot:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}_\d{6}_\d{6}", args.snapshot):
            parser.error("Supply a verified backup batch folder name")
        batch = args.snapshot
    else:
        subprocess.run([sys.executable, str(BACKUPS / "download.py")], check=True)
        new = set((BACKUPS / names[0]).glob("*/manifest.json")) - existing
        if len(new) != 1:
            raise ValueError("Could not isolate one newly downloaded batch")
        batch = new.pop().parent.name

    divisions = [division(BACKUPS / name / batch / "manifest.json", name) for name in names]
    result = {"updatedAt": datetime.now(IST).isoformat(timespec="seconds"),
              "sourceFrom": min(d["verifiedAt"] for d in divisions),
              "sourceThrough": max(d["verifiedAt"] for d in divisions),
              "mode": "Verified backup" if args.snapshot else "Cloud refresh",
              "total": total("Kerala total", divisions), "divisions": divisions}
    pending = HERE / "docs" / "report.json.tmp"
    pending.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    try:
        subprocess.run(["node", str(HERE / "export.mjs"), str(pending)], check=True)
        subprocess.run([sys.executable, str(HERE / "pdf_export.py"), str(pending)], check=True)
        pending.replace(HERE / "docs" / "report.json")
    finally:
        pending.unlink(missing_ok=True)
    print(f"Dashboard built from {len(divisions)} projects in {batch}")


if __name__ == "__main__":
    main()
