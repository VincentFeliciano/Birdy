// Printers the engine's own profiles don't include, shipped with Boaty as user presets.
// Each one inherits the engine's closest relative and changes only what differs.
import type { PresetKind } from '../../src/types/slicing'
import { BED_TEMP_KEYS, customPreset } from './presets.ts'

const bedTemps = (t: number, first = t) => Object.fromEntries(BED_TEMP_KEYS.flatMap((k) => [[k, String(t)], [`${k}_initial_layer`, String(first)]]))

const MEGA_X = 'Anycubic Mega X 0.4 nozzle'
/** Bump when these presets change, so copies Boaty wrote earlier (and nobody edited) are replaced. */
export const BUILTIN_REV = 3
const meta = { birdy_vendor: 'Anycubic', birdy_builtin: true, birdy_builtin_rev: BUILTIN_REV }

/**
 * Smooth, not slow: the Mega X is a big, heavy bed-slinger from 2020 with a Bowden extruder and
 * stock Marlin 1.1. Ringing and corner jerks come from the 300 mm bed being yanked around, so the
 * outside of the model (outer wall, top surface) gets low acceleration and jerk, while infill and
 * travel, which nobody sees, keep the print time reasonable.
 */
const smooth = {
  // Acceleration, mm/s²
  default_acceleration: '800',
  outer_wall_acceleration: '500',
  inner_wall_acceleration: '800',
  top_surface_acceleration: '600',
  sparse_infill_acceleration: '1000',
  internal_solid_infill_acceleration: '800',
  bridge_acceleration: '500',
  travel_acceleration: '1000',
  initial_layer_acceleration: '400',
  // Jerk, mm/s (Marlin 1.1 classic jerk; the stock firmware allows up to 10)
  default_jerk: '8',
  outer_wall_jerk: '7',
  inner_wall_jerk: '8',
  top_surface_jerk: '7',
  infill_jerk: '10',
  travel_jerk: '10',
  initial_layer_jerk: '6',
  // Slow down on steep overhangs; small holes and posts at half the outer wall speed.
  enable_overhang_speed: '1',
  small_perimeter_speed: '50%',
}

/**
 * Anycubic Mega X (2020): 300 × 300 × 305 mm, heated bed (max 90 °C), Bowden extruder,
 * 0.4 mm nozzle (max 250 °C), 1.75 mm filament, Marlin. Built on the engine's i3 Mega S profile,
 * the same family and firmware.
 */
const megaX = {
  machine: customPreset('machine', MEGA_X, 'Anycubic i3 Mega S 0.4 nozzle', {
    printable_area: '0x0,300x0,300x300,0x300',
    printable_height: '305',
    nozzle_diameter: '0.4',
    gcode_flavor: 'marlin',
    // Bowden: modest retraction, tuned up from here if it strings.
    retraction_length: '4.5',
    retraction_speed: '30',
    deretraction_speed: '30',
    // Firmware limits the engine plans with (normal, silent).
    machine_max_acceleration_extruding: '1000,1000',
    machine_max_acceleration_retracting: '1000,1000',
    machine_max_acceleration_travel: '1000,1000',
    machine_max_acceleration_x: '1000,1000',
    machine_max_acceleration_y: '1000,1000',
    machine_max_speed_x: '200,200',
    machine_max_speed_y: '200,200',
    machine_max_jerk_x: '10,10',
    machine_max_jerk_y: '10,10',
  }, { ...meta, birdy_max_nozzle: 250, birdy_max_bed: 90, birdy_heated_bed: true }),
  process: [
    customPreset('process', `0.20mm Standard @${MEGA_X}`, '0.20mm Standard @Anycubic i3MegaS', {
      layer_height: '0.2',
      initial_layer_print_height: '0.2',
      outer_wall_speed: '35',
      inner_wall_speed: '50',
      sparse_infill_speed: '60',
      internal_solid_infill_speed: '50',
      top_surface_speed: '35',
      gap_infill_speed: '30',
      bridge_speed: '25',
      internal_bridge_speed: '30',
      support_speed: '45',
      support_interface_speed: '35',
      initial_layer_speed: '20',
      initial_layer_infill_speed: '30',
      initial_layer_travel_speed: '80',
      travel_speed: '120',
      ...smooth,
    }, meta),
    customPreset('process', `0.12mm Fine @${MEGA_X}`, '0.15mm Optimal @Anycubic i3MegaS', {
      layer_height: '0.12',
      initial_layer_print_height: '0.2',
      outer_wall_speed: '30',
      inner_wall_speed: '45',
      sparse_infill_speed: '55',
      internal_solid_infill_speed: '45',
      top_surface_speed: '30',
      gap_infill_speed: '25',
      bridge_speed: '25',
      internal_bridge_speed: '30',
      support_speed: '40',
      support_interface_speed: '30',
      initial_layer_speed: '20',
      initial_layer_infill_speed: '30',
      initial_layer_travel_speed: '80',
      travel_speed: '120',
      ...smooth,
    }, meta),
  ],
  filament: [
    // Max flow: what the stock Bowden hotend melts cleanly. Pressure advance off: the stock firmware has no linear advance.
    customPreset('filament', `PLA @${MEGA_X}`, 'Generic PLA @System', {
      filament_type: 'PLA', nozzle_temperature: '205', nozzle_temperature_initial_layer: '210', ...bedTemps(60),
      fan_min_speed: '100', fan_max_speed: '100', close_fan_the_first_x_layers: '1',
      filament_max_volumetric_speed: '12', enable_pressure_advance: '0',
    }, meta),
    customPreset('filament', `PETG @${MEGA_X}`, 'Generic PETG @System', {
      filament_type: 'PETG', nozzle_temperature: '235', nozzle_temperature_initial_layer: '235', ...bedTemps(70),
      fan_min_speed: '50', fan_max_speed: '80', close_fan_the_first_x_layers: '3',
      filament_max_volumetric_speed: '9', enable_pressure_advance: '0',
    }, meta),
    // ABS usually wants 100 °C; this bed tops out at 90.
    customPreset('filament', `ABS @${MEGA_X}`, 'Generic ABS @System', {
      filament_type: 'ABS', nozzle_temperature: '230', nozzle_temperature_initial_layer: '235', ...bedTemps(90),
      fan_min_speed: '0', fan_max_speed: '0', close_fan_the_first_x_layers: '3',
      filament_max_volumetric_speed: '12', enable_pressure_advance: '0',
    }, meta),
  ],
}

export const BUILTIN_PRESETS: { kind: PresetKind; json: Record<string, unknown> }[] = [
  { kind: 'machine', json: megaX.machine },
  ...megaX.process.map((json) => ({ kind: 'process' as const, json })),
  ...megaX.filament.map((json) => ({ kind: 'filament' as const, json })),
]
