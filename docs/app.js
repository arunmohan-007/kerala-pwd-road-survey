const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat("en-IN");
const date = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short"
});
const when = value => date.format(new Date(value)) + " IST";
const percent = new Intl.NumberFormat("en-IN", {style: "percent", maximumFractionDigits: 1});
function metricValue(row, key) {
  if (key === "completion") return row.listed > 0 ? percent.format(row.covered / row.listed) : "—";
  if (key === "newCompletion") return row.new > 0 ? percent.format(row.newCompleted / row.new) : "—";
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
function compareProgress(a, b, key, direction) {
  const byName = a.row.name.localeCompare(b.row.name, "en-IN");
  if (key === "name") return direction * byName;
  if (key === "completion" || key === "newCompletion") {
    const [numerator, denominator] = key === "completion" ? ["covered", "listed"] : ["newCompleted", "new"];
    const missingA = Number(!a.row[denominator]);
    const missingB = Number(!b.row[denominator]);
    if (missingA !== missingB) return missingA - missingB;
    if (missingA) return byName;
    return direction * (a.row[numerator] * b.row[denominator] - b.row[numerator] * a.row[denominator]) || byName;
  }
  const value = entry => entry.counts?.[key] ?? entry.row[key];
  return direction * (value(a) - value(b)) || byName;
}
const hasNotStarted = row => row.start + row.intermediate + row.end + row.unknown === 0;
const isAssigned = section => !/^unassigned (?:pwd )?section$/i.test(section.name);
const hasCompleted = section => section.listed > 0 && section.covered === section.listed;
function sectionCounts(sections) {
  const assigned = sections.filter(isAssigned);
  return {
    total: assigned.length,
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
  ["new", "New roads added", "Outside the register"],
  ["newCompleted", "New roads completed", "With both endpoints"]
];
const progressMetrics = [...metrics, ["newCompletion", "New road completion"]];
const chartSeries = {
  roads: [["covered", "Covered", "#087763"], ["remaining", "Without both matched endpoints", "#c6dfd2"]],
  points: [["start", "Start", "#087763"], ["intermediate", "Intermediate", "#408398"], ["end", "End", "#9b5a25"], ["unknown", "Unclassified", "#7a6c85"]]
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
function renderDivisionRankings(divisions) {
  const ranked = divisions
    .filter(row => row.listed > 0)
    .sort((a, b) => b.covered * a.listed - a.covered * b.listed || a.name.localeCompare(b.name));
  const list = $("ranking-list");

  function addGroup(label, style, rows, firstRank) {
    const heading = document.createElement("li");
    heading.className = "ranking-label " + style;
    heading.textContent = label;
    list.append(heading);
    rows.forEach((row, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = firstRank + index;
      const name = document.createElement("span");
      name.textContent = row.name;
      const rate = document.createElement("strong");
      rate.textContent = percent.format(row.covered / row.listed);
      item.append(rank, name, rate);
      list.append(item);
    });
  }

  addGroup("Top 4", "top", ranked.slice(0, 4), 1);
  const lastStart = Math.max(4, ranked.length - 4);
  addGroup("Last 4", "last", ranked.slice(lastStart), lastStart + 1);
  $("ranking-repeat").replaceChildren(...Array.from(list.children, item => item.cloneNode(true)));

  const pause = $("ranking-pause");
  pause.addEventListener("click", () => {
    const paused = pause.closest(".ranking").classList.toggle("is-paused");
    pause.setAttribute("aria-pressed", String(paused));
    pause.textContent = paused ? "Resume" : "Pause";
  });
}

function initialize(report) {
  renderDivisionRankings(report.divisions);
  const division = $("division");
  const projects = new Map(report.divisions.map(row => [row.name, row]));
  let sortKey = "completion";
  let sortDirection = 1;
  const sortHeaders = Array.from(document.querySelectorAll("[data-sort]"), header => {
    const key = header.dataset.sort;
    const label = node("span", header.textContent);
    const marker = node("span", "", "sort-marker");
    marker.setAttribute("aria-hidden", "true");
    const button = node("button", undefined, "progress-sort");
    button.type = "button";
    button.append(label, marker);
    button.addEventListener("click", () => {
      sortDirection = sortKey === key ? -sortDirection : 1;
      sortKey = key;
      render();
    });
    header.replaceChildren(button);
    return {header, key, label, marker};
  });
  for (const name of projects.keys()) division.add(new Option(name, name));
  const views = new Map(Array.from(document.querySelectorAll("[data-view]"), panel => [panel.dataset.view, panel]));
  const navigation = document.querySelectorAll(".views a");
  function showView(name, focusTarget) {
    const active = views.has(name) ? name : "overview";
    for (const [key, panel] of views) panel.hidden = key !== active;
    for (const link of navigation) {
      if (link.hash === "#" + active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (location.hash !== "#" + active) history.replaceState(null, "", "#" + active);
    (focusTarget || views.get(active).querySelector(".view-title")).focus();
  }
  for (const link of navigation) {
    link.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showView(link.hash.slice(1));
    });
  }
  window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
  function renderNotStarted(selected) {
    const projectsInScope = selected ? [selected] : report.divisions;
    const items = projectsInScope.flatMap(project => project.sections
      .filter(section => isAssigned(section) && hasNotStarted(section))
      .map(section => {
        const item = node("li");
        const button = node("button", undefined, "status-link");
        button.type = "button";
        button.append(node("strong", section.name), node("span", project.name));
        button.addEventListener("click", () => {
          select(project.name);
          showView("road-details");
          showRoads(section);
        });
        item.append(button);
        return item;
      }));
    $("not-started-title").textContent = selected
      ? `PWD sections yet to start · ${selected.name}` : "PWD sections yet to start";
    $("not-started-count").textContent = format.format(items.length);
    $("not-started-empty").hidden = items.length > 0;
    const list = $("not-started-list");
    list.hidden = items.length === 0;
    list.replaceChildren(...items);
  }
  function select(name) {
    $("road-panel").hidden = true;
    $("new-road-panel").hidden = true;
    sortKey = "completion";
    sortDirection = 1;
    division.value = projects.has(name) ? name : "";
    const query = new URLSearchParams();
    if (division.value) query.set("division", division.value);
    history.replaceState(null, "", location.pathname + (query.size ? "?" + query : "") + location.hash);
    render();
  }
  function showRoads(section) {
    $("new-road-panel").hidden = true;
    const roads = section.roads || [];
    const project = projects.get(division.value);
    const pdf = $("road-pdf");
    pdf.href = `section-pdfs/${report.divisions.indexOf(project) + 1}-${project.sections.indexOf(section) + 1}.pdf`;
    pdf.download = `${project.name} - ${section.name} - Road-wise report.pdf`;
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
      tr.append(node("td", road.remarks || "—"));
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
  function newRoadValues(divisionName, section) {
    const divisions = divisionName ? [projects.get(divisionName)] : report.divisions;
    return divisions.flatMap(project => (section ? [section] : project.sections)
      .flatMap(area => (area.newRoadList || []).filter(road => !road.inRegister).map(road =>
        [project.name, area.name, road.name, (road.pointIds || []).join(", "),
          road.completed ? "Completed" : "Incomplete", road.remarks])))
      .map((row, index) => [index + 1, ...row]);
  }
  const newRoadHeaders = Array.from($("new-road-panel").querySelectorAll("thead th"), th => th.textContent);
  function setNewRoadDownload(download, values, divisionName, section) {
    const csv = [newRoadHeaders, ...values].map(row => row.map(value => {
      const text = String(value);
      const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
      return '"' + safe.replaceAll('"', '""') + '"';
    }).join(",")).join("\r\n");
    if (download.href.startsWith("blob:")) URL.revokeObjectURL(download.href);
    download.href = URL.createObjectURL(new Blob(["\uFEFF", csv], {type: "text/csv;charset=utf-8"}));
    const filename = ["Newly added roads", divisionName, section?.name].filter(Boolean).join(" - ");
    download.download = filename + ".csv";
    const project = projects.get(divisionName);
    const divisionIndex = report.divisions.indexOf(project) + 1;
    const scope = section ? `${divisionIndex}-${project.sections.indexOf(section) + 1}`
      : divisionIndex || "statewide";
    const pdf = $(download.id + "-pdf");
    pdf.href = `new-road-pdfs/${values.length ? scope : "empty"}.pdf`;
    pdf.download = filename + ".pdf";
  }
  function showNewRoads(divisionName, section) {
    const values = newRoadValues(divisionName, section);
    const totals = section || projects.get(divisionName) || report.total;
    const completion = totals.new ? ` (${metricValue(totals, "newCompletion")})` : "";
    $("new-road-breakdown").textContent = `${format.format(totals.new)} added · ${format.format(totals.newCompleted)} completed${completion}`;
    setNewRoadDownload($("new-road-download"), values, divisionName, section);
    const rows = values.map(values => {
      const row = node("tr");
      row.append(...values.map(value => node("td", value)));
      return row;
    });
    if (!rows.length) {
      const row = node("tr");
      const cell = node("td", "No new roads in this area.");
      cell.colSpan = newRoadHeaders.length;
      row.append(cell);
      rows.push(row);
    }
    $("new-road-rows").replaceChildren(...rows);
    $("road-panel").hidden = true;
    $("new-road-panel").hidden = false;
    showView("road-details", $("new-road-title"));
  }
  function tableRow(row, onClick, counts, onNewRoads) {
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
    tr.append(heading, ...progressMetrics.map(([key]) => {
      if (key === "completion") return completionCell(row);
      if (key !== "new") return node("td", metricValue(row, key));
      const cell = node("td");
      const button = node("button", metricValue(row, key), "division-link");
      button.type = "button";
      button.setAttribute("aria-label", `View new roads for ${row.name}`);
      button.addEventListener("click", onNewRoads);
      cell.append(button);
      return cell;
    }));
    if (counts) tr.append(node("td", format.format(counts.notStarted)), node("td", format.format(counts.completed)));
    return tr;
  }
  function render() {
    const selected = projects.get(division.value);
    renderNotStarted(selected);
    setNewRoadDownload($("progress-new-road-download"), newRoadValues(selected?.name), selected?.name);
    $("overview-title").textContent = selected ? selected.name + " overview" : "Statewide overview";
    const rows = selected ? selected.sections : report.divisions;
    const total = selected || report.total;
    const counts = sectionCounts(selected ? rows : rows.flatMap(project => project.sections));
    for (const header of document.querySelectorAll("[data-division-count]")) header.hidden = Boolean(selected);
    $("table-title").textContent = selected ? selected.name + " · PWD sections" : "Division progress";
    for (const {header, key, label, marker} of sortHeaders) {
      if (key === "name") label.textContent = selected ? "PWD section" : "Division";
      if (key === sortKey) header.setAttribute("aria-sort", sortDirection === 1 ? "ascending" : "descending");
      else header.removeAttribute("aria-sort");
      marker.textContent = key === sortKey ? (sortDirection === 1 ? "↑" : "↓") : "↕";
    }
    $("table-detail").textContent = selected ? format.format(counts.notStarted) + " PWD sections not started · " + format.format(counts.completed) + " PWD sections completed · Select a PWD section to see its roads · Verified " + when(selected.verifiedAt)
      : report.divisions.length + " divisions · Select a division to see its PWD sections.";
    const summaryCards = metrics.map(([key, title, detail]) => {
      const isNewRoads = key === "new";
      const card = node(isNewRoads ? "button" : "article", undefined, "stat " + key);
      if (key === "completion") card.classList.add(completionBand(total));
      if (isNewRoads) {
        card.type = "button";
        card.setAttribute("aria-controls", "new-road-panel");
        card.addEventListener("click", () => showNewRoads(selected?.name));
      }
      const caption = key === "newCompleted" && total.new
        ? `${metricValue(total, "newCompletion")} of new roads added` : detail;
      card.append(node("small", title), node("b", metricValue(total, key)), node("span", caption));
      return card;
    });
    const statusCards = node("div", undefined, "summary-status");
    for (const [title, count, id, style] of [
      ["PWD Sections Completed QField Survey", completed.length, "completed", "survey-completed"],
      ["PWD sections yet to start", counts.notStarted, "not-started", "notStarted"],
      ["Divisions / Districts Completed QField Survey", completedProjects.length, "completed-projects", "survey-completed"]
    ]) {
      const card = node("button", undefined, "stat " + style);
      card.type = "button";
      card.setAttribute("aria-controls", id + "-panel");
      card.append(node("small", title), node("b", format.format(count)), node("span", "Click to view"));
      card.addEventListener("click", () => showView("survey-status", $(id + "-title")));
      statusCards.append(card);
    }
    $("summary").replaceChildren(...summaryCards, statusCards);
    const sorted = rows.map(row => ({row, counts: selected ? null : sectionCounts(row.sections)}));
    sorted.sort((a, b) => compareProgress(a, b, sortKey, sortDirection));
    $("rows").replaceChildren(...sorted.map(({row, counts: rowCounts}) => tableRow(row, selected
      ? () => showRoads(row)
      : () => { select(row.name); division.focus(); }, rowCounts,
      () => showNewRoads(selected?.name || row.name, selected ? row : null))));
    $("totals").replaceChildren(tableRow({...total, name: selected ? "Division total" : total.name}, null, selected ? null : counts,
      () => showNewRoads(selected?.name)));
    const exclusions = selected
      ? format.format(total.excluded) + " in " + selected.name + ", " + format.format(report.total.excluded) + " statewide"
      : format.format(report.total.excluded) + " statewide";
    $("quality").textContent = format.format(total.unknown) + " unclassified points · " +
      format.format(total.review) + " road match or identity flags · RMMS or trial points excluded (" +
      exclusions + ") · Cloud snapshots exclude submissions that have yet to sync.";
    paintChart(rows, Boolean(selected));
  }
  const completed = report.divisions.flatMap(project => project.sections
    .filter(section => isAssigned(section) && hasCompleted(section))
    .map(section => ({name: section.name, project: project.name, section})))
    .sort((a, b) => a.name.localeCompare(b.name));
  const completedByDivision = report.divisions
    .map(({name, sections}) => ({name, project: name, ...sectionCounts(sections)}))
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name))
    .map(entry => ({
      ...entry,
      completion: `${format.format(entry.completed)} out of ${format.format(entry.total)}`
    }));
  const completedProjects = completedByDivision
    .filter(entry => entry.total > 0 && entry.completed === entry.total)
    .sort((a, b) => a.name.localeCompare(b.name));
  const statewide = report.total;
  $("state-average").textContent = "State average " + metricValue(statewide, "completion");
  const belowAverage = report.divisions
    .filter(row => row.listed > 0 && row.covered * statewide.listed < statewide.covered * row.listed)
    .sort((a, b) => a.covered / a.listed - b.covered / b.listed || a.name.localeCompare(b.name))
    .map(row => ({name: row.name, project: row.name, completion: metricValue(row, "completion")}));
  for (const [id, entries, empty] of [
    ["completed", completed, "No PWD sections have completed the survey."],
    ["completed-projects", completedProjects, "No divisions or districts have completed the survey."],
    ["completed-by-division", completedByDivision, "No divisions or districts available."],
    ["below-average", belowAverage, "No divisions or districts are below the state average."]
  ]) {
    const count = $(id + "-count");
    if (count) count.textContent = format.format(entries.length);
    const items = entries.map(entry => {
      const item = node("li");
      const button = node("button", undefined, "status-link");
      const title = node("strong", entry.name);
      button.append(title);
      if (entry.section) button.append(node("small", entry.project));
      if (entry.completion) button.append(node("span", entry.completion, "below-average-percent"));
      button.addEventListener("click", () => {
        select(entry.project);
        showView("road-details", division);
        if (entry.section) showRoads(entry.section);
      });
      item.append(button);
      return item;
    });
    $(id + "-list").replaceChildren(...(items.length ? items : [node("li", empty, "status-empty")]));
  }
  $("updated").textContent = "Last updated " + when(report.updatedAt);
  $("source").textContent = report.mode + " · " + when(report.sourceThrough);
  $("source").title = "Cloud verification began " + when(report.sourceFrom);
  division.addEventListener("change", () => select(division.value));
  $("chart-mode").addEventListener("change", render);

  const initialDivision = new URLSearchParams(location.search).get("division");
  select(initialDivision);
  $("report").hidden = false;
  if (location.hash || initialDivision) showView(location.hash.slice(1) || "road-details");
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
