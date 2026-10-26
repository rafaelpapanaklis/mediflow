// Lo que lee la base para «Por cobrar = lo hecho menos lo pagado» (la regla en `por-cobrar.ts`).
//
// De un lote de facturas por cobrar, cuáles son NOTAS DE PLAN (`invoices."treatmentPlanId"`), con sus
// líneas y las filas de sus planes. Todo por SQL crudo (la columna y la tabla no están en Prisma) y
// con el `clinicId` de quien llama. Sin el SQL del plan (sql/plan-tratamiento-filas.sql), o si algo
// falla, devuelve un mapa VACÍO: cada factura se cuenta como hoy (saldo completo).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { columnaNotaDelPlanExiste, tablaDeFilasExiste } from "./items-db";
import type { EstadoDeFila } from "./items";
import type { FilaParaDeuda, NotaParaDeuda } from "./por-cobrar";

type DbCrudo = Pick<typeof prisma, "$queryRaw">;

export interface NotaDePlanLeida {
  planId: string;
  nota: NotaParaDeuda;
  /** Filas del plan por id (también las canceladas). */
  filas: Map<string, FilaParaDeuda>;
}

/** `invoiceId` → nota del plan. Lee como mucho dos consultas. */
export type LectorDeNotasDePlan = (clinicId: string, invoiceIds: string[]) => Promise<Map<string, NotaDePlanLeida>>;

interface NotaSql {
  id: string;
  treatmentPlanId: string;
  total: unknown;
  paid: unknown;
  createdAt: Date | string;
  items: unknown;
  discount: unknown;
  taxRate: unknown;
  taxIncluded: boolean | null;
}

interface FilaSql {
  id: string;
  planId: string;
  estado: string;
  hechoEn: Date | string | null;
  nombre: string;
  invoiceId: string | null;
  invoiceLinea: number | null;
}

const fecha = (x: Date | string | null): Date | null => (x == null ? null : x instanceof Date ? x : new Date(x));

/**
 * ¿Está el SQL del plan? Con el cliente de siempre, las sondas compartidas (recordadas, sin consultas
 * que fallen en el log de Postgres). Con otro cliente (Sabina con su transacción, un doble de prueba),
 * se le pregunta a ESE cliente: nunca a otra base que la de quien llama.
 */
async function sqlDelPlan(db: DbCrudo, cual: "columna" | "tabla"): Promise<boolean> {
  if (db === prisma) return cual === "columna" ? columnaNotaDelPlanExiste() : tablaDeFilasExiste();
  const r = cual === "columna"
    ? await db.$queryRaw<{ existe: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'treatmentPlanId'
        ) AS existe`
    : await db.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass('public.treatment_plan_items') IS NOT NULL AS existe`;
  return r[0]?.existe === true;
}

/** Tanda máxima de ids por consulta (la lista `IN` acotada, como `computeReceivables`). */
const TANDA = 2000;

export async function leerNotasDePlan(clinicId: string, invoiceIds: string[], db: DbCrudo = prisma): Promise<Map<string, NotaDePlanLeida>> {
  const salida = new Map<string, NotaDePlanLeida>();
  // `clinicId` vacío no filtra nada: se corta antes de consultar.
  if (!clinicId || invoiceIds.length === 0) return salida;
  try {
    if (!(await sqlDelPlan(db, "columna"))) return salida;
    const notas: NotaSql[] = [];
    for (let i = 0; i < invoiceIds.length; i += TANDA) {
      const ids = invoiceIds.slice(i, i + TANDA);
      notas.push(...(await db.$queryRaw<NotaSql[]>`
        SELECT "id", "treatmentPlanId", "total", "paid", "createdAt", "items", "discount", "taxRate", "taxIncluded"
          FROM "invoices"
         WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)}) AND "treatmentPlanId" IS NOT NULL`));
    }
    if (notas.length === 0) return salida;

    const filasPorPlan = new Map<string, Map<string, FilaParaDeuda>>();
    if (await sqlDelPlan(db, "tabla")) {
      const planes = Array.from(new Set(notas.map((n) => n.treatmentPlanId)));
      for (let i = 0; i < planes.length; i += TANDA) {
        const filas = await db.$queryRaw<FilaSql[]>`
          SELECT "id", "planId", "estado", "hechoEn", "nombre", "invoiceId", "invoiceLinea"
            FROM "treatment_plan_items"
           WHERE "clinicId" = ${clinicId} AND "planId" IN (${Prisma.join(planes.slice(i, i + TANDA))})`;
        for (const f of filas) {
          const m = filasPorPlan.get(f.planId) ?? new Map<string, FilaParaDeuda>();
          m.set(f.id, {
            id: f.id,
            estado: f.estado as EstadoDeFila,
            hechoEn: fecha(f.hechoEn),
            nombre: f.nombre,
            invoiceId: f.invoiceId,
            invoiceLinea: f.invoiceLinea == null ? null : Number(f.invoiceLinea),
          });
          filasPorPlan.set(f.planId, m);
        }
      }
    }

    for (const n of notas) {
      salida.set(n.id, {
        planId: n.treatmentPlanId,
        nota: {
          id: n.id,
          total: Number(n.total) || 0,
          paid: Number(n.paid) || 0,
          createdAt: fecha(n.createdAt) ?? new Date(0),
          items: n.items,
          discount: Number(n.discount) || 0,
          taxRate: n.taxRate == null ? null : Number(n.taxRate),
          taxIncluded: n.taxIncluded !== false,
        },
        filas: filasPorPlan.get(n.treatmentPlanId) ?? new Map(),
      });
    }
    return salida;
  } catch (e) {
    // Tolerante: si no se puede leer, «Por cobrar» se queda como hoy (saldo completo), no revienta Caja.
    console.warn(`[plan:por-cobrar] clínica ${clinicId}: no se pudieron leer las notas de plan; se cuentan completas.`, e);
    return new Map();
  }
}

/**
 * Para quien suma saldos de facturas a mano (Sabina): de las notas de plan con algo por hacer
 * (`SaldosDeLaClinica.porHacerPorFactura`), cuánto le toca a cada paciente. Una consulta acotada por
 * los ids (pocos: solo notas de plan con algo sin hacer), con el `clinicId` de quien llama.
 */
export async function porHacerPorPaciente(
  db: { invoice: { findMany: (args: any) => Promise<any[]> } },
  clinicId: string,
  porHacerPorFactura: Record<string, number>,
  /** Solo las facturas que cumplan esto (p. ej. el `saldoMinimo` de quien llama). */
  tambien: (f: { id: string; patientId: string | null; balance: number }) => boolean = () => true,
): Promise<{ porPaciente: Map<string, number>; porFactura: Map<string, number> }> {
  const porPaciente = new Map<string, number>();
  const porFactura = new Map<string, number>();
  const ids = Object.keys(porHacerPorFactura).filter((id) => (porHacerPorFactura[id] ?? 0) > 0);
  if (!clinicId || ids.length === 0) return { porPaciente, porFactura };
  const filas = await db.invoice.findMany({ where: { clinicId, id: { in: ids } }, select: { id: true, patientId: true, balance: true } });
  for (const f of filas) {
    if (!f?.patientId || !tambien({ id: f.id, patientId: f.patientId, balance: Number(f.balance) || 0 })) continue;
    const ph = porHacerPorFactura[f.id] ?? 0;
    porFactura.set(f.id, ph);
    porPaciente.set(f.patientId, Math.round(((porPaciente.get(f.patientId) ?? 0) + ph) * 100) / 100);
  }
  return { porPaciente, porFactura };
}
