import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resources } from "../../src/compiler/runtime.js";
export const io = {
  fetch: async (u) => new Uint8Array(fs.readFileSync(fileURLToPath(u))),
  fetchSync: (u) => new Uint8Array(fs.readFileSync(fileURLToPath(new URL(u)))),
  fetchJson: async (u) => JSON.parse(fs.readFileSync(fileURLToPath(u), "utf8")),
};
export const load = () => resources(io);
