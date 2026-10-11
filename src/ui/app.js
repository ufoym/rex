import { starterDocument } from "../core/starter.js";
import { Renderer } from "./renderer.js";
import { Session } from "../compiler/session.js";
import { project, importProject, loadProject, saveProject, encodeProject } from "../core/project.js";
const $ = (s) => document.querySelector(s),
  editor = $("#editor"),
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
  const renderer = new Renderer($("#preview"));
  const session = new Session(
    renderer,
    (s) => (status.textContent = s),
    addLog,
  );
  window.rex = { session, renderer };
  let active, saveTimer;
  const persist = () => saveProject({files: session.files, main: session.main, active}).catch(error => {
    addLog(String(error)); status.textContent = "Browser storage unavailable · save your project to keep it";
  });
  function selectFile(name) {
    active = name; editor.value = session.files[name]; $("#filename").value = name;
    position();
  }
  function openProject(value) {
    clearTimeout(saveTimer);
    session.setFiles(value.files, value.main);
    $("#filename").replaceChildren(...Object.keys(value.files).filter(name => typeof value.files[name] === "string").map(name => {
      const option = document.createElement("option"); option.value = name; option.textContent = name; return option;
    }));
    $("#main-file").textContent = value.main;
    selectFile(value.active);
  }
  let restored;
  try { restored = await loadProject(); } catch (error) { addLog(String(error)); }
  openProject(restored || project({"main.tex": localStorage.getItem("rex-source") || starterDocument}, "main.tex"));
  editor.addEventListener("input", () => {
    session.edit(editor.value, active);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(saveTimer); persist(); } });
  $("#compile").onclick = () => session.full();
  $("#toggle-log").onclick = () => (log.hidden = !log.hidden);
  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $("#save").onclick = () => download(editor.value, active, "text/plain");
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
  const locate = () => {
    const mapping = session.layoutFiles?.[active], spans = session.currentSpans.get(active);
    const index = spans?.findIndex(span => editor.selectionStart >= span.start && editor.selectionStart <= span.end);
    const unit = mapping?.blocks[index]?.[0]?.unit;
    if (session.contextDirty) { status.textContent = "Compile to refresh source locations"; return; }
    if (!unit) { status.textContent = "No paragraph location available here"; return; }
    renderer.locate(unit);
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
    editor.focus(); editor.setSelectionRange(span.start, span.end);
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    editor.scrollTop = Math.max(0, (span.line - 3) * lineHeight);
    position(); renderer.locate(unit); persist();
  };
  editor.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "j") {
      e.preventDefault(); locate(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      session.full();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      editor.setRangeText(
        "  ",
        editor.selectionStart,
        editor.selectionEnd,
        "end",
      );
      editor.dispatchEvent(new Event("input"));
    }
  };
  function position() {
    const s = editor.value.slice(0, editor.selectionStart).split("\n");
    $("#position").textContent = `Ln ${s.length}, Col ${s.at(-1).length + 1}`;
  }
  editor.addEventListener("keyup", position);
  editor.addEventListener("click", position);
  $("#benchmark").onclick = async () => {
    const button = $("#benchmark");
    button.disabled = true;
    clearTimeout(session.timer);
    try {
      const live = session.live,
        unit = session.units?.find(
          (u) => u?.kind === "par" && u.placements?.length,
        ),
        index = session.units.indexOf(unit);
      if (!unit || !live) throw Error("Wait for the initial compilation");
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
    } catch (e) {
      status.textContent = String(e);
    } finally {
      button.disabled = false;
    }
  };
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("./sw.js").catch(addLog);
}
init().catch((e) => {
  status.textContent = String(e);
  addLog(String(e));
});
