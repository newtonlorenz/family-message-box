import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(here, "print-ready");
const manifestPath = path.join(directory, "slice-manifest.json");
const writeManifest = process.argv.includes("--write-manifest");
const expected = Object.freeze({
  "01-electronics-carrier.gcode": {
    maxHours: 2, maxZ: 3.7,
    modelBounds: { minX: 21, minY: 71, maxX: 199, maxY: 149 },
  },
  "02-control-lid.gcode": {
    maxHours: 10, maxZ: 6.2,
    modelBounds: { minX: 10.2, minY: 19.2, maxX: 209.8, maxY: 200.8 },
  },
  "03-enclosure-base.gcode": {
    maxHours: 15, maxZ: 88.2,
    modelBounds: { minX: 8, minY: 18, maxX: 212, maxY: 202 },
  },
});

function headerNumber(text, name) {
  const match = text.match(new RegExp(`^;${name}:([^\\n]+)`, "m"));
  if (!match) throw new Error(`missing ${name} header`);
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) throw new Error(`invalid ${name} header`);
  return value;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const failures = [];
const summaries = [];
const records = {};
for (const [fileName, limits] of Object.entries(expected)) {
  const filePath = path.join(directory, fileName);
  if (!fs.existsSync(filePath)) {
    failures.push(`${fileName}: missing`);
    continue;
  }
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const timeSeconds = headerNumber(text, "TIME");
    const filamentMetres = headerNumber(text, "Filament used");
    const bounds = {
      minX: headerNumber(text, "MINX"), minY: headerNumber(text, "MINY"),
      minZ: headerNumber(text, "MINZ"), maxX: headerNumber(text, "MAXX"),
      maxY: headerNumber(text, "MAXY"), maxZ: headerNumber(text, "MAXZ"),
    };
    if (timeSeconds > limits.maxHours * 3600) throw new Error(`${(timeSeconds / 3600).toFixed(2)} h exceeds ${limits.maxHours} h limit`);
    if (filamentMetres <= 0) throw new Error("filament estimate is empty");
    if (bounds.minX < 2.5 || bounds.minY < 2.5 || bounds.maxX > 217.5 || bounds.maxY > 217.5) throw new Error(`toolpath leaves less than 2.5 mm bed margin: ${JSON.stringify(bounds)}`);
    if (bounds.maxZ > limits.maxZ) throw new Error(`maximum Z ${bounds.maxZ} exceeds ${limits.maxZ}`);
    if (!text.includes(";Layer height: 0.32")) throw new Error("wrong layer height");
    if (!text.includes("M190 S65") || !text.includes("M109 S220")) throw new Error("wrong ELEGOO PLA temperatures");
    if (text.includes(";TYPE:SUPPORT")) throw new Error("unexpected support toolpath");
    const unresolved = text.match(/\{[^{}\n]+\}/g);
    if (unresolved) throw new Error(`unresolved Cura placeholder: ${[...new Set(unresolved)].join(", ")}`);
    // CuraEngine labels both skirt and brim feature lines as TYPE:SKIRT. Verify
    // the actual 5 mm brim geometrically: its toolpath must extend roughly
    // 5.175 mm past every centred STL edge with this 0.45 mm line profile.
    if (!text.includes(";TYPE:SKIRT")) throw new Error("missing Cura skirt/brim adhesion feature");
    const brimMargins = [
      limits.modelBounds.minX - bounds.minX,
      limits.modelBounds.minY - bounds.minY,
      bounds.maxX - limits.modelBounds.maxX,
      bounds.maxY - limits.modelBounds.maxY,
    ];
    if (brimMargins.some((margin) => margin < 4.8 || margin > 5.5)) {
      throw new Error(`toolpath does not contain the expected 5 mm brim: ${brimMargins.join(", ")}`);
    }
    const fanPwm = [...text.matchAll(/M106 S([0-9.]+)/g)].map((match) => Number(match[1]));
    if (fanPwm.length && Math.max(...fanPwm) > 154) throw new Error("part-cooling fan exceeds 60%");
    const hours = Math.floor(timeSeconds / 3600);
    const minutes = Math.round((timeSeconds % 3600) / 60);
    summaries.push(`${fileName}: ${hours} h ${minutes} m, ${filamentMetres.toFixed(1)} m, bounds ${bounds.minX}-${bounds.maxX} x ${bounds.minY}-${bounds.maxY} mm`);
    records[fileName] = Object.freeze({ sha256: sha256(filePath), timeSeconds, filamentMetres, bounds });
  } catch (error) {
    failures.push(`${fileName}: ${error.message}`);
  }
}

if (!failures.length && writeManifest) {
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, slicer: "CuraEngine 5.13.0", records }, null, 2)}\n`);
  summaries.push("slice-manifest.json: G-code hashes and estimates recorded");
} else if (!failures.length) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const [fileName, record] of Object.entries(records)) if (manifest.records?.[fileName]?.sha256 !== record.sha256) failures.push(`${fileName}: slice manifest is stale`);
  } catch (error) {
    failures.push(`slice-manifest.json: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(summaries.join("\n"));
}
