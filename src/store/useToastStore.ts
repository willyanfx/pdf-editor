import { create } from "zustand";

export type ToastVariant = "error" | "success" | "info";

export type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
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
   * (variant default if omitted). */
  addToast: (message: string, variant: ToastVariant, durationMs?: number) => string;
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

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
