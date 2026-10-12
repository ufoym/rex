// Run before the stylesheet so the first paint uses the selected theme.
(() => {
  const system = matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem("rex-theme");
    if (["light", "dark"].includes(saved)) preference = saved;
  } catch {}
  const apply = () => {
    document.documentElement.dataset.theme = preference === "system"
      ? (system.matches ? "dark" : "light") : preference;
    const button = document.querySelector("#theme");
    if (button) {
      const label = `Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} theme`;
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    document.dispatchEvent(new Event("rex-theme-change"));
  };
  apply();
  system.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const set = value => {
      preference = value;
      apply();
      try { localStorage.setItem("rex-theme", preference); } catch {}
    };
    apply();
    document.querySelector("#theme").addEventListener("click", () =>
      set(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  });
})();
