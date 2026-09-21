/**
 * EL cálculo de actividad, riesgo y "estado de verdad" de una clínica para
 * /admin. Puro y sin dependencias de base de datos (por eso vive junto a
 * mrr-core y audit-core): se prueba con `npm run test:salud-clinica` sin
 * levantar Prisma.
 *
 * Lo consumen TRES pantallas — el dashboard (/admin), la lista de clínicas
 * (/admin/clinics) y el CRM de clientes (/admin/clientes). Nadie escribe una
 * segunda versión: si una pantalla necesita otra pregunta, se añade aquí.
 *
 * ── Qué NO decide este archivo ──────────────────────────────────────────────
 * El estado del PLAN (al corriente / cobro fallido / trial / vencida) sale
 * entero de `getPlanStatus` (src/lib/plan-status.ts), que es la misma regla
 * que el gate de /dashboard y de /api. Aquí jamás se compara una fecha de fin
 * de periodo contra hoy: se usa `plan.daysLeft`, que ya viene de esa fuente.
 * La prueba src/lib/__tests__/plan-status-guard.test.ts caza lo contrario.
 *
 * ── El agujero que motivó el archivo ────────────────────────────────────────
 * `subscriptionStatus = "trialing"` cuenta como suscripción VIVA para el gate
 * (la clínica entra al panel), así que `getPlanStatus` la marca "al corriente"
 * aunque su periodo terminara hace meses. Comercialmente eso NO es una clínica
 * al corriente: es un trial caducado que sigue usando el producto y no ha
 * pagado nunca. `estadoOperativo` separa esos dos casos sin tocar el gate.
 */
import { getPlanStatus, type PlanStatus } from "@/lib/plan-status";

export type Fecha = Date | string | null | undefined;

const DIA_MS = 86_400_000;

// ── Umbrales, en un solo sitio y exportados ────────────────────────────────
// Se exportan porque las pantallas los citan en los textos ("sin citas en 60
// días"): un número escrito a mano en un componente se desincroniza del día
// que alguien mueva el umbral.

/** Ventana de "actividad reciente" de referencia. */
export const DIAS_VENTANA_ACTIVIDAD = 30;
/** A partir de aquí la clínica se está ENFRIANDO (aviso, no alarma). */
export const DIAS_ENFRIANDOSE = 30;
/** A partir de aquí está APAGADA: un churn en marcha. */
export const DIAS_APAGADA = 60;
/** Alta con menos días que esto todavía no se le exige haber arrancado. */
export const DIAS_GRACIA_ARRANQUE = 14;
/** Alta reciente + este volumen de pacientes = importación, no crecimiento. */
export const DIAS_ALTA_RECIENTE = 7;
export const PACIENTES_IMPORTACION = 50;
/**
 * Periodo de acceso que termina más allá de esto = fecha de fantasía
 * (hay trials hasta 2031 y 2036 en producción). No se corrige nada: se marca
 * para que quien cuente trials sepa que ese número no es real.
 */
export const DIAS_PERIODO_IMPLAUSIBLE = 400;

/** `subscriptionStatus` de una cuenta que se registró y nunca llegó a pagar. */
export const ESTADO_PAGO_PENDIENTE = "pending_payment";

/** Ventana de «está usando el panel ahora mismo». */
export const MINUTOS_EN_LINEA = 15;

/** `surface` de analytics_sessions que significa "trabajando en el panel". */
export const SUPERFICIE_PANEL = "dashboard";

// ── Entrada ────────────────────────────────────────────────────────────────

/**
 * Todo lo que hace falta para valuar UNA clínica. El llamador lo arma con
 * consultas AGREGADAS (groupBy), nunca con una consulta por clínica: la lista
 * tiene que aguantar 500 filas.
 *
 * Los campos de suscripción se le pasan tal cual a `getPlanStatus`, así que se
 * llaman igual que las columnas de `Clinic`.
 */
export interface EntradaSaludClinica {
  id: string;
  /** Alta de la clínica. */
  createdAt: Fecha;
  subscriptionStatus?: string | null;
  trialEndsAt?: Fecha;
  nextBillingDate?: Fecha;
  /** El dueño pidió cancelar desde su configuración. */
  cancelRequested?: boolean | null;
  /** Pacientes dados de alta. */
  pacientes: number;
  /** Citas con fecha ya pasada (las que de verdad ocurrieron o se agendaron). */
  citasPasadas: number;
  /** Citas en los últimos DIAS_VENTANA_ACTIVIDAD días. */
  citasVentana: number;
  /** Facturas que la clínica emitió a SUS pacientes en la ventana. */
  facturasVentana?: number;
  /** Notas clínicas / expedientes creados en la ventana. */
  notasVentana?: number;
  /** Los tres mismos números, en la ventana ANTERIOR, para la tendencia. */
  citasVentanaPrevia?: number;
  facturasVentanaPrevia?: number;
  notasVentanaPrevia?: number;
  /** Última cita pasada. null = nunca tuvo una. */
  ultimaCitaAt: Fecha;
  /** Primera cita futura agendada. null = no tiene nada por delante. */
  proximaCitaAt?: Fecha;
  /**
   * Último rastro de alguien de la clínica TRABAJANDO en el panel: el
   * `lastSeenAt` más reciente de `analytics_sessions` con `surface = "dashboard"`.
   *
   * ⛔ NO es `User.lastLogin`: esa columna está VACÍA en las 36 filas de
   * producción (nadie la escribe), así que usarla haría que todas las clínicas
   * salieran como «nunca ha entrado nadie». Medido el 20-sep-2026.
   *
   * null = no hay sesión registrada. Eso NO significa que nadie haya entrado:
   * la analítica es reciente y las clínicas anteriores no tienen filas. Por eso
   * se reporta como aviso de dato, nunca como riesgo.
   */
  ultimoAccesoAt: Fecha;
  /**
   * Hay una sesión de panel viva AHORA (lastSeenAt dentro de
   * MINUTOS_EN_LINEA). Señal discreta, no una métrica.
   */
  enLinea?: boolean;
  /** Cuántos pagos de suscripción en estado "paid" tiene registrados. */
  pagosRegistrados: number;
  /** Fecha del último de esos pagos. */
  ultimoPagoAt?: Fecha;
}

// ── Salida ─────────────────────────────────────────────────────────────────

/**
 * ¿Está viva? Cinco niveles. "nueva" y "sin-estrenar" son el MISMO hecho
 * (cero citas) contado antes y después de la gracia de arranque: antes no es
 * un problema, después sí.
 */
export type NivelActividad = "activa" | "nueva" | "enfriandose" | "apagada" | "sin-estrenar";

/**
 * CUÁNTO ha hecho la clínica, no solo si hizo algo. Tres cifras que juntas
 * distinguen una clínica que trabaja de una que entra a mirar.
 */
export interface VolumenActividad {
  citas: number;
  facturas: number;
  notas: number;
  /** Las tres sumadas. Una sola cifra con la que ordenar la tabla. */
  total: number;
}

export type DireccionTendencia = "sube" | "baja" | "igual";

export interface TendenciaActividad {
  direccion: DireccionTendencia;
  /**
   * Variación del total contra la ventana anterior, en %. null cuando la
   * ventana anterior fue CERO: de cero a algo no es un porcentaje, y fingir un
   * "+100 %" sería inventarse el dato.
   */
  deltaPct: number | null;
  previo: VolumenActividad;
}

export interface ActividadClinica {
  nivel: NivelActividad;
  /** Días desde la última cita. null = nunca tuvo una. */
  diasSinCita: number | null;
  /** Días desde el último acceso de su gente. null = nadie ha entrado nunca. */
  diasSinAcceso: number | null;
  citasVentana: number;
  citasPasadas: number;
  /** Cuánto trabajo hizo en la ventana: citas + facturas + notas. */
  volumen: VolumenActividad;
  /** Cómo va contra la ventana anterior. */
  tendencia: TendenciaActividad;
  /** Sesión de panel viva en los últimos MINUTOS_EN_LINEA. */
  enLinea: boolean;
  ultimaCitaAt: Date | null;
  proximaCitaAt: Date | null;
  ultimoAccesoAt: Date | null;
}

/**
 * El estado que un operador querría oír si pregunta "¿esta qué es?". Cubre el
 * hueco que dejan `subscriptionStatus = null` y el trial caducado que sigue
 * usando: aquí no hay valor vacío, siempre sale uno de estos siete.
 */
export type EstadoOperativo =
  /** Ni es cliente ni lo fue: cero pacientes, cero citas y nunca pagó. */
  | "prueba"
  /** Suscripción viva y pagada. */
  | "pagando"
  /** Stripe intentó cobrar y no pudo; todavía tiene acceso. */
  | "cobro-fallido"
  /** Periodo por delante sin haber pagado: trial o cortesía vigente. */
  | "trial-vigente"
  /** Periodo TERMINADO, sin pago, pero el gate la deja entrar (trialing). */
  | "trial-vencido"
  /** Se registró y se quedó a medias en el pago. */
  | "pago-pendiente"
  /** Vencida de verdad: el gate la bloquea. */
  | "vencida";

export const ETIQUETA_ESTADO_OPERATIVO: Record<EstadoOperativo, string> = {
  "prueba":         "Prueba",
  "pagando":        "Pagando",
  "cobro-fallido":  "Cobro fallido",
  "trial-vigente":  "En trial",
  // El ESTADO es "trial vencido"; si además lo está usando o no, lo dice el
  // riesgo ("Trial vencido y usando" / "Trial vencido sin uso"). Separarlo
  // evita repetir la misma frase en dos columnas de la tabla.
  "trial-vencido":  "Trial vencido",
  "pago-pendiente": "Pago pendiente",
  "vencida":        "Vencida",
};

export type Severidad = "critico" | "alto" | "medio";

export type ClaveRiesgo =
  | "trial-vencido-usando"
  | "cobro-fallido"
  | "vencida-con-actividad"
  | "pago-pendiente-usando"
  | "cancelacion-solicitada"
  | "apagada"
  | "trial-vencido-sin-uso"
  | "enfriandose"
  | "sin-estrenar";

export interface RiesgoClinica {
  clave: ClaveRiesgo;
  severidad: Severidad;
  /** Frase corta para la insignia. */
  titulo: string;
  /** El PORQUÉ, con el número que lo sostiene. Nunca un dato inventado. */
  detalle: string;
}

/** Señales sobre la CALIDAD del dato, no sobre la salud del negocio. */
export interface AvisosDeDato {
  /**
   * Alta reciente con muchos pacientes: es una importación. Quien dibuje una
   * gráfica de altas tiene que poder excluirla o el escalón parece crecimiento.
   */
  esImportacion: boolean;
  /**
   * El fin de periodo cae absurdamente lejos (hay clínicas con trial hasta
   * 2031 y 2036). Contarla como "trial vigente" descuadra la cuenta de trials.
   */
  periodoImplausible: boolean;
  /**
   * No hay ninguna sesión de panel registrada para esta clínica. NO se afirma
   * que nadie haya entrado: `analytics_sessions` es reciente (hoy sólo 4
   * clínicas tienen filas con surface="dashboard"), así que su ausencia dice
   * más de la analítica que de la clínica. Por eso es un aviso de DATO y no un
   * riesgo: una alarma aquí sería falsa en casi todo el roster.
   */
  sinRegistroDeAcceso: boolean;
}

export interface SaludClinica {
  id: string;
  /** El estado de plan tal y como lo ve el gate. No se reinterpreta. */
  plan: PlanStatus;
  estadoOperativo: EstadoOperativo;
  actividad: ActividadClinica;
  /** Riesgos ordenados: primero lo más grave. Vacío = nada que atender. */
  riesgos: RiesgoClinica[];
  /** La severidad del primer riesgo, o null si no hay ninguno. */
  severidadMaxima: Severidad | null;
  /** Cero pacientes + cero citas + nunca pagó. */
  esPrueba: boolean;
  /** Por qué se la considera prueba, para poder discutirlo. null si no lo es. */
  motivoPrueba: string | null;
  /** `!esPrueba`. Lo que debe entrar en cualquier total de clientes. */
  cuentaParaTotales: boolean;
  avisos: AvisosDeDato;
  /** Cuanto más alto, antes hay que mirarla. Para ordenar la tabla. */
  prioridad: number;
  diasDesdeAlta: number | null;
}

// ── Utilidades de fecha ────────────────────────────────────────────────────
// Deliberadamente genéricas: no saben nada del periodo de acceso, que sólo lo
// interpreta plan-status.

function aFecha(valor: Fecha): Date | null {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Días enteros transcurridos desde `valor` (0 = hoy, negativo si está en el
 * futuro, null sin fecha). Se redondea hacia abajo: "hace 59.8 días" son 59
 * días sin cita, y así el umbral de 60 no se dispara antes de tiempo.
 */
export function diasDesde(valor: Fecha, ahora: Date = new Date()): number | null {
  const d = aFecha(valor);
  if (!d) return null;
  return Math.floor((ahora.getTime() - d.getTime()) / DIA_MS);
}

// ── El cálculo ─────────────────────────────────────────────────────────────

function sumarVolumen(citas: number, facturas: number, notas: number): VolumenActividad {
  return { citas, facturas, notas, total: citas + facturas + notas };
}

/**
 * Variación del volumen contra la ventana anterior. De cero a algo NO es un
 * porcentaje: en ese caso `deltaPct` es null y la dirección se decide por el
 * signo, para no inventar un "+100 %".
 */
function calcularTendencia(actual: VolumenActividad, previo: VolumenActividad): TendenciaActividad {
  let direccion: DireccionTendencia = "igual";
  if (actual.total > previo.total) direccion = "sube";
  else if (actual.total < previo.total) direccion = "baja";

  const deltaPct = previo.total === 0
    ? null
    : Math.round(((actual.total - previo.total) / previo.total) * 100);

  return { direccion, deltaPct, previo };
}

function calcularActividad(entrada: EntradaSaludClinica, ahora: Date): ActividadClinica {
  const diasSinCita   = diasDesde(entrada.ultimaCitaAt, ahora);
  const diasSinAcceso = diasDesde(entrada.ultimoAccesoAt, ahora);
  const diasDesdeAlta = diasDesde(entrada.createdAt, ahora);

  let nivel: NivelActividad;
  if (entrada.citasVentana > 0) {
    // Hay citas en la ventana: está viva, sin más vueltas.
    nivel = "activa";
  } else if (diasSinCita === null) {
    // Nunca tuvo una cita. Recién dada de alta todavía no es un problema;
    // pasada la gracia de arranque, es una cuenta que no despegó.
    nivel = diasDesdeAlta !== null && diasDesdeAlta < DIAS_GRACIA_ARRANQUE ? "nueva" : "sin-estrenar";
  } else if (diasSinCita >= DIAS_APAGADA) {
    nivel = "apagada";
  } else if (diasSinCita >= DIAS_ENFRIANDOSE) {
    nivel = "enfriandose";
  } else {
    // Tuvo su última cita hace menos de 30 días pero ninguna cae en la
    // ventana: la ventana cuenta citas PASADAS, así que esto sólo ocurre con
    // ventanas más cortas que el umbral. Se trata como viva.
    nivel = "activa";
  }

  const volumen = sumarVolumen(
    entrada.citasVentana,
    entrada.facturasVentana ?? 0,
    entrada.notasVentana ?? 0,
  );
  const previo = sumarVolumen(
    entrada.citasVentanaPrevia ?? 0,
    entrada.facturasVentanaPrevia ?? 0,
    entrada.notasVentanaPrevia ?? 0,
  );

  return {
    nivel,
    diasSinCita,
    diasSinAcceso,
    citasVentana:   entrada.citasVentana,
    citasPasadas:   entrada.citasPasadas,
    volumen,
    tendencia:      calcularTendencia(volumen, previo),
    enLinea:        entrada.enLinea === true,
    ultimaCitaAt:   aFecha(entrada.ultimaCitaAt),
    proximaCitaAt:  aFecha(entrada.proximaCitaAt),
    ultimoAccesoAt: aFecha(entrada.ultimoAccesoAt),
  };
}

/**
 * ¿Es real o es una prueba? Los tres a la vez, tal cual: cero pacientes, cero
 * citas y ningún pago registrado JAMÁS. Con uno solo de los tres no basta —
 * una clínica que pagó y todavía no cargó pacientes es un cliente real que no
 * ha arrancado, no basura de pruebas.
 */
function evaluarPrueba(entrada: EntradaSaludClinica): { esPrueba: boolean; motivo: string | null } {
  const sinPacientes = entrada.pacientes === 0;
  const sinCitas     = entrada.citasPasadas === 0;
  const sinPagos     = entrada.pagosRegistrados === 0;
  if (sinPacientes && sinCitas && sinPagos) {
    return { esPrueba: true, motivo: "Sin pacientes, sin citas y sin ningún pago registrado" };
  }
  return { esPrueba: false, motivo: null };
}

/**
 * El estado de verdad. Parte del `kind` de plan-status y le quita las dos
 * ambigüedades que el gate no tiene por qué resolver:
 *   • el trial caducado que el gate deja pasar porque su status es "trialing";
 *   • la cuenta que se quedó en `pending_payment`.
 */
function resolverEstadoOperativo(
  entrada: EntradaSaludClinica,
  plan: PlanStatus,
  esPrueba: boolean,
): EstadoOperativo {
  if (esPrueba) return "prueba";

  // daysLeft < 0 = el periodo de acceso ya terminó. Sale de plan-status; aquí
  // NO se compara ninguna fecha contra hoy.
  const periodoTerminado = plan.daysLeft !== null && plan.daysLeft < 0;
  const status = entrada.subscriptionStatus ?? null;

  if (plan.kind === "expired")  return "vencida";
  if (plan.kind === "past_due") return "cobro-fallido";

  if (plan.kind === "active") {
    // "trialing" está dentro de los statuses con acceso, pero no paga nada.
    if (status === "trialing" && periodoTerminado) return "trial-vencido";
    return "pagando";
  }

  // kind === "trial": periodo por delante (o sin fecha) y sin suscripción viva.
  if (status === ESTADO_PAGO_PENDIENTE) return "pago-pendiente";
  return "trial-vigente";
}

const PESO_SEVERIDAD: Record<Severidad, number> = { critico: 300, alto: 200, medio: 100 };

function detectarRiesgos(
  entrada: EntradaSaludClinica,
  plan: PlanStatus,
  actividad: ActividadClinica,
  estado: EstadoOperativo,
  esPrueba: boolean,
  ahora: Date,
): RiesgoClinica[] {
  // Una prueba no genera riesgos: si lo hiciera, las seis cuentas de pruebas
  // de producción llenarían la bandeja de "atender hoy" y taparían lo real.
  if (esPrueba) return [];

  const riesgos: RiesgoClinica[] = [];
  const usando = actividad.citasVentana > 0;
  const diasSinCita = actividad.diasSinCita;
  const diasVencida = plan.daysLeft !== null && plan.daysLeft < 0 ? -plan.daysLeft : null;

  if (estado === "trial-vencido") {
    if (usando) {
      riesgos.push({
        clave: "trial-vencido-usando",
        severidad: "critico",
        titulo: "Trial vencido y usando",
        detalle: diasVencida !== null
          ? `El periodo terminó hace ${diasVencida} días y sigue agendando: ${actividad.citasVentana} citas en los últimos ${DIAS_VENTANA_ACTIVIDAD} días. Nunca ha pagado.`
          : `Sigue agendando (${actividad.citasVentana} citas en los últimos ${DIAS_VENTANA_ACTIVIDAD} días) sin haber pagado.`,
      });
    } else {
      riesgos.push({
        clave: "trial-vencido-sin-uso",
        severidad: "medio",
        titulo: "Trial vencido sin uso",
        detalle: diasVencida !== null
          ? `El periodo terminó hace ${diasVencida} días y no ha vuelto a agendar.`
          : "El periodo terminó y no ha vuelto a agendar.",
      });
    }
  }

  if (estado === "cobro-fallido") {
    riesgos.push({
      clave: "cobro-fallido",
      severidad: "critico",
      titulo: "Cobro fallido",
      detalle: `Stripe no pudo cobrar (subscriptionStatus «${entrada.subscriptionStatus}»). Todavía tiene acceso; Stripe reintenta.`,
    });
  }

  if (estado === "vencida" && usando) {
    riesgos.push({
      clave: "vencida-con-actividad",
      severidad: "alto",
      titulo: "Vencida con actividad",
      detalle: `Está bloqueada por el gate y aun así tiene ${actividad.citasVentana} citas en los últimos ${DIAS_VENTANA_ACTIVIDAD} días.`,
    });
  }

  if (estado === "pago-pendiente" && (usando || entrada.pacientes > 0)) {
    riesgos.push({
      clave: "pago-pendiente-usando",
      severidad: "alto",
      titulo: "Pago pendiente con actividad",
      detalle: `Se quedó en «${ESTADO_PAGO_PENDIENTE}» con ${entrada.pacientes} pacientes y ${actividad.citasVentana} citas en los últimos ${DIAS_VENTANA_ACTIVIDAD} días.`,
    });
  }

  if (entrada.cancelRequested) {
    riesgos.push({
      clave: "cancelacion-solicitada",
      severidad: "alto",
      titulo: "Cancelación solicitada",
      detalle: "El dueño pidió cancelar desde su configuración.",
    });
  }

  // Apagada / enfriándose: sólo tiene sentido decirlo de quien SÍ debería
  // estar operando. A una vencida ya la describe su propio estado.
  const operando = estado === "pagando" || estado === "cobro-fallido" || estado === "trial-vigente";
  if (operando && actividad.nivel === "apagada" && diasSinCita !== null) {
    riesgos.push({
      clave: "apagada",
      severidad: "alto",
      titulo: "Apagada",
      detalle: `Sin citas desde hace ${diasSinCita} días. Es un churn en marcha.`,
    });
  } else if (operando && actividad.nivel === "enfriandose" && diasSinCita !== null) {
    riesgos.push({
      clave: "enfriandose",
      severidad: "medio",
      titulo: "Enfriándose",
      detalle: `Sin citas desde hace ${diasSinCita} días.`,
    });
  }

  if (actividad.nivel === "sin-estrenar") {
    riesgos.push({
      clave: "sin-estrenar",
      severidad: "medio",
      titulo: "Sin estrenar",
      detalle: `Nunca ha agendado una cita y ya lleva ${diasDesde(entrada.createdAt, ahora) ?? 0} días de alta.`,
    });
  }

  // Ojo: NO hay riesgo por "nadie ha entrado". La única fuente de accesos es
  // analytics_sessions, que es reciente y no cubre a las clínicas antiguas: la
  // alarma sería falsa en casi todo el roster. Va como aviso de dato.

  return riesgos.sort((a, b) => PESO_SEVERIDAD[b.severidad] - PESO_SEVERIDAD[a.severidad]);
}

function calcularAvisos(entrada: EntradaSaludClinica, plan: PlanStatus, ahora: Date): AvisosDeDato {
  const diasDesdeAlta = diasDesde(entrada.createdAt, ahora);
  return {
    esImportacion:
      diasDesdeAlta !== null &&
      diasDesdeAlta <= DIAS_ALTA_RECIENTE &&
      entrada.pacientes >= PACIENTES_IMPORTACION,
    periodoImplausible: plan.daysLeft !== null && plan.daysLeft > DIAS_PERIODO_IMPLAUSIBLE,
    sinRegistroDeAcceso: diasDesde(entrada.ultimoAccesoAt, ahora) === null,
  };
}

/**
 * Cuanto más alto, antes hay que mirarla. La suma de las severidades más un
 * empujón por los días parados, para que entre dos "apagadas" salga primero la
 * que lleva más tiempo muerta. Una prueba puntúa 0: nunca sube a la bandeja.
 */
function calcularPrioridad(riesgos: RiesgoClinica[], actividad: ActividadClinica): number {
  if (riesgos.length === 0) return 0;
  const base = riesgos.reduce((s, r) => s + PESO_SEVERIDAD[r.severidad], 0);
  const castigo = Math.min(actividad.diasSinCita ?? 0, 365) / 10;
  return Math.round((base + castigo) * 100) / 100;
}

/** EL cálculo. Una clínica entra, un veredicto sale. */
export function evaluarSaludClinica(
  entrada: EntradaSaludClinica,
  ahora: Date = new Date(),
): SaludClinica {
  const plan = getPlanStatus(entrada, ahora);
  const actividad = calcularActividad(entrada, ahora);
  const { esPrueba, motivo } = evaluarPrueba(entrada);
  const estadoOperativo = resolverEstadoOperativo(entrada, plan, esPrueba);
  const riesgos = detectarRiesgos(entrada, plan, actividad, estadoOperativo, esPrueba, ahora);

  return {
    id: entrada.id,
    plan,
    estadoOperativo,
    actividad,
    riesgos,
    severidadMaxima: riesgos.length ? riesgos[0].severidad : null,
    esPrueba,
    motivoPrueba: motivo,
    cuentaParaTotales: !esPrueba,
    avisos: calcularAvisos(entrada, plan, ahora),
    prioridad: calcularPrioridad(riesgos, actividad),
    diasDesdeAlta: diasDesde(entrada.createdAt, ahora),
  };
}

// ── Resumen de una cartera ─────────────────────────────────────────────────

export interface ResumenCartera {
  /** Filas evaluadas, pruebas incluidas. */
  total: number;
  /** Clínicas reales: las que cuentan para cualquier total de clientes. */
  reales: number;
  pruebas: number;
  /** Cuántas reales hay en cada estado. Las pruebas NO entran aquí. */
  porEstado: Record<EstadoOperativo, number>;
  /** Cuántas reales hay en cada nivel de actividad. */
  porActividad: Record<NivelActividad, number>;
  /** Reales con al menos un riesgo. */
  enRiesgo: number;
  criticas: number;
  /** Cuántas arrastran cada aviso de dato. */
  importaciones: number;
  periodosImplausibles: number;
  sinRegistroDeAcceso: number;
  /** Clínicas REALES con alguien trabajando en el panel ahora mismo. */
  enLinea: number;
  /** Volumen de trabajo sumado de las clínicas reales, en la ventana. */
  volumen: VolumenActividad;
}

const ESTADOS: EstadoOperativo[] = [
  "prueba", "pagando", "cobro-fallido", "trial-vigente", "trial-vencido", "pago-pendiente", "vencida",
];
const NIVELES: NivelActividad[] = ["activa", "nueva", "enfriandose", "apagada", "sin-estrenar"];

/**
 * Los totales que cualquier pantalla querría, contados UNA vez y con la misma
 * regla. `porEstado` excluye las pruebas a propósito (salvo su propio casillero
 * "prueba"): mezclarlas era lo que hacía que /admin dijera 15 clínicas cuando
 * sólo 9 son clientes.
 */
export function resumirCartera(saludes: SaludClinica[]): ResumenCartera {
  const porEstado    = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoOperativo, number>;
  const porActividad = Object.fromEntries(NIVELES.map((n) => [n, 0])) as Record<NivelActividad, number>;

  let reales = 0, pruebas = 0, enRiesgo = 0, criticas = 0;
  let importaciones = 0, periodosImplausibles = 0, sinRegistroDeAcceso = 0, enLinea = 0;
  let citas = 0, facturas = 0, notas = 0;

  for (const s of saludes) {
    porEstado[s.estadoOperativo] += 1;
    if (s.esPrueba) {
      pruebas += 1;
    } else {
      reales += 1;
      porActividad[s.actividad.nivel] += 1;
      if (s.riesgos.length) enRiesgo += 1;
      if (s.severidadMaxima === "critico") criticas += 1;
      if (s.actividad.enLinea) enLinea += 1;
      citas    += s.actividad.volumen.citas;
      facturas += s.actividad.volumen.facturas;
      notas    += s.actividad.volumen.notas;
    }
    if (s.avisos.esImportacion) importaciones += 1;
    if (s.avisos.periodoImplausible) periodosImplausibles += 1;
    if (s.avisos.sinRegistroDeAcceso) sinRegistroDeAcceso += 1;
  }

  return {
    total: saludes.length,
    reales, pruebas, porEstado, porActividad,
    enRiesgo, criticas, importaciones, periodosImplausibles, sinRegistroDeAcceso, enLinea,
    volumen: sumarVolumen(citas, facturas, notas),
  };
}

/** Las que exigen atención HOY, de la más grave a la menos. */
export function ordenarPorAtencion(saludes: SaludClinica[]): SaludClinica[] {
  return saludes
    .filter((s) => s.riesgos.length > 0)
    .sort((a, b) => b.prioridad - a.prioridad);
}
