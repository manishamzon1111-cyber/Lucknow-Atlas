const $ = (selector) => document.querySelector(selector);
let result = null;
let activeIssue = null;
let allSites = [];
let editingSite = null;
let editCandidates = [];
// "old:img/foo/1.jpg" or "new:2" — held in state so reordering or re-rendering
// the photo lists cannot silently reset the choice.
let editCoverRef = "";
let editMarkerRef = "";
let editAutofilling = false;

const fields = [
  ["name", "Name", "wide"],
  ["id", "ID", "wide"],
  ["category", "Category", ""],
  ["period", "Period", ""],
  ["year", "Year", ""],
  ["wiki", "Wikipedia title", ""],
  ["lat", "Latitude", ""],
  ["lng", "Longitude", ""],
  ["coordVerified", "Coordinate confidence", ""],
  ["coordSource", "Coordinate source", "wide"],
  ["mapsQuery", "Maps query", "full"],
  ["summary", "Summary", "full", "textarea"],
];

function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast${error ? " error" : ""}`;
  setTimeout(() => el.classList.add("hidden"), 6000);
}
$("#toast").onclick = () => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  $("#toast").classList.add("hidden");
};

// Wraps an async click handler so a button cannot be fired twice while it runs.
function busy(button, label, action) {
  return async (...args) => {
    if (!button || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      return await action(...args);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
}

async function loadStatus() {
  try {
    const data = await api("/api/status");
    const providers = [data.providers.serper && "Serper"].filter(Boolean);
    $("#status").textContent =
      `${data.places} places · ${providers.length ? providers.join(" + ") : "no search key"}`;
    $("#providerState").textContent = providers.length
      ? `Active: ${providers.join(" and ")}`
      : "No search API configured. Wikipedia, Commons and OpenStreetMap will still work.";
  } catch (error) {
    $("#status").textContent = "Connection failed";
    toast(error.message, true);
  }
}
async function loadIssues() {
  const box = $("#issues");
  box.innerHTML = '<p class="muted">Loading suggestions…</p>';
  try {
    const { issues } = await api("/api/issues");
    box.innerHTML = issues.length
      ? issues
          .map(
            (issue) =>
              `<article class="issue"><div><strong>${escapeHtml(issue.name)}</strong><br><small>#${issue.number} · ${escapeHtml(issue.category || "Uncategorised")} · <a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">open issue</a></small><p>${escapeHtml(issue.reason || issue.location || "")}</p></div><button data-issue="${issue.number}">Check</button></article>`,
          )
          .join("")
      : '<p class="muted">No open place suggestions.</p>';
    box.querySelectorAll("button[data-issue]").forEach(
      (button) =>
        (button.onclick = () => {
          const issue = issues.find(
            (item) => item.number === Number(button.dataset.issue),
          );
          runResearch(issue, button);
        }),
    );
  } catch (error) {
    box.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

function renderDraft(draft) {
  $("#draftForm").innerHTML = fields
    .map(
      ([key, label, size, type]) =>
        `<label class="field ${size}"><span>${label}</span>${type === "textarea" ? `<textarea name="${key}" required>${escapeHtml(draft[key])}</textarea>` : `<input name="${key}" value="${escapeHtml(draft[key])}" ${["name", "id", "category", "lat", "lng", "coordSource", "mapsQuery"].includes(key) ? "required" : ""}>`}</label>`,
    )
    .join("");
}
function updateCount() {
  const selected = [
    ...document.querySelectorAll('.photo input[type="checkbox"]:checked'),
  ];
  $("#photoCount").textContent =
    selected.length > 8
      ? `${selected.length} selected · max 8`
      : `${selected.length} of 8 selected`;
  $("#photoCount").classList.toggle("pill-warn", selected.length > 8);
  document
    .querySelectorAll(".photo")
    .forEach((card) =>
      card.classList.toggle(
        "selected",
        card.querySelector('input[type="checkbox"]').checked,
      ),
    );
  const checkedRadios = [...document.querySelectorAll('#photos .photo input[type="radio"]')];
  checkedRadios.forEach(
    (radio) =>
      (radio.disabled = !radio
        .closest(".photo")
        .querySelector('input[type="checkbox"]').checked),
  );
  for (const name of ["cover", "marker"])
    if (selected.length && !checkedRadios.some((r) => r.name === name && r.checked && !r.disabled))
      selected[0].closest(".photo").querySelector(`input[name="${name}"]`).checked = true;
  updateAddState();
}
function renderPhotos(images) {
  $("#photos").innerHTML = images
    .map(
      (image, index) =>
        `<article class="photo"><img src="${escapeHtml(image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.photo').classList.add('broken')"><div class="photo-body"><div class="photo-title" title="${escapeHtml(image.title)}">${escapeHtml(image.title || "Photo candidate")}</div><div class="photo-meta" title="${escapeHtml(image.source)}">${escapeHtml(image.source || "Unknown source")}${image.width ? ` · ${image.width}×${image.height}` : ""}</div><label><input type="checkbox" data-photo="${index}"> Add to gallery</label><div class="image-roles"><label><input type="radio" name="cover" value="${index}"> Gallery cover</label><label><input type="radio" name="marker" value="${index}"> Map pin</label></div></div></article>`,
    )
    .join("");
  $("#photos")
    .querySelectorAll("input")
    .forEach((input) => (input.onchange = updateCount));
  updateCount();
}
function renderSources(data) {
  const all = [
    ...data.wiki.map((x) => ({ title: `Wikipedia: ${x.title}`, url: x.url })),
    ...data.geo.map((x) => ({ title: `Map: ${x.name}`, url: x.source })),
    ...data.web,
  ];
  $("#sources").innerHTML =
    all
      .filter((x) => x.url)
      .map(
        (x) =>
          `<a href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">${escapeHtml(x.title || x.url)}</a>`,
      )
      .join("") || '<p class="muted">No sources returned.</p>';
}
function renderCoordinates(consensus) {
  const box = $("#coordinateReview");
  const selected = consensus?.selected;
  const providers = consensus?.providers || [];
  if (!selected) {
    box.innerHTML =
      '<h3>Coordinate verification</h3><p class="warnings">No coordinate source returned a usable marker. Adding is blocked.</p>';
    return;
  }
  const mapUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${selected.lat},${selected.lng}`)}&output=embed`;
  box.innerHTML = `<div class="section-head"><div><h3>Coordinate verification</h3><p>${consensus.verified ? `Verified: ${providers.length} independent sources agree within 250 m.` : "Not verified: at least two independent sources must agree within 250 m."}</p></div><span class="pill">${consensus.verified ? "MULTI-SOURCE MATCH" : "ADDING BLOCKED"}</span></div><div class="coordinate-grid"><iframe src="${mapUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Coordinate preview"></iframe><div class="evidence">${consensus.candidates.map((item) => `<article class="evidence-item ${item.agrees ? "agrees" : ""}"><strong>${escapeHtml(item.provider)}</strong><div>${Number(item.lat).toFixed(6)}, ${Number(item.lng).toFixed(6)}</div><small>${item.distance === 0 ? "Selected marker" : `${item.distance} m from selected marker`}</small>${item.source ? `<br><a href="${escapeHtml(item.source)}" target="_blank" rel="noreferrer">Open source</a>` : ""}</article>`).join("")}</div></div><label class="confirm-coordinate"><input id="coordinateConfirmed" type="checkbox" ${consensus.verified ? "" : "disabled"}> I inspected the map and confirm that the marker is on the correct place.</label>`;
  $("#coordinateConfirmed")?.addEventListener("change", updateAddState);
}
function updateAddState() {
  const verified = Boolean(result?.coordinateConsensus?.verified);
  const confirmed = Boolean($("#coordinateConfirmed")?.checked);
  const count = document.querySelectorAll(
    '#photos input[type="checkbox"]:checked',
  ).length;
  const photosOk = count >= 1 && count <= 8;
  $("#addBtn").disabled = !(verified && confirmed && photosOk);
  $("#saveNote").textContent = !verified
    ? "Adding is blocked until two coordinate sources agree."
    : !confirmed
      ? "Inspect the map and confirm its marker before adding."
      : count === 0
        ? "Select at least one photo."
        : count > 8
          ? `${count} photos selected. Remove ${count - 8} to get down to 8.`
          : "Coordinates confirmed. Review the remaining details and photos.";
}

async function runResearch(input, button) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Checking…";
  }
  activeIssue = input.number || null;
  try {
    result = await api("/api/research", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        category: input.category,
        location: input.location,
      }),
    });
    $("#reviewTitle").textContent = result.draft.name || input.name;
    renderDraft(result.draft);
    renderCoordinates(result.coordinateConsensus);
    [...document.querySelectorAll('[name="lat"],[name="lng"]')].forEach(
      (input) =>
        input.addEventListener("input", () => {
          if ($("#coordinateConfirmed"))
            $("#coordinateConfirmed").checked = false;
          updateAddState();
        }),
    );
    renderPhotos(result.images);
    renderSources(result);
    const warnings = [...result.warnings];
    if (!result.draft.summary)
      warnings.push(
        "No reliable summary was found. Write and verify one before adding.",
      );
    if (!result.draft.lat || !result.draft.lng)
      warnings.push(
        "Coordinates were not found. Supply verified coordinates before adding.",
      );
    if (!result.coordinateConsensus?.verified)
      warnings.push(
        "Coordinates are not corroborated by two independent sources within 250 metres. Adding is blocked.",
      );
    $("#warnings").className = warnings.length ? "warnings" : "hidden";
    $("#warnings").innerHTML = warnings
      .map((x) => `<div>⚠ ${escapeHtml(x)}</div>`)
      .join("");
    $("#review").classList.remove("hidden");
    updateAddState();
    $("#review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

$("#searchForm").onsubmit = (event) => {
  event.preventDefault();
  runResearch({ name: $("#searchName").value.trim() }, event.submitter);
};
$("#refresh").onclick = loadIssues;
$("#settingsToggle").onclick = () =>
  $("#settingsForm").classList.toggle("hidden");
$("#settingsForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        serperKey: $("#serperKey").value.trim(),
      }),
    });
    $("#serperKey").value = "";
    await loadStatus();
    toast("API keys saved locally.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
};
$("#discard").onclick = () => {
  $("#review").classList.add("hidden");
  result = null;
  activeIssue = null;
};
$("#addBtn").onclick = async () => {
  if (!result) return;
  const chosen = [
    ...document.querySelectorAll('.photo input[type="checkbox"]:checked'),
  ].map((input) => ({
    index: Number(input.dataset.photo),
    image: result.images[Number(input.dataset.photo)],
  }));
  if (!chosen.length || chosen.length > 8)
    return toast("Select between 1 and 8 photos.", true);
  const form = Object.fromEntries(new FormData($("#draftForm")));
  const coverOriginal = Number(
    document.querySelector('#photos input[name="cover"]:checked')?.value,
  );
  const markerOriginal = Number(document.querySelector('#photos input[name="marker"]:checked')?.value);
  const coverIndex = Math.max(
    0,
    chosen.findIndex((item) => item.index === coverOriginal),
  );
  const markerIndex = Math.max(0, chosen.findIndex((item) => item.index === markerOriginal));
  if (
    !confirm(
      `Add ${form.name} to sites.json with ${chosen.length} photo${chosen.length === 1 ? "" : "s"}? A backup will be created first.`,
    )
  )
    return;
  const button = $("#addBtn");
  button.disabled = true;
  button.textContent = "Downloading and adding…";
  try {
    const data = await api("/api/add", {
      method: "POST",
      body: JSON.stringify({
        draft: form,
        images: chosen.map((x) => x.image),
        coverIndex,
        markerIndex,
        issueNumber: activeIssue,
        coordinateEvidence: result.coordinateConsensus.candidates,
        coordinateConfirmed: Boolean($("#coordinateConfirmed")?.checked),
      }),
    });
    toast(`${data.entry.name} added safely. Backup: ${data.backup}`);
    $("#review").classList.add("hidden");
    await Promise.all([loadStatus(), loadIssues()]);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.textContent = "Add to Atlas";
    updateAddState();
  }
};

function siteOptions() {
  const term = $("#siteSearch").value.trim().toLowerCase();
  const filtered = allSites.filter((site) => `${site.name} ${site.category} ${site.id}`.toLowerCase().includes(term));
  $("#siteSelect").innerHTML = filtered.map((site) => `<option value="${escapeHtml(site.id)}">${escapeHtml(site.name)} · ${escapeHtml(site.category)}</option>`).join("") || "<option value=''>No matches</option>";
}
async function loadSites() {
  const { sites } = await api("/api/sites");
  allSites = sites.sort((a, b) => a.name.localeCompare(b.name));
  siteOptions();
}
function renderEditPhotos() {
  $("#editPhotos").innerHTML = editingSite.imageDetails.map((image, index) => `<article class="photo edit-photo" data-index="${index}"><img src="/${escapeHtml(image.path)}" alt=""><div class="photo-body"><div class="photo-meta">${image.width}×${image.height}${image.missing ? " · missing" : ""}</div><div class="move-buttons"><button type="button" class="secondary" data-move="up">↑</button><button type="button" class="secondary" data-move="down">↓</button></div><div class="image-roles"><label><input type="radio" name="editCover" value="old:${escapeHtml(image.path)}" ${editCoverRef === `old:${image.path}` ? "checked" : ""}> Gallery cover</label><label><input type="radio" name="editMarker" value="old:${escapeHtml(image.path)}" ${editMarkerRef === `old:${image.path}` ? "checked" : ""}> Map pin</label></div><label class="remove-photo"><input type="checkbox"> Remove</label></div></article>`).join("");
  trackRoleRadios($("#editPhotos"));
  $("#editPhotos").querySelectorAll("[data-move]").forEach((button) => button.onclick = () => {
    const from = Number(button.closest(".edit-photo").dataset.index);
    const to = button.dataset.move === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= editingSite.imageDetails.length) return;
    [editingSite.imageDetails[from], editingSite.imageDetails[to]] = [editingSite.imageDetails[to], editingSite.imageDetails[from]];
    renderEditPhotos();
  });
}
function ensureMorePhotoUI() {
  if ($("#findMorePhotos")) return;
  $("#editPhotos").insertAdjacentHTML("afterend", `<div class="subhead"><div><h3>Add more photos</h3><p>Searches and validates images at least 1200×700.</p><div id="imageSearchStatus" class="image-search-status hidden" aria-live="polite"></div></div><button id="findMorePhotos" type="button" class="secondary">Find more photos</button></div><div id="editCandidates" class="photos"></div>`);
  $("#findMorePhotos").onclick = findMorePhotos;
}
function renderEditCandidates() {
  $("#editCandidates").innerHTML = editCandidates.map((image, index) => `<article class="photo new-photo"><img src="${escapeHtml(image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"><div class="photo-body"><div class="photo-title">${escapeHtml(image.title || "Photo candidate")}</div><div class="photo-meta">${escapeHtml(image.source || "Source")} · ${image.width}×${image.height}</div><label><input type="checkbox" data-new="${index}"> Add photo</label><div class="image-roles"><label><input type="radio" name="editCover" value="new:${index}" ${editCoverRef === `new:${index}` ? "checked" : ""}> Gallery cover</label><label><input type="radio" name="editMarker" value="new:${index}" ${editMarkerRef === `new:${index}` ? "checked" : ""}> Map pin</label></div></div></article>`).join("");
  trackRoleRadios($("#editCandidates"));
  $("#editCandidates").querySelectorAll("input[type=radio]").forEach((radio) => radio.addEventListener("change", () => {
    radio.closest(".new-photo").querySelector("input[type=checkbox]").checked = true;
  }));
}
function trackRoleRadios(container) {
  container.querySelectorAll("input[type=radio]").forEach(
    (radio) =>
      radio.addEventListener("change", () => {
        if (radio.name === "editCover") editCoverRef = radio.value;
        if (radio.name === "editMarker") editMarkerRef = radio.value;
      }),
  );
}
async function findMorePhotos() {
  const button = $("#findMorePhotos");
  const status = $("#imageSearchStatus");

  button.disabled = true;
  button.textContent = "Starting…";
  status.textContent = "Starting image search…";
  status.classList.remove("hidden", "error");

  const stream = new EventSource(
    `/api/images/stream?name=${encodeURIComponent(editingSite.name)}`,
  );

  let completed = false;

  const finish = () => {
    stream.close();
    button.disabled = false;
    button.textContent = "Find more photos";
  };

  stream.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    status.textContent = data.message;
    button.textContent = "Checking…";
  });

  stream.addEventListener("result", (event) => {
    completed = true;
    const data = JSON.parse(event.data);

    editCandidates = data.images || [];
    renderEditCandidates();

    status.textContent =
      `${editCandidates.length} valid image${editCandidates.length === 1 ? "" : "s"} found`;

    if (!editCandidates.length)
      status.textContent =
        "No candidate passed the relevance, size and download checks.";

    finish();
  });

  stream.addEventListener("failure", (event) => {
    completed = true;
    const data = JSON.parse(event.data);

    status.textContent = data.error || "Image search failed.";
    status.classList.add("error");
    finish();
  });

  stream.onerror = () => {
    if (completed) return;

    status.textContent =
      "The image-search connection stopped unexpectedly.";
    status.classList.add("error");
    finish();
  };
}
async function fillMissingEditDetails(siteId) {
  const form = $("#editForm");
  if (!form || editingSite?.id !== siteId) return;

  const field = (name) => form.querySelector(`[name="${name}"]`);
  const wasMissing = {
    wiki: !field("wiki")?.value.trim(),
    mapsQuery: !field("mapsQuery")?.value.trim(),
    coordVerified: !field("coordVerified")?.value.trim(),
    coordSource: !field("coordSource")?.value.trim(),
  };

  if (wasMissing.mapsQuery)
    field("mapsQuery").value =
      `${editingSite.name}, Lucknow, Uttar Pradesh, India`;

  // Note: deliberately does NOT write a placeholder into coordVerified —
  // that string used to end up in sites.json if Save was pressed mid-lookup.
  editAutofilling = true;
  setEditBusy(true, "Looking up missing details…");

  try {
    const data = await api("/api/research", {
      method: "POST",
      body: JSON.stringify({
        name: editingSite.name,
        category: editingSite.category,
        location: editingSite.mapsQuery || "",
      }),
    });

    if (editingSite?.id !== siteId) return;

    if (wasMissing.wiki && data.draft?.wiki)
      field("wiki").value = data.draft.wiki;

    if (
      wasMissing.mapsQuery &&
      data.draft?.mapsQuery
    )
      field("mapsQuery").value = data.draft.mapsQuery;

    if (
      data.coordinateConsensus?.verified &&
      data.coordinateConsensus?.selected
    ) {
      if (wasMissing.coordVerified)
        field("coordVerified").value = "high";

      if (wasMissing.coordSource)
        field("coordSource").value =
          data.coordinateConsensus.selected.source ||
          `https://www.google.com/maps?q=${editingSite.lat},${editingSite.lng}`;
    } else {
      if (wasMissing.coordVerified)
        field("coordVerified").value = "low";

      if (wasMissing.coordSource && editingSite.lat && editingSite.lng)
        field("coordSource").value =
          `https://www.google.com/maps?q=${editingSite.lat},${editingSite.lng}`;
    }
  } catch (error) {
    if (editingSite?.id !== siteId) return;

    if (wasMissing.coordVerified)
      field("coordVerified").value = "low";

    if (wasMissing.coordSource && editingSite.lat && editingSite.lng)
      field("coordSource").value =
        `https://www.google.com/maps?q=${editingSite.lat},${editingSite.lng}`;

    console.warn("Could not research missing editor fields:", error);
  } finally {
    if (editingSite?.id === siteId) {
      editAutofilling = false;
      setEditBusy(false);
    }
  }
}
function setEditBusy(isBusy, note = "") {
  const button = $("#saveSite");
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? "Please wait…" : "Save changes";
  button.title = note;
}

function openEditor() {
  editingSite = structuredClone(
    allSites.find((site) => site.id === $("#siteSelect").value),
  );

  if (!editingSite) return;

  if (!editingSite.mapsQuery)
    editingSite.mapsQuery =
      `${editingSite.name}, Lucknow, Uttar Pradesh, India`;

  editCoverRef = editingSite.cover ? `old:${editingSite.cover}` : "";
  editMarkerRef = `old:${editingSite.markerImage || editingSite.cover || ""}`;

  renderDraftInto($("#editForm"), editingSite);
  renderEditPhotos();

  editCandidates = [];
  ensureMorePhotoUI();
  $("#editCandidates").innerHTML = "";
  $("#siteEditor").classList.remove("hidden");

  fillMissingEditDetails(editingSite.id);
}
function renderDraftInto(element, draft) {
  const required = ["name", "id", "category", "lat", "lng", "coordSource", "mapsQuery", "summary"];
  element.innerHTML = fields.map(([key, label, size, type]) => `<label class="field ${size}"><span>${label}</span>${type === "textarea" ? `<textarea name="${key}" ${required.includes(key) ? "required" : ""}>${escapeHtml(draft[key])}</textarea>` : `<input name="${key}" value="${escapeHtml(draft[key])}" ${required.includes(key) ? "required" : ""}>`}</label>`).join("");
}
$("#siteSearch").oninput = siteOptions;
$("#siteSearch").onkeydown = (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  openEditor();
};
$("#editSite").onclick = openEditor;
$("#reloadSites").onclick = () => loadSites().catch((e) => toast(e.message, true));
$("#saveSite").onclick = async () => {
  const cards = [...$("#editPhotos").querySelectorAll(".edit-photo")];
  const kept = cards.filter((card) => !card.querySelector('.remove-photo input').checked).map((card) => editingSite.imageDetails[Number(card.dataset.index)].path);
  const selectedNew = [...$("#editCandidates").querySelectorAll("input[data-new]:checked")].map((input) => ({ original: Number(input.dataset.new), image: editCandidates[Number(input.dataset.new)] }));
  if (kept.length + selectedNew.length > 8) return toast("A place can have at most 8 photos.", true);
  const remap = (value) => value?.startsWith("new:") ? `new:${selectedNew.findIndex((item) => item.original === Number(value.slice(4)))}` : value;
  const coverRef = remap(document.querySelector('input[name="editCover"]:checked')?.value);
  const markerRef = remap(document.querySelector('input[name="editMarker"]:checked')?.value);
  if (coverRef === "new:-1" || markerRef === "new:-1") return toast("Select any new photo chosen as cover or map pin.", true);
  try {
    const saved = await api("/api/site/save", { method: "POST", body: JSON.stringify({ originalId: editingSite.id, draft: Object.fromEntries(new FormData($("#editForm"))), images: kept, newImages: selectedNew.map((item) => item.image), coverRef, markerRef }) });
    toast(`${saved.entry.name} updated. Backup: ${saved.backup}`); $("#siteEditor").classList.add("hidden"); await Promise.all([loadSites(), loadStatus()]);
  } catch (error) { toast(error.message, true); }
};
function describeChangedPath(rawLine) {
  const filePath = rawLine.slice(3).trim().split(" -> ").pop();
  if (filePath === "sites.json") return "Place data (sites.json)";
  const imgMatch = filePath.match(/^img\/([^/]+)\//);
  if (imgMatch) {
    const folder = imgMatch[1];
    const site = allSites.find((s) =>
      (s.images || []).some((img) => img.startsWith(`img/${folder}/`)),
    );
    if (site) return `${site.name} — ${filePath.split("/").pop()}`;
  }
  return filePath;
}
async function checkPublish() {
  const state = await api("/api/publish/status");
  const lines = state.status ? state.status.split("\n").filter(Boolean) : [];
  $("#publishState").innerHTML = lines.length
    ? `<strong>${state.branch}: ${lines.length} changed path(s)</strong><ul class="publish-diff">${lines
        .map((line) => `<li><code>${line.slice(0, 2).trim()}</code> ${escapeHtml(describeChangedPath(line))}</li>`)
        .join("")}</ul>`
    : `${escapeHtml(state.branch)}: no unpublished changes`;
  return state;
}
$("#checkPublish").onclick = () => checkPublish().catch((e) => toast(e.message, true));
$("#publish").onclick = async () => {
  const state = await checkPublish();
  if (!state.status) return toast("There are no changes to publish.", true);
  if (!confirm(`Commit the Atlas changes and push ${state.branch} to GitHub?`)) return;
  const button = $("#publish"); button.disabled = true; button.textContent = "Publishing…";
  try { const data = await api("/api/publish", { method: "POST", body: JSON.stringify({ confirmed: true, message: $("#commitMessage").value }) }); $("#publishState").innerHTML = `<a href="${data.githubUrl}" target="_blank" rel="noreferrer">Published ${data.sha.slice(0, 7)} to GitHub</a>. ${escapeHtml(data.deployment)}`; toast("GitHub push succeeded."); }
  catch (error) { toast(error.message, true); } finally { button.disabled = false; button.textContent = "Publish main"; }
};

loadStatus();
loadIssues();
loadSites().catch((error) => toast(error.message, true));


/* Atlas workspace navigation */
function setupWorkspaceNavigation() {
  const main = document.querySelector("main");
  if (!main || document.querySelector("#workspaceNav")) return;

  const settingsCard = document.querySelector("#settingsToggle")?.closest(".card");
  const searchCard = document.querySelector("#searchForm")?.closest(".card");
  const suggestionsCard = document.querySelector("#issues")?.closest(".card");
  const editorCard = document.querySelector("#siteEditor")?.closest(".card");
  const reviewCard = document.querySelector("#review");
  const publishCard = document.querySelector("#publish")?.closest(".card");

  const areas = {
    add: [searchCard, suggestionsCard, reviewCard],
    edit: [editorCard],
    publish: [publishCard],
    settings: [settingsCard],
  };

  const nav = document.createElement("nav");
  nav.id = "workspaceNav";
  nav.className = "workspace-nav";
  nav.setAttribute("aria-label", "Admin sections");
  nav.innerHTML = `
    <div class="workspace-tabs">
      <button type="button" data-workspace="add">Add place</button>
      <button type="button" data-workspace="edit">Edit place</button>
      <button type="button" data-workspace="publish">Publish</button>
    </div>
    <button type="button" class="workspace-settings" data-workspace="settings">
      Settings
    </button>
  `;

  main.prepend(nav);

  const allCards = [...new Set(Object.values(areas).flat().filter(Boolean))];

  function showWorkspace(name) {
    const selected = areas[name] ? name : "add";

    allCards.forEach((card) => {
      const shouldShow = areas[selected].includes(card);
      card.classList.toggle("workspace-hidden", !shouldShow);
    });

    nav.querySelectorAll("[data-workspace]").forEach((button) => {
      const active = button.dataset.workspace === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    // The Settings tab used to open onto a collapsed card, so the panel needed
    // a second click to reveal. Expand it with the tab instead.
    const settingsForm = $("#settingsForm");
    const wantsForm = selected === "settings";
    if (settingsForm && settingsForm.classList.contains("hidden") === wantsForm) {
      settingsForm.classList.toggle("hidden", !wantsForm);
      $("#settingsToggle").setAttribute("aria-expanded", String(wantsForm));
      $("#settingsToggle").textContent = wantsForm ? "Hide" : "Configure";
    }

    localStorage.setItem("atlasWorkspace", selected);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  nav.querySelectorAll("[data-workspace]").forEach((button) => {
    button.addEventListener("click", () => showWorkspace(button.dataset.workspace));
  });

  window.showAtlasWorkspace = showWorkspace;
  showWorkspace(localStorage.getItem("atlasWorkspace") || "add");
}

setupWorkspaceNavigation();
