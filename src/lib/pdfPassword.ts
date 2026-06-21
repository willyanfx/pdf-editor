/**
 * Password-protected PDF helpers (Phase 3, item 9 spike).
 *
 * react-pdf's <Document> already calls window.prompt() via its default
 * onPassword, so encrypted PDFs aren't silently failing in the viewer. But the
 * direct pdfjs.getDocument() calls in our own paths (OCR / scanned-detection /
 * CSV export / page-height measurement) have no onPassword and throw a bare
 * PasswordException. These pure helpers let those paths recognize a password
 * situation and drive an in-app unlock modal instead of a native prompt().
 */

/** pdf.js PasswordResponses codes (mirrored to avoid importing the enum, which
 * lives behind react-pdf's bundled pdfjs). */
export const NEED_PASSWORD = 1;
export const INCORRECT_PASSWORD = 2;

/** True if `err` is a pdf.js PasswordException (needs or rejected a password). */
export function isPasswordException(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "PasswordException"
  );
}

export type PasswordPromptState = {
  /** Whether the UI should prompt the user for a password. */
  needsPassword: boolean;
  /** Whether a previously entered password was rejected (show "incorrect"). */
  wrong: boolean;
};

/**
 * Map a caught error to the unlock-modal state: a non-password error yields no
 * prompt; NEED_PASSWORD yields a fresh prompt; INCORRECT_PASSWORD yields a retry
 * prompt flagged as wrong.
 */
export function passwordPromptState(err: unknown): PasswordPromptState {
  if (!isPasswordException(err)) return { needsPassword: false, wrong: false };
  const code = (err as { code?: number }).code;
  return { needsPassword: true, wrong: code === INCORRECT_PASSWORD };
}

/** The callback pdf.js invokes when a document needs a password: it hands you a
 * setter and the reason (NEED_PASSWORD | INCORRECT_PASSWORD). */
export type OnPassword = (updatePassword: (password: string) => void, reason: number) => void;

type OnPasswordDeps = {
  /** Current known password (e.g. from the store), or null if none yet. */
  getPassword: () => string | null;
  /**
   * Called on the first ask when no password is known, so the UI can prompt.
   * When omitted (e.g. silent background loads), the handler instead feeds an
   * empty password so pdf.js rejects the loading task with a PasswordException
   * rather than hanging forever waiting for an `updatePassword` that never comes.
   */
  onNeedPassword?: () => void;
  /** Called when pdf.js reports the supplied password was wrong. */
  onIncorrect: () => void;
};

/**
 * Build an `onPassword` handler for `pdfjs.getDocument`. On the first ask
 * (NEED_PASSWORD) it feeds a known password straight through (so a document the
 * user already unlocked in the viewer loads silently elsewhere) or signals that
 * input is needed. On INCORRECT_PASSWORD it does NOT re-feed — that would loop —
 * it reports the rejection so the UI can re-prompt.
 *
 * Without an `onNeedPassword` prompt surface, a first ask with no known password
 * would otherwise leave the loading task pending forever (pdf.js waits on
 * `updatePassword`). To make the load reject instead of hang, we feed an empty
 * password: pdf.js rejects it as INCORRECT_PASSWORD, our handler declines to
 * re-feed, and the task settles with a PasswordException the caller can catch.
 */
export function makeOnPassword(deps: OnPasswordDeps): OnPassword {
  return (updatePassword, reason) => {
    if (reason === INCORRECT_PASSWORD) {
      deps.onIncorrect();
      return;
    }
    const known = deps.getPassword();
    if (known) {
      updatePassword(known);
      return;
    }
    if (deps.onNeedPassword) {
      deps.onNeedPassword();
      return;
    }
    // No prompt surface and no known password: force a terminal rejection.
    updatePassword("");
  };
}
