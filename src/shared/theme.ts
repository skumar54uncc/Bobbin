/**
 * Theme tokens for the overlay and side panel shell. One source of truth:
 * `themeTokensCss()` emits the `:host` custom properties for light and dark,
 * and `tests/theme.test.ts` checks every text/background pair for WCAG AA
 * (4.5:1). Values are recorded in docs/UI_DECISIONS.md.
 */
export type ThemeSetting = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_SETTINGS: ThemeSetting[] = ["light", "dark", "system"];

export function normalizeThemeSetting(raw: unknown): ThemeSetting {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "light";
}

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  return prefersDark ? "dark" : "light";
}

export interface ThemePalette {
  bg: string;
  surface: string;
  surfaceInput: string;
  noteBg: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  link: string;
  /** Non-hex tokens (alpha) below: not part of the contrast test. */
  border: string;
  hoverSoft: string;
  hover: string;
  hoverStrong: string;
  raised: string;
  backdrop: string;
  shadowColor: string;
  accentFaint: string;
  accentSoft: string;
  accentMuted: string;
  accentBorder: string;
}

export const THEME_TOKENS: { light: ThemePalette; dark: ThemePalette } = {
  light: {
    bg: "#f8f1e6",
    surface: "#f8f1e6",
    surfaceInput: "#efe4d2",
    noteBg: "#fff9ef",
    text: "#2e231d",
    textMuted: "#6b5a4e",
    textSubtle: "#6b5a4e",
    accent: "#9c3b21",
    link: "#9c3b21",
    border: "rgba(156, 59, 33, 0.35)",
    hoverSoft: "rgba(28, 25, 23, 0.04)",
    hover: "rgba(28, 25, 23, 0.06)",
    hoverStrong: "rgba(28, 25, 23, 0.08)",
    raised: "rgba(255, 255, 255, 0.45)",
    backdrop: "rgba(28, 25, 23, 0.35)",
    shadowColor: "rgba(28, 25, 23, 0.18)",
    accentFaint: "rgba(199, 42, 9, 0.07)",
    accentSoft: "rgba(199, 42, 9, 0.12)",
    accentMuted: "rgba(199, 42, 9, 0.22)",
    accentBorder: "rgba(199, 42, 9, 0.45)",
  },
  dark: {
    bg: "#221a15",
    surface: "#221a15",
    surfaceInput: "#2e241e",
    noteBg: "#3a2e26",
    text: "#f3e9dc",
    textMuted: "#bfae9e",
    textSubtle: "#bfae9e",
    accent: "#e07a5c",
    link: "#e07a5c",
    border: "rgba(243, 233, 220, 0.25)",
    hoverSoft: "rgba(243, 233, 220, 0.04)",
    hover: "rgba(243, 233, 220, 0.07)",
    hoverStrong: "rgba(243, 233, 220, 0.1)",
    raised: "rgba(243, 233, 220, 0.06)",
    backdrop: "rgba(0, 0, 0, 0.55)",
    shadowColor: "rgba(0, 0, 0, 0.45)",
    accentFaint: "rgba(224, 122, 92, 0.12)",
    accentSoft: "rgba(224, 122, 92, 0.18)",
    accentMuted: "rgba(224, 122, 92, 0.28)",
    accentBorder: "rgba(224, 122, 92, 0.5)",
  },
};

const TOKEN_NAMES: Record<keyof ThemePalette, string> = {
  bg: "--cx-bg",
  surface: "--cx-surface",
  surfaceInput: "--cx-surface-input",
  noteBg: "--cx-note-bg",
  text: "--cx-text",
  textMuted: "--cx-text-muted",
  textSubtle: "--cx-text-subtle",
  accent: "--cx-accent",
  link: "--cx-link",
  border: "--cx-border",
  hoverSoft: "--cx-hover-soft",
  hover: "--cx-hover",
  hoverStrong: "--cx-hover-strong",
  raised: "--cx-raised",
  backdrop: "--cx-backdrop",
  shadowColor: "--cx-shadow-color",
  accentFaint: "--cx-accent-faint",
  accentSoft: "--cx-accent-soft",
  accentMuted: "--cx-accent-muted",
  accentBorder: "--cx-accent-border",
};

function block(selector: string, palette: ThemePalette, scheme: ResolvedTheme): string {
  const lines = (Object.keys(TOKEN_NAMES) as Array<keyof ThemePalette>).map(
    (k) => `  ${TOKEN_NAMES[k]}: ${palette[k]};`
  );
  // Named type scale + focus: same steps as cortex-theme.css for overlay controls.
  const shared = [
    `  --cx-font-body: Nunito, sans-serif;`,
    `  --cx-ts-caption: 600 12px/1.45 var(--cx-font-body);`,
    `  --cx-ts-small: 600 14px/1.45 var(--cx-font-body);`,
    `  --cx-ts-body: 400 14px/1.55 var(--cx-font-body);`,
    `  --cx-ts-title: 560 20px/1.3 Fraunces, serif;`,
    `  --cx-ts-display: 560 26px/1.2 Fraunces, serif;`,
    `  --cx-ts-metric: 560 26px/1.2 Fraunces, serif;`,
    `  --cx-focus: #cd5f3e;`,
  ];
  return `${selector} {\n${lines.join("\n")}\n${shared.join("\n")}\n  color-scheme: ${scheme};\n}`;
}

/** Custom properties for the overlay shadow root. Light on :host, dark under data-theme. */
export function themeTokensCss(): string {
  return `${block(":host", THEME_TOKENS.light, "light")}\n\n${block(
    ':host([data-theme="dark"])',
    THEME_TOKENS.dark,
    "dark"
  )}\n`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((ch) => ch + ch).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = relativeLuminance(fgHex);
  const b = relativeLuminance(bgHex);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Applies `data-theme` to the overlay host and, in system mode, follows
 * prefers-color-scheme changes. Returns a stop function.
 */
export function applyThemeToHost(
  host: Element,
  setting: ThemeSetting,
  matchMediaFn: typeof matchMedia | undefined = typeof matchMedia === "function"
    ? matchMedia
    : undefined
): () => void {
  const mql = matchMediaFn ? matchMediaFn("(prefers-color-scheme: dark)") : null;
  const apply = (prefersDark: boolean): void => {
    host.setAttribute("data-theme", resolveTheme(setting, prefersDark));
  };
  apply(Boolean(mql?.matches));
  if (setting !== "system" || !mql) return () => undefined;
  const onChange = (e: { matches: boolean }): void => apply(e.matches);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
