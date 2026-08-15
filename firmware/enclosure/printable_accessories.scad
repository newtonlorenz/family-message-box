// Lightweight exact-envelope electronics carrier.
// The 7 x 9 cm ELEGOO perfboard and the exact module outlines fit without a
// full solid slab. M3 bosses, screws and nuts come from reference M3 kit.

esp32_size = [63.5, 28.0];       // Diymore listing image.
buck_body_size = [46.0, 27.0];   // Aideepen listing image; 14 mm high.
amp_size = [18.0, 19.0];         // AZDelivery listing image.
perfboard_size = [90.0, 70.0];   // ELEGOO exact kit size used here.

module tray_outline() {
  rounded_prism(tray_width, tray_depth, tray_thickness, 5);
}

module tray_openings() {
  // Four large windows leave a printable perimeter and load-sharing cross-rib.
  // A 0.25 mm overlap into each nominal border avoids coplanar CGAL seams.
  for (x_range = [[tray_border_width + 0.25, tray_width / 2 - tray_rib_width / 2 - 0.15],
    [tray_width / 2 + tray_rib_width / 2 + 0.15, tray_width - tray_border_width - 0.25]])
    for (y_range = [[tray_border_width + 0.25, tray_depth / 2 - tray_rib_width / 2 - 0.15],
      [tray_depth / 2 + tray_rib_width / 2 + 0.15, tray_depth - tray_border_width - 0.25]])
      translate([x_range[0], y_range[0], -0.5])
        rounded_prism(x_range[1] - x_range[0], y_range[1] - y_range[0],
          tray_thickness + 1, 2);
}

module slot_at(x, y, length = 10, diameter = 3.4, angle = 0) {
  translate([x, y, -0.5])
    rotate([0, 0, angle])
      linear_extrude(height = tray_thickness + 2)
        capsule_2d(length, diameter);
}

module tray_fastener_slots() {
  // Carrier-to-floor holes.
  for (point = [[tray_mount_inset, tray_mount_inset],
    [tray_width - tray_mount_inset, tray_mount_inset],
    [tray_mount_inset, tray_depth - tray_mount_inset],
    [tray_width - tray_mount_inset, tray_depth - tray_mount_inset]])
    translate([point[0], point[1], -0.5])
      cylinder(h = tray_thickness + 1, d = 3.3);

  // 90 x 70 mm perfboard: slots accommodate the listing's corner holes.
  for (x = [8, 94])
    for (y = [6, 72]) slot_at(x, y, 7, 3.4, 0);

  // Exact ESP32 footprint tie slots (63.5 x 28 mm) at rear-right.
  for (x = [110, 166])
    for (y = [8, 34]) slot_at(x, y, 8, 3.2, 90);

  // Exact 46 x 27 mm buck body plus mounting-ear/cable-tie allowance.
  for (x = [112, 164])
    for (y = [49, 69]) slot_at(x, y, 9, 3.2, 90);

  // Small-board tie points for the 18 x 19 mm amplifier and ULN module.
  for (point = [[100, 16], [100, 30], [102, 53], [102, 66]])
    slot_at(point[0], point[1], 8, 3.2, 90);
}

module component_locator_rails() {
  // Low rails locate the 90 x 70 mm perfboard without adding a solid floor.
  rail_height = 1.6;
  for (x = [4, 96])
    translate([x, 3.8, tray_thickness - 0.15])
      cube([1.6, 70.4, rail_height + 0.15]);
  // Inside span is 70.4 mm for the exact 70 mm board envelope.
  for (y = [3.8, 76.0])
    translate([4, y, tray_thickness - 0.15])
      cube([93.8, 1.8, rail_height + 0.15]);

  // Buck body stops use the exact 46 x 27 mm envelope plus 0.6 mm clearance.
  translate([114, 47, tray_thickness - 0.15])
    cube([46.6, 1.6, rail_height + 0.15]);
  // Inside span is 27.3 mm for the exact 27 mm buck body envelope.
  translate([114, 75.9, tray_thickness - 0.15])
    cube([46.6, 1.6, rail_height + 0.15]);
}

module tray_adhesion_web() {
  // Permanent but only one first-layer high. It widens the two central ribs
  // from 3.2 mm to 14 mm where the failed print showed no bed grip.
  translate([tray_border_width,
    (tray_depth - tray_adhesion_web_width) / 2, 0])
      cube([tray_width - 2 * tray_border_width,
        tray_adhesion_web_width, tray_adhesion_web_height]);
  translate([(tray_width - tray_adhesion_web_width) / 2,
    tray_border_width, 0])
      cube([tray_adhesion_web_width,
        tray_depth - 2 * tray_border_width, tray_adhesion_web_height]);
}

module electronics_tray() {
  difference() {
    union() {
      difference() {
        tray_outline();
        tray_openings();
      }
      tray_adhesion_web();
      component_locator_rails();
    }
    tray_fastener_slots();
  }
}
