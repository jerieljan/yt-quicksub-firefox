import { mkdtemp, readFile, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "manifest.json")));
const pkg = JSON.parse(await readFile(join(root, "package.json")));
if (manifest.version !== pkg.version) throw new Error("Manifest and package versions must match.");
// Explicit files prevent tests, credentials, editor files, or old builds entering the XPI.
const files = ["manifest.json", "LICENSE", "icons/icon.svg", "popup/popup.html",
  "popup/popup.css", "popup/popup.js", "src/background.js", "src/content.js",
  "src/content.css", "src/core.js"];
const stage = await mkdtemp(join(tmpdir(), "yt-quicksub-release-"));
const cli = join(root, "node_modules/web-ext/bin/web-ext.js");
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: "inherit",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`web-ext failed (${result.status}).`);
}
try {
  for (const file of files) {
    await mkdir(dirname(join(stage, file)), { recursive: true });
    await copyFile(join(root, file), join(stage, file));
  }
  run(["lint", "--source-dir", stage, "--warnings-as-errors"]);
  if (!process.argv.includes("--lint")) {
    const output = join(root, "dist");
    const filename = `yt-quicksub-firefox-${manifest.version}.xpi`;
    await mkdir(output, { recursive: true });
    run(["build", "--source-dir", stage, "--artifacts-dir", output,
      "--filename", filename, "--overwrite-dest"]);
    const digest = createHash("sha256").update(await readFile(join(output, filename))).digest("hex");
    await writeFile(join(output, `${filename}.sha256`), `${digest}  ${filename}\n`);
    // Keep the original package location current for existing users of this repository.
    await copyFile(join(output, filename), join(root, "yt-quicksub-firefox.xpi"));
    console.log(`Release package: ${join(output, filename)}\nSHA-256: ${digest}`);
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}
