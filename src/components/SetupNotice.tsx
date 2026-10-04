export default function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl p-8">
      <div className="card space-y-3">
        <h1 className="text-xl font-semibold">Firebase is not configured</h1>
        <p className="text-sm text-slate-600">
          Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1">.env.local</code>, fill in your Firebase web
          app config, and restart the dev server. See the README for full setup steps.
        </p>
      </div>
    </div>
  );
}
