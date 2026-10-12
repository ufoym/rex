import test from "node:test";
import assert from "node:assert/strict";
import { Session } from "../../src/compiler/session.js";

test("an edit during startup reuses converged auxiliary files without showing an obsolete layout", async () => {
  const session = Object.create(Session.prototype), requests = [];
  const old = {aux: {"capture.aux": new Uint8Array([1])}}, aux = {"capture.aux": new Uint8Array([2])};
  Object.assign(session, {projectId: 2, revision: 3, busy: true, layout: old,
    main: "main.tex", source: "latest source", files: {"main.tex": "latest source"},
    status() {}, schedule() {}, background: {postMessage: data => requests.push(data)}});
  await session.onBackground({type: "layout", projectId: 2, revision: 2, aux});
  assert.equal(session.layout, old, "Obsolete source must not appear in the preview");
  session.full();
  assert.equal(requests[0].aux, aux, "Startup must not converge the same references from scratch twice");
  await session.onBackground({type: "layout", projectId: 1, revision: 2, aux: old.aux});
  assert.equal(session.aux, aux, "Other projects must not supply auxiliary state");
});

test("initial resource progress is visible without completing the compilation", async () => {
  const session = Object.create(Session.prototype), statuses = [];
  session.projectId = 2;
  session.busy = true;
  session.status = value => statuses.push(value);
  await session.onBackground({type: "progress", projectId: 2, phase: "fetching", detail: "cmr10.pfb", current: 5, total: 20});
  assert.match(statuses.at(-1) || "", /Loading.*5\/20/);
  assert.equal(session.busy, true);
  await session.onBackground({type: "progress", projectId: 1, phase: "fetching", detail: "obsolete"});
  assert.equal(statuses.length, 1);
  session.busy = false;
  await session.onBackground({type: "progress", projectId: 2, phase: "fetching", detail: "obsolete"});
  assert.equal(statuses.length, 1);
});
