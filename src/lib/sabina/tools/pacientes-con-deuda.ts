/**
 * `pacientes_con_deuda` — quién le debe a la clínica y cuánto, de mayor a menor.
 *
 * ── EL CRITERIO, Y POR QUÉ ESTE Y NO OTRO ──────────────────────────────
 * Deuda = `Invoice.balance > 0` con la factura NO CANCELADA, aislada por
 * `clinicId`. Es literalmente el `where` de la columna "Saldo" y de los KPIs
 * "Pacientes con deuda" / "Monto adeudado" de /dashboard/patients
 * (src/app/api/patients/route.ts), así que el total de aquí cuadra con el
 * encabezado de esa pantalla.
 *
 * Las CANCELADAS quedan fuera y no es cosmético: el endpoint de cancelar solo
 * cambia el `status` y DEJA el `balance` intacto, así que sin ese filtro una
 * factura anulada seguiría contando como deuda. Los BORRADORES sí entran, igual
 * que en esa pantalla.
 *
 * Aparte, y etiquetado aparte, va el VENCIDO con el criterio de Finanzas →
 * Saldos (`overdueInvoiceWhere`: por cobrar, ni DRAFT ni CANCELLED, y
 * `dueDate` anterior al inicio de hoy EN LA ZONA DE LA CLÍNICA). Son dos
 * poblaciones distintas a propósito: mezclarlas daría un número que no está en
 * ninguna pantalla.
 *
 * ── PERMISO Y NOMBRES ──────────────────────────────────────────────────
 * `billing.view`, igual que GET /api/invoices, que es la pantalla que hoy
 * enseña nombre de paciente + saldo. Y la misma visibilidad por paciente que
 * usa esa ruta (`relatedPatientVisibilityAnd`), para que un paciente
 * restringido no salga por la puerta de la facturación.
 */

import { overdueInvoiceWhere } from "@/lib/caja";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { round2 } from "@/lib/invoice-totals";
import { dbDe, definirHerramienta, fraseRecorte, pesos, plural, recortar, visorDe, type Lista } from "./base";
import { inicioDeHoy } from "./fechas";
import { z } from "zod";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Solo pacientes que deban al menos esto. Sin él, cualquier saldo > 0. */
  saldoMinimo: z.number().min(0).optional(),
});

export type ParamsDeuda = z.infer<typeof parametros>;

export interface DeudorFila {
  paciente: string;
  folio: string | null;
  saldo: number;
  /** Cuántas facturas con saldo tiene abiertas. */
  facturas: number;
}

export interface DatosDeuda {
  deudores: Lista<DeudorFila>;
  /** Σ balance de todas las facturas con saldo no canceladas. El KPI "Monto adeudado". */
  totalAdeudado: number;
  /** Σ balance de las facturas VENCIDAS (criterio de Finanzas → Saldos). */
  totalVencido: number;
  /** Inicio de hoy en la clínica, contra el que se midió el vencimiento. */
  vencidoAlDia: string;
}

export const pacientesConDeuda = definirHerramienta<ParamsDeuda, DatosDeuda>({
  nombre: "pacientes_con_deuda",
  descripcion:
    "Los pacientes que tienen saldo pendiente, ordenados de mayor a menor deuda, con el monto total " +
    "adeudado por la clínica y cuánto de eso ya está vencido. Úsala para «¿quién me debe?», " +
    "«¿cuánto tengo por cobrar?» o «a quién hay que llamar para cobrar». " +
    "Devuelve saldos, no cobros: para lo que YA entró usa ingresos_por_periodo.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosDeuda> {
    const db = dbDe(ctx);
    const visor = visorDe(ctx);
    const visRelacion = relatedPatientVisibilityAnd(visor);
    const minimo = params.saldoMinimo ?? 0;

    // 🔴 clinicId de la sesión, y `balance: { gt: 0 }` con la factura no
    // cancelada: el criterio de la columna "Saldo" de /dashboard/patients.
    const whereDeuda: Record<string, any> = {
      clinicId: ctx.clinicId,
      // `gt: 0` es el criterio de la pantalla; con `saldoMinimo` se estrecha a
      // `gte`, nunca se ensancha.
      balance: minimo > 0 ? { gte: minimo } : { gt: 0 },
      status: { not: "CANCELLED" },
      ...(visRelacion.length ? { AND: visRelacion } : {}),
    };
    const whereVencido: Record<string, any> = {
      ...overdueInvoiceWhere(ctx.clinicId, inicioDeHoy(ctx.timezone)),
      ...(visRelacion.length ? { AND: visRelacion } : {}),
    };

    const [sumaTotal, distintos, porPaciente, sumaVencida] = await Promise.all([
      db.invoice.aggregate({ _sum: { balance: true }, where: whereDeuda }),
      // Mismo movimiento que el KPI "Pacientes con deuda" de /api/patients:
      // patientIds distintos, no facturas.
      db.invoice.findMany({ where: whereDeuda, select: { patientId: true }, distinct: ["patientId"] }),
      db.invoice.groupBy({
        by: ["patientId"],
        where: whereDeuda,
        _sum: { balance: true },
        _count: { _all: true },
        orderBy: { _sum: { balance: "desc" } },
        take: 51,
      }),
      db.invoice.aggregate({ _sum: { balance: true }, where: whereVencido }),
    ]);

    const ids = porPaciente.map((g: any) => g.patientId).filter(Boolean);
    // Nombres: por el helper de visibilidad, nunca un `prisma.patient` pelado
    // (regla dura de @/lib/patient-visibility). `deletedAt` se SELECCIONA en vez
    // de filtrarse para que el total de arriba y esta lista sigan hablando de la
    // misma población: un paciente cancelado por ARCO sale sin nombre, no
    // desaparece descuadrando la suma.
    const pacientes = ids.length
      ? await db.patient.findMany({
          where: {
            id: { in: ids },
            clinicId: ctx.clinicId,
            ...(patientVisibilityAnd(visor).length ? { AND: patientVisibilityAnd(visor) } : {}),
          },
          select: { id: true, firstName: true, lastName: true, patientNumber: true, deletedAt: true },
        })
      : [];

    const porId: Record<string, any> = {};
    for (const p of pacientes) porId[p.id] = p;

    const filas: DeudorFila[] = porPaciente.map((g: any) => {
      const p = porId[g.patientId];
      return {
        paciente: p
          ? p.deletedAt
            ? "Paciente cancelado (ARCO)"
            : [p.firstName, p.lastName].filter(Boolean).join(" ").trim()
          : "Paciente privado",
        folio: p && !p.deletedAt ? p.patientNumber ?? null : null,
        saldo: round2(g._sum?.balance ?? 0),
        facturas: g._count?._all ?? 0,
      };
    });

    return {
      deudores: recortar(filas, distintos.length),
      totalAdeudado: round2(sumaTotal?._sum?.balance ?? 0),
      totalVencido: round2(sumaVencida?._sum?.balance ?? 0),
      vencidoAlDia: inicioDeHoy(ctx.timezone).toISOString(),
    };
  },

  vacio: (d) => d.deudores.total === 0,

  resumir(d) {
    const cab = `${plural(d.deudores.total, "paciente con saldo", "pacientes con saldo")} por ${pesos(d.totalAdeudado)}`;
    const venc = d.totalVencido > 0 ? `, de los que ${pesos(d.totalVencido)} ya están vencidos` : "";
    const mayor = d.deudores.filas[0]
      ? ` El mayor es ${d.deudores.filas[0].paciente} con ${pesos(d.deudores.filas[0].saldo)}.`
      : "";
    return `${cab}${venc}${fraseRecorte(d.deudores, "pacientes")}.${mayor}`;
  },
});
