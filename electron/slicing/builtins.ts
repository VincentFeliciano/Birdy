// Printers the engine's own profiles don't include, shipped with Birdy as user presets.
// Each one inherits the engine's closest relative and changes only what differs.
import type { PresetKind } from '../../src/types/slicing'
import { BED_TEMP_KEYS, customPreset } from './presets'

const bedTemps = (t: number, first = t) => Object.fromEntries(BED_TEMP_KEYS.flatMap((k) => [[k, String(t)], [`${k}_initial_layer`, String(first)]]))

const MEGA_X = 'Anycubic Mega X 0.4 nozzle'

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
  }, { birdy_vendor: 'Anycubic', birdy_builtin: true, birdy_max_nozzle: 250, birdy_max_bed: 90, birdy_heated_bed: true }),
  process: [
    customPreset('process', `0.20mm Standard @${MEGA_X}`, '0.20mm Standard @Anycubic i3MegaS', {
      layer_height: '0.2',
      initial_layer_print_height: '0.2',
      outer_wall_speed: '40',
      inner_wall_speed: '55',
      sparse_infill_speed: '60',
      internal_solid_infill_speed: '55',
      top_surface_speed: '40',
      initial_layer_speed: '20',
      initial_layer_infill_speed: '30',
      travel_speed: '120',
    }, { birdy_vendor: 'Anycubic', birdy_builtin: true }),
    customPreset('process', `0.12mm Fine @${MEGA_X}`, '0.15mm Optimal @Anycubic i3MegaS', {
      layer_height: '0.12',
      initial_layer_print_height: '0.2',
      outer_wall_speed: '35',
      inner_wall_speed: '50',
      sparse_infill_speed: '55',
      internal_solid_infill_speed: '50',
      top_surface_speed: '35',
      initial_layer_speed: '20',
      initial_layer_infill_speed: '30',
      travel_speed: '120',
    }, { birdy_vendor: 'Anycubic', birdy_builtin: true }),
  ],
  filament: [
    customPreset('filament', `PLA @${MEGA_X}`, 'Generic PLA @System', {
      filament_type: 'PLA', nozzle_temperature: '205', nozzle_temperature_initial_layer: '210', ...bedTemps(60),
      fan_min_speed: '100', fan_max_speed: '100', close_fan_the_first_x_layers: '1',
    }, { birdy_vendor: 'Anycubic', birdy_builtin: true }),
    customPreset('filament', `PETG @${MEGA_X}`, 'Generic PETG @System', {
      filament_type: 'PETG', nozzle_temperature: '235', nozzle_temperature_initial_layer: '235', ...bedTemps(70),
      fan_min_speed: '50', fan_max_speed: '80', close_fan_the_first_x_layers: '3',
    }, { birdy_vendor: 'Anycubic', birdy_builtin: true }),
    // ABS usually wants 100 °C; this bed tops out at 90.
    customPreset('filament', `ABS @${MEGA_X}`, 'Generic ABS @System', {
      filament_type: 'ABS', nozzle_temperature: '230', nozzle_temperature_initial_layer: '235', ...bedTemps(90),
      fan_min_speed: '0', fan_max_speed: '0', close_fan_the_first_x_layers: '3',
    }, { birdy_vendor: 'Anycubic', birdy_builtin: true }),
  ],
}

export const BUILTIN_PRESETS: { kind: PresetKind; json: Record<string, unknown> }[] = [
  { kind: 'machine', json: megaX.machine },
  ...megaX.process.map((json) => ({ kind: 'process' as const, json })),
  ...megaX.filament.map((json) => ({ kind: 'filament' as const, json })),
]
