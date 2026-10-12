import { arrayRemove, arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import { FirebaseError } from 'firebase/app';
import { db, storage } from './firebase';
import { formatBytes } from './format';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type Attachment, type Jump } from './types';

const attachmentRef = (ownerUid: string, jumpId: string, id: string) =>
  ref(storage, `users/${ownerUid}/jumps/${jumpId}/${id}`);

/** Uploads `file` to the jump's folder; passing the `id` of an existing attachment overwrites it. */
export async function uploadAttachment(
  uid: string,
  jumpId: string,
  file: File,
  id: string = crypto.randomUUID(),
): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
  }
  const contentType = file.type || 'application/octet-stream';
  await uploadBytes(attachmentRef(uid, jumpId, id), file, {
    contentType,
    contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  });
  return { id, name: file.name, size: file.size, contentType, uploadedAt: new Date().toISOString() };
}

/** Uploads `file` and returns `attachments` with it added, replacing an attachment with the same name. */
export async function withAttachment(uid: string, jumpId: string, attachments: Attachment[], file: File) {
  const existing = attachments.find((a) => a.name === file.name);
  if (!existing && attachments.length >= MAX_ATTACHMENTS) {
    throw new Error(`A jump can have at most ${MAX_ATTACHMENTS} attachments.`);
  }
  const uploaded = await uploadAttachment(uid, jumpId, file, existing?.id);
  return [...attachments.filter((a) => a !== existing), uploaded];
}

export async function addAttachments(uid: string, jump: Jump, files: File[]) {
  if (jump.attachments.length + files.length > MAX_ATTACHMENTS) {
    throw new Error(`A jump can have at most ${MAX_ATTACHMENTS} attachments.`);
  }
  const results = await Promise.allSettled(files.map((f) => uploadAttachment(uid, jump.id, f)));
  const uploaded = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (uploaded.length > 0) {
    await updateDoc(doc(db, 'users', uid, 'jumps', jump.id), {
      attachments: arrayUnion(...uploaded),
      updatedAt: serverTimestamp(),
    });
  }
  const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as Error] : []));
  if (failed.length > 0) throw new Error(failed.map((e) => e.message).join('\n'));
}

export async function removeAttachment(uid: string, jumpId: string, attachment: Attachment) {
  await updateDoc(doc(db, 'users', uid, 'jumps', jumpId), {
    attachments: arrayRemove(attachment),
    updatedAt: serverTimestamp(),
  });
  try {
    await deleteObject(attachmentRef(uid, jumpId, attachment.id));
  } catch (err) {
    if (!(err instanceof FirebaseError && err.code === 'storage/object-not-found')) throw err;
  }
}

/** Fetched through the SDK (not a public download URL) so the Storage rules apply on every download. */
export async function downloadAttachment(ownerUid: string, jumpId: string, attachment: Attachment) {
  const blob = await getBlob(attachmentRef(ownerUid, jumpId, attachment.id));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = attachment.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
