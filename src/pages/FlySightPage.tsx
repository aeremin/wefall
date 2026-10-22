import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FlySightDevice, isWebBluetoothSupported, isWindows, joinPath } from '../lib/flysightBle';
import { defaultConfig, parseConfig, serializeConfig, validateConfig, type FlySightConfig } from '../lib/flysightConfig';
import { formatBytes } from '../lib/format';
import FlySightConfigForm from '../components/FlySightConfigForm';
import FlySightTracks from '../components/FlySightTracks';

const MAIN_CONFIG = '/config.txt';
const CONFIG_DIR = '/config';
const STATE_FILE = '/flysight.txt';
const FILE_NAME_RE = /^[A-Za-z0-9_-]{1,8}(\.[A-Za-z0-9]{1,3})?$/;

interface DeviceInfo {
  firmware?: string;
  deviceId?: string;
  /** Selectable config chosen in config mode, read after config.txt. */
  configFile?: string;
}

interface OpenFile {
  path: string;
  /** Text last read from or written to the device. */
  saved: string;
  /** Raw text; the source of truth unless the form was edited since it was parsed. */
  text: string;
  config: FlySightConfig;
  formEdited: boolean;
}

function parseState(text: string): DeviceInfo {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_]+)\s*:\s*([^;]*?)\s*(;.*)?$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return {
    firmware: values.get('Firmware_Ver') || undefined,
    deviceId: values.get('Device_ID') || undefined,
    configFile: values.get('Config_File') || undefined,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function openFile(path: string, text: string): OpenFile {
  return { path, saved: text, text, config: parseConfig(text), formEdited: false };
}

/** What Save writes: the form's settings if it was edited, otherwise the text as-is (keeping its comments). */
function contentOf(file: OpenFile): string {
  return file.formEdited ? serializeConfig(file.config) : file.text;
}

export default function FlySightPage() {
  const [device, setDevice] = useState<FlySightDevice | null>(null);
  const [connecting, setConnecting] = useState(false);
  /** Steps of the last connection attempt, shown when it fails. */
  const [connectionLog, setConnectionLog] = useState<string[]>([]);
  const [logCopied, setLogCopied] = useState(false);
  const [info, setInfo] = useState<DeviceInfo>({});
  const [configFiles, setConfigFiles] = useState<string[]>([]);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [view, setView] = useState<'form' | 'text'>('form');
  const [section, setSection] = useState<'config' | 'tracks'>('config');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deviceRef = useRef<FlySightDevice | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => deviceRef.current?.disconnect(), []);

  const problems = useMemo(() => (file ? validateConfig(file.config) : new Map<string, string>()), [file]);
  const content = file ? contentOf(file) : '';
  const dirty = file != null && content !== file.saved;
  const blocked = file != null && file.formEdited && problems.size > 0;

  /** Runs a device operation with a status message, reporting failures. */
  async function task<T>(label: string, work: (status: (s: string) => void) => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      return await work((s) => setBusy(`${label} ${s}`));
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function listConfigFiles(fs: FlySightDevice) {
    // The folder is optional; a missing one simply means there are no selectable configs.
    const entries = await fs.listDir(CONFIG_DIR).catch(() => []);
    setConfigFiles(entries.filter((e) => !e.isDirectory).map((e) => joinPath(CONFIG_DIR, e.name)).sort());
  }

  async function connect() {
    setError(null);
    setNotice(null);
    setConnecting(true);
    setConnectionLog([]);
    let fs: FlySightDevice;
    try {
      fs = await FlySightDevice.request((line) => setConnectionLog((l) => [...l, line]));
    } catch (err) {
      // Closing the device picker is not an error.
      if (!(err instanceof DOMException && err.name === 'NotFoundError' && /cancel/i.test(err.message))) {
        setError(errorMessage(err));
      }
      return;
    } finally {
      setConnecting(false);
    }
    deviceRef.current = fs;
    fs.onDisconnect = () => {
      deviceRef.current = null;
      setDevice(null);
      setNotice('The FlySight disconnected.');
    };
    setDevice(fs);

    await task('Reading device…', async () => {
      const state = await fs.readFile(STATE_FILE).catch(() => null);
      setInfo(state ? parseState(new TextDecoder().decode(state)) : {});
      await listConfigFiles(fs);
    });
    await load(fs, MAIN_CONFIG);
  }

  function disconnect() {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    deviceRef.current?.disconnect();
    setFile(null);
    setNotice(null);
  }

  async function load(fs: FlySightDevice, path: string) {
    await task(`Reading ${path}…`, async (status) => {
      let text: string;
      try {
        const data = await fs.readFile(path, (n) => status(formatBytes(n)));
        text = new TextDecoder().decode(data);
      } catch (err) {
        // The firmware writes a default config.txt on the next start; until then, start from defaults.
        if (path !== MAIN_CONFIG || !fs.connected) throw err;
        text = serializeConfig(defaultConfig());
        setNotice(`${path} doesn't exist yet. Saving creates it with these settings.`);
        setFile({ path, saved: '', text, config: parseConfig(text), formEdited: false });
        return;
      }
      setFile(openFile(path, text));
    });
  }

  function selectFile(path: string) {
    if (!device || path === file?.path) return;
    if (dirty && !confirm('Discard unsaved changes?')) return;
    load(device, path);
  }

  async function write(fs: FlySightDevice, path: string, text: string) {
    const data = new TextEncoder().encode(text);
    return task(`Saving ${path}…`, async (status) => {
      await fs.writeFile(path, data, (n) => status(`${formatBytes(n)} of ${formatBytes(data.length)}`));
      return true;
    });
  }

  async function save() {
    if (!device || !file) return;
    const text = content;
    if (await write(device, file.path, text)) {
      setFile(openFile(file.path, text));
      setNotice(`Saved ${file.path}. The FlySight uses it from the next jump.`);
    }
  }

  async function saveAs() {
    if (!device || !file) return;
    const input = prompt('Save as a selectable config in /config. File name (up to 8 characters):', '');
    if (input == null) return;
    let name = input.trim().toUpperCase();
    if (!name.includes('.')) name += '.TXT';
    if (!FILE_NAME_RE.test(name)) {
      setError('Use up to 8 letters, digits, "-" or "_", optionally followed by an extension of up to 3 characters.');
      return;
    }
    const path = joinPath(CONFIG_DIR, name);
    if (configFiles.includes(path) && !confirm(`${path} already exists. Replace it?`)) return;
    const text = content;
    // Fails harmlessly when the folder already exists.
    await device.mkdir(CONFIG_DIR).catch(() => {});
    if (await write(device, path, text)) {
      setFile(openFile(path, text));
      await listConfigFiles(device).catch(() => {});
      setNotice(`Saved ${path}. Select it on the FlySight in config mode.`);
    }
  }

  function revert() {
    if (!device || !file || !confirm('Discard unsaved changes?')) return;
    load(device, file.path);
  }

  function resetToDefaults() {
    if (!file || !confirm('Replace all settings with the firmware defaults?')) return;
    const config = defaultConfig();
    setFile({ ...file, config, text: serializeConfig(config), formEdited: true });
  }

  function switchView(next: 'form' | 'text') {
    if (!file || next === view) return;
    if (next === 'text' && file.formEdited) {
      setFile({ ...file, text: serializeConfig(file.config), formEdited: false });
    } else if (next === 'form') {
      setFile({ ...file, config: parseConfig(file.text), formEdited: false });
    }
    setView(next);
  }

  function download() {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || 'config.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked || !file) return;
    const text = await picked.text();
    setFile({ ...file, text, config: parseConfig(text), formEdited: false });
    setNotice(`Loaded ${picked.name}. Save to write it to the FlySight.`);
  }

  if (!isWebBluetoothSupported()) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">FlySight 2</h1>
        <div className="card">
          <p className="font-medium">This browser can't connect to Bluetooth devices.</p>
          <p className="mt-1 text-sm text-slate-500">
            Configuring a FlySight 2 needs Web Bluetooth. Use Chrome on Android. Safari and Firefox don't support
            Web Bluetooth, so this doesn't work on iPhone or iPad. Connecting from Windows doesn't work with the
            current FlySight 2 firmware.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">FlySight 2</h1>
        {device && (
          <button type="button" className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
        )}
      </div>

      {!device ? (
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold">Connect over Bluetooth</h2>
            {isWindows() && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
                Connecting from Windows doesn't work with the current FlySight 2 firmware: Windows pairs with it, but
                the FlySight then drops the connection. Use Chrome on Android to configure your FlySight.
              </p>
            )}
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              <li>Turn the FlySight off (LED dark) and make sure it's not plugged into USB.</li>
              <li>
                The first time, put it in pairing mode: press the button twice quickly. The green LED pulses
                for 30 seconds. Once paired, it can connect without this step.
              </li>
              <li>
                Within those 30 seconds, click <strong>Connect</strong> and pick your FlySight. Accept the pairing
                request if your phone asks.
              </li>
              <li>
                If it was paired before and won't connect, clear the old pairing on both sides: remove the FlySight
                from your phone's Bluetooth settings, and set <span className="font-mono">Reset_BLE: 1</span> in the
                FlySight's <span className="font-mono">flysight.txt</span> over USB, then restart it. This clears all
                its pairings.
              </li>
            </ol>
          </div>
          <button type="button" className="btn btn-primary" disabled={connecting} onClick={connect}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
          {!connecting && error && connectionLog.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Connection details</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs whitespace-pre-wrap">
                {connectionLog.join('\n')}
              </pre>
              <button
                type="button"
                className="btn btn-secondary mt-2 px-3 py-1"
                onClick={() =>
                  navigator.clipboard.writeText(`${connectionLog.join('\n')}\nError: ${error}`).then(() => {
                    setLogCopied(true);
                    setTimeout(() => setLogCopied(false), 2000);
                  })
                }
              >
                {logCopied ? 'Copied!' : 'Copy details'}
              </button>
            </details>
          )}
        </div>
      ) : (
        <div className="card flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">Device</p>
            <p className="font-medium">{device.name}</p>
          </div>
          {info.firmware && (
            <div>
              <p className="text-xs font-medium uppercase text-slate-500">Firmware</p>
              <p className="font-medium">{info.firmware}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">Selected config</p>
            <p className="font-medium">{info.configFile ? joinPath(CONFIG_DIR, info.configFile) : 'None'}</p>
          </div>
          {section === 'config' && <label className="ml-auto min-w-56">
            <span className="label">File</span>
            <select
              className="input"
              value={file?.path ?? ''}
              disabled={busy != null}
              onChange={(e) => selectFile(e.target.value)}
            >
              {!file && <option value="" />}
              {[MAIN_CONFIG, ...configFiles, ...(file && ![MAIN_CONFIG, ...configFiles].includes(file.path) ? [file.path] : [])].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>}
        </div>
      )}

      {device && (
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 w-fit" role="tablist" aria-label="FlySight">
          {(['config', 'tracks'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium ${
                section === s ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
              onClick={() => setSection(s)}
            >
              {s === 'config' ? 'Config' : 'Tracks'}
            </button>
          ))}
        </div>
      )}

      {device && section === 'config' && (
        <p className="text-sm text-slate-500">
          The FlySight applies <span className="font-mono">{MAIN_CONFIG}</span> first, then the selectable config chosen
          in config mode from <span className="font-mono">{CONFIG_DIR}</span>, whose settings take precedence.
        </p>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
          {busy}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && !error && <p className="text-sm text-slate-600">{notice}</p>}

      {device && file && section === 'config' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="tablist">
              {(['form', 'text'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium ${
                    view === v ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  onClick={() => switchView(v)}
                >
                  {v === 'form' ? 'Settings' : 'Text'}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => uploadRef.current?.click()}>Open file…</button>
              <button type="button" className="btn btn-secondary" onClick={download}>Download</button>
              <button type="button" className="btn btn-secondary" onClick={resetToDefaults}>Defaults</button>
              <input ref={uploadRef} type="file" accept=".txt,text/plain" className="hidden" onChange={upload} />
            </div>
          </div>

          {view === 'form' ? (
            <FlySightConfigForm
              config={file.config}
              problems={problems}
              overlay={file.path !== MAIN_CONFIG}
              onChange={(config) => setFile({ ...file, config, formEdited: true })}
            />
          ) : (
            <textarea
              className="input min-h-[60vh] font-mono text-xs"
              spellCheck={false}
              aria-label="Config file text"
              value={file.text}
              onChange={(e) => setFile({ ...file, text: e.target.value })}
            />
          )}

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3">
            <button type="button" className="btn btn-primary" disabled={!dirty || blocked || busy != null} onClick={save}>
              Save to FlySight
            </button>
            <button type="button" className="btn btn-secondary" disabled={blocked || busy != null} onClick={saveAs}>
              Save as…
            </button>
            {dirty && (
              <button type="button" className="btn btn-secondary" disabled={busy != null} onClick={revert}>Revert</button>
            )}
            <span className="text-sm text-slate-500">
              {blocked ? 'Fix the highlighted settings to save.' : dirty ? 'Unsaved changes' : 'No changes'}
            </span>
          </div>
        </>
      )}

      {device && section === 'tracks' && <FlySightTracks device={device} />}
    </div>
  );
}
