// Regenerates the packaged application icons from assets/icon.svg.
//
// This script is macOS-only because it uses QuickLook and iconutil to
// rasterize. The icons it produces are committed to the repository, so Linux
// and Windows builds consume the generated files and never run this script.
//
//   npm run icons
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const assetsDirectory = join(projectRoot, "assets");
const sourceIcon = join(assetsDirectory, "icon.svg");

// macOS .icns members, Windows .ico members, and the Linux PNG.
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const LINUX_SIZE = 512;

if (process.platform !== "darwin") {
  throw new Error("generate-icons requires macOS (QuickLook + iconutil). The generated icons are committed.");
}

const staging = await mkdtemp(join(tmpdir(), "aos-icons-"));
try {
  const sizes = [...new Set([...ICNS_SIZES, ...ICO_SIZES, LINUX_SIZE])].sort((a, b) => a - b);
  const rendered = new Map();
  for (const size of sizes) {
    rendered.set(size, await render(size));
  }

  await mkdir(assetsDirectory, { recursive: true });
  await writeFile(join(assetsDirectory, "icon.png"), rendered.get(LINUX_SIZE));
  await writeFile(join(assetsDirectory, "icon.ico"), buildIco(ICO_SIZES.map((size) => ({ size, png: rendered.get(size) }))));
  await buildIcns(rendered);

  process.stdout.write(`Generated icon.icns, icon.ico, and icon.png in ${assetsDirectory}\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

// QuickLook renders each size from the vector source directly, which keeps the
// small sizes crisp instead of downscaling one large raster.
async function render(size) {
  const directory = join(staging, `size-${size}`);
  await mkdir(directory, { recursive: true });
  await execFileAsync("/usr/bin/qlmanage", ["-t", "-s", String(size), "-o", directory, sourceIcon]);
  const produced = join(directory, "icon.svg.png");
  const png = await readFile(produced);
  const { width, height } = readPngSize(png);
  if (width !== size || height !== size) {
    throw new Error(`QuickLook produced ${width}x${height} for the requested ${size}px icon`);
  }
  return png;
}

async function buildIcns(rendered) {
  const iconset = join(staging, "AOS.iconset");
  await mkdir(iconset, { recursive: true });
  // iconutil expects this exact naming for the base and @2x variants.
  const members = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of members) {
    await writeFile(join(iconset, name), rendered.get(size));
  }
  const output = join(staging, "icon.icns");
  await execFileAsync("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", output]);
  await rename(output, join(assetsDirectory, "icon.icns"));
}

// ICO container holding PNG-compressed entries, which Windows Vista and later
// read directly. Each directory entry is 16 bytes after a 6-byte header.
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette colors
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // color planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map(({ png }) => png)]);
}

function readPngSize(png) {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("QuickLook did not produce a PNG");
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
