/**
 * Mesa de ayuda por rol (gerencia, 20-11-2026): «que la app se explique sola y reduzca las llamadas con dudas operativas».
 * Cada módulo ve su ayuda: el conductor, preguntas frecuentes y paso a paso del manifiesto y de las novedades; la oficina,
 * guías por pantalla; el cliente, cómo usar su portal. Cada guía dice en qué pantallas aparece con el botón «?».
 */
export type AccesoAyuda = 'CAMPO' | 'OFICINA' | 'CLIENTE';
export interface Guia { id: string; titulo: string; resumen: string; pasos: string[]; rutas: string[] }
export interface Pregunta { pregunta: string; respuesta: string }
export interface Ayuda { guias: Guia[]; preguntas: Pregunta[] }

export const AYUDA: Record<AccesoAyuda, Ayuda> = {
  CAMPO: {
    guias: [
      { id: 'campo-dia', titulo: 'Empezar el día', resumen: 'De la planta a la primera parada.', rutas: ['campo'], pasos: [
        'Con señal (en planta), abra «Mi ruta» y toque «Actualizar»: la ruta del día queda guardada en el teléfono.',
        'Haga la inspección del vehículo. Sin la inspección aprobada, la ruta no sale.',
        'Toque «Abrir los manifiestos de la ruta» si aún no están abiertos.',
        'Cambie la etapa a «En camino» y escriba el kilometraje del tablero.',
        'En cada parada toque «Atender» y siga los pasos del manifiesto.',
        'Al volver a la planta, cambie a la etapa final con el kilometraje.',
      ] },
      { id: 'campo-inspeccion', titulo: 'Inspección del vehículo', resumen: 'Antes de salir, todos los días.', rutas: ['campo-preop'], pasos: [
        'Marque cada elemento: «Bien», «Falla» o «No aplica».',
        'Si algo falla, tómele una foto con el botón de la cámara.',
        'Los elementos marcados como «Crítico» impiden la salida si fallan: avise al coordinador.',
        'Escriba el kilometraje, firme con el dedo y toque «Enviar inspección».',
      ] },
      { id: 'campo-manifiesto', titulo: 'Diligenciar el manifiesto', resumen: 'Cinco pasos cortos en cada parada.', rutas: ['campo-parada'], pasos: [
        'Llegada: toque «Llegué: marcar la hora». Ahí ve la dirección, el horario, las indicaciones y a quién llamar.',
        'Residuos: anote la cantidad REAL de cada residuo. Lo que estimó el cliente es solo una guía. Cuente los embalajes con + y −.',
        'Báscula y fotos: si pesa en la sede, anote los pesos. La foto de la báscula o de la carga sirve de respaldo.',
        'Firma: firma quien entrega en el cliente, con su nombre y cédula. Si es otra persona que la de la última vez, toque «Es otra persona».',
        'Resumen: revise, marque la hora de salida y toque «Grabar manifiesto». Después imprima la copia para el cliente.',
      ] },
      { id: 'campo-imprimir', titulo: 'Imprimir el manifiesto en sitio', resumen: 'También sin señal.', rutas: ['campo-parada', 'campo'], pasos: [
        'Al grabar, toque «Imprimir tiquete (80 mm)» para la impresora portátil, o «Imprimir en carta».',
        'El teléfono abre su diálogo de impresión: elija la impresora portátil. Debe tener instalada la aplicación o servicio de impresión de esa impresora.',
        'Si necesita otra copia, en «Mi ruta» toque «Imprimir» en la parada atendida.',
        'El manifiesto oficial (PDF) queda en el portal del cliente con el mismo número.',
      ] },
      { id: 'campo-novedad', titulo: 'Reportar una novedad', resumen: 'No había residuo o no le atendieron: un toque, sin castigo.', rutas: ['campo-parada'], pasos: [
        'Si un residuo no estaba, en el paso «Residuos» toque «No había este residuo / no se recogió».',
        'Si no le atendieron (cerrado, sin autorización…), en el paso «Llegada» toque «No me atendieron».',
        'Elija la causal de la lista o escriba qué pasó y toque «Reportar».',
        'Queda escrito en el manifiesto y el coordinador recibe el aviso. Reportar lo real siempre es lo correcto.',
      ] },
      { id: 'campo-tiempos', titulo: 'Registrar un tiempo muerto o una tarea', resumen: 'Trancón, espera en portería, compra de insumos…', rutas: ['campo-bitacora'], pasos: [
        'Abra la pestaña «Tiempos» y toque lo que está pasando: empieza a contar.',
        'Cuando termine, toque «Terminar». Si quiere, agregue una nota, el gasto (si compró algo) y una foto.',
        'Funciona sin señal: se envía solo. Si se equivocó, el coordinador lo corrige.',
      ] },
      { id: 'campo-senal', titulo: 'Trabajar sin señal', resumen: 'Todo se guarda en el teléfono.', rutas: ['campo-envios', 'campo'], pasos: [
        'Inspecciones, manifiestos, fotos, novedades y tiempos se guardan en el teléfono y se envían solos al volver la señal.',
        'Arriba a la derecha ve cuántos envíos hay pendientes; en «Envíos» está el detalle.',
        'Si algo sale «con error», toque «Reintentar». Si sigue, avise al coordinador antes de descartarlo.',
        'No cierre sesión ni borre la aplicación mientras haya envíos pendientes.',
      ] },
      { id: 'campo-vehiculo', titulo: 'Mi vehículo', resumen: 'Solo para consultar.', rutas: ['campo-vehiculo'], pasos: [
        'Vea los vencimientos del SOAT, la técnico-mecánica y la póliza, y las últimas inspecciones con sus fallas.',
        'Si algo está vencido o por vencer, avise al coordinador. Las fallas se reportan en la inspección.',
      ] },
    ],
    preguntas: [
      { pregunta: '¿Por qué no puedo salir a ruta?', respuesta: 'Falta la inspección aprobada del vehículo, o la inspección tiene una falla crítica. Hágala o avise al coordinador.' },
      { pregunta: 'El cliente entregó más o menos de lo que pidió. ¿Qué anoto?', respuesta: 'Lo real. Si la diferencia es grande, la app le pide confirmarla, pero no lo bloquea: grábelo así.' },
      { pregunta: 'El cliente tiene un residuo que no está en mi ruta.', respuesta: 'No lo cargue sin autorización: llame al coordinador. Solo se recoge lo declarado y autorizado.' },
      { pregunta: '¿Puedo corregir un manifiesto que ya grabé?', respuesta: 'No: grabado ya no cambia. Avise al coordinador; si hay un error, la oficina lo anula con su motivo y se hace otro.' },
      { pregunta: '¿Quién firma el manifiesto?', respuesta: 'La persona del cliente que entrega el residuo, con su nombre y cédula. La app le propone a quien firmó la última vez en esa sede.' },
      { pregunta: '¿Por qué no veo precios ni otros clientes?', respuesta: 'La app de campo solo trae su ruta del día. Precios e historial de clientes son de la oficina, por política de Terra Viva.' },
      { pregunta: '¿Por qué una parada tiene dos manifiestos?', respuesta: 'Porque lleva residuos peligrosos: Los Pinos no los recibe, así que van en su propio manifiesto directo al gestor aliado. Atienda, haga firmar e imprima cada uno.' },
      { pregunta: 'Dice «Sin manifiesto todavía». ¿Qué hago?', respuesta: 'Es un residuo peligroso que puede ir a más de un gestor aliado: lo elige la oficina, que ya recibió el aviso. Toque «Actualizar» en unos minutos; si no aparece, llame a su coordinador. No lo cargue sin manifiesto.' },
      { pregunta: 'Se me descargó el celular.', respuesta: 'Lo que ya guardó sigue en el teléfono. Al cargarlo y tener señal, se envía solo.' },
      { pregunta: 'Voy a cambiar de celular.', respuesta: 'Antes, revise en «Envíos» que no quede nada pendiente. Después entre con su correo y contraseña en el nuevo.' },
    ],
  },
  OFICINA: {
    guias: [
      { id: 'of-cliente', titulo: 'Crear un cliente y darle acceso al portal', resumen: 'Comercial o el Jefe de Operaciones.', rutas: ['clientes'], pasos: [
        'En Clientes, toque «Nuevo cliente»: NIT sin dígito de verificación, razón social, representante legal, negociación y forma de pago.',
        'Agregue sus sedes: dirección, municipio, ubicación y contacto. La principal es una sola.',
        'En la ficha del cliente, «Acceso al portal»: escriba el correo de la persona y su rol del portal.',
        'Le llega un enlace para poner su propia contraseña. Nadie de Terra Viva conoce la clave del cliente.',
      ] },
      { id: 'of-declaraciones', titulo: 'Revisar y autorizar declaraciones', resumen: 'HSEQ, contra las licencias vigentes.', rutas: ['declaraciones'], pasos: [
        'Filtre las «Pendientes». Revise la ficha de seguridad, las corrientes, la peligrosidad y el tratamiento.',
        'Solo se autoriza lo que cubre un permiso o una licencia vigente: el sistema lo avisa.',
        'Autorice o rechace con el motivo. Un cambio crítico de una declaración autorizada lo aprueba otra persona.',
      ] },
      { id: 'of-solicitudes', titulo: 'Aprobar solicitudes', resumen: 'Recolecciones y entregas en planta.', rutas: ['solicitudes', 'por-confirmar'], pasos: [
        'En «Por confirmar» llegan los pedidos del portal y los que genera la frecuencia.',
        'Las recolecciones con transporte de Terra Viva las aprueba el Líder de Operaciones.',
        'Las entregas en planta (el cliente trae el residuo) las autoriza el Jefe de Planta.',
        'Una recolección aprobada queda lista para programar en una ruta.',
      ] },
      { id: 'of-programar', titulo: 'Programar una ruta', resumen: 'Líneas aprobadas, vehículo y tripulación.', rutas: ['programacion', 'programacion-tabla', 'seguimiento'], pasos: [
        'En Programación elija las líneas aprobadas que van juntas: una parada por sede.',
        'Asigne vehículo, conductor y auxiliar. Sin inspección aprobada del vehículo, la ruta no sale.',
        'En Seguimiento vea las etapas que marca la app del conductor y las novedades que reporta.',
      ] },
      { id: 'of-planta', titulo: 'Recibir en planta (manifiesto de entrada)', resumen: 'Jefe de Planta.', rutas: ['descargues', 'manifiestos'], pasos: [
        'Con la entrega en planta autorizada, registre la llegada del vehículo del cliente, con su conductor, ARL y EPS.',
        'Pese en la báscula: entrada (lleno) y salida (vacío).',
        'Firman quien recibe por Terra Viva y quien entrega. Sale el recibo de 80 mm y el manifiesto con el mismo número.',
      ] },
      { id: 'of-conciliar', titulo: 'Conciliar', resumen: 'Lo pedido, lo cargado y lo recibido.', rutas: ['recepcion'], pasos: [
        'Cada línea muestra lo que pidió el cliente, lo que se cargó y lo recibido en planta. «No solicitado» marca lo que no venía en la solicitud.',
        'Escriba lo recibido (báscula de planta). Toda diferencia con lo cargado pide su justificación.',
        'Si hay diferencias, la aprueba otra persona distinta a quien concilió. Lo aprobado es lo que se certifica y se factura.',
      ] },
      { id: 'of-facturar', titulo: 'Facturar y liberar el acta', resumen: 'Sin factura no hay acta.', rutas: ['facturacion', 'certificados', 'manifiestos'], pasos: [
        'Facturación toma los manifiestos conciliados y los factura en Siigo. Cada manifiesto muestra «Facturado» o «No facturado».',
        'El acta de disposición final solo se emite cuando sus manifiestos están facturados (regla de Terra Viva).',
        'Una excepción (retener solo con facturas vencidas, o libre) la dan Facturación o Gerencia en la ficha del cliente, con su motivo.',
      ] },
      { id: 'of-bitacora', titulo: 'Bitácora de tiempos', resumen: 'En qué se va el tiempo de la operación.', rutas: ['bitacora'], pasos: [
        'Vea los tiempos muertos y las tareas por tipo, persona, vehículo y ruta, con el porcentaje de tiempo muerto de cada ruta.',
        'Corrija un registro o registre el de alguien que lo reportó por radio. Queda quién lo hizo.',
        'Ajuste la lista de tipos con «Tipos» (agregar o inactivar).',
      ] },
      { id: 'of-roles', titulo: 'Usuarios, roles y permisos', resumen: 'Quién puede hacer qué.', rutas: ['usuarios', 'roles'], pasos: [
        'Cada rol tiene un solo acceso: empresa (oficina), campo (celular) o portal de clientes.',
        'Marque las funciones de cada rol; «Restaurar predeterminadas» vuelve a las de fábrica.',
        'Invite a cada persona con su correo y su rol. Ella pone su contraseña con el enlace.',
      ] },
      { id: 'of-cargues', titulo: 'Cargar desde Excel', resumen: 'Clientes, sedes, declaraciones y más.', rutas: ['importar'], pasos: [
        'Descargue la plantilla del tipo de datos, llénela y súbala.',
        'Revise la vista previa: las filas con error no se cargan y el resto sí.',
        'Cada plantilla pide la función de lo que crea (por ejemplo, los clientes solo los cargan quienes los crean).',
      ] },
    ],
    preguntas: [
      { pregunta: '¿Por qué no puedo aprobar esta solicitud?', respuesta: 'Las recolecciones las aprueba el Líder de Operaciones y las entregas en planta, el Jefe de Planta. Revise las funciones de su rol.' },
      { pregunta: '¿Por qué no se emite el acta?', respuesta: 'Sus manifiestos no están facturados (regla de Terra Viva). Facturación o Gerencia pueden dar una excepción con su motivo.' },
      { pregunta: '¿Por qué no puedo aprobar esta conciliación?', respuesta: 'Tiene diferencias y usted la concilió: la aprueba otra persona (cuatro ojos).' },
      { pregunta: 'Al abrir los manifiestos de una ruta me pide elegir un gestor aliado.', respuesta: 'La ruta lleva un residuo peligroso que reciben varios gestores aliados vigentes. Los Pinos no recibe peligrosos (Res. DGL 000632 de 2023, art. 6): cada uno sale en su propio manifiesto, directo al gestor que usted elija. Si solo uno lo recibe, se elige solo; si ninguno, revise sus licencias en Permisos › Gestores aliados.' },
      { pregunta: 'Un conductor dice que no ve un cliente o sus precios.', respuesta: 'Es a propósito: la app de campo solo trae la ruta del día, sin precios ni historial de clientes.' },
    ],
  },
  CLIENTE: {
    guias: [
      { id: 'cl-declarar', titulo: 'Declarar sus residuos', resumen: 'Antes de pedir una recolección.', rutas: ['portal-declaraciones'], pasos: [
        'En «Declaraciones», toque «Declarar» y llene el formulario, o cargue varias con Excel.',
        'Adjunte la ficha de seguridad si el residuo es peligroso.',
        'Terra Viva la revisa contra sus licencias. Cuando queda autorizada, ya puede pedir su recolección.',
      ] },
      { id: 'cl-pedir', titulo: 'Pedir una recolección', resumen: 'Terra Viva va por el residuo.', rutas: ['portal-solicitudes', 'portal'], pasos: [
        'En «Solicitudes», toque «Pedir recolección». Elija las sedes y los residuos autorizados, con la cantidad aproximada.',
        'Mientras Terra Viva no la confirme, la puede corregir o cancelar.',
        'Cuando se programa, ve la fecha; después de la recolección, el manifiesto.',
      ] },
      { id: 'cl-entregar', titulo: 'Llevar residuos a la planta', resumen: 'Entrega en planta con su propio vehículo.', rutas: ['portal-solicitudes'], pasos: [
        'Toque «Entrega en planta» y elija la fecha, los residuos y el vehículo con su conductor, ARL y EPS.',
        'El Jefe de Planta la autoriza. Llegue con los documentos del conductor.',
        'En planta se pesa y firman quien entrega y quien recibe.',
      ] },
      { id: 'cl-documentos', titulo: 'Descargar manifiestos y certificados', resumen: 'Sus documentos, siempre a la mano.', rutas: ['portal-manifiestos', 'portal-certificados'], pasos: [
        'En «Manifiestos» está cada recolección o entrega, con su PDF.',
        'En «Certificados», las actas de disposición final.',
        'El acta se libera cuando el servicio está facturado.',
      ] },
      { id: 'cl-usuarios', titulo: 'Agregar personas de su empresa', resumen: 'Para el administrador del portal.', rutas: ['portal-usuarios'], pasos: [
        'En «Usuarios», invite a la persona con su correo, su rol y las sedes que puede ver.',
        'Le llega un enlace para poner su contraseña.',
      ] },
    ],
    preguntas: [
      { pregunta: '¿Por qué mi declaración sigue pendiente?', respuesta: 'Terra Viva la revisa contra sus licencias ambientales. Si falta algo (por ejemplo, la ficha de seguridad), se lo indicamos.' },
      { pregunta: '¿Por qué no puedo descargar un certificado?', respuesta: 'El acta se libera cuando el servicio está facturado. Si ya pagó, escríbanos.' },
      { pregunta: '¿Cómo cambio una solicitud?', respuesta: 'Mientras Terra Viva no la confirme, la puede corregir o cancelar. Después, escríbanos.' },
      { pregunta: 'Olvidé mi contraseña.', respuesta: 'En el ingreso, toque «Olvidé mi contraseña» y siga el enlace que le llega al correo.' },
    ],
  },
};

/** Las guías que tocan a una pantalla (botón «?»): primero las de esa pantalla. */
export const guiasDe = (acceso: AccesoAyuda, ruta: string): Guia[] => AYUDA[acceso].guias.filter((g) => g.rutas.includes(ruta));
