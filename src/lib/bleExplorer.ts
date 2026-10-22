/**
 * Helpers for the Bluetooth explorer: a generic Web Bluetooth GATT browser for working out the
 * protocols of devices without public documentation, such as the AON2 X2.
 *
 * Web Bluetooth only exposes services named in `optionalServices` when the device is picked, so
 * the explorer asks for a list of common ones plus any the user adds (for example from
 * chrome://bluetooth-internals or the nRF Connect app).
 */

export interface KnownService {
  uuid: string;
  name: string;
}

/** 128-bit UUID of a 16-bit Bluetooth SIG number. */
export function sigUuid(short: number): string {
  return `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}

/**
 * Services requested by default: standard ones and the custom ones common BLE chips and modules
 * ship with. Services on Chrome's GATT blocklist (HID, FIDO, legacy Nordic DFU, ...) are left
 * out, since Chrome won't expose them anyway.
 */
export const DEFAULT_SERVICES: KnownService[] = [
  { uuid: sigUuid(0x1800), name: 'Generic Access' },
  { uuid: sigUuid(0x1801), name: 'Generic Attribute' },
  { uuid: sigUuid(0x1805), name: 'Current Time' },
  { uuid: sigUuid(0x180a), name: 'Device Information' },
  { uuid: sigUuid(0x180f), name: 'Battery' },
  { uuid: sigUuid(0x1819), name: 'Location and Navigation' },
  { uuid: sigUuid(0x181a), name: 'Environmental Sensing' },
  { uuid: sigUuid(0x181c), name: 'User Data' },
  { uuid: sigUuid(0xfe59), name: 'Nordic Secure DFU' },
  { uuid: sigUuid(0xfff0), name: 'Vendor 0xFFF0' },
  { uuid: sigUuid(0xffe0), name: 'Vendor 0xFFE0 (HM-10 serial)' },
  { uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'Nordic UART' },
  { uuid: '8d53dc1d-1db7-4cd3-868b-8a527460aa84', name: 'MCUmgr SMP' },
  { uuid: '0000fe40-cc7a-482a-984a-7f2ed5b3e58f', name: 'ST P2P Server' },
  { uuid: '00000000-cc7a-482a-984a-7f2ed5b3e58f', name: 'FlySight CRS' },
  { uuid: '49535343-fe7d-4ae5-8fa9-9fafd205e455', name: 'Microchip Transparent UART' },
  { uuid: '1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0', name: 'Silicon Labs OTA' },
];

/** Names of standard characteristics and descriptors, by 16-bit number. */
const SIG_NAMES: Record<number, string> = {
  0x2a00: 'Device Name',
  0x2a01: 'Appearance',
  0x2a04: 'Peripheral Preferred Connection Parameters',
  0x2a05: 'Service Changed',
  0x2a19: 'Battery Level',
  0x2a23: 'System ID',
  0x2a24: 'Model Number',
  0x2a25: 'Serial Number',
  0x2a26: 'Firmware Revision',
  0x2a27: 'Hardware Revision',
  0x2a28: 'Software Revision',
  0x2a29: 'Manufacturer Name',
  0x2a2b: 'Current Time',
  0x2a50: 'PnP ID',
  0x2a67: 'Location and Speed',
  0x2a6c: 'Elevation',
  0x2a6d: 'Pressure',
  0x2a6e: 'Temperature',
  0x2aa6: 'Central Address Resolution',
  0x2b29: 'Client Supported Features',
  0x2b2a: 'Database Hash',
  0x2900: 'Characteristic Extended Properties',
  0x2901: 'Characteristic User Description',
  0x2902: 'Client Characteristic Configuration',
  0x2903: 'Server Characteristic Configuration',
  0x2904: 'Characteristic Presentation Format',
};

const SIG_BASE_RE = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/;

/** A readable name for a service, characteristic or descriptor UUID, if it's a known one. */
export function uuidName(uuid: string): string | undefined {
  const service = DEFAULT_SERVICES.find((s) => s.uuid === uuid);
  if (service) return service.name;
  const sig = SIG_BASE_RE.exec(uuid);
  return sig ? SIG_NAMES[parseInt(sig[1], 16)] : undefined;
}

/** Shortens SIG UUIDs to "0x2A19"; leaves custom ones whole. */
export function shortUuid(uuid: string): string {
  const sig = SIG_BASE_RE.exec(uuid);
  return sig ? `0x${sig[1].toUpperCase()}` : uuid;
}

/**
 * Parses a service UUID as typed: a 16- or 32-bit hex number ("FFF0", "0xfff0") or a full
 * 128-bit UUID, with or without dashes. Returns the canonical lower-case form, or null.
 */
export function parseUuid(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{4}$|^[0-9a-f]{8}$/.test(s)) return `${s.padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
  const hex = s.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Printable ASCII, with other bytes shown as "·". */
export function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join('');
}

/** Parses "01 a0 FF", "01a0ff" or "0x01,0xa0" into bytes; returns null if it isn't hex. */
export function parseHex(raw: string): Uint8Array<ArrayBuffer> | null {
  const s = raw.replace(/0x/gi, '').replace(/[\s,:;-]/g, '');
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The properties a characteristic declares, as short labels. */
export function propertyLabels(p: BluetoothCharacteristicProperties): string[] {
  const labels: [boolean, string][] = [
    [p.broadcast, 'broadcast'],
    [p.read, 'read'],
    [p.writeWithoutResponse, 'write w/o response'],
    [p.write, 'write'],
    [p.notify, 'notify'],
    [p.indicate, 'indicate'],
    [p.authenticatedSignedWrites, 'signed write'],
    [p.reliableWrite, 'reliable write'],
    [p.writableAuxiliaries, 'writable aux'],
  ];
  return labels.filter(([on]) => on).map(([, label]) => label);
}

export function errorText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
