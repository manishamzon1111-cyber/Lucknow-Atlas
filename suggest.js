(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);

  const modal = $("#suggestModal");
  const form = $("#suggestForm");

  if (!modal || !form) {
    console.error("Suggest landmark UI not found.");
    return;
  }

  const openModal = () => {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("suggest-open");
    window.setTimeout(() => { $("#suggestName")?.focus(); }, 50);
  };

  const closeModal = () => {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("suggest-open");
  };

  $("#suggestPlaceBtn")?.addEventListener("click", openModal);

  $("#suggestPlaceBtnMobile")?.addEventListener("click", () => {
    $("#filterDrawer")?.classList.remove("open");
    openModal();
  });

  $("#suggestModalClose")?.addEventListener("click", closeModal);

  modal.querySelector("[data-suggest-close]")
    ?.addEventListener("click", closeModal);

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!form.reportValidity()) return;

    const name = $("#suggestName").value.trim();
    const category = $("#suggestCategory").value.trim() || "Not sure";
    const location = $("#suggestLocation").value.trim();
    const details = $("#suggestDetails").value.trim() || "Not provided";
    const source = $("#suggestSource").value.trim() || "Not provided";
    const honeypot = $("#suggestHoneypot")?.value.trim() || "";

    const submitBtn = form.querySelector(".suggest-submit");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, location, details, source, honeypot }),
      });

      if (!res.ok) throw new Error("Request failed");

      form.reset();
      closeModal();
      alert("Thanks! Your suggestion has been submitted for review.");
    } catch (err) {
      console.error(err);
      alert("Something went wrong sending your suggestion. Please try again.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
})();
