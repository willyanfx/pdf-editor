import { create } from "zustand";

export type ToastVariant = "error" | "success" | "info";

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
  /** 0..1 download fraction. When present the toast is sticky (no auto-dismiss)
   * and Toaster renders a thin progress bar at the bottom of the card. */
  progress?: number;
  /** When true, never auto-dismiss; must be removed with dismissToast(). */
  sticky?: boolean;
};

/** Default auto-dismiss windows: errors linger a little longer than confirmations. */
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  error: 5000,
  success: 2500,
  info: 2500,
};

type ToastState = {
  toasts: Toast[];
  /** Show a toast; returns its id. Auto-dismisses after `durationMs`
   * (variant default if omitted). Backward-compatible — all existing callers
   * continue to work unchanged. */
  addToast: (message: string, variant: ToastVariant, durationMs?: number) => string;
  /** Open a sticky toast with a 0..1 progress bar. Returns its id.
   * Does NOT start a timer — caller must call dismissToast(id) explicitly. */
  addProgressToast: (message: string, variant: ToastVariant) => string;
  /** Patch message and/or progress on an existing toast by id.
   * No-op if the id is not found (toast already dismissed). */
  updateToast: (id: string, patch: { message?: string; progress?: number }) => void;
  dismissToast: (id: string) => void;
};

/** Toasts live in their own store so adding/dismissing one doesn't re-render
 * every consumer of the (larger, hot) editor store. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, variant, durationMs) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [{ id, message, variant }, ...state.toasts] }));

    const ms = durationMs ?? DEFAULT_DURATION[variant];
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, ms);

    return id;
  },

  addProgressToast: (message, variant) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [{ id, message, variant, progress: 0, sticky: true }, ...state.toasts],
    }));
    return id;
  },

  updateToast: (id, patch) =>
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
