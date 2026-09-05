import { useEffect, useRef } from 'react';

// Cashier phones sit at a shared counter — a session left open after
// someone walks away is a real risk for a cash-audit system. This
// signs the person out after a period of no interaction, independent
// of Supabase's own JWT expiry (which is usually much longer and
// tuned for convenience, not counter security).
//
// Not used for HQ/audit roles by default — call it conditionally at
// the call site if you want it there too.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export function useIdleLogout(onIdle: () => void, timeoutMs: number = DEFAULT_TIMEOUT_MS): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(onIdle, timeoutMs);
    }

    resetTimer();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, resetTimer));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [onIdle, timeoutMs]);
}
