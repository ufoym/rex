import { starterDocument } from "../core/starter.js";
import { Renderer } from "./renderer.js";
import { sourceEditor } from "./editor.js";
import { Session } from "../compiler/session.js";
import { project, importProject, loadProject, saveProject, encodeProject } from "../core/project.js";
const $ = (s) => document.querySelector(s),
  status = $("#status"),
  log = $("#log");

function addLog(s) {
  log.textContent = (log.textContent + "\n" + s).slice(-40000);
}
async function init() {
  if (!crossOriginIsolated) {
    if (!("serviceWorker" in navigator))
      throw Error("HTTPS or localhost with COOP/COEP headers is required");
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    if (sessionStorage.getItem("rex-isolation-attempt"))
      throw Error(
        "Cross-origin isolation is unavailable. Use a browser that supports SharedArrayBuffer and configure the response headers.",
      );
    sessionStorage.setItem("rex-isolation-attempt", "1");
    location.reload();
    return;
  }
  sessionStorage.removeItem("rex-isolation-attempt");
  // A controlled page is already isolated and skips registration above.
  // Check for service-worker fixes on each online visit without delaying startup.
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
  const renderer = new Renderer($("#preview"));
  const session = new Session(
    renderer,
    s => { status.textContent = s; updateExport(); },
    addLog,
  );
  let active, saveTimer, previewPosition;
  const fileStates = new Map();
  const source = sourceEditor($("#editor"), {
    onChange: text => {
      session.edit(text, active);
      updateExport();
      clearLocation();
      $("#storage-status").textContent = "Saving…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {saveTimer = null; persist();}, 500);
    },
    onSelection: () => position(), onCompile: () => session.full(), onLocate: () => locate(),
  });
  const editor = source.view;
  window.rex = { session, renderer, editor };
  async function persist() {
    try {
      await saveProject({files: session.files, main: session.main, active});
      if (!saveTimer) $("#storage-status").textContent = "Saved in this browser";
    } catch (error) {
      addLog(String(error));
      $("#storage-status").textContent = "Not saved · download a backup";
      status.textContent = "Browser storage unavailable · download your project to keep it";
    }
  }
  function updateExport() {
    $("#export").disabled = !session.layout?.pdf || session.layout.revision !== session.revision || session.busy;
    if (previewPosition && !renderer.container.querySelector(".source-marker")) clearLocation();
  }
  function selectFile(name) {
    if (active) fileStates.set(active, editor.state);
    active = name;
    const saved = fileStates.get(name);
    source.select(saved?.doc.toString() === session.files[name] ? saved : source.state(session.files[name]));
    $("#filename").value = name;
    clearLocation();
    position();
  }
  function openProject(value) {
    clearTimeout(saveTimer);
    saveTimer = null;
    active = null;
    fileStates.clear();
    clearLocation();
    session.setFiles(value.files, value.main);
    $("#filename").replaceChildren(...Object.keys(value.files).filter(name => typeof value.files[name] === "string").map(name => {
      const option = document.createElement("option"); option.value = name;
      option.textContent = name === value.main ? `${name} · main` : name; return option;
    }));
    selectFile(value.active);
  }
  let restored;
  try { restored = await loadProject(); } catch (error) { addLog(String(error)); }
  let legacy;
  try { legacy = localStorage.getItem("rex-source"); } catch {}
  openProject(restored || project({"main.tex": legacy || starterDocument}, "main.tex"));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(saveTimer); saveTimer = null; persist(); } });
  $("#compile").onclick = () => session.full();
  $("#search").onclick = source.search;
  $("#toggle-log").onclick = () => {
    log.hidden = !log.hidden;
    $("#toggle-log").firstChild.textContent = log.hidden ? "Show compilation log" : "Hide compilation log";
    $("#toggle-log").setAttribute("aria-expanded", String(!log.hidden));
  };
  $("#choose-files").onclick = () => $("#open").click();
  $("#choose-folder").onclick = () => $("#open-folder").click();
  const menus = [...document.querySelectorAll("details.menu")];
  for (const menu of menus) menu.addEventListener("toggle", () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
  });
  document.addEventListener("click", event => {
    for (const menu of menus) {
      if (!menu.contains(event.target) || (event.target.closest("button") && event.target.id !== "benchmark")) menu.open = false;
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const menu of menus) if (menu.open) {menu.open = false; menu.querySelector("summary").focus();}
    clearLocation(true);
  });
  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $("#save").onclick = () => download(editor.state.doc.toString(), active, "text/plain");
  $("#save-project").onclick = () => download(encodeProject({files: session.files, main: session.main, active}), session.main.replace(/\.tex$/, ".rex"), "application/octet-stream");
  $("#filename").onchange = event => { selectFile(event.target.value); persist(); };
  $("#export").onclick = () => {
    if (session.layout?.revision !== session.revision) {
      status.textContent = "Wait for full compilation before exporting";
      session.full();
      return;
    }
    download(
      session.layout.pdf,
      session.main.replace(/\.tex$/, ".pdf"),
      "application/pdf",
    );
  };
  $("#open").onchange = async (e) => {
    try {
      openProject(await importProject(e.target.files));
      await persist();
    } catch (error) { status.textContent = String(error); }
    finally { e.target.value = ""; }
  };
  $("#open-folder").onchange = $("#open").onchange;
  function clearLocation(restore = false) {
    renderer.container.querySelector(".source-marker")?.remove();
    if (restore && previewPosition) renderer.container.scrollTo(previewPosition);
    previewPosition = null;
    $("#clear-location").hidden = true;
  }
  function highlight(unit) {
    previewPosition ||= {top: renderer.container.scrollTop, left: renderer.container.scrollLeft};
    renderer.locate(unit);
    $("#clear-location").hidden = !renderer.container.querySelector(".source-marker");
  }
  $("#clear-location").onclick = () => clearLocation(true);
  const locate = () => {
    const mapping = session.layoutFiles?.[active], spans = session.currentSpans.get(active);
    const cursor = editor.state.selection.main.head;
    const index = spans?.findIndex(span => cursor >= span.start && cursor <= span.end);
    const unit = mapping?.blocks[index]?.[0]?.unit;
    if (session.contextDirty) { status.textContent = "Compile to refresh source locations"; return; }
    if (!unit) { status.textContent = "No paragraph location available here"; return; }
    highlight(unit);
  };
  $("#locate").onclick = locate;
  renderer.onSource = unit => {
    const file = unit.file?.replace(/^\/work\//, "");
    const mapping = session.layoutFiles?.[file];
    let index = mapping?.blocks.findIndex(block => block.some(origin => origin.unit?.uid === unit.uid));
    if (index === -1) index = mapping.spans.findIndex(span => span.line === unit.begin_line);
    const span = session.currentSpans.get(file)?.[index];
    if (!span || session.contextDirty) { status.textContent = "Compile to refresh source locations"; return; }
    selectFile(file);
    editor.dispatch({selection: {anchor: span.start, head: span.end}, scrollIntoView: true});
    editor.focus();
    position(); highlight(unit); persist();
  };
  function position() {
    const cursor = editor.state.selection.main.head, line = editor.state.doc.lineAt(cursor);
    $("#position").textContent = `Ln ${line.number}, Col ${cursor - line.from + 1}`;
  }
  $("#benchmark").onclick = async () => {
    const button = $("#benchmark");
    button.disabled = true;
    source.editable(false);
    const controls = ["#choose-files", "#choose-folder", "#filename", "#compile"];
    for (const selector of controls) $(selector).disabled = true;
    $("#benchmark-result").textContent = "Running…";
    clearTimeout(session.timer);
    try {
      const live = session.live,
        unit = session.units?.find(
          (u) => u?.kind === "par" && u.placements?.length,
        ),
        index = session.units?.indexOf(unit);
      if (!unit || !live || session.busy || !session.warmed) throw Error("Wait for compilation to finish, then try again");
      await session.warmed;
      const source = session.layoutSpans[index].text;
      for (let i = 0; i < 20; i++) await live.compile(unit, source);
      const values = [];
      for (let i = 0; i < 300; i++) {
        const r = await live.compile(unit, source + " " + (i % 2 ? "a" : "b"));
        values.push(r.ms);
      }
      values.sort((a, b) => a - b);
      window.rex.benchmark = {
        samples: 300,
        median: values[150],
        p95: values[285],
        withinFrame: values[285] < 16.67,
      };
      status.textContent = `300 paragraph compilations · median ${values[150].toFixed(2)} ms · P95 ${values[285].toFixed(2)} ms`;
      $("#benchmark-result").textContent = `Typical: ${values[150].toFixed(2)} ms · 95% under ${values[285].toFixed(2)} ms. ${values[285] < 16.67 ? "Within a 60 Hz frame budget." : "Slower than a 60 Hz frame."}`;
    } catch (e) {
      status.textContent = String(e);
      $("#benchmark-result").textContent = String(e);
    } finally {
      button.disabled = false;
      source.editable(true);
      for (const selector of controls) $(selector).disabled = false;
      if (session.layout?.revision !== session.revision) session.schedule();
    }
  };
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("./sw.js").catch(addLog);
}
init().catch((e) => {
  status.textContent = String(e);
  addLog(String(e));
});
