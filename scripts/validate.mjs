import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const required = [
  "index.html", "lab.html", "retailer-lab.html", "assets/app.js", "assets/lab.js", "assets/retailer-lab.js",
  "netlify/functions/api.mjs", "netlify/functions/maintenance.mjs", "netlify/functions/signal-worker.mjs",
  "netlify/lib/aliases.mjs", "netlify/lib/internal.mjs", "extension/manifest.json", "supabase/schema.sql", "docs/COMPLETION_CRITERIA.md",
];
for (const file of required) {
  try { await access(join(root, file)); } catch { failures.push(`Missing required file: ${file}`); }
}
const manifest = JSON.parse(await readFile(join(root, "extension/manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) failures.push("Extension must use Manifest V3.");
const allowedHosts = new Set(["https://ezcards.netlify.app/*", "http://localhost:8888/*", "http://127.0.0.1:8888/*"]);
for (const host of manifest.host_permissions || []) if (!allowedHosts.has(host)) failures.push(`Extension host is not allowed: ${host}`);
if ((manifest.host_permissions || []).length !== allowedHosts.size) failures.push("Extension host allowlist is incomplete or broader than expected.");
const forbiddenPermissions = ["cookies", "proxy", "webRequest", "webRequestBlocking", "debugger"];
for (const permission of manifest.permissions || []) if (forbiddenPermissions.includes(permission)) failures.push(`Forbidden extension permission: ${permission}`);

async function textFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const name of await readdir(current)) {
      const path = join(current, name); const info = await stat(path);
      if (info.isDirectory()) await walk(path); else if (/\.(?:js|mjs|json|html|css|md)$/i.test(name)) files.push(path);
    }
  }
  await walk(directory); return files;
}
const boundaryFiles = [...await textFiles(join(root, "extension")), join(root, "assets/lab.js"), join(root, "assets/retailer-lab.js")];
const forbiddenPatterns = [
  /target\.com/i, /walmart\.com/i, /pokemoncenter\./i, /bestbuy\.com/i, /costco\.com/i, /samsclub\.com/i,
  /chrome\.cookies/i, /captcha.{0,20}(solver|service|token)/i, /proxy.{0,20}(rotate|provider)/i,
  /queue.{0,20}token.{0,20}(harvest|transfer|manipulat)/i, /fingerprint.{0,20}spoof/i,
  /\beval\s*\(/, /new\s+Function\s*\(/,
];
for (const file of boundaryFiles) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) if (pattern.test(text)) failures.push(`Boundary violation ${pattern} in ${file.replace(`${root}/`, "")}`);
}
const retailer = await readFile(join(root, "retailer-lab.html"), "utf8");
if (!retailer.includes("LOCAL EDUCATION LAB") || !retailer.includes("data-ezcards-lab-state")) failures.push("Retailer replica is missing its education boundary/state marker.");
if (!manifest.content_scripts?.some((script) => script.matches?.some((match) => match.includes("/local-retailer")))) failures.push("Extension does not recognize the localized retailer route.");
const lab = await readFile(join(root, "lab.html"), "utf8");
if (!lab.includes("LOCALIZED EDUCATION MODE")) failures.push("AIO lab is missing its localized boundary marker.");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("Validation passed: scope files, manifest, and isolated lab boundaries are valid.");
