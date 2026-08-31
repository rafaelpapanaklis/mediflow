/**
 * DaleControl INSTITUCIONAL — permisos por rol. Módulo PURO y client-safe
 * (sin prisma, sin "server-only"): lo usan el sidebar (visibilidad de
 * items), las páginas y las APIs (vía assertEduPermission).
 *
 * Mismo mecanismo que src/lib/auth/permissions.ts (dental) y
 * src/lib/barber/permissions.ts (barbería). Las olas que siguen NO inventan
 * su propio check: usan hasEduPermission / assertEduPermission. Punto único.
 *
 * REGLA DEL OVERRIDE (idéntica a User.permissionsOverride del dental): si
 * permissionsOverride trae keys, esas REEMPLAZAN al default del rol — no se
 * suman. Consecuencia que muerde en producción: un permiso NUEVO agregado
 * al default de un rol NO le llega a quien ya tiene override; hay que
 * agregárselo también a su override (por eso cada .sql de una ola que
 * añade keys trae su backfill).
 */
import type { EduRole } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * REGLA DEL CATÁLOGO — léela antes de agregar una key.
 *
 * Cada key de EDU_ALL_PERMISSIONS la tiene que EXIGIR de verdad una
 * pantalla o un endpoint que ya exista. Un interruptor que se guarda y no
 * cambia nada es peor que no tenerlo: la dirección del instituto cree que
 * cerró algo y no cerró nada.
 *
 * Por eso cada ola agrega SUS keys, en el mismo commit que la pantalla que
 * las lee — no las adelanta. La Ola 0 arrancó con UNA sola key real,
 * "inicio.view", porque había UNA sola pantalla. La Ola 1A agrega cuatro
 * y las cuatro tienen dueño: padron.view lo exige /instituto/padron,
 * padron.manage lo exigen /instituto/padron/estructura y TODA mutación del
 * padrón, docentes.view lo exige /instituto/docentes y supervision.assign
 * lo exigen los endpoints de /api/instituto/supervision.
 *
 * El candado no es la buena voluntad: la prueba de
 * __tests__/edu-permissions.test.ts recorre src/app/instituto,
 * src/components/edu y src/lib/edu y falla si una key del catálogo se queda
 * sin lector.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_ALL_PERMISSIONS = {
  "inicio.view": "Entrar al panel del instituto",
  "padron.view": "Ver el padrón de alumnos",
  "padron.manage": "Dar de alta y de baja alumnos, especialidades y generaciones",
  "docentes.view": "Ver la lista de docentes",
  "supervision.assign": "Asignar alumnos a un docente supervisor",
  // ── Ola 2 · el piso clínico ──────────────────────────────────────────
  // Cada una la EXIGE una pantalla y un endpoint que ya existen; la prueba
  // de __tests__/edu-permissions.test.ts falla si alguna se queda sin
  // lector de servidor.
  "pacientes.view": "Ver los pacientes de la clínica",
  "pacientes.manage": "Registrar y editar la ficha de un paciente",
  "pacientes.origen": "Marcar CUÁL alumno trajo al paciente",
  "agenda.view": "Ver la agenda de la clínica",
  "agenda.manage": "Agendar, reagendar y cancelar citas",
  "sillones.view": "Ver las unidades dentales y su horario",
  "sillones.manage": "Dar de alta sillones y capturar su horario",
  "casos.view": "Ver los casos clínicos",
  "casos.assign": "Asignar un paciente a un alumno y abrir su caso",
  // ── Ola 3 · el expediente clínico ────────────────────────────────────
  // Las seis las EXIGE una pantalla y un endpoint que ya existen (la
  // prueba de __tests__/edu-permissions.test.ts falla si alguna se queda
  // sin lector de SERVIDOR):
  //   expediente.view    → /instituto/pacientes/[id]/expediente + su GET
  //   expediente.write   → POST de notas y PATCH de estado (enviar/firmar)
  //   odontograma.view   → /instituto/pacientes/[id]/odontograma + su GET
  //   odontograma.edit   → PUT y PATCH del odontograma
  //   estudios.view      → /instituto/pacientes/[id]/estudios + su GET
  //   estudios.upload    → /sign y /confirm de la subida directa
  "expediente.view": "Leer las notas clínicas del expediente",
  "expediente.write": "Escribir, enviar y firmar notas clínicas",
  "odontograma.view": "Ver el odontograma del paciente",
  "odontograma.edit": "Marcar hallazgos en el odontograma",
  "estudios.view": "Ver las radiografías, tomografías y fotos del paciente",
  "estudios.upload": "Subir estudios al expediente del paciente",
  // ── Ola 5 · tarifarios y caja ────────────────────────────────────────
  // Seis keys, todas con dueño: tarifarios.view lo exigen /instituto/
  // tarifarios y /instituto/procedimientos, tarifarios.manage TODA
  // mutación del catálogo y de los precios, y las cuatro de caja las
  // exigen la pantalla de cobro y sus endpoints.
  //
  // 🔴 Ninguna se le da al DOCENTE ni al ALUMNO. Y no basta con no dárselas:
  // el dinero está cerrado DOS veces, aquí y en el ALCANCE
  // (src/lib/edu/visibility.ts, recurso "charges"), para que encenderle
  // "caja.view" a un alumno por error siga sin enseñarle un solo peso.
  "tarifarios.view": "Ver las listas de precios y el catálogo de procedimientos",
  "tarifarios.manage": "Crear listas de precios, capturar precios y editar el catálogo",
  "caja.view": "Ver los cobros y los pagos de la clínica",
  "caja.charge": "Cobrarle a un paciente y registrar sus pagos",
  "caja.refund": "Devolver dinero y cancelar un cobro",
  "caja.corte": "Abrir y cerrar el turno de caja",
  // ── Ola 1B · el equipo ───────────────────────────────────────────────
  // UNA sola key, y la exigen /instituto/equipo y los dos endpoints de
  // /api/instituto/equipo. Es la que faltaba para que el producto se
  // pudiera usar: hasta esta ola no había forma de crear un alumno, un
  // docente ni un cajero desde el panel — la única vía era SQL a mano.
  //
  // 🔴 No se parte en "equipo.view" + "equipo.manage": una pantalla que
  // LISTA las cuentas del instituto y no deja tocarlas no le sirve a nadie
  // más que a quien las administra, y dos interruptores para una pantalla
  // es cómo se llega a que uno de los dos no lo exija nadie.
  "equipo.manage": "Dar de alta cuentas del instituto y darlas de baja",
  // ── Ola 4 · el gate de autorización ──────────────────────────────────
  // Tres keys, y las tres tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   autorizaciones.request → POST /api/instituto/autorizaciones
  //   autorizaciones.view    → /instituto/autorizaciones + su GET
  //   autorizaciones.decide  → PATCH /api/instituto/autorizaciones/[id]
  //                            y POST /api/instituto/autorizaciones/lote
  //
  // 🔴 PEDIR Y FIRMAR SON DOS KEYS DISTINTAS, y ésa es toda la ola. Si
  // fueran una, el alumno que puede pedir podría firmarse a sí mismo y el
  // gate no gatearía nada. El DOCENTE no lleva "request" a propósito: quien
  // firma no pide.
  "autorizaciones.request": "Mandar un plan o un procedimiento a autorización",
  "autorizaciones.view": "Ver la bandeja de autorizaciones",
  "autorizaciones.decide": "Autorizar, pedir cambios o rechazar",
  // ── Ola 3B · IA de apoyo y consentimientos ───────────────────────────
  // Cuatro keys, todas con lector de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   estudios.analyze        → POST /api/instituto/estudios/[id]/analisis
  //   consentimientos.view    → /instituto/pacientes/[id]/consentimientos + su GET
  //   consentimientos.create  → POST de la carta y la contrafirma
  //   consentimientos.revoke  → POST .../revocar
  //
  // ⚠️ El DICTADO no trae key propia y no es un olvido: reusa
  // "expediente.write". Dictar es escribir la nota — el micrófono es una
  // forma de teclear, no un permiso aparte. Una key "dictado.use" habría
  // sido un interruptor que se puede apagar sin cerrar nada (quien lo
  // tenga apagado escribe la misma nota a mano), y el catálogo de este
  // vertical no admite interruptores que no cierren una puerta.
  "estudios.analyze": "Pedirle a la IA que analice una radiografía",
  "consentimientos.view": "Ver las cartas de consentimiento informado",
  "consentimientos.create": "Emitir una carta de consentimiento y contrafirmarla",
  "consentimientos.revoke": "Dejar constancia de que el paciente revocó su consentimiento",
  // ── Ola 6 · evaluación académica ─────────────────────────────────────
  // Cinco keys, y las cinco tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   rubricas.manage    → /instituto/rubricas y sus dos endpoints
  //   requisitos.manage  → /instituto/requisitos y sus dos endpoints
  //   evaluacion.view    → /instituto/evaluacion, la bitácora y su export
  //   evaluacion.grade   → POST /api/instituto/calificaciones
  //   traspaso.manage    → POST /api/instituto/traspasos y .../lote
  //
  // 🔴 VER Y CALIFICAR SON DOS KEYS DISTINTAS, y ésa es la línea de la
  // ola. El ALUMNO lleva "evaluacion.view" y NO lleva "evaluacion.grade":
  // ve su calificación, sus comentarios y lo que le falta, y no puede
  // tocarla. Si fueran una sola key, o el alumno no vería su propia
  // evaluación —que es justo lo que la hace servir para algo— o se la
  // podría escribir.
  "rubricas.manage": "Crear y editar las rúbricas de evaluación",
  "requisitos.manage": "Capturar los requisitos del plan de estudios",
  "evaluacion.view": "Ver el avance académico y las calificaciones",
  "evaluacion.grade": "Calificar un caso con una rúbrica",
  "traspaso.manage": "Traspasar los casos de un alumno a otro",
  // ── Ola 11 · las sedes ───────────────────────────────────────────────
  // DOS keys, y las dos tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   sedes.view   → /instituto/sedes + GET /api/instituto/sedes
  //   sedes.manage → POST /api/instituto/sedes, PATCH .../[id] y
  //                  POST .../[id]/acceso
  //
  // 🔴 NINGUNA DE LAS DOS HACE FALTA PARA *USAR* LAS SEDES. El selector de
  // la barra superior, el filtro de la agenda y el de caja NO piden
  // permiso: cambiar de sede es moverse entre lo que el ACCESO
  // (edu_user_campus_access) ya autoriza, y pedir un permiso para eso
  // dejaría a un docente del campus norte sin poder mirar su propia
  // agenda. Estas dos keys son para ADMINISTRAR las sedes: darlas de alta
  // y decidir quién entra a cada una.
  //
  // ⚠️ Y por eso tampoco son "el permiso de multi-sede": una escuela con
  // una sola sede nunca ve el selector (nadie elige entre una opción) y no
  // necesita tocar esta pantalla.
  "sedes.view": "Ver las sedes del instituto",
  "sedes.manage": "Dar de alta sedes y decidir quién entra a cada una",
  // ── Ola 7 · el panel de dirección ────────────────────────────────────
  // UNA sola key, y la exigen /instituto/direccion y los tres endpoints de
  // /api/instituto/direccion (la prueba de
  // __tests__/edu-permissions.test.ts falla si se queda sin lector de
  // servidor).
  //
  // 🔴 NO SE PARTE EN "view" + "export". Lo que se exporta es EXACTAMENTE
  // lo que se ve: un interruptor que dejara mirar el tablero y no
  // descargarlo no cerraría nada —quien lo ve puede teclearlo— y el
  // catálogo de este vertical no admite interruptores que no cierren una
  // puerta.
  //
  // 🔴 Y NO SE LE DA A NADIE MÁS QUE A DIRECCIÓN, ni siquiera al docente
  // que coordina. Este tablero cruza el dinero de la escuela con el avance
  // de cada alumno: es la foto completa del negocio y de las personas. Si
  // una escuela quiere que su coordinador la vea, se le enciende por
  // override desde la pantalla de permisos — a sabiendas y una por una.
  //
  // ⚠️ El permiso abre la pantalla; el ALCANCE la cierra otra vez. Con
  // esta key encendida sobre un DOCENTE, src/lib/edu/direccion.ts se niega
  // a pintar el tablero: sus cuatro recursos no devuelven "all" y un total
  // recortado presentado como el total de la clínica sería un dato falso.
  "direccion.panel": "Abrir el panel de dirección del instituto",
  // ── Ola 8 · la cartera de IA ─────────────────────────────────────────
  // DOS keys, y las dos tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   ia.view   → /instituto/ia + GET  /api/instituto/ia
  //   ia.manage → PATCH /api/instituto/ia
  //
  // 🔴 VER Y EDITAR SON DOS KEYS, y no es simetría decorativa: lo que
  // `ia.manage` toca es dinero que se gasta de una cuenta de API que no es
  // de la escuela. Quien consulta "¿en qué se nos fue el cupo?" no es
  // necesariamente quien puede autorizar gastar de más.
  //
  // ⚠️ Y hay una tercera cosa que NO es una key y por eso no está aquí: lo
  // que INCLUYE el contrato no se edita desde el panel con ningún permiso.
  // No existe interruptor que lo abra — ver src/lib/edu/ia-cupo.ts.
  //
  // ⚠️ Las funciones de IA en sí NO llevan key nueva: el dictado sigue
  // siendo `expediente.write` y el análisis `estudios.analyze`, los dos de
  // la Ola 3B. Tener cupo no es un permiso, es un contrato.
  "ia.view": "Ver el consumo de IA del instituto y su cupo",
  "ia.manage": "Encender o apagar la IA y autorizar gastar de más del cupo",
  // ── Ola 9 · WhatsApp y recordatorios ─────────────────────────────────
  // DOS keys, y las dos tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   whatsapp.view   → /instituto/whatsapp + GET /api/instituto/whatsapp
  //   whatsapp.manage → PATCH /api/instituto/whatsapp, la conexión y las
  //                     plantillas
  //
  // 🔴 ESTAS DOS KEYS SON DE LA CONFIGURACIÓN, NO DE MANDAR. Es la
  // distinción de la ola y se equivoca fácil: conectar la WhatsApp del
  // instituto —o apagar los recordatorios de toda la escuela— es un acto de
  // dirección, y por eso las dos son SOLO de DIRECCION. Pero MANDARLE un
  // documento a un paciente no lo es: caja manda el recibo en el mostrador y
  // el alumno manda la carta de consentimiento en el sillón. Si mandar
  // exigiera "whatsapp.manage", o nadie más que la dirección mandaría nada,
  // o habría que darle a caja la llave de la conexión entera.
  //
  // Por eso mandar se cierra con el permiso del DOCUMENTO —
  // "consentimientos.view" para la carta, "caja.view" para el recibo— más el
  // ALCANCE (src/lib/edu/visibility.ts), que para el dinero devuelve "none"
  // a docente y alumno pase lo que pase.
  "whatsapp.view": "Ver la conexión de WhatsApp del instituto y sus envíos",
  "whatsapp.manage": "Conectar WhatsApp, registrar plantillas y encender los avisos",
  // ── Ola 10 · facturación CFDI ────────────────────────────────────────
  // Cuatro keys, y las cuatro tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   facturacion.view   → /instituto/facturacion, su GET y las descargas
  //   facturacion.emit   → POST /api/instituto/facturacion (el timbrado)
  //   facturacion.cancel → POST /api/instituto/facturacion/[id]/cancelar
  //   facturacion.config → /instituto/facturacion/datos-fiscales y su PUT
  //
  // 🔴 EMITIR Y CANCELAR SON DOS KEYS DISTINTAS, y ésa es la línea de la
  // ola. Cancelar un CFDI timbrado ante el SAT no se deshace: es un
  // trámite fiscal con motivo, no un botón de deshacer. Quien cobra en el
  // mostrador emite todo el día; quien cancela responde por ello.
  //
  // 🔴 Y "facturacion.config" es aparte de las otras tres porque desde esa
  // pantalla se decide si el instituto timbra EN PRUEBAS o EN VIVO ante el
  // SAT. No es una preferencia: es la diferencia entre un papel que no
  // vale nada y un comprobante fiscal.
  //
  // ⚠️ Como en la Ola 5, el dinero está cerrado DOS veces: aquí y en el
  // ALCANCE (src/lib/edu/visibility.ts, recurso "charges"). Encenderle
  // "facturacion.view" a un alumno por error sigue sin enseñarle una sola
  // factura — src/lib/edu/facturacion.ts pasa por `requireDinero` incluso
  // en las lecturas.
  "facturacion.view": "Ver las facturas del instituto y descargar su XML y su PDF",
  "facturacion.emit": "Facturar un cobro (timbrar el CFDI)",
  "facturacion.cancel": "Cancelar una factura ante el SAT con su motivo",
  "facturacion.config": "Capturar los datos fiscales del instituto y decidir si timbra en pruebas o en vivo",
  // ── Ola 14 · recetas ─────────────────────────────────────────────────
  // Cuatro keys, y las cuatro tienen dueño de SERVIDOR (la prueba de
  // __tests__/edu-permissions.test.ts falla si alguna se queda sin él):
  //   recetas.view    → /instituto/pacientes/[id]/recetas, su GET y el PDF
  //   recetas.propose → POST de la receta, PATCH del borrador y .../enviar
  //   recetas.issue   → PATCH /api/instituto/autorizaciones/[id] cuando la
  //                     etapa es RECETA (además de autorizaciones.decide)
  //   recetas.void    → POST /api/instituto/recetas/[id]/anular
  //
  // 🔴 PROPONER Y EXPEDIR SON DOS KEYS DISTINTAS, y ésa es toda la ola: un
  // alumno de especialidad NO tiene cédula profesional, así que arma la
  // receta y la manda — y quien la EXPIDE (y cuya cédula sale impresa) es
  // el docente. Si fueran una sola key, el alumno se expediría a sí mismo
  // y el papel saldría sin nadie que responda por él.
  //
  // ⚠️ "recetas.issue" se exige ADEMÁS de "autorizaciones.decide" en el
  // mismo endpoint: decidir una receta no es solo autorizar un avance, es
  // poner tu cédula en un documento. Un docente al que la escuela le quite
  // "recetas.issue" por override sigue firmando planes y sesiones — y deja
  // de expedir recetas.
  "recetas.view": "Ver las recetas del paciente",
  "recetas.propose": "Armar una receta y mandarla a que el docente la expida",
  "recetas.issue": "Expedir una receta con su cédula profesional",
  "recetas.void": "Anular una receta expedida, con motivo",
} as const;

export type EduPermissionKey = keyof typeof EDU_ALL_PERMISSIONS;

export const EDU_ALL_PERMISSION_KEYS = Object.keys(
  EDU_ALL_PERMISSIONS,
) as EduPermissionKey[];

/**
 * Agrupación visual para la pantalla de permisos del instituto (la
 * construye la ola de Equipo). Cada key del catálogo va en EXACTAMENTE un
 * grupo: si se queda fuera, nadie puede encenderla ni apagarla y el
 * interruptor existe solo en la base de datos.
 */
export const EDU_PERMISSION_GROUPS: { title: string; keys: EduPermissionKey[] }[] = [
  { title: "Panel", keys: ["inicio.view"] },
  {
    title: "Padrón académico",
    keys: ["padron.view", "padron.manage", "docentes.view", "supervision.assign"],
  },
  {
    title: "Pacientes y casos",
    keys: ["pacientes.view", "pacientes.manage", "pacientes.origen", "casos.view", "casos.assign"],
  },
  {
    title: "Agenda y sillones",
    keys: ["agenda.view", "agenda.manage", "sillones.view", "sillones.manage"],
  },
  {
    // Grupo APARTE del de "Pacientes y casos" a propósito: son los seis
    // interruptores que la dirección va a querer apagarle a caja de un
    // vistazo. Mezclados con pacientes.view, apagar el expediente sin
    // apagar la recepción sería un ejercicio de leer catorce casillas.
    title: "Expediente clínico",
    keys: [
      "expediente.view",
      "expediente.write",
      "odontograma.view",
      "odontograma.edit",
      "estudios.view",
      "estudios.upload",
      // Ola 3B. Va en ESTE grupo y no en uno propio: quien apaga el
      // expediente quiere apagar también la IA que lo lee, y separarlas
      // sería una casilla más que buscar en otra pantalla.
      "estudios.analyze",
    ],
  },
  {
    // Ola 3B. Grupo APARTE del expediente a propósito: es el único bloque
    // del vertical donde CAJA tiene una casilla encendida y el resto
    // apagadas, y mezclarlo con el expediente —donde caja no tiene
    // ninguna— haría que "darle consentimientos a caja" pareciera
    // "darle el expediente a caja".
    title: "Consentimientos informados",
    keys: ["consentimientos.view", "consentimientos.create", "consentimientos.revoke"],
  },
  {
    title: "Tarifarios y caja",
    keys: [
      "tarifarios.view",
      "tarifarios.manage",
      "caja.view",
      "caja.charge",
      "caja.refund",
      "caja.corte",
    ],
  },
  {
    // Grupo propio, y de UNA sola key: crear cuentas no se parece a nada
    // de lo de arriba. Quien administra el equipo decide quién ENTRA al
    // instituto, no qué ve una vez dentro.
    title: "Equipo",
    keys: ["equipo.manage"],
  },
  {
    // Grupo PROPIO y no un renglón dentro de "Pacientes y casos": es la
    // separación de funciones de la escuela puesta en tres casillas, y la
    // dirección tiene que poder leerla de un vistazo. La que nunca se
    // tildan juntas es request + decide sobre la misma persona.
    title: "Autorizaciones",
    keys: ["autorizaciones.request", "autorizaciones.view", "autorizaciones.decide"],
  },
  {
    // Ola 9. Grupo PROPIO y de DOS casillas: es la única parte del panel
    // que gasta dinero de la escuela FUERA del panel. Meta le cobra cada
    // plantilla a la tarjeta de la WABA del instituto, así que quien tenga
    // "whatsapp.manage" puede encender un gasto recurrente — y eso no se
    // lee igual escondido dentro de "Administración".
    title: "WhatsApp",
    keys: ["whatsapp.view", "whatsapp.manage"],
  },
  {
    // Ola 6. Grupo PROPIO: es lo ACADÉMICO, que no se parece a lo clínico
    // ni a lo administrativo. Las cinco juntas para que la dirección pueda
    // leer de un vistazo la única separación que importa aquí — que
    // "evaluacion.view" la tienen los cuatro y "evaluacion.grade" no.
    title: "Evaluación académica",
    keys: [
      "rubricas.manage",
      "requisitos.manage",
      "evaluacion.view",
      "evaluacion.grade",
      "traspaso.manage",
    ],
  },
  {
    // Ola 11. Grupo PROPIO y de dos keys: dar de alta un campus y repartir
    // quién entra a cuál no se parece a nada de lo de arriba — es la
    // geografía de la escuela, no lo que se hace dentro. Va aparte de
    // "Equipo" (que decide quién ENTRA al instituto) porque esto decide
    // DÓNDE entra, y mezclarlas haría que "quitarle una sede a alguien"
    // pareciera "darlo de baja".
    title: "Sedes",
    keys: ["sedes.view", "sedes.manage"],
  },
  {
    // Ola 7. Grupo PROPIO y de una sola casilla, y va al final: es la única
    // del catálogo que no abre una parcela del producto sino la FOTO
    // COMPLETA —el dinero de la escuela cruzado con el avance de cada
    // alumno—. Metida dentro de "Evaluación académica" se tildaría de
    // pasada al darle el bloque a un coordinador, que es exactamente lo
    // que no debe ocurrir sin querer.
    title: "Dirección",
    keys: ["direccion.panel"],
  },
  {
    // Ola 8. Grupo PROPIO y no un renglón dentro de "Expediente clínico",
    // donde vive `estudios.analyze`. La diferencia es qué se abre con cada
    // casilla: `estudios.analyze` deja PEDIR una lectura, estas dos dejan
    // ver y decidir CUÁNTO DINERO se gasta en todas las lecturas del
    // instituto. Mezclarlas haría que "darle el expediente a alguien"
    // arrastrara "dejarle autorizar gasto", que es exactamente el error
    // que un grupo de permisos existe para evitar.
    title: "Consumo de IA",
    keys: ["ia.view", "ia.manage"],
  },
  {
    // Ola 10. Grupo APARTE del de "Tarifarios y caja" a propósito: cobrar
    // y facturar no son lo mismo y la escuela los reparte distinto. Caja
    // cobra y emite todo el día; cancelar un CFDI y decidir si el
    // instituto timbra ante el SAT son de dirección. Mezclarlos en el
    // grupo del dinero haría que apagarle a caja la cancelación fuera
    // buscar una casilla entre diez.
    title: "Facturación",
    keys: [
      "facturacion.view",
      "facturacion.emit",
      "facturacion.cancel",
      "facturacion.config",
    ],
  },
  {
    // Ola 14. Grupo PROPIO y no un renglón del expediente: es la única
    // parte del vertical donde un documento sale de la escuela con la
    // CÉDULA de alguien encima, y la dirección tiene que poder leer de un
    // vistazo la separación que importa — el alumno propone
    // (recetas.propose) y el docente expide (recetas.issue). CAJA no
    // tiene ninguna casilla: una receta es un documento clínico, no un
    // cobro.
    title: "Recetas",
    keys: ["recetas.view", "recetas.propose", "recetas.issue", "recetas.void"],
  },
];

/**
 * Defaults por rol. Los cuatro entran al panel: DIRECCION y CAJA porque
 * administran, DOCENTE y ALUMNO porque el panel se usa DE PIE en el piso
 * clínico y es su herramienta de trabajo.
 *
 * Lo que cada rol puede HACER dentro se irá diferenciando ola por ola
 * (autorizar es del docente, cobrar es de caja); mientras esa key no
 * exista, no se escribe aquí.
 *
 * ── Ola 1A · por qué el DOCENTE ve el padrón y no lo administra ─────────
 * El docente necesita la lista para saber a quién trae en el sillón y con
 * quién más la comparte, así que lleva "padron.view" y "docentes.view".
 * Pero lo que VE está recortado a sus alumnos vigentes — eso no lo decide
 * el permiso sino el ALCANCE (eduPadronScope, en padron-core.ts): el
 * permiso abre la pantalla, el alcance decide las filas.
 *
 * "padron.manage" y "supervision.assign" son de DIRECCION: dar de alta,
 * dar de baja y repartir alumnos es administrar la escuela.
 *
 * ALUMNO y CAJA no reciben nada de esto. Un residente no tiene por qué
 * leer el padrón completo de su generación, y caja cobra: no inscribe.
 *
 * ── Ola 2 · el piso clínico ─────────────────────────────────────────────
 * Aquí los cuatro roles SÍ se separan, y el reparto es el del contrato:
 *
 *   CAJA      recibe al paciente, lo agenda y lo cobra: pacientes.*
 *             (incluido el ORIGEN, que decide el precio) + agenda.* +
 *             sillones.view. Ni un caso clínico: no abre expediente.
 *   DOCENTE   mira todo lo suyo y REPARTE: los .view del piso clínico +
 *             casos.assign. No registra pacientes (eso es recepción) ni
 *             mueve la agenda de la escuela.
 *   ALUMNO    agenda.view + pacientes.view + casos.view. Tres permisos de
 *             LECTURA, y todo lo que lea está recortado a lo suyo.
 *
 * 🔴 Los tres roles de abajo comparten esas keys de lectura, y eso NO
 * significa que vean lo mismo. El permiso abre la pantalla; el ALCANCE
 * (src/lib/edu/visibility.ts) decide las filas: con el mismo
 * "pacientes.view", dirección ve todos, el docente ve los de sus alumnos
 * VIGENTES y el alumno ve los suyos. Ensanchar el permiso no ensancha lo
 * que se ve — y ésa es justamente la idea.
 *
 * ⚠️ "pacientes.origen" NO se le da al docente ni al alumno: marcar quién
 * trajo al paciente decide el precio en la Ola 5, así que lo pone quien
 * cobra (caja) o quien manda (dirección). Al alumno se le PINTA su origen,
 * deshabilitado.
 *
 * ── Ola 3 · el expediente clínico ───────────────────────────────────────
 * DIRECCION, DOCENTE y ALUMNO llevan las SEIS keys. CAJA, NINGUNA — y ésta
 * es la línea del contrato que más fácil se rompe, así que está cerrada en
 * DOS sitios, no en uno:
 *
 *   1. aquí, en el default (caja no trae ni expediente.view);
 *   2. en el ALCANCE (src/lib/edu/visibility.ts), porque el expediente se
 *      lee con el recurso "cases", y para caja ese recurso devuelve "none"
 *      aunque alguien le encienda el interruptor por error.
 *
 * Un solo candado se abre por accidente; dos hay que abrirlos a propósito.
 *
 * 🔴 Y otra vez: que los tres roles compartan "expediente.view" NO
 * significa que lean lo mismo. El alumno ve las notas de SUS casos, el
 * docente las de los alumnos que supervisa HOY, la dirección todas.
 * Ensanchar el permiso no ensancha lo que se ve.
 *
 * ── Ola 5 · el dinero ───────────────────────────────────────────────────
 * Aquí el reparto es el más estrecho de todo el vertical, y a propósito:
 *
 *   DIRECCION todo, incluido "tarifarios.manage": poner precios es decidir
 *             cuánto cuesta la escuela, y eso lo decide quien la dirige.
 *   CAJA      todo MENOS "tarifarios.manage". Cobra, devuelve, corta y LEE
 *             el tarifario —tiene que poder consultarlo delante del
 *             paciente— pero no lo escribe: quien cobra no se pone su
 *             propio precio.
 *   DOCENTE   NADA. Ni una key de dinero.
 *   ALUMNO    NADA. Ni el precio, ni el cobro, ni el saldo.
 *
 * 🔴 Que un alumno no vea dinero NO depende de esta lista. Si mañana
 * alguien le enciende "caja.view" desde la pantalla de permisos, seguirá
 * sin ver un peso: el ALCANCE (visibility.ts, recurso "charges") devuelve
 * "none" para DOCENTE y ALUMNO pase lo que pase. El permiso abre la
 * pantalla; el alcance decide las filas — y para el dinero, la decisión
 * está tomada en los dos sitios.
 *
 * ── Ola 4 · el gate de autorización ─────────────────────────────────────
 * Aquí el reparto ES la ola, y por primera vez en el vertical hay una key
 * que la DIRECCIÓN tiene y el DOCENTE no, y otra al revés:
 *
 *   ALUMNO    "request" + "view". PIDE y mira en qué va lo suyo. NO firma:
 *             si pudiera, el gate sería un formulario.
 *   DOCENTE   "view" + "decide". FIRMA y no pide. Es la separación de
 *             funciones de la escuela — quien autoriza no es quien
 *             propone — y por eso son dos keys y no una.
 *   CAJA      NINGUNA. Autorizar un acto clínico no es cobrarlo.
 *   DIRECCION las tres. Lleva "request" —que el docente no tiene— por una
 *             razón muy concreta: un caso cuyo alumno se dio de baja a
 *             media generación se queda sin nadie que pueda mandarlo a
 *             autorización, y sin esa key la dirección no lo puede
 *             desatorar. Que dirección pueda pedir Y firmar no rompe la
 *             separación que importa (alumno ≠ docente) y las dos cosas
 *             quedan escritas con su nombre y su hora.
 *
 * 🔴 Y otra vez, como con el dinero: que ALUMNO y DOCENTE compartan
 * "autorizaciones.view" NO significa que vean lo mismo. El ALCANCE
 * (visibility.ts, recurso "cases") le da al alumno lo de SUS casos y al
 * docente lo de los alumnos que supervisa HOY. Un docente que ya rotó deja
 * de ver —y por tanto de poder firmar— lo de los alumnos que entregó, sin
 * que nadie le apague un permiso.
 *
 * ── Ola 3B · IA de apoyo y consentimientos ──────────────────────────────
 * DIRECCION, DOCENTE y ALUMNO llevan las cuatro. CAJA lleva UNA:
 * "consentimientos.view".
 *
 * 🔴 Esa key de caja es la EXCEPCIÓN que hay que entender antes de tocar
 * nada. En todas las olas anteriores, caja se quedaba fuera del expediente
 * clínico por completo, cerrado en dos sitios (aquí y en el ALCANCE). El
 * consentimiento no es expediente clínico: es un documento que el paciente
 * firma y se lleva, y quien se lo imprime y se lo entrega es recepción.
 * Por eso —y solo para este recurso— la lectura se resuelve con el alcance
 * de "patients" y no con el de "cases" (ver src/lib/edu/consentimientos.ts,
 * que lo explica largo). Caja ve la carta; sigue sin ver una sola nota.
 *
 * ⚠️ "estudios.analyze" NO se le da a caja, y no hace falta insistir en
 * ello: el análisis se lee con el alcance del expediente, que para caja es
 * "none". Aunque alguien le encendiera la casilla, no encontraría un
 * estudio que analizar.
 *
 * ── Ola 6 · evaluación académica ────────────────────────────────────────
 * Los CUATRO roles llevan "evaluacion.view"… menos CAJA, que no lleva
 * ninguna de las cinco. Y el reparto de las otras cuatro es la ola:
 *
 *   DIRECCION las cinco. Diseña las rúbricas, captura el plan de estudios,
 *             califica y traspasa.
 *   DOCENTE   "evaluacion.view" + "evaluacion.grade" + "traspaso.manage".
 *             Califica a sus alumnos y reparte sus casos cuando rotan. NO
 *             lleva "rubricas.manage" ni "requisitos.manage": el plan de
 *             estudios lo fija la escuela, no cada docente — si cada uno
 *             pudiera editar la rúbrica con la que se le mide, la rúbrica
 *             dejaría de ser un criterio compartido.
 *   ALUMNO    "evaluacion.view" y NADA MÁS. Ve SU calificación, SUS
 *             comentarios y lo que le falta —recortado a lo suyo por el
 *             alcance— y no puede escribir una sola de esas cosas.
 *   CAJA      ninguna. Cobrar no es evaluar.
 *
 * 🔴 Que ALUMNO y DOCENTE compartan "evaluacion.view" NO significa que
 * vean lo mismo, igual que en las cuatro olas anteriores: el ALCANCE
 * (visibility.ts, recurso "cases") le da al alumno lo suyo y al docente lo
 * de los alumnos que supervisa HOY.
 *
 * ⚠️ "traspaso.manage" al DOCENTE y no al alumno: repartir casos es una
 * decisión académica. Y aunque un docente lo tenga, solo puede traspasar
 * lo que VE — los casos de sus alumnos vigentes.
 *
 * ── Ola 8 · la cartera de IA ────────────────────────────────────────────
 * SOLO DIRECCION, las dos. Es el reparto más estrecho del vertical junto
 * con "equipo.manage", y por la misma clase de razón: lo que se decide
 * aquí no es qué se ve, es cuánto dinero se gasta.
 *
 *   DIRECCION "ia.view" + "ia.manage". Administra el contrato del
 *             instituto, así que administra lo que ese contrato incluye.
 *   DOCENTE   ninguna. Usa la IA (dicta y analiza) y no decide el
 *             presupuesto de nadie.
 *   ALUMNO    ninguna, por lo mismo.
 *   CAJA      ninguna. Y ésta es la que parece discutible y no lo es: caja
 *             sí ve DINERO (es la única con "caja.view" además de
 *             dirección), pero el dinero de caja es el que la escuela
 *             COBRA a sus pacientes. El cupo de IA es un renglón del
 *             contrato con DaleControl: no entra al corte, no se cobra en
 *             el mostrador y no cuadra con nada de lo que caja concilia.
 *
 * 🔴 Y como con el dinero de la Ola 5, no basta con no dárselas: el
 * consumo de IA se lee con el ALCANCE de "charges" (visibility.ts), que
 * devuelve "none" para DOCENTE y ALUMNO pase lo que pase. Encenderle
 * "ia.view" a un alumno por error le abre una pantalla vacía, no el gasto
 * de la escuela. Dos candados, y el segundo no se abre desde la pantalla
 * de permisos.
 *
 * ⚠️ El ALUMNO sí lleva "consentimientos.revoke". Es deliberado y es la
 * decisión menos obvia de la ola: revocar no es autorizar, es REGISTRAR
 * que el paciente se retractó, y el paciente se retracta delante del
 * alumno, en el sillón. El estado peligroso no es que un alumno registre
 * una revocación de más: es que exista un consentimiento vivo para un
 * procedimiento que el paciente ya rechazó porque el alumno tuvo que ir a
 * buscar a su docente. Y lo que puede revocar está recortado a SUS
 * pacientes por el alcance, como todo lo demás.
 *
 * ── Ola 11 · las sedes ──────────────────────────────────────────────────
 * DIRECCION las dos; los otros tres roles, NINGUNA. Y esta vez el reparto
 * NO es la ola — la ola vive en otro sitio:
 *
 * 🔴 EL ACCESO A UNA SEDE NO ES UN PERMISO. Los permisos dicen QUÉ puede
 * hacer una persona; la sede dice DÓNDE. Un docente con `agenda.view` y
 * acceso solo al campus norte ve la agenda —el permiso está encendido— pero
 * solo la del norte, y eso lo decide edu_user_campus_access
 * (src/lib/edu/campus-core.ts), no esta lista.
 *
 * Consecuencia práctica: NINGÚN rol necesita una key para cambiar de sede
 * en la barra superior ni para que sus pantallas la respeten. Si hiciera
 * falta una, el día que se aplicara la ola todo el mundo se quedaría sin
 * poder mirar su propia agenda hasta que alguien encendiera un interruptor.
 *
 * `sedes.view` y `sedes.manage` son para ADMINISTRAR: dar de alta un
 * campus, cerrarlo y repartir quién entra a cuál.
 *
 * ── Ola 7 · el panel de dirección ───────────────────────────────────────
 * UNA key, "direccion.panel", y la lleva SOLO DIRECCION — como
 * "equipo.manage", "padron.manage", "supervision.assign",
 * "sillones.manage", "tarifarios.manage", "rubricas.manage" y
 * "requisitos.manage". Lo que SÍ es nuevo es otra cosa, y es la línea de
 * la ola:
 *
 * 🔴 ES LA PRIMERA KEY CUYO ALCANCE NIEGA EN VEZ DE RECORTAR. En las seis
 * olas anteriores, "el permiso abre la pantalla y el alcance decide las
 * filas" permitía darle la misma key a tres roles sin que vieran lo mismo.
 * Este tablero no admite ese reparto, porque su contenido ES el total: "la
 * clínica ahora", "cobrado del periodo", "ocupación promedio". Un docente
 * con esta key vería los sillones de sus alumnos bajo el título "La
 * clínica ahora" y leería un número falso.
 *
 * Por eso el alcance no lo RECORTA aquí: lo NIEGA. src/lib/edu/direccion.ts
 * comprueba que los cuatro recursos devuelvan "all" y se niega a pintar el
 * tablero si no. Encenderle la casilla a alguien por error no le enseña
 * media escuela: no le enseña nada, y le dice por qué.
 */
export const EDU_ROLE_DEFAULTS: Record<EduRole, EduPermissionKey[]> = {
  DIRECCION: [
    "inicio.view",
    "padron.view",
    "padron.manage",
    "docentes.view",
    "supervision.assign",
    "pacientes.view",
    "pacientes.manage",
    "pacientes.origen",
    "agenda.view",
    "agenda.manage",
    "sillones.view",
    "sillones.manage",
    "casos.view",
    "casos.assign",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
    "tarifarios.view",
    "tarifarios.manage",
    "caja.view",
    "caja.charge",
    "caja.refund",
    "caja.corte",
    // ── Ola 1B ──────────────────────────────────────────────────────────
    // SOLO dirección. Dar de alta una cuenta es decidir quién entra al
    // instituto, y quien la da queda con la contraseña temporal en la
    // mano; además, desde esta pantalla se puede crear a alguien con rol
    // DIRECCION, así que dársela a otro rol sería regalar la llave de la
    // escuela. Si un día una escuela quiere que su coordinador dé altas,
    // se le enciende por override desde la pantalla de permisos — a
    // sabiendas y una por una.
    "equipo.manage",
    "autorizaciones.request",
    "autorizaciones.view",
    "autorizaciones.decide",
    "estudios.analyze",
    "consentimientos.view",
    "consentimientos.create",
    "consentimientos.revoke",
    // ── Ola 6 ───────────────────────────────────────────────────────────
    "rubricas.manage",
    "requisitos.manage",
    "evaluacion.view",
    "evaluacion.grade",
    "traspaso.manage",
    // ── Ola 11 ──────────────────────────────────────────────────────────
    // Las dos, y SOLO dirección. Abrir un campus es una decisión de la
    // escuela, y repartir quién entra a cuál es repartir el acceso a los
    // pacientes de un edificio entero. Si una universidad grande quiere
    // que su coordinador de sede administre la suya, se le enciende por
    // override desde la pantalla de permisos — a sabiendas.
    "sedes.view",
    "sedes.manage",
    // ── Ola 7 ───────────────────────────────────────────────────────────
    // SOLO dirección, como las otras siete keys de administración. Ver el
    // tablero es ver la escuela entera: el dinero, la ocupación de los
    // sillones y quién va atrasado, todo en la misma pantalla.
    "direccion.panel",
    // ── Ola 8 ───────────────────────────────────────────────────────────
    // SOLO dirección. Quien administra el contrato del instituto es quien
    // decide si se gasta de más del cupo que ese contrato incluye.
    "ia.view",
    "ia.manage",
    // ── Ola 9 ───────────────────────────────────────────────────────────
    // SOLO dirección, las dos. Conectar la cuenta de WhatsApp del instituto
    // es entregar un token que puede mandar mensajes en su nombre, y
    // encender un aviso es abrir un gasto que Meta le cobra a la tarjeta de
    // la escuela. Ninguna de las dos cosas es una decisión de mostrador ni
    // de piso clínico. Caja y alumno siguen pudiendo MANDAR sus documentos:
    // eso lo abre el permiso del documento, no éste.
    "whatsapp.view",
    "whatsapp.manage",
    // ── Ola 10 ──────────────────────────────────────────────────────────
    // Las cuatro. Incluye "facturacion.config", que NADIE más lleva:
    // decidir si la escuela timbra ante el SAT es de quien la dirige.
    "facturacion.view",
    "facturacion.emit",
    "facturacion.cancel",
    "facturacion.config",
    // ── Ola 14 ──────────────────────────────────────────────────────────
    // Las cuatro, incluida "propose": un caso cuyo alumno se dio de baja
    // necesita que ALGUIEN pueda armar la receta — misma razón que el
    // "autorizaciones.request" de la Ola 4. Y como allá, proponer no le
    // deja firmarse a sí misma: nadie decide su propia petición.
    "recetas.view",
    "recetas.propose",
    "recetas.issue",
    "recetas.void",
  ],
  DOCENTE: [
    "inicio.view",
    "padron.view",
    "docentes.view",
    "pacientes.view",
    "agenda.view",
    "sillones.view",
    "casos.view",
    "casos.assign",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
    // Firma y NO pide: quien autoriza no es quien propone.
    "autorizaciones.view",
    "autorizaciones.decide",
    "estudios.analyze",
    "consentimientos.view",
    "consentimientos.create",
    "consentimientos.revoke",
    // Ola 6. Califica y reparte casos; NO diseña la rúbrica con la que
    // mide ni el plan de estudios contra el que se mide a su alumno.
    "evaluacion.view",
    "evaluacion.grade",
    "traspaso.manage",
    // Ola 14. TODO: ve, propone (para desatorar un caso sin alumno),
    // EXPIDE con su cédula y anula. Es el único rol al que "issue" le
    // llega por default junto con dirección — la cédula es suya.
    "recetas.view",
    "recetas.propose",
    "recetas.issue",
    "recetas.void",
  ],
  ALUMNO: [
    "inicio.view",
    "agenda.view",
    "pacientes.view",
    "casos.view",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
    // Pide y NO firma. Si llevara "decide", el gate sería un formulario.
    "autorizaciones.request",
    "autorizaciones.view",
    "estudios.analyze",
    "consentimientos.view",
    "consentimientos.create",
    "consentimientos.revoke",
    // Ola 6. VE su evaluación y no la escribe: es toda la ola en una
    // línea. Lo que ve está recortado a lo suyo por el alcance.
    "evaluacion.view",
    // Ola 14. PROPONE y no expide: no tiene cédula profesional — es
    // exactamente la razón de que la receta pase por el gate. Si llevara
    // "issue", el papel saldría sin nadie que responda por él.
    "recetas.view",
    "recetas.propose",
  ],
  CAJA: [
    "inicio.view",
    "pacientes.view",
    "pacientes.manage",
    "pacientes.origen",
    "agenda.view",
    "agenda.manage",
    "sillones.view",
    "tarifarios.view",
    "caja.view",
    "caja.charge",
    "caja.refund",
    "caja.corte",
    // 🔴 La ÚNICA key de esta ola que lleva caja, y la única casilla del
    // expediente que ha llevado nunca: la carta se imprime, se entrega y
    // se recoge firmada en el mostrador. Ver, y nada más — ni emitir, ni
    // revocar, ni analizar una placa.
    "consentimientos.view",
    // ── Ola 10 ──────────────────────────────────────────────────────────
    // VE y EMITE. No cancela y no configura: quien está en el mostrador
    // factura al paciente que lo pide —es su trabajo, y hacerlo pasar por
    // dirección sería mandar al paciente a esperar—, pero cancelar un CFDI
    // timbrado es un trámite ante el SAT que no se deshace, y encender el
    // timbrado fiscal es una decisión de la escuela, no del turno.
    "facturacion.view",
    "facturacion.emit",
  ],
};

/** Forma mínima que necesita cualquier check: rol + override. */
export interface EduPermissionUser {
  role: EduRole;
  permissionsOverride?: string[] | null;
}

/**
 * Permisos efectivos: override vacío o ausente → default del rol; override
 * con keys → esas REEMPLAZAN al default (no se mergean). Las keys que ya no
 * existen en el catálogo se descartan, para que un cambio de catálogo no
 * deje a nadie con permisos fantasma guardados en BD.
 */
export function getEduEffectivePermissions(user: EduPermissionUser): EduPermissionKey[] {
  // Cinturón: si llega algo casteado (`ctx.role as any`) que no es un
  // usuario, se niega todo en vez de adivinar.
  if (typeof user !== "object" || user === null) return [];
  const override = (user.permissionsOverride ?? []).filter(
    (k): k is EduPermissionKey => typeof k === "string" && k in EDU_ALL_PERMISSIONS,
  );
  if (override.length > 0) return override;
  return EDU_ROLE_DEFAULTS[user.role] ?? [];
}

/** ¿El usuario (rol + override) tiene esta key? */
export function hasEduPermission(user: EduPermissionUser, key: EduPermissionKey): boolean {
  return getEduEffectivePermissions(user).includes(key);
}

/** Error tipado que lanzan los asserts; las APIs lo mapean a 403. */
export class EduForbiddenError extends Error {
  readonly permission: EduPermissionKey;
  constructor(permission: EduPermissionKey) {
    super(`Permiso requerido: ${permission}`);
    this.name = "EduForbiddenError";
    this.permission = permission;
  }
}

/**
 * Assert de permiso para route handlers / server actions del vertical.
 * Recibe el CONTEXTO de sesión (nunca un rol suelto: sin usuario no hay
 * override que consultar).
 *
 *   const ctx = await getEduContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertEduPermission(ctx, "inicio.view"); }
 *   catch { return NextResponse.json({ error: "Sin permiso" }, { status: 403 }); }
 */
export function assertEduPermission(
  ctx: { role: EduRole; user: { permissionsOverride?: string[] | null } },
  key: EduPermissionKey,
): void {
  const ok = hasEduPermission(
    { role: ctx.role, permissionsOverride: ctx.user?.permissionsOverride },
    key,
  );
  if (!ok) throw new EduForbiddenError(key);
}

/**
 * Devuelve solo las keys válidas y sin repetir; descarta las inventadas.
 * Es lo que tiene que pasar TODO lo que venga del cliente antes de
 * guardarse en EduUser.permissionsOverride.
 */
export function sanitizeEduPermissionKeys(input: unknown): EduPermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<EduPermissionKey>();
  for (const k of input) {
    if (typeof k === "string" && k in EDU_ALL_PERMISSIONS) seen.add(k as EduPermissionKey);
  }
  return Array.from(seen);
}
