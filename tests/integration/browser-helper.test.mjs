import test from "node:test";
import assert from "node:assert/strict";
import {webkit} from "playwright";
import {openBrowser} from "../helpers/browser-helper.mjs";

test("browser helpers retain page failures raised before teardown", async () => {
  const {page, close} = await openBrowser({browserType: webkit});
  const failure = page.waitForEvent("pageerror", {predicate: error => error.message === "active page failure"});
  await page.evaluate(() => setTimeout(() => {throw Error("active page failure");}, 0));
  await failure;
  await assert.rejects(close(), error => error.message.includes("Uncaught browser errors") && error.actual.includes("active page failure"));
});

test("module errors emitted when the browser disconnects do not fail completed tests", async () => {
  const {browser, page, close} = await openBrowser({browserType: webkit});
  // WebKit can report cancelled module imports while closing its contexts.
  browser.once("disconnected", () => page.emit("pageerror", Error("Importing a module script failed.")));
  await close();
});
