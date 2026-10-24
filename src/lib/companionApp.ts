/**
 * Client for the WeFall Android app (android/), which opens this site when a ProTrack or FlySight 2
 * is plugged into the phone and serves the device's files on http://127.0.0.1.
 *
 * The app opens /import (ProTrack) or /flysight (FlySight 2) with `#app=<port>:<token>`; the token
 * authorizes requests to that share only. Chrome asks once per site before letting a page reach apps
 * on the phone.
 */
import type { FlySightFile, ProgressCallback } from './flysightBle';

export type CompanionDeviceKind = 'protrack' | 'flysight2';

export interface CompanionLink {
  port: number;
  token: string;
}

const LINK_RE = /(?:^#|&)app=(\d{1,5}):([0-9a-f]{32})(?:&|$)/;

/** The app link in a location hash, or null when the page wasn't opened by the app. */
export function parseCompanionLink(hash: string): CompanionLink | null {
  const match = LINK_RE.exec(hash);
  return match ? { port: Number(match[1]), token: match[2] } : null;
}

export class CompanionError extends Error {}

const UNREACHABLE =
  "Couldn't reach the WeFall app on this phone. If Chrome asked to let this site access other apps and " +
  'services on this device, allow it and reload. Otherwise plug the device in again to reopen this page.';

/** The plugged-in device as the app shares it; reads like a FlySightDevice. */
export class CompanionDevice {
  readonly connected = true;

  private constructor(
    private readonly link: CompanionLink,
    readonly kind: CompanionDeviceKind,
    readonly name: string,
  ) {}

  static async connect(link: CompanionLink): Promise<CompanionDevice> {
    const info = (await request(link, '/info').then((r) => r.json())) as { kind: CompanionDeviceKind; name: string };
    return new CompanionDevice(link, info.kind, info.name);
  }

  async listDir(path: string): Promise<FlySightFile[]> {
    const entries = (await request(this.link, '/list', path).then((r) => r.json())) as {
      name: string;
      size: number;
      modified: number | null;
      isDirectory: boolean;
    }[];
    return entries.map((e) => ({ ...e, modified: e.modified == null ? null : new Date(e.modified) }));
  }

  async readFile(path: string, onProgress?: ProgressCallback): Promise<Uint8Array<ArrayBuffer>> {
    const response = await request(this.link, '/file', path);
    if (!onProgress || !response.body) return new Uint8Array(await response.arrayBuffer());
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(received);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }

  /** Every file in the root folder, as Files (ProTrack shares are the copied jump files). */
  async readAllFiles(): Promise<File[]> {
    const entries = (await this.listDir('/')).filter((e) => !e.isDirectory);
    return Promise.all(
      entries.map(async (e) => new File([await this.readFile(`/${e.name}`)], e.name, { type: 'text/plain' })),
    );
  }
}

async function request(link: CompanionLink, endpoint: string, path?: string): Promise<Response> {
  const params = new URLSearchParams({ token: link.token });
  if (path != null) params.set('path', path);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${link.port}${endpoint}?${params}`, { cache: 'no-store' });
  } catch {
    throw new CompanionError(UNREACHABLE);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new CompanionError(body?.error ?? `The WeFall app answered ${response.status}.`);
  }
  return response;
}
