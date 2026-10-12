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
  };
  apply();
  system.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("#theme");
    select.value = preference;
    select.addEventListener("change", () => {
      preference = select.value;
      apply();
      try { localStorage.setItem("rex-theme", preference); } catch {}
    });
  });
})();
