import fs from "node:fs";

const [gcodePath, logPath] = process.argv.slice(2);
if (!gcodePath || !logPath) throw new Error("usage: finalize_gcode_header.mjs GCODE LOG");

const log = fs.readFileSync(logPath, "utf8");
if (log.includes("[error]")) throw new Error(`CuraEngine reported an error while slicing ${gcodePath}`);
const headerMatch = log.match(/Gcode header after slicing:\s*(;FLAVOR:[\s\S]*?;TARGET_MACHINE\.NAME:[^\n]+)\n/);
if (!headerMatch) throw new Error(`CuraEngine did not report a final G-code header for ${gcodePath}`);

const original = fs.readFileSync(gcodePath, "utf8");
if (original.length < 1000) throw new Error(`CuraEngine produced an empty or incomplete file: ${gcodePath}`);
const replacements = Object.freeze({
  "{machine_depth}": "220",
  "{material_bed_temperature_layer_0}": "65",
  "{material_print_temperature_layer_0}": "220",
});
const finalized = Object.entries(replacements).reduce(
  (text, [placeholder, value]) => text.replaceAll(placeholder, value),
  original.replace(/^;FLAVOR:[\s\S]*?;TARGET_MACHINE\.NAME:[^\n]+/, headerMatch[1]),
);
const unresolved = finalized.match(/\{[^{}\n]+\}/g);
if (unresolved) throw new Error(`unresolved Cura placeholders in ${gcodePath}: ${[...new Set(unresolved)].join(", ")}`);
fs.writeFileSync(gcodePath, finalized);
