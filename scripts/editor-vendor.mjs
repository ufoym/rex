import {build} from "esbuild";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

export async function buildEditor() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  await mkdir(path.join(root, "vendor"), {recursive: true});
  await build({
    stdin: {contents: `
      export {basicSetup} from "codemirror";
      export {EditorState, Compartment} from "@codemirror/state";
      export {EditorView, keymap} from "@codemirror/view";
      export {indentWithTab} from "@codemirror/commands";
      export {StreamLanguage, indentUnit, HighlightStyle, syntaxHighlighting} from "@codemirror/language";
      export {stex} from "@codemirror/legacy-modes/mode/stex";
      export {openSearchPanel} from "@codemirror/search";
      export {tags} from "@lezer/highlight";
    `, resolveDir: root},
    outfile: path.join(root, "vendor/codemirror.mjs"),
    bundle: true, format: "esm", minify: true, legalComments: "eof", target: "es2022",
  });
  const packages = ["codemirror", "@lezer/common", "@lezer/highlight", "@lezer/lr", "@marijn/find-cluster-break", "crelt", "style-mod", "w3c-keyname",
    ...["state", "view", "commands", "language", "streamparser", "legacy-modes", "search", "autocomplete", "lint"].map(name => "@codemirror/" + name)];
  const licenses = await Promise.all(packages.map(async name => {
    const dir = path.join(root, "node_modules", name), metadata = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    return `${name} ${metadata.version}\n${await readFile(path.join(dir, "LICENSE"), "utf8")}`;
  }));
  await writeFile(path.join(root, "vendor/codemirror-LICENSE.txt"), licenses.join("\n\n"));
}
