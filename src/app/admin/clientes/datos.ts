import "server-only";

/**
 * De dónde salen los datos de /admin/clientes.
 *
 * Un CLIENTE es la cuenta dueña (`User.supabaseId` con rol SUPER_ADMIN) y
 * puede tener varias clínicas. Esta capa carga esas clínicas con los MISMOS
 * agregados que /admin/clinics (ws1-t2) para poder pasárselos tal cual a
 * `evaluarSaludClinica`: si la lista de clínicas y la de clientes contaran la
 * actividad con criterios distintos, la misma clínica saldría apagada en una
 * pantalla y viva en la otra.
 *
 * COSTE: 1 consulta de precios (plan_configs, con caché) + 1 de dueños + dos
 * tandas de 5 consultas AGREGADAS + 2 del cupo de pacientes. Ni una consulta
 * por clínica: con 500 clínicas son las mismas 13. Las tandas van de 5 porque
 * por encima de 7 en paralelo el pooler se satura.
 *
 * /admin es la vista del dueño de la plataforma: estas consultas son
 * deliberadamente CROSS-TENANT (no llevan clinicId) y lo que las protege es el
 * gate de sesión del layout de /admin, no un filtro de tenant.
 *
 * LAS VENTANAS CORTAN EN LA MEDIANOCHE DE MÉRIDA (@/lib/admin/zona-horaria),
 * no en la del servidor: con el corte del servidor, a partir de las 18:00 de
 * Yucatán la actividad del día ya se contaba en el día siguiente.
 */
import { prisma } from "@/lib/prisma";
import { loadIncludedBranchIds, loadPlanPrices } from "@/lib/admin/mrr";
import { getPatientQuotaMany } from "@/lib/patient-quota";
import type { PatientQuota } from "@/lib/patient-quota-shared";
import {
  DIAS_VENTANA_ACTIVIDAD,
  MINUTOS_EN_LINEA,
  SUPERFICIE_PANEL,
} from "@/lib/admin/salud-clinica";
import { inicioDeHaceDias } from "@/lib/admin/zona-horaria";
import { repartirIngresos, INGRESOS_VACIOS } from "./cartera";
import type { ClienteCrudo, ClinicaDeCliente, IngresosCliente } from "./cartera";

/** Lo que la pantalla necesita para pintarse entera. */
export interface DatosClientes {
  clientes: ClienteCrudo[];
  /** Precios de lista desde plan_configs. NUNCA un número escrito a mano. */
  planPrices: Record<string, number>;
  /** El "ahora" del servidor: SSR e hidratación cuentan los mismos días. */
  ahoraISO: string;
}

const SELECT_DUENO = {
  supabaseId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  clinic: {
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      monthlyPrice: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      nextBillingDate: true,
      cancelRequested: true,
      createdAt: true,
      archivedAt: true,
      aiTokensUsed: true,
      aiTokensLimit: true,
      affiliate: { select: { name: true } },
    },
  },
} as const;

type FilaDueno = {
  supabaseId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  clinic: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    monthlyPrice: number | null;
    subscriptionStatus: string | null;
    trialEndsAt: Date;
    nextBillingDate: Date | null;
    cancelRequested: boolean;
    createdAt: Date;
    archivedAt: Date | null;
    aiTokensUsed: number;
    aiTokensLimit: number;
    affiliate: { name: string } | null;
  } | null;
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Los agregados de actividad, pago y cupo de un conjunto de clínicas.
 * Devuelve una función que arma la parte "medida" de cada clínica.
 */
async function medirClinicas(clinicIds: string[], ahora: Date, sedesIncluidas: Set<string>) {
  const desdeVentana = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD, ahora);
  const desdePrevia  = inicioDeHaceDias(DIAS_VENTANA_ACTIVIDAD * 2, ahora);
  const desdeEnLinea = new Date(ahora.getTime() - MINUTOS_EN_LINEA * 60_000);
  const en = { clinicId: { in: clinicIds } };

  // ── Primera tanda (5): ¿está viva? ──────────────────────────────────────
  const [citasPasadas, citasVentana, citasPrevias, citasFuturas, accesos] = await Promise.all([
    // Citas YA pasadas: cuántas y cuándo fue la última. "Última cita" tiene que
    // ser una que ocurrió; con _max sobre todas, una cita agendada para dentro
    // de un mes haría parecer viva a una clínica apagada.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { ...en, startsAt: { lte: ahora } },
      _count: { _all: true },
      _max: { startsAt: true },
    }),
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { ...en, startsAt: { gte: desdeVentana, lte: ahora } },
      _count: { _all: true },
    }),
    // La MISMA ventana, 30 días antes: es contra esto que se mide la tendencia.
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { ...en, startsAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["clinicId"],
      where: { ...en, startsAt: { gt: ahora } },
      _count: { _all: true },
      _min: { startsAt: true },
    }),
    // Quién está TRABAJANDO en el panel, y cuándo fue la última vez.
    //
    // ⛔ NO se usa User.lastLogin: está vacío en las 36 filas de producción
    // (nadie lo escribe), así que todos los clientes saldrían como "nadie ha
    // entrado nunca" — que es justo lo que la lista vieja mostraba en su
    // columna "Último acceso". La fuente buena es analytics_sessions con
    // surface="dashboard": surface="public" son visitas a la web, no gente
    // trabajando.
    prisma.analyticsSession.groupBy({
      by: ["clinicId"],
      where: { ...en, surface: SUPERFICIE_PANEL },
      _max: { lastSeenAt: true },
    }),
  ]);

  // ── Segunda tanda (5): ¿cuánto trabaja, y nos ha pagado? ────────────────
  const [facturasVentana, facturasPrevias, notasVentana, notasPrevias, pagos] = await Promise.all([
    // prisma.invoice = lo que la clínica factura a SUS pacientes.
    prisma.invoice.groupBy({
      by: ["clinicId"],
      where: { ...en, createdAt: { gte: desdeVentana } },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by: ["clinicId"],
      where: { ...en, createdAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    // "Notas" = expedientes / notas clínicas.
    prisma.medicalRecord.groupBy({
      by: ["clinicId"],
      where: { ...en, createdAt: { gte: desdeVentana } },
      _count: { _all: true },
    }),
    prisma.medicalRecord.groupBy({
      by: ["clinicId"],
      where: { ...en, createdAt: { gte: desdePrevia, lt: desdeVentana } },
      _count: { _all: true },
    }),
    // Lo que la clínica NOS ha pagado. Un solo pago basta para que deje de ser
    // "una prueba".
    prisma.subscriptionInvoice.groupBy({
      by: ["clinicId"],
      where: { ...en, status: "paid" },
      _count: { _all: true },
      _max: { paidAt: true },
      _sum: { amount: true },
    }),
  ]);

  // Cupo de pacientes: 2 consultas para todas las clínicas, no 2 por clínica.
  const cupos = await getPatientQuotaMany(clinicIds);

  const porClinica = <T extends { clinicId: string | null }>(filas: T[]) =>
    new Map(filas.filter((f) => f.clinicId !== null).map((f) => [f.clinicId as string, f]));

  const mPasadas     = porClinica(citasPasadas);
  const mVentana     = porClinica(citasVentana);
  const mPrevias     = porClinica(citasPrevias);
  const mFuturas     = porClinica(citasFuturas);
  const mAccesos     = porClinica(accesos);
  const mFactVentana = porClinica(facturasVentana);
  const mFactPrevias = porClinica(facturasPrevias);
  const mNotaVentana = porClinica(notasVentana);
  const mNotaPrevias = porClinica(notasPrevias);
  const mPagos       = porClinica(pagos);

  /** Cupo de una clínica que no salió del cálculo: sin tope conocido. */
  const cupoVacio: PatientQuota = { used: 0, max: null, remaining: null, unlimited: true, canCreate: true };

  return function medida(c: NonNullable<FilaDueno["clinic"]>): ClinicaDeCliente {
    const visto = mAccesos.get(c.id)?._max.lastSeenAt ?? null;
    return {
      id: c.id,
      nombre: c.name,
      slug: c.slug,
      plan: c.plan,
      monthlyPrice: c.monthlyPrice,
      subscriptionStatus: c.subscriptionStatus,
      trialEndsAt: iso(c.trialEndsAt),
      nextBillingDate: iso(c.nextBillingDate),
      cancelRequested: !!c.cancelRequested,
      createdAt: c.createdAt.toISOString(),
      archivada: c.archivedAt !== null,
      cupo: cupos[c.id] ?? cupoVacio,
      citasPasadas:          mPasadas.get(c.id)?._count._all ?? 0,
      citasVentana:          mVentana.get(c.id)?._count._all ?? 0,
      citasVentanaPrevia:    mPrevias.get(c.id)?._count._all ?? 0,
      citasFuturas:          mFuturas.get(c.id)?._count._all ?? 0,
      facturasVentana:       mFactVentana.get(c.id)?._count._all ?? 0,
      facturasVentanaPrevia: mFactPrevias.get(c.id)?._count._all ?? 0,
      notasVentana:          mNotaVentana.get(c.id)?._count._all ?? 0,
      notasVentanaPrevia:    mNotaPrevias.get(c.id)?._count._all ?? 0,
      ultimaCitaAt:   iso(mPasadas.get(c.id)?._max.startsAt ?? null),
      proximaCitaAt:  iso(mFuturas.get(c.id)?._min.startsAt ?? null),
      ultimoAccesoAt: iso(visto),
      // "En línea" = sesión de panel vista en los últimos MINUTOS_EN_LINEA.
      enLinea: visto !== null && visto >= desdeEnLinea,
      pagosRegistrados: mPagos.get(c.id)?._count._all ?? 0,
      ultimoPagoAt:  iso(mPagos.get(c.id)?._max.paidAt ?? null),
      totalPagado:   mPagos.get(c.id)?._sum.amount ?? 0,
      aiTokensUsed:  c.aiTokensUsed ?? 0,
      aiTokensLimit: c.aiTokensLimit ?? 0,
      sedeIncluida:  sedesIncluidas.has(c.id),
    };
  };
}

/**
 * Los ingresos de suscripción del cliente: UNA consulta de sus cobros pagados,
 * repartidos por `repartirIngresos` (puro, en ./cartera) con los cortes del
 * calendario de Mérida. Son pocas filas por cliente, así que el reparto se
 * hace aquí y no con tres agregados distintos que podrían no cuadrar entre sí.
 */
async function medirIngresos(clinicIds: string[], ahora: Date): Promise<IngresosCliente> {
  const cobros = await prisma.subscriptionInvoice.findMany({
    where: { clinicId: { in: clinicIds }, status: "paid" },
    select: { amount: true, paidAt: true, createdAt: true },
  });
  return repartirIngresos(
    // La fecha REAL del cobro; si no se registró el pago, la de creación.
    cobros.map((c) => ({ monto: c.amount || 0, cuando: c.paidAt ?? c.createdAt })),
    ahora,
  );
}

/** Agrupa las filas User→Clinic por dueño y arma el cliente. */
function agrupar(filas: FilaDueno[], medida: (c: NonNullable<FilaDueno["clinic"]>) => ClinicaDeCliente): ClienteCrudo[] {
  const porDueno = new Map<string, FilaDueno[]>();
  for (const f of filas) {
    if (!f.clinic) continue;
    const lista = porDueno.get(f.supabaseId);
    if (lista) lista.push(f);
    else porDueno.set(f.supabaseId, [f]);
  }

  const clientes: ClienteCrudo[] = [];
  porDueno.forEach((grupo, supabaseId) => {
    const clinicas = grupo.map((f) => medida(f.clinic!));
    // El dueño puede tener varias filas de User (una por clínica): el nombre
    // sale de la primera que lo tenga, y si ninguna lo tiene, del email.
    const conNombre = grupo.find((f) => f.firstName || f.lastName) ?? grupo[0];
    const nombre = `${conNombre.firstName ?? ""} ${conNombre.lastName ?? ""}`.trim() || conNombre.email;
    const telefono = grupo.find((f) => f.phone)?.phone ?? null;
    const afiliado = grupo.find((f) => f.clinic?.affiliate)?.clinic?.affiliate?.name ?? null;
    // Alta del cliente = la de su clínica más antigua.
    const altaAt = clinicas.reduce(
      (min, c) => (c.createdAt < min ? c.createdAt : min),
      clinicas[0].createdAt,
    );
    clientes.push({ supabaseId, nombre, email: conNombre.email, telefono, afiliado, altaAt, clinicas });
  });

  return clientes;
}

/**
 * Todos los clientes con sus clínicas medidas.
 *
 * Las clínicas ARCHIVADAS (soft-delete de NOM-024 §7) quedan fuera: dejaron de
 * operar, así que ni suman MRR ni generan riesgos. En la ficha de un cliente sí
 * se cargan, marcadas, para que no desaparezcan sin explicación.
 */
export async function cargarClientes(): Promise<DatosClientes> {
  const ahora = new Date();
  // Fuera de las tandas de medirClinicas: loadPlanPrices hace su propio
  // Promise.all de 3 y loadIncludedBranchIds el suyo de 2 (5 en vuelo).
  // Las sedes incluidas se deciden sobre TODO el sistema, no sobre esta lista:
  // así el criterio es exactamente el de /admin/clinics.
  const [planPrices, sedesIncluidas] = await Promise.all([loadPlanPrices(), loadIncludedBranchIds()]);

  const filas = (await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, clinic: { archivedAt: null } },
    orderBy: { createdAt: "asc" },
    select: SELECT_DUENO,
  })) as unknown as FilaDueno[];

  const clinicIds = filas.map((f) => f.clinic?.id).filter((id): id is string => !!id);
  if (clinicIds.length === 0) {
    return { clientes: [], planPrices, ahoraISO: ahora.toISOString() };
  }

  const medida = await medirClinicas(clinicIds, ahora, sedesIncluidas);
  return { clientes: agrupar(filas, medida), planPrices, ahoraISO: ahora.toISOString() };
}

export interface DatosCliente {
  cliente: ClienteCrudo | null;
  planPrices: Record<string, number>;
  ahoraISO: string;
  /** Lo cobrado a este cliente, con los cortes de Mérida. */
  ingresos: IngresosCliente;
  /**
   * La cuenta no es DUEÑA de ninguna clínica: lo que se está enseñando son las
   * clínicas en las que tiene usuario. La ficha lo dice; callarlo la haría
   * pasar por un cliente que no es.
   */
  soloComoUsuario: boolean;
}

/**
 * Un solo cliente, con sus clínicas archivadas incluidas y marcadas.
 *
 * ── Por qué hay dos consultas y no una ──────────────────────────────────────
 * El universo BUENO es el mismo que el de la lista: las clínicas de las que
 * esta cuenta es DUEÑA (`role: "SUPER_ADMIN"`). Sin ese filtro, una fila de
 * usuario de este supabaseId en la clínica de OTRO dueño entraría en la
 * cartera y sumaría su MRR, sus riesgos y su cupo.
 *
 * Pero /admin/clinics enlaza a esta ficha con el `supabaseId` del primer
 * usuario de la clínica cuando esa clínica no tiene ninguna fila SUPER_ADMIN
 * (pasa si el dueño se dio de baja por ARCO y queda el personal). Con el
 * filtro a secas ese enlace se volvía un 404. Así que si no es dueña de nada,
 * se cae al universo viejo y se pinta la ficha AVISANDO de lo que es: un
 * enlace muerto esconde el problema, y esto lo enseña.
 */
export async function cargarCliente(supabaseId: string): Promise<DatosCliente> {
  const ahora = new Date();
  const [planPrices, sedesIncluidas] = await Promise.all([loadPlanPrices(), loadIncludedBranchIds()]);

  const comoDuena = (await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", supabaseId, isActive: true },
    select: SELECT_DUENO,
  })) as unknown as FilaDueno[];

  const conClinica = (fs: FilaDueno[]) => fs.filter((f) => !!f.clinic);

  let filas = conClinica(comoDuena);
  let soloComoUsuario = false;

  if (filas.length === 0) {
    const comoUsuario = (await prisma.user.findMany({
      where: { supabaseId, isActive: true },
      select: SELECT_DUENO,
    })) as unknown as FilaDueno[];
    filas = conClinica(comoUsuario);
    soloComoUsuario = filas.length > 0;
  }

  const clinicIds = filas.map((f) => f.clinic!.id);
  if (clinicIds.length === 0) {
    return {
      cliente: null,
      planPrices,
      ahoraISO: ahora.toISOString(),
      ingresos: INGRESOS_VACIOS,
      soloComoUsuario: false,
    };
  }

  // En serie con medirClinicas, no en paralelo: esa ya abre sus dos tandas.
  const medida = await medirClinicas(clinicIds, ahora, sedesIncluidas);
  const ingresos = await medirIngresos(clinicIds, ahora);
  const clientes = agrupar(filas, medida);
  return {
    cliente: clientes[0] ?? null,
    planPrices,
    ahoraISO: ahora.toISOString(),
    ingresos,
    soloComoUsuario,
  };
}

