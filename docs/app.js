const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat("en-IN");
const date = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short"
});
const when = value => date.format(new Date(value)) + " IST";
const percent = new Intl.NumberFormat("en-IN", {style: "percent", maximumFractionDigits: 1});
function metricValue(row, key) {
  if (key === "completion") return row.listed > 0 ? percent.format(row.covered / row.listed) : "—";
  return format.format(row[key]);
}
function completionBand(row) {
  if (!row.listed) return "none";
  const rate = Math.round(1000 * row.covered / row.listed) / 10;
  if (rate < 25) return "low";
  if (rate < 50) return "fair";
  if (rate < 75) return "good";
  return "high";
}
const hasNotStarted = row => row.start + row.intermediate + row.end + row.unknown === 0;
const hasCompleted = section => section.listed > 0 && section.covered === section.listed;
function sectionCounts(sections) {
  const assigned = sections.filter(section => !/^unassigned (?:pwd )?section$/i.test(section.name));
  return {
    notStarted: assigned.filter(hasNotStarted).length,
    completed: assigned.filter(hasCompleted).length
  };
}
const metrics = [
  ["listed", "Roads in list", "Register entries"],
  ["start", "Start points", "Surveyed"],
  ["intermediate", "Intermediate points", "Surveyed"],
  ["end", "End points", "Surveyed"],
  ["covered", "Listed roads covered", "With both endpoints"],
  ["completion", "Road completion", "Covered share of listed roads"],
  ["new", "New roads", "Outside the register"]
];
const chartSeries = {
  roads: [["covered", "Covered", "#0b57d0"], ["remaining", "Without both matched endpoints", "#c2d7f8"]],
  points: [["start", "Start", "#0b57d0"], ["intermediate", "Intermediate", "#4285f4"], ["end", "End", "#188038"], ["unknown", "Unclassified", "#7a6c85"]]
};
function node(tag, value, className) {
  const el = document.createElement(tag);
  if (value !== undefined) el.textContent = value;
  if (className) el.className = className;
  return el;
}
function paintChart(rows, isDivision) {
  const mode = $("chart-mode").value;
  const series = chartSeries[mode];
  const counts = row => series.map(([key]) => key === "remaining" ? row.listed - row.covered : row[key]);
  const sum = values => values.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...rows.map(row => sum(counts(row))));
  $("chart-title").textContent = mode === "roads" ? "Road coverage" : "Surveyed points";
  $("chart-detail").textContent = (mode === "roads" ? "Register entries by " : "Point counts by ") + (isDivision ? "PWD section." : "division.");
  $("legend").replaceChildren(...series.map(([, title, color]) => {
    const item = node("span", title);
    const swatch = node("i");
    swatch.style.setProperty("--series", color);
    item.prepend(swatch);
    return item;
  }));
  $("chart").replaceChildren(...rows.map(row => {
    const values = counts(row);
    const item = node("div", undefined, "bar-row");
    item.setAttribute("role", "listitem");
    const track = node("div", undefined, "bar-track");
    track.setAttribute("role", "img");
    track.setAttribute("aria-label", series.map(([, title], i) => title + " " + format.format(values[i])).join(", "));
    track.title = track.getAttribute("aria-label");
    series.forEach(([, , color], i) => {
      const bar = node("div", undefined, "bar");
      bar.style.width = (100 * values[i] / max) + "%";
      bar.style.setProperty("--series", color);
      track.append(bar);
    });
    item.append(node("span", row.name), track, node("strong", format.format(sum(values))));
    return item;
  }));
}
function initialize(report) {
  const division = $("division");
  const projects = new Map(report.divisions.map(row => [row.name, row]));
  for (const name of projects.keys()) division.add(new Option(name, name));
  function select(name) {
    $("road-panel").hidden = true;
    division.value = projects.has(name) ? name : "";
    const query = new URLSearchParams();
    if (division.value) query.set("division", division.value);
    history.replaceState(null, "", location.pathname + (query.size ? "?" + query : ""));
    render();
  }
  function showRoads(section) {
    const roads = section.roads || [];
    $("road-title").textContent = section.name + " · Road details";
    $("road-detail").textContent = roads.length ? format.format(roads.length) + " roads"
      : "No road details available for this section.";
    $("road-rows").replaceChildren(...roads.map(road => {
      const tr = node("tr");
      const name = node("th", road.name || "Unnamed road");
      name.scope = "row";
      tr.append(name);
      for (const key of ["start", "end", "intermediate", "stretch"]) {
        const points = road[key] || [];
        const cell = node("td", points.length ? format.format(points.length) : "—");
        const locations = points.filter(Boolean);
        if (locations.length) {
          const list = node("ul");
          list.append(...locations.map(location => node("li", location)));
          cell.append(list);
        }
        tr.append(cell);
      }
      return tr;
    }));
    $("road-panel").hidden = false;
    $("road-title").focus();
  }
  function completionCell(row) {
    const cell = node("td");
    cell.append(node("span", metricValue(row, "completion"), "completion-badge " + completionBand(row)));
    return cell;
  }
  function tableRow(row, onClick, counts) {
    const tr = node("tr");
    const heading = node("th");
    heading.scope = "row";
    if (onClick) {
      const button = node("button", row.name, "division-link");
      button.type = "button";
      const arrow = node("span", "→");
      arrow.setAttribute("aria-hidden", "true");
      button.append(arrow);
      button.addEventListener("click", onClick);
      heading.append(button);
    } else heading.textContent = row.name;
    tr.append(heading, ...metrics.map(([key]) => key === "completion"
      ? completionCell(row) : node("td", metricValue(row, key))));
    if (counts) tr.append(node("td", format.format(counts.notStarted)), node("td", format.format(counts.completed)));
    return tr;
  }
  function render() {
    const selected = projects.get(division.value);
    const rows = selected ? selected.sections : report.divisions;
    const total = selected || report.total;
    const counts = sectionCounts(selected ? rows : rows.flatMap(project => project.sections));
    for (const header of document.querySelectorAll("[data-division-count]")) header.hidden = Boolean(selected);
    $("table-title").textContent = selected ? selected.name + " · PWD sections" : "Division progress";
    $("group-heading").textContent = selected ? "PWD section" : "Division";
    $("table-detail").textContent = selected ? format.format(counts.notStarted) + " PWD sections not started · " + format.format(counts.completed) + " PWD sections completed · Select a PWD section to see its roads · Verified " + when(selected.verifiedAt)
      : report.divisions.length + " divisions · Select a division to see its PWD sections.";
    $("summary").replaceChildren(...metrics.map(([key, title, detail]) => {
      const card = node("article", undefined, "stat " + key);
      if (key === "completion") card.classList.add(completionBand(total));
      card.append(node("small", title), node("b", metricValue(total, key)), node("span", detail));
      return card;
    }));
    $("rows").replaceChildren(...rows.map(row => tableRow(row, selected
      ? () => showRoads(row)
      : () => { select(row.name); division.focus(); }, selected ? null : sectionCounts(row.sections))));
    $("totals").replaceChildren(tableRow({...total, name: selected ? "Division total" : total.name}, null, selected ? null : counts));
    const exclusions = selected
      ? format.format(total.excluded) + " in " + selected.name + ", " + format.format(report.total.excluded) + " statewide"
      : format.format(report.total.excluded) + " statewide";
    $("quality").textContent = format.format(total.unknown) + " unclassified points · " +
      format.format(total.review) + " road match or identity flags · RMMS or trial points excluded (" +
      exclusions + ") · Cloud snapshots exclude submissions that have yet to sync.";
    paintChart(rows, Boolean(selected));
  }
  const completed = report.divisions.flatMap(project => project.sections
    .filter(hasCompleted)
    .map(section => ({name: section.name, project: project.name, section})))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pending = report.divisions
    .filter(hasNotStarted)
    .map(row => ({name: row.name, project: row.name}));
  for (const [id, entries] of [["completed", completed], ["pending", pending]]) {
    $(id + "-count").textContent = format.format(entries.length);
    const items = entries.map(entry => {
      const item = node("li");
      const button = node("button", undefined, "status-link");
      const title = node("strong", entry.name);
      button.append(title);
      if (entry.section) button.append(node("small", entry.project));
      button.addEventListener("click", () => {
        select(entry.project);
        if (entry.section) showRoads(entry.section);
        else division.focus();
      });
      item.append(button);
      return item;
    });
    $(id + "-list").replaceChildren(...(items.length ? items : [node("li", "No entries in this report.", "status-empty")]));
  }
  $("updated").textContent = "Last updated " + when(report.updatedAt);
  $("source").textContent = report.mode + " · " + when(report.sourceThrough);
  $("source").title = "Cloud verification began " + when(report.sourceFrom);
  division.addEventListener("change", () => select(division.value));
  $("chart-mode").addEventListener("change", render);

  select(new URLSearchParams(location.search).get("division"));
  $("report").hidden = false;
}
fetch("report.json", {cache: "no-cache"}).then(response => {
  if (!response.ok) throw new Error("Report unavailable");
  return response.json();
}).then(initialize).catch(error => {
  console.error(error);
  $("updated").textContent = "Report unavailable";
  $("source").hidden = true;
  $("error").hidden = false;
});
