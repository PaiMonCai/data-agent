import type { AppSettings } from "./types";

const KEY = "da.settings.v2";

export const defaultSettings: AppSettings = {
  theme: "system",
  model: "",
  agg: "sum",
  granularity: "auto",
  sensitivity: "normal",
  detail: "normal",
  autoAnalyze: true,
  confirmDelete: true,
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...defaultSettings, ...saved };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function applyTheme(theme: AppSettings["theme"]) {
  if (typeof document === "undefined") return;
  const resolved =
    theme === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}
