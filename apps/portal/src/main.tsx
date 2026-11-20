import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Tema: el que eligió la persona en Residuos o Mantenimiento no se comparte (otro dominio); se sigue el del sistema.
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
