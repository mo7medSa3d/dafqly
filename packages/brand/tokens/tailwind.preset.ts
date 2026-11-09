// Tailwind v3-style preset. If the project uses Tailwind v4, map the same variables with @theme in CSS instead.
import type { Config } from 'tailwindcss';
const preset: Partial<Config> = {
  theme: { extend: {
    colors: {
      navy: {"50": "#EEF2F6", "100": "#D8E1EA", "200": "#B3C3D4", "300": "#84A0B9", "400": "#55708D", "500": "#354C66", "600": "#22344D", "700": "#14243A", "800": "#0F1B2D", "900": "#0B1522", "950": "#070F18"}, teal: {"50": "#E7FAF4", "100": "#C9F3E7", "200": "#97E7D2", "300": "#5FDDBE", "400": "#27C7A5", "500": "#17AB8A", "600": "#0F8A6E", "700": "#0C6B57", "800": "#0A5747", "900": "#084739"}, slate: {"50": "#F6F8F7", "100": "#EAF0EE", "200": "#E3EAE8", "300": "#C4D0CC", "400": "#93A5B4", "500": "#697989", "600": "#556777", "700": "#46586A", "800": "#2E3D4D", "900": "#1E2B3A", "950": "#121D29"},
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
