import { useState, type ReactNode } from 'react';
import {
  ALARM_TYPES,
  MAX_ALARMS,
  MAX_SPEECH,
  MAX_WINDOWS,
  SECTIONS,
  SPEECH_MODES,
  SPEECH_UNITS,
  effectiveValue,
  type ConfigField,
  type FlySightConfig,
  type ListName,
  type Option,
} from '../lib/flysightConfig';

interface Props {
  config: FlySightConfig;
  problems: Map<string, string>;
  /** Editing a selectable config, whose unset keys and lists keep their config.txt values. */
  overlay: boolean;
  onChange: (config: FlySightConfig) => void;
}

const parseNumber = (s: string) => (s.trim() === '' ? NaN : Number(s));
const showNumber = (n: number) => (Number.isNaN(n) ? '' : String(n));

export default function FlySightConfigForm({ config, problems, overlay, onChange }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  /** Sets a value, or with `undefined` removes the key from the file. */
  function setValue(key: string, value: number | string | undefined) {
    const values = { ...config.values };
    if (value === undefined) delete values[key];
    else values[key] = value;
    onChange({ ...config, values });
  }

  function updateList<K extends ListName>(key: K, items: FlySightConfig[K]) {
    // No entry clears config.txt's speech list (Sp_Rate: 0 silences speech instead), so an empty one inherits it.
    if (key === 'speech' && overlay && items.length === 0) return inheritList(key);
    onChange({ ...config, [key]: items, lists: new Set([...config.lists, key]) });
  }

  function inheritList(key: ListName) {
    const lists = new Set(config.lists);
    lists.delete(key);
    onChange({ ...config, [key]: [], lists });
  }

  const listProps = <K extends ListName>(key: K) => ({
    items: config[key],
    problem: problems.get(key),
    inherited: overlay && !config.lists.has(key),
    onOverride: () => updateList(key, config[key]),
    onInherit: overlay ? () => inheritList(key) : undefined,
  });

  const sections = SECTIONS.filter((s) => showAdvanced || !s.advanced);

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.title} className="card space-y-3">
          <div>
            <h2 className="font-semibold">{section.title}</h2>
            {section.description && <p className="text-sm text-slate-500">{section.description}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                config={config}
                overlay={overlay}
                problem={problems.get(field.key)}
                onChange={(v) => setValue(field.key, v)}
              />
            ))}
          </div>

          {section.title === 'Speech' && (
            <ListEditor
              title="Spoken measurements"
              empty="Nothing is spoken."
              max={MAX_SPEECH}
              {...listProps('speech')}
              onAdd={() => updateList('speech', [...config.speech, { mode: 2, units: 1, decimals: 1 }])}
              onRemove={(i) => updateList('speech', config.speech.filter((_, j) => j !== i))}
              render={(item, i) => {
                const set = (patch: Partial<typeof item>) =>
                  updateList('speech', config.speech.map((s, j) => (j === i ? { ...s, ...patch } : s)));
                return (
                  <>
                    <Select label="Measurement" value={item.mode} options={SPEECH_MODES} onChange={(mode) => set({ mode })} />
                    <Select label="Units" value={item.units} options={SPEECH_UNITS} onChange={(units) => set({ units })} />
                    <NumberInput
                      label={item.mode === 12 ? 'Altitude step' : 'Decimal places'}
                      value={item.decimals}
                      onChange={(decimals) => set({ decimals })}
                    />
                  </>
                );
              }}
            />
          )}

          {section.title === 'Alarms' && (
            <ListEditor
              title="Alarms"
              empty="No alarms."
              max={MAX_ALARMS}
              {...listProps('alarms')}
              onAdd={() => updateList('alarms', [...config.alarms, { elev: 1000, type: 1, file: '' }])}
              onRemove={(i) => updateList('alarms', config.alarms.filter((_, j) => j !== i))}
              render={(item, i) => {
                const set = (patch: Partial<typeof item>) =>
                  updateList('alarms', config.alarms.map((a, j) => (j === i ? { ...a, ...patch } : a)));
                return (
                  <>
                    <NumberInput label="Elevation (m above ground)" value={item.elev} onChange={(elev) => set({ elev })} />
                    <Select label="Type" value={item.type} options={ALARM_TYPES} onChange={(type) => set({ type })} />
                    {item.type === 4 && (
                      <label className="block">
                        <span className="label">File</span>
                        <input
                          className="input"
                          maxLength={8}
                          value={item.file}
                          onChange={(e) => set({ file: e.target.value.replace(/[\s;:]/g, '') })}
                        />
                      </label>
                    )}
                  </>
                );
              }}
            />
          )}

          {section.title === 'Altitude announcements' && (
            <ListEditor
              title="Silence windows"
              description="Tones are silenced between these heights (m above ground); alarms stay audible."
              empty="No silence windows."
              max={MAX_WINDOWS}
              {...listProps('windows')}
              onAdd={() => updateList('windows', [...config.windows, { top: 1500, bottom: 1000 }])}
              onRemove={(i) => updateList('windows', config.windows.filter((_, j) => j !== i))}
              render={(item, i) => {
                const set = (patch: Partial<typeof item>) =>
                  updateList('windows', config.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));
                return (
                  <>
                    <NumberInput label="Top (m)" value={item.top} onChange={(top) => set({ top })} />
                    <NumberInput label="Bottom (m)" value={item.bottom} onChange={(bottom) => set({ bottom })} />
                  </>
                );
              }}
            />
          )}
        </div>
      ))}

      {config.extra.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">Other settings</h2>
          <p className="text-sm text-slate-500">Settings this editor doesn't know about are kept as they are.</p>
          <ul className="mt-2 font-mono text-sm">
            {config.extra.map(([key, value], i) => (
              <li key={i}>{key}: {value}</li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className="btn btn-secondary" onClick={() => setShowAdvanced((s) => !s)}>
        {showAdvanced ? 'Hide advanced settings' : 'Show advanced settings'}
      </button>
    </div>
  );
}

function FieldInput({
  field,
  config,
  overlay,
  problem,
  onChange,
}: {
  field: ConfigField;
  config: FlySightConfig;
  overlay: boolean;
  problem?: string;
  onChange: (value: number | string | undefined) => void;
}) {
  const isSet = field.key in config.values;
  const value = config.values[field.key];
  const id = `fs-${field.key}`;
  const unit = typeof field.unit === 'function' ? field.unit(config) : field.unit;
  // In a selectable config an unset key has config.txt's value, which isn't known here.
  const shown = isSet || !overlay ? effectiveValue(config, field.key) : null;
  const hint = typeof shown === 'number' && Number.isFinite(shown) ? field.hint?.(shown, config) : null;
  const defaultLabel = field.options?.find((o) => o.value === field.default)?.label ?? String(field.default || 'none');
  const unsetLabel = overlay ? 'From config.txt' : `Default: ${defaultLabel}`;

  let input: ReactNode;
  if (field.options) {
    input = (
      <select
        id={id}
        className={`input ${isSet ? '' : 'text-slate-400'}`}
        value={isSet ? String(value) : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      >
        <option value="">{unsetLabel}</option>
        {withCurrent(field.options, Number(value)).map((o) => (
          <option key={o.value} value={o.value} className="text-slate-900">{o.label}</option>
        ))}
      </select>
    );
  } else if (field.text) {
    input = (
      <input
        id={id}
        className="input"
        maxLength={8}
        placeholder={unsetLabel}
        value={isSet ? String(value) : ''}
        onChange={(e) => {
          const v = e.target.value.replace(/[\s;:]/g, '');
          onChange(v === '' ? undefined : v);
        }}
      />
    );
  } else {
    input = (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          step={1}
          min={field.min}
          max={field.max}
          className="input"
          placeholder={unsetLabel}
          value={isSet ? showNumber(Number(value)) : ''}
          onChange={(e) => onChange(e.target.value.trim() === '' ? undefined : parseNumber(e.target.value))}
        />
        {unit && <span className="shrink-0 text-sm text-slate-500">{unit}</span>}
      </div>
    );
  }

  return (
    <div>
      <label className="label" htmlFor={id}>
        {field.label} <span className="font-mono text-xs font-normal text-slate-400">{field.key}</span>
      </label>
      {input}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {field.help && <p className="mt-1 text-xs text-slate-500">{field.help}</p>}
      {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
    </div>
  );
}

/** Keeps a value the file holds visible even when it is not one of the documented options. */
function withCurrent(options: Option[], value: number): Option[] {
  return options.some((o) => o.value === value) || Number.isNaN(value)
    ? options
    : [...options, { value, label: `${value} – Unknown` }];
}

function Select({ label, value, options, onChange }: { label: string; value: number; options: Option[]; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {withCurrent(options, value).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        step={1}
        className="input"
        value={showNumber(value)}
        onChange={(e) => onChange(parseNumber(e.target.value))}
      />
    </label>
  );
}

function ListEditor<T>({
  title,
  description,
  empty,
  items,
  problem,
  inherited,
  max,
  onAdd,
  onRemove,
  onOverride,
  onInherit,
  render,
}: {
  title: string;
  description?: string;
  empty: string;
  items: T[];
  problem?: string;
  /** The list is not set in this file and comes from config.txt. */
  inherited: boolean;
  max: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onOverride: () => void;
  onInherit?: () => void;
  render: (item: T, index: number) => ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
        {inherited ? (
          <button type="button" className="btn btn-secondary px-3 py-1" onClick={onOverride}>Override</button>
        ) : (
          <div className="flex gap-2">
            {onInherit && (
              <button type="button" className="btn btn-secondary px-3 py-1" onClick={onInherit}>Use config.txt</button>
            )}
            <button type="button" className="btn btn-secondary px-3 py-1" disabled={items.length >= max} onClick={onAdd}>
              Add
            </button>
          </div>
        )}
      </div>
      {inherited ? (
        <p className="text-sm text-slate-400">Uses the list from config.txt.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-end gap-2 rounded-lg bg-slate-50 p-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">{render(item, i)}</div>
              <button
                type="button"
                className="btn btn-secondary px-3"
                aria-label={`Remove ${title.toLowerCase()} ${i + 1}`}
                onClick={() => onRemove(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="text-xs text-red-600">{problem}</p>}
    </div>
  );
}
