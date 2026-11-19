import { AppShell } from './components/AppShell';
import { Proteccion } from './components/Proteccion';
import { ToastProvider } from './components/ui';
import { RouterProvider, useRouter } from './lib/router';
import { StoreProvider } from './lib/store';
import { MODO_REAL, useSesion } from './lib/api';
import AceptarDatos from './pages/AceptarDatos';
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
import { CampoEnviosServidor, CampoInspeccionServidor, CampoManifiestoServidor, CampoRutaServidor } from './pages/CampoServidor';
import { ProgramacionServidor, ProgramacionTablaServidor, SeguimientoServidor } from './pages/torre/Programacion';
import { ManifiestosServidor } from './pages/torre/Manifiestos';
import { ConciliacionServidor } from './pages/torre/Conciliacion';
import { ActasServidor } from './pages/torre/Actas';
import { SolicitudesServidor } from './pages/torre/Solicitudes';
import { RecepcionPlantaServidor } from './pages/torre/Recepcion';
import { EmpresaServidor } from './pages/torre/Empresa';
import { ClientesServidor } from './pages/ClientesServidor';
import { TarifasServidor } from './pages/TarifasServidor';
import { PermisosServidor } from './pages/PermisosServidor';
import { FlotaServidor, InspeccionesServidor } from './pages/FlotaServidor';
import { UsuariosServidor } from './pages/UsuariosServidor';
import { IndicadoresServidor, InicioServidor } from './pages/IndicadoresServidor';
import { CatalogosServidor, InventarioServidor } from './pages/CatalogosServidor';
import Verificar from './pages/Verificar';
import { PortalApp } from './pages/portal/PortalApp';
import { useEffect } from 'react';
import type { RouteName } from './lib/router';

/** Cambia de ruta sin dejar la anterior en el historial. */
function IrA({ ruta }: { ruta: RouteName }) {
  useEffect(() => { location.replace(`#${ruta}`); }, [ruta]);
  return null;
}

function Screen() {
  const { route } = useRouter();
  const sesion = useSesion();
  switch (route) {
    case 'login': return <Login />;
    case 'recuperar': return <Recuperar />;
    case 'restablecer': return <Restablecer />;
    case 'verificar': return <Verificar />; // pública: código QR de los certificados (sin sesión)
  }
  // En modo servidor, sin sesión se vuelve al ingreso.
  if (MODO_REAL && !sesion) return <Login />;
  // Ley 1581: antes de usar el sistema (oficina o app del conductor) se acepta la política de datos personales
  if (MODO_REAL && sesion?.usuario.requiereAceptarDatos) return <AceptarDatos />;
  // Portal de clientes: el usuario de un cliente solo ve su portal (cualquier otra ruta lo lleva al inicio del portal),
  // y el personal de Terra Viva no entra al portal. El servidor lo exige igual: esto solo evita pantallas vacías.
  if (MODO_REAL && sesion?.usuario.cliente) return <PortalApp />;
  if (route.startsWith('portal')) return <IrA ruta="inicio" />;
  switch (route) {
    // App del conductor: conectada al API (con cola sin señal) o de demostración
    case 'campo': return MODO_REAL ? <CampoRutaServidor /> : <CampoHoy />;
    case 'campo-preop': return MODO_REAL ? <CampoInspeccionServidor /> : <CampoPreop />;
    case 'campo-parada': return MODO_REAL ? <CampoManifiestoServidor /> : <CampoParada />;
    case 'campo-envios': return MODO_REAL ? <CampoEnviosServidor /> : <CampoHoy />;
  }
  const page = (() => {
    switch (route) {
      case 'inicio': return MODO_REAL ? <InicioServidor /> : <Inicio />;
      case 'clientes': return MODO_REAL ? <ClientesServidor /> : <Clientes />;
      case 'declaraciones': return MODO_REAL ? <DeclaracionesServidor /> : <Declaraciones />;
      case 'tarifas': return MODO_REAL ? <TarifasServidor /> : <Precios />;
      case 'exportar': return <Exportable />;
      case 'solicitudes': return MODO_REAL ? <SolicitudesServidor key="todas" /> : <Solicitudes />;
      case 'por-confirmar': return MODO_REAL ? <SolicitudesServidor key="por-confirmar" porConfirmar /> : <PorConfirmar />; // key: cada vista con sus filtros
      case 'programacion': return MODO_REAL ? <ProgramacionServidor /> : <Programacion />;
      case 'programacion-tabla': return MODO_REAL ? <ProgramacionTablaServidor /> : <ProgramacionTabla />;
      case 'seguimiento': return MODO_REAL ? <SeguimientoServidor /> : <Seguimiento />;
      case 'inspecciones': return MODO_REAL ? <InspeccionesServidor /> : <Inspecciones />;
      case 'manifiestos': return MODO_REAL ? <ManifiestosServidor /> : <Manifiestos />;
      case 'recepcion': return MODO_REAL ? <ConciliacionServidor /> : <Recepcion />;
      case 'descargues': return MODO_REAL ? <RecepcionPlantaServidor /> : <Recepcion />;
      case 'inventario': return MODO_REAL ? <InventarioServidor /> : <Inventario />;
      case 'certificados': return MODO_REAL ? <ActasServidor /> : <Certificados />;
      case 'permisos': return MODO_REAL ? <PermisosServidor /> : <Permisos />;
      case 'indicadores': return MODO_REAL ? <IndicadoresServidor /> : <Indicadores />;
      case 'informes': return <Informes />;
      case 'ajustes': return <ConfigIndex />;
      case 'importar': return <Cargues />;
      case 'empresa': return MODO_REAL ? <EmpresaServidor /> : <MisDatos />;
      case 'vehiculos': return MODO_REAL ? <FlotaServidor /> : <Vehiculos />;
      case 'usuarios': return MODO_REAL ? <UsuariosServidor /> : <Usuarios />;
      case 'catalogos': return MODO_REAL ? <CatalogosServidor /> : <Catalogos />;
      case 'etapas': return MODO_REAL ? <CatalogosServidor inicial="etapas" /> : <Etapas />;
    }
  })();
  return <AppShell><Proteccion key={route}>{page}</Proteccion></AppShell>;
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
