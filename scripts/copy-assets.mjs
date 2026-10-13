import {access, cp, mkdir, readdir, rename, rm} from "node:fs/promises";
import {constants} from "node:fs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";

const exec = promisify(execFile);
const excluded = name => name.startsWith("._") || [".DS_Store", "__pycache__"].includes(name);

// Publication destinations are new paths inside the build's private stage.
// Clones have independent inodes and copy-on-write data, unlike hard links.
export async function copyAssets(source, destination) {
  await mkdir(path.dirname(destination), {recursive: true});
  if (process.platform === "darwin") {
    // Node's clone flag is unsupported by libuv on macOS. Native cp clones on
    // APFS and falls back to a normal copy on other/cross-volume filesystems.
    await exec("/bin/cp", ["-cR", source, destination]);
  } else {
    await cp(source, destination, {recursive: true, mode: constants.COPYFILE_FICLONE,
      filter: file => !excluded(path.basename(file))});
  }
}

export async function removeExcludedAssets(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (excluded(entry.name)) await rm(file, {recursive: true, force: true});
    else if (entry.isDirectory()) await removeExcludedAssets(file);
  }
}

// Recover a publication interrupted between moving the old and new directories.
export async function recoverDirectory(destination) {
  const previous = destination + ".rex-previous";
  try { await access(previous); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  try { await access(destination); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await rename(previous, destination);
    return;
  }
  await rm(previous, {recursive: true});
}

export async function publishDirectory(stage, destination) {
  await recoverDirectory(destination);
  const previous = destination + ".rex-previous";
  let moved = false;
  try { await rename(destination, previous); moved = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await rename(stage, destination); }
  catch (error) {
    if (moved) await rename(previous, destination);
    throw error;
  }
  if (moved) await rm(previous, {recursive: true});
}
