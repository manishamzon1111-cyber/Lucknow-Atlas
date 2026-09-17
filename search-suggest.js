(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));

  function initSuggestions(){
    const input = document.querySelector("#search");
    const searchBox = input?.closest(".search");
    if(!input || !searchBox) return;

    let panel = document.querySelector("#searchSuggestions");
    if(!panel){
      panel = document.createElement("div");
      panel.id = "searchSuggestions";
      panel.className = "search-suggestions hidden";
      panel.setAttribute("role", "listbox");
      searchBox.appendChild(panel);
    }

    const getSites = () => (typeof sites !== "undefined" && Array.isArray(sites)) ? sites : [];

    function close(){
      panel.classList.add("hidden");
      panel.innerHTML = "";
    }

    function render(){
      const q = input.value.trim().toLowerCase();
      if(!q){ close(); return; }

      const matches = getSites()
        .filter(site => [site.name, site.category, site.period, site.year]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q))
        .slice(0, 6);

      if(!matches.length){ close(); return; }

      panel.innerHTML = matches.map(site => {
        const image = site.cover || (site.images?.length ? site.images[0] : "");
        const imageStyle = image
          ? ` style="background-image:url('${encodeURI(image).replace(/'/g, "%27")}')"`
          : "";

        return `<button type="button" class="search-suggestion" role="option" data-site-id="${esc(site.id)}">
          <span class="search-suggestion-img${image ? "" : " fallback"}"${imageStyle}></span>
          <span class="search-suggestion-copy">
            <strong>${esc(site.name)}</strong>
            <small>${esc(site.category || "Place")}${site.year ? ` · ${esc(site.year)}` : ""}</small>
          </span>
        </button>`;
      }).join("");

      panel.classList.remove("hidden");

      panel.querySelectorAll(".search-suggestion").forEach(button => {
        button.addEventListener("click", () => {
          const site = getSites().find(item => String(item.id) === button.dataset.siteId);
          if(!site) return;

          input.value = site.name;
          close();
          if(typeof selectSite === "function") selectSite(site.id, true);
        });
      });
    }

    input.addEventListener("input", render);
    input.addEventListener("focus", () => { if(input.value.trim()) render(); });
    input.addEventListener("keydown", event => {
      if(event.key === "Escape"){
        close();
        input.blur();
      }
    });

    document.addEventListener("pointerdown", event => {
      if(!searchBox.contains(event.target)) close();
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initSuggestions, {once:true});
  }else{
    initSuggestions();
  }
})();
