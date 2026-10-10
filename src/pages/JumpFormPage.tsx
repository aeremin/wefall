import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import { addJump, deleteJump, normalizeEmail, sharedJumpUrl, updateJump } from '../lib/jumps';
import { parseTime, todayIso } from '../lib/format';
import { JUMP_TYPES, type Jump, type JumpInput } from '../lib/types';
import Spinner from '../components/Spinner';

interface FormValues {
  jumpNumber: string;
  date: string;
  time: string;
  dropzone: string;
  aircraft: string;
  jumpType: string;
  exitAltitude: string;
  deploymentAltitude: string;
  freefallTime: string;
  canopy: string;
  notes: string;
}

const MAX_PARTICIPANTS = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const numToStr = (n: number | null) => (n == null ? '' : String(n));
const strToNum = (s: string) => (s.trim() === '' ? null : Number(s));

function toFormValues(jump: JumpInput): FormValues {
  return {
    ...jump,
    jumpNumber: String(jump.jumpNumber),
    exitAltitude: numToStr(jump.exitAltitude),
    deploymentAltitude: numToStr(jump.deploymentAltitude),
    freefallTime: numToStr(jump.freefallTime),
  };
}

function toJumpInput(v: FormValues): JumpInput {
  return {
    jumpNumber: Number(v.jumpNumber),
    date: v.date,
    time: parseTime(v.time) ?? '',
    dropzone: v.dropzone.trim(),
    aircraft: v.aircraft.trim(),
    jumpType: v.jumpType.trim(),
    exitAltitude: strToNum(v.exitAltitude),
    deploymentAltitude: strToNum(v.deploymentAltitude),
    freefallTime: strToNum(v.freefallTime),
    canopy: v.canopy.trim(),
    notes: v.notes.trim(),
  };
}

function defaultsFromLastJump(jumps: Jump[]): FormValues {
  const last = jumps[0];
  return {
    jumpNumber: String((last?.jumpNumber ?? 0) + 1),
    date: todayIso(),
    time: '',
    dropzone: last?.dropzone ?? '',
    aircraft: last?.aircraft ?? '',
    jumpType: last?.jumpType ?? '',
    exitAltitude: numToStr(last?.exitAltitude ?? 4000),
    deploymentAltitude: numToStr(last?.deploymentAltitude ?? 1000),
    freefallTime: numToStr(last?.freefallTime ?? null),
    canopy: last?.canopy ?? '',
    notes: '',
  };
}

export default function JumpFormPage() {
  const { id } = useParams();
  const location = useLocation();
  const { jumps, loading } = useJumps();

  if (loading) return <Spinner />;

  if (id) {
    const jump = jumps.find((j) => j.id === id);
    if (!jump) {
      return (
        <div className="card text-center">
          <p>Jump not found.</p>
          <Link to="/" className="text-sky-700 hover:underline">Back to logbook</Link>
        </div>
      );
    }
    return <JumpForm key={jump.id} jump={jump} initial={toFormValues(jump)} />;
  }

  // Keyed by location so "Save & add another" remounts with fresh defaults.
  return <JumpForm key={location.key} initial={defaultsFromLastJump(jumps)} />;
}

function JumpForm({ jump, initial }: { jump?: Jump; initial: FormValues }) {
  const user = useCurrentUser();
  const { jumps } = useJumps();
  const navigate = useNavigate();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState(jump?.participants ?? []);
  const [participantInput, setParticipantInput] = useState('');
  const [participantError, setParticipantError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const suggestions = useMemo(() => {
    const unique = (key: 'dropzone' | 'aircraft' | 'canopy') =>
      [...new Set(jumps.map((j) => j[key]).filter(Boolean))].sort();
    return {
      dropzone: unique('dropzone'),
      aircraft: unique('aircraft'),
      canopy: unique('canopy'),
      jumpType: [...new Set([...JUMP_TYPES, ...jumps.map((j) => j.jumpType).filter(Boolean)])],
      participants: [...new Set(jumps.flatMap((j) => j.participants))].sort(),
    };
  }, [jumps]);

  const set = (key: keyof FormValues) =>
    (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const jumpNumber = Number(values.jumpNumber);
  const duplicate = jumps.find((j) => j.jumpNumber === jumpNumber && j.id !== jump?.id);

  /** Adds the typed email; returns the updated list, or null if it is invalid. */
  function addParticipant(): string[] | null {
    const email = normalizeEmail(participantInput);
    let problem: string | null = null;
    if (!EMAIL_RE.test(email)) problem = 'Enter a valid email address.';
    else if (email === normalizeEmail(user.email ?? '')) problem = "That's your own email; you already have access.";
    else if (!participants.includes(email) && participants.length >= MAX_PARTICIPANTS) {
      problem = `A jump can have at most ${MAX_PARTICIPANTS} participants.`;
    }
    setParticipantError(problem);
    if (problem) return null;
    const next = participants.includes(email) ? participants : [...participants, email];
    setParticipants(next);
    setParticipantInput('');
    return next;
  }

  function handleParticipantKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addParticipant();
  }

  function copyShareLink() {
    if (!jump) return;
    navigator.clipboard.writeText(sharedJumpUrl(user.uid, jump.id)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => alert('Could not copy the link.'),
    );
  }

  function save(addAnother: boolean) {
    if (!Number.isInteger(jumpNumber) || jumpNumber <= 0) {
      setError('Jump number must be a positive whole number.');
      return;
    }
    if (!values.date) {
      setError('Date is required.');
      return;
    }
    const sharedWith = participantInput.trim() ? addParticipant() : participants;
    if (!sharedWith) return;
    const input = toJumpInput(values);
    const data = {
      ...input,
      participants: sharedWith,
      ownerName: (user.displayName || user.email || '').slice(0, 200),
    };
    // Not awaited: Firestore applies writes locally right away and syncs when back online.
    const op = jump ? updateJump(user.uid, jump.id, data) : addJump(user.uid, data);
    op.catch((err: Error) => alert(`Could not save jump #${input.jumpNumber}: ${err.message}`));
    navigate(addAnother ? '/jumps/new' : '/');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save(false);
  }

  function handleDelete() {
    if (!jump || !confirm(`Delete jump #${jump.jumpNumber}? This cannot be undone.`)) return;
    deleteJump(user.uid, jump.id).catch((err: Error) => alert(`Could not delete: ${err.message}`));
    navigate('/');
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{jump ? `Jump #${jump.jumpNumber}` : 'Log a jump'}</h1>
        <Link to="/" className="text-sm text-slate-500 hover:underline">Cancel</Link>
      </div>

      <div className="card grid gap-4 sm:grid-cols-2">
        <Field label="Jump number" id="jumpNumber">
          <input id="jumpNumber" type="number" min={1} step={1} required className="input" value={values.jumpNumber} onChange={set('jumpNumber')} />
          {duplicate && (
            <p className="mt-1 text-xs text-amber-700">Jump #{jumpNumber} already exists in your logbook.</p>
          )}
        </Field>
        <Field label="Date" id="date">
          <input id="date" type="date" required className="input" value={values.date} onChange={set('date')} />
        </Field>
        <Field label="Time (optional)" id="time">
          <input id="time" type="time" step={1} className="input" value={values.time} onChange={set('time')} />
        </Field>
        <Field label="Dropzone" id="dropzone">
          <input id="dropzone" list="dropzone-list" className="input" value={values.dropzone} onChange={set('dropzone')} />
        </Field>
        <Field label="Aircraft" id="aircraft">
          <input id="aircraft" list="aircraft-list" className="input" value={values.aircraft} onChange={set('aircraft')} />
        </Field>
        <Field label="Jump type" id="jumpType">
          <input id="jumpType" list="jumptype-list" className="input" value={values.jumpType} onChange={set('jumpType')} />
        </Field>
        <Field label="Canopy" id="canopy">
          <input id="canopy" list="canopy-list" placeholder="e.g. Sabre3 170" className="input" value={values.canopy} onChange={set('canopy')} />
        </Field>
        <Field label="Exit altitude (m)" id="exitAltitude">
          <input id="exitAltitude" type="number" min={0} step={1} className="input" value={values.exitAltitude} onChange={set('exitAltitude')} />
        </Field>
        <Field label="Deployment altitude (m)" id="deploymentAltitude">
          <input id="deploymentAltitude" type="number" min={0} step={1} className="input" value={values.deploymentAltitude} onChange={set('deploymentAltitude')} />
        </Field>
        <Field label="Freefall time (s)" id="freefallTime">
          <input id="freefallTime" type="number" min={0} step={1} className="input" value={values.freefallTime} onChange={set('freefallTime')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" id="notes">
            <textarea id="notes" rows={4} className="input" value={values.notes} onChange={set('notes')} />
          </Field>
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Participants</h2>
          <p className="text-sm text-slate-500">
            People you add by email can view this jump via its direct link after signing in.
          </p>
        </div>
        {participants.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {participants.map((email) => (
              <li key={email} className="flex items-center gap-1 rounded-full bg-sky-50 py-1 pl-3 pr-1 text-sm text-sky-800">
                {email}
                <button
                  type="button"
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-sky-600 hover:bg-sky-100"
                  aria-label={`Remove ${email}`}
                  onClick={() => setParticipants((p) => p.filter((e) => e !== email))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            type="email"
            list="participants-list"
            placeholder="friend@example.com"
            className="input"
            aria-label="Participant email"
            value={participantInput}
            onChange={(e) => {
              setParticipantInput(e.target.value);
              setParticipantError(null);
            }}
            onKeyDown={handleParticipantKeyDown}
          />
          <button type="button" className="btn btn-secondary" onClick={addParticipant}>Add</button>
        </div>
        {participantError && <p className="text-xs text-red-600">{participantError}</p>}
        {jump && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <input readOnly className="input flex-1 text-slate-500" aria-label="Share link" value={sharedJumpUrl(user.uid, jump.id)} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary" onClick={copyShareLink}>
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
        {!jump && participants.length > 0 && (
          <p className="text-xs text-slate-500">The share link becomes available after saving.</p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary">{jump ? 'Save changes' : 'Save jump'}</button>
        {!jump && (
          <button type="button" className="btn btn-secondary" onClick={() => save(true)}>
            Save &amp; add another
          </button>
        )}
        {jump && (
          <button type="button" className="btn btn-danger ml-auto" onClick={handleDelete}>Delete</button>
        )}
      </div>

      {(['dropzone', 'aircraft', 'canopy'] as const).map((key) => (
        <datalist key={key} id={`${key}-list`}>
          {suggestions[key].map((s) => <option key={s} value={s} />)}
        </datalist>
      ))}
      <datalist id="participants-list">
        {suggestions.participants
          .filter((s) => !participants.includes(s))
          .map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="jumptype-list">
        {suggestions.jumpType.map((s) => <option key={s} value={s} />)}
      </datalist>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
