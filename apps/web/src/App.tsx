import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ui';
import { RouterProvider, useRouter } from './lib/router';
import { StoreProvider } from './lib/store';
import { Login, Recuperar } from './pages/Auth';
import Inicio from './pages/Inicio';
import Declaraciones from './pages/Declaraciones';
import Precios from './pages/Precios';
import Cargues from './pages/Cargues';
import { EstadosRecorrido, InformeRutas, PreSolicitudes, Rastreo, Rutas, Solicitudes } from './pages/Logistica';
import { Actas, Chequeo, Conciliaciones, Inventario, Manifiestos } from './pages/Operacion';
import Indicadores, { Exportable, Informes } from './pages/Informes';
import { Catalogos, Clientes, ConfigIndex, MisDatos, Permisos, Usuarios, Vehiculos } from './pages/Configuracion';
import { CampoHoy, CampoParada, CampoPreop } from './pages/Campo';

function Screen() {
  const { route } = useRouter();
  switch (route) {
    case 'login': return <Login />;
    case 'recuperar': return <Recuperar />;
    case 'campo': return <CampoHoy />;
    case 'campo-preop': return <CampoPreop />;
    case 'campo-parada': return <CampoParada />;
  }
  const page = (() => {
    switch (route) {
      case 'inicio': return <Inicio />;
      case 'declaraciones': return <Declaraciones />;
      case 'precios': return <Precios />;
      case 'cargues': return <Cargues />;
      case 'exportable': return <Exportable />;
      case 'solicitudes': return <Solicitudes />;
      case 'pre-solicitudes': return <PreSolicitudes />;
      case 'rutas': return <Rutas />;
      case 'rastreo': return <Rastreo />;
      case 'informe-rutas': return <InformeRutas />;
      case 'estados-recorrido': return <EstadosRecorrido />;
      case 'chequeo': return <Chequeo />;
      case 'manifiestos': return <Manifiestos />;
      case 'conciliaciones': return <Conciliaciones />;
      case 'actas': return <Actas />;
      case 'inventario': return <Inventario />;
      case 'informes': return <Informes />;
      case 'indicadores': return <Indicadores />;
      case 'configuracion': return <ConfigIndex />;
      case 'config-datos': return <MisDatos />;
      case 'config-permisos': return <Permisos />;
      case 'config-clientes': return <Clientes />;
      case 'config-vehiculos': return <Vehiculos />;
      case 'config-usuarios': return <Usuarios />;
      case 'config-catalogos': return <Catalogos />;
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
