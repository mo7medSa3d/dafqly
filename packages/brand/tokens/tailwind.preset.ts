// Tailwind v3-style preset. If the project uses Tailwind v4, map the same variables with @theme in CSS instead.
import type { Config } from 'tailwindcss';
const preset: Partial<Config> = {
  theme: { extend: {
    colors: {
      petrol: {"50": "#EAF4F6", "100": "#CFE6EA", "200": "#A2CDD5", "300": "#6EB0BC", "400": "#3E92A2", "500": "#237787", "600": "#1A6070", "700": "#154E5B", "800": "#103E49", "900": "#0B2E37", "950": "#071F26"}, brass: {"50": "#FFF8E6", "100": "#FDEBBF", "200": "#FAD98A", "300": "#F5C25A", "400": "#EEAC32", "500": "#D9951A", "600": "#B57812", "700": "#8F5E10"}, paper: {"0": "#FFFFFF", "50": "#F7F7F5", "100": "#EFF0EE", "200": "#E1E3E0", "300": "#C9CDC9", "400": "#9CA39F", "500": "#676F6B", "600": "#505854", "700": "#393F3C", "800": "#252A28", "900": "#171A19", "950": "#0C0E0D"},
      bg: 'var(--bg)', surface: 'var(--surface)', 'surface-muted': 'var(--surface-muted)',
      border: 'var(--border)', 'border-strong': 'var(--border-strong)',
      text: { DEFAULT: 'var(--text)', muted: 'var(--text-muted)', subtle: 'var(--text-subtle)' },
      primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)', fg: 'var(--primary-fg)' },
      accent: { DEFAULT: 'var(--accent)', fg: 'var(--accent-fg)' },
    },
    borderRadius: { sm: '6px', md: '10px', lg: '14px', xl: '20px' },
    fontFamily: { brand: ['Thmanyah', 'Noto Sans Arabic', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'] },
    lineHeight: { body: '1.7', heading: '1.4' },
    minHeight: { touch: '44px' }, minWidth: { touch: '44px' },
  } },
};
export default preset;
