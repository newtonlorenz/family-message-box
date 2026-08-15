import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const exportDirectory = path.join(here, "exports");
const manifestPath = path.join(exportDirectory, "build-manifest.json");
const sourcePaths = Object.freeze([
  path.join(here, "family_message_box.scad"),
  path.join(here, "printable_accessories.scad"),
  path.join(here, "COMPONENT_SPECS.md"),
]);
const writeManifest = process.argv.includes("--write-manifest");

const expectedParts = Object.freeze({
  "family-message-box-base.stl": [204, 184, 88],
  "family-message-box-control-lid.stl": [199.6, 181.6, 6],
  "family-message-box-electronics-tray.stl": [178, 78, 3.6],
});
const expectedPreviews = Object.freeze({
  "family-message-box-preview.png": [1400, 1000],
  "family-message-box-exploded-preview.png": [1400, 1000],
});
const tolerance = 0.06;

function vertexKey(vertex) {
  return vertex.map((value) => (Math.abs(value) < 1e-6 ? 0 : value).toFixed(5)).join(",");
}

function readTriangles(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 84) {
    const count = buffer.readUInt32LE(80);
    if (84 + count * 50 === buffer.length) {
      return Array.from({ length: count }, (_, index) => {
        const start = 84 + index * 50 + 12;
        return Array.from({ length: 3 }, (_, vertex) => {
          const offset = start + vertex * 12;
          return [buffer.readFloatLE(offset), buffer.readFloatLE(offset + 4), buffer.readFloatLE(offset + 8)];
        });
      });
    }
  }
  const vertices = [...buffer.toString("utf8").matchAll(/\bvertex\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)]
    .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
  if (vertices.length < 12 || vertices.length % 3 !== 0) throw new Error("invalid STL");
  return Array.from({ length: vertices.length / 3 }, (_, index) => vertices.slice(index * 3, index * 3 + 3));
}

function inspectStl(filePath) {
  const triangles = readTriangles(filePath);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  const edges = new Map();
  let volumeSix = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (cross.every((value) => Math.abs(value) < 1e-8)) throw new Error("degenerate triangle");
    volumeSix += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const keys = triangle.map(vertexKey);
    for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
      const key = [keys[from], keys[to]].sort().join("|");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    for (const vertex of triangle) for (let axis = 0; axis < 3; axis += 1) {
      if (!Number.isFinite(vertex[axis])) throw new Error("non-finite vertex");
      minimum[axis] = Math.min(minimum[axis], vertex[axis]);
      maximum[axis] = Math.max(maximum[axis], vertex[axis]);
    }
  }
  const badEdges = [...edges.values()].filter((count) => count !== 2).length;
  if (badEdges) throw new Error(`${badEdges} non-manifold or boundary edges`);
  if (Math.abs(volumeSix) < 1e-6) throw new Error("zero volume");
  return Object.freeze({ triangles, minimum, maximum, size: maximum.map((value, axis) => value - minimum[axis]) });
}

function inspectPng(filePath, expected) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("invalid PNG");
  const actual = [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  if (actual.some((value, axis) => value !== expected[axis])) throw new Error(`${actual.join(" x ")} px`);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const failures = [];
const summaries = [];
for (const [fileName, expectedSize] of Object.entries(expectedParts)) {
  const filePath = path.join(exportDirectory, fileName);
  if (!fs.existsSync(filePath)) {
    failures.push(`${fileName}: missing`);
    continue;
  }
  try {
    const result = inspectStl(filePath);
    if (result.size.some((value, axis) => Math.abs(value - expectedSize[axis]) > tolerance)) {
      failures.push(`${fileName}: ${result.size.map((value) => value.toFixed(2)).join(" x ")} mm, expected ${expectedSize.join(" x ")} mm`);
    } else {
      summaries.push(`${fileName}: ${result.size.map((value) => value.toFixed(2)).join(" x ")} mm, ${result.triangles.length} triangles, closed mesh`);
    }
  } catch (error) {
    failures.push(`${fileName}: ${error.message}`);
  }
}

for (const [fileName, expectedSize] of Object.entries(expectedPreviews)) {
  const filePath = path.join(exportDirectory, fileName);
  if (!fs.existsSync(filePath)) failures.push(`${fileName}: missing`);
  else try {
    inspectPng(filePath, expectedSize);
    summaries.push(`${fileName}: ${expectedSize.join(" x ")} px PNG`);
  } catch (error) {
    failures.push(`${fileName}: ${error.message}`);
  }
}

const sourceText = fs.readFileSync(sourcePaths[0], "utf8");
for (const contract of [
  'front_title = "FAMILY MESSAGE BOX";',
  "button_hole_diameter = 28.0;",
  "button_max_total_depth = 65.0;",
  "microphone_board_size = 14;",
  "speaker_grille_outer_diameter = 66;",
  "speaker_grille_mesh_diameter = 46;",
  "dc_jack_hole_diameter = 11.2;",
  "child_lock_screw_hole_diameter = 3.4;",
  "wall = 1.8;",
  "lid_seat_z = 84;",
  "tray_adhesion_web_width = 14;",
  "tray_adhesion_web_height = 0.24;",
]) if (!sourceText.includes(contract)) failures.push(`source contract missing: ${contract}`);
if (/hasp_|padlock_hole|external_latch/.test(sourceText)) failures.push("obsolete external latch geometry remains");

function currentManifest() {
  const outputs = [...Object.keys(expectedParts), ...Object.keys(expectedPreviews)];
  return Object.freeze({
    schemaVersion: 3,
    sources: Object.fromEntries(sourcePaths.map((filePath) => [path.basename(filePath), sha256(filePath)])),
    outputs: Object.fromEntries(outputs.map((fileName) => [fileName, sha256(path.join(exportDirectory, fileName))])),
  });
}

if (!failures.length && writeManifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(currentManifest(), null, 2)}\n`);
  summaries.push("build-manifest.json: current source and export hashes recorded");
} else if (!failures.length) {
  try {
    const recorded = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (JSON.stringify(recorded) !== JSON.stringify(currentManifest())) failures.push("build-manifest.json: stale");
  } catch (error) {
    failures.push(`build-manifest.json: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(summaries.join("\n"));
}
