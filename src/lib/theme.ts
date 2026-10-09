export type Theme = "light" | "dark";

/** Also read by the inline script in index.html that sets the theme before first
 * paint — keep the two in sync. */
export const THEME_STORAGE_KEY = "pdf-editor-theme";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** The saved choice wins; otherwise follow the operating system. */
export function resolveTheme(stored: unknown, systemPrefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return systemPrefersDark ? "dark" : "light";
}

/** Storage can be missing or throw (private windows, blocked site data). */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStoredTheme(): unknown {
  try {
    return safeStorage()?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    safeStorage()?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The choice just won't survive a reload.
  }
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme to start with: saved choice, else the OS preference. */
export function initialTheme(): Theme {
  return resolveTheme(readStoredTheme(), systemPrefersDark());
}

/** Reflect the theme on <html>, where the stylesheet's tokens key off it. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}
