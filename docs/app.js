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
  const compareCompletion = (a, b) => b.covered * a.listed - a.covered * b.listed;
  const ranked = divisions
    .filter(row => row.listed > 0)
    .sort((a, b) => compareCompletion(a, b) || b.covered - a.covered || a.name.localeCompare(b.name));
  let currentRank = 0;
  const rowsWithRank = ranked.map((row, index) => {
    if (index === 0 || compareCompletion(ranked[index - 1], row) !== 0) currentRank += 1;
    return {...row, rank: currentRank};
  });
  const list = $("ranking-list");

  function addGroup(label, style, rows) {
    const heading = document.createElement("li");
    heading.className = "ranking-label " + style;
    heading.textContent = label;
    list.append(heading);
    if (!rows.length) return;

    const highest = rows[0].covered / rows[0].listed;
    const lowest = rows.at(-1).covered / rows.at(-1).listed;
    rows.forEach(row => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = row.rank;
      const completion = row.covered / row.listed;
      const distance = style === "top" ? completion - lowest : highest - completion;
      const strength = highest === lowest ? 0 : 100 * (distance / (highest - lowest));
      const name = node("span", row.name, "ranking-name ranking-name-" + style);
      name.style.setProperty("--ranking-strength", strength + "%");
      const rate = node("strong", percent.format(completion));
      item.append(rank, name, rate);
      list.append(item);
    });
  }

  const top = rowsWithRank.filter(row => row.rank <= 4);
  addGroup("Top 4", "top", top);
  const lastStart = Math.max(top.length, ranked.length - 4);
  addGroup("Last 4", "last", rowsWithRank.slice(lastStart));
  prepareRankingStrip(list);
}

function renderSectionRankings(divisions) {
  const ranked = divisions.flatMap(division => division.sections
    .filter(section => section.listed > 0)
    .map(section => ({...section, division: division.name})))
    .sort((a, b) => a.covered * b.listed - b.covered * a.listed
      || a.name.localeCompare(b.name) || a.division.localeCompare(b.division));
  const list = $("section-ranking-list");
  const lowest = ranked.slice(0, 10);
  list.closest(".ranking").hidden = lowest.length === 0;
  lowest.forEach((section, index) => {
    const item = node("li");
    const count = format.format(section.covered) + "/" + format.format(section.listed);
    const rate = percent.format(section.covered / section.listed);
    item.append(node("span", String(index + 1), "rank"),
      node("span", section.name + " (" + section.division + ")"),
      node("strong", count + " roads · " + rate));
    list.append(item);
  });
  prepareRankingStrip(list);
}

function prepareRankingStrip(list) {
  const strip = list.closest(".ranking");
  list.nextElementSibling.replaceChildren(...Array.from(list.children, item => item.cloneNode(true)));
  const pause = strip.querySelector("button");
  pause.addEventListener("click", () => {
    const paused = strip.classList.toggle("is-paused");
    pause.setAttribute("aria-pressed", String(paused));
    pause.textContent = paused ? "Resume" : "Pause";
  });
}

function initialize(report) {
  renderDivisionRankings(report.divisions);
  renderSectionRankings(report.divisions);
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
  const roadPointGroups = [
    ["start", "Start points"],
    ["end", "End points"],
    ["intermediate", "Intermediate points"],
    ["stretch", "Stretch start and end points"]
  ];
  let currentSection;

  function renderRoadList() {
    const query = $("road-search").value.trim().toLocaleLowerCase();
    const filter = $("road-coverage-filter").value;
    const roads = currentSection.roads || [];
    const matches = roads.filter(road => {
      const endpoints = Number(Boolean(road.start?.length)) + Number(Boolean(road.end?.length));
      const status = ["neither", "one", "both"][endpoints];
      return (filter === "all" || filter === status || (filter === "missing" && endpoints < 2)) &&
        (!query || (road.name || "").toLocaleLowerCase().includes(query) ||
          roadPointGroups.some(([key]) => (road[key] || []).some(point => point?.toLocaleLowerCase().includes(query))));
    });
    $("road-results").textContent = matches.length
      ? `Showing ${format.format(matches.length)} of ${format.format(roads.length)} roads`
      : "No roads match the current filters.";
    $("road-rows").replaceChildren(...matches.map(road => {
      const card = node("details", undefined, "road-entry");
      const summary = node("summary");
      const name = node("strong", road.name || "Unnamed road");
      const points = node("span", undefined, "road-point-counts");
      for (const [key, label] of roadPointGroups) {
        points.append(node("span", label + " " + format.format(road[key]?.length || 0)));
      }
      summary.append(name);
      const missing = !road.start?.length && !road.end?.length ? "Start and end missing"
        : !road.start?.length ? "Start missing" : !road.end?.length ? "End missing" : "";
      if (missing) {
        const warning = node("span", undefined, "road-endpoint-warning");
        warning.append(node("strong", "Survey not completed"), node("span", missing));
        summary.append(warning);
      }
      summary.append(points);
      const body = node("div", undefined, "road-entry-body");
      for (const [key, label] of roadPointGroups) {
        const group = node("section", undefined, "road-point-group");
        const locations = road[key] || [];
        group.append(node("h4", label));
        if (locations.length) {
          const list = node("ul");
          list.append(...locations.map(location => node("li", location || "Location not recorded")));
          group.append(list);
        } else {
          group.append(node("p", "No points recorded"));
        }
        body.append(group);
      }
      if (road.remarks) {
        const remarks = node("div", undefined, "road-remarks");
        remarks.append(node("h4", "Remarks"), node("p", road.remarks));
        body.append(remarks);
      }
      card.append(summary, body);
      return card;
    }));
    if (query && matches.length === 1) $("road-rows").firstElementChild.open = true;
    for (const id of ["expand-roads", "collapse-roads"]) $(id).disabled = matches.length === 0;
  }

  function showRoads(section) {
    $("new-road-panel").hidden = true;
    const roads = section.roads || [];
    const project = projects.get(division.value);
    const sectionId = `${report.divisions.indexOf(project) + 1}-${project.sections.indexOf(section) + 1}`;
    const prefix = `${project.name} - ${section.name}`;
    const roadPdf = $("road-pdf");
    roadPdf.href = `section-pdfs/${sectionId}.pdf`;
    roadPdf.download = prefix + " - Full road list.pdf";
    const sectionPdf = $("section-pdf");
    sectionPdf.href = `section-summary-pdfs/${sectionId}.pdf`;
    sectionPdf.download = prefix + " - Section summary.pdf";
    setNewRoadPdf($("section-new-roads-pdf"), newRoadValues(project.name, section), project.name, section);
    $("road-title").textContent = section.name + " · Road details";
    $("road-detail").textContent = `${project.name} · ${format.format(roads.length)} roads · ${metricValue(section, "completion")} listed road completion`;
    currentSection = section;
    $("road-search").value = "";
    $("road-coverage-filter").value = "all";
    renderRoadList();
    $("road-panel").hidden = false;
    $("road-title").focus();
  }
  $("road-search").addEventListener("input", renderRoadList);
  $("road-coverage-filter").addEventListener("change", renderRoadList);
  for (const [id, open] of [["expand-roads", true], ["collapse-roads", false]]) {
    $(id).addEventListener("click", () => {
      for (const road of $("road-rows").children) road.open = open;
    });
  }

  function completionCell(row) {
    const cell = node("td");
    const badge = node("span", metricValue(row, "completion"), "completion-badge");
    if (row.listed > 0) {
      const rate = row.covered / row.listed * 100;
      const position = Math.max(0, Math.min(1, (rate - 75) / 20));
      const hue = position <= 0.5 ? 4 + position * 92 : 50 + (position - 0.5) * 192;
      badge.style.setProperty("--completion-hue", hue);
    }
    cell.append(badge);
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
    setNewRoadPdf($(download.id + "-pdf"), values, divisionName, section);
  }
  function setNewRoadPdf(link, values, divisionName, section) {
    const project = projects.get(divisionName);
    const divisionIndex = report.divisions.indexOf(project) + 1;
    const scope = section ? `${divisionIndex}-${project.sections.indexOf(section) + 1}`
      : divisionIndex || "statewide";
    link.href = `new-road-pdfs/${values.length ? scope : "empty"}.pdf`;
    link.download = ["New roads only", divisionName, section?.name].filter(Boolean).join(" - ") + ".pdf";
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
    const surveyPdf = $("division-pdf");
    surveyPdf.href = selected ? `division-pdfs/${report.divisions.indexOf(selected) + 1}.pdf` : "road-survey.pdf";
    surveyPdf.textContent = selected ? "Division summary PDF" : "Statewide survey PDF";
    surveyPdf.download = (selected?.name || "Kerala") + " - Survey summary.pdf";
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
    const completion = node("article", undefined, "overview-completion");
    const headline = node("div", undefined, "completion-headline");
    headline.append(node("h3", "Road completion"), node("b", metricValue(total, "completion")));
    const progress = node("div", undefined, "completion-progress");
    if (total.listed > 0) {
      const meter = node("progress");
      meter.max = total.listed;
      meter.value = total.covered;
      meter.setAttribute("aria-label", "Listed roads with both endpoints");
      progress.append(meter);
    }
    const caption = node("p");
    caption.append(
      node("strong", format.format(total.covered), "completion-count-covered"),
      " of ",
      node("strong", format.format(total.listed), "completion-count-listed"),
      " listed roads have both endpoints"
    );
    progress.append(caption);
    completion.append(headline, progress);

    const supporting = node("div", undefined, "summary-metrics");
    const supportingMetrics = metrics.filter(([key]) => key !== "listed" && key !== "covered" && key !== "completion");
    supporting.append(...supportingMetrics.map(([key, title, detail]) => {
      const isNewRoads = key === "new";
      const card = node(isNewRoads ? "button" : "article", undefined, "stat " + key);
      if (isNewRoads) {
        card.type = "button";
        card.setAttribute("aria-controls", "new-road-panel");
        card.addEventListener("click", () => showNewRoads(selected?.name));
      }
      const caption = key === "newCompleted" && total.new
        ? `${metricValue(total, "newCompletion")} of new roads added` : detail;
      card.append(node("small", title), node("b", metricValue(total, key)), node("span", caption));
      return card;
    }));
    const statusCards = node("div", undefined, "summary-status");
    for (const [title, count, id, style, denominator] of [
      ["PWD Sections Completed QField Survey", completed.length, "completed", "survey-completed", assignedSectionTotal],
      ["PWD sections yet to start", counts.notStarted, "not-started", "notStarted"],
      ["Divisions / Districts Completed QField Survey", completedProjects.length, "completed-projects", "survey-completed", report.divisions.length]
    ]) {
      const card = node("button", undefined, "stat " + style);
      card.type = "button";
      card.setAttribute("aria-controls", id + "-panel");
      const value = denominator === undefined ? format.format(count) : `${format.format(count)}/${format.format(denominator)}`;
      card.append(node("small", title), node("b", value), node("span", "View details"));
      card.addEventListener("click", () => showView("survey-status", $(id + "-title")));
      statusCards.append(card);
    }
    $("summary").replaceChildren(completion, supporting, statusCards);
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
  const assignedSectionTotal = completedByDivision.reduce((sum, entry) => sum + entry.total, 0);
  const notStartedTotal = completedByDivision.reduce((sum, entry) => sum + entry.notStarted, 0);
  const sectionStages = [
    ["Completed", completed.length, "complete"],
    ["In progress", assignedSectionTotal - completed.length - notStartedTotal, "active"],
    ["Yet to start", notStartedTotal, "pending"]
  ];
  $("section-progress-total").textContent = format.format(assignedSectionTotal) + " assigned sections";
  for (const [label, count, stage] of sectionStages) {
    const segment = node("span", undefined, stage);
    segment.style.flexGrow = count;
    $("section-progress-track").append(segment);
    const group = node("div", undefined, stage);
    group.append(node("dt", label), node("dd", format.format(count)));
    $("section-progress-breakdown").append(group);
  }
  const completedProjects = completedByDivision
    .filter(entry => entry.total > 0 && entry.completed === entry.total)
    .sort((a, b) => a.name.localeCompare(b.name));
  const statewide = report.total;
  $("state-average").textContent = "State average " + metricValue(statewide, "completion");
  const belowAverage = report.divisions
    .filter(row => row.listed > 0 && row.covered * statewide.listed < statewide.covered * row.listed)
    .sort((a, b) => a.covered / a.listed - b.covered / b.listed || a.name.localeCompare(b.name))
    .map(row => ({
      name: row.name,
      project: row.name,
      completion: metricValue(row, "completion"),
      gap: ((statewide.covered / statewide.listed - row.covered / row.listed) * 100).toFixed(1)
    }));
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
      button.type = "button";
      button.append(title);
      if (entry.section) button.append(node("small", entry.project));
      if (entry.completion) button.append(node("span", entry.completion, "status-value"));
      if (entry.gap) button.append(node("small", entry.gap + " percentage points below statewide", "status-gap"));
      if (id === "completed-by-division" && entry.total > 0) {
        const progress = node("progress", undefined, "status-division-meter");
        progress.max = entry.total;
        progress.value = entry.completed;
        progress.setAttribute("aria-label", "Completed PWD sections");
        button.append(progress);
      }
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
