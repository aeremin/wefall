/**
 * FlySight 2 Bluetooth LE client.
 *
 * Talks to the firmware's CRS ("control and response") service, which exposes the device's
 * FAT file system: directory listing, sliding-window file reads and writes, mkdir and delete.
 * Protocol reference: FlySight/crs.c and Scripts/ble_test.py in flysight/flysight-2-firmware.
 */

const CRS_SERVICE = '00000000-cc7a-482a-984a-7f2ed5b3e58f';
/** Device → client packets (notifications). */
const CRS_TX = '00000001-8e22-4541-9d4c-21edae82ed19';
/** Client → device packets (write without response). */
const CRS_RX = '00000002-8e22-4541-9d4c-21edae82ed19';
/** Bluetooth SIG company identifier of Bionic Avionics, sent in FlySight advertisements. */
const MANUFACTURER_ID = 0x09db;

const Cmd = {
  create: 0x00,
  delete: 0x01,
  read: 0x02,
  write: 0x03,
  mkdir: 0x04,
  readDir: 0x05,
  fileData: 0x10,
  fileInfo: 0x11,
  fileAck: 0x12,
  nak: 0xf0,
  ack: 0xf1,
  ping: 0xfe,
  cancel: 0xff,
} as const;

/** Packets in flight before an acknowledgement is required (FS_CRS_WINDOW_LENGTH). */
const WINDOW_LENGTH = 8;
/** File bytes per data packet (FRAME_LENGTH); needs an ATT MTU of at least 247. */
const FRAME_LENGTH = 242;
const COMMAND_TIMEOUT_MS = 5000;
/** A read fails when the device sends nothing for this long (it resends unacknowledged packets every 200 ms). */
const READ_IDLE_TIMEOUT_MS = 5000;
const WRITE_ACK_TIMEOUT_MS = 1000;
const WRITE_MAX_RETRIES = 10;
/** The firmware drops the connection after 30 s without incoming packets. */
const KEEP_ALIVE_MS = 10_000;
/** Chrome's first connection attempt often drops right away, especially on Windows. */
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY_MS = 1000;
const CLEAR_PAIRINGS =
  "If it was paired before, clear the old pairing on both sides: remove the FlySight from this device's " +
  'Bluetooth settings, and on the FlySight set Reset_BLE: 1 in flysight.txt over USB and restart it (this ' +
  'clears all its pairings).';
const REFUSED_MESSAGE =
  "The FlySight closed the connection. If it isn't paired with this device yet, press its button twice quickly " +
  `(the green LED pulses) and click Connect within 30 seconds, before pairing mode ends. ${CLEAR_PAIRINGS}`;
const PAIRING_FAILED_MESSAGE =
  'Pairing with the FlySight failed. Put it in pairing mode (press its button twice quickly; the green LED ' +
  `pulses) and connect again. ${CLEAR_PAIRINGS}`;
/**
 * Windows reaches the FlySight but can't keep a connection with the current firmware: Chrome's own
 * pairing is rejected, and once paired in Windows Settings every connection drops within about 300 ms.
 */
const WINDOWS_MESSAGE =
  "Couldn't connect to the FlySight. Connecting from Windows doesn't work with the current FlySight 2 " +
  'firmware: Windows pairs with it, but the FlySight then drops the connection. Use Chrome on Android instead.';

const AM_DIR = 0x10;

export interface FlySightFile {
  name: string;
  size: number;
  modified: Date | null;
  isDirectory: boolean;
}

export type ProgressCallback = (bytes: number) => void;

export type ConnectionLog = (line: string) => void;

type PacketHandler = (packet: Uint8Array) => void;

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** Windows, where connecting to a FlySight 2 currently fails (see WINDOWS_MESSAGE). */
export function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
}

/** Joins path segments the way the firmware expects ("/config/A.TXT"). */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

function encodePath(path: string): Uint8Array {
  // Null-terminated: CREATE, DELETE and MK_DIR read the name without terminating it themselves.
  return new TextEncoder().encode(`${path}\0`);
}

function packet(command: number, ...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((n, p) => n + p.length, 1);
  const out = new Uint8Array(length);
  out[0] = command;
  let offset = 1;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Decodes a FAT date/time pair as local time. */
function fatDate(date: number, time: number): Date | null {
  if (date === 0) return null;
  return new Date(
    (date >> 9) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FlySightError extends Error {}

export class FlySightDevice {
  /** Called once when the connection is lost or closed. */
  onDisconnect: (() => void) | null = null;

  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private handler: PacketHandler | null = null;
  /** Rejects the running operation when the device disconnects. */
  private abortCurrent: ((reason: Error) => void) | null = null;
  /** Serializes operations: the firmware handles one transfer at a time. */
  private operations: Promise<unknown> = Promise.resolve();
  /** Serializes GATT writes, which may not overlap. */
  private writes: Promise<void> = Promise.resolve();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = 0;

  private constructor(private readonly device: BluetoothDevice) {}

  get name(): string {
    return this.device.name || 'FlySight';
  }

  get connected(): boolean {
    return this.rx != null && !!this.device.gatt?.connected;
  }

  /**
   * Shows the browser's device picker and connects to the chosen FlySight. `log` receives each
   * connection step and failure, for troubleshooting.
   */
  static async request(log: ConnectionLog = () => {}): Promise<FlySightDevice> {
    if (!isWebBluetoothSupported()) {
      throw new FlySightError('This browser does not support Web Bluetooth. Use Chrome on Android.');
    }
    log(`Browser: ${navigator.userAgent}`);
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { manufacturerData: [{ companyIdentifier: MANUFACTURER_ID }] },
        { namePrefix: 'FlySight' },
      ],
      optionalServices: [CRS_SERVICE],
    });
    log(`Picked "${device.name ?? ''}" (id ${device.id})`);
    const flysight = new FlySightDevice(device);
    await flysight.connect(log);
    return flysight;
  }

  private async connect(log: ConnectionLog): Promise<void> {
    const gatt = this.device.gatt;
    if (!gatt) throw new FlySightError('The device has no GATT server.');
    const start = Date.now();
    const logDisconnect = () => log(`+${Date.now() - start} ms: disconnected`);
    this.device.addEventListener('gattserverdisconnected', logDisconnect);
    /** Runs one connection step, logging it and how it failed. */
    const step = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
      log(`+${Date.now() - start} ms: ${label}`);
      try {
        return await work();
      } catch (err) {
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        log(`+${Date.now() - start} ms: ${label} failed (still connected: ${gatt.connected}): ${reason}`);
        throw err;
      }
    };

    try {
      for (let attempt = 1; ; attempt++) {
        try {
          // Outside pairing mode the FlySight only accepts computers it is bonded with. Chrome
          // reports a refused connection as a successful connect() followed by a disconnect.
          const server = await step(`attempt ${attempt}: connect`, () => gatt.connect());
          const service = await step('get file service', () => server.getPrimaryService(CRS_SERVICE));
          const tx = await step('get TX characteristic', () => service.getCharacteristic(CRS_TX));
          const rx = await step('get RX characteristic', () => service.getCharacteristic(CRS_RX));
          tx.addEventListener('characteristicvaluechanged', this.handleNotification);
          // The characteristics require encryption. Chrome pairs on demand when a characteristic
          // read needs it, but on Windows not for the descriptor write behind startNotifications(),
          // which just fails with "Not paired". Reading the encrypted RX characteristic pairs first.
          await step('read RX (pairs if needed)', () => rx.readValue());
          await step('start notifications', () => tx.startNotifications());
          log(`+${Date.now() - start} ms: connected`);
          this.rx = rx;
          break;
        } catch (err) {
          const stillConnected = gatt.connected;
          if (stillConnected) gatt.disconnect();
          if (err instanceof Error && /not paired|authenticat|encrypt/i.test(err.message)) {
            throw new FlySightError(isWindows() ? WINDOWS_MESSAGE : PAIRING_FAILED_MESSAGE);
          }
          // Still connected means a real error, such as a device without the file service.
          if (stillConnected) throw err;
          if (attempt >= CONNECT_ATTEMPTS) throw new FlySightError(isWindows() ? WINDOWS_MESSAGE : REFUSED_MESSAGE);
          await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_DELAY_MS));
        }
      }
    } finally {
      this.device.removeEventListener('gattserverdisconnected', logDisconnect);
    }
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    this.lastActivity = Date.now();
    this.keepAliveTimer = setInterval(this.keepAlive, KEEP_ALIVE_MS / 2);
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
    else this.handleDisconnect();
  }

  private handleDisconnect = () => {
    if (!this.rx && !this.keepAliveTimer) return;
    this.rx = null;
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
    this.device.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.abortCurrent?.(new FlySightError('The FlySight disconnected.'));
    this.onDisconnect?.();
  };

  private handleNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value || value.byteLength === 0) return;
    this.handler?.(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  };

  private keepAlive = () => {
    if (!this.connected || Date.now() - this.lastActivity < KEEP_ALIVE_MS) return;
    this.lastActivity = Date.now();
    this.ping().catch(() => {});
  };

  private send(data: Uint8Array<ArrayBuffer>): Promise<void> {
    const rx = this.rx;
    if (!rx) return Promise.reject(new FlySightError('Not connected.'));
    this.lastActivity = Date.now();
    const write = this.writes.then(() => rx.writeValueWithoutResponse(data));
    this.writes = write.catch(() => {});
    return write;
  }

  /**
   * Runs one protocol exchange. `body` installs packet handling through `listen` and resolves
   * with the result; operations never overlap.
   */
  private run<T>(body: (listen: (handler: PacketHandler) => void) => Promise<T>): Promise<T> {
    const op = this.operations.then(async () => {
      if (!this.connected) throw new FlySightError('Not connected.');
      const aborted = deferred<never>();
      this.abortCurrent = aborted.reject;
      try {
        return await Promise.race([body((h) => (this.handler = h)), aborted.promise]);
      } finally {
        this.handler = null;
        this.abortCurrent = null;
      }
    });
    this.operations = op.catch(() => {});
    return op;
  }

  /** Sends a command and waits for its ACK; a NAK rejects with `nakMessage`. */
  private command(data: Uint8Array<ArrayBuffer>, nakMessage: string): Promise<void> {
    return this.run((listen) => this.sendAndAwaitAck(listen, data, nakMessage, () => {}));
  }

  private sendAndAwaitAck(
    listen: (handler: PacketHandler) => void,
    data: Uint8Array<ArrayBuffer>,
    nakMessage: string,
    onPacket: PacketHandler,
  ): Promise<void> {
    const command = data[0];
    const acked = deferred<void>();
    const timer = setTimeout(() => acked.reject(new FlySightError('The FlySight did not respond.')), COMMAND_TIMEOUT_MS);
    listen((p) => {
      if (p[0] === Cmd.ack && p[1] === command) acked.resolve();
      else if (p[0] === Cmd.nak && p[1] === command) acked.reject(new FlySightError(nakMessage));
      else onPacket(p);
    });
    this.send(data).catch(acked.reject);
    return acked.promise.finally(() => clearTimeout(timer));
  }

  ping(): Promise<void> {
    return this.command(packet(Cmd.ping), 'Ping rejected.');
  }

  mkdir(path: string): Promise<void> {
    return this.command(packet(Cmd.mkdir, encodePath(path)), `Could not create folder ${path}.`);
  }

  delete(path: string): Promise<void> {
    return this.command(packet(Cmd.delete, encodePath(path)), `Could not delete ${path}.`);
  }

  /** Lists a directory; rejects if it does not exist. */
  listDir(path: string): Promise<FlySightFile[]> {
    return this.run(async (listen) => {
      const files: FlySightFile[] = [];
      const done = deferred<FlySightFile[]>();
      let next = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => done.reject(new FlySightError('Directory listing timed out.')), COMMAND_TIMEOUT_MS);
      };

      // Entries may arrive right behind the ACK, so the entry handler is installed with it.
      const onEntry: PacketHandler = (p) => {
        if (p[0] !== Cmd.fileInfo || p.length < 24) return;
        armTimeout();
        if (p[1] !== (next & 0xff)) {
          done.reject(new FlySightError('Directory listing lost a packet; try again.'));
          return;
        }
        next++;
        const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
        const nameBytes = p.subarray(11, 24);
        const end = nameBytes.indexOf(0);
        const name = new TextDecoder('latin1').decode(end < 0 ? nameBytes : nameBytes.subarray(0, end));
        if (!name) {
          done.resolve(files);
          return;
        }
        if (name === '.' || name === '..') return;
        files.push({
          name,
          size: view.getUint32(2, true),
          modified: fatDate(view.getUint16(6, true), view.getUint16(8, true)),
          isDirectory: (p[10] & AM_DIR) !== 0,
        });
      };

      try {
        await this.sendAndAwaitAck(listen, packet(Cmd.readDir, encodePath(path)), `Folder ${path} not found.`, onEntry);
        armTimeout();
        return await done.promise;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /** Downloads a file; rejects if it does not exist. */
  readFile(path: string, onProgress?: ProgressCallback): Promise<Uint8Array<ArrayBuffer>> {
    return this.run(async (listen) => {
      const chunks: Uint8Array[] = [];
      let received = 0;
      let next = 0;
      const done = deferred<void>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(() => done.reject(new FlySightError(`Reading ${path} timed out.`)), READ_IDLE_TIMEOUT_MS);
      };

      const onData: PacketHandler = (p) => {
        if (p[0] !== Cmd.fileData || p.length < 2) return;
        armTimeout();
        const seq = p[1];
        if (seq === (next & 0xff)) {
          next++;
          this.send(packet(Cmd.fileAck, [seq])).catch(done.reject);
          if (p.length === 2) {
            done.resolve();
          } else {
            chunks.push(p.slice(2));
            received += p.length - 2;
            onProgress?.(received);
          }
        } else if (((next - 1 - seq) & 0xff) < WINDOW_LENGTH) {
          // A resend of a packet we already have: our ACK was late or lost, so repeat it.
          this.send(packet(Cmd.fileAck, [seq])).catch(done.reject);
        }
      };

      const offsetAndStride = new Uint8Array(8); // offset 0 frames, stride 0 (= contiguous)
      try {
        await this.sendAndAwaitAck(listen, packet(Cmd.read, offsetAndStride, encodePath(path)), `File ${path} not found.`, onData);
        armTimeout();
        await done.promise;
        // If our last ACK was lost, the firmware would stay in its read state and ignore the next
        // command. When it already finished, it just NAKs the cancel.
        await this.send(packet(Cmd.cancel));
      } catch (err) {
        if (this.connected) await this.send(packet(Cmd.cancel)).catch(() => {});
        throw err;
      } finally {
        clearTimeout(timer);
      }

      const out = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    });
  }

  /** Uploads a file, replacing any existing file with the same name. */
  writeFile(path: string, data: Uint8Array, onProgress?: ProgressCallback): Promise<void> {
    return this.run(async (listen) => {
      // Data packets followed by an empty packet that closes the file.
      const dataPackets = Math.ceil(data.length / FRAME_LENGTH);
      const total = dataPackets + 1;
      let nextPacket = 0;
      let nextAck = 0;
      let ackSignal = deferred<void>();
      let failed: unknown = null;

      const onAck: PacketHandler = (p) => {
        if (p[0] === Cmd.nak && p[1] === Cmd.fileData && nextAck === dataPackets) {
          // The closing packet was resent after its ACK was lost: the firmware already closed the file.
          nextAck = total;
          ackSignal.resolve();
          return;
        }
        if (p[0] !== Cmd.fileAck || p.length < 2) return;
        // The firmware writes packets strictly in order, so an ACK also covers every packet before it.
        const ahead = (p[1] - nextAck) & 0xff;
        if (ahead < nextPacket - nextAck) {
          nextAck += ahead + 1;
          onProgress?.(Math.min(nextAck * FRAME_LENGTH, data.length));
          ackSignal.resolve();
        }
      };

      await this.sendAndAwaitAck(listen, packet(Cmd.write, encodePath(path)), `Could not open ${path} for writing.`, onAck);

      try {
        let retries = 0;
        while (nextAck < total) {
          // Hold the closing packet until all data is acknowledged: the firmware closes the
          // file on it even if an earlier packet went missing. The exception is a retry of only
          // the last data packet: if the firmware has it and just its ACK was lost, it ignores
          // the resend, and only the closing packet right behind it gets an answer.
          const limit = nextAck < dataPackets && !(retries > 0 && nextAck === dataPackets - 1) ? dataPackets : total;
          while (nextPacket < nextAck + WINDOW_LENGTH && nextPacket < limit) {
            const chunk = data.subarray(nextPacket * FRAME_LENGTH, (nextPacket + 1) * FRAME_LENGTH);
            this.send(packet(Cmd.fileData, [nextPacket & 0xff], chunk)).catch((err) => {
              failed = err;
              ackSignal.resolve();
            });
            nextPacket++;
          }
          const ackBefore = nextAck;
          const timedOut = await Promise.race([
            ackSignal.promise.then(() => false),
            new Promise<boolean>((res) => setTimeout(() => res(true), WRITE_ACK_TIMEOUT_MS)),
          ]);
          ackSignal = deferred<void>();
          if (failed) throw failed;
          if (timedOut && nextAck === ackBefore) {
            if (++retries > WRITE_MAX_RETRIES) throw new FlySightError(`Writing ${path} timed out.`);
            nextPacket = nextAck;
          } else {
            retries = 0;
          }
        }
      } catch (err) {
        if (this.connected) await this.send(packet(Cmd.cancel)).catch(() => {});
        throw err;
      }
    });
  }
}
