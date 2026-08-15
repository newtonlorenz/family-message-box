#!/usr/bin/env bash
set -euo pipefail

cad_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
image="openscad/openscad:trixie"
source_file="family_message_box.scad"
output_directory="/models/exports"

parts=(base control_lid electronics_tray)

for part in "${parts[@]}"; do
  output_name="family-message-box-${part//_/-}.stl"
  docker run --rm \
    -v "${cad_directory}:/models" \
    -w /models \
    "${image}" \
    openscad --hardwarnings --export-format binstl \
    -D "PART=\"${part}\"" \
    -o "${output_directory}/${output_name}" \
    "${source_file}"
done

for exploded in false true; do
  if [[ "${exploded}" == "true" ]]; then
    output_name="family-message-box-exploded-preview.png"
    explode_argument=( -D 'EXPLODE=28' -D 'SHOW_HARDWARE=false' )
  else
    output_name="family-message-box-preview.png"
    explode_argument=( -D 'EXPLODE=0' -D 'SHOW_HARDWARE=true' )
  fi
  docker run --rm \
    -v "${cad_directory}:/models" \
    -w /models \
    "${image}" \
    openscad --hardwarnings --render --autocenter --viewall \
    --projection perspective --imgsize 1400,1000 --colorscheme "Tomorrow" \
    -D 'PART="assembly"' "${explode_argument[@]}" \
    -o "${output_directory}/${output_name}" \
    "${source_file}"
done

node "${cad_directory}/validate_exports.mjs" --write-manifest
