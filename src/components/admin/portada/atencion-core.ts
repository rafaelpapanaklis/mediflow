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
 *  · NO decide si una clínica está vencida, en trial o al corriente: eso es
 *    `@/lib/plan-status` y se llama, nunca se copia a ojo (ver el comentario
 *    de ese archivo: una comparación propia de `trialEndsAt` contra hoy ya
 *    pintó como «Expirado» a una clínica al corriente).
 *  · NO calcula MRR ni precios: eso es `@/lib/admin/mrr` + `plan_configs`.
 *  · NO escribe nada. La portada es de LECTURA.
 */
import {
  getPlanStatus,
  isInTrial,
  isPlanExpired,
  isSubscriptionActive,
  daysUntil,
  PAYMENT_FAILED_STATUSES,
} from "@/lib/plan-status";
import { diasDeCalendario } from "@/lib/admin/zona-horaria";

/** Ventana que cuenta como «la clínica está usando la app». */
export const DIAS_ACTIVIDAD = 30;
/** Un trial que vence dentro de esta ventana es «de esta semana». */
export const DIAS_TRIAL_POR_VENCER = 7;
/** Sin citas en este plazo, la clínica se considera apagada (aviso). */
export const DIAS_APAGADA = 30;
/** Sin citas en este plazo, apagada de gravedad. */
export const DIAS_APAGADA_GRAVE = 60;
/** Sin entrar al panel en este plazo, aviso de baja. */
export const DIAS_SIN_LOGIN = 7;
/** Ventana de «en línea»: una sesión vista hace menos de esto está trabajando. */
export const MINUTOS_EN_LINEA = 15;

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
  /** Cita más reciente (pasada o futura). `null` = nunca tuvo ninguna. */
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
    criterio: `Plan vencido (regla del gate) y con citas en los últimos ${DIAS_ACTIVIDAD} días.`,
    severidad: "critico",
  },
  trial_por_vencer: {
    titulo: "Trial vence esta semana",
    criterio: `Trial o cortesía vigente que termina dentro de ${DIAS_TRIAL_POR_VENCER} días.`,
    severidad: "alto",
  },
  apagada: {
    titulo: "Se apagaron",
    criterio: `Sin una sola cita desde hace ${DIAS_APAGADA} días o más.`,
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

/**
 * Días de CALENDARIO de Mérida desde `fecha` hasta `now`. Negativo si es
 * futura, `null` sin fecha.
 *
 * De calendario y no tramos de 24 h a propósito: una cita de ayer a las 23:00
 * vista hoy a la 01:00 tiene que decir «hace 1 día», no «hace 0». Y va por la
 * zona del panel, no por la del runtime — ver `@/lib/admin/zona-horaria`.
 */
function diasDesde(fecha: Date | null, now: Date): number | null {
  if (!fecha) return null;
  if (Number.isNaN(fecha.getTime())) return null;
  return diasDeCalendario(fecha, now);
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Cuenta de prueba: 0 pacientes, 0 citas, nunca pagó y no debe nada.
 *
 * Se aparta para que no ensucie los totales de la portada — NO se borra, no se
 * toca y sigue contándose aparte y con nombre. La condición de «no debe nada»
 * es deliberada: una cuenta vacía que ya generó una factura pendiente es
 * dinero, no basura, y tiene que seguir viéndose.
 */
export function esCuentaDePrueba(f: FilaPortada): boolean {
  return (
    f.pacientes === 0 &&
    f.citasTotales === 0 &&
    totalActividad(f.actividad) === 0 &&
    // `=== false`, no `!f.algunaVezPago`: con `null` (no se pudo leer el
    // histórico) la clínica NO se aparta. Apartar por un dato que no se pudo
    // mirar es esconder una clínica de verdad detrás de un timeout.
    f.algunaVezPago === false &&
    f.montoPorCobrar === 0 &&
    f.cobrosFallidos === 0 &&
    !isSubscriptionActive(f.subscriptionStatus)
  );
}

/**
 * ¿La clínica está usando la app? Cualquier cosa hecha en la ventana (citas,
 * facturas o notas) o una sesión de panel dentro de ella.
 */
export function estaEnUso(f: FilaPortada, now: Date): boolean {
  if (totalActividad(f.actividad) > 0) return true;
  if (f.enLinea) return true;
  const dias = diasDesde(f.ultimoAcceso, now);
  return dias !== null && dias <= DIAS_ACTIVIDAD;
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

/**
 * Las señales de UNA clínica. Una clínica puede disparar varias (vencida y
 * además apagada); cada una vive en su grupo y se cuenta una sola vez por
 * clínica en `conSenal`.
 */
export function senalesDeClinica(f: FilaPortada, now: Date): SenalAtencion[] {
  const out: SenalAtencion[] = [];
  const estado = getPlanStatus(f, now);
  const status = f.subscriptionStatus;

  // ── 1. Cobro fallido ──────────────────────────────────────────────────────
  // Dos fuentes, porque miden cosas distintas y ninguna basta sola: la factura
  // en `failed` (Stripe rechazó ESE cargo) y el subscriptionStatus past_due /
  // unpaid (la suscripción entera está en reintentos). Una clínica puede tener
  // lo segundo sin que haya llegado todavía la factura fallida.
  const statusFallido = status !== null && PAYMENT_FAILED_STATUSES.has(status);
  if (f.cobrosFallidos > 0 || statusFallido) {
    const partes: string[] = [];
    if (f.cobrosFallidos > 0) partes.push(plural(f.cobrosFallidos, "cargo rechazado", "cargos rechazados"));
    if (statusFallido) partes.push(`suscripción en ${status}`);
    out.push({
      clave: `${f.id}:cobro_fallido`,
      motivo: "cobro_fallido",
      severidad: "critico",
      clinicaId: f.id,
      clinicaNombre: f.nombre,
      clinicaEnLinea: f.enLinea,
      porQue: partes.join(" · "),
      // Con importe, la UI pinta el dinero y este texto no se usa. Sin él
      // (past_due que todavía no ha generado factura fallida) se dice qué pasa,
      // que es más útil que un "sin dato" en la señal más grave del panel.
      dato: f.montoPorCobrar > 0 ? null : "sin factura fallida aún",
      montoEnRiesgo: f.montoPorCobrar,
      gravedadDias: estado.daysLeft !== null && estado.daysLeft < 0 ? -estado.daysLeft : 0,
    });
  }

  // ── 2. Usando sin plan vigente ────────────────────────────────────────────
  // isPlanExpired es la MISMA función que bloquea el panel. Si además hay
  // actividad, la clínica está trabajando con la puerta abierta sin pagar.
  if (isPlanExpired(f, now) && estaEnUso(f, now)) {
    const diasVencida = estado.daysLeft !== null ? -estado.daysLeft : null;
    out.push({
      clave: `${f.id}:usando_sin_plan`,
      motivo: "usando_sin_plan",
      severidad: "critico",
      clinicaId: f.id,
      clinicaNombre: f.nombre,
      clinicaEnLinea: f.enLinea,
      porQue:
        `${porQueSinPlan(status)}` +
        (diasVencida !== null && diasVencida > 0 ? ` · vencida hace ${plural(diasVencida, "día", "días")}` : ""),
      dato: resumenActividad(f.actividad, DIAS_ACTIVIDAD),
      montoEnRiesgo: 0,
      gravedadDias: diasVencida ?? 0,
    });
  }

  // ── 3. Trial que vence esta semana ────────────────────────────────────────
  // isInTrial, no una comparación propia: una clínica que PAGA nunca está en
  // trial aunque su periodo pagado termine en 3 días.
  if (isInTrial(f, now)) {
    const faltan = daysUntil(f.trialEndsAt, now);
    if (faltan !== null && faltan >= 0 && faltan <= DIAS_TRIAL_POR_VENCER) {
      out.push({
        clave: `${f.id}:trial_por_vencer`,
        motivo: "trial_por_vencer",
        severidad: "alto",
        clinicaId: f.id,
        clinicaNombre: f.nombre,
        clinicaEnLinea: f.enLinea,
        porQue: estaEnUso(f, now)
          ? `${plural(f.pacientes, "paciente", "pacientes")} · ${resumenActividad(f.actividad, DIAS_ACTIVIDAD)}`
          : "sin actividad en el trial",
        // `daysUntil` redondea hacia ARRIBA y `isInTrial` exige que el periodo
        // esté por delante, así que para un trial vivo nunca vale 0: una rama
        // "vence hoy" atada a `faltan === 0` sería código muerto. Y por ese
        // mismo redondeo, "1" puede ser cualquier cosa entre tres horas y un
        // día entero — se dice "o menos" en vez de afinar con una resta propia
        // de `trialEndsAt`, que es justo lo que plan-status-guard prohíbe.
        dato: faltan === 1 ? "en 1 día o menos" : `en ${plural(faltan, "día", "días")}`,
        montoEnRiesgo: 0,
        gravedadDias: DIAS_TRIAL_POR_VENCER - faltan,
      });
    }
  }

  // ── 4. Se apagaron ────────────────────────────────────────────────────────
  // Se mide por la cita MÁS RECIENTE, futura incluida: una clínica con una
  // cita agendada para la semana que viene está viva aunque hoy no tenga nada.
  const diasSinCitas = diasDesde(f.ultimaCita, now);
  if (f.ultimaCita === null) {
    // `ultimaCita` sale `null` por dos motivos MUY distintos: la clínica no ha
    // agendado nunca, o la agregación que la calcula no pudo correr. La que
    // los separa es `citasTotales`, que viene del `_count` de la clínica y no
    // depende de esa consulta.
    //
    // Sin esta comprobación, un timeout del pooler hacía que TODAS las
    // clínicas —incluida una con 900 citas— salieran afirmando "ninguna cita ·
    // nunca agendó". Eso no es una señal que falta: es una señal inventada, y
    // es justo lo que el encabezado de este módulo promete no hacer.
    if (f.pacientes > 0 && f.citasTotales === 0) {
      out.push({
        clave: `${f.id}:apagada`,
        motivo: "apagada",
        severidad: "medio",
        clinicaId: f.id,
        clinicaNombre: f.nombre,
        clinicaEnLinea: f.enLinea,
        porQue: `${plural(f.pacientes, "paciente", "pacientes")} de alta, ninguna cita`,
        dato: "nunca agendó",
        montoEnRiesgo: 0,
        gravedadDias: diasDesde(f.createdAt, now) ?? 0,
      });
    }
  } else if (diasSinCitas !== null && diasSinCitas >= DIAS_APAGADA) {
    out.push({
      clave: `${f.id}:apagada`,
      motivo: "apagada",
      severidad: diasSinCitas >= DIAS_APAGADA_GRAVE ? "alto" : "medio",
      clinicaId: f.id,
      clinicaNombre: f.nombre,
      clinicaEnLinea: f.enLinea,
      porQue: isSubscriptionActive(status)
        ? "figura activa y sigue pagando"
        : `estado: ${status ?? "sin estado"}`,
      dato: `hace ${plural(diasSinCitas, "día", "días")}`,
      montoEnRiesgo: 0,
      gravedadDias: diasSinCitas,
    });
  }

  // ── 5. Nadie entra ────────────────────────────────────────────────────────
  // Dos poblaciones, el mismo síntoma y la misma cura (llamarlos):
  //   · quien ya PAGA y ha dejado de entrar  → riesgo de baja
  //   · quien está en TRIAL y no ha entrado  → el prospecto que se enfría
  // La segunda es la que cubría la tarjeta vieja "Trial inactivo", y se cae
  // fuera de "trial vence esta semana" mientras le queden más de 7 días.
  //
  // Si la clínica además está apagada (motivo 4), ese aviso es más fuerte y
  // este se calla: la misma ausencia no se cuenta dos veces.
  const yaApagada = out.some((s) => s.motivo === "apagada");
  // Y si está EN LÍNEA ahora mismo, no hay nada que avisar.
  const vivaOEnTrial = isSubscriptionActive(status) || isInTrial(f, now);
  if (!yaApagada && vivaOEnTrial && !f.enLinea) {
    const diasLogin = diasDesde(f.ultimoAcceso, now);
    // `null` = no hay registro de sesión, que NO es «nunca entró»: la tabla
    // solo guarda sesiones recientes. Solo se avisa de quien SÍ consta que
    // entraba y dejó de hacerlo. Ver el comentario de `ultimoAcceso`.
    if (diasLogin !== null && diasLogin >= DIAS_SIN_LOGIN) {
      out.push({
        clave: `${f.id}:sin_login`,
        motivo: "sin_login",
        severidad: "medio",
        clinicaId: f.id,
        clinicaNombre: f.nombre,
        clinicaEnLinea: f.enLinea,
        porQue: isSubscriptionActive(status)
          ? `suscripción ${status} · ${plural(f.pacientes, "paciente", "pacientes")}`
          : `trial vigente · ${plural(f.pacientes, "paciente", "pacientes")}`,
        dato: `visto hace ${plural(diasLogin, "día", "días")}`,
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
      clave: `${f.id}:estado_desconocido`,
      motivo: "estado_desconocido",
      severidad: "medio",
      clinicaId: f.id,
      clinicaNombre: f.nombre,
      clinicaEnLinea: f.enLinea,
      porQue:
        f.algunaVezPago === null ? "no se pudo leer su histórico de pagos"
        : f.algunaVezPago ? "tiene pagos registrados, pero la fila no dice nada"
        : "sin pagos registrados",
      dato: "subscriptionStatus: null",
      montoEnRiesgo: 0,
      gravedadDias: diasDesde(f.createdAt, now) ?? 0,
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
  const reales: FilaPortada[] = [];

  for (const f of filas) {
    // El archivado manda sobre «parece de prueba»: una clínica archivada se
    // apagó a propósito y se nombra como tal.
    if (f.archivedAt) archivadas.push({ id: f.id, nombre: f.nombre });
    else if (esCuentaDePrueba(f)) cuentasDePrueba.push({ id: f.id, nombre: f.nombre });
    else reales.push(f);
  }

  const porMotivo = new Map<MotivoAtencion, SenalAtencion[]>();
  const clinicasConSenal = new Set<string>();
  let senalesTotales = 0;

  for (const f of reales) {
    for (const s of senalesDeClinica(f, now)) {
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
  const enLinea = reales.filter((f) => f.enLinea).length;

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
    .filter((f) => !f.archivedAt && !esCuentaDePrueba(f))
    .map((f) => {
      const ahora = totalActividad(f.actividad);
      const antes = totalActividad(f.actividadPrevia);
      return {
        id: f.id,
        nombre: f.nombre,
        enLinea: f.enLinea,
        ultimoAcceso: f.ultimoAcceso,
        actividad: f.actividad,
        actividadPrevia: f.actividadPrevia,
        cambioPct: antes === 0 ? null : Math.round(((ahora - antes) / antes) * 100),
      };
    })
    .sort((a, b) => {
      const ta = totalActividad(a.actividad);
      const tb = totalActividad(b.actividad);
      if (ta !== tb) return tb - ta;
      return a.nombre.localeCompare(b.nombre, "es");
    });
}
