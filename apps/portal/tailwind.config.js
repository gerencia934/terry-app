/** Colores vía tokens CSS (src/index.css) para soportar tema claro/oscuro. */
const t = (v) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: t('bg'), surface: t('surface'), 'surface-2': t('surface-2'), line: t('line'),
        fg: t('fg'), muted: t('muted'), subtle: t('subtle'),
        // Paleta del manual de identidad de Terra Viva: #1F5E3B, #7BC043, #1F4E5F y #D2FFAE
        brand: { DEFAULT: t('brand'), strong: t('brand-strong'), soft: t('brand-soft'), ink: t('brand-ink'), lime: t('brand-lime'), teal: t('brand-teal'), mint: t('brand-mint') },
        nav: t('nav'), accent: t('accent'), ok: t('ok'), warn: t('warn'), bad: t('bad'), info: t('info'),
      },
      fontFamily: {
        // Manual de identidad: Montserrat (títulos) y Open Sans (textos)
        display: ['Montserrat', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Open Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { xl: '14px' },
    },
  },
  plugins: [],
};
