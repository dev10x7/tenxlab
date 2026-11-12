'use client';

import { useState } from 'react';

/**
 * Progressive hint for a practice lab. Hidden by default so the student tries
 * first; a lab is ungraded, so revealing the hint costs nothing but is logged
 * as a deliberate choice.
 */
export function HintReveal({ hint }: { hint: string }) {
  const [shown, setShown] = useState(false);

  if (!shown) {
    return (
      <button type="button" className="btn secondary" onClick={() => setShown(true)}>
        Show hint
      </button>
    );
  }

  return (
    <p className="hint" role="note">
      <strong>Hint:</strong> {hint}
    </p>
  );
}
