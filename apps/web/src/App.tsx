import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ui';
import { RouterProvider, useRouter } from './lib/router';
import { StoreProvider } from './lib/store';
import { MODO_REAL, sesionActual } from './lib/api';
import { Login, Recuperar, Restablecer } from './pages/Auth';
import Inicio from './pages/Inicio';
import Declaraciones from './pages/Declaraciones';
import DeclaracionesServidor from './pages/DeclaracionesServidor';
import Precios from './pages/Precios';
import Cargues from './pages/Cargues';
import { Etapas, PorConfirmar, Programacion, ProgramacionTabla, Seguimiento, Solicitudes } from './pages/Logistica';
import { Certificados, Inspecciones, Inventario, Manifiestos, Recepcion } from './pages/Operacion';
import Indicadores, { Exportable, Informes } from './pages/Informes';
import { Catalogos, Clientes, ConfigIndex, MisDatos, Permisos, Usuarios, Vehiculos } from './pages/Configuracion';
import { CampoHoy, CampoParada, CampoPreop } from './pages/Campo';

function Screen() {
  const { route } = useRouter();
  switch (route) {
    case 'login': return <Login />;
    case 'recuperar': return <Recuperar />;
    case 'restablecer': return <Restablecer />;
  }
  // En modo servidor, sin sesión se vuelve al ingreso.
  if (MODO_REAL && !sesionActual()) return <Login />;
  switch (route) {
    case 'campo': return <CampoHoy />;
    case 'campo-preop': return <CampoPreop />;
    case 'campo-parada': return <CampoParada />;
  }
  const page = (() => {
    switch (route) {
      case 'inicio': return <Inicio />;
      case 'clientes': return <Clientes />;
      case 'declaraciones': return MODO_REAL ? <DeclaracionesServidor /> : <Declaraciones />;
      case 'tarifas': return <Precios />;
      case 'exportar': return <Exportable />;
      case 'solicitudes': return <Solicitudes />;
      case 'por-confirmar': return <PorConfirmar />;
      case 'programacion': return <Programacion />;
      case 'programacion-tabla': return <ProgramacionTabla />;
      case 'seguimiento': return <Seguimiento />;
      case 'inspecciones': return <Inspecciones />;
      case 'manifiestos': return <Manifiestos />;
      case 'recepcion': return <Recepcion />;
      case 'inventario': return <Inventario />;
      case 'certificados': return <Certificados />;
      case 'permisos': return <Permisos />;
      case 'indicadores': return <Indicadores />;
      case 'informes': return <Informes />;
      case 'ajustes': return <ConfigIndex />;
      case 'importar': return <Cargues />;
      case 'empresa': return <MisDatos />;
      case 'vehiculos': return <Vehiculos />;
      case 'usuarios': return <Usuarios />;
      case 'catalogos': return <Catalogos />;
      case 'etapas': return <Etapas />;
    }
  })();
  return <AppShell>{page}</AppShell>;
}

export default function App() {
  return (
    <RouterProvider>
      <StoreProvider>
        <ToastProvider>
          <Screen />
        </ToastProvider>
      </StoreProvider>
    </RouterProvider>
  );
}
