import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const report = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const workbook = Workbook.create();
const headers = ["Roads in list", "Start points", "Intermediate points", "End points", "Listed roads covered", "New roads", "Unclassified points", "Review flags"];
const keys = ["listed", "start", "intermediate", "end", "covered", "new", "unknown", "review"];
const numbers = row => keys.map(key => row[key]);
const stamp = time => time.slice(0, 19).replace("T", " ") + " IST";

function sheet(name, headings, data, widths, totalRow = false) {
  const ws = workbook.worksheets.add(name);
  const last = String.fromCharCode(64 + headings.length);
  const title = ws.getRange("A1:" + last + "1");
  title.merge();
  ws.getRange("A1").values = [["Kerala PWD × KHRI  |  Road Network Survey"]];
  title.format.fill = "#103830";
  title.format.font = {color: "#FFFFFF", bold: true, size: 17};
  title.format.rowHeight = 33;
  ws.getRange("A2:" + last + "2").merge();
  ws.getRange("A2").values = [["Last updated " + stamp(report.updatedAt) + "  •  " + report.mode + " through " + stamp(report.sourceThrough)]];
  ws.getRange("A3:" + last + "3").merge();
  ws.getRange("A3").values = [["Coverage requires a Start and an End point matched to the same listed road. New roads are distinct manual entries outside the register."]];
  const head = ws.getRange("A5:" + last + "5");
  head.values = [headings];
  head.format.fill = "#176447";
  head.format.font = {color: "#FFFFFF", bold: true};
  head.format.rowHeight = 25;
  ws.getRange("A6:" + last + (data.length + 5)).values = data;
  data.forEach((_, index) => {
    const current = ws.getRange("A" + (index + 6) + ":" + last + (index + 6));
    if (index % 2) current.format.fill = "#F0F6F2";
    if (totalRow && index === data.length - 1) {
      current.format.fill = "#D4EEE0";
      current.format.font = {bold: true};
    }
  });
  widths.forEach((width, index) => {
    const letter = String.fromCharCode(65 + index);
    ws.getRange(letter + ":" + letter).format.columnWidth = width;
  });
  ws.freezePanes.freezeRows(5);
}
const metricWidths = [14, 14, 22, 13, 23, 13, 21, 15];
sheet("Division summary", ["Division", ...headers, "Cloud verified"],
  [...report.divisions.map(row => [row.name, ...numbers(row), stamp(row.verifiedAt)]),
    [report.total.name, ...numbers(report.total), null]],
  [25, ...metricWidths, 27], true);
sheet("PWD sections", ["Division", "PWD section", ...headers, "Cloud verified"],
  report.divisions.flatMap(division => division.sections.map(row =>
    [division.name, row.name, ...numbers(row), stamp(division.verifiedAt)])),
  [25, 34, ...metricWidths, 27]);
workbook.recalculate();
const output = await SpreadsheetFile.exportXlsx(workbook);
const target = fileURLToPath(new URL("./docs/road-survey.xlsx", import.meta.url));
await output.save(target + ".tmp");
await fs.rename(target + ".tmp", target);
