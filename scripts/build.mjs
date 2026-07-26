import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const extensionDir = join(root, "extension");

async function copy(source, target) {
  await mkdir(new URL(".", `file://${target}`).pathname, { recursive: true }).catch(() => {});
  await cp(source, target, { recursive: true });
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}
async function filesUnder(directory) {
  const output = [];
  async function walk(current) {
    for (const name of await readdir(current)) {
      const path = join(current, name);
      const info = await stat(path);
      if (info.isDirectory()) await walk(path);
      else output.push(path);
    }
  }
  await walk(directory);
  return output.sort();
}
async function makeZip(directory, outputPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { date, time } = dosDateTime();
  for (const path of await filesUnder(directory)) {
    const name = relative(directory, path).replaceAll("\\", "/");
    const nameBytes = Buffer.from(name);
    const data = await readFile(path);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const count = (await filesUnder(directory)).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  await writeFile(outputPath, Buffer.concat([...localParts, centralBuffer, end]));
}

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "assets"), { recursive: true });
await mkdir(join(dist, "downloads"), { recursive: true });
for (const file of ["index.html", "lab.html", "retailer-lab.html"]) await cp(join(root, file), join(dist, file));
await cp(join(root, "assets"), join(dist, "assets"), { recursive: true });
await makeZip(extensionDir, join(dist, "downloads", "ezcards-extension.zip"));
await writeFile(join(dist, "downloads", "README.txt"), "EZ Cards Queue Assistant\n\nUnzip, open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extracted folder. The extension accepts signed jobs only from ezcards.netlify.app or the documented localhost development origin.\n");
console.log(`Built EZ Cards into ${dist}`);
