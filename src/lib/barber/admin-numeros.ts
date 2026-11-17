// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — «Números del negocio» de una barbería, para su ficha
// en /admin/barberias/[id] (ws6-t1, 16-nov-2026).
//
// Rafael: «en admin en cada barbería debo poder ver cuántos clientes tiene,
// facturas pagadas, dinero etc. así como en dental». El dental enseña en la
// ficha de clínica Pacientes, Citas, Expedientes, Facturas e Ingresos
// (conteos y sumas, nunca listas de pacientes). Aquí, lo mismo de la
// barbería, POR MES (selector como «Actividad del panel») y con desglose por
// sede: clientes, citas, tickets y dinero (por medio, propinas aparte,
// contra el mes anterior), gastos, membresías, pedidos de la tienda,
// barberos, usuarios del panel y estrellas dadas.
//
// UNA SOLA FÓRMULA, NO OTRA:
//   · Dinero, tickets, promedio, propinas y gastos: cargarDineroDeSedes
//     (caja-dinero.ts) = la carga y el cajaResumen de Inicio y Reportes.
//   · Estrellas dadas: las visitas que dan estrella con los MISMOS
//     predicados del recuento (APPOINTMENT_GIVES_STAR y NOT_CANCELLED de
//     loyalty-core.ts), contadas en el mes.
//   · Membresías activas: el filtro de memberships.ts (ACTIVE y endAt > ahora).
//   · Pedidos pagados en línea: «pagado» = paid_at (tienda-core.ts).
//   · Meses: resolverMes / mesesDelSelector de la actividad (cortes en la
//     medianoche de Mérida, como el resto de /admin).
//
// ALCANCE: matriz → ella y TODAS sus sucursales (también las cerradas: su
// dinero del mes sigue siendo de la cadena); sucursal → solo ella. Los ids
// salen de la base a partir del [id] de la ficha, nunca de la petición.
//
// Solo AGREGADOS (groupBy / count / sum): ningún nombre ni teléfono de un
// cliente final sale de aquí. Lecturas en tandas de ≤ 6 (regla del pooler);
// el dinero va aparte porque cargarDineroDeSedes ya lanza las suyas.
//
// Sin "server-only" (como caja-dinero.ts): las pruebas lo importan con tsx.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSchemaBehindError } from "@/lib/barber/db-errors";
import { cargarDineroDeSedes, dineroDe, cambioPct } from "@/lib/barber/caja-dinero";
import type { CajaResumen, CountTotal, ResumenIncomeMethod } from "@/lib/barber/caja-resumen";
import { APPOINTMENT_GIVES_STAR, NOT_CANCELLED } from "@/lib/barber/loyalty-core";
import { mesesDelSelector, resolverMes, type MesUso } from "@/lib/barber/uso/actividad";

// ── DTO ─────────────────────────────────────────────────────────────────

export interface DineroMes {
  /** Todo lo cobrado (propinas incluidas, menos devoluciones de anticipo), como el resumen de Caja. */
  cobrado: number;
  /** Cobrado − propinas: el «Ingresos» de Inicio y Reportes. */
  ingresos: number;
  propinas: number;
  /** Por medio de cobro, con propinas (Σ = cobrado). */
  porMetodo: Record<ResumenIncomeMethod, CountTotal>;
  /** Tickets de venta vivos (sin membresías, anticipos ni devoluciones). */
  tickets: number;
  /** Σ subtotal de venta ÷ tickets (sin propina). */
  promedio: number;
  gastos: number;
  gastosCount: number;
}

export interface NumerosSede {
  id: string;
  nombre: string;
  esMatriz: boolean;
  activa: boolean;
  clientes: number;
  clientesNuevos: number;
  citas: { total: number; hechas: number; canceladas: number; noLlego: number };
  /** null = sin sql/barber_caja_completa.sql (no se mide el dinero). */
  dinero: DineroMes | null;
  membresiasActivas: number;
  /** null = sin la tabla de la tienda. */
  pedidos: { delMes: number; pagadosEnLinea: number; cobradoEnLinea: number } | null;
  barberosActivos: number;
  usuariosPanel: number;
  estrellasDadas: number;
}

export interface NumerosNegocio {
  mes: { clave: string; etiqueta: string };
  meses: Array<{ clave: string; etiqueta: string }>;
  anterior: { clave: string; etiqueta: string };
  /** true = ficha de una sucursal: solo esa sede. */
  esSucursal: boolean;
  /** La suma de todas las sedes (el dinero, con la fórmula sobre todas a la vez). */
  total: Omit<NumerosSede, "id" | "nombre" | "esMatriz" | "activa">;
  /** El dinero del mes anterior (toda la familia) y el cambio de lo cobrado. */
  dineroAnterior: DineroMes | null;
  cambioCobradoPct: number | null;
  /** Alguna sede llegó al tope de movimientos: gastos pueden estar incompletos. */
  truncado: boolean;
  /** Una fila por sede (la matriz primero). Con una sola sede, igual al total. */
  sedes: NumerosSede[];
  /** Cuánto tardó en el servidor (para medir; ms). */
  ms: number;
}

// ── Puro ────────────────────────────────────────────────────────────────

/** Del resumen de la Caja (cajaResumen) a lo que pinta la ficha. */
export function dineroMesDe(r: CajaResumen): DineroMes {
  const d = dineroDe(r);
  return {
    cobrado: d.charged,
    ingresos: d.income,
    propinas: d.tips,
    porMetodo: d.byMethod,
    tickets: r.tickets.count,
    promedio: r.tickets.average,
    gastos: r.expenses.total,
    gastosCount: r.expenses.count,
  };
}

/** «2026-03» → «2026-02»; «2026-01» → «2025-12». */
export function claveMesAnterior(clave: string): string {
  const [a, m] = clave.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
}

// ── Con base ────────────────────────────────────────────────────────────

interface SedeFila {
  id: string;
  name: string;
  branchName: string | null;
  parentId: string | null;
  isActive: boolean;
}

/** Las sedes de la ficha: matriz → ella + todas sus sucursales; sucursal → ella. null = no existe. */
export async function sedesDeLaFicha(
  barbershopId: string,
): Promise<{ sedes: SedeFila[]; esSucursal: boolean; timezone: string } | null> {
  const shop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: {
      id: true,
      name: true,
      branchName: true,
      parentId: true,
      isActive: true,
      timezone: true,
      branches: {
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, branchName: true, parentId: true, isActive: true },
      },
    },
  });
  if (!shop) return null;
  const { branches, timezone, ...yo } = shop;
  const tz = timezone || "America/Mexico_City";
  if (shop.parentId !== null) return { sedes: [yo], esSucursal: true, timezone: tz };
  return { sedes: [yo, ...branches], esSucursal: false, timezone: tz };
}

const porId = <T extends { barbershopId: string }>(rows: T[], f: (r: T) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.barbershopId, (m.get(r.barbershopId) ?? 0) + f(r));
  return m;
};

async function pedidosDeTienda(ids: string[], mes: MesUso) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ barbershop_id: string; del_mes: bigint | number; pagados: bigint | number; cobrado: Prisma.Decimal | string | null }>
    >(Prisma.sql`
      SELECT "barbershop_id",
             count(*) FILTER (WHERE "created_at" >= ${mes.desde} AND "created_at" < ${mes.hasta}) AS del_mes,
             count(*) FILTER (WHERE "paid_at" >= ${mes.desde} AND "paid_at" < ${mes.hasta}) AS pagados,
             coalesce(sum("total") FILTER (WHERE "paid_at" >= ${mes.desde} AND "paid_at" < ${mes.hasta}), 0) AS cobrado
        FROM "barber_product_orders"
       WHERE "barbershop_id" IN (${Prisma.join(ids)})
         AND (("created_at" >= ${mes.desde} AND "created_at" < ${mes.hasta})
           OR ("paid_at" >= ${mes.desde} AND "paid_at" < ${mes.hasta}))
       GROUP BY "barbershop_id"
    `);
    return new Map(
      rows.map((r) => [
        r.barbershop_id,
        {
          delMes: Number(r.del_mes),
          pagadosEnLinea: Number(r.pagados),
          cobradoEnLinea: new Prisma.Decimal(r.cobrado ?? 0).toDecimalPlaces(2).toNumber(),
        },
      ]),
    );
  } catch (e) {
    if (isSchemaBehindError(e)) return null;
    throw e;
  }
}

/**
 * Los números del mes (`claveMes` = «YYYY-MM»; otra cosa = el mes en curso)
 * de la barbería de la ficha. null = la barbería no existe. Quien llama YA
 * validó que es admin de DaleControl.
 */
export async function numerosDelNegocio(
  barbershopId: string,
  claveMes: string | null | undefined,
  ahora: Date = new Date(),
): Promise<NumerosNegocio | null> {
  const t0 = Date.now();
  const alcance = await sedesDeLaFicha(barbershopId);
  if (!alcance) return null;
  const ids = alcance.sedes.map((s) => s.id);
  const mes = resolverMes(claveMes, ahora);
  const anterior = resolverMes(claveMesAnterior(mes.clave), ahora);
  const enMes = { gte: mes.desde, lt: mes.hasta };
  const tz = alcance.timezone;

  // Tanda 1: conteos (6 lecturas a la vez, todas agregadas).
  const [clientes, nuevos, citas, barberos, usuarios, membresias] = await Promise.all([
    prisma.barberClient.groupBy({ by: ["barbershopId"], where: { barbershopId: { in: ids } }, _count: { _all: true } }),
    prisma.barberClient.groupBy({ by: ["barbershopId"], where: { barbershopId: { in: ids }, createdAt: enMes }, _count: { _all: true } }),
    prisma.barberAppointment.groupBy({ by: ["barbershopId", "status"], where: { barbershopId: { in: ids }, startAt: enMes }, _count: { _all: true } }),
    prisma.barber.groupBy({ by: ["barbershopId"], where: { barbershopId: { in: ids }, isActive: true }, _count: { _all: true } }),
    prisma.barberUser.groupBy({ by: ["barbershopId"], where: { barbershopId: { in: ids }, isActive: true }, _count: { _all: true } }),
    // Mismo filtro que «activeCount» de memberships.ts.
    prisma.barberClientMembership.groupBy({
      by: ["barbershopId"],
      where: { barbershopId: { in: ids }, status: "ACTIVE", endAt: { gt: ahora } },
      _count: { _all: true },
    }),
  ]);

  // Tanda 2: estrellas (las visitas que dan estrella, con los predicados del recuento) y la tienda.
  const [estrellasCita, estrellasMostrador, pedidos] = await Promise.all([
    prisma.barberAppointment.groupBy({
      by: ["barbershopId"],
      where: { barbershopId: { in: ids }, clientId: { not: null }, startAt: enMes, ...APPOINTMENT_GIVES_STAR },
      _count: { _all: true },
    }),
    prisma.barberSale.groupBy({
      by: ["barbershopId"],
      where: {
        barbershopId: { in: ids },
        clientId: { not: null },
        appointmentId: null,
        createdAt: enMes,
        items: { some: { serviceId: { not: null } } },
        ...NOT_CANCELLED,
      },
      _count: { _all: true },
    }),
    pedidosDeTienda(ids, mes),
  ]);

  // El dinero: la misma carga y fórmula de Inicio y Reportes. Mes y mes anterior, uno tras otro.
  const dinero = await cargarDineroDeSedes(ids, { from: mes.desde, to: mes.hasta }, { tz, porSede: true, now: ahora });
  const dineroPrev = await cargarDineroDeSedes(ids, { from: anterior.desde, to: anterior.hasta }, { tz, now: ahora });

  const c = (rows: Array<{ barbershopId: string; _count: { _all: number } }>) => porId(rows, (r) => r._count._all);
  const mClientes = c(clientes);
  const mNuevos = c(nuevos);
  const mBarberos = c(barberos);
  const mUsuarios = c(usuarios);
  const mMembresias = c(membresias);
  const mEstrellas = porId([...estrellasCita, ...estrellasMostrador], (r) => r._count._all);
  const citasDe = (id: string | null) => {
    const filas = citas.filter((r) => id === null || r.barbershopId === id);
    const n = (st: string) => filas.filter((r) => r.status === st).reduce((s, r) => s + r._count._all, 0);
    return { total: filas.reduce((s, r) => s + r._count._all, 0), hechas: n("DONE"), canceladas: n("CANCELLED"), noLlego: n("NO_SHOW") };
  };
  const suma = (m: Map<string, number>) => ids.reduce((s, id) => s + (m.get(id) ?? 0), 0);

  const sedes: NumerosSede[] = alcance.sedes.map((s) => {
    const r = dinero?.porSede?.get(s.id) ?? null;
    return {
      id: s.id,
      nombre: s.parentId ? s.branchName || s.name : s.name,
      esMatriz: s.parentId === null,
      activa: s.isActive,
      clientes: mClientes.get(s.id) ?? 0,
      clientesNuevos: mNuevos.get(s.id) ?? 0,
      citas: citasDe(s.id),
      dinero: r ? dineroMesDe(r) : null,
      membresiasActivas: mMembresias.get(s.id) ?? 0,
      pedidos: pedidos ? (pedidos.get(s.id) ?? { delMes: 0, pagadosEnLinea: 0, cobradoEnLinea: 0 }) : null,
      barberosActivos: mBarberos.get(s.id) ?? 0,
      usuariosPanel: mUsuarios.get(s.id) ?? 0,
      estrellasDadas: mEstrellas.get(s.id) ?? 0,
    };
  });

  const dineroTotal = dinero ? dineroMesDe(dinero.resumen) : null;
  const dineroAnterior = dineroPrev ? dineroMesDe(dineroPrev.resumen) : null;
  const pedidosTotal = pedidos
    ? sedes.reduce(
        (acc, s) => ({
          delMes: acc.delMes + (s.pedidos?.delMes ?? 0),
          pagadosEnLinea: acc.pagadosEnLinea + (s.pedidos?.pagadosEnLinea ?? 0),
          cobradoEnLinea: new Prisma.Decimal(acc.cobradoEnLinea).plus(s.pedidos?.cobradoEnLinea ?? 0).toNumber(),
        }),
        { delMes: 0, pagadosEnLinea: 0, cobradoEnLinea: 0 },
      )
    : null;

  return {
    mes: { clave: mes.clave, etiqueta: mes.etiqueta },
    meses: mesesDelSelector(ahora).map((m) => ({ clave: m.clave, etiqueta: m.etiqueta })),
    anterior: { clave: anterior.clave, etiqueta: anterior.etiqueta },
    esSucursal: alcance.esSucursal,
    total: {
      clientes: suma(mClientes),
      clientesNuevos: suma(mNuevos),
      citas: citasDe(null),
      dinero: dineroTotal,
      membresiasActivas: suma(mMembresias),
      pedidos: pedidosTotal,
      barberosActivos: suma(mBarberos),
      usuariosPanel: suma(mUsuarios),
      estrellasDadas: suma(mEstrellas),
    },
    dineroAnterior,
    cambioCobradoPct: dineroTotal && dineroAnterior ? cambioPct(dineroTotal.cobrado, dineroAnterior.cobrado) : null,
    truncado: Boolean(dinero?.dinero.truncated || dineroPrev?.dinero.truncated),
    sedes,
    ms: Date.now() - t0,
  };
}
