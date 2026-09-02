/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INSTITUCIONAL — datos de marketing de la landing pública
 * /instituciones (escuelas de especialidades odontológicas y clínicas
 * universitarias).
 *
 * Módulo PURO: sin prisma, sin "server-only", sin `node:crypto` y sin
 * `new Date()`. Lo importan la página (server component), los componentes
 * de sección (server) y la prueba estática de src/lib/edu/__tests__. Se
 * puede importar desde una ruta Edge —la imagen OG— porque no arrastra
 * nada del vertical: aquí solo hay texto y listas.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────
 * Esto lo lee la dirección de una escuela ANTES de firmar un contrato.
 * Cada promesa vive aquí como un `EduClaim` con los archivos del panel
 * donde se comprobó (`verifiedIn`). La prueba edu-landing.test.ts exige
 * que esos archivos EXISTAN: el día que alguien borre un módulo, la
 * promesa deja de pasar la prueba antes de que la página mienta.
 *
 * Y al revés: una promesa sin archivos es un error de la prueba SALVO que
 * se declare `contrato: true`, que es la única puerta para un término
 * comercial (los 5 TB, la IA por contrato, el manager asignado). Así no
 * se puede colar una función inventada "porque suena bien": o apunta a
 * código, o se declara como lo que es.
 *
 * ── TODO EL TEXTO VISIBLE VIVE EN ESTE ARCHIVO ────────────────────────
 * No hay diccionario i18n: el vertical es de una sola lengua (es-MX) y
 * el panel tampoco lo tiene. Teniendo el copy en un solo objeto, la
 * prueba puede recorrerlo entero y hacer cumplir el vocabulario:
 *
 *   · se dice "estudiante", nunca "alumno";
 *   · se dice "especialidad", nunca "programa";
 *   · jamás aparece "Ola N" (es lenguaje interno del repo);
 *   · ⛔ CERO PRECIOS: ni un signo de pesos, ni una cifra en MXN. La
 *     licencia es anual por institución y se cotiza según el tamaño de
 *     la escuela; ese número no vive en una página pública.
 *
 * ── LO QUE NO SE PUEDE DECIR, Y ESTÁ PROHIBIDO MECÁNICAMENTE ──────────
 * EDU_LANDING_PALABRAS_PROHIBIDAS lo hace cumplir la prueba sobre TODOS
 * los archivos de la landing (código y comentarios incluidos): nada de
 * certificaciones que no existen, nada de infraestructura, nada de la
 * unidad radiológica que este producto no calcula, y nada de las
 * funciones que todavía no están en producción.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── 1. Rutas y marca ────────────────────────────────────────────────────

/** La landing pública del vertical. */
export const EDU_LANDING_PATH = "/instituciones" as const;

/**
 * Login del vertical. NO es el login compartido del dental: el instituto
 * tiene su propia puerta (src/app/instituto/login/page.tsx) y el
 * middleware la deja pasar sin sesión.
 */
export const EDU_LOGIN_PATH = "/instituto/login" as const;

export const EDU_PRODUCT_NAME = "DaleControl Institucional" as const;
export const EDU_BRAND = "DaleControl" as const;
export const EDU_VERTICAL = "Institucional" as const;

/** Anclas de la página (nav, botones y footer). Un solo sitio. */
export const EDU_LANDING_ANCHORS = {
  flujo: "como-funciona",
  roles: "por-rol",
  expediente: "expediente",
  dinero: "caja-y-evaluacion",
  sedes: "sedes",
  plan: "el-plan",
  faq: "preguntas",
} as const;

// ── 2. El contacto: un manager asignado, por WhatsApp ───────────────────

/**
 * 🔴 EL NÚMERO VIVE AQUÍ Y EN NINGÚN OTRO SITIO. Ningún componente lo
 * escribe a mano: componen el enlace con `eduManagerWaHref()` y pintan
 * `eduManagerDisplayPhone()`. La prueba busca la cadena del número en los
 * archivos de la landing y falla si aparece fuera de este archivo.
 *
 * Convención del repo (la misma que la landing dental usa en
 * src/components/public/landing/sales/v2/whatsapp-cta.tsx): wa.me con el
 * E.164 SIN el "+", y el texto pre-escrito codificado.
 *
 * `textoPrevio` deja el hueco `<escuela>` a propósito: quien escribe lo
 * sustituye por el nombre de su institución antes de mandar. Un mensaje
 * que ya viene relleno con una escuela inventada es peor que uno con un
 * hueco evidente.
 */
export const EDU_MANAGER = {
  nombre: "Rafael",
  numeroE164: "529992602093",
  textoPrevio:
    "Hola Rafael, soy de <escuela> y quiero una demo de DaleControl Institucional.",
} as const;

/** El enlace de WhatsApp con el mensaje ya escrito. Punto ÚNICO. */
export function eduManagerWaHref(): string {
  return `https://wa.me/${EDU_MANAGER.numeroE164}?text=${encodeURIComponent(
    EDU_MANAGER.textoPrevio,
  )}`;
}

/**
 * El número tal como se lee: "+52 999 260 2093". Se DERIVA del E.164, no
 * se escribe otra vez — dos copias de un teléfono es como se llega a que
 * el botón marque a un número y la letra chica enseñe otro.
 *
 * Formato mexicano: 52 + 10 dígitos → +52 AAA BBB CCCC.
 */
export function eduManagerDisplayPhone(): string {
  const n = EDU_MANAGER.numeroE164;
  if (!n.startsWith("52") || n.length !== 12) return `+${n}`;
  const d = n.slice(2);
  return `+52 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

// ── 3. La forma de una promesa ──────────────────────────────────────────

export interface EduClaim {
  key: string;
  titulo: string;
  cuerpo: string;
  /** Nombre del icono; el componente lo mapea a lucide. */
  icon: string;
  /**
   * Archivos del repo donde se comprobó la promesa. La prueba exige que
   * existan. Vacío SOLO si `contrato` es true.
   */
  verifiedIn: string[];
  /**
   * true = no es una función del código, es un término del contrato que
   * ya fijó la dirección de DaleControl (almacenamiento incluido, IA
   * disponible según contrato, manager asignado). Es la ÚNICA forma de
   * que una promesa no apunte a archivos.
   */
  contrato?: boolean;
}

export interface EduClaimGroup {
  key: string;
  titulo: string;
  entrada: string;
  items: EduClaim[];
}

// ── 4. El problema ──────────────────────────────────────────────────────

/**
 * Tres dolores, sin exagerar. No se prometen aquí funciones: se describe
 * lo que hoy pasa en una clínica universitaria que se lleva en papel,
 * WhatsApp y hojas de cálculo.
 */
export const EDU_LANDING_PROBLEMAS = [
  {
    key: "expediente",
    icon: "folder",
    titulo: "El expediente vive en un folder",
    cuerpo:
      "La historia de un paciente se reparte entre una carpeta de papel, la libreta del estudiante y las fotos en su teléfono. Cuando el paciente vuelve el siguiente semestre y lo atiende alguien más, la historia empieza otra vez desde cero.",
  },
  {
    key: "firma",
    icon: "pen",
    titulo: "La autorización es una hoja suelta",
    cuerpo:
      "El docente firma el plan en una hoja que se archiva en algún lado. Meses después, cuando alguien pregunta quién autorizó ese tratamiento y sobre qué texto exactamente, hay que buscar la hoja y confiar en que nadie la cambió.",
  },
  {
    key: "cuentas",
    icon: "table",
    titulo: "Las cuentas viven en tres archivos que no coinciden",
    cuerpo:
      "Quién paga tarifa reducida, cuánto se cobró en el turno de hoy, cuántos requisitos lleva cada generación: tres hojas de cálculo, tres personas y ninguna cuadra con las otras el día de la acreditación.",
  },
] as const;

// ── 5. Cómo funciona: agenda → valoración → caso → firma → cobro ────────

export const EDU_LANDING_FLUJO: EduClaim[] = [
  {
    key: "agenda",
    icon: "calendar",
    titulo: "Agenda",
    cuerpo:
      "El paciente se cita en un sillón concreto, de una sede concreta, con el estudiante que lo va a atender y el docente que responde por él. Los horarios del sillón los pone la escuela; no hay un número de sillones metido en el código.",
    verifiedIn: [
      "src/lib/edu/agenda.ts",
      "src/lib/edu/agenda-core.ts",
      "src/lib/edu/sillones.ts",
      "src/app/instituto/(panel)/agenda/page.tsx",
    ],
  },
  {
    key: "tamizaje",
    icon: "clipboard",
    titulo: "Valoración",
    cuerpo:
      "La valoración inicial decide quién trata a quién: asigna el paciente a un estudiante y le abre su caso. Es una decisión académica, así que solo la toman Dirección y los docentes, nunca el mostrador.",
    verifiedIn: [
      "src/app/api/instituto/tamizaje/route.ts",
      "src/lib/edu/casos.ts",
      "src/lib/edu/permissions.ts",
    ],
  },
  {
    key: "caso",
    icon: "stethoscope",
    titulo: "Caso",
    cuerpo:
      "Todo el tratamiento cuelga de un caso: la especialidad, el procedimiento, las notas, los estudios y las calificaciones. El caso tiene un estudiante responsable y una historia que no se reescribe.",
    verifiedIn: ["src/lib/edu/casos.ts", "src/lib/edu/casos-core.ts", "src/lib/edu/types.ts"],
  },
  {
    key: "firma",
    icon: "shield-check",
    titulo: "Firma",
    cuerpo:
      "Antes de empezar a tratar, el docente firma el plan desde su teléfono; antes de cerrar, firma el alta. Sin esa firma el caso no avanza, y lo que se firmó queda resumido con un sello que delata cualquier cambio posterior.",
    verifiedIn: [
      "src/lib/edu/autorizaciones.ts",
      "src/lib/edu/autorizaciones-core.ts",
      "src/lib/edu/autorizaciones-hash.ts",
    ],
  },
  {
    key: "cobro",
    icon: "receipt",
    titulo: "Cobro",
    cuerpo:
      "En caja se elige al paciente y el servidor pone su lista de precios según quién lo trajo a la clínica. Se emite el cobro, se registra el pago y todo entra al corte del turno abierto.",
    verifiedIn: ["src/lib/edu/tarifas.ts", "src/lib/edu/caja.ts", "src/lib/edu/dinero-core.ts"],
  },
];

// ── 6. Por rol: el aislamiento como argumento ───────────────────────────

export interface EduRolCard {
  key: string;
  rol: string;
  ve: string;
  noVe: string;
  icon: string;
  verifiedIn: string[];
}

/**
 * Las cuatro tarjetas salen de la misma tabla de la que sale el producto:
 * src/lib/edu/visibility.ts, que arma el `where` de TODA lectura de
 * pacientes, citas, casos y dinero del vertical. Lo que dice "no ve" no
 * es una promesa de configuración: es un filtro que no se puede apagar
 * desde una pantalla.
 */
export const EDU_LANDING_ROLES: EduRolCard[] = [
  {
    key: "direccion",
    rol: "Dirección",
    icon: "building",
    ve: "La escuela entera: el padrón, la clínica, el expediente, el dinero y el avance académico de cada generación, del instituto completo o de una sede a la vez.",
    noVe:
      "Nada: es el único rol sin recorte, y por eso se da con cuentagotas. Todo lo demás del panel se reparte por permisos, no por confianza.",
    verifiedIn: ["src/lib/edu/visibility.ts", "src/lib/edu/permissions.ts"],
  },
  {
    key: "docente",
    rol: "Docente",
    icon: "user-check",
    ve: "A los estudiantes que supervisa con asignación vigente, y a sus pacientes, citas y casos. Firma las autorizaciones y expide las recetas con su cédula.",
    noVe:
      "A los estudiantes de otro docente. Y cuando entrega su grupo, deja de ver a esos pacientes el mismo día: una asignación vencida no da acceso.",
    verifiedIn: [
      "src/lib/edu/visibility.ts",
      "src/lib/edu/padron-core.ts",
      "src/lib/edu/recetas-core.ts",
    ],
  },
  {
    key: "estudiante",
    rol: "Estudiante",
    icon: "graduation-cap",
    ve: "Solo sus casos, sus pacientes y sus citas. Escribe la nota, propone la receta, manda a firmar y ve su propio avance contra los requisitos de su especialidad.",
    noVe:
      "A los pacientes de sus compañeros. Tampoco ve el dinero: ni el precio, ni el cobro, ni el saldo de la persona que está atendiendo.",
    verifiedIn: ["src/lib/edu/visibility.ts", "src/lib/edu/evaluacion.ts"],
  },
  {
    key: "caja",
    rol: "Caja",
    icon: "wallet",
    ve: "A todos los pacientes y toda la agenda, porque recibe, agenda y cobra. Abre turno, emite cobros y recibos, registra pagos y cierra el corte.",
    noVe:
      "El expediente clínico. Ni una nota, ni el odontograma, ni una radiografía: caja cobra, no abre historia clínica.",
    verifiedIn: ["src/lib/edu/visibility.ts", "src/lib/edu/expediente-core.ts", "src/lib/edu/caja.ts"],
  },
];

// ── 7. Expediente e imagenología ────────────────────────────────────────

export const EDU_LANDING_EXPEDIENTE: EduClaimGroup = {
  key: "expediente",
  titulo: "Un expediente que aguanta que lo revisen",
  entrada:
    "La historia clínica completa del paciente, con la firma de quien la escribió y la fecha en que alguien preguntó de verdad por sus antecedentes.",
  items: [
    {
      key: "nota",
      icon: "file-signature",
      titulo: "Nota firmada e inmutable",
      cuerpo:
        "Una nota clínica firmada no se edita: ni el texto, ni el diagnóstico, ni la cita a la que apunta, ni por la dirección del instituto. Si algo estaba mal, se corrige con una nota nueva que apunta a la anterior y las dos quedan.",
      verifiedIn: ["src/lib/edu/expediente-core.ts", "src/lib/edu/expediente.ts"],
    },
    {
      key: "antecedentes",
      icon: "alert-triangle",
      titulo: "Vacío no quiere decir «sin alergias»",
      cuerpo:
        "Los antecedentes tienen tres estados y no dos: nadie preguntó todavía, se preguntó y no refiere nada, o hay datos capturados. La ficha avisa en ámbar cuando nadie preguntó, y guarda quién revisó y cuándo.",
      verifiedIn: ["src/lib/edu/pacientes-core.ts", "src/lib/edu/pacientes.ts"],
    },
    {
      key: "odontograma",
      icon: "grid",
      titulo: "Odontograma e historial",
      cuerpo:
        "El odontograma del paciente, diente por diente y cara por cara, con el historial de lo que se le fue haciendo a lo largo de los semestres y de los estudiantes que lo atendieron.",
      verifiedIn: ["src/lib/edu/odontograma.ts", "src/lib/edu/odontograma-core.ts"],
    },
    {
      key: "consentimiento",
      icon: "pen-line",
      titulo: "Consentimiento con tres firmas",
      cuerpo:
        "La carta dice con todas sus letras que quien va a atender es un estudiante y quién lo supervisa. El paciente firma desde su propio teléfono con una liga, y encima van las dos contrafirmas: la de quien va a realizar el procedimiento y la del docente responsable.",
      verifiedIn: [
        "src/lib/edu/consentimientos-core.ts",
        "src/lib/edu/consentimientos.ts",
        "src/components/edu/consentimiento-publico.tsx",
      ],
    },
    {
      key: "estudios",
      icon: "scan",
      titulo: "Tomografías de hasta dos gigabytes",
      cuerpo:
        "Los estudios se suben directo al almacenamiento, sin pasar por un formulario que se cae a los cien megabytes: hasta 2 GB por archivo. Tomografías en DICOM, radiografías, fotografías, reportes y las mallas del escáner intraoral en STL, PLY y OBJ.",
      verifiedIn: [
        "src/lib/edu/estudios-core.ts",
        "src/lib/edu/estudios.ts",
        "src/lib/edu/storage.ts",
        "src/components/edu/expediente/edu-upload-client.ts",
      ],
    },
    {
      key: "visor",
      icon: "box",
      titulo: "Visor con cortes y volumen",
      cuerpo:
        "La tomografía se abre dentro del expediente: los tres cortes —axial, coronal y sagital— con la cruz sincronizada en milímetros, medición sobre la imagen y el volumen en tres dimensiones, con hueso, tejido o aire y su umbral. Las mallas del escáner se ven en su propio visor.",
      verifiedIn: [
        "src/components/edu/estudios/visor-modal.tsx",
        "src/components/edu/estudios/modelo-3d-viewer.tsx",
        "src/components/patient-3d/DicomSetViewer.tsx",
      ],
    },
  ],
};

// ── 8. Caja y evaluación ────────────────────────────────────────────────

export const EDU_LANDING_DINERO: EduClaimGroup = {
  key: "dinero",
  titulo: "La caja cuadra y la acreditación se cuenta sola",
  entrada:
    "El dinero de la clínica y el avance académico de cada estudiante salen de las mismas filas que ya existen, no de una hoja de cálculo que alguien mantiene aparte.",
  items: [
    {
      key: "tarifa",
      icon: "tags",
      titulo: "En caja nadie teclea precios",
      cuerpo:
        "Qué lista de precios le toca a un paciente lo decide el servidor a partir de quién lo trajo a la clínica, y cuánto cuesta cada procedimiento lo lee de la tabla. Si el navegador manda un precio, se descarta y queda registrado que lo mandó.",
      verifiedIn: ["src/lib/edu/tarifas.ts", "src/lib/edu/caja.ts"],
    },
    {
      key: "turno",
      icon: "calculator",
      titulo: "Turnos, corte y recibos",
      cuerpo:
        "Se abre turno, se cobra, se registran los pagos y se cierra el corte con lo que de verdad pasó por ese turno. Un cobro cancelado queda en cero y sale de todas las sumas.",
      verifiedIn: ["src/lib/edu/caja.ts", "src/lib/edu/dinero-core.ts"],
    },
    {
      key: "meses",
      icon: "calendar-clock",
      titulo: "Pagos a meses que suman exacto",
      cuerpo:
        "Un tratamiento largo se parte en mensualidades y la diferencia de centavos va entera en la primera, para que la suma dé el saldo al centavo. Una mensualidad está vencida porque pasó su fecha, no porque un proceso nocturno la haya marcado.",
      verifiedIn: ["src/lib/edu/pagos-core.ts", "src/lib/edu/pagos.ts"],
    },
    {
      key: "rubricas",
      icon: "list-checks",
      titulo: "Rúbricas y calificaciones",
      cuerpo:
        "Cada caso se califica con la rúbrica de su especialidad, con criterios que pesan lo que la escuela decida y una comprobación de que los pesos suman cien. Las notas se guardan en enteros para que el acta impresa cuadre con la pantalla.",
      verifiedIn: ["src/lib/edu/evaluacion-core.ts", "src/lib/edu/rubricas.ts"],
    },
    {
      key: "requisitos",
      icon: "target",
      titulo: "Requisitos, horas y bitácora",
      cuerpo:
        "Cuántos casos de cada tipo lleva un estudiante contra lo que su especialidad le exige, cuántas horas de clínica acumula y qué hizo cada día. El avance no se guarda en un contador: se cuenta cada vez que se lee.",
      verifiedIn: [
        "src/lib/edu/evaluacion-core.ts",
        "src/lib/edu/evaluacion.ts",
        "src/components/edu/evaluacion/bitacora-screen.tsx",
      ],
    },
    {
      key: "traspaso",
      icon: "arrow-left-right",
      titulo: "Cuando un estudiante rota o se gradúa",
      cuerpo:
        "Sus casos abiertos se traspasan: el viejo se cierra como transferido, el nuevo apunta al viejo con el motivo y quién lo hizo, y las citas futuras cambian de manos. El expediente no se mueve ni se copia, y quien sale pierde el acceso en el mismo acto en que el que entra lo gana.",
      verifiedIn: ["src/lib/edu/traspasos.ts", "src/lib/edu/visibility.ts"],
    },
  ],
};

// ── 9. Sedes, dirección y WhatsApp ──────────────────────────────────────

export const EDU_LANDING_SEDES: EduClaimGroup = {
  key: "sedes",
  titulo: "Una escuela, todos sus campus",
  entrada:
    "La sede divide la escuela por dentro; el aislamiento entre instituciones sigue siendo otro, y más duro.",
  items: [
    {
      key: "campus",
      icon: "map-pin",
      titulo: "Sedes ilimitadas, sillones por sede",
      cuerpo:
        "Das de alta las sedes que tengas y los sillones de cada una. El número del sillón es único dentro de su sede, porque es el que está pintado en esa pared: el campus norte y el campus sur tienen cada uno su Sillón 1.",
      verifiedIn: ["src/lib/edu/campus.ts", "src/lib/edu/campus-core.ts", "src/lib/edu/sillones.ts"],
    },
    {
      key: "selector",
      icon: "layers",
      titulo: "Agenda y panel por sede",
      cuerpo:
        "Un selector cambia el panel entero a la sede que estás mirando, y a quien solo trabaja en un campus se le puede dar acceso a ese. Lo que se exporta dice de qué sede son las cifras: un archivo de acreditación con el nombre del instituto y los números de un solo campus es exactamente el dato falso que no admitimos.",
      verifiedIn: [
        "src/lib/edu/visibility.ts",
        "src/components/edu/sedes/sede-selector.tsx",
        "src/lib/edu/direccion-core.ts",
      ],
    },
    {
      key: "direccion",
      icon: "gauge",
      titulo: "Indicadores para la dirección",
      cuerpo:
        "Hoy, la semana, el mes o el rango que elijas: pacientes atendidos, ocupación de cada sillón, avance por especialidad con su semáforo y el desglose del dinero como control. Lo que no se puede atribuir se dice, no se reparte a ojo.",
      verifiedIn: ["src/lib/edu/direccion.ts", "src/lib/edu/direccion-core.ts"],
    },
    {
      key: "whatsapp",
      icon: "message-circle",
      titulo: "WhatsApp con el número de la escuela",
      cuerpo:
        "Los recordatorios de cita salen del número de WhatsApp de la propia institución, con sus credenciales guardadas cifradas y con plantillas aprobadas por Meta. Si no hay plantilla aprobada para un aviso, ese aviso no se intenta y la pantalla dice por qué.",
      verifiedIn: ["src/lib/edu/whatsapp.ts", "src/lib/edu/whatsapp-core.ts", "src/lib/edu/recordatorios.ts"],
    },
    {
      key: "recetas",
      icon: "pill",
      titulo: "Recetas con cédula",
      cuerpo:
        "Un estudiante de especialidad no tiene cédula profesional, así que propone la receta y el docente la revisa, la firma y ahí queda expedida: con los dos nombres en el documento y la cédula de quien responde por ella.",
      verifiedIn: ["src/lib/edu/recetas-core.ts", "src/lib/edu/recetas.ts", "src/lib/edu/receta-pdf.tsx"],
    },
    {
      key: "ia",
      icon: "sparkles",
      titulo: "IA de apoyo, con cupo por escuela",
      cuerpo:
        "Dictado de la nota clínica y una segunda lectura de la radiografía, con cupo mensual por institución y el gasto a la vista. El análisis es apoyo para el estudiante y su docente, nunca un diagnóstico. Disponible según contrato.",
      verifiedIn: ["src/lib/edu/ia-core.ts", "src/lib/edu/ia.ts", "src/lib/edu/ia-cupo.ts"],
    },
  ],
};

/** Los tres grupos que pinta la página, en orden. */
export const EDU_LANDING_GRUPOS: EduClaimGroup[] = [
  EDU_LANDING_EXPEDIENTE,
  EDU_LANDING_DINERO,
  EDU_LANDING_SEDES,
];

// ── 10. El padrón (va en la sección de roles, como remate) ──────────────

export const EDU_LANDING_PADRON: EduClaim = {
  key: "padron",
  icon: "users",
  titulo: "El padrón académico",
  cuerpo:
    "Estudiantes con su matrícula, generaciones con sus fechas, especialidades y el equipo docente. La supervisión no se sobrescribe cuando un docente rota: la anterior se cierra con su vigencia, así que dentro de un año se puede contestar quién respondía por ese estudiante en marzo.",
  verifiedIn: ["src/lib/edu/padron.ts", "src/lib/edu/padron-core.ts", "src/lib/edu/equipo.ts"],
};

// ── 11. El plan único ───────────────────────────────────────────────────

export interface EduPlanItem {
  key: string;
  texto: string;
  verifiedIn: string[];
  contrato?: boolean;
}

/**
 * UNA sola tarjeta y sin precio. Lo que incluye es, o una función que se
 * puede abrir en el código, o un término de contrato marcado como tal.
 */
export const EDU_PLAN_INCLUYE: EduPlanItem[] = [
  {
    key: "sedes",
    texto: "Sedes ilimitadas y los sillones que tenga cada una",
    verifiedIn: ["src/lib/edu/campus.ts", "src/lib/edu/sillones.ts"],
  },
  {
    key: "roles",
    texto: "Los cuatro roles con aislamiento real: Dirección, Docente, Estudiante y Caja",
    verifiedIn: ["src/lib/edu/visibility.ts", "src/lib/edu/permissions.ts"],
  },
  {
    key: "expediente",
    texto: "Expediente clínico completo, imagenología en tres dimensiones y consentimientos",
    verifiedIn: [
      "src/lib/edu/expediente.ts",
      "src/lib/edu/estudios.ts",
      "src/lib/edu/consentimientos.ts",
    ],
  },
  {
    key: "dinero",
    texto: "Caja con turnos y corte, pagos a meses y evaluación académica",
    verifiedIn: ["src/lib/edu/caja.ts", "src/lib/edu/pagos.ts", "src/lib/edu/evaluacion.ts"],
  },
  {
    key: "whatsapp",
    texto: "WhatsApp con el número de la propia escuela",
    verifiedIn: ["src/lib/edu/whatsapp.ts"],
  },
  {
    key: "almacenamiento",
    texto: "5 TB de almacenamiento incluidos, con espacio adicional disponible",
    verifiedIn: [],
    contrato: true,
  },
  {
    key: "ia",
    texto: "IA clínica disponible según contrato",
    verifiedIn: [],
    contrato: true,
  },
  {
    key: "manager",
    texto: "Un manager asignado, con nombre y teléfono",
    verifiedIn: [],
    contrato: true,
  },
];

// ── 12. Preguntas frecuentes ────────────────────────────────────────────

export interface EduFaqItem {
  key: string;
  q: string;
  a: string;
  verifiedIn: string[];
  contrato?: boolean;
}

export const EDU_LANDING_FAQ: EduFaqItem[] = [
  {
    key: "aislamiento",
    q: "¿Mis estudiantes pueden ver a los pacientes de los demás?",
    a: "No. Un estudiante ve solo sus casos, sus pacientes y sus citas, y eso no es una casilla de configuración: el filtro se arma en un único archivo por el que pasa toda lectura de pacientes, citas y casos del vertical. Un docente ve a los estudiantes que supervisa con asignación vigente, y a nadie más.",
    verifiedIn: ["src/lib/edu/visibility.ts"],
  },
  {
    key: "graduacion",
    q: "¿Qué pasa cuando un estudiante se gradúa o cambia de rotación?",
    a: "Sus casos abiertos se traspasan a otro estudiante: el caso anterior se cierra como transferido, el nuevo apunta al anterior con el motivo y quién lo hizo, y las citas futuras se mueven para que el paciente no se quede a medias. El expediente de lo que ya ocurrió se queda donde ocurrió, y quien sale deja de ver a ese paciente en el mismo momento.",
    verifiedIn: ["src/lib/edu/traspasos.ts", "src/lib/edu/visibility.ts"],
  },
  {
    key: "sedes",
    q: "¿Cuántas sedes puedo tener?",
    a: "Las que tengas. Cada sede lleva sus propios sillones, con su horario, y el panel entero se puede mirar por sede o consolidado. A quien solo trabaja en un campus se le da acceso a ese campus.",
    verifiedIn: ["src/lib/edu/campus.ts", "src/lib/edu/sillones.ts", "src/lib/edu/visibility.ts"],
  },
  {
    key: "tomografias",
    q: "¿De qué tamaño puedo subir una tomografía?",
    a: "Hasta 2 GB por archivo, y el archivo viaja directo al almacenamiento en vez de pasar por un formulario. Dentro del expediente se abre con los tres cortes, la medición en milímetros y el volumen en tres dimensiones; las mallas del escáner intraoral se ven en su propio visor.",
    verifiedIn: [
      "src/lib/edu/estudios-core.ts",
      "src/components/edu/expediente/edu-upload-client.ts",
      "src/components/edu/estudios/visor-modal.tsx",
    ],
  },
  {
    key: "caja",
    q: "¿La persona de caja puede abrir el expediente?",
    a: "No. Caja ve a todos los pacientes y toda la agenda —recibe, agenda y cobra— y ni una nota clínica, ni el odontograma, ni una radiografía. Al revés también: un estudiante no ve el precio, ni el cobro, ni el saldo del paciente que está atendiendo.",
    verifiedIn: ["src/lib/edu/visibility.ts", "src/lib/edu/expediente-core.ts"],
  },
  {
    key: "receta",
    q: "¿Un estudiante puede recetar?",
    a: "Propone la receta; no la expide. El docente con cédula la revisa, la firma y ahí queda expedida, con los dos nombres en el documento y la cédula de quien responde. Mientras está pendiente o si se rechaza, no hay papel que imprimir.",
    verifiedIn: ["src/lib/edu/recetas-core.ts", "src/lib/edu/recetas.ts"],
  },
  {
    key: "edicion",
    q: "¿Y si alguien edita algo que el docente ya había firmado?",
    a: "La autorización se vence sola. Al firmar se guarda un resumen de exactamente lo que se firmó; si el contenido cambia, ese resumen deja de coincidir, la autorización pasa a vencida y el caso no avanza hasta que se vuelva a mandar. Una nota clínica firmada, además, no se edita: se corrige con una nota nueva que apunta a la anterior.",
    verifiedIn: [
      "src/lib/edu/autorizaciones-core.ts",
      "src/lib/edu/autorizaciones-hash.ts",
      "src/lib/edu/expediente-core.ts",
    ],
  },
  {
    key: "ia",
    q: "¿Qué hace la inteligencia artificial y qué no hace?",
    a: "Dicta la nota clínica a partir de la voz y da una segunda lectura de una radiografía para que el estudiante y su docente la comenten. Es apoyo, nunca un diagnóstico, y quien firma sigue siendo una persona. Va con cupo mensual por institución, con el consumo a la vista, y está disponible según contrato.",
    verifiedIn: ["src/lib/edu/ia-core.ts", "src/lib/edu/ia-cupo.ts"],
  },
  {
    key: "whatsapp",
    q: "¿Los recordatorios salen del número de mi escuela?",
    a: "Sí. La institución conecta su propia cuenta de WhatsApp Business y los avisos salen de su número; las credenciales se guardan cifradas. Los mensajes van por plantilla aprobada por Meta, y si un tipo de aviso no tiene plantilla aprobada no se intenta mandar: la pantalla lo dice en vez de dejarlo en «enviado».",
    verifiedIn: ["src/lib/edu/whatsapp.ts", "src/lib/edu/whatsapp-core.ts"],
  },
  {
    key: "contratacion",
    q: "¿Cómo se contrata?",
    a: "Es una licencia anual por institución, no una suscripción por usuario ni un cobro por tarjeta. Se cotiza según el tamaño de la escuela, y quien la arma es tu manager asignado: le escribes por WhatsApp y de ahí sale la demo con tus propios datos.",
    verifiedIn: [],
    contrato: true,
  },
];

// ── 13. Vocabulario prohibido (lo hace cumplir la prueba) ───────────────

/**
 * Lo que esta página NO puede decir, y por qué. La prueba busca cada
 * patrón en TODOS los archivos de la landing —código y comentarios— y
 * falla si aparece. No es decoración: es la lista de las cosas que suenan
 * bien en una página de ventas y que este producto no puede sostener.
 */
export const EDU_LANDING_PALABRAS_PROHIBIDAS: { patron: RegExp; porque: string }[] = [
  {
    patron: /NOM-024/i,
    porque:
      "El producto no está certificado en esa norma. Decirlo en una página que lee un comité de acreditación es una mentira comprobable.",
  },
  {
    patron: /\bCFDI\b|factura electr[oó]nica/i,
    porque:
      "La facturación fiscal del vertical no está lista para prometerse. Se anuncia el día que emita un comprobante de verdad.",
  },
  {
    patron: /ISO\s*27001/i,
    porque: "No hay tal certificación.",
  },
  {
    patron: /\bAWS\b|infraestructura de Amazon/i,
    porque:
      "La infraestructura no es un argumento de venta para una escuela y, además, no es esa.",
  },
  {
    patron: /qui[eé]n est[aá] conectad|usuarios conectados|en l[ií]nea ahora/i,
    porque:
      "El producto NO registra presencia, y el panel de dirección lo dice por escrito. Un contador de sesiones abiertas se leería como «gente en la clínica» y sería falso justo cuando importa.",
  },
  {
    patron: /Hounsfield/i,
    porque:
      "El visor trabaja con valores relativos de densidad. Nombrar la unidad radiológica implicaría una calibración que este producto no hace.",
  },
  {
    patron: /marketplace|proveedores dentales|laboratorio dental/i,
    porque: "Ese módulo no es de este vertical y no se le vende a una escuela.",
  },
  {
    patron: /\bOla\s*\d/i,
    porque: "Es lenguaje interno del repositorio. Un cliente no sabe qué es una ola.",
  },
];

/** Vocabulario del vertical: lo de la izquierda no se dice; se dice lo de la derecha. */
export const EDU_LANDING_VOCABULARIO: { patron: RegExp; enLugarDe: string }[] = [
  { patron: /\balumn[oa]s?\b/i, enLugarDe: "estudiante" },
  { patron: /\bprogramas?\b/i, enLugarDe: "especialidad" },
  { patron: /\btamizajes?\b/i, enLugarDe: "valoración" },
];

/**
 * Cualquier cifra de dinero. La página no lleva precios: ni un signo de
 * pesos con número detrás, ni una cantidad en moneda.
 */
export const EDU_LANDING_PRECIO_PROHIBIDO = /\$\s*\d|\d\s*(MXN|mxn|pesos)\b/;

// ── 14. SEO ─────────────────────────────────────────────────────────────

export const EDU_LANDING_SEO = {
  title: "Software para clínica universitaria de odontología | DaleControl",
  // Tope real de un fragmento de Google: ~155 caracteres. Más largo no es
  // "más información": es una frase cortada con puntos suspensivos.
  description:
    "Expediente firmado, autorización del docente antes de tratar, imagenología en 3D, caja y evaluación. Para escuelas de especialidades odontológicas.",
  keywords: [
    "software para clínica universitaria de odontología",
    "escuela de especialidades odontológicas",
    "expediente clínico universitario",
    "software para clínica dental universitaria",
    "sistema para escuela de odontología",
    "gestión de clínica de posgrado odontología",
    "expediente clínico electrónico para escuelas",
    "evaluación clínica de estudiantes de odontología",
  ],
  ogTitle: "La clínica de tu escuela, con un responsable detrás de cada tratamiento",
  ogSub: "Expediente firmado, autorización del docente y caja que cuadra. Para escuelas de especialidades odontológicas.",
  ogAlt: "DaleControl Institucional: software para clínicas universitarias de odontología",
} as const;

/**
 * JSON-LD serializado sin `<` crudo: un `</script>` dentro de un texto
 * cerraría la etiqueta y el resto del bloque se pintaría como HTML. Misma
 * defensa que usa la landing de barberías.
 */
export function serializeEduJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// ── 15. Copy suelto de la página ────────────────────────────────────────

/**
 * Todo lo demás que se pinta: nav, portada, cierres y pies de sección.
 * Vive aquí por la misma razón que las promesas — para que la prueba
 * pueda recorrer TODO el texto visible de la página de una sola pasada.
 */
export const EDU_LANDING_COPY = {
  nav: {
    ariaMain: "Secciones de la página",
    flujo: "Cómo funciona",
    roles: "Por rol",
    expediente: "Expediente",
    plan: "El plan",
    faq: "Preguntas",
    entrar: "Entrar",
    cta: "Hablar con mi manager",
    ctaCorto: "WhatsApp",
    // El botón corto dice sólo "WhatsApp", que no basta para nombrarlo. La
    // etiqueta EMPIEZA por esa palabra a propósito: un nombre accesible que
    // no contenga el texto visible rompe la navegación por voz.
    ctaCortoAria: "WhatsApp: hablar con mi manager",
  },
  hero: {
    eyebrow: "Escuelas de especialidades odontológicas",
    titulo: "Toda la clínica de tu escuela, con un ",
    tituloAcento: "responsable detrás de cada tratamiento",
    lead:
      "DaleControl Institucional lleva el padrón, la agenda, el expediente y la caja de una clínica universitaria. Ningún estudiante avanza un tratamiento sin la firma de su docente, y una nota firmada ya no se puede editar.",
    cta: "Contactar a mi manager por WhatsApp",
    ctaSecundario: "Ver cómo funciona",
    confianza: [
      "Cuatro roles con aislamiento real",
      "Nota firmada e inmutable",
      "Sedes ilimitadas",
    ],
    // La etiqueta describe el OBJETO y no el movimiento: quien pidió menos
    // movimiento ve el dibujo quieto, y una etiqueta que dice "girando" le
    // estaría contando algo que no está pasando.
    escenaAria: "Modelo tridimensional de una arcada dental sobre fondo azul institucional.",
  },
  problema: {
    eyebrow: "El punto de partida",
    titulo: "Hoy la clínica se lleva en papel, en WhatsApp y en hojas de cálculo",
  },
  flujo: {
    eyebrow: "Cómo funciona",
    titulo: "De la cita al cobro, en cinco pasos que no se saltan",
    lead:
      "Es el mismo recorrido que ya hace tu clínica. La diferencia es que cada paso deja escrito quién lo hizo y sobre qué.",
  },
  roles: {
    eyebrow: "Por rol",
    titulo: "Cada quien ve lo suyo, y eso no es una casilla que se pueda apagar",
    lead:
      "El filtro que decide qué filas ve cada persona se arma en un solo archivo por el que pasan todas las lecturas del vertical. No se parchea pantalla por pantalla, que es como se llega a que doce funcionen bien y la decimotercera enseñe la escuela entera.",
    ve: "Ve",
    noVe: "No ve",
  },
  expediente: {
    escenaAria:
      "Reconstrucción tridimensional de un volumen tomográfico, con un corte marcado sobre él, en tonos de hueso sobre fondo oscuro.",
    pie: "El visor del expediente reconstruye el volumen a partir de los cortes del estudio. La escena de arriba es una recreación de esa lectura para esta página, no un estudio de un paciente.",
  },
  sedes: {
    escenaAria:
      "Vista isométrica de una clínica universitaria con sus sillones distribuidos en el piso.",
    pie: "La distribución de arriba usa la misma retícula isométrica con la que el producto dibuja un piso clínico.",
  },
  plan: {
    eyebrow: "El plan",
    titulo: "Uno solo, para toda la institución",
    lead:
      "No hay escalones ni funciones apagadas esperando a que subas de plan. La escuela entra completa.",
    nombre: "Institucional",
    incluye: "Qué incluye",
    cta: "Contactar a mi manager por WhatsApp",
    letraChica: "Licencia anual por institución. Cotización según tamaño de la escuela.",
  },
  faq: {
    eyebrow: "Preguntas",
    titulo: "Lo que pregunta la dirección de una escuela",
  },
  final: {
    titulo: "Hablemos de tu escuela",
    cuerpo:
      "Tienes un manager asignado con nombre y teléfono. Le escribes por WhatsApp, le cuentas cuántas sedes, cuántos estudiantes y qué especialidades tienes, y arma la demo con tus propios números.",
    cta: "Contactar a mi manager por WhatsApp",
    managerEs: "Tu manager es",
    entrarPista: "¿Tu escuela ya usa DaleControl Institucional?",
    entrar: "Entrar al panel",
  },
  footer: {
    lema: "Software para escuelas de especialidades odontológicas y clínicas universitarias.",
    producto: "Producto",
    legal: "Legal",
    terminos: "Términos",
    privacidad: "Privacidad",
    entrar: "Entrar al panel",
    derechos: "Todos los derechos reservados.",
    dental: "DaleControl para consultorios",
  },
} as const;
