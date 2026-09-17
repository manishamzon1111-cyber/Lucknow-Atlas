const $ = (selector) => document.querySelector(selector);
let result = null;
let activeIssue = null;

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
  $("#photoCount").textContent = `${selected.length} selected`;
  document
    .querySelectorAll(".photo")
    .forEach((card) =>
      card.classList.toggle(
        "selected",
        card.querySelector('input[type="checkbox"]').checked,
      ),
    );
  const checkedRadios = [
    ...document.querySelectorAll('.photo input[type="radio"]'),
  ];
  checkedRadios.forEach(
    (radio) =>
      (radio.disabled = !radio
        .closest(".photo")
        .querySelector('input[type="checkbox"]').checked),
  );
  if (selected.length && !checkedRadios.some((r) => r.checked && !r.disabled)) {
    selected[0].closest(".photo").querySelector('input[type="radio"]').checked =
      true;
  }
}
function renderPhotos(images) {
  $("#photos").innerHTML = images
    .map(
      (image, index) =>
        `<article class="photo"><img src="${escapeHtml(image.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.photo').classList.add('broken')"><div class="photo-body"><div class="photo-title" title="${escapeHtml(image.title)}">${escapeHtml(image.title || "Photo candidate")}</div><div class="photo-meta" title="${escapeHtml(image.source)}">${escapeHtml(image.source || "Unknown source")}${image.width ? ` · ${image.width}×${image.height}` : ""}</div><div class="photo-actions"><label><input type="checkbox" data-photo="${index}"> Select</label><label class="cover"><input type="radio" name="cover" value="${index}"> Cover</label></div></div></article>`,
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
  $("#addBtn").disabled = !(verified && confirmed);
  $("#saveNote").textContent = !verified
    ? "Adding is blocked until two coordinate sources agree."
    : confirmed
      ? "Coordinates confirmed. Review the remaining details and photos."
      : "Inspect the map and confirm its marker before adding.";
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
    document.querySelector('.photo input[type="radio"]:checked')?.value,
  );
  const coverIndex = Math.max(
    0,
    chosen.findIndex((item) => item.index === coverOriginal),
  );
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

loadStatus();
loadIssues();
