import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { CompanionDevice, parseCompanionLink } from '../lib/companionApp';

/** The device the WeFall Android app shares, when it opened this page (see companionApp.ts). */
export function useCompanionDevice() {
  const { hash } = useLocation();
  const link = useMemo(() => parseCompanionLink(hash), [hash]);
  const [device, setDevice] = useState<CompanionDevice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setDevice(null);
    setError(null);
    CompanionDevice.connect(link).then(
      (d) => !cancelled && setDevice(d),
      (err) => !cancelled && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [link]);

  return { link, device, error };
}
