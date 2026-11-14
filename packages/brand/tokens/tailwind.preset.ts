// Tailwind v3-style preset. If the project uses Tailwind v4, map the same variables with @theme in CSS instead.
import type { Config } from 'tailwindcss';
const preset: Partial<Config> = {
  theme: { extend: {
    colors: {
      navy: {"50": "#F1F3FD", "100": "#E0E4F8", "200": "#C2C9F0", "300": "#98A3E0", "400": "#6571BF", "500": "#414C94", "600": "#2B3470", "700": "#1C2350", "800": "#141A3C", "900": "#0D1229", "950": "#080B1A"}, teal: {"100": "#C9F3E7", "200": "#97E7D2", "300": "#5FDDBE", "400": "#27C7A5", "50": "#E7FAF4", "500": "#17AB8A", "600": "#0F8A6E", "700": "#0C6B57", "800": "#0A5747", "900": "#084739"}, slate: {"50": "#F5F6FA", "100": "#ECEEF5", "200": "#E1E4EE", "300": "#C5CAD9", "400": "#9098B0", "500": "#666F89", "600": "#535C75", "700": "#434B62", "800": "#2D3347", "900": "#1E2233", "950": "#12151F"},
      bg: 'var(--bg)', surface: 'var(--surface)', 'surface-muted': 'var(--surface-muted)',
      border: 'var(--border)', 'border-strong': 'var(--border-strong)',
      text: { DEFAULT: 'var(--text)', muted: 'var(--text-muted)', subtle: 'var(--text-subtle)' },
      primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)', fg: 'var(--primary-fg)' },
      accent: { DEFAULT: 'var(--accent)', fg: 'var(--accent-fg)' },
    },
    borderRadius: { sm: '8px', md: '10px', lg: '12px', xl: '16px' },
    fontFamily: { brand: ['Plus Jakarta Sans', 'IBM Plex Sans Arabic', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'] },
    lineHeight: { body: '1.7', heading: '1.4' },
    minHeight: { touch: '44px' }, minWidth: { touch: '44px' },
  } },
};
export default preset;
