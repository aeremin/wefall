import { isProTrackFile } from './protrack';
import type { AttachmentType } from './types';

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  protrack: 'ProTrack',
  flysight: 'FlySight',
  flysight2: 'FlySight 2',
  gpx: 'GPX track',
  kml: 'KML track',
  image: 'Image',
  other: 'File',
};

/** Enough to see the headers of every recognized format. */
const SNIFF_BYTES = 4096;

/** Recognizes a file from its leading content, falling back to its MIME type and extension. */
export async function detectAttachmentType(file: File): Promise<AttachmentType> {
  if (file.type.startsWith('image/')) return 'image';

  const head = (await file.slice(0, SNIFF_BYTES).text()).replace(/^﻿/, '');
  if (isProTrackFile(head)) return 'protrack';
  if (/^\$FLYS,/.test(head)) return 'flysight2';
  if (/^time,lat,lon,hMSL,velN,velE,velD\b/.test(head)) return 'flysight';
  if (/<gpx[\s>]/.test(head)) return 'gpx';
  if (/<kml[\s>]/.test(head)) return 'kml';

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'gpx') return 'gpx';
  if (ext === 'kml') return 'kml';
  return 'other';
}
