/**
 * Portada de /admin — «qué exige atención hoy».
 *
 * Módulo PURO: sin Prisma, sin React, sin `server-only`. Recibe filas ya
 * cargadas y devuelve las señales ordenadas. Así la regla se puede probar sin
 * base de datos (`npm run test:admin-portada`) y la página solo pinta.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * La portada contestaba «¿cómo vamos?» (MRR, cobrado, altas) y no contestaba
 * «¿qué se está rompiendo?», que es a lo que un operador entra. Lo medido en
 * producción el 20-sep-2026, de 15 clínicas:
 *   · una con el trial vencido desde julio y SIGUIENDO en uso
 *   · una «activa» sin una sola cita desde el 24-jul
 *   · seis con 0 pacientes / 0 citas / nunca pagaron — basura de pruebas
 *   · dos con subscriptionStatus = null
 * Ninguna de esas cinco cosas se veía. Cada una tiene aquí su motivo.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *  · NO deriva la salud de una clínica. Desde el 21-sep-2026 eso es
 *    `evaluarSaludClinica` (@/lib/admin/salud-clinica), EL cálculo que también
 *    usan /admin/clinics y /admin/clientes. Antes esta capa tenía su propia
 *    derivación —no por gusto: cuando se escribió la portada, `salud-clinica.ts`
 *    todavía no existía en el remoto y no se pudo consumir—. Ya existe, así que
 *    aquí quedó sólo lo que esta pantalla sabe hacer: AGRUPAR, ORDENAR y
 *    REDACTAR. Si la portada y Clínicas discrepasen de una clínica, sería un
 *    bug de este archivo, no dos opiniones legítimas.
 *  · NO decide si una clínica está vencida, en trial o al corriente: eso baja
 *    de `salud.plan`, que a su vez es `@/lib/plan-status`, la regla del gate.
 *  · NO calcula MRR ni precios: eso es `@/lib/admin/mrr` + `plan_configs`.
 *  · NO escribe nada. La portada es de LECTURA.
 *
 * ── Lo que SÍ sigue siendo suyo, y por qué ──────────────────────────────────
 *  · Los seis MOTIVOS y su orden de lectura: son la cara de esta pantalla.
 *  · Los dos umbrales que sólo existen aquí (`DIAS_TRIAL_POR_VENCER`,
 *    `DIAS_SIN_LOGIN`): salud-clinica no los tiene.
 *  · Tres GUARDAS de dato que salud-clinica no puede aplicar porque no recibe
 *    esos campos (dinero por cobrar, cobros fallidos y «no se pudo leer el
 *    histórico»). Van marcadas una por una más abajo.
 */
import {
  evaluarSaludClinica,
  DIAS_VENTANA_ACTIVIDAD,
  DIAS_ENFRIANDOSE,
  DIAS_APAGADA as DIAS_APAGADA_SALUD,
  MINUTOS_EN_LINEA as MINUTOS_EN_LINEA_SALUD,
  type EntradaSaludClinica,
  type SaludClinica,
} from "@/lib/admin/salud-clinica";
import { isSubscriptionActive, PAYMENT_FAILED_STATUSES } from "@/lib/plan-status";

// ── Umbrales ───────────────────────────────────────────────────────────────
// Los cuatro primeros son RE-EXPORTACIONES de salud-clinica, no copias: si un
// día alguien mueve el umbral allí, la portada se mueve con él y los rótulos
// («sin citas desde hace 60 días») no se quedan mintiendo. Se conservan con el
// nombre viejo para no tocar a los tres componentes que ya los importan.

/** Ventana que cuenta como «la clínica está usando la app». */
export const DIAS_ACTIVIDAD = DIAS_VENTANA_ACTIVIDAD;
/** Sin citas en este plazo, la clínica se está enfriando (aviso). */
export const DIAS_APAGADA = DIAS_ENFRIANDOSE;
/** Sin citas en este plazo, apagada de gravedad: un churn en marcha. */
export const DIAS_APAGADA_GRAVE = DIAS_APAGADA_SALUD;
/** Ventana de «en línea»: una sesión vista hace menos de esto está trabajando. */
export const MINUTOS_EN_LINEA = MINUTOS_EN_LINEA_SALUD;

// Estos dos son de la portada y de nadie más: salud-clinica no los conoce.
/** Un trial que vence dentro de esta ventana es «de esta semana». */
export const DIAS_TRIAL_POR_VENCER = 7;
/** Sin entrar al panel en este plazo, aviso de baja. */
export const DIAS_SIN_LOGIN = 7;

export type SeveridadAtencion = "critico" | "alto" | "medio";

/**
 * Los motivos por los que una clínica aparece en la portada. El orden de esta
 * lista ES el orden de lectura del panel: primero el dinero que se escapa.
 */
export type MotivoAtencion =
  | "cobro_fallido"
  | "usando_sin_plan"
  | "trial_por_vencer"
  | "apagada"
  | "sin_login"
  | "estado_desconocido";

export const ORDEN_MOTIVOS: MotivoAtencion[] = [
  "cobro_fallido",
  "usando_sin_plan",
  "trial_por_vencer",
  "apagada",
  "sin_login",
  "estado_desconocido",
];

const PESO_SEVERIDAD: Record<SeveridadAtencion, number> = {
  critico: 0,
  alto: 1,
  medio: 2,
};

/**
 * Una clínica tal y como la necesita la portada. Todo lo que no se puede
 * derivar aquí (última cita, citas recientes, si alguna vez pagó) llega ya
 * resuelto desde la página, que es quien habla con la base.
 *
 * Las fechas admiten `null` a propósito: «no hay dato» es un estado que la
 * portada muestra tal cual, nunca lo rellena con un ejemplo.
 */
/**
 * Cuánto ha HECHO una clínica en una ventana. Tres números, no uno: juntos
 * distinguen a la que trabaja de la que entra a mirar. Una con 116 citas y 1
 * factura factura poco; una con 4 citas y 5 facturas está cobrando lo viejo.
 */
export interface ActividadClinica {
  citas: number;
  facturas: number;
  notas: number;
}

export const ACTIVIDAD_CERO: ActividadClinica = { citas: 0, facturas: 0, notas: 0 };

/** Suma de las tres, para ordenar y para preguntar «¿hizo algo?». */
export function totalActividad(a: ActividadClinica): number {
  return a.citas + a.facturas + a.notas;
}

export interface FilaPortada {
  id: string;
  nombre: string;
  plan: string;
  createdAt: Date;
  /** Fin del periodo con acceso. Ver el encabezado de `@/lib/plan-status`. */
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  nextBillingDate: Date | null;
  /**
   * Archivado LÓGICO (NOM-004 §7). Una clínica archivada se apagó A PROPÓSITO:
   * contarla en «se apagaron» sería una falsa alarma, así que se aparta y se
   * dice — como las cuentas de prueba, ni se borra ni se esconde.
   */
  archivedAt: Date | null;
  pacientes: number;
  /** Citas de toda la vida de la clínica. */
  citasTotales: number;
  /**
   * Cita PASADA más reciente. `null` = ninguna cita pasada (o la agregación no
   * pudo correr; quien los separa es `citasTotales`).
   *
   * ⚠️ Antes era la más reciente **futura incluida**, para que una clínica con
   * una cita agendada para la semana que viene contase como viva. Se cambió el
   * 21-sep-2026 para alimentar a `salud-clinica` con lo MISMO que le pasa
   * /admin/clinics (`startsAt <= ahora`): con dos entradas distintas, las dos
   * pantallas daban estados distintos de la misma clínica, que es justo lo que
   * este cambio venía a cerrar. Efecto: una clínica sin citas pasadas en 30 o
   * 60 días sale «enfriándose» / «apagada» aunque tenga una agendada por
   * delante — es el criterio de Clínicas, y ahora es el único.
   */
  ultimaCita: Date | null;
  /** Qué ha hecho en los últimos `DIAS_ACTIVIDAD` días. */
  actividad: ActividadClinica;
  /** Y en los `DIAS_ACTIVIDAD` anteriores a esos, para la tendencia. */
  actividadPrevia: ActividadClinica;
  /**
   * Última vez que alguien de la clínica estuvo EN EL PANEL, de
   * `analytics_sessions.lastSeenAt` con `surface = 'dashboard'`.
   *
   * ⚠️ `null` significa **no hay registro de sesión**, NO «nunca entró». La
   * tabla solo guarda sesiones recientes (medido el 20-sep-2026: 32 filas de
   * dashboard, de 4 clínicas), así que la mayoría de clínicas sale a `null` sin
   * que eso diga nada de ellas. Por eso ningún motivo acusa a una clínica por
   * un `null`: solo se avisa de quien SÍ consta que entraba y dejó de hacerlo.
   *
   * ⛔ NO se usa `users.lastLogin`: está vacío en las 36 filas de la base
   * (nadie lo escribe), así que enseñarlo marcaría «nunca entró» a todo el
   * mundo. Escribirlo sería una escritura y este rediseño es de lectura.
   */
  ultimoAcceso: Date | null;
  /** Hay una sesión de panel vista hace menos de `MINUTOS_EN_LINEA`. */
  enLinea: boolean;
  /** Nº de facturas de suscripción que Stripe no pudo cobrar. */
  cobrosFallidos: number;
  /**
   * Fallido + pendiente, en pesos, **dentro de la misma ventana de facturas
   * que usa el KPI «por cobrar»** de la página (desde el inicio del mes
   * pasado). No es la deuda histórica total: una `pending` de hace seis meses
   * no está ni aquí ni en el KPI.
   */
  montoPorCobrar: number;
  /**
   * Tuvo alguna factura de suscripción `paid`. **`null` = no se pudo mirar**
   * (la agregación del histórico falló), y eso NO es lo mismo que "no pagó":
   * con `null` la clínica no se aparta como cuenta de prueba y ningún texto
   * afirma que nunca pagó.
   */
  algunaVezPago: boolean | null;
}

export interface SenalAtencion {
  /** Clave estable para React y para las pruebas. */
  clave: string;
  motivo: MotivoAtencion;
  severidad: SeveridadAtencion;
  clinicaId: string;
  clinicaNombre: string;
  /** Hay alguien de esta clínica en el panel ahora mismo. */
  clinicaEnLinea: boolean;
  /** El PORQUÉ, en una línea corta: lo que el operador lee antes de hacer clic. */
  porQue: string;
  /**
   * Cifra que acompaña a la fila, ya formateada por quien la construye
   * (importe, «hace 58 d», «vence en 2 d»). `null` = ese dato no existe, y así
   * se dice; nunca se inventa.
   */
  dato: string | null;
  /** Dinero de ESTA clínica en juego. 0 cuando la señal no es de dinero. */
  montoEnRiesgo: number;
  /** Para desempatar el orden dentro del grupo: días de antigüedad del problema. */
  gravedadDias: number;
}

export interface GrupoAtencion {
  motivo: MotivoAtencion;
  severidad: SeveridadAtencion;
  titulo: string;
  /** Qué mide el grupo, para que nadie tenga que adivinar el criterio. */
  criterio: string;
  senales: SenalAtencion[];
  /** Suma de `montoEnRiesgo` del grupo. */
  monto: number;
}

export interface TotalesPortada {
  /** Filas recibidas, sin filtrar. */
  clinicas: number;
  /** Cuentas de prueba apartadas (0 pacientes, 0 citas, nunca pagaron). */
  dePrueba: number;
  /** Archivadas apartadas (archivedAt != null). */
  archivadas: number;
  /** Clínicas de verdad = clinicas − dePrueba − archivadas. */
  reales: number;
  /** Clínicas reales con al menos una señal. */
  conSenal: number;
  /** Clínicas con alguien dentro del panel ahora mismo. */
  enLinea: number;
  /** Señales totales (una clínica puede tener varias). */
  senales: number;
  /**
   * Dinero por cobrar **atribuible a una señal de cobro fallido**. Es un
   * SUBCONJUNTO del KPI «por cobrar»: una factura `pending` de una clínica al
   * corriente (p. ej. el sobrecupo de CFDI) cuenta en el KPI y no aquí, porque
   * no hay nada roto que atender. Por eso el titular de la portada usa el
   * total del KPI y esta cifra se enseña aparte.
   */
  dineroEnRiesgo: number;
}

export interface Portada {
  grupos: GrupoAtencion[];
  totales: TotalesPortada;
  /** Las cuentas de prueba apartadas, para poder nombrarlas sin contarlas. */
  cuentasDePrueba: { id: string; nombre: string }[];
  /** Las archivadas apartadas, por el mismo motivo. */
  archivadas: { id: string; nombre: string }[];
}

const TITULOS: Record<MotivoAtencion, { titulo: string; criterio: string; severidad: SeveridadAtencion }> = {
  cobro_fallido: {
    titulo: "Cobro fallido",
    criterio: "Stripe intentó cobrar y no pudo. El dinero se está escapando ahora.",
    severidad: "critico",
  },
  usando_sin_plan: {
    titulo: "Usando sin plan vigente",
    criterio: `Vencida, trial vencido o pago pendiente, y con actividad en los últimos ${DIAS_ACTIVIDAD} días.`,
    severidad: "critico",
  },
  trial_por_vencer: {
    titulo: "Trial vence esta semana",
    criterio: `Trial o cortesía vigente que termina dentro de ${DIAS_TRIAL_POR_VENCER} días.`,
    severidad: "alto",
  },
  apagada: {
    titulo: "Se apagaron",
    criterio: `Sin una cita PASADA desde hace ${DIAS_APAGADA} días o más (${DIAS_APAGADA_GRAVE} = grave), o sin estrenar.`,
    severidad: "alto",
  },
  sin_login: {
    titulo: "Nadie entra",
    criterio: `Suscripción viva o trial vigente, y sin abrir el panel en ${DIAS_SIN_LOGIN} días.`,
    severidad: "medio",
  },
  estado_desconocido: {
    titulo: "Sin estado de suscripción",
    criterio: "subscriptionStatus = null: la fila no dice si paga, si nunca pagó o si canceló.",
    severidad: "medio",
  },
};

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * La fila de la portada, traducida a lo que come EL cálculo. Es el único punto
 * de contacto: a partir de aquí la portada no vuelve a mirar `trialEndsAt`,
 * `subscriptionStatus` ni una fecha de cita.
 *
 * Dos traducciones no son evidentes y están medidas:
 *
 *  · `citasPasadas` ← `citasTotales`, que es el `_count.appointments` de la
 *    clínica (futuras incluidas). salud-clinica sólo lo usa para decidir si la
 *    cuenta está vacía (`=== 0`), y una clínica con citas futuras no está
 *    vacía, así que el matiz no cambia ningún veredicto.
 *
 *  · `pagosRegistrados` ← `algunaVezPago`, que es un booleano **con tercer
 *    estado**: `null` significa «no se pudo leer el histórico», no «no pagó».
 *    `EntradaSaludClinica` sólo admite un número, así que el `null` se traduce
 *    a 1 (=«sí pagó») a propósito: es el lado conservador. Con 0, un timeout
 *    del pooler haría que salud-clinica declarase cuenta de prueba a una
 *    clínica de verdad y la portada la escondería. Ver el punto 7 del reporte:
 *    salud-clinica no sabe decir «no lo sé».
 */
export function aEntradaSalud(f: FilaPortada): EntradaSaludClinica {
  return {
    id: f.id,
    createdAt: f.createdAt,
    subscriptionStatus: f.subscriptionStatus,
    trialEndsAt: f.trialEndsAt,
    nextBillingDate: f.nextBillingDate,
    pacientes: f.pacientes,
    citasPasadas: f.citasTotales,
    citasVentana: f.actividad.citas,
    facturasVentana: f.actividad.facturas,
    notasVentana: f.actividad.notas,
    citasVentanaPrevia: f.actividadPrevia.citas,
    facturasVentanaPrevia: f.actividadPrevia.facturas,
    notasVentanaPrevia: f.actividadPrevia.notas,
    ultimaCitaAt: f.ultimaCita,
    ultimoAccesoAt: f.ultimoAcceso,
    enLinea: f.enLinea,
    pagosRegistrados: f.algunaVezPago === false ? 0 : 1,
  };
}

/** EL cálculo, sobre una fila de la portada. */
export function saludDeFila(f: FilaPortada, now: Date): SaludClinica {
  return evaluarSaludClinica(aEntradaSalud(f), now);
}

/**
 * Cuenta de prueba: lo que diga salud-clinica (`esPrueba` = 0 pacientes, 0
 * citas y ningún pago), MÁS la guarda de dinero que sólo conoce la portada.
 *
 * La guarda no es una segunda opinión sobre la salud: es que salud-clinica no
 * recibe las facturas. Una cuenta vacía que ya generó una factura pendiente o
 * un cargo rechazado es DINERO, no basura, y tiene que seguir viéndose. Igual
 * con una suscripción viva: si Stripe dice que paga, no se esconde por estar
 * vacía.
 *
 * Se aparta, no se borra: sigue contándose y con nombre en `cuentasDePrueba`.
 */
export function esCuentaDePrueba(
  f: FilaPortada,
  now: Date,
  salud: SaludClinica = saludDeFila(f, now),
): boolean {
  return (
    salud.esPrueba &&
    f.montoPorCobrar === 0 &&
    f.cobrosFallidos === 0 &&
    !isSubscriptionActive(f.subscriptionStatus)
  );
}

/**
 * ¿La clínica está usando la app? Cualquier cosa hecha en la ventana (citas,
 * facturas o notas) o una sesión de panel dentro de ella.
 *
 * Es más ancha que el «usando» de los riesgos de salud-clinica (que mira sólo
 * las citas) y eso es deliberado: aquí la pregunta es «¿hay alguien detrás?»,
 * y una clínica que sólo factura o sólo escribe notas sigue teniendo a alguien
 * detrás. Las tres cifras salen ya resueltas de `salud.actividad`.
 */
export function estaEnUso(
  f: FilaPortada,
  now: Date,
  salud: SaludClinica = saludDeFila(f, now),
): boolean {
  const a = salud.actividad;
  if (a.volumen.total > 0) return true;
  if (a.enLinea) return true;
  return a.diasSinAcceso !== null && a.diasSinAcceso <= DIAS_ACTIVIDAD;
}

/** «116 citas · 1 factura · 2 notas en 30 d», saltándose los ceros. */
export function resumenActividad(a: ActividadClinica, dias: number): string {
  const partes = [
    a.citas > 0 ? plural(a.citas, "cita", "citas") : null,
    a.facturas > 0 ? plural(a.facturas, "factura", "facturas") : null,
    a.notas > 0 ? plural(a.notas, "nota", "notas") : null,
  ].filter(Boolean);
  if (partes.length === 0) return `sin actividad en ${dias} d`;
  return `${partes.join(" · ")} en ${dias} d`;
}

/**
 * El porqué de una clínica sin plan vigente, tomado del `subscriptionStatus`
 * crudo — la misma lectura que hace `planStatusLabel` para la insignia.
 */
function porQueSinPlan(status: string | null): string {
  if (status === "past_due" || status === "unpaid") return "cobro fallido";
  if (status === "cancelled" || status === "canceled") return "canceló";
  if (status === null) return "sin estado de suscripción";
  if (status === "pending_payment") return "nunca pagó";
  return status;
}

/** «hace 58 días», «hace 1 día». */
function hace(dias: number): string {
  return `hace ${plural(dias, "día", "días")}`;
}

/**
 * Las señales de UNA clínica, TRADUCIDAS del veredicto de salud-clinica a los
 * seis motivos de esta pantalla. Una clínica puede disparar varias (vencida y
 * además apagada); cada una vive en su grupo y se cuenta una sola vez por
 * clínica en `conSenal`.
 *
 * Nada de aquí abajo vuelve a mirar una fecha ni un `subscriptionStatus` para
 * DECIDIR: todo sale de `salud`. Los tres únicos campos crudos que se leen son
 * los que salud-clinica no recibe —`cobrosFallidos`, `montoPorCobrar` y
 * `algunaVezPago`— y están marcados uno por uno.
 */
export function senalesDeClinica(
  f: FilaPortada,
  now: Date,
  salud: SaludClinica = saludDeFila(f, now),
): SenalAtencion[] {
  const out: SenalAtencion[] = [];
  const status = salud.plan.subscriptionStatus;
  const actividad = salud.actividad;
  const enUso = estaEnUso(f, now, salud);
  /** Días que lleva vencido el periodo de acceso. `plan.daysLeft` sale del gate. */
  const diasVencida =
    salud.plan.daysLeft !== null && salud.plan.daysLeft < 0 ? -salud.plan.daysLeft : null;

  const base = {
    clinicaId: f.id,
    clinicaNombre: f.nombre,
    clinicaEnLinea: actividad.enLinea,
  };

  // ── 1. Cobro fallido ──────────────────────────────────────────────────────
  // Tres fuentes, porque miden cosas distintas y ninguna basta sola:
  //   · `estadoOperativo === "cobro-fallido"` — el veredicto: Stripe está
  //     reintentando y la clínica todavía tiene acceso.
  //   · `PAYMENT_FAILED_STATUSES` sobre el status crudo — cubre el hueco de
  //     arriba: si además se le acabó el periodo, salud-clinica la llama
  //     «vencida» (que es correcto) y el cobro roto dejaría de gritar. Es el
  //     Set de plan-status, no una lista escrita aquí.
  //   · `cobrosFallidos > 0` — la factura en `failed`. salud-clinica no recibe
  //     facturas; una clínica puede tener el status limpio y un cargo caído.
  const statusFallido = status !== null && PAYMENT_FAILED_STATUSES.has(status);
  if (salud.estadoOperativo === "cobro-fallido" || statusFallido || f.cobrosFallidos > 0) {
    const partes: string[] = [];
    if (f.cobrosFallidos > 0) partes.push(plural(f.cobrosFallidos, "cargo rechazado", "cargos rechazados"));
    if (statusFallido) partes.push(`suscripción en ${status}`);
    out.push({
      ...base,
      clave: `${f.id}:cobro_fallido`,
      motivo: "cobro_fallido",
      severidad: "critico",
      porQue: partes.join(" · ") || "Stripe no pudo cobrar",
      // Con importe, la UI pinta el dinero y este texto no se usa. Sin él
      // (past_due que todavía no ha generado factura fallida) se dice qué pasa,
      // que es más útil que un "sin dato" en la señal más grave del panel.
      dato: f.montoPorCobrar > 0 ? null : "sin factura fallida aún",
      montoEnRiesgo: f.montoPorCobrar,
      gravedadDias: diasVencida ?? 0,
    });
  }

  // ── 2. Usando sin plan vigente ────────────────────────────────────────────
  // Los TRES estados operativos que significan «trabaja con la puerta abierta
  // sin haber pagado». Antes sólo entraba `isPlanExpired`, así que los otros
  // dos eran invisibles en la portada:
  //   · `vencida`       — el gate la bloquea (es el isPlanExpired de siempre).
  //   · `trial-vencido` — `subscriptionStatus = "trialing"` con el periodo
  //     terminado hace meses. Para el gate está AL CORRIENTE y entra al panel;
  //     comercialmente nunca ha pagado. Es el agujero que motivó salud-clinica.
  //
  // `pago-pendiente` NO entra aquí a propósito: su periodo de cortesía sigue
  // VIGENTE (salud-clinica la clasifica dentro de `plan.kind === "trial"`), así
  // que no está usando la app sin plan — simplemente no ha terminado de pagar.
  // Su sitio es el motivo 5. salud-clinica sí le levanta un riesgo propio
  // («Pago pendiente con actividad», severidad alta) que esta portada todavía
  // no tiene dónde enseñar: ver el punto 6 del reporte.
  const SIN_PLAN = ["vencida", "trial-vencido"] as const;
  if ((SIN_PLAN as readonly string[]).includes(salud.estadoOperativo) && enUso) {
    out.push({
      ...base,
      clave: `${f.id}:usando_sin_plan`,
      motivo: "usando_sin_plan",
      severidad: "critico",
      porQue:
        porQueSinPlan(status) +
        (diasVencida !== null && diasVencida > 0 ? ` · vencida ${hace(diasVencida)}` : ""),
      dato: resumenActividad(f.actividad, DIAS_ACTIVIDAD),
      montoEnRiesgo: 0,
      gravedadDias: diasVencida ?? 0,
    });
  }

  // ── 3. Trial que vence esta semana ────────────────────────────────────────
  // `estadoOperativo === "trial-vigente"` es el trial o cortesía CON periodo
  // por delante y sin suscripción viva. `plan.daysLeft` es el mismo `daysUntil`
  // que usaba esta pantalla, sólo que ya resuelto.
  //
  // Cambia un caso respecto a antes: una clínica en `past_due` con el periodo
  // por delante ya NO sale aquí. `isInTrial` la daba por «en trial» porque
  // past_due no cuenta como suscripción viva; su sitio es el grupo 1, donde ya
  // estaba saliendo a la vez.
  const faltan = salud.plan.daysLeft;
  if (
    salud.estadoOperativo === "trial-vigente" &&
    faltan !== null && faltan >= 0 && faltan <= DIAS_TRIAL_POR_VENCER
  ) {
    out.push({
      ...base,
      clave: `${f.id}:trial_por_vencer`,
      motivo: "trial_por_vencer",
      severidad: "alto",
      porQue: enUso
        ? `${plural(f.pacientes, "paciente", "pacientes")} · ${resumenActividad(f.actividad, DIAS_ACTIVIDAD)}`
        : "sin actividad en el trial",
      // `daysLeft` redondea hacia ARRIBA, así que "1" puede ser cualquier cosa
      // entre tres horas y un día entero — se dice "o menos" en vez de afinar
      // con una resta propia de `trialEndsAt`, que es lo que plan-status-guard
      // prohíbe.
      dato: faltan === 1 ? "en 1 día o menos" : `en ${plural(faltan, "día", "días")}`,
      montoEnRiesgo: 0,
      gravedadDias: DIAS_TRIAL_POR_VENCER - faltan,
    });
  }

  // ── 4. Se apagaron ────────────────────────────────────────────────────────
  // El nivel lo pone salud-clinica: `enfriandose` a los 30 días sin cita
  // PASADA, `apagada` a los 60, `sin-estrenar` cuando nunca agendó y ya se le
  // pasó la gracia de arranque de 14 días. Los tres van al mismo grupo; la
  // severidad los separa, igual que antes separaba 30 de 60 días.
  //
  // ⚠️ GUARDA DE DATO (salud-clinica no puede aplicarla): `ultimaCita` sale
  // `null` por dos motivos MUY distintos —la clínica no ha agendado nunca, o la
  // agregación que la calcula no pudo correr—, y `EntradaSaludClinica` no sabe
  // decir «no lo sé». Quien los separa es `citasTotales`, que viene del
  // `_count` de la clínica y no depende de esa consulta. Sin esta comprobación,
  // un timeout del pooler hacía que TODAS las clínicas —incluida una con 900
  // citas— salieran afirmando "nunca agendó". Eso no es una señal que falta: es
  // una señal INVENTADA, y es justo lo que el encabezado promete no hacer.
  const nivel = actividad.nivel;
  const noSePudoMirar = f.ultimaCita === null && f.citasTotales > 0;
  if (!noSePudoMirar && nivel === "sin-estrenar") {
    out.push({
      ...base,
      clave: `${f.id}:apagada`,
      motivo: "apagada",
      severidad: "medio",
      porQue: `${plural(f.pacientes, "paciente", "pacientes")} de alta, ninguna cita`,
      dato: "nunca agendó",
      gravedadDias: salud.diasDesdeAlta ?? 0,
      montoEnRiesgo: 0,
    });
  } else if (nivel === "apagada" || nivel === "enfriandose") {
    const dias = actividad.diasSinCita ?? 0;
    out.push({
      ...base,
      clave: `${f.id}:apagada`,
      motivo: "apagada",
      severidad: nivel === "apagada" ? "alto" : "medio",
      porQue: isSubscriptionActive(status)
        ? "figura activa y sigue pagando"
        : `estado: ${status ?? "sin estado"}`,
      dato: hace(dias),
      montoEnRiesgo: 0,
      gravedadDias: dias,
    });
  }

  // ── 5. Nadie entra ────────────────────────────────────────────────────────
  // Dos poblaciones, el mismo síntoma y la misma cura (llamarlos): quien ya
  // PAGA y ha dejado de entrar, y quien está en TRIAL y no ha entrado.
  //
  // Los cuatro estados operativos son los que antes recogía
  // `isSubscriptionActive(status) || isInTrial(f, now)`, uno por uno:
  // `pagando` y `cobro-fallido` (suscripción viva), `trial-vigente` y
  // `pago-pendiente` (periodo por delante sin pagar — el prospecto que se
  // enfría, que es el caso que cubría la tarjeta vieja «Trial inactivo»), más
  // `trial-vencido`, que el gate deja entrar y no se quiere perder.
  //
  // Si la clínica además está apagada (motivo 4), ese aviso es más fuerte y
  // este se calla: la misma ausencia no se cuenta dos veces. Y si está EN LÍNEA
  // ahora mismo, no hay nada que avisar.
  const yaApagada = out.some((s) => s.motivo === "apagada");
  const VIVA = ["pagando", "cobro-fallido", "trial-vigente", "pago-pendiente", "trial-vencido"] as const;
  const vivaOEnTrial = (VIVA as readonly string[]).includes(salud.estadoOperativo);
  if (!yaApagada && vivaOEnTrial && !actividad.enLinea) {
    const diasLogin = actividad.diasSinAcceso;
    // `null` = no hay registro de sesión, que NO es «nunca entró»: la tabla
    // solo guarda sesiones recientes. Solo se avisa de quien SÍ consta que
    // entraba y dejó de hacerlo. Ver el comentario de `ultimoAcceso`, y el
    // aviso `avisos.sinRegistroDeAcceso` de salud-clinica, que dice lo mismo.
    if (diasLogin !== null && diasLogin >= DIAS_SIN_LOGIN) {
      out.push({
        ...base,
        clave: `${f.id}:sin_login`,
        motivo: "sin_login",
        severidad: "medio",
        porQue: isSubscriptionActive(status)
          ? `suscripción ${status} · ${plural(f.pacientes, "paciente", "pacientes")}`
          : `trial vigente · ${plural(f.pacientes, "paciente", "pacientes")}`,
        // `isSubscriptionActive` aquí es redacción, no criterio: separa «paga»
        // de «no paga» para el texto. Quién entra en el grupo ya lo decidió
        // `VIVA` sobre el estado operativo.
        dato: `visto ${hace(diasLogin)}`,
        montoEnRiesgo: 0,
        gravedadDias: diasLogin,
      });
    }
  }

  // ── 6. Sin estado de suscripción ──────────────────────────────────────────
  // No es una alarma de dinero: es un dato que falta, y por eso se dice en vez
  // de suponerlo. Con `null`, plan-status trata la clínica como «sin
  // suscripción viva», así que su trial/vencimiento manda solo.
  if (status === null) {
    out.push({
      ...base,
      clave: `${f.id}:estado_desconocido`,
      motivo: "estado_desconocido",
      severidad: "medio",
      // ⚠️ El tercer estado de `algunaVezPago` otra vez: aquí sí se puede
      // decir «no se pudo leer», porque este texto es de la portada.
      porQue:
        f.algunaVezPago === null ? "no se pudo leer su histórico de pagos"
        : f.algunaVezPago ? "tiene pagos registrados, pero la fila no dice nada"
        : "sin pagos registrados",
      dato: "subscriptionStatus: null",
      montoEnRiesgo: 0,
      gravedadDias: salud.diasDesdeAlta ?? 0,
    });
  }

  return out;
}

/**
 * Orden dentro de un grupo: primero lo que más dinero arriesga, luego lo más
 * viejo, y el nombre como desempate para que dos renders seguidos den lo mismo.
 */
function comparaSenales(a: SenalAtencion, b: SenalAtencion): number {
  if (a.montoEnRiesgo !== b.montoEnRiesgo) return b.montoEnRiesgo - a.montoEnRiesgo;
  if (a.gravedadDias !== b.gravedadDias) return b.gravedadDias - a.gravedadDias;
  return a.clinicaNombre.localeCompare(b.clinicaNombre, "es");
}

/**
 * La portada entera: aparta las cuentas de prueba, saca las señales de cada
 * clínica real y las agrupa por motivo. Grupos vacíos NO se devuelven — la
 * pantalla dice «nada que atender» una sola vez, no cinco tarjetas mudas.
 */
export function construirPortada(filas: FilaPortada[], now: Date): Portada {
  const cuentasDePrueba: { id: string; nombre: string }[] = [];
  const archivadas: { id: string; nombre: string }[] = [];
  const reales: { fila: FilaPortada; salud: SaludClinica }[] = [];

  for (const f of filas) {
    // El archivado manda sobre «parece de prueba»: una clínica archivada se
    // apagó a propósito y se nombra como tal. Se decide ANTES de valorar, para
    // no gastar el cálculo en una clínica que no se va a enseñar.
    if (f.archivedAt) { archivadas.push({ id: f.id, nombre: f.nombre }); continue; }
    // UNA sola evaluación por clínica, que luego se reparte: `esCuentaDePrueba`
    // y `senalesDeClinica` la reciben en vez de recalcularla.
    const salud = saludDeFila(f, now);
    if (esCuentaDePrueba(f, now, salud)) cuentasDePrueba.push({ id: f.id, nombre: f.nombre });
    else reales.push({ fila: f, salud });
  }

  const porMotivo = new Map<MotivoAtencion, SenalAtencion[]>();
  const clinicasConSenal = new Set<string>();
  let senalesTotales = 0;

  for (const { fila: f, salud } of reales) {
    for (const s of senalesDeClinica(f, now, salud)) {
      const lista = porMotivo.get(s.motivo);
      if (lista) lista.push(s);
      else porMotivo.set(s.motivo, [s]);
      clinicasConSenal.add(s.clinicaId);
      senalesTotales += 1;
    }
  }

  const grupos: GrupoAtencion[] = ORDEN_MOTIVOS.flatMap((motivo) => {
    const senales = porMotivo.get(motivo);
    if (!senales || senales.length === 0) return [];
    senales.sort(comparaSenales);
    const meta = TITULOS[motivo];
    return [{
      motivo,
      severidad: meta.severidad,
      titulo: meta.titulo,
      criterio: meta.criterio,
      senales,
      monto: senales.reduce((s, x) => s + x.montoEnRiesgo, 0),
    }];
  });

  // Dentro del orden fijo de motivos, la severidad manda: si un día se añade un
  // motivo nuevo en medio, la lectura sigue siendo «lo más grave arriba».
  grupos.sort((a, b) => PESO_SEVERIDAD[a.severidad] - PESO_SEVERIDAD[b.severidad]);

  const dineroEnRiesgo = grupos.reduce((s, g) => s + g.monto, 0);
  const enLinea = reales.filter((r) => r.salud.actividad.enLinea).length;

  return {
    grupos,
    cuentasDePrueba,
    archivadas,
    totales: {
      clinicas: filas.length,
      dePrueba: cuentasDePrueba.length,
      archivadas: archivadas.length,
      reales: reales.length,
      conSenal: clinicasConSenal.size,
      enLinea,
      senales: senalesTotales,
      dineroEnRiesgo,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cuánto ha hecho cada clínica
//
// La sección de arriba contesta «qué se está rompiendo». Esta contesta «quién
// está trabajando», que no es lo mismo: una clínica puede no tener ninguna
// alarma y llevar tres semanas sin abrir una ficha.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaActividad {
  id: string;
  nombre: string;
  enLinea: boolean;
  /** Última sesión de panel. `null` = sin registro (no «nunca»). */
  ultimoAcceso: Date | null;
  actividad: ActividadClinica;
  actividadPrevia: ActividadClinica;
  /**
   * Variación del total contra la ventana anterior, en tanto por ciento
   * redondeado. `null` cuando la ventana anterior fue 0: de cero a algo no es
   * un porcentaje, es un arranque, y la UI lo dice con palabras.
   */
  cambioPct: number | null;
}

/**
 * Las clínicas ordenadas por lo que han hecho, de más a menos. Las cuentas de
 * prueba y las archivadas quedan fuera por el mismo criterio que arriba.
 *
 * Empate a 0: se ordena por nombre, para que dos renders seguidos den lo mismo.
 */
export function rankingActividad(filas: FilaPortada[], now: Date): FilaActividad[] {
  return filas
    .filter((f) => !f.archivedAt)
    .map((f) => ({ fila: f, salud: saludDeFila(f, now) }))
    .filter(({ fila, salud }) => !esCuentaDePrueba(fila, now, salud))
    .map(({ fila: f, salud }) => ({
      id: f.id,
      nombre: f.nombre,
      enLinea: salud.actividad.enLinea,
      ultimoAcceso: salud.actividad.ultimoAccesoAt,
      actividad: f.actividad,
      actividadPrevia: f.actividadPrevia,
      // La tendencia sale del MISMO cálculo que la de /admin/clinics, con su
      // misma regla: de cero a algo no es un porcentaje, es un arranque, y la
      // UI lo dice con palabras.
      cambioPct: salud.actividad.tendencia.deltaPct,
    }))
    .sort((a, b) => {
      const ta = totalActividad(a.actividad);
      const tb = totalActividad(b.actividad);
      if (ta !== tb) return tb - ta;
      return a.nombre.localeCompare(b.nombre, "es");
    });
}
