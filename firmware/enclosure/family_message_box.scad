// Family Message Box - eight-recipient printable enclosure
// Units: millimetres. FDM target: Ender-3 V3 SE, 220 x 220 mm, 0.4 mm nozzle.

PART = "assembly";
SHOW_HARDWARE = true;
EXPLODE = 0;
$fn = 56;

// Printer envelope -----------------------------------------------------------
printer_x = 220;
printer_y = 220;
recommended_brim = 5;

// Fast, locally reinforced enclosure ----------------------------------------
// The previous 125 mm / 3.2 mm shell was unnecessarily large. The reference
// buttons are 65 mm maximum from plunger top to microswitch bottom, so a
// 88 mm body leaves a generous service zone without stacking electronics
// beneath the button barrels.
box_width = 204;
box_depth = 184;
wall = 1.8;
floor_thickness = 1.4;
floor_rib_width = 2.4;
floor_rib_height = 3.0;
corner_radius = 8;
lid_seat_z = 84;
lid_thickness = 4;
base_total_height = lid_seat_z + lid_thickness;
lid_clearance_per_side = 0.4;
ledge_height = 2.4;
ledge_depth = 4;

lid_width = box_width - 2 * wall - 2 * lid_clearance_per_side;
lid_depth = box_depth - 2 * wall - 2 * lid_clearance_per_side;
lid_origin_x = (box_width - lid_width) / 2;
lid_origin_y = (box_depth - lid_depth) / 2;
lid_corner_radius = corner_radius - wall - lid_clearance_per_side;

// Reference EG STARTS buttons, ASIN B01N549IDL -------------------------------
button_hole_diameter = 28.0;       // Listing mounting-hole range: 24-28 mm.
button_bezel_diameter = 32.0;      // Listing top/plunger diameter.
button_max_total_depth = 65.0;     // Plunger top to microswitch bottom.
label_disc_nominal_diameter = 35;
label_recess_diameter = 35.6;   // 0.3 mm FDM clearance per side.
label_recess_depth = 0.5;

button_x_centres = [22, 68, lid_width - 68, lid_width - 22];
label_y_centres = [24, 106];
button_y_centres = [62, 144];

// No projecting latch: two hidden rear tongues plus tool-operated M3 screws.
// The closure uses common M3 screws and captive nuts.
rear_tab_width = 22;
rear_tab_depth = 2.0;
rear_tab_thickness = 1.4;
rear_tab_roof_thickness = 2.2;
rear_tab_centres = [lid_width * 0.25, lid_width * 0.75];

child_lock_screw_local_x = [lid_width / 2 - 9, lid_width / 2 + 9];
child_lock_screw_local_y = 12;
child_lock_screw_hole_diameter = 3.4;
child_lock_head_recess_diameter = 6.4;
child_lock_head_recess_depth = 3.0;
child_lock_boss_diameter = 12;
child_lock_nut_across_flats = 5.7;
child_lock_nut_pocket_height = 2.8;
child_lock_nut_roof_thickness = 2.4;
child_lock_nut_entry_width = 5.9;
child_lock_brace_width = 3.2;
child_lock_cross_brace_depth = 3.2;
child_lock_load_pad_diameter = 12;
child_lock_load_pad_height = 2;
child_lock_captive_clearance = 0.6;
child_lock_pilot_bottom_z = 74;

// Front title and exact audio envelopes -------------------------------------
front_title = "FAMILY MESSAGE BOX";
front_title_font = "DejaVu Sans:style=Bold";
front_title_size = 9;
front_title_x = box_width / 2;
front_title_z = 80;
front_engraving_depth = 0.8;

// ARCELI INMP441 module, ASIN B0CH2TYXCZ: Amazon drawing is 14 x 14 mm.
microphone_centre_x = 28;
microphone_centre_z = 50;
microphone_port_hole_diameter = 1.0;
microphone_plenum_diameter = 5;
microphone_board_size = 14;
microphone_board_clearance = 0.5;
microphone_board_thickness_allowance = 2.2;
microphone_rail_thickness = 2;
microphone_rail_depth = 3.2;
microphone_bottom_stop = 2;

// B09BVV4MN6 grille: 66 mm outer / 46 mm mesh. B0DS6BKVQ4 speaker:
// 52 x 52 x 23 mm. The listing does not publish either screw pattern, so the
// grille holes use listing-bounded radial slots and the square speaker is
// rotated 45 degrees behind it to keep the two fastener sets separate.
speaker_centre_x = 164;
speaker_centre_z = 40;
speaker_grille_outer_diameter = 66;
speaker_grille_mesh_diameter = 46;
speaker_grille_recess_diameter = 66.6;
speaker_grille_recess_depth = 0.7;
speaker_grille_slot_inner_radius = 24;
speaker_grille_slot_outer_radius = 29;
speaker_mount_radius = 31.1;       // 44 mm square-hole estimate, rotated 45°.
speaker_mount_hole_diameter = 3.4;
speaker_sound_hole_diameter = 3.2;

// RUNCCI-YUN B0CH7WX85X drawing: M11 threaded body, 10.8 +/- 0.2 mm.
dc_jack_centre_x = 174;
dc_jack_centre_z = 30;
dc_jack_hole_diameter = 11.2;

vent_slot_width = 10;
vent_slot_height = 2.2;
vent_baffle_width = 78;
vent_baffle_thickness = 1.6;
vent_baffle_gap = 3;
vent_baffle_top_z = 82;

// Lightweight carrier. Its exact component envelopes live in
// printable_accessories.scad; four M3 floor mounts use the reference kit.
tray_width = 178;
tray_depth = 78;
tray_thickness = 2.0;
tray_rib_width = 3.2;
tray_border_width = 4;
// One first-layer-high cross foot gives the narrow middle ribs enough contact
// on textured PEI without turning the carrier back into a heavy solid slab.
tray_adhesion_web_width = 14;
tray_adhesion_web_height = 0.24;
tray_origin_x = (box_width - tray_width) / 2;
tray_origin_y = 82;
tray_boss_diameter = 9;
tray_boss_height = 4;
tray_mount_inset = 5.5;
tray_pilot_hole_diameter = 2.7;
tray_mount_points = [
  [tray_origin_x + tray_mount_inset, tray_origin_y + tray_mount_inset],
  [tray_origin_x + tray_width - tray_mount_inset, tray_origin_y + tray_mount_inset],
  [tray_origin_x + tray_mount_inset, tray_origin_y + tray_depth - tray_mount_inset],
  [tray_origin_x + tray_width - tray_mount_inset, tray_origin_y + tray_depth - tray_mount_inset]
];

// Assertions ----------------------------------------------------------------
assert(box_width + 2 * recommended_brim <= printer_x,
  "Base plus 5 mm brim exceeds the 220 mm bed.");
assert(box_depth + 2 * recommended_brim <= printer_y,
  "Base plus 5 mm brim exceeds the 220 mm bed.");
assert(len(button_x_centres) * len(button_y_centres) == 8,
  "The lid must contain exactly eight button stations.");
assert(len(button_x_centres) * len(label_y_centres) == 8,
  "The lid must contain exactly eight label recesses.");
assert(front_title == "FAMILY MESSAGE BOX",
  "The front engraving text must remain exact.");
assert(button_hole_diameter >= 24 && button_hole_diameter <= 28,
  "Button hole is outside the reference listing's mounting range.");
assert(lid_seat_z + lid_thickness + 9 - button_max_total_depth > 30,
  "Button bottoms leave less than 30 mm above the floor.");
assert(speaker_centre_x + speaker_grille_outer_diameter / 2 < box_width,
  "Speaker grille exceeds the front face.");
assert(microphone_centre_z + microphone_board_size / 2 < front_title_z - 6,
  "Microphone holder collides with the title.");
assert(rear_tab_thickness + 0.5 + rear_tab_roof_thickness <= lid_thickness + 1,
  "Rear tongue roof is too thin.");
assert(tray_adhesion_web_width > tray_rib_width + 8,
  "Tray middle ribs need at least 4 mm of first-layer foot on each side.");

// Shared helpers -------------------------------------------------------------
module rounded_rectangle_2d(width, depth, radius) {
  offset(r = radius)
    translate([radius, radius])
      square([width - 2 * radius, depth - 2 * radius]);
}

module rounded_prism(width, depth, height, radius) {
  linear_extrude(height = height)
    rounded_rectangle_2d(width, depth, radius);
}

module capsule_2d(length, diameter) {
  hull() {
    translate([-length / 2 + diameter / 2, 0]) circle(d = diameter);
    translate([length / 2 - diameter / 2, 0]) circle(d = diameter);
  }
}

module front_through_hole(x, z, diameter, extra = 3) {
  translate([x, -extra / 2, z])
    rotate([-90, 0, 0]) cylinder(h = wall + extra, d = diameter);
}

module rear_through_hole(x, z, diameter, extra = 3) {
  translate([x, box_depth + extra / 2, z])
    rotate([90, 0, 0]) cylinder(h = wall + extra, d = diameter);
}

module title_engraving_cut() {
  translate([front_title_x, front_engraving_depth, front_title_z])
    rotate([90, 0, 0])
      linear_extrude(height = front_engraving_depth + 0.2)
        text(front_title, size = front_title_size, font = front_title_font,
          halign = "center", valign = "center");
}

// Base -----------------------------------------------------------------------
module base_shell() {
  difference() {
    rounded_prism(box_width, box_depth, base_total_height, corner_radius);
    translate([wall, wall, floor_thickness])
      rounded_prism(box_width - 2 * wall, box_depth - 2 * wall,
        base_total_height - floor_thickness + 1, corner_radius - wall);
  }
}

module lid_support_ledges() {
  // The 0.2 mm overlaps make each ledge a single manifold with the shell.
  translate([wall - 0.2, wall - 0.2, lid_seat_z - ledge_height])
    cube([ledge_depth + 0.4, box_depth - 2 * wall + 0.4, ledge_height]);
  translate([box_width - wall - ledge_depth - 0.2, wall - 0.2,
    lid_seat_z - ledge_height])
    cube([ledge_depth + 0.4, box_depth - 2 * wall + 0.4, ledge_height]);
  translate([wall - 0.2, wall - 0.2, lid_seat_z - ledge_height])
    cube([box_width - 2 * wall + 0.4, ledge_depth + 0.4, ledge_height]);
  translate([wall - 0.2, box_depth - wall - ledge_depth - 0.2,
    lid_seat_z - ledge_height])
    cube([box_width - 2 * wall + 0.4, ledge_depth + 0.4, ledge_height]);
}

module tray_bosses() {
  for (point = tray_mount_points)
    translate([point[0], point[1], floor_thickness])
      cylinder(h = tray_boss_height, d = tray_boss_diameter);
}

module floor_stiffening_ribs() {
  // A thin continuous floor plus this grid uses less material than the old
  // 2.8 mm slab while increasing stiffness across both bed axes.
  for (x = [35, 70, 105, 140, 175])
    translate([x - floor_rib_width / 2, wall - 0.3, floor_thickness - 0.15])
      cube([floor_rib_width, box_depth - 2 * wall + 0.6,
        floor_rib_height + 0.15]);
  for (y = [35, 70, 105, 140])
    translate([wall - 0.3, y - floor_rib_width / 2, floor_thickness - 0.15])
      cube([box_width - 2 * wall + 0.6, floor_rib_width,
        floor_rib_height + 0.15]);
}

module local_wall_reinforcement() {
  // The speaker/grille fasteners and M11 jack still clamp 3 mm local panels.
  translate([128, 0, 5]) cube([70, 3.0, 70]);
  translate([162, box_depth - 3.0, 19]) cube([22, 3.0, 22]);
}

module rear_vent_baffle() {
  translate([70, box_depth - wall - vent_baffle_gap - vent_baffle_thickness,
    floor_thickness])
    cube([vent_baffle_width, vent_baffle_thickness,
      vent_baffle_top_z - floor_thickness]);
}

module child_lock_bosses() {
  global_y = lid_origin_y + child_lock_screw_local_y;
  structure_height = lid_seat_z - child_lock_captive_clearance - floor_thickness;
  for (local_x = child_lock_screw_local_x) {
    global_x = lid_origin_x + local_x;
    translate([global_x, global_y, floor_thickness])
      cylinder(h = structure_height, d = child_lock_boss_diameter);
    translate([global_x - child_lock_brace_width / 2, wall, floor_thickness])
      cube([child_lock_brace_width, global_y - wall, structure_height]);
  }
  translate([lid_origin_x + child_lock_screw_local_x[0],
    global_y - child_lock_cross_brace_depth, floor_thickness])
    cube([child_lock_screw_local_x[1] - child_lock_screw_local_x[0],
      child_lock_cross_brace_depth, structure_height]);
}

module child_lock_nut_cut_at(global_x, global_y, top_z, pilot_bottom_z) {
  nut_vertex_diameter = child_lock_nut_across_flats / cos(30);
  nut_bottom_z = top_z - child_lock_nut_roof_thickness - child_lock_nut_pocket_height;
  translate([global_x, global_y, pilot_bottom_z])
    cylinder(h = top_z - pilot_bottom_z + 1, d = child_lock_screw_hole_diameter);
  translate([global_x, global_y, nut_bottom_z])
    rotate([0, 0, 30]) cylinder(h = child_lock_nut_pocket_height,
      d = nut_vertex_diameter, $fn = 6);
  translate([global_x - child_lock_nut_entry_width / 2, global_y,
    nut_bottom_z])
    cube([child_lock_nut_entry_width, child_lock_boss_diameter / 2 + 1,
      child_lock_nut_pocket_height]);
}

module child_lock_base_cuts() {
  for (local_x = child_lock_screw_local_x)
    child_lock_nut_cut_at(lid_origin_x + local_x,
      lid_origin_y + child_lock_screw_local_y,
      lid_seat_z - child_lock_captive_clearance, child_lock_pilot_bottom_z);
}

module microphone_slide_rails() {
  pocket = microphone_board_size + microphone_board_clearance;
  rail_z = microphone_centre_z - pocket / 2 - microphone_bottom_stop;
  // Two open-top rails and a bottom stop hold the square board against a thin
  // gasket. The module can be serviced after removing the lid.
  for (dx = [-pocket / 2 - microphone_rail_thickness,
    pocket / 2])
    translate([microphone_centre_x + dx, wall, rail_z])
      cube([microphone_rail_thickness, microphone_rail_depth,
        pocket + microphone_bottom_stop]);
  // Rear lips turn the side bars into open-top U-channels, so the module
  // cannot fall inward after it is slid down against its gasket.
  translate([microphone_centre_x - pocket / 2,
    wall + microphone_board_thickness_allowance, rail_z])
    cube([0.8, microphone_rail_depth - microphone_board_thickness_allowance,
      pocket + microphone_bottom_stop]);
  translate([microphone_centre_x + pocket / 2 - 0.8,
    wall + microphone_board_thickness_allowance, rail_z])
    cube([0.8, microphone_rail_depth - microphone_board_thickness_allowance,
      pocket + microphone_bottom_stop]);
  translate([microphone_centre_x - pocket / 2 - microphone_rail_thickness,
    wall, rail_z])
    cube([pocket + 2 * microphone_rail_thickness,
      microphone_rail_depth, microphone_bottom_stop]);
}

module speaker_sound_field_cut() {
  for (dx = [-20 : 5 : 20])
    for (dz = [-20 : 5 : 20])
      if (pow(dx, 2) + pow(dz, 2) <= pow(21, 2))
        front_through_hole(speaker_centre_x + dx,
          speaker_centre_z + dz, speaker_sound_hole_diameter);
}

module speaker_grille_recess_cut() {
  translate([speaker_centre_x, -0.1, speaker_centre_z])
    rotate([-90, 0, 0])
      cylinder(h = speaker_grille_recess_depth + 0.1,
        d = speaker_grille_recess_diameter);
}

module speaker_grille_slots_cut() {
  for (angle = [45, 135, 225, 315])
    hull() {
      front_through_hole(speaker_centre_x + speaker_grille_slot_inner_radius * cos(angle),
        speaker_centre_z + speaker_grille_slot_inner_radius * sin(angle), 3.4);
      front_through_hole(speaker_centre_x + speaker_grille_slot_outer_radius * cos(angle),
        speaker_centre_z + speaker_grille_slot_outer_radius * sin(angle), 3.4);
    }
}

module speaker_mount_holes_cut() {
  // Cardinal holes correspond to the reference 52 mm square speaker rotated 45°.
  for (angle = [0, 90, 180, 270])
    front_through_hole(speaker_centre_x + speaker_mount_radius * cos(angle),
      speaker_centre_z + speaker_mount_radius * sin(angle),
      speaker_mount_hole_diameter);
}

module microphone_path_cut() {
  front_through_hole(microphone_centre_x, microphone_centre_z,
    microphone_port_hole_diameter);
  translate([microphone_centre_x, wall + 0.1, microphone_centre_z])
    rotate([90, 0, 0])
      cylinder(h = 1.1, d = microphone_plenum_diameter);
}

module rear_vent_cut() {
  for (row = [0, 1])
    for (column = [0 : 5]) {
      x = 76 + column * 11 + row * 5.5;
      z = 68 + row * 8;
      translate([x - vent_slot_width / 2, box_depth - wall - 0.5,
        z - vent_slot_height / 2])
        cube([vent_slot_width, wall + 1, vent_slot_height]);
    }
}

module rear_tab_pocket_cut() {
  for (centre = rear_tab_centres)
    translate([lid_origin_x + centre - rear_tab_width / 2 - 0.25,
      box_depth - wall - 0.6, lid_seat_z - 0.2])
      cube([rear_tab_width + 0.5, rear_tab_depth + 0.3,
        rear_tab_thickness + 0.5]);
}

module base_cutouts() {
  speaker_sound_field_cut();
  speaker_grille_recess_cut();
  speaker_grille_slots_cut();
  speaker_mount_holes_cut();
  microphone_path_cut();
  title_engraving_cut();
  rear_through_hole(dc_jack_centre_x, dc_jack_centre_z, dc_jack_hole_diameter);
  rear_vent_cut();
  rear_tab_pocket_cut();
  child_lock_base_cuts();
  for (point = tray_mount_points)
    translate([point[0], point[1], floor_thickness - 0.5])
      cylinder(h = tray_boss_height + 1, d = tray_pilot_hole_diameter);
}

module base() {
  difference() {
    union() {
      base_shell();
      floor_stiffening_ribs();
      local_wall_reinforcement();
      lid_support_ledges();
      tray_bosses();
      rear_vent_baffle();
      child_lock_bosses();
      microphone_slide_rails();
    }
    base_cutouts();
  }
}

// Lid ------------------------------------------------------------------------
module lid_outline_2d() {
  rounded_rectangle_2d(lid_width, lid_depth, lid_corner_radius);
}

module rear_capture_tabs() {
  for (centre = rear_tab_centres)
    translate([centre - rear_tab_width / 2, lid_depth - 0.2, 0])
      cube([rear_tab_width, rear_tab_depth + 0.2, rear_tab_thickness]);
}

module child_lock_load_pads() {
  for (x = child_lock_screw_local_x)
    translate([x, child_lock_screw_local_y, lid_thickness])
      cylinder(h = child_lock_load_pad_height, d = child_lock_load_pad_diameter);
}

module control_lid() {
  difference() {
    union() {
      linear_extrude(height = lid_thickness) lid_outline_2d();
      rear_capture_tabs();
      child_lock_load_pads();
    }
    for (x = button_x_centres) {
      for (y = button_y_centres)
        translate([x, y, -0.5])
          cylinder(h = lid_thickness + 1, d = button_hole_diameter);
      for (y = label_y_centres)
        translate([x, y, lid_thickness - label_recess_depth])
          cylinder(h = label_recess_depth + 0.5,
            d = label_recess_diameter);
    }
    for (x = child_lock_screw_local_x) {
      translate([x, child_lock_screw_local_y, -0.5])
        cylinder(h = lid_thickness + child_lock_load_pad_height + 1,
          d = child_lock_screw_hole_diameter);
      translate([x, child_lock_screw_local_y,
        lid_thickness + child_lock_load_pad_height - child_lock_head_recess_depth])
        cylinder(h = child_lock_head_recess_depth + 0.5,
          d = child_lock_head_recess_diameter);
    }
  }
}

include <printable_accessories.scad>

// Preview hardware -----------------------------------------------------------
button_colours = [
  [0.95, 0.18, 0.12], [0.12, 0.42, 0.95],
  [0.56, 0.22, 0.82], [0.12, 0.76, 0.36],
  [0.98, 0.70, 0.08], [1.00, 0.46, 0.06],
  [0.08, 0.72, 0.72], [0.95, 0.24, 0.58]
];

module preview_hardware() {
  for (row = [0, 1])
    for (column = [0 : 3]) {
      index = row * 4 + column;
      x = lid_origin_x + button_x_centres[column];
      color(button_colours[index])
        translate([x, lid_origin_y + button_y_centres[row],
          lid_seat_z + lid_thickness])
          cylinder(h = 9, d1 = button_bezel_diameter, d2 = 28);
      color([0.95, 0.90, 0.80])
        translate([x, lid_origin_y + label_y_centres[row],
          lid_seat_z + lid_thickness + 0.02])
          cylinder(h = 0.3, d = label_disc_nominal_diameter);
    }
  color([0.08, 0.08, 0.08])
    translate([speaker_centre_x, -0.45, speaker_centre_z])
      rotate([-90, 0, 0]) cylinder(h = 0.7, d = speaker_grille_outer_diameter);
}

module assembly() {
  color([0.20, 0.48, 0.62]) base();
  translate([lid_origin_x, lid_origin_y, lid_seat_z + EXPLODE])
    color([0.90, 0.78, 0.48]) control_lid();
  if (SHOW_HARDWARE && EXPLODE == 0) preview_hardware();
}

// Export router --------------------------------------------------------------
if (PART == "assembly") {
  assembly();
} else if (PART == "base") {
  base();
} else if (PART == "control_lid") {
  control_lid();
} else if (PART == "electronics_tray") {
  electronics_tray();
} else {
  assert(false, str("Unknown PART: ", PART));
}
