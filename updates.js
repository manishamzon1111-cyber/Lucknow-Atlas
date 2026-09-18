(function(){
  "use strict";

  const LIMIT = 6;
  const REFRESH_MS = 60 * 1000;
  const FALLBACK_THUMB = "./img/update-fallback.svg";

  const TYPE_LABELS = {
    heritage_walk: "Heritage walk",
    exhibition: "Exhibition",
    closure: "Closure",
    festival: "Festival",
    notice: "Notice"
  };

  let updates = [];
  let onThisDay = null;

  function esc(value){
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      '"':"&quot;",
      "'":"&#39;"
    }[ch]));
  }

  function parseDate(value){
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function safeUrl(value){
    try{
      const url = new URL(String(value || ""), location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    }catch{
      return "";
    }
  }

  function dateOnly(date){
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(date);
  }

  function timeOnly(date){
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function dayKey(date){
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function formatRange(item){
    const start = parseDate(item.startDate);
    const end = parseDate(item.endDate);

    if(!start || !end) return "";

    if(item.auto && item.publishedAt){
      return `Published ${dateOnly(start)}, ${timeOnly(start)}`;
    }

    if(dayKey(start) === dayKey(end)){
      return `${dateOnly(start)} · ${timeOnly(start)}–${timeOnly(end)}`;
    }

    return `${dateOnly(start)}, ${timeOnly(start)} – ${dateOnly(end)}, ${timeOnly(end)}`;
  }

  function valid(item){
    if(!item || typeof item !== "object") return false;
    if(!String(item.id || "").trim()) return false;
    if(!String(item.title || "").trim()) return false;
    if(!TYPE_LABELS[item.type]) return false;

    const start = parseDate(item.startDate);
    const end = parseDate(item.endDate);

    if(!start || !end || end < start) return false;

    if(
      !item.source ||
      !String(item.source.url || "").trim() ||
      !safeUrl(item.source.url)
    ){
      return false;
    }

    return true;
  }

  function currentItems(data){
    const now = Date.now();

    return data
      .filter(valid)
      .filter(item => parseDate(item.endDate).getTime() >= now)
      .sort((a, b) =>
        parseDate(a.startDate).getTime() -
        parseDate(b.startDate).getTime()
      )
      .slice(0, LIMIT);
  }

  function renderButtons(){
    const desktop = document.getElementById("cityUpdatesBtn");
    const mobile = document.getElementById("cityUpdatesBtnMobile");

    if(!desktop || !mobile) return;

    if(!updates.length){
      desktop.classList.add("hidden");
      mobile.classList.add("hidden");
      closeDrawer();
      return;
    }

    const count = updates.length;

    desktop.innerHTML =
      `City updates <span class="city-updates-count">${count}</span>`;

    mobile.innerHTML =
      `Updates <span class="city-updates-count">${count}</span>`;

    desktop.classList.remove("hidden");
    mobile.classList.remove("hidden");
  }

  function render(){
    const list = document.getElementById("cityUpdatesList");
    if(!list) return;

    list.innerHTML = updates.map(item => {
      const url = safeUrl(item.source.url);
      const imageUrl =
        safeUrl(item.imageUrl) ||
        FALLBACK_THUMB;
      const desc = String(item.description || "").trim();

      return `
        <article class="city-update-card" data-type="${esc(item.type)}">
          <div class="city-update-meta">
            <span class="city-update-type">
              ${esc(TYPE_LABELS[item.type])}
            </span>

            <span class="city-update-date">
              ${esc(formatRange(item))}
            </span>
          </div>

          <img
            class="city-update-thumb"
            src="${esc(imageUrl)}"
            alt=""
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          >

          <h3>${esc(item.title)}</h3>

          ${desc ? `<p>${esc(desc)}</p>` : ""}

          <div class="city-update-actions">
            <a
              href="${esc(url)}"
              target="_blank"
              rel="noopener noreferrer"
            >${esc(item.source.name || "Source")} ↗</a>

            ${
              item.siteId
                ? `<button
                     type="button"
                     class="city-update-map"
                     data-site-id="${esc(item.siteId)}"
                   >Show on map</button>`
                : ""
            }
          </div>
        </article>
      `;
    }).join("");

    list
      .querySelectorAll(".city-update-thumb")
      .forEach(img => {
        img.addEventListener("error", () => {
          if(img.dataset.fallback === "1") return;
          img.dataset.fallback = "1";
          img.src = FALLBACK_THUMB;
        });
      });

    renderOnThisDay();
  }

  function todayKey(){
    const parts =
      new Intl.DateTimeFormat("en-US", {
        timeZone:"Asia/Kolkata",
        month:"2-digit",
        day:"2-digit"
      }).formatToParts(new Date());

    const month =
      parts.find(part => part.type === "month")?.value;

    const day =
      parts.find(part => part.type === "day")?.value;

    return `${month}-${day}`;
  }

  function renderOnThisDay(){
    const box =
      document.getElementById("cityOnThisDay");

    if(!box) return;

    if(!onThisDay){
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }

    const url =
      safeUrl(onThisDay.source?.url);

    box.innerHTML = `
      <div class="city-on-this-day-label">On this day · ${esc(onThisDay.year)}</div>
      <div class="city-on-this-day-row">
        <img
          src="${FALLBACK_THUMB}"
          alt=""
          class="city-on-this-day-thumb"
        >
        <div>
          <strong>${esc(onThisDay.title)}</strong>
          ${
            onThisDay.description
              ? `<p>${esc(onThisDay.description)}</p>`
              : ""
          }
          ${
            url
              ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(onThisDay.source?.name || "Source")} ↗</a>`
              : ""
          }
        </div>
      </div>
    `;

    box.classList.remove("hidden");
  }

  function openDrawer(){
    if(!updates.length) return;

    render();

    document.getElementById("detailDrawer")?.classList.add("hidden");
    document.getElementById("mobileSheet")?.classList.add("hidden");
    document.getElementById("nearestPanel")?.remove();

    document.getElementById("cityUpdatesDrawer")?.classList.add("open");
    document.getElementById("cityUpdatesDrawer")?.setAttribute("aria-hidden", "false");
    document.getElementById("cityUpdatesBackdrop")?.classList.remove("hidden");
  }

  function closeDrawer(){
    document.getElementById("cityUpdatesDrawer")?.classList.remove("open");
    document.getElementById("cityUpdatesDrawer")?.setAttribute("aria-hidden", "true");
    document.getElementById("cityUpdatesBackdrop")?.classList.add("hidden");
  }

  function wire(){
    document.getElementById("cityUpdatesBtn")
      ?.addEventListener("click", openDrawer);

    document.getElementById("cityUpdatesBtnMobile")
      ?.addEventListener("click", openDrawer);

    document.getElementById("cityUpdatesClose")
      ?.addEventListener("click", closeDrawer);

    document.getElementById("cityUpdatesBackdrop")
      ?.addEventListener("click", closeDrawer);

    document.getElementById("cityUpdatesList")
      ?.addEventListener("click", event => {
        const button = event.target.closest("[data-site-id]");
        if(!button) return;

        const id = button.dataset.siteId;
        if(!id) return;

        closeDrawer();

        if(typeof selectSite === "function"){
          selectSite(id, true);
        }
      });

    document.addEventListener("keydown", event => {
      if(event.key === "Escape") closeDrawer();
    });
  }

  async function load(){
    try{
      const [
        manualResult,
        autoResult,
        historyResult
      ] = await Promise.allSettled([
        fetch("./updates.json", {cache:"no-store"}).then(r => {
          if(!r.ok) throw new Error(`updates.json returned ${r.status}`);
          return r.json();
        }),
        fetch("/api/city-updates").then(r => {
          if(!r.ok) throw new Error(`city updates API returned ${r.status}`);
          return r.json();
        }),
        fetch("./on-this-day.json", {cache:"no-store"}).then(r => {
          if(!r.ok) throw new Error(`on-this-day.json returned ${r.status}`);
          return r.json();
        })
      ]);

      const manual =
        manualResult.status === "fulfilled" &&
        Array.isArray(manualResult.value)
          ? manualResult.value
          : [];

      const automatic =
        autoResult.status === "fulfilled" &&
        Array.isArray(autoResult.value)
          ? autoResult.value
          : [];

      const history =
        historyResult.status === "fulfilled" &&
        Array.isArray(historyResult.value)
          ? historyResult.value
          : [];

      onThisDay =
        history.find(item =>
          item?.date === todayKey()
        ) || null;

      const merged = [];
      const ids = new Set();

      for(const item of [...manual, ...automatic]){
        if(!item || ids.has(item.id)) continue;
        ids.add(item.id);
        merged.push(item);
      }

      updates = currentItems(merged);

    }catch(error){
      updates = [];
      console.warn("City updates:", error);
    }

    renderButtons();
    renderOnThisDay();

    if(
      document
        .getElementById("cityUpdatesDrawer")
        ?.classList.contains("open")
    ){
      render();
    }
  }

  function init(){
    wire();
    load();
    window.setInterval(load, REFRESH_MS);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, {once:true});
  }else{
    init();
  }
})();
