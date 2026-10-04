import { useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '../context/AuthContext';
import { useJumps } from '../context/JumpsContext';
import {
  IMPORT_FIELDS,
  convertRows,
  guessAltitudeUnit,
  guessDateFormat,
  guessMapping,
  parseCsvFile,
  type AltitudeUnit,
  type ColumnMapping,
  type DateFormat,
} from '../lib/csv';
import { importJumps } from '../lib/jumps';
import { formatAltitude, formatDate, formatSeconds } from '../lib/format';

interface ParsedFile {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

export default function ImportPage() {
  const user = useCurrentUser();
  const { jumps } = useJumps();
  const navigate = useNavigate();

  const [file, setFile] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>('dmy');
  const [altitudeUnit, setAltitudeUnit] = useState<AltitudeUnit>('m');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const existingNumbers = useMemo(() => new Set(jumps.map((j) => j.jumpNumber)), [jumps]);

  const results = useMemo(
    () => (file ? convertRows(file.rows, mapping, { dateFormat, altitudeUnit, existingNumbers }) : []),
    [file, mapping, dateFormat, altitudeUnit, existingNumbers],
  );
  const ready = results.filter((r) => r.jump && !r.duplicate);
  const duplicates = results.filter((r) => r.duplicate).length;
  const errors = results.filter((r) => r.error);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    try {
      const { headers, rows } = await parseCsvFile(f);
      if (rows.length === 0) throw new Error('The file contains no rows.');
      const guessed = guessMapping(headers);
      setMapping(guessed);
      setAltitudeUnit(guessAltitudeUnit(guessed));
      setDateFormat(guessed.date ? guessDateFormat(rows.map((r) => r[guessed.date!] ?? '')) : 'dmy');
      setFile({ name: f.name, headers, rows });
    } catch (err) {
      setFile(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleImport() {
    setError(null);
    setProgress(0);
    try {
      await importJumps(user.uid, ready.map((r) => r.jump!), setProgress);
      navigate('/');
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      setProgress(null);
    }
  }

  const importing = progress != null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Import jumps</h1>
        <p className="text-sm text-slate-500">
          Upload a CSV file with one jump per row and a header row. Columns are matched
          automatically; you can adjust the mapping before importing.
        </p>
      </div>

      <div className="card">
        <input type="file" accept=".csv,text/csv" onChange={handleFile} disabled={importing} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-4 file:py-2 file:font-medium file:text-sky-700 hover:file:bg-sky-100" />
        {file && <p className="mt-2 text-sm text-slate-500">{file.name}: {file.rows.length} rows</p>}
      </div>

      {error && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {file && (
        <>
          <div className="card space-y-4">
            <h2 className="font-semibold">Column mapping</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map(({ field, label, required }) => (
                <div key={field}>
                  <label className="label" htmlFor={`map-${field}`}>
                    {label} {required && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    id={`map-${field}`}
                    className="input"
                    value={mapping[field] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}
                  >
                    <option value="">(none)</option>
                    {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="label" htmlFor="dateFormat">Date format</label>
                <select id="dateFormat" className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                  <option value="dmy">Day / Month / Year</option>
                  <option value="mdy">Month / Day / Year</option>
                </select>
                <p className="mt-1 text-xs text-slate-500">YYYY-MM-DD dates are always recognized.</p>
              </div>
              <div>
                <label className="label" htmlFor="altUnit">Altitudes in file are in</label>
                <select id="altUnit" className="input" value={altitudeUnit} onChange={(e) => setAltitudeUnit(e.target.value as AltitudeUnit)}>
                  <option value="m">Meters</option>
                  <option value="ft">Feet (convert to meters)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium text-green-700">{ready.length} ready to import</span>
              {duplicates > 0 && <span className="text-amber-700">{duplicates} skipped (jump number already exists)</span>}
              {errors.length > 0 && <span className="text-red-600">{errors.length} with errors</span>}
            </div>

            {errors.length > 0 && (
              <ul className="max-h-32 overflow-y-auto text-xs text-red-600">
                {errors.slice(0, 50).map((r) => <li key={r.line}>Line {r.line}: {r.error}</li>)}
              </ul>
            )}

            {ready.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-2 text-xs text-slate-500">Preview of the first {Math.min(10, ready.length)} jumps:</p>
                <table className="w-full text-left text-xs">
                  <thead className="border-b text-slate-500">
                    <tr>
                      <th className="py-1 pr-3">#</th>
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 pr-3">Dropzone</th>
                      <th className="py-1 pr-3">Aircraft</th>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1 pr-3">Exit</th>
                      <th className="py-1 pr-3">Deploy</th>
                      <th className="py-1 pr-3">Freefall</th>
                      <th className="py-1 pr-3">Canopy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ready.slice(0, 10).map(({ line, jump }) => (
                      <tr key={line} className="border-b border-slate-100">
                        <td className="py-1 pr-3 font-medium">{jump!.jumpNumber}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{formatDate(jump!.date)}</td>
                        <td className="py-1 pr-3">{jump!.dropzone}</td>
                        <td className="py-1 pr-3">{jump!.aircraft}</td>
                        <td className="py-1 pr-3">{jump!.jumpType}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{formatAltitude(jump!.exitAltitude)}</td>
                        <td className="whitespace-nowrap py-1 pr-3">{formatAltitude(jump!.deploymentAltitude)}</td>
                        <td className="py-1 pr-3">{formatSeconds(jump!.freefallTime)}</td>
                        <td className="py-1 pr-3">{jump!.canopy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button className="btn btn-primary" disabled={ready.length === 0 || importing} onClick={handleImport}>
              {importing ? `Importing… ${progress} / ${ready.length}` : `Import ${ready.length} jumps`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
