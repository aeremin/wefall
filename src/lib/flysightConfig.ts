/**
 * FlySight 2 configuration files (config.txt and the selectable files in /config).
 *
 * Mirrors FS_Config_Read in the firmware's FlySight/config.c: each line is "Name: value ; comment",
 * values are integers (file names for Init_File and Alarm_File), and Sp_Mode/Sp_Units/Sp_Dec,
 * Alarm_Elev/Alarm_Type/Alarm_File and Win_Top/Win_Bottom repeat to form lists.
 *
 * The firmware reads config.txt and then the selectable file chosen in config mode, so a key a
 * selectable file leaves out keeps its config.txt value. The model therefore tracks which keys a
 * file sets, and only those are written back.
 */

export interface Option {
  value: number;
  label: string;
}

export interface ConfigField {
  key: string;
  label: string;
  /** Value the firmware uses when no file sets the key. */
  default: number | string;
  options?: Option[];
  min?: number;
  max?: number;
  /** Unit label, or a function of the current values for mode-dependent units. */
  unit?: string | ((c: FlySightConfig) => string);
  /** Human-readable rendering of the value, shown next to the input. */
  hint?: (value: number, c: FlySightConfig) => string | null;
  /** Text field (8.3 file name without extension) instead of a number. */
  text?: boolean;
  help?: string;
}

export interface ConfigSection {
  title: string;
  description?: string;
  fields: ConfigField[];
  /** Hidden behind "Show advanced settings". */
  advanced?: boolean;
}

export interface SpeechItem {
  mode: number;
  units: number;
  decimals: number;
}

export interface AlarmItem {
  elev: number;
  type: number;
  file: string;
}

export interface SilenceWindow {
  top: number;
  bottom: number;
}

export type ListName = 'speech' | 'alarms' | 'windows';

export interface FlySightConfig {
  /** Scalar settings the file sets, by key; keys it leaves out are absent. */
  values: Record<string, number | string>;
  speech: SpeechItem[];
  alarms: AlarmItem[];
  windows: SilenceWindow[];
  /** Lists the file sets. A selectable config that sets none keeps config.txt's list. */
  lists: Set<ListName>;
  /** Keys this editor does not know, kept as-is. */
  extra: [string, string][];
}

export const MAX_SPEECH = 3;
export const MAX_ALARMS = 20;
export const MAX_WINDOWS = 2;

const MODE_LABELS: Record<number, string> = {
  0: 'Horizontal speed',
  1: 'Vertical speed',
  2: 'Glide ratio',
  3: 'Inverse glide ratio',
  4: 'Total speed',
  5: 'Direction to destination',
  6: 'Distance to destination',
  7: 'Direction to bearing',
  8: 'Magnitude of tone value',
  9: 'Change in tone value',
  11: 'Dive angle',
  12: 'Altitude above DZ_Elev',
};

const modes = (...values: number[]): Option[] => values.map((value) => ({ value, label: `${value} – ${MODE_LABELS[value]}` }));

export const TONE_MODES = modes(0, 1, 2, 3, 4, 11, 5, 6, 7);
export const RATE_MODES = modes(0, 1, 2, 3, 4, 11, 8, 9, 5, 6, 7);
export const SPEECH_MODES = modes(0, 1, 2, 3, 4, 11, 12, 5, 6, 7);

export const SPEECH_UNITS: Option[] = [
  { value: 0, label: 'km/h or m' },
  { value: 1, label: 'mph or ft' },
  { value: 2, label: 'knots or nautical miles' },
];

export const ALARM_TYPES: Option[] = [
  { value: 0, label: 'No alarm' },
  { value: 1, label: 'Beep' },
  { value: 2, label: 'Chirp up' },
  { value: 3, label: 'Chirp down' },
  { value: 4, label: 'Play file' },
];

/** Unit of Min/Max (tone) or Min_Val_2/Max_Val_2 (rate) for a measurement mode. */
function valueUnit(mode: number, isRate: boolean): string {
  if ([0, 1, 4].includes(mode)) return 'cm/s';
  if ([2, 3].includes(mode)) return 'ratio × 100';
  if (mode === 11) return '°';
  if (isRate && mode === 9) return '% × 100 per s';
  if (isRate && mode === 8) return 'same as tone';
  return 'set automatically';
}

function valueHint(mode: number, value: number): string | null {
  if ([0, 1, 4].includes(mode)) return `${round(value * 0.036, 1)} km/h · ${round(value * 0.0223694, 1)} mph`;
  if ([2, 3].includes(mode)) return `${round(value / 100, 2)} : 1`;
  return null;
}

export const YES_NO: Option[] = [
  { value: 0, label: 'No' },
  { value: 1, label: 'Yes' },
];

const round = (n: number, digits: number) => Number(n.toFixed(digits)).toLocaleString();

const toneMode = (c: FlySightConfig) => Number(effectiveValue(c, 'Mode'));
const rateMode = (c: FlySightConfig) => {
  const m = Number(effectiveValue(c, 'Mode_2'));
  return m === 8 ? toneMode(c) : m;
};

const speedHint = (v: number) => `${round(v * 0.036, 1)} km/h · ${round(v * 0.0223694, 1)} mph`;
const feetHint = (v: number) => `${round(v * 3.28084, 0)} ft`;
const degHint = (v: number) => `${(v / 1e7).toFixed(7)}°`;

function tzHint(v: number): string {
  const sign = v < 0 ? '−' : '+';
  const abs = Math.abs(v);
  return `UTC${sign}${Math.floor(abs / 3600)}:${String(Math.floor((abs % 3600) / 60)).padStart(2, '0')}`;
}

export const SECTIONS: ConfigSection[] = [
  {
    title: 'GPS',
    fields: [
      {
        key: 'Model',
        label: 'Dynamic model',
        default: 7,
        options: [
          { value: 0, label: 'Portable' },
          { value: 2, label: 'Stationary' },
          { value: 3, label: 'Pedestrian' },
          { value: 4, label: 'Automotive' },
          { value: 5, label: 'Sea' },
          { value: 6, label: 'Airborne, < 1 G' },
          { value: 7, label: 'Airborne, < 2 G' },
          { value: 8, label: 'Airborne, < 4 G' },
        ],
      },
      { key: 'Rate', label: 'Measurement rate', default: 200, min: 40, max: 1000, unit: 'ms', hint: (v) => (v > 0 ? `${round(1000 / v, 1)} Hz` : null) },
    ],
  },
  {
    title: 'Tone',
    description: 'The tone pitch follows the selected measurement between Min and Max.',
    fields: [
      { key: 'Mode', label: 'Measurement', default: 2, options: TONE_MODES },
      { key: 'Min', label: 'Lowest pitch value', default: 0, unit: (c) => valueUnit(toneMode(c), false), hint: (v, c) => valueHint(toneMode(c), v) },
      { key: 'Max', label: 'Highest pitch value', default: 300, unit: (c) => valueUnit(toneMode(c), false), hint: (v, c) => valueHint(toneMode(c), v) },
      {
        key: 'Limits',
        label: 'Outside the range',
        default: 1,
        options: [
          { value: 0, label: 'No tone' },
          { value: 1, label: 'Min/max tone' },
          { value: 2, label: 'Chirp up/down' },
          { value: 3, label: 'Chirp down/up' },
        ],
      },
      { key: 'Volume', label: 'Volume', default: 6, min: 0, max: 8, unit: '0–8' },
    ],
  },
  {
    title: 'Tone rate',
    description: 'How often the tone repeats, from Min_Rate at Min_Val_2 to Max_Rate at Max_Val_2.',
    fields: [
      { key: 'Mode_2', label: 'Measurement', default: 9, options: RATE_MODES },
      { key: 'Min_Val_2', label: 'Lowest rate value', default: 300, unit: (c) => valueUnit(Number(effectiveValue(c, 'Mode_2')), true), hint: (v, c) => valueHint(rateMode(c), v) },
      { key: 'Max_Val_2', label: 'Highest rate value', default: 1500, unit: (c) => valueUnit(Number(effectiveValue(c, 'Mode_2')), true), hint: (v, c) => valueHint(rateMode(c), v) },
      { key: 'Min_Rate', label: 'Minimum rate', default: 100, min: 0, unit: 'Hz × 100', hint: (v) => `${round(v / 100, 2)} Hz` },
      { key: 'Max_Rate', label: 'Maximum rate', default: 500, min: 0, unit: 'Hz × 100', hint: (v) => `${round(v / 100, 2)} Hz` },
      { key: 'Flatline', label: 'Flatline at minimum rate', default: 0, options: YES_NO },
    ],
  },
  {
    title: 'Speech',
    fields: [
      { key: 'Sp_Rate', label: 'Speech interval', default: 0, min: 0, max: 32, unit: 's', help: '0 turns speech off.' },
      { key: 'Sp_Volume', label: 'Speech volume', default: 8, min: 0, max: 8, unit: '0–8' },
    ],
  },
  {
    title: 'Thresholds',
    description: 'The tone sounds only above both speeds.',
    fields: [
      { key: 'V_Thresh', label: 'Minimum vertical speed', default: 1000, unit: 'cm/s', hint: speedHint },
      { key: 'H_Thresh', label: 'Minimum horizontal speed', default: 0, unit: 'cm/s', hint: speedHint },
    ],
  },
  {
    title: 'Miscellaneous',
    fields: [
      { key: 'Use_SAS', label: "Use skydiver's airspeed", default: 1, options: YES_NO, help: 'Corrects speeds for air density at altitude.' },
      { key: 'TZ_Offset', label: 'Time zone offset of output files', default: 0, unit: 's', hint: tzHint },
      {
        key: 'Init_Mode',
        label: 'At power on',
        default: 0,
        options: [
          { value: 0, label: 'Do nothing' },
          { value: 1, label: 'Test speech mode' },
          { value: 2, label: 'Play file' },
        ],
      },
      { key: 'Init_File', label: 'File to play', default: '', text: true, help: 'Name of an audio file in /audio, without extension.' },
    ],
  },
  {
    title: 'Alarms',
    description:
      'GPS measurements depend on weak satellite signals. Never rely on these alarms to indicate breakoff or deployment altitude.',
    fields: [
      { key: 'DZ_Elev', label: 'Ground elevation', default: 0, unit: 'm MSL', hint: feetHint },
      { key: 'Win_Above', label: 'Window above each alarm', default: 0, unit: 'm' },
      { key: 'Win_Below', label: 'Window below each alarm', default: 0, unit: 'm' },
    ],
  },
  {
    title: 'Altitude announcements',
    description: 'Altitude is relative to DZ_Elev and is not announced below 1500 m above ground.',
    fields: [
      { key: 'Alt_Units', label: 'Units', default: 1, options: [{ value: 0, label: 'Meters' }, { value: 1, label: 'Feet' }] },
      { key: 'Alt_Step', label: 'Altitude between announcements', default: 0, min: 0, unit: 'm or ft', help: '0 turns announcements off.' },
    ],
  },
  {
    title: 'Navigation',
    advanced: true,
    description: 'Destination and bearing for the navigation modes (5–7).',
    fields: [
      { key: 'Lat', label: 'Destination latitude', default: 0, min: -900000000, max: 900000000, unit: '° × 10⁷', hint: degHint },
      { key: 'Lon', label: 'Destination longitude', default: 0, min: -1800000000, max: 1800000000, unit: '° × 10⁷', hint: degHint },
      { key: 'Bearing', label: 'Bearing', default: 0, min: 0, max: 360, unit: '°' },
      { key: 'End_Nav', label: 'Stop navigation tones below', default: 0, unit: 'm AGL', help: '0 keeps them on.' },
      { key: 'Max_Dist', label: 'Maximum distance to destination', default: 10000, min: 0, max: 10000, unit: 'm' },
      { key: 'Min_Angle', label: 'Silence within', default: 5, min: 0, max: 360, unit: '° of the heading' },
    ],
  },
  {
    title: 'Sensors and logging',
    advanced: true,
    fields: [
      { key: 'Enable_Audio', label: 'Audio', default: 1, options: YES_NO },
      { key: 'Enable_Logging', label: 'Logging', default: 1, options: YES_NO },
      { key: 'Enable_Gnss', label: 'GNSS', default: 1, options: YES_NO },
      { key: 'Enable_Baro', label: 'Barometer', default: 1, options: YES_NO },
      { key: 'Enable_Imu', label: 'IMU', default: 1, options: YES_NO },
      { key: 'Enable_Mag', label: 'Magnetometer', default: 1, options: YES_NO },
      { key: 'Enable_Hum', label: 'Humidity sensor', default: 1, options: YES_NO },
      { key: 'Enable_Vbat', label: 'Battery voltage', default: 1, options: YES_NO },
      { key: 'Enable_Mic', label: 'Microphone', default: 1, options: YES_NO },
      { key: 'Enable_Raw', label: 'Raw GNSS data', default: 1, options: YES_NO },
      { key: 'Cold_Start', label: 'GNSS cold start', default: 0, options: YES_NO },
      { key: 'Ble_Tx_Power', label: 'Bluetooth transmit power', default: 25, min: 0, max: 31, unit: '0–31' },
      { key: 'Baro_ODR', label: 'Barometer data rate', default: 2, min: 0, max: 7, unit: '0–7' },
      { key: 'Hum_ODR', label: 'Humidity data rate', default: 1, min: 0, max: 3, unit: '0–3' },
      { key: 'Mag_ODR', label: 'Magnetometer data rate', default: 0, min: 0, max: 3, unit: '0–3' },
      { key: 'Accel_ODR', label: 'Accelerometer data rate', default: 1, min: 0, max: 11, unit: '0–11' },
      { key: 'Accel_FS', label: 'Accelerometer full scale', default: 1, min: 0, max: 3, unit: '0–3' },
      { key: 'Gyro_ODR', label: 'Gyroscope data rate', default: 1, min: 0, max: 10, unit: '0–10' },
      { key: 'Gyro_FS', label: 'Gyroscope full scale', default: 3, min: 0, max: 3, unit: '0–3' },
    ],
  },
];

const FIELDS = new Map(SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f] as const)));
const LIST_KEYS = new Set(['Sp_Mode', 'Sp_Units', 'Sp_Dec', 'Alarm_Elev', 'Alarm_Type', 'Alarm_File', 'Win_Top', 'Win_Bottom']);

/** The file's value for a key, or the firmware default when it doesn't set it. */
export function effectiveValue(config: FlySightConfig, key: string): number | string {
  return config.values[key] ?? FIELDS.get(key)?.default ?? 0;
}

/** Integer value of a token, like the firmware's atol(). */
function atol(token: string): number {
  const match = /^[+-]?\d+/.exec(token);
  return match ? Number(match[0]) : 0;
}

/** File name token as the firmware stores it (at most 8 characters). */
function fileToken(token: string): string {
  return token.slice(0, 8);
}

export function emptyConfig(): FlySightConfig {
  return { values: {}, speech: [], alarms: [], windows: [], lists: new Set(), extra: [] };
}

/** The settings of the default config.txt the firmware writes when there is none. */
export function defaultConfig(): FlySightConfig {
  const values: Record<string, number | string> = Object.fromEntries(
    SECTIONS.filter((s) => !s.advanced).flatMap((s) => s.fields.filter((f) => f.default !== '').map((f) => [f.key, f.default])),
  );
  // Without the key the firmware speaks at full volume, but its default file sets 6.
  values.Sp_Volume = 6;
  return {
    ...emptyConfig(),
    values,
    speech: [{ mode: 2, units: 1, decimals: 1 }],
    lists: new Set(['speech', 'alarms', 'windows']),
  };
}

export function parseConfig(text: string): FlySightConfig {
  const config = emptyConfig();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split(';')[0];
    const [name, value] = line.split(/[\s:]+/).filter(Boolean);
    if (!name || value === undefined) continue;
    const field = FIELDS.get(name);

    if (field) {
      config.values[name] = field.text ? fileToken(value) : atol(value);
    } else if (name === 'Window') {
      // Legacy key that sets both alarm windows.
      config.values.Win_Above = config.values.Win_Below = atol(value);
    } else if (LIST_KEYS.has(name)) {
      const speech = config.speech.at(-1);
      const alarm = config.alarms.at(-1);
      const window = config.windows.at(-1);
      if (name === 'Sp_Mode') {
        config.lists.add('speech');
        if (config.speech.length < MAX_SPEECH) config.speech.push({ mode: atol(value), units: 1, decimals: 1 });
      } else if (name === 'Sp_Units' && speech) speech.units = atol(value);
      else if (name === 'Sp_Dec' && speech) speech.decimals = atol(value);
      else if (name === 'Alarm_Elev') {
        config.lists.add('alarms');
        if (config.alarms.length < MAX_ALARMS) config.alarms.push({ elev: atol(value), type: 0, file: '' });
      } else if (name === 'Alarm_Type' && alarm) alarm.type = atol(value);
      else if (name === 'Alarm_File' && alarm) alarm.file = fileToken(value);
      else if (name === 'Win_Top') {
        config.lists.add('windows');
        if (config.windows.length < MAX_WINDOWS) config.windows.push({ top: atol(value), bottom: 0 });
      } else if (name === 'Win_Bottom' && window) window.bottom = atol(value);
    } else {
      config.extra.push([name, value]);
    }
  }
  // The default file lists placeholder entries that do nothing; don't show them as real items.
  config.alarms = config.alarms.filter((a) => a.type !== 0 || a.elev !== 0);
  config.windows = config.windows.filter((w) => w.top !== 0 || w.bottom !== 0);
  return config;
}

/** Problems that would make the firmware ignore a value, keyed by setting or list name. */
export function validateConfig(config: FlySightConfig): Map<string, string> {
  const problems = new Map<string, string>();
  for (const [key, value] of Object.entries(config.values)) {
    const field = FIELDS.get(key);
    if (!field) continue;
    if (field.text) {
      if (/[\s;:]/.test(String(value))) problems.set(key, 'No spaces, colons or semicolons.');
      else if (String(value).length > 8) problems.set(key, 'At most 8 characters.');
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) problems.set(key, 'Enter a whole number.');
    else if (field.min != null && value < field.min) problems.set(key, `At least ${field.min}.`);
    else if (field.max != null && value > field.max) problems.set(key, `At most ${field.max}.`);
  }
  const wholeNumbers = (items: object[]) =>
    items.every((item) => Object.values(item).every((v) => typeof v !== 'number' || Number.isInteger(v)));
  if (!wholeNumbers(config.speech)) problems.set('speech', 'Enter whole numbers.');
  if (!wholeNumbers(config.alarms)) problems.set('alarms', 'Enter whole numbers.');
  if (!wholeNumbers(config.windows)) problems.set('windows', 'Enter whole numbers.');
  return problems;
}

/** Writes the settings the config sets, in the layout of the firmware's default config.txt. */
export function serializeConfig(config: FlySightConfig): string {
  const out: string[] = ['; FlySight - http://flysight.ca', '; Written by the WeFall FlySight configurator', ''];
  let block: string[] = [];
  const pad = (name: string) => `${name}:`.padEnd(14);
  const entry = (name: string, value: number | string, comment?: string) => {
    // An empty file name is left out: the firmware's default for it is empty too.
    if (value === '') return;
    block.push(comment ? `${pad(name)}${String(value).padEnd(6)}; ${comment}` : `${pad(name)}${value}`);
  };
  const flush = (title: string) => {
    if (block.length > 0) out.push(`; ${title}`, '', ...block, '');
    block = [];
  };
  /** An empty list is written as one entry that does nothing, as in the default config.txt. */
  const itemsOf = <T,>(list: ListName, items: T[], placeholder: T) =>
    config.lists.has(list) && items.length === 0 ? [placeholder] : items;

  for (const section of SECTIONS) {
    for (const f of section.fields) {
      if (f.key in config.values) entry(f.key, config.values[f.key], f.label);
    }
    if (section.title === 'Speech') {
      for (const s of config.speech) {
        if (block.length > 0) block.push('');
        entry('Sp_Mode', s.mode, MODE_LABELS[s.mode]);
        entry('Sp_Units', s.units, SPEECH_UNITS.find((u) => u.value === s.units)?.label);
        entry('Sp_Dec', s.decimals, s.mode === 12 ? 'Altitude step' : 'Decimal places');
      }
    }
    if (section.title === 'Alarms') {
      for (const a of itemsOf('alarms', config.alarms, { elev: 0, type: 0, file: '' })) {
        if (block.length > 0) block.push('');
        entry('Alarm_Elev', a.elev, 'm above ground');
        entry('Alarm_Type', a.type, ALARM_TYPES.find((t) => t.value === a.type)?.label);
        entry('Alarm_File', a.file);
      }
    }
    flush(section.title);
    if (section.title === 'Altitude announcements') {
      for (const w of itemsOf('windows', config.windows, { top: 0, bottom: 0 })) {
        entry('Win_Top', w.top, 'm above ground');
        entry('Win_Bottom', w.bottom, 'm above ground');
      }
      flush('Silence windows');
    }
  }

  for (const [name, value] of config.extra) entry(name, value);
  flush('Other settings');

  return out.join('\n');
}
