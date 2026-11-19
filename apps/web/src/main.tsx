import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Aplica el tema guardado antes del primer render para evitar parpadeo.
try {
  const t = localStorage.getItem('tv-theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
} catch { /* almacenamiento no disponible */ }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// App instalable (PWA): guarda la aplicación en el teléfono para abrirla sin señal. Solo en la versión publicada.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => undefined); });
}
