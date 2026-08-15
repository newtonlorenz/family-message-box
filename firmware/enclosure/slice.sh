#!/usr/bin/env bash
set -euo pipefail

cad_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cura_resources="/Applications/UltiMaker Cura.app/Contents/Resources"
cura_engine="${cura_resources}/CuraEngine"
cura_data="${cura_resources}/share/cura/resources"
definition="${cura_data}/definitions/creality_ender3v3se.def.json"

if [[ ! -x "${cura_engine}" ]]; then
  echo "UltiMaker Cura 5.13 and CuraEngine were not found at ${cura_engine}." >&2
  exit 1
fi

settings=(
  -s roofing_layer_count=0
  -s flooring_layer_count=0
  -s layer_height=0.32
  -s layer_height_0=0.24
  -s line_width=0.45
  -s adhesion_type=brim
  -s brim_width=5
  -s brim_line_count=12
  -s skirt_brim_line_width=0.45
  -s wall_line_count=2
  -s top_layers=4
  -s bottom_layers=4
  -s top_bottom_thickness=1.2
  -s infill_sparse_density=12
  -s infill_pattern=cubic
  -s support_enable=false
  -s speed_print=70
  -s speed_wall=50
  -s speed_wall_0=40
  -s speed_wall_x=55
  -s speed_infill=70
  -s speed_topbottom=45
  -s speed_layer_0=15
  -s speed_travel=180
  -s material_print_temperature=220
  -s material_print_temperature_layer_0=220
  -s material_bed_temperature=65
  -s material_bed_temperature_layer_0=65
  -s cool_fan_enabled=true
  -s cool_fan_speed=60
  -s cool_fan_speed_min=60
  -s cool_fan_speed_max=60
  -s cool_fan_speed_0=0
  -s cool_fan_full_layer=8
  -s bridge_fan_speed=60
  -s bridge_fan_speed_2=60
  -s bridge_fan_speed_3=60
  -s skin_support_fan_speed=60
  -s support_supported_skin_fan_speed=60
  -s cool_min_layer_time_fan_speed_max=60
  -s material_flow_layer_0=105
  -s retraction_amount=0.8
  -s retraction_speed=40
  -s machine_max_acceleration_x=2500
  -s machine_max_acceleration_y=2500
  -s machine_acceleration=2500
)

slice_part() {
  local stl_name="$1"
  local output_name="$2"
  local position_x="$3"
  local position_y="$4"
  local log_file
  log_file="$(mktemp -t family-message-box-cura.XXXXXX)"
  trap 'rm -f "${log_file}"' RETURN

  "${cura_engine}" slice \
    -d "${cura_data}/definitions:${cura_data}/extruders" \
    -j "${definition}" \
    "${settings[@]}" \
    -l "${cad_directory}/exports/${stl_name}" \
    -s "mesh_position_x=${position_x}" \
    -s "mesh_position_y=${position_y}" \
    -s cool_fan_speed=60 \
    -s cool_fan_speed_min=60 \
    -s cool_fan_speed_max=60 \
    -s bridge_fan_speed=60 \
    -s bridge_fan_speed_2=60 \
    -s bridge_fan_speed_3=60 \
    -s skin_support_fan_speed=60 \
    -s support_supported_skin_fan_speed=60 \
    -s cool_min_layer_time_fan_speed_max=60 \
    -o "${cad_directory}/print-ready/${output_name}" \
    >"${log_file}" 2>&1

  node "${cad_directory}/finalize_gcode_header.mjs" \
    "${cad_directory}/print-ready/${output_name}" "${log_file}"
  grep -F "Print time (hr|min|s)" "${log_file}"
  grep -F "Filament (mm^3)" "${log_file}"
  rm -f "${log_file}"
  trap - RETURN
}

# CuraEngine uses coordinates relative to the 110 x 110 mm bed centre. These
# positions centre each positive-coordinate STL and leave its complete brim on
# the build plate.
slice_part "family-message-box-electronics-tray.stl" \
  "01-electronics-carrier.gcode" -89 -39
slice_part "family-message-box-control-lid.stl" \
  "02-control-lid.gcode" -99.8 -90.8
slice_part "family-message-box-base.stl" \
  "03-enclosure-base.gcode" -102 -92

node "${cad_directory}/validate_slices.mjs" --write-manifest

mkdir -p "${cad_directory}/sd-card-ready"
cp "${cad_directory}/print-ready/01-electronics-carrier.gcode" \
  "${cad_directory}/sd-card-ready/BOX_TRAY.gcode"
cp "${cad_directory}/print-ready/02-control-lid.gcode" \
  "${cad_directory}/sd-card-ready/BOX_LID.gcode"
cp "${cad_directory}/print-ready/03-enclosure-base.gcode" \
  "${cad_directory}/sd-card-ready/BOX_BASE.gcode"
