import test from "node:test";
import assert from "node:assert/strict";
import { Session } from "../../src/compiler/session.js";

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
