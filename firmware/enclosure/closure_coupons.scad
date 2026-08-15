// One-third-size closure interface coupons. These reproduce the complete
// screw/nut roof and rear tongue/roof stack without printing the 204 mm base.

closure_coupon_width = 70;
closure_coupon_depth = 45;
closure_coupon_wall = 3.2;
closure_coupon_floor = 3.2;
closure_coupon_seat_z = 15.2;
closure_coupon_total_height = closure_coupon_seat_z + lid_thickness;
closure_coupon_lid_width = 62.8;
closure_coupon_lid_depth = 37.8;
closure_coupon_lid_origin = 3.6;
closure_coupon_lock_x = closure_coupon_width / 2;
closure_coupon_lock_local_x = closure_coupon_lid_width / 2;
closure_coupon_lock_y = closure_coupon_lid_origin + child_lock_screw_local_y;
closure_coupon_tab_width = 18;

module closure_coupon_shell() {
  difference() {
    rounded_prism(
      closure_coupon_width,
      closure_coupon_depth,
      closure_coupon_total_height,
      4
    );
    translate([
      closure_coupon_wall,
      closure_coupon_wall,
      closure_coupon_floor
    ])
      rounded_prism(
        closure_coupon_width - 2 * closure_coupon_wall,
        closure_coupon_depth - 2 * closure_coupon_wall,
        closure_coupon_total_height,
        1.5
      );
  }
}

module closure_coupon_ledge() {
  translate([
    8,
    closure_coupon_wall,
    closure_coupon_seat_z - ledge_height
  ])
    cube([
      closure_coupon_width - 16,
      ledge_depth,
      ledge_height
    ]);
}

module closure_coupon_tower() {
  structure_height = closure_coupon_seat_z -
    child_lock_captive_washer_clearance - closure_coupon_floor;
  translate([
    closure_coupon_lock_x,
    closure_coupon_lock_y,
    closure_coupon_floor
  ])
    cylinder(h = structure_height, d = child_lock_boss_diameter);
  translate([
    closure_coupon_lock_x - child_lock_brace_width / 2,
    closure_coupon_wall,
    closure_coupon_floor
  ])
    cube([
      child_lock_brace_width,
      closure_coupon_lock_y - closure_coupon_wall,
      structure_height
    ]);
}

module closure_coupon_base_cuts() {
  child_lock_nut_cut_at(
    closure_coupon_lock_x,
    closure_coupon_lock_y,
    closure_coupon_seat_z - child_lock_captive_washer_clearance,
    closure_coupon_floor
  );
  translate([
    closure_coupon_width / 2 - closure_coupon_tab_width / 2 - 0.25,
    closure_coupon_depth - closure_coupon_wall - 0.6,
    closure_coupon_seat_z - 0.2
  ])
    cube([
      closure_coupon_tab_width + 0.5,
      rear_tab_depth + 0.3,
      rear_tab_thickness + 0.6
    ]);
}

module closure_base_coupon() {
  difference() {
    union() {
      closure_coupon_shell();
      closure_coupon_ledge();
      closure_coupon_tower();
    }
    closure_coupon_base_cuts();
  }
}

module closure_lid_coupon() {
  difference() {
    union() {
      rounded_prism(
        closure_coupon_lid_width,
        closure_coupon_lid_depth,
        lid_thickness,
        3
      );
      translate([
        closure_coupon_lid_width / 2 - closure_coupon_tab_width / 2,
        closure_coupon_lid_depth - 0.2,
        0
      ])
        cube([
          closure_coupon_tab_width,
          rear_tab_depth + 0.2,
          rear_tab_thickness
        ]);
      translate([
        closure_coupon_lock_local_x,
        child_lock_screw_local_y,
        lid_thickness
      ])
        cylinder(
          h = child_lock_load_pad_height,
          d = child_lock_load_pad_diameter
        );
    }

    translate([
      closure_coupon_lock_local_x,
      child_lock_screw_local_y,
      -0.5
    ])
      cylinder(
        h = lid_thickness + child_lock_load_pad_height + 1,
        d = child_lock_screw_hole_diameter
      );
    translate([
      closure_coupon_lock_local_x,
      child_lock_screw_local_y,
      lid_thickness + child_lock_load_pad_height -
        child_lock_head_recess_depth
    ])
      cylinder(
        h = child_lock_head_recess_depth + 0.5,
        d = child_lock_head_recess_diameter
      );
  }
}
