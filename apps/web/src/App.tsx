import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/ui';
import { RouterProvider, useRouter } from './lib/router';
import { StoreProvider } from './lib/store';
import { Login, Recuperar } from './pages/Auth';
import Inicio from './pages/Inicio';
import Declaraciones from './pages/Declaraciones';
import Precios from './pages/Precios';
import { Rutas, Solicitudes } from './pages/Logistica';
import { Actas, Manifiestos, Preoperacionales } from './pages/Operacion';
import Informes from './pages/Informes';
import { Catalogos, Clientes, Permisos, Usuarios, Vehiculos } from './pages/Configuracion';
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
      case 'decl-residuos': return <Declaraciones key="r" tipo="RESIDUO" />;
      case 'decl-servicios': return <Declaraciones key="s" tipo="SERVICIO" />;
      case 'precios': return <Precios />;
      case 'solicitudes': return <Solicitudes />;
      case 'rutas': return <Rutas />;
      case 'preoperacionales': return <Preoperacionales />;
      case 'manifiestos': return <Manifiestos />;
      case 'actas': return <Actas />;
      case 'informes': return <Informes />;
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
