import { createContext, useContext, useState, type ReactNode } from 'react';
import { DECLARACIONES, type Declaracion } from '../data/mock';

// Estado compartido del prototipo. En producción: TanStack Query contra el API NestJS.
interface Store {
  declaraciones: Declaracion[];
  setDeclaraciones: (fn: (d: Declaracion[]) => Declaracion[]) => void;
  paradasAtendidas: Record<string, { peso: number; hora: string }>;
  marcarParada: (id: string, peso: number) => void;
  paradaSel: string;
  setParadaSel: (id: string) => void;
  preopHoyAprobado: boolean;
  setPreopHoyAprobado: (v: boolean) => void;
}
const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [declaraciones, setD] = useState<Declaracion[]>(DECLARACIONES);
  const [paradasAtendidas, setP] = useState<Store['paradasAtendidas']>({});
  const [preopHoyAprobado, setPreopHoyAprobado] = useState(false);
  const [paradaSel, setParadaSel] = useState('s5124');
  return (
    <Ctx.Provider value={{
      declaraciones, setDeclaraciones: (fn) => setD(fn),
      paradasAtendidas,
      marcarParada: (id, peso) => setP((s) => ({ ...s, [id]: { peso, hora: new Date().toTimeString().slice(0, 5) } })),
      preopHoyAprobado, setPreopHoyAprobado, paradaSel, setParadaSel,
    }}>{children}</Ctx.Provider>
  );
}
export const useStore = () => useContext(Ctx)!;
