/**
 * LA CARTERA DE UN CLIENTE — puro, sin Prisma y sin React.
 *
 * Un CLIENTE de DaleControl no es una clínica: es la cuenta dueña
 * (`User.supabaseId` con rol SUPER_ADMIN), y puede tener varias clínicas, cada
 * una con SU plan, SU periodo y SU actividad. La lista de /admin/clientes
 * enseñaba solo agregados (MRR, "Health", pacientes), así que **una clínica
 * apagada o con el trial vencido desaparecía dentro del promedio del cliente**:
 * la fila decía "Activo · Health 78" mientras una de sus dos sedes llevaba dos
 * meses sin una cita.
 *
 * Aquí se junta lo que ya existe, sin inventar una segunda versión de nada:
 *   • el veredicto POR CLÍNICA lo da `evaluarSaludClinica`
 *     (@/lib/admin/salud-clinica, de ws1-t2) — estado operativo, actividad,
 *     riesgos, si es una cuenta de prueba;
 *   • el DINERO lo da `computeMrr` (@/lib/admin/mrr-core) — solo clínicas
 *     `active`, precios de `plan_configs` y el precio negociado manda;
 *   • el CUPO de pacientes lo agrega `aggregatePatientQuotas`.
 *
 * Lo único que se decide en este archivo es cómo se SUMAN esas piezas cuando
 * el dueño es el mismo: el estado de la cartera, qué riesgo sube primero y con
 * qué prioridad se llama al cliente.
 *
 * Se prueba con `npm run test:cartera-clientes`.
 */
import {
  computeMrr,
  type AdminMrr,
  type MrrClinicRow,
} from "@/lib/admin/mrr-core";
import {
  evaluarSaludClinica,
  resumirCartera,
  type DireccionTendencia,
  type EntradaSaludClinica,
  type ResumenCartera,
  type RiesgoClinica,
  type SaludClinica,
  type Severidad,
  type VolumenActividad,
} from "@/lib/admin/salud-clinica";
import {
  aggregatePatientQuotas,
  type PatientQuota,
} from "@/lib/patient-quota-shared";
import { cortesAdmin, diaAdmin, LOCALE_ADMIN, ZONA_ADMIN } from "@/lib/admin/zona-horaria";

// ── Lo que baja del servidor ───────────────────────────────────────────────
// Fechas en ISO (string) a propósito: es lo que sobrevive al paso de un server
// component a un client component sin que Next tenga que serializar Date.

/** Una clínica del cliente con sus agregados ya contados por el servidor. */
export interface ClinicaDeCliente {
  id: string;
  nombre: string;
  slug: string;
  plan: string;
  /** Precio NEGOCIADO. Manda sobre el de lista en el MRR; 0/null = sin negociar. */
  monthlyPrice: number | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  cancelRequested: boolean;
  createdAt: string;
  /** Soft-delete de la clínica: sale de los totales, pero no se esconde. */
  archivada: boolean;
  /** Consumo y tope del plan de ESTA sede. */
  cupo: PatientQuota;
  citasPasadas: number;
  citasVentana: number;
  citasVentanaPrevia: number;
  citasFuturas: number;
  facturasVentana: number;
  facturasVentanaPrevia: number;
  notasVentana: number;
  notasVentanaPrevia: number;
  ultimaCitaAt: string | null;
  proximaCitaAt: string | null;
  ultimoAccesoAt: string | null;
  enLinea: boolean;
  pagosRegistrados: number;
  ultimoPagoAt: string | null;
  totalPagado: number;
  aiTokensUsed: number;
  aiTokensLimit: number;
}

/** El cliente tal cual sale de la base, antes de valorarlo. */
export interface ClienteCrudo {
  supabaseId: string;
  nombre: string;
  email: string;
  telefono: string | null;
  /** Afiliado que lo trajo, si lo hay. */
  afiliado: string | null;
  /** Alta del cliente = alta de su clínica más antigua. */
  altaAt: string;
  clinicas: ClinicaDeCliente[];
}

// ── Lo que sale ────────────────────────────────────────────────────────────

/**
 * El estado de la CARTERA, que es una pregunta distinta a la de una clínica:
 * no es "¿esta paga?" sino "¿este cliente nos paga por todo lo que usa?".
 */
export type EstadoCliente =
  /** Todas sus clínicas reales están pagando. */
  | "pagando"
  /** Paga por unas y por otras no. Es el caso que la lista vieja escondía. */
  | "mixto"
  /** Ninguna paga todavía, pero alguna tiene periodo por delante. */
  | "en-trial"
  /** Ninguna paga y ninguna tiene periodo por delante: no entra dinero. */
  | "sin-cobro"
  /** Todas sus clínicas son cuentas de prueba: no es un cliente. */
  | "prueba";

export const ETIQUETA_ESTADO_CLIENTE: Record<EstadoCliente, string> = {
  "pagando":   "Pagando",
  "mixto":     "Paga en parte",
  "en-trial":  "En trial",
  "sin-cobro": "Sin cobro",
  "prueba":    "Prueba",
};

/** Un riesgo con la clínica que lo produce: sin el nombre no sirve para llamar. */
export interface RiesgoDeCliente {
  clinicaId: string;
  clinicaNombre: string;
  riesgo: RiesgoClinica;
}

/** Una clínica ya valorada: su veredicto y lo que aporta al mes. */
export interface ClinicaValorada {
  clinica: ClinicaDeCliente;
  salud: SaludClinica;
  /** Lo que ESTA clínica aporta al MRR del cliente (0 si no está `active`). */
  mrr: number;
}

/**
 * Cómo va el trabajo del cliente contra los 30 días anteriores. Misma regla
 * que la de una clínica (`calcularTendencia`): de cero a algo NO es un
 * porcentaje, así que `deltaPct` es null y la dirección la decide el signo.
 */
export interface TendenciaCliente {
  actual: VolumenActividad;
  previo: VolumenActividad;
  direccion: DireccionTendencia;
  deltaPct: number | null;
}

/** Una fila de /admin/clientes. */
export interface FilaCliente {
  supabaseId: string;
  nombre: string;
  email: string;
  telefono: string | null;
  afiliado: string | null;
  altaAt: Date;
  /** Todas sus clínicas, archivadas incluidas, en orden de atención. */
  clinicas: ClinicaValorada[];
  /** Las que cuentan: las no archivadas. */
  vigentes: ClinicaValorada[];
  /** Las archivadas, que se enseñan aparte y no suman en ningún total. */
  archivadas: ClinicaValorada[];
  /** Los totales de su cartera, contados con la misma regla que /admin/clinics. */
  resumen: ResumenCartera;
  estado: EstadoCliente;
  /** Desglose del MRR del cliente por plan. `mrr.total` es lo que cobra al mes. */
  mrr: AdminMrr;
  /** Todo lo que hay que atender, de lo más grave a lo menos. */
  riesgos: RiesgoDeCliente[];
  /** La severidad del riesgo que encabeza la fila. null = nada que atender. */
  severidadMaxima: Severidad | null;
  /** Cuanto más alto, antes se le llama. */
  prioridad: number;
  /** Tiene al menos una clínica que no es de prueba. */
  esReal: boolean;
  /**
   * No le queda ninguna clínica vigente (todas archivadas). NO es lo mismo que
   * ser una cuenta de prueba: un cliente que pagó catorce meses y cerró su
   * clínica también llega aquí con `esReal` en false, y llamarle "prueba"
   * sería mentir sobre su historia. La pantalla las distingue.
   */
  sinSedesVigentes: boolean;
  /** Cupo de pacientes sumado de sus clínicas vigentes. */
  cupo: PatientQuota;
  /** Alguien de alguna de sus clínicas está en el panel ahora mismo. */
  enLinea: boolean;
  /** El acceso más reciente de cualquiera de sus clínicas. */
  ultimoAccesoAt: Date | null;
  /** Citas ya ocurridas, sumadas. El número que la lista vieja enseñaba. */
  citasPasadas: number;
  /** Trabajo de sus clínicas en la ventana, contra la ventana anterior. */
  tendencia: TendenciaCliente;
}

// ── El cálculo ─────────────────────────────────────────────────────────────

/** La entrada que `evaluarSaludClinica` espera, armada desde una clínica. */
function aEntradaSalud(c: ClinicaDeCliente): EntradaSaludClinica {
  return {
    id: c.id,
    createdAt: c.createdAt,
    subscriptionStatus: c.subscriptionStatus,
    trialEndsAt: c.trialEndsAt,
    nextBillingDate: c.nextBillingDate,
    cancelRequested: c.cancelRequested,
    pacientes: c.cupo.used,
    citasPasadas: c.citasPasadas,
    citasVentana: c.citasVentana,
    facturasVentana: c.facturasVentana,
    notasVentana: c.notasVentana,
    citasVentanaPrevia: c.citasVentanaPrevia,
    facturasVentanaPrevia: c.facturasVentanaPrevia,
    notasVentanaPrevia: c.notasVentanaPrevia,
    enLinea: c.enLinea,
    ultimaCitaAt: c.ultimaCitaAt,
    proximaCitaAt: c.proximaCitaAt,
    ultimoAccesoAt: c.ultimoAccesoAt,
    pagosRegistrados: c.pagosRegistrados,
    ultimoPagoAt: c.ultimoPagoAt,
  };
}

/** Lo que `computeMrr` necesita de una clínica. */
function aFilaMrr(c: ClinicaDeCliente): MrrClinicRow {
  return { plan: c.plan, monthlyPrice: c.monthlyPrice, subscriptionStatus: c.subscriptionStatus };
}

/**
 * El estado de la cartera. "Paga en parte" es el estado que motivó todo esto:
 * un cliente con una sede pagando y otra con el trial vencido NO es un cliente
 * activo, aunque el promedio dijera que sí.
 */
export function estadoDeCartera(saludes: SaludClinica[]): EstadoCliente {
  const reales = saludes.filter((s) => !s.esPrueba);
  if (reales.length === 0) return "prueba";

  const pagando = reales.filter((s) => s.estadoOperativo === "pagando").length;
  if (pagando === reales.length) return "pagando";
  if (pagando > 0) return "mixto";
  if (reales.some((s) => s.estadoOperativo === "trial-vigente")) return "en-trial";
  return "sin-cobro";
}

/**
 * A quién se llama primero. Manda la clínica MÁS grave del cliente; las demás
 * suman un décimo, para que entre dos clientes con la misma peor clínica salga
 * antes el que además tiene otras dos ardiendo. No se suman a peso completo a
 * propósito: un cliente con cinco avisos medios no debe adelantar a uno con un
 * crítico.
 */
export function prioridadDeCliente(saludes: SaludClinica[]): number {
  const prioridades = saludes.map((s) => s.prioridad).filter((p) => p > 0);
  if (prioridades.length === 0) return 0;
  const mayor = Math.max(...prioridades);
  const resto = prioridades.reduce((s, p) => s + p, 0) - mayor;
  return Math.round((mayor + resto / 10) * 100) / 100;
}

function sumarVolumenes(vs: VolumenActividad[]): VolumenActividad {
  return vs.reduce(
    (a, v) => ({
      citas: a.citas + v.citas,
      facturas: a.facturas + v.facturas,
      notas: a.notas + v.notas,
      total: a.total + v.total,
    }),
    { citas: 0, facturas: 0, notas: 0, total: 0 },
  );
}

/** El trabajo del cliente entero, y cómo va contra la ventana anterior. */
export function tendenciaDeCliente(vigentes: ClinicaValorada[]): TendenciaCliente {
  const actual = sumarVolumenes(vigentes.map((v) => v.salud.actividad.volumen));
  const previo = sumarVolumenes(vigentes.map((v) => v.salud.actividad.tendencia.previo));

  let direccion: DireccionTendencia = "igual";
  if (actual.total > previo.total) direccion = "sube";
  else if (actual.total < previo.total) direccion = "baja";

  return {
    actual,
    previo,
    direccion,
    deltaPct: previo.total === 0 ? null : Math.round(((actual.total - previo.total) / previo.total) * 100),
  };
}

/** Valora UNA cartera: un cliente entra, su fila sale. */
export function valorarCliente(
  cliente: ClienteCrudo,
  planPrices: Record<string, number>,
  ahora: Date = new Date(),
): FilaCliente {
  const valoradas: ClinicaValorada[] = cliente.clinicas.map((clinica) => ({
    clinica,
    salud: evaluarSaludClinica(aEntradaSalud(clinica), ahora),
    // El MRR de UNA clínica sale de la misma función que el global: así la
    // suma de las filas y el total de la cabecera no pueden discrepar.
    mrr: computeMrr(
      // computeMrr no filtra por estado: el universo lo decide quien llama.
      [clinica].filter((c) => c.subscriptionStatus === "active").map(aFilaMrr),
      planPrices,
    ).total,
  }));

  const vigentes   = valoradas.filter((v) => !v.clinica.archivada);
  const archivadas = valoradas.filter((v) => v.clinica.archivada);

  const saludes = vigentes.map((v) => v.salud);
  const resumen = resumirCartera(saludes);

  const mrr = computeMrr(
    vigentes.filter((v) => v.clinica.subscriptionStatus === "active").map((v) => aFilaMrr(v.clinica)),
    planPrices,
  );

  const riesgos: RiesgoDeCliente[] = [];
  for (const v of vigentes) {
    for (const riesgo of v.salud.riesgos) {
      riesgos.push({ clinicaId: v.clinica.id, clinicaNombre: v.clinica.nombre, riesgo });
    }
  }
  // De lo más grave a lo menos, y entre iguales manda la clínica peor parada.
  riesgos.sort((a, b) => {
    const pa = PESO[a.riesgo.severidad], pb = PESO[b.riesgo.severidad];
    if (pa !== pb) return pb - pa;
    const sa = saludDe(vigentes, a.clinicaId), sb = saludDe(vigentes, b.clinicaId);
    return sb - sa;
  });

  const cupo = aggregatePatientQuotas(vigentes.map((v) => v.clinica.cupo));

  let ultimoAccesoAt: Date | null = null;
  for (const v of vigentes) {
    const acceso = v.salud.actividad.ultimoAccesoAt;
    if (acceso && (!ultimoAccesoAt || acceso > ultimoAccesoAt)) ultimoAccesoAt = acceso;
  }

  // Las clínicas del cliente, ordenadas como se atienden: primero la que arde.
  const porAtencion = valoradas.slice().sort((a, b) => {
    if (a.clinica.archivada !== b.clinica.archivada) return a.clinica.archivada ? 1 : -1;
    return b.salud.prioridad - a.salud.prioridad;
  });

  return {
    supabaseId: cliente.supabaseId,
    nombre: cliente.nombre,
    email: cliente.email,
    telefono: cliente.telefono,
    afiliado: cliente.afiliado,
    altaAt: new Date(cliente.altaAt),
    clinicas: porAtencion,
    vigentes,
    archivadas,
    resumen,
    estado: estadoDeCartera(saludes),
    mrr,
    riesgos,
    severidadMaxima: riesgos.length ? riesgos[0].riesgo.severidad : null,
    prioridad: prioridadDeCliente(saludes),
    esReal: resumen.reales > 0,
    sinSedesVigentes: vigentes.length === 0,
    cupo,
    enLinea: vigentes.some((v) => v.salud.actividad.enLinea),
    ultimoAccesoAt,
    citasPasadas: vigentes.reduce((s, v) => s + v.clinica.citasPasadas, 0),
    tendencia: tendenciaDeCliente(vigentes),
  };
}

const PESO: Record<Severidad, number> = { critico: 300, alto: 200, medio: 100 };

function saludDe(vigentes: ClinicaValorada[], clinicaId: string): number {
  const v = vigentes.find((x) => x.clinica.id === clinicaId);
  return v ? v.salud.prioridad : 0;
}

/** Valora la lista entera. */
export function valorarClientes(
  clientes: ClienteCrudo[],
  planPrices: Record<string, number>,
  ahora: Date = new Date(),
): FilaCliente[] {
  return clientes.map((c) => valorarCliente(c, planPrices, ahora));
}

// ── Totales de la pantalla ─────────────────────────────────────────────────

export interface ResumenClientes {
  /** Filas cargadas, cuentas de prueba incluidas. */
  total: number;
  /** Clientes de verdad: los que tienen al menos una clínica que no es prueba. */
  reales: number;
  /** Cuentas cuyas clínicas son TODAS de prueba. Fuera de cualquier total. */
  pruebas: number;
  /** Clientes reales con más de una clínica vigente. */
  multiClinica: number;
  /** Clientes con algo que atender hoy. */
  enAtencion: number;
  criticos: number;
  /** Clientes que pagan por unas clínicas y por otras no. */
  mixtos: number;
  /** Clientes con al menos una clínica apagada. */
  conApagada: number;
  /** Clientes con al menos una clínica de trial vencido que sigue con acceso. */
  conTrialVencido: number;
  /** Clientes con alguien trabajando en el panel ahora mismo. */
  enLinea: number;
  /**
   * MRR sumado de los clientes de la lista. Los PRECIOS y la regla de qué
   * clínica cobra son los mismos que en /admin/clinics (computeMrr sobre las
   * `active`), pero el UNIVERSO no: aquí sólo entran las clínicas que tienen
   * una cuenta dueña activa, y allí entra toda clínica no archivada. Una
   * clínica cuyo dueño quedó `isActive: false` suma allá y no aquí.
   */
  mrrTotal: number;
  /** Clínicas vigentes de clientes reales. */
  clinicas: number;
}

export function resumirClientes(filas: FilaCliente[]): ResumenClientes {
  const reales = filas.filter((f) => f.esReal);
  return {
    total: filas.length,
    reales: reales.length,
    pruebas: filas.length - reales.length,
    multiClinica: reales.filter((f) => f.vigentes.length > 1).length,
    enAtencion: reales.filter((f) => f.riesgos.length > 0).length,
    criticos: reales.filter((f) => f.severidadMaxima === "critico").length,
    mixtos: reales.filter((f) => f.estado === "mixto").length,
    conApagada: reales.filter((f) => f.resumen.porActividad.apagada > 0).length,
    conTrialVencido: reales.filter((f) => f.resumen.porEstado["trial-vencido"] > 0).length,
    enLinea: reales.filter((f) => f.enLinea).length,
    // Se suma sobre TODAS las filas, pruebas incluidas, y así tiene que ser:
    // /admin/clinics tampoco las excluye, y esconder dinero de un lado y no
    // del otro es justo lo que hace que las dos pantallas no cuadren.
    //
    // ⚠️ El comentario que había aquí decía que una cuenta de prueba «aporta 0
    // por definición, no tiene suscripción activa». Es FALSO y se corrigió el
    // 21-sep-2026: `evaluarPrueba` (salud-clinica.ts) mira pacientes, citas
    // pasadas y pagos registrados — jamás `subscriptionStatus`. Una clínica
    // `active` sin pacientes, sin citas y sin cobro registrado es `esPrueba` y
    // aporta su MRR completo. Sumarla sigue siendo lo correcto; lo que no lo
    // era es el motivo.
    //
    // Consecuencia que esta capa NO arregla y que hay que saber: el «por
    // cliente» de la pantalla divide este total (todas las filas) entre
    // `reales` (sólo las que no son prueba). Con una cuenta de prueba que
    // aporte dinero, el promedio sale alto.
    mrrTotal: filas.reduce((s, f) => s + f.mrr.total, 0),
    clinicas: reales.reduce((s, f) => s + f.vigentes.length, 0),
  };
}

/** Los clientes que exigen atención hoy, del más grave al menos. */
export function ordenarPorAtencionCliente(filas: FilaCliente[]): FilaCliente[] {
  return filas
    .filter((f) => f.riesgos.length > 0)
    .sort((a, b) => b.prioridad - a.prioridad);
}


// ── Ingresos: los cortes que descuadraban las métricas ─────────────────────

/** Un cobro ya pagado, con la fecha REAL en que entró el dinero. */
export interface CobroPagado {
  monto: number;
  /** `paidAt` y, si falta, `createdAt`: el mismo criterio que el dashboard. */
  cuando: Date | string | null;
}

/**
 * Lo que este cliente NOS ha pagado, cortado por el calendario de MÉRIDA.
 *
 * El corte es el punto: con el día del SERVIDOR (UTC en producción), a partir
 * de las 18:00 de Yucatán los cobros de hoy ya se sumaban a mañana. Aquí
 * "hoy", "este mes" y "este año" son los de Mérida, y los meses de la serie
 * también.
 */
export interface IngresosCliente {
  hoy: number;
  mes: number;
  anio: number;
  /** Todo lo cobrado desde el alta. */
  historico: number;
  /** Los últimos 12 meses, del más viejo al de hoy. */
  serie: { label: string; value: number }[];
  /** Cuántos cobros se contaron. Sin esto, un 0 no se distingue de "no hay". */
  cobros: number;
}

export const INGRESOS_VACIOS: IngresosCliente = {
  hoy: 0, mes: 0, anio: 0, historico: 0, serie: [], cobros: 0,
};

/** Clave "YYYY-MM" del mes de Mérida al que pertenece un instante. */
function mesAdmin(fecha: Date): string {
  return diaAdmin(fecha).slice(0, 7);
}

/** Los últimos `meses` meses del calendario de Mérida, del más viejo al de hoy. */
export function ultimosMeses(ahora: Date, meses: number): { clave: string; label: string }[] {
  const [anioHoy, mesHoy] = mesAdmin(ahora).split("-").map(Number);
  const etiqueta = new Intl.DateTimeFormat(LOCALE_ADMIN, { timeZone: ZONA_ADMIN, month: "short" });
  const salida: { clave: string; label: string }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    // Día 15 a mediodía UTC: ningún desfase de zona lo saca de su mes.
    const d = new Date(Date.UTC(anioHoy, mesHoy - 1 - i, 15, 12));
    salida.push({
      clave: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: etiqueta.format(d),
    });
  }
  return salida;
}

/** Reparte los cobros en hoy / mes / año / serie. Puro: se prueba sin base. */
export function repartirIngresos(
  cobros: CobroPagado[],
  ahora: Date = new Date(),
  meses = 12,
): IngresosCliente {
  const cortes = cortesAdmin(ahora);
  const calendario = ultimosMeses(ahora, meses);
  const porMes: Record<string, number> = {};
  for (const m of calendario) porMes[m.clave] = 0;

  let hoy = 0, mes = 0, anio = 0, historico = 0;

  for (const c of cobros) {
    const monto = c.monto || 0;
    historico += monto;
    if (!c.cuando) continue;
    const cuando = c.cuando instanceof Date ? c.cuando : new Date(c.cuando);
    if (Number.isNaN(cuando.getTime())) continue;
    if (cuando >= cortes.hoy && cuando < cortes.finHoy) hoy += monto;
    if (cuando >= cortes.mes) mes += monto;
    if (cuando >= cortes.anio) anio += monto;
    const clave = mesAdmin(cuando);
    if (clave in porMes) porMes[clave] += monto;
  }

  return {
    hoy, mes, anio, historico,
    serie: calendario.map((m) => ({ label: m.label, value: porMes[m.clave] })),
    cobros: cobros.length,
  };
}
