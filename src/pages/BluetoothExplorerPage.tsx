import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SERVICES,
  errorText,
  parseHex,
  parseUuid,
  propertyLabels,
  shortUuid,
  toAscii,
  toBytes,
  toHex,
  uuidName,
} from '../lib/bleExplorer';
import { isWebBluetoothSupported } from '../lib/flysightBle';

const SERVICES_KEY = 'bleExplorer.services';
const NAME_PREFIX_KEY = 'bleExplorer.namePrefix';
/** Entries kept in the log; older ones are dropped. */
const MAX_LOG = 10_000;
/** Entries rendered; the report and download always include the whole log. */
const SHOWN_LOG = 500;
/** How long to listen for an advertisement before connecting, when the browser supports it. */
const ADVERTISEMENT_WAIT_MS = 3000;
/** Chrome's first connection attempt often drops right away, especially on Windows. */
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 1000;

type LogKind = 'info' | 'error' | 'read' | 'write' | 'notify';

interface LogEntry {
  time: Date;
  kind: LogKind;
  /** Characteristic label ("S2.C1"), for value entries. */
  label?: string;
  bytes?: Uint8Array;
  text?: string;
}

interface DescriptorNode {
  uuid: string;
  /** Value of a Characteristic User Description, read at discovery. */
  value?: string;
}

interface CharacteristicNode {
  /** "S2.C1": service 2, characteristic 1, used to refer to it in the log. */
  label: string;
  uuid: string;
  properties: string[];
  canRead: boolean;
  canWrite: boolean;
  canWriteWithoutResponse: boolean;
  canSubscribe: boolean;
  descriptors: DescriptorNode[];
}

interface ServiceNode {
  label: string;
  uuid: string;
  characteristics: CharacteristicNode[];
}

interface WriteInput {
  value: string;
  mode: 'hex' | 'text';
}

function loadSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings just aren't remembered.
  }
}

/** Service UUIDs typed by the user, one per line or comma-separated; "#" starts a comment. */
function parseServiceList(text: string): { uuids: string[]; invalid: string[] } {
  const uuids: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split('\n')) {
    for (const token of line.replace(/#.*/, '').split(/[\s,;]+/)) {
      if (!token) continue;
      const uuid = parseUuid(token);
      if (uuid) uuids.push(uuid);
      else invalid.push(token);
    }
  }
  return { uuids, invalid };
}

function describe(uuid: string): string {
  const name = uuidName(uuid);
  return name ? `${shortUuid(uuid)} ${name}` : shortUuid(uuid);
}

function clock(time: Date): string {
  return `${time.toLocaleTimeString(undefined, { hour12: false })}.${String(time.getMilliseconds()).padStart(3, '0')}`;
}

function formatEntry(e: LogEntry): string {
  const parts = [clock(e.time), e.kind.toUpperCase().padEnd(6)];
  if (e.label) parts.push(e.label.padEnd(6));
  if (e.bytes) parts.push(`[${e.bytes.length}] ${toHex(e.bytes)}  |${toAscii(e.bytes)}|`);
  if (e.text) parts.push(e.text);
  return parts.join('  ');
}

function formatTree(services: ServiceNode[]): string {
  const lines: string[] = [];
  for (const s of services) {
    lines.push(`${s.label}  ${s.uuid}${uuidName(s.uuid) ? `  (${uuidName(s.uuid)})` : ''}`);
    for (const c of s.characteristics) {
      lines.push(`  ${c.label}  ${c.uuid}${uuidName(c.uuid) ? `  (${uuidName(c.uuid)})` : ''}  [${c.properties.join(', ')}]`);
      for (const d of c.descriptors) {
        lines.push(`      descriptor ${describe(d.uuid)}${d.value != null ? `: "${d.value}"` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

const KIND_CLASSES: Record<LogKind, string> = {
  info: 'text-slate-500',
  error: 'text-red-600',
  read: 'text-sky-700',
  write: 'text-amber-700',
  notify: 'text-emerald-700',
};

export default function BluetoothExplorerPage() {
  const [servicesText, setServicesText] = useState(() => loadSetting(SERVICES_KEY));
  const [namePrefix, setNamePrefix] = useState(() => loadSetting(NAME_PREFIX_KEY));
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceNode[]>([]);
  const [values, setValues] = useState<Record<string, Uint8Array>>({});
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());
  const [writes, setWrites] = useState<Record<string, WriteInput>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const characteristics = useRef(new Map<string, BluetoothRemoteGATTCharacteristic>());
  /** Reads in flight per characteristic: Chrome also fires characteristicvaluechanged for them. */
  const pendingReads = useRef(new Map<string, number>());
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const { uuids: extraServices, invalid } = parseServiceList(servicesText);

  useEffect(() => () => {
    if (deviceRef.current?.gatt?.connected) deviceRef.current.gatt.disconnect();
  }, []);

  useEffect(() => {
    if (autoScroll) logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [log, autoScroll]);

  function addLog(entry: Omit<LogEntry, 'time'>) {
    setLog((l) => {
      const next = [...l, { ...entry, time: new Date() }];
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }

  const info = (text: string) => addLog({ kind: 'info', text });
  const fail = (text: string, err: unknown) => addLog({ kind: 'error', text: `${text}: ${errorText(err)}` });

  function handleValue(label: string, characteristic: BluetoothRemoteGATTCharacteristic) {
    return () => {
      const pending = pendingReads.current.get(label) ?? 0;
      if (pending > 0) {
        // Our own read; readCharacteristic() logs it.
        pendingReads.current.set(label, pending - 1);
        return;
      }
      const value = characteristic.value;
      if (!value) return;
      const bytes = toBytes(value);
      setValues((v) => ({ ...v, [label]: bytes }));
      addLog({ kind: 'notify', label, bytes });
    };
  }

  // Kept stable so it can be removed from a device again; it only uses state setters and refs.
  const handleDisconnect = useRef(() => {
    info('Disconnected.');
    setConnected(false);
    setSubscribed(new Set());
    pendingReads.current.clear();
  }).current;

  /** Listens briefly for an advertisement, to log advertised services and manufacturer data. */
  async function logAdvertisement(picked: BluetoothDevice) {
    if (typeof picked.watchAdvertisements !== 'function') {
      info('This browser does not report advertisements (enable chrome://flags/#enable-experimental-web-platform-features to see them).');
      return;
    }
    const seen = new Promise<BluetoothAdvertisingEvent | null>((resolve) => {
      picked.addEventListener('advertisementreceived', (e) => resolve(e as BluetoothAdvertisingEvent), { once: true });
      setTimeout(() => resolve(null), ADVERTISEMENT_WAIT_MS);
    });
    const stop = new AbortController();
    try {
      await picked.watchAdvertisements({ signal: stop.signal });
    } catch (err) {
      fail('Watching advertisements failed', err);
      return;
    }
    const ad = await seen;
    stop.abort();
    if (!ad) {
      info(`No advertisement received within ${ADVERTISEMENT_WAIT_MS / 1000} s.`);
      return;
    }
    info(
      `Advertisement: name "${ad.name ?? ''}", RSSI ${ad.rssi ?? '?'} dBm, TX power ${ad.txPower ?? '?'}, ` +
        `appearance ${ad.appearance ?? '?'}, services [${ad.uuids.join(', ')}]`,
    );
    ad.manufacturerData.forEach((data, company) => {
      addLog({ kind: 'info', text: `Manufacturer data, company 0x${company.toString(16).padStart(4, '0')}`, bytes: toBytes(data) });
    });
    ad.serviceData.forEach((data, uuid) => {
      addLog({ kind: 'info', text: `Service data ${describe(String(uuid))}`, bytes: toBytes(data) });
    });
  }

  /** Connects and lists every service, characteristic and descriptor the browser exposes. */
  async function discover(picked: BluetoothDevice) {
    const gatt = picked.gatt;
    if (!gatt) throw new Error('The device has no GATT server.');
    characteristics.current.clear();
    pendingReads.current.clear();
    setSubscribed(new Set());
    setValues({});

    let server: BluetoothRemoteGATTServer | undefined;
    for (let attempt = 1; !server; attempt++) {
      info(`Connecting (attempt ${attempt})…`);
      try {
        const s = await gatt.connect();
        // A refused connection shows up as a successful connect() followed by a disconnect.
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (!gatt.connected) throw new Error('The device closed the connection.');
        server = s;
      } catch (err) {
        fail('Connection failed', err);
        if (attempt >= CONNECT_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
      }
    }
    setConnected(true);
    info('Connected. Listing services…');

    let primary: BluetoothRemoteGATTService[] = [];
    try {
      primary = await server.getPrimaryServices();
    } catch (err) {
      fail('No accessible services', err);
    }

    const tree: ServiceNode[] = [];
    for (const [i, service] of primary.entries()) {
      const node: ServiceNode = { label: `S${i + 1}`, uuid: service.uuid, characteristics: [] };
      tree.push(node);
      let chars: BluetoothRemoteGATTCharacteristic[] = [];
      try {
        chars = await service.getCharacteristics();
      } catch (err) {
        fail(`${node.label} ${describe(service.uuid)}: no characteristics`, err);
      }
      for (const [j, c] of chars.entries()) {
        const label = `${node.label}.C${j + 1}`;
        const descriptors: DescriptorNode[] = [];
        try {
          for (const d of await c.getDescriptors()) {
            const entry: DescriptorNode = { uuid: d.uuid };
            if (shortUuid(d.uuid) === '0x2901') {
              entry.value = await d.readValue().then((v) => new TextDecoder().decode(v)).catch(() => undefined);
            }
            descriptors.push(entry);
          }
        } catch {
          // No descriptors.
        }
        characteristics.current.set(label, c);
        c.addEventListener('characteristicvaluechanged', handleValue(label, c));
        node.characteristics.push({
          label,
          uuid: c.uuid,
          properties: propertyLabels(c.properties),
          canRead: c.properties.read,
          canWrite: c.properties.write,
          canWriteWithoutResponse: c.properties.writeWithoutResponse,
          canSubscribe: c.properties.notify || c.properties.indicate,
          descriptors,
        });
      }
    }
    setServices(tree);
    const count = tree.reduce((n, s) => n + s.characteristics.length, 0);
    info(`Found ${tree.length} services with ${count} characteristics.\n${formatTree(tree)}`);
  }

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    saveSetting(SERVICES_KEY, servicesText);
    saveSetting(NAME_PREFIX_KEY, namePrefix);
    const optionalServices = [...new Set([...DEFAULT_SERVICES.map((s) => s.uuid), ...extraServices])];
    const prefix = namePrefix.trim();
    let picked: BluetoothDevice;
    try {
      picked = await navigator.bluetooth.requestDevice(
        prefix ? { filters: [{ namePrefix: prefix }], optionalServices } : { acceptAllDevices: true, optionalServices },
      );
    } catch (err) {
      // Closing the device picker is not an error.
      if (!(err instanceof DOMException && err.name === 'NotFoundError' && /cancel/i.test(err.message))) {
        fail('Choosing a device failed', err);
      }
      return;
    }
    if (deviceRef.current && deviceRef.current !== picked) {
      deviceRef.current.removeEventListener('gattserverdisconnected', handleDisconnect);
      deviceRef.current.gatt?.disconnect();
    }
    deviceRef.current = picked;
    setDevice(picked);
    setServices([]);
    info(`Picked "${picked.name ?? ''}" (id ${picked.id}). Browser: ${navigator.userAgent}`);
    info(`Requested services: ${optionalServices.map(describe).join(', ')}`);
    picked.addEventListener('gattserverdisconnected', handleDisconnect);
    await run('Connecting…', async () => {
      await logAdvertisement(picked);
      await discover(picked).catch((err) => fail('Discovery failed', err));
    });
  }

  function reconnect() {
    if (!device) return;
    run('Reconnecting…', () => discover(device).catch((err) => fail('Discovery failed', err)));
  }

  function disconnect() {
    device?.gatt?.disconnect();
  }

  async function readCharacteristic(label: string) {
    const c = characteristics.current.get(label);
    if (!c) return;
    pendingReads.current.set(label, (pendingReads.current.get(label) ?? 0) + 1);
    try {
      const bytes = toBytes(await c.readValue());
      setValues((v) => ({ ...v, [label]: bytes }));
      addLog({ kind: 'read', label, bytes });
    } catch (err) {
      pendingReads.current.set(label, Math.max(0, (pendingReads.current.get(label) ?? 1) - 1));
      fail(`Reading ${label}`, err);
    }
  }

  async function readAll() {
    await run('Reading all…', async () => {
      for (const s of services) {
        for (const c of s.characteristics) {
          if (c.canRead && connected) await readCharacteristic(c.label);
        }
      }
    });
  }

  async function setSubscription(label: string, on: boolean) {
    const c = characteristics.current.get(label);
    if (!c) return;
    try {
      if (on) await c.startNotifications();
      else await c.stopNotifications();
      setSubscribed((s) => {
        const next = new Set(s);
        if (on) next.add(label);
        else next.delete(label);
        return next;
      });
      info(`${on ? 'Subscribed to' : 'Unsubscribed from'} ${label}.`);
    } catch (err) {
      fail(`${on ? 'Subscribing to' : 'Unsubscribing from'} ${label}`, err);
    }
  }

  async function subscribeAll() {
    await run('Subscribing…', async () => {
      for (const s of services) {
        for (const c of s.characteristics) {
          if (c.canSubscribe && !subscribed.has(c.label) && connected) await setSubscription(c.label, true);
        }
      }
    });
  }

  async function writeCharacteristic(node: CharacteristicNode, withResponse: boolean) {
    const c = characteristics.current.get(node.label);
    const input = writes[node.label] ?? { value: '', mode: 'hex' };
    if (!c) return;
    const bytes = input.mode === 'hex' ? parseHex(input.value) : new TextEncoder().encode(input.value);
    if (!bytes) {
      addLog({ kind: 'error', text: `${node.label}: "${input.value}" is not hex. Use bytes like "01 a0 ff".` });
      return;
    }
    try {
      if (withResponse) await c.writeValueWithResponse(bytes);
      else await c.writeValueWithoutResponse(bytes);
      addLog({ kind: 'write', label: node.label, bytes, text: withResponse ? '' : '(without response)' });
    } catch (err) {
      fail(`Writing ${node.label}`, err);
    }
  }

  function report(): string {
    return [
      `Bluetooth explorer report, ${new Date().toISOString()}`,
      `Device: "${device?.name ?? ''}" (id ${device?.id ?? '?'})`,
      `Browser: ${navigator.userAgent}`,
      '',
      'GATT table:',
      formatTree(services) || '(none)',
      '',
      'Log:',
      ...log.map(formatEntry),
    ].join('\n');
  }

  function copyReport() {
    navigator.clipboard.writeText(report()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadReport() {
    const url = URL.createObjectURL(new Blob([report()], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ble-${(device?.name || 'device').replace(/[^\w-]+/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isWebBluetoothSupported()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Bluetooth explorer</h1>
        <div className="card">
          <p className="font-medium">This browser can't connect to Bluetooth devices.</p>
          <p className="mt-1 text-sm text-slate-500">
            The explorer needs Web Bluetooth, available in Chrome, Edge and Opera on Windows, macOS, Linux, ChromeOS
            and Android, served over HTTPS. Safari and Firefox don't support it.
          </p>
        </div>
      </div>
    );
  }

  const shownLog = log.slice(-SHOWN_LOG);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Bluetooth explorer</h1>
        {device && (
          <div className="flex gap-2">
            {connected ? (
              <button type="button" className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
            ) : (
              <button type="button" className="btn btn-secondary" disabled={busy != null} onClick={reconnect}>Reconnect</button>
            )}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div className="text-sm text-slate-600">
          <p>
            Lists a Bluetooth LE device's services and characteristics and logs what it sends, for working out
            undocumented protocols such as the AON2 X2's.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Browsers only expose the services they're told about. Find the device's services in{' '}
              <span className="font-mono">chrome://bluetooth-internals</span> (Devices → Start scan → Inspect) or the
              nRF Connect app and add the custom ones below.
            </li>
            <li>
              On an AON2 X2, open Settings → Bluetooth so it advertises. When your computer asks for a passkey, enter
              the one the X2 shows.
            </li>
            <li>Click <strong>Connect</strong>, then read characteristics, subscribe to notifications and copy the report.</li>
          </ol>
        </div>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label>
            <span className="label">Extra services</span>
            <textarea
              className="input min-h-24 font-mono text-xs"
              spellCheck={false}
              placeholder={'One per line: FFF0 or a full UUID\n# comments are ignored'}
              value={servicesText}
              onChange={(e) => setServicesText(e.target.value)}
            />
            {invalid.length > 0 && (
              <span className="mt-1 block text-xs text-red-600">Not a UUID: {invalid.join(', ')}</span>
            )}
          </label>
          <label>
            <span className="label">Name starts with</span>
            <input
              className="input"
              placeholder="Any device"
              value={namePrefix}
              onChange={(e) => setNamePrefix(e.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Narrows the device picker. Leave empty to see every device.
            </span>
          </label>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">Services always requested ({DEFAULT_SERVICES.length})</summary>
          <ul className="mt-2 space-y-0.5 font-mono text-xs text-slate-600">
            {DEFAULT_SERVICES.map((s) => (
              <li key={s.uuid}>{shortUuid(s.uuid)} {s.name}</li>
            ))}
          </ul>
        </details>
        <button type="button" className="btn btn-primary" disabled={busy != null || invalid.length > 0} onClick={connect}>
          {device ? 'Connect to another device' : 'Connect'}
        </button>
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          {busy}
        </div>
      )}

      {device && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-xs font-medium uppercase text-slate-500">Device</p>
              <p className="font-medium">{device.name || 'Unnamed'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-500">Status</p>
              <p className="font-medium">{connected ? 'Connected' : 'Disconnected'}</p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" disabled={!connected || busy != null} onClick={readAll}>
                Read all
              </button>
              <button type="button" className="btn btn-secondary" disabled={!connected || busy != null} onClick={subscribeAll}>
                Subscribe to all
              </button>
            </div>
          </div>

          {services.length === 0 && !busy && (
            <p className="text-sm text-slate-500">
              No accessible services. Add the device's services above and connect again.
            </p>
          )}

          {services.map((s) => (
            <div key={s.label} className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                <span className="mr-2 font-mono text-xs font-semibold text-slate-500">{s.label}</span>
                <span className="font-medium">{uuidName(s.uuid) ?? 'Custom service'}</span>
                <span className="ml-2 font-mono text-xs break-all text-slate-500">{s.uuid}</span>
              </div>
              {s.characteristics.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No characteristics.</p>}
              <ul className="divide-y divide-slate-100">
                {s.characteristics.map((c) => {
                  const value = values[c.label];
                  const input = writes[c.label] ?? { value: '', mode: 'hex' as const };
                  const setInput = (next: Partial<WriteInput>) =>
                    setWrites((w) => ({ ...w, [c.label]: { ...input, ...next } }));
                  return (
                    <li key={c.label} className="space-y-2 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-xs font-semibold text-slate-500">{c.label}</span>
                        <span className="text-sm font-medium">{uuidName(c.uuid) ?? 'Custom'}</span>
                        <span className="font-mono text-xs break-all text-slate-500">{c.uuid}</span>
                        <span className="flex flex-wrap gap-1">
                          {c.properties.map((p) => (
                            <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{p}</span>
                          ))}
                        </span>
                        <span className="ml-auto flex gap-2">
                          {c.canRead && (
                            <button
                              type="button"
                              className="btn btn-secondary px-3 py-1"
                              disabled={!connected}
                              onClick={() => readCharacteristic(c.label)}
                            >
                              Read
                            </button>
                          )}
                          {c.canSubscribe && (
                            <button
                              type="button"
                              className="btn btn-secondary px-3 py-1"
                              disabled={!connected}
                              onClick={() => setSubscription(c.label, !subscribed.has(c.label))}
                            >
                              {subscribed.has(c.label) ? 'Unsubscribe' : 'Subscribe'}
                            </button>
                          )}
                        </span>
                      </div>
                      {c.descriptors.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Descriptors:{' '}
                          {c.descriptors.map((d) => `${describe(d.uuid)}${d.value != null ? ` "${d.value}"` : ''}`).join(', ')}
                        </p>
                      )}
                      {value && (
                        <p className="font-mono text-xs break-all">
                          <span className="text-slate-700">{toHex(value) || '(empty)'}</span>
                          <span className="ml-3 text-slate-400">|{toAscii(value)}|</span>
                        </p>
                      )}
                      {(c.canWrite || c.canWriteWithoutResponse) && (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="input w-auto py-1"
                            aria-label={`${c.label} value format`}
                            value={input.mode}
                            onChange={(e) => setInput({ mode: e.target.value as WriteInput['mode'] })}
                          >
                            <option value="hex">Hex</option>
                            <option value="text">Text</option>
                          </select>
                          <input
                            className="input min-w-48 flex-1 py-1 font-mono text-xs"
                            spellCheck={false}
                            aria-label={`${c.label} value to write`}
                            placeholder={input.mode === 'hex' ? '01 a0 ff' : 'text'}
                            value={input.value}
                            onChange={(e) => setInput({ value: e.target.value })}
                          />
                          {c.canWrite && (
                            <button
                              type="button"
                              className="btn btn-secondary px-3 py-1"
                              disabled={!connected}
                              onClick={() => writeCharacteristic(c, true)}
                            >
                              Write
                            </button>
                          )}
                          {c.canWriteWithoutResponse && (
                            <button
                              type="button"
                              className="btn btn-secondary px-3 py-1"
                              disabled={!connected}
                              onClick={() => writeCharacteristic(c, false)}
                            >
                              Write w/o response
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Log</h2>
          <span className="text-sm text-slate-500">
            {log.length} entries{log.length > SHOWN_LOG ? `, showing the last ${SHOWN_LOG}` : ''}
          </span>
          <label className="ml-auto flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Follow
          </label>
          <button type="button" className="btn btn-secondary px-3 py-1" disabled={log.length === 0} onClick={copyReport}>
            {copied ? 'Copied!' : 'Copy report'}
          </button>
          <button type="button" className="btn btn-secondary px-3 py-1" disabled={log.length === 0} onClick={downloadReport}>
            Download
          </button>
          <button type="button" className="btn btn-secondary px-3 py-1" disabled={log.length === 0} onClick={() => setLog([])}>
            Clear
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-xs">
          {shownLog.length === 0 && <p className="text-slate-500">Nothing yet.</p>}
          {shownLog.map((e, i) => (
            <div key={i} className={`break-all whitespace-pre-wrap ${KIND_CLASSES[e.kind]}`}>{formatEntry(e)}</div>
          ))}
          <div ref={logEnd} />
        </div>
      </div>
    </div>
  );
}
