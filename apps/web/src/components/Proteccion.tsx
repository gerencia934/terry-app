// Si una pantalla falla al dibujarse, muestra un aviso en lugar de dejar la página en blanco.
// El menú y el resto de la aplicación siguen funcionando; al cambiar de pantalla se intenta de nuevo.
import { Component, type ReactNode } from 'react';

export class Proteccion extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Falla en la pantalla:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="text-base font-semibold">Esta pantalla tuvo un problema</p>
        <p className="text-[13px] text-muted">No se perdió nada de lo que ya estaba guardado. Recargue la página; si vuelve a pasar, avise a soporte con lo que estaba haciendo.</p>
        <button type="button" onClick={() => window.location.reload()} className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-on-brand">Recargar</button>
      </div>
    );
  }
}
