const PERIOD_COLORS = {
  "Nawabi":"#2d4f73",
  "Royal":"#7c3a4d",
  "Wajid Ali Shah":"#6a4c93",
  "1857":"#b3452f",
  "Memory":"#c17a8a",
  "Cosmopolitan":"#1f7a72",
  "Late 19th c.":"#a67c2e",
  "Modern":"#55606b",
  "Living":"#5c7a3f"
};

const DESKTOP_MARKER_SIZE = 42;
const MOBILE_MARKER_SIZE = 38;
const ACTIVE_MARKER_SIZE = 54;

let sites = [];
let activeCategories = new Set();
let selectedId = null;
let homeMode = true;
let markers = new Map();
let currentGallery = [];
let currentGalleryIndex = 0;
let searchTimer = null;
let userLocationLayer = null;

const map = L.map("map", {
  zoomControl: true,
  preferCanvas: true
}).setView([26.8615, 80.932], 13);

L.maplibreGL({
  style: "https://api.maptiler.com/maps/streets-v4/style.json?key=c9Bu6AtLzobr7JaVeVmk"
}).addTo(map);

function qs(selector){
  return document.querySelector(selector);
}

function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[ch]));
}

function isMobile(){
  return window.matchMedia("(max-width: 900px)").matches;
}

function markerSize(active = false){
  const zoom = map.getZoom();

  if(active){
    if(zoom <= 11) return 38;
    if(zoom <= 13) return 48;
    if(zoom === 14) return 58;
    if(zoom === 15) return 66;
    return 72;
  }

  if(isMobile()){
    if(zoom <= 11) return 24;
    if(zoom <= 12) return 28;
    if(zoom === 13) return 34;
    if(zoom === 14) return 42;
    if(zoom === 15) return 50;
    return 56;
  }

  if(zoom <= 11) return 26;
  if(zoom <= 12) return 30;
  if(zoom === 13) return 36;
  if(zoom === 14) return 44;
  if(zoom === 15) return 54;

  return 62;
}

function markerIcon(site, active = false){
  const src = site.cover || (site.images?.length ? site.images[0] : "");
  const size = markerSize(active);
  const safeSrc = src ? encodeURI(src).replace(/'/g, "%27") : "";

  const html = safeSrc
    ? `<div class="photo-marker${active ? " active" : ""}" style="background-image:url('${safeSrc}')"></div>`
    : `<div class="photo-marker fallback${active ? " active" : ""}"></div>`;

  return L.divIcon({
    className: "marker-shell",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function categories(){
  const list = [...new Set(sites.map(site => site.category || "Heritage"))];

  if(!list.includes("Food")){
    list.push("Food");
  }

  return list;
}

function normalizedSearch(){
  return qs("#search").value.trim().toLowerCase();
}

function visibleSites(){
  const q = normalizedSearch();

  return sites.filter(site => {
    const category = site.category || "Heritage";
    if(!activeCategories.has(category)) return false;
    if(!q) return true;

    const haystack = [
      site.name,
      site.category,
      site.period,
      site.year,
      site.summary
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(q);
  });
}

function filterMarkup(){
  return categories().map(category => {
    const count = sites.filter(site => (site.category || "Heritage") === category).length;
    const checked = activeCategories.has(category);

    return `<label class="filter-chip${checked ? " active" : ""}">
      <input type="checkbox" data-category="${escapeHtml(category)}" ${checked ? "checked" : ""}>
      <span class="filter-chip-name">${escapeHtml(category)}</span>
      <span class="filter-chip-count">${count}</span>
    </label>`;
  }).join("");
}

function renderFilters(){
  const html = filterMarkup();
  qs("#filterList").innerHTML = html;
  qs("#filterListMobile").innerHTML = html;

  document.querySelectorAll(".filter-chip input").forEach(input => {
    input.addEventListener("change", () => {
      const category = input.dataset.category;

      if(input.checked) activeCategories.add(category);
      else activeCategories.delete(category);

      document.querySelectorAll(".filter-chip input").forEach(peer => {
        if(peer.dataset.category !== category) return;
        peer.checked = input.checked;
        peer.closest(".filter-chip")?.classList.toggle("active", input.checked);
      });

      renderMarkers();
      renderSiteList();
      fitSearchResults();
    });
  });
}

function buildHomePattern(list){
  const center = [26.8525, 80.9460];

  const ordered = [...list].sort((a, b) => {
    const ca = String(a.category || "");
    const cb = String(b.category || "");

    if(ca !== cb) return ca.localeCompare(cb);

    return String(a.name || "").localeCompare(
      String(b.name || "")
    );
  });

  const slots = [];

  const ringSizes = [8, 10, 12];
  let placed = 0;
  let ringIndex = 0;

  while(placed < ordered.length){
    const count =
      ringSizes[ringIndex] ||
      Math.max(14, 12 + (ringIndex - 2) * 4);

    const latRadius = .0105 + ringIndex * .0085;
    const lngRadius = .0145 + ringIndex * .0110;

    for(let i = 0; i < count && placed < ordered.length; i++){
      const angle =
        (-90 + (360 / count) * i)
        * Math.PI / 180;

      slots.push([
        center[0] + Math.sin(angle) * latRadius,
        center[1] + Math.cos(angle) * lngRadius
      ]);

      placed++;
    }

    ringIndex++;
  }

  return ordered.map((site, index) => ({
    site,
    lat: slots[index][0],
    lng: slots[index][1]
  }));
}

function renderMarkers(){
  markers.forEach(marker => marker.remove());
  markers.clear();

  const points = homeMode
    ? buildHomePattern(visibleSites())
    : visibleSites().map(site => ({
        site,
        lat: Number(site.lat),
        lng: Number(site.lng)
      }));

  for(const point of points){
    const site = point.site;

    const marker = L.marker(
      [point.lat, point.lng],
      {
        icon: markerIcon(
          site,
          site.id === selectedId
        ),
        title: site.name,
        riseOnHover: true
      }
    ).addTo(map);

    marker.on(
      "click",
      () => selectSite(site.id, true)
    );

    markers.set(site.id, marker);
  }
}


map.on("zoomend", () => {
  renderMarkers();
});

function renderSiteList(){
  const visible = visibleSites();
  qs("#visibleCount").textContent = `${visible.length} ${visible.length === 1 ? "place" : "places"}`;

  const html = visible.map(site => {
    const image = site.cover || (site.images?.length ? site.images[0] : "");
    const thumb = image
      ? `<img class="site-thumb" src="${escapeHtml(image)}" alt="" loading="lazy">`
      : `<span class="site-thumb site-thumb-fallback"></span>`;

    return `<article class="site-item ${site.id === selectedId ? "active" : ""}" data-id="${escapeHtml(site.id)}">
      ${thumb}
      <div class="site-copy">
        <h3>${escapeHtml(site.name)}</h3>
        <p>${escapeHtml(site.category || "Heritage")}${site.year ? ` · ${escapeHtml(site.year)}` : ""}</p>
      </div>
      <span class="site-arrow">›</span>
    </article>`;
  }).join("");

  qs("#siteList").innerHTML = html;

  const mobileList = qs("#siteListMobile");
  if(mobileList) mobileList.innerHTML = html;

  document.querySelectorAll(".site-item").forEach(item => {
    item.addEventListener("click", () => {
      if(item.closest("#filterDrawer")) closeFilters();
      selectSite(item.dataset.id, true);
    });
  });
}

function boundsFor(list){
  return L.latLngBounds(list.map(site => [Number(site.lat), Number(site.lng)]));
}

function fitHome(){
  const points =
    buildHomePattern(visibleSites());

  if(!points.length) return;

  const bounds = L.latLngBounds(
    points.map(point => [
      point.lat,
      point.lng
    ])
  );

  map.fitBounds(bounds, {
    padding: isMobile()
      ? [34,34]
      : [60,60],

    maxZoom: 13,
    animate: false
  });
}

function fitVisible(){
  const visible = visibleSites();
  if(!visible.length) return;

  if(visible.length === 1){
    map.flyTo([visible[0].lat, visible[0].lng], 15, {duration: .35});
    return;
  }

  map.fitBounds(boundsFor(visible).pad(.12), {
    maxZoom: isMobile() ? 13 : 14,
    animate: true
  });
}

function fitSearchResults(){
  if(!normalizedSearch()) return;
  const visible = visibleSites();
  if(!visible.length) return;

  if(visible.length === 1){
    map.flyTo([visible[0].lat, visible[0].lng], 15, {duration: .3});
  }else{
    map.fitBounds(boundsFor(visible).pad(.18), {
      maxZoom: 14,
      animate: true
    });
  }
}

async function fetchGallery(site){
  return (site.images || []).map(src => ({
    full: src,
    display: src,
    title: site.name
  }));
}

function updateGallery(){
  const image = qs("#detailImage");
  const fallback = qs("#imageFallback");
  const count = qs("#galleryCount");
  const strip = qs("#thumbStrip");

  if(!currentGallery.length){
    image.style.display = "none";
    fallback.style.display = "grid";
    fallback.textContent = "No photos available";
    count.textContent = "";
    strip.innerHTML = '<div class="thumb-placeholder">No photos found.</div>';
    return;
  }

  const current = currentGallery[currentGalleryIndex];
  image.src = current.display || current.full;
  image.style.display = "block";
  fallback.style.display = "none";
  count.textContent = `${currentGalleryIndex + 1} / ${currentGallery.length}`;

  strip.innerHTML = currentGallery.map((photo, index) =>
    `<button class="thumb ${index === currentGalleryIndex ? "active" : ""}" data-i="${index}"><img src="${escapeHtml(photo.display || photo.full)}" alt=""></button>`
  ).join("");

  strip.querySelectorAll(".thumb").forEach(button => {
    button.addEventListener("click", () => {
      currentGalleryIndex = Number(button.dataset.i);
      updateGallery();
    });
  });
}

function shiftGallery(step){
  if(currentGallery.length < 2) return;
  currentGalleryIndex = (currentGalleryIndex + step + currentGallery.length) % currentGallery.length;
  updateGallery();
}

function updateLightbox(){
  if(!currentGallery.length) return;
  const photo = currentGallery[currentGalleryIndex];
  qs("#lightboxImage").src = photo.full || photo.display;
  qs("#lightboxCount").textContent = `${currentGalleryIndex + 1} / ${currentGallery.length}`;
}

function openLightbox(){
  if(!currentGallery.length) return;
  qs("#lightbox").classList.remove("hidden");
  qs("#lightbox").setAttribute("aria-hidden", "false");
  updateLightbox();
}

function shiftLightbox(step){
  if(currentGallery.length < 2) return;
  currentGalleryIndex = (currentGalleryIndex + step + currentGallery.length) % currentGallery.length;
  updateLightbox();
  updateGallery();
}

async function showDetail(site){
  // Marker click opens the real detail view directly on every device.
  qs("#mobileSheet").classList.add("hidden");
  qs("#detailDrawer").classList.remove("hidden");
  qs("#detailTitle").textContent = site.name;

  const period = qs("#detailPeriod");
  period.textContent = site.period || site.category || "Lucknow";
  period.style.setProperty("--tag", PERIOD_COLORS[site.period] || "#2d4f73");

  qs("#detailYear").textContent = site.year || "";
  qs("#detailSummary").textContent = site.summary || "";
  const directionsDestination = site.mapsQuery || `${site.name}, Lucknow, Uttar Pradesh, India`;
  qs("#directionsLink").href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(directionsDestination)}`;
  qs("#wikiLink").href = site.wiki
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(site.wiki.replaceAll(" ", "_"))}`
    : "#";

  qs("#sheetTitle").textContent = site.name;
  qs("#sheetMeta").textContent = [site.category || site.period, site.year].filter(Boolean).join(" · ");

  currentGallery = [];
  currentGalleryIndex = 0;
  qs("#detailImage").style.display = "none";
  qs("#imageFallback").style.display = "grid";
  qs("#imageFallback").textContent = "Loading photos…";
  qs("#thumbStrip").innerHTML = '<div class="thumb-placeholder">Loading photos…</div>';

  currentGallery = await fetchGallery(site);
  if(selectedId !== site.id) return;
  updateGallery();
}

function selectSite(id, fly = false){
  const site = sites.find(
    item => item.id === id
  );

  if(!site) return;

  if(fly){
    homeMode = false;
  }

  selectedId = id;

  renderMarkers();
  renderSiteList();
  showDetail(site);

  if(fly){
    map.flyTo(
      [
        Number(site.lat),
        Number(site.lng)
      ],
      15,
      {duration: .4}
    );
  }
}

function resetAll(){
  activeCategories =
    new Set(categories());

  selectedId = null;
  homeMode = true;

  qs("#search").value = "";

  renderFilters();
  renderMarkers();
  renderSiteList();

  hideNearestPanel();

  qs("#detailDrawer")
    .classList.add("hidden");

  qs("#mobileSheet")
    .classList.add("hidden");

  fitHome();
}

function distanceKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hideNearestPanel(){
  qs("#nearestPanel")?.remove();
}

function showNearestPanel(nearest){
  hideNearestPanel();

  const panel = document.createElement("div");
  panel.id = "nearestPanel";
  panel.className = "nearest-panel";

  panel.innerHTML = `
    <div class="nearest-head">
      <strong>Nearest places</strong>
      <button type="button" class="nearest-close" aria-label="Close">×</button>
    </div>
    <div class="nearest-list">
      ${nearest.map((site, index) => {
        const distance = site.distance < 1
          ? `${Math.round(site.distance * 1000)} m`
          : `${site.distance.toFixed(1)} km`;

        return `<button class="nearest-row" type="button" data-id="${escapeHtml(site.id)}">
          <span class="nearest-rank">${index + 1}</span>
          <span class="nearest-name">${escapeHtml(site.name)}</span>
          <span class="nearest-dist">${distance}</span>
        </button>`;
      }).join("")}
    </div>`;

  qs(".map-stage").appendChild(panel);
  panel.querySelector(".nearest-close").addEventListener("click", hideNearestPanel);
  panel.querySelectorAll(".nearest-row").forEach(row => {
    row.addEventListener("click", () => {
      hideNearestPanel();
      selectSite(row.dataset.id, true);
    });
  });
}

function nearMe(){
  homeMode = false;
  renderMarkers();

  if(!navigator.geolocation){
    alert("Location is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(position => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    const ranked = sites
      .filter(site => Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lng)))
      .map(site => ({
        ...site,
        distance: distanceKm(lat, lng, Number(site.lat), Number(site.lng))
      }))
      .sort((a, b) => a.distance - b.distance);

    const nearest = ranked.slice(0, 3);
    if(!nearest.length) return;

    userLocationLayer?.remove();
    userLocationLayer = L.layerGroup([
      L.circleMarker([lat, lng], {
        radius: 13,
        stroke: false,
        fillColor: "#2776b7",
        fillOpacity: .16
      }),
      L.circleMarker([lat, lng], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: "#2776b7",
        fillOpacity: 1
      })
    ]).addTo(map);

    qs("#detailDrawer").classList.add("hidden");
    qs("#mobileSheet").classList.add("hidden");
    map.setView([lat, lng], 14, {animate: true});
    showNearestPanel(nearest);
  }, error => {
    if(error.code === 1) alert("Location permission was denied.");
    else if(error.code === 2) alert("Your location is currently unavailable.");
    else alert("Could not determine your location.");
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 30000
  });
}

function openFilters(){
  if(isMobile()){
    qs("#filterDrawer").classList.add("open");
  }else{
    document.body.classList.toggle("sidebar-collapsed");
    window.setTimeout(() => map.invalidateSize(), 180);
  }
}

function closeFilters(){
  qs("#filterDrawer").classList.remove("open");
}

function wire(){
  qs("#search").addEventListener("input", () => {
    window.clearTimeout(searchTimer);

    searchTimer = window.setTimeout(() => {
      const hasQuery =
        Boolean(normalizedSearch());

      homeMode = !hasQuery;
      selectedId = null;

      renderMarkers();
      renderSiteList();

      if(hasQuery){
        fitSearchResults();
      }else{
        fitHome();
      }
    }, 110);
  });

  qs("#search").addEventListener("keydown", event => {
    if(event.key !== "Enter") return;

    event.preventDefault();

    if(normalizedSearch()){
      homeMode = false;
      renderMarkers();
      fitSearchResults();
    }else{
      homeMode = true;
      renderMarkers();
      fitHome();
    }
  });

  const fitAllReal = () => {
    homeMode = false;
    renderMarkers();
    fitVisible();
  };

  qs("#fitBtn")
    .addEventListener(
      "click",
      fitAllReal
    );

  qs("#fitBtnMobile")
    .addEventListener(
      "click",
      fitAllReal
    );
  qs("#nearBtn").addEventListener("click", nearMe);
  qs("#nearBtnMobile").addEventListener("click", nearMe);
  qs("#resetFilters").addEventListener("click", resetAll);
  qs("#resetFiltersMobile").addEventListener("click", resetAll);
  qs("#filterOpen").addEventListener("click", openFilters);
  qs("#filterClose").addEventListener("click", closeFilters);
  qs("#drawerBackdrop").addEventListener("click", closeFilters);
  qs("#applyFilters").addEventListener("click", closeFilters);

  qs("#detailClose").addEventListener("click", () => {
    qs("#detailDrawer").classList.add("hidden");
    qs("#mobileSheet").classList.add("hidden");
  });

  qs("#sheetExpand").addEventListener("click", () => {
    qs("#mobileSheet").classList.add("hidden");
    qs("#detailDrawer").classList.remove("hidden");
  });

  qs("#focusBtn").addEventListener("click", () => {
    const site = sites.find(item => item.id === selectedId);
    if(!site) return;

    if(isMobile()){
      qs("#detailDrawer").classList.add("hidden");
      qs("#mobileSheet").classList.add("hidden");

      window.setTimeout(() => {
        map.invalidateSize();
        map.flyTo([site.lat, site.lng], 16, {duration: .4});
      }, 60);

      return;
    }

    map.flyTo([site.lat, site.lng], 15, {duration: .4});
  });

  qs("#galleryPrev").addEventListener("click", () => shiftGallery(-1));
  qs("#galleryNext").addEventListener("click", () => shiftGallery(1));
  qs("#detailImage").addEventListener("click", openLightbox);
  qs("#lightboxClose").addEventListener("click", () => qs("#lightbox").classList.add("hidden"));
  qs("#lightboxPrev").addEventListener("click", () => shiftLightbox(-1));
  qs("#lightboxNext").addEventListener("click", () => shiftLightbox(1));
  qs("#lightbox").addEventListener("click", event => {
    if(event.target.id === "lightbox") event.currentTarget.classList.add("hidden");
  });

  document.addEventListener("keydown", event => {
    if(qs("#lightbox").classList.contains("hidden")) return;
    if(event.key === "Escape") qs("#lightbox").classList.add("hidden");
    if(event.key === "ArrowLeft") shiftLightbox(-1);
    if(event.key === "ArrowRight") shiftLightbox(1);
  });

  window.addEventListener("resize", () => {
    renderMarkers();
    window.setTimeout(() => map.invalidateSize(), 0);
  });
}

async function init(){
  try{
    const response = await fetch("./sites.json", {cache: "no-store"});
    if(!response.ok) throw new Error(`sites.json returned ${response.status}`);

    sites = await response.json();
    activeCategories = new Set(categories());
    homeMode = true;

    renderFilters();
    renderMarkers();
    renderSiteList();
    wire();

    qs("#mobileSheet").classList.add("hidden");
    fitHome();

    window.setTimeout(() => map.invalidateSize(), 0);
  }catch(error){
    console.error("Lucknow Atlas failed to initialize:", error);
    qs("#visibleCount").textContent = "Unable to load places";
  }
}

init();
