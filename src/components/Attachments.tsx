import { useState, type ChangeEvent } from 'react';
import { addAttachments, downloadAttachment, removeAttachment } from '../lib/attachments';
import { formatBytes } from '../lib/format';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, type Attachment, type Jump } from '../lib/types';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** `editable` lets the owner upload and remove files; everyone else can only download. */
export default function Attachments({ ownerUid, jump, editable }: { ownerUid: string; jump: Jump; editable: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function track(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    track(`Uploading ${files.length === 1 ? files[0].name : `${files.length} files`}…`, () =>
      addAttachments(ownerUid, jump, files),
    );
  }

  function handleRemove(a: Attachment) {
    if (!confirm(`Remove ${a.name}? This cannot be undone.`)) return;
    track(`Removing ${a.name}…`, () => removeAttachment(ownerUid, jump.id, a));
  }

  const sorted = [...jump.attachments].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold">Attachments</h2>
        {editable && (
          <p className="text-sm text-slate-500">
            Files such as ProTrack or FlySight logs, up to {formatBytes(MAX_ATTACHMENT_BYTES)} each.
            Participants can download them too.
          </p>
        )}
      </div>
      {sorted.length === 0 ? (
        !editable && <p className="text-sm text-slate-500">No attachments.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {sorted.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2">
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-left text-sky-700 hover:underline"
                title={`Download ${a.name}`}
                onClick={() => track(`Downloading ${a.name}…`, () => downloadAttachment(ownerUid, jump.id, a))}
              >
                {a.name}
              </button>
              <span className="shrink-0 text-xs text-slate-500">{formatBytes(a.size)}</span>
              {editable && (
                <button
                  type="button"
                  className="ml-auto shrink-0 cursor-pointer text-xs text-red-600 hover:underline disabled:opacity-50"
                  disabled={busy != null}
                  onClick={() => handleRemove(a)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && jump.attachments.length < MAX_ATTACHMENTS && (
        <input
          type="file"
          multiple
          aria-label="Add attachments"
          disabled={busy != null}
          onChange={handleFiles}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:font-medium file:text-sky-700 hover:file:bg-sky-100"
        />
      )}
      {busy && <p className="text-xs text-slate-500">{busy}</p>}
      {error && <p className="whitespace-pre-wrap text-xs text-red-600">{error}</p>}
    </div>
  );
}
