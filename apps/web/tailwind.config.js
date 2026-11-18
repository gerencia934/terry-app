/** Colores vía tokens CSS (src/index.css) para soportar tema claro/oscuro. */
const t = (v) => `rgb(var(--${v}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: t('bg'), surface: t('surface'), 'surface-2': t('surface-2'), line: t('line'),
        fg: t('fg'), muted: t('muted'), subtle: t('subtle'),
        brand: { DEFAULT: t('brand'), strong: t('brand-strong'), soft: t('brand-soft'), ink: t('brand-ink'), lime: t('brand-lime') },
        nav: t('nav'), accent: t('accent'), ok: t('ok'), warn: t('warn'), bad: t('bad'), info: t('info'),
      },
      fontFamily: {
        display: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { xl: '14px' },
    },
  },
  plugins: [],
};
