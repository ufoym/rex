import { starterDocument } from "../core/starter.js";
import { Renderer } from "./renderer.js";
import { sourceEditor } from "./editor.js";
import { Session } from "../compiler/session.js";
import { project, importProject, loadProject, loadRecentProjects, saveProject, encodeProject } from "../core/project.js";
const $ = (s) => document.querySelector(s),
  status = $("#status"),
  log = $("#log");

function addLog(s) {
  log.textContent = (log.textContent + "\n" + s).slice(-40000);
}
async function init() {
  const local = !!globalThis.rexLocal;
  if (!local && !crossOriginIsolated) {
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
  if (!local) sessionStorage.removeItem("rex-isolation-attempt");
  // A controlled page is already isolated and skips registration above.
  // Check for service-worker fixes on each online visit without delaying startup.
  if (!local && "serviceWorker" in navigator)
    navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
  const renderer = new Renderer($("#preview"));
  const session = new Session(
    renderer,
    (s, details) => {
      status.textContent = s;
      const bar = $("#loading-progress");
      bar.hidden = details?.phase !== "fetching";
      if (details?.totalBytes > 0) { bar.max = details.totalBytes; bar.value = details.loadedBytes || 0; }
      else bar.removeAttribute("value");
      updateExport();
    },
    addLog,
  );
  let active, saveTimer, previewPosition, savedId, savedName;
  let locateTimer, followingCursor = false, locatedUnit;
  const autoLocate = $("#auto-locate");
  try { autoLocate.checked = localStorage.getItem("rex-auto-locate") !== "false"; }
  catch (error) { addLog(String(error)); }
  const fileStates = new Map();
  const source = sourceEditor($("#editor"), {
    onChange: text => {
      savedId ||= crypto.randomUUID();
      session.edit(text, active);
      updateExport();
      if (!autoLocate.checked || session.contextDirty) clearLocation();
      $("#storage-status").textContent = "Saving…";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {saveTimer = null; persist();}, 500);
    },
    onSelection: () => { position(); scheduleLocation(true); }, onCompile: () => session.full(), onLocate: () => locate(),
  });
  const editor = source.view;
  window.rex = { session, renderer, editor };
  async function persist() {
    // Merely viewing the starter must not replace the last saved project.
    if (!savedId) return;
    const value = {files: session.files, main: session.main, active, id: savedId, name: savedName};
    try {
      await saveProject(value);
      if (savedId === value.id && !saveTimer) $("#storage-status").textContent = "Saved in this browser";
    } catch (error) {
      addLog(String(error));
      $("#storage-status").textContent = "Not saved · download a backup";
      status.textContent = "Browser storage unavailable · download your project to keep it";
    }
  }
  function updateExport() {
    $("#export").disabled = !session.layout?.pdf || session.layout.revision !== session.revision || session.busy;
    if (previewPosition && !renderer.container.querySelector(".source-marker") && !followingCursor) clearLocation();
    scheduleLocation();
  }
  function selectFile(name) {
    if (active) fileStates.set(active, editor.state);
    active = name;
    const saved = fileStates.get(name);
    source.select(saved?.doc.toString() === session.files[name] ? saved : source.state(session.files[name]));
    $("#filename").value = name;
    clearLocation();
    position();
    scheduleLocation(true);
  }
  function openProject(value) {
    clearTimeout(saveTimer);
    saveTimer = null;
    active = null;
    savedId = value.id;
    savedName = value.name;
    $("#storage-status").textContent = savedId ? "Saved in this browser" : "Example · edit to save";
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
  const restore = $("#restore-project");
  try {
    restore.checked = localStorage.getItem("rex-restore-project") === "true";
    const legacy = localStorage.getItem("rex-source");
    if (!restored && legacy) {
      restored = {...project({"main.tex": legacy}, "main.tex"), id: "legacy"};
      await saveProject(restored);
    }
  } catch (error) { addLog(String(error)); }
  restore.onchange = () => {
    try { localStorage.setItem("rex-restore-project", String(restore.checked)); }
    catch (error) { addLog(String(error)); status.textContent = "Startup preference could not be saved"; }
  };
  openProject((restore.checked && restored) || project({"main.tex": starterDocument}, "main.tex"));
  async function refreshRecent() {
    const list = $("#recent-projects");
    try {
      const recent = await loadRecentProjects();
      const buttons = recent.map(value => {
        const button = document.createElement("button"), detail = document.createElement("small");
        button.textContent = value.name || value.main;
        detail.textContent = `${value.main} · ${value.updated ? new Date(value.updated).toLocaleString() : "Saved in this browser"}`;
        button.append(detail);
        button.onclick = async () => {
          try {
            await persist();
            const latest = (await loadRecentProjects()).find(entry => entry.id === value.id);
            if (!latest) { status.textContent = "This recent project is no longer available"; return; }
            openProject(latest);
            await persist();
          } catch (error) { addLog(String(error)); status.textContent = "Could not open the recent project"; }
        };
        return button;
      });
      list.replaceChildren(...buttons);
      if (!buttons.length) { const empty = document.createElement("small"); empty.textContent = "No recent files"; list.append(empty); }
    } catch (error) {
      addLog(String(error));
      list.textContent = "Recent files unavailable";
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(saveTimer); saveTimer = null; persist(); } });
  $("#compile").onclick = () => session.full();
  $("#search").onclick = source.search;
  $("#toggle-log").onclick = () => {
    log.hidden = !log.hidden;
    $("#toggle-log").textContent = log.hidden ? "Show log" : "Hide log";
    $("#toggle-log").setAttribute("aria-expanded", String(!log.hidden));
  };
  $("#choose-files").onclick = () => $("#open").click();
  $("#choose-folder").onclick = () => $("#open-folder").click();
  const menus = [...document.querySelectorAll("details.menu")];
  for (const menu of menus) menu.addEventListener("toggle", () => {
    if (menu.open) {
      for (const other of menus) if (other !== menu) other.open = false;
      if (menu.id === "open-menu") refreshRecent();
    }
  });
  document.addEventListener("click", event => {
    for (const menu of menus) {
      if (!menu.contains(event.target) || event.target.closest("button")) menu.open = false;
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
      const value = await importProject(e.target.files);
      const first = e.target.files[0];
      const name = first.webkitRelativePath?.split("/")[0] || (e.target.files.length === 1 ? first.name : value.main);
      await persist();
      openProject({...value, id: crypto.randomUUID(), name});
      await persist();
    } catch (error) { status.textContent = String(error); }
    finally { e.target.value = ""; }
  };
  $("#open-folder").onchange = $("#open").onchange;
  function clearLocation(restore = false) {
    clearTimeout(locateTimer);
    followingCursor = false;
    locatedUnit = null;
    renderer.container.querySelector(".source-marker")?.remove();
    if (restore && previewPosition) {
      const position = {...previewPosition, behavior: "instant"};
      renderer.container.scrollTo(position);
      // A queued smooth-scroll frame can arrive after the immediate restore.
      requestAnimationFrame(() => { if (!locatedUnit) renderer.container.scrollTo(position); });
    }
    previewPosition = null;
  }
  function highlight(unit) {
    previewPosition ||= {top: renderer.container.scrollTop, left: renderer.container.scrollLeft};
    renderer.locate(unit);
    locatedUnit = unit;
  }
  function scheduleLocation(resume = false) {
    if (!autoLocate.checked) return;
    if (resume) followingCursor = true;
    if (!followingCursor) return;
    clearTimeout(locateTimer);
    locateTimer = setTimeout(() => locate(true), 120);
  }
  autoLocate.onchange = () => {
    try { localStorage.setItem("rex-auto-locate", String(autoLocate.checked)); }
    catch (error) { addLog(String(error)); status.textContent = "Navigation preference could not be saved"; }
    if (autoLocate.checked) scheduleLocation(true);
    else clearLocation();
  };
  function locate(automatic = false) {
    clearTimeout(locateTimer);
    const mapping = session.layoutFiles?.[active], spans = session.currentSpans.get(active);
    const cursor = editor.state.selection.main.head;
    const index = spans?.findIndex(span => cursor >= span.start && cursor <= span.end);
    const unit = mapping?.blocks[index]?.[0]?.unit;
    const stale = session.contextDirty || renderer.capture !== session.layout?.capture;
    if (stale || !unit?.placements?.length) {
      if (automatic) {
        clearLocation();
        followingCursor = true; // Retry when the next layout is ready, without replacing compilation status.
      } else status.textContent = stale ? "Compile to refresh source locations" : "No paragraph location available here";
      return;
    }
    if (automatic && unit === locatedUnit && renderer.container.querySelector(".source-marker")) return;
    highlight(unit);
  }
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
    clearTimeout(locateTimer);
    position(); highlight(unit); persist();
  };
  function position() {
    const cursor = editor.state.selection.main.head, line = editor.state.doc.lineAt(cursor);
    $("#position").textContent = `Ln ${line.number}, Col ${cursor - line.from + 1}`;
  }
  if (!local && "serviceWorker" in navigator)
    navigator.serviceWorker.register("./sw.js").catch(addLog);
}
init().catch((e) => {
  status.textContent = String(e);
  addLog(String(e));
});
