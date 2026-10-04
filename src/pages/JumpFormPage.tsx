import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import { addJump, deleteJump, updateJump } from '../lib/jumps';
import { todayIso } from '../lib/format';
import { JUMP_TYPES, type Jump, type JumpInput } from '../lib/types';
import Spinner from '../components/Spinner';

interface FormValues {
  jumpNumber: string;
  date: string;
  dropzone: string;
  aircraft: string;
  jumpType: string;
  exitAltitude: string;
  deploymentAltitude: string;
  freefallTime: string;
  canopy: string;
  notes: string;
}

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

  const suggestions = useMemo(() => {
    const unique = (key: 'dropzone' | 'aircraft' | 'canopy') =>
      [...new Set(jumps.map((j) => j[key]).filter(Boolean))].sort();
    return {
      dropzone: unique('dropzone'),
      aircraft: unique('aircraft'),
      canopy: unique('canopy'),
      jumpType: [...new Set([...JUMP_TYPES, ...jumps.map((j) => j.jumpType).filter(Boolean)])],
    };
  }, [jumps]);

  const set = (key: keyof FormValues) =>
    (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const jumpNumber = Number(values.jumpNumber);
  const duplicate = jumps.find((j) => j.jumpNumber === jumpNumber && j.id !== jump?.id);

  function save(addAnother: boolean) {
    if (!Number.isInteger(jumpNumber) || jumpNumber <= 0) {
      setError('Jump number must be a positive whole number.');
      return;
    }
    if (!values.date) {
      setError('Date is required.');
      return;
    }
    const input = toJumpInput(values);
    // Not awaited: Firestore applies writes locally right away and syncs when back online.
    const op = jump ? updateJump(user.uid, jump.id, input) : addJump(user.uid, input);
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
