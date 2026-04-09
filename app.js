(function () {
  const dashboardData = window.NCHOE_DASHBOARD_DATA;

  if (!dashboardData || !Array.isArray(dashboardData.records)) {
    document.getElementById("location-name").textContent = "Dashboard data not found";
    document.getElementById("location-meta").textContent = "Run build-dashboard-data.ps1 to generate dashboard-data.js.";
    return;
  }

  const state = {
    selectedLocation: null,
    selectedParameter: null,
    selectedTimelineKey: null,
    timelineMode: "monthly",
    baseMap: "osm",
  };

  const els = {
    heroCard: document.getElementById("hero-card"),
    heroToggle: document.getElementById("hero-toggle"),
    heroDetails: document.getElementById("hero-details"),
    locationBadge: document.getElementById("location-badge"),
    locationName: document.getElementById("location-name"),
    locationMeta: document.getElementById("location-meta"),
    parameterUnit: document.getElementById("parameter-unit"),
    parameterTabs: document.getElementById("parameter-tabs"),
    timeline: document.getElementById("timeline"),
    timelineCount: document.getElementById("timeline-count"),
    valueSummary: document.getElementById("value-summary"),
    trendChart: document.getElementById("trend-chart"),
    mappedCount: document.getElementById("mapped-count"),
    recordCount: document.getElementById("record-count"),
    timelineMode: document.getElementById("timeline-mode"),
    mapNote: document.getElementById("map-note"),
    basemapToggle: document.getElementById("basemap-toggle"),
  };

  const locationIndex = new Map();
  const groupedRecords = new Map();
  const markers = new Map();

  dashboardData.locations.forEach((location) => {
    locationIndex.set(location.name, location);
  });

  dashboardData.records.forEach((record) => {
    const key = record.locationGroup;
    if (!groupedRecords.has(key)) {
      groupedRecords.set(key, []);
    }
    groupedRecords.get(key).push(record);
  });

  groupedRecords.forEach((records) => {
    records.sort((a, b) => a.sortKey - b.sortKey || a.fileName.localeCompare(b.fileName));
  });

  const mappedLocations = dashboardData.locations.filter((location) => location.hasCoordinates);
  const defaultLocation = mappedLocations[0] || dashboardData.locations[0];

  els.mappedCount.textContent = String(dashboardData.summary.mappedLocationCount);
  els.recordCount.textContent = String(dashboardData.summary.recordCount);
  els.mapNote.textContent = `${dashboardData.summary.mappedLocationCount} mapped locations come from lat_long.xlsx. ${dashboardData.summary.unmappedLocationCount} location(s) remain off-map because no coordinates were provided there.`;

  els.timelineMode.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.timelineMode = button.dataset.mode;
      refreshTimelineModeButtons();
      const timelineRecords = getTimelineRecords();
      state.selectedTimelineKey = timelineRecords[timelineRecords.length - 1]?.timelineKey ?? null;
      renderTimeline(timelineRecords);
      renderTrendChart(timelineRecords);
    });
  });

  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  });

  const baseLayers = {
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    }),
  };

  baseLayers[state.baseMap].addTo(map);

  els.basemapToggle.querySelectorAll("[data-basemap]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextBaseMap = button.dataset.basemap;
      if (nextBaseMap === state.baseMap) {
        return;
      }

      map.removeLayer(baseLayers[state.baseMap]);
      state.baseMap = nextBaseMap;
      baseLayers[state.baseMap].addTo(map);
      refreshBaseMapButtons();
    });
  });

  function refreshBaseMapButtons() {
    els.basemapToggle.querySelectorAll("[data-basemap]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.basemap === state.baseMap);
    });
  }

  refreshBaseMapButtons();

  if (mappedLocations.length) {
    const bounds = L.latLngBounds(mappedLocations.map((location) => [location.latitude, location.longitude]));
    map.fitBounds(bounds.pad(0.28));
  } else {
    map.setView([30.7, 76.75], 10);
  }

  mappedLocations.forEach((location) => {
    const isStp = isSewageTreatmentPlant(location.name);
    const marker = L.circleMarker([location.latitude, location.longitude], {
      radius: 8,
      weight: 2,
      color: "#ffffff",
      fillColor: isStp ? "#d97706" : "#0f766e",
      fillOpacity: 0.92,
    }).addTo(map);

    marker.bindPopup(
      [
        '<div class="location-popup">',
        `<strong>${escapeHtml(location.name)}</strong>`,
        `<span>${isStp ? "Sewage treatment plant" : "Sampling location"}</span><br>`,
        `<span>${location.sources.length} source file(s)</span>`,
        "</div>",
      ].join("")
    );
    marker.bindTooltip("", {
      permanent: true,
      direction: "top",
      offset: [0, -14],
      className: "point-value-tooltip",
      opacity: 1,
    });

    marker.on("click", () => {
      selectLocation(location.name);
    });

    markers.set(location.name, marker);
  });

  function selectLocation(locationName) {
    state.selectedLocation = locationName;
    const records = groupedRecords.get(locationName) || [];
    const parameters = Array.from(new Set(records.map((record) => record.parameter))).sort((a, b) => a.localeCompare(b));

    if (!parameters.length) {
      state.selectedParameter = null;
      renderLocation();
      renderParameterTabs([]);
      renderTimeline([]);
      renderEmptyChart("No parameter data is available for this location.");
      return;
    }

    if (!parameters.includes(state.selectedParameter)) {
      state.selectedParameter = parameters[0];
    }

    const timelineRecords = getTimelineRecords();
    if (!timelineRecords.some((record) => record.timelineKey === state.selectedTimelineKey)) {
      state.selectedTimelineKey = timelineRecords[timelineRecords.length - 1]?.timelineKey ?? null;
    }

    renderLocation();
    renderParameterTabs(parameters);
    refreshTimelineModeButtons();
    renderTimeline(timelineRecords);
    renderTrendChart(timelineRecords);
    refreshMarkerStyles();
    updateMapLabels();
  }

  function getParameterRecords() {
    const records = groupedRecords.get(state.selectedLocation) || [];
    return records.filter((record) => record.parameter === state.selectedParameter);
  }

  function getTimelineRecords() {
    const records = getParameterRecords();
    if (state.timelineMode === "yearly") {
      return buildYearlySeries(records);
    }

    return records.map((record) => ({
      ...record,
      timelineKey: record.sortKey,
      timelineLabel: record.dateLabel,
      timelineMeta: record.source || record.fileName,
    }));
  }

  function renderLocation() {
    const location = locationIndex.get(state.selectedLocation);
    const records = groupedRecords.get(state.selectedLocation) || [];
    const yearSet = new Set(records.map((record) => record.year).filter(Boolean));
    const sourceSet = new Set(records.map((record) => record.source).filter(Boolean));
    const mappedLabel = location?.hasCoordinates ? "Mapped" : "No coordinates";

    els.locationBadge.textContent = mappedLabel;
    els.locationName.textContent = state.selectedLocation || "Unknown location";
    els.locationMeta.textContent = `${records.length} measurements across ${yearSet.size} year(s) from ${sourceSet.size} source(s).`;
  }

  function renderParameterTabs(parameters) {
    els.parameterTabs.innerHTML = "";

    parameters.forEach((parameter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tab-button${parameter === state.selectedParameter ? " is-active" : ""}`;
      button.textContent = parameter;
      button.addEventListener("click", () => {
        state.selectedParameter = parameter;
        const timelineRecords = getTimelineRecords();
        state.selectedTimelineKey = timelineRecords[timelineRecords.length - 1]?.timelineKey ?? null;
        renderParameterTabs(parameters);
        refreshTimelineModeButtons();
        renderTimeline(timelineRecords);
        renderTrendChart(timelineRecords);
        updateMapLabels();
      });
      els.parameterTabs.appendChild(button);
    });

    const activeRecord = getParameterRecords()[0];
    els.parameterUnit.textContent = activeRecord?.unit || "No unit";
  }

  function refreshTimelineModeButtons() {
    els.timelineMode.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === state.timelineMode);
    });
  }

  function renderTimeline(records) {
    els.timeline.innerHTML = "";
    els.timelineCount.textContent = `${records.length} point${records.length === 1 ? "" : "s"}`;

    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "section-copy";
      empty.textContent = "No values available for this parameter at the selected location.";
      els.timeline.appendChild(empty);
      return;
    }

    records.forEach((record) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `timeline-item${record.timelineKey === state.selectedTimelineKey ? " is-selected" : ""}`;
      item.addEventListener("click", () => {
        state.selectedTimelineKey = record.timelineKey;
        renderTimeline(records);
        renderTrendChart(records);
      });

      item.innerHTML = [
        '<span class="timeline-dot" aria-hidden="true"></span>',
        `<span><span class="timeline-date">${escapeHtml(record.timelineLabel || record.dateLabel)}</span><span class="timeline-meta">${escapeHtml(record.timelineMeta || record.source || record.fileName)}</span></span>`,
        `<span class="timeline-value">${escapeHtml(formatValue(record))}</span>`,
      ].join("");

      els.timeline.appendChild(item);
    });
  }

  function renderTrendChart(records) {
    if (!records.length) {
      renderEmptyChart("No trend data available.");
      return;
    }

    const chartRecords = records.filter((record) => Number.isFinite(record.numericValue));
    if (!chartRecords.length) {
      renderEmptyChart("Values exist, but they are not numeric enough to plot.");
      return;
    }

    const svg = els.trendChart;
    const width = 560;
    const height = 280;
    const padding = { top: 24, right: 24, bottom: 54, left: 52 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const minValue = Math.min(...chartRecords.map((record) => record.numericValue));
    const maxValue = Math.max(...chartRecords.map((record) => record.numericValue));
    const range = maxValue - minValue || 1;

    const points = chartRecords.map((record, index) => {
      const x = padding.left + (chartRecords.length === 1 ? innerWidth / 2 : (index / (chartRecords.length - 1)) * innerWidth);
      const y = padding.top + ((maxValue - record.numericValue) / range) * innerHeight;
      return { ...record, x, y };
    });

    const selectedKey = state.selectedTimelineKey ?? chartRecords[chartRecords.length - 1].timelineKey;
    const selectedPoint = points.find((point) => point.timelineKey === selectedKey) || points[points.length - 1];
    const pathData = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

    const gridLines = 4;
    const yAxis = Array.from({ length: gridLines + 1 }, (_, index) => {
      const ratio = index / gridLines;
      const value = maxValue - ratio * range;
      const y = padding.top + ratio * innerHeight;
      return { value, y };
    });

    svg.innerHTML = [
      '<defs>',
      '<linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">',
      '<stop offset="0%" stop-color="rgba(15,118,110,0.34)"></stop>',
      '<stop offset="100%" stop-color="rgba(15,118,110,0.02)"></stop>',
      "</linearGradient>",
      "</defs>",
      yAxis.map((tick) => `<line x1="${padding.left}" y1="${tick.y}" x2="${width - padding.right}" y2="${tick.y}" stroke="rgba(22,32,32,0.09)" stroke-dasharray="4 6"></line>`).join(""),
      yAxis.map((tick) => `<text x="${padding.left - 10}" y="${tick.y + 4}" text-anchor="end" font-size="11" fill="#5a6968">${formatCompactNumber(tick.value)}</text>`).join(""),
      `<path d="${pathData} L ${points[points.length - 1].x.toFixed(2)} ${height - padding.bottom} L ${points[0].x.toFixed(2)} ${height - padding.bottom} Z" fill="url(#trendFill)"></path>`,
      `<path d="${pathData}" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>`,
      points.map((point) => {
        const isSelected = point.timelineKey === selectedPoint.timelineKey;
        return `<circle cx="${point.x}" cy="${point.y}" r="${isSelected ? 7 : 5}" fill="${isSelected ? "#d97706" : "#0f766e"}" stroke="#ffffff" stroke-width="3"></circle>`;
      }).join(""),
      points.map((point) => `<text x="${point.x}" y="${height - 20}" text-anchor="middle" font-size="11" fill="#5a6968">${escapeHtml(shortLabel(point.timelineLabel || point.dateLabel))}</text>`).join(""),
      `<text x="${selectedPoint.x}" y="${Math.max(18, selectedPoint.y - 14)}" text-anchor="middle" font-size="12" font-weight="700" fill="#162020">${escapeHtml(formatValue(selectedPoint))}</text>`,
    ].join("");

    els.valueSummary.textContent = `${formatValue(selectedPoint)} on ${selectedPoint.timelineLabel || selectedPoint.dateLabel}`;
  }

  function renderEmptyChart(message) {
    els.trendChart.innerHTML = [
      '<rect x="0" y="0" width="560" height="280" rx="20" fill="rgba(255,255,255,0.86)"></rect>',
      '<text x="280" y="140" text-anchor="middle" font-size="15" font-weight="700" fill="#5a6968">',
      escapeHtml(message),
      "</text>",
    ].join("");
    els.valueSummary.textContent = "No numeric trend";
  }

  function refreshMarkerStyles() {
    markers.forEach((marker, locationName) => {
      const isActive = locationName === state.selectedLocation;
      const isStp = isSewageTreatmentPlant(locationName);
      marker.setStyle({
        radius: isActive ? 12 : 8,
        fillColor: isActive ? "#7c2d12" : (isStp ? "#d97706" : "#0f766e"),
        color: "#ffffff",
        weight: isActive ? 3 : 2,
      });
    });

    const activeMarker = markers.get(state.selectedLocation);
    if (activeMarker) {
      activeMarker.openPopup();
    }
  }

  function updateMapLabels() {
    const selectedParameter = state.selectedParameter;

    markers.forEach((marker, locationName) => {
      const records = groupedRecords.get(locationName) || [];
      const parameterRecords = records
        .filter((record) => record.parameter === selectedParameter)
        .sort((a, b) => a.sortKey - b.sortKey || a.fileName.localeCompare(b.fileName));

      const latestRecord = parameterRecords[parameterRecords.length - 1];

      if (!latestRecord) {
        marker.unbindTooltip();
        marker.bindTooltip("", {
          permanent: true,
          direction: "top",
          offset: [0, -14],
          className: "point-value-tooltip is-hidden",
          opacity: 0,
        });
        return;
      }

      const labelValue = Number.isFinite(latestRecord.numericValue)
        ? formatCompactNumber(latestRecord.numericValue)
        : latestRecord.rawValue || "NA";

      marker.unbindTooltip();
      marker.bindTooltip(`<span class="point-value-text">${escapeHtml(labelValue)}</span>`, {
        permanent: true,
        direction: "top",
        offset: [0, -14],
        className: "point-value-tooltip",
        opacity: 1,
      });
    });
  }

  function buildYearlySeries(records) {
    const byYear = new Map();

    records.forEach((record) => {
      const key = String(record.year);
      if (!byYear.has(key)) {
        byYear.set(key, []);
      }
      byYear.get(key).push(record);
    });

    return Array.from(byYear.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([year, yearRecords]) => {
        const annualRecords = yearRecords.filter((record) => !record.monthIndex);
        const monthlyRecords = yearRecords.filter((record) => record.monthIndex);
        const preferred = annualRecords.length ? annualRecords : monthlyRecords;
        const numericRecords = preferred.filter((record) => Number.isFinite(record.numericValue));
        const averageValue = numericRecords.length
          ? numericRecords.reduce((sum, record) => sum + record.numericValue, 0) / numericRecords.length
          : null;
        const sourceLabel = annualRecords.length
          ? `Annual reading${annualRecords.length > 1 ? `s (${annualRecords.length})` : ""}`
          : `Average of ${monthlyRecords.length} month${monthlyRecords.length === 1 ? "" : "s"}`;

        return {
          ...preferred[preferred.length - 1],
          rawValue: averageValue == null ? preferred[preferred.length - 1].rawValue : String(averageValue),
          numericValue: averageValue,
          timelineKey: Number(year) * 100,
          timelineLabel: String(year),
          timelineMeta: sourceLabel,
          dateLabel: String(year),
          sortKey: Number(year) * 100,
        };
      });
  }

  function isSewageTreatmentPlant(locationName) {
    return /stp|sewage treatment plant|diggian|3brd|chilla/i.test(String(locationName));
  }

  function formatValue(record) {
    if (!record) {
      return "No value";
    }

    if (Number.isFinite(record.numericValue)) {
      return `${formatCompactNumber(record.numericValue)} ${record.unit || ""}`.trim();
    }

    return `${record.rawValue || "No value"} ${record.unit || ""}`.trim();
  }

  function formatCompactNumber(value) {
    if (!Number.isFinite(value)) {
      return "NA";
    }

    if (Math.abs(value) >= 1000000) {
      return value.toExponential(1);
    }

    if (Math.abs(value) >= 1000) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    if (Math.abs(value) >= 10) {
      return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
    }

    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function shortLabel(label) {
    const parts = String(label).split(" ");
    if (parts.length >= 2) {
      return `${parts[0].slice(0, 3)} ${parts[1]}`;
    }
    return String(label);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  selectLocation(defaultLocation?.name || "");
})();
