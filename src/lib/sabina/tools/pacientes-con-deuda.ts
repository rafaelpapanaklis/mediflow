/**
 * `pacientes_con_deuda` — quién le debe a la clínica y cuánto, de mayor a menor.
 *
 * ── EL CRITERIO, Y POR QUÉ ESTE Y NO OTRO ──────────────────────────────
 * Deuda = la definición ÚNICA de @/lib/dinero (ws1-t2, `deudaInvoiceWhere`):
 * `Invoice.balance > 0` de facturas EMITIDAS —ni borradores ni canceladas—,
 * aislada por `clinicId`. Es el `where` de la columna "Saldo" y de los KPIs
 * "Pacientes con deuda" / "Monto adeudado" de /dashboard/patients, de Reportes,
 * del CRM y de «Por cobrar» de Finanzas, así que el total de aquí cuadra con
 * todas.
 *
 * Las CANCELADAS quedan fuera y no es cosmético: el endpoint de cancelar solo
 * cambia el `status` y DEJA el `balance` intacto, así que sin ese filtro una
 * factura anulada seguiría contando como deuda. Los BORRADORES tampoco entran:
 * aún no se le cobran a nadie.
 *
 * Aparte, y etiquetado aparte, va el VENCIDO con el criterio de Caja, Facturas
 * y Finanzas → Saldos (`computeReceivables` de @/lib/caja, fila 87): por
 * cobrar (ni DRAFT ni CANCELLED) y, de cada factura, SOLO lo que ya venció
 * — a plazos, sus cuotas vencidas sin pagar; un cargo de control de
 * ortodoncia, según su vencimiento; de un solo pago, el saldo si `dueDate` es
 * anterior al inicio de hoy EN LA ZONA DE LA CLÍNICA. Antes aquí contaba el
 * saldo ENTERO de toda factura con `dueDate` pasada, y un plan a plazos con
 * una mensualidad atrasada no contaba. Son dos poblaciones distintas a
 * propósito: mezclarlas daría un número que no está en ninguna pantalla.
 *
 * ── PERMISO Y NOMBRES ──────────────────────────────────────────────────
 * `billing.view`, igual que GET /api/invoices, que es la pantalla que hoy
 * enseña nombre de paciente + saldo. Y la misma visibilidad por paciente que
 * usa esa ruta (`relatedPatientVisibilityAnd`), para que un paciente
 * restringido no salga por la puerta de la facturación.
 */

import { deudaInvoiceWhere } from "@/lib/dinero/ingresos.server";
import { computeReceivables, type CajaDb } from "@/lib/caja";
import { porHacerPorPaciente } from "@/lib/treatments/por-cobrar-db";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { round2 } from "@/lib/invoice-totals";
import {
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  pesos,
  pesosDeLista,
  plural,
  recortar,
  visorDe,
  type Lista,
} from "./base";
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
  /** Lo VENCIDO de las facturas por cobrar, por cuota en las de plazos (`computeReceivables`, el de Finanzas → Saldos). */
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
      ...deudaInvoiceWhere(ctx.clinicId),
      // `gt: 0` es el criterio de la pantalla; con `saldoMinimo` se estrecha a
      // `gte`, nunca se ensancha.
      balance: minimo > 0 ? { gte: minimo } : { gt: 0 },
      ...(visRelacion.length ? { AND: visRelacion } : {}),
    };

    const [sumaTotal, distintos, porPaciente, saldos] = await Promise.all([
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
      // Solo lectura. Con la visibilidad por paciente como filtro EXTRA (se
      // suma con AND, nunca ensancha `receivableInvoiceWhere(clinicId)`).
      computeReceivables(ctx.clinicId, new Date(), db as unknown as CajaDb, undefined, {
        filtro: visRelacion.length ? { AND: visRelacion } : undefined,
        timezone: ctx.timezone,
      }),
    ]);

    // Notas de plan (26-oct): lo aceptado y sin hacer no es deuda. Se resta, por paciente, lo «por
    // hacer» que `computeReceivables` apartó de esas notas (solo las que entran en este `where`).
    const { porPaciente: porHacer } = await porHacerPorPaciente(
      db as any, ctx.clinicId, saldos.porHacerPorFactura ?? {},
      (f) => (minimo > 0 ? f.balance >= minimo : f.balance > 0),
    );
    const restar = (patientId: string, saldo: number) => round2(Math.max(0, saldo - (porHacer.get(patientId) ?? 0)));
    const porPacienteNeto = (porPaciente as any[])
      .map((g: any) => ({ ...g, neto: restar(g.patientId, Number(g._sum?.balance ?? 0)) }))
      .filter((g: any) => g.neto > 0)
      .sort((a: any, b: any) => b.neto - a.neto);
    let porHacerTotal = 0;
    for (const v of Array.from(porHacer.values())) porHacerTotal += v;
    // Pacientes que solo tenían lo aceptado sin hacer: ya no son deudores.
    const sinDeuda = new Set((porPaciente as any[]).filter((g: any) => restar(g.patientId, Number(g._sum?.balance ?? 0)) <= 0).map((g: any) => g.patientId));
    const deudoresTotal = Math.max(0, distintos.length - sinDeuda.size);

    const ids = porPacienteNeto.map((g: any) => g.patientId).filter(Boolean);
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

    const filas: DeudorFila[] = porPacienteNeto.map((g: any) => {
      const p = porId[g.patientId];
      return {
        paciente: p
          ? p.deletedAt
            ? "Paciente cancelado (ARCO)"
            : [p.firstName, p.lastName].filter(Boolean).join(" ").trim()
          : "Paciente privado",
        folio: p && !p.deletedAt ? p.patientNumber ?? null : null,
        saldo: g.neto,
        facturas: g._count?._all ?? 0,
      };
    });

    return {
      deudores: recortar(filas, deudoresTotal),
      totalAdeudado: round2(Math.max(0, (sumaTotal?._sum?.balance ?? 0) - porHacerTotal)),
      totalVencido: round2(saldos.vencido),
      vencidoAlDia: inicioDeHoy(ctx.timezone).toISOString(),
    };
  },

  vacio: (d) => d.deudores.total === 0,

  resumir(d) {
    const cab = `${plural(d.deudores.total, "paciente con saldo", "pacientes con saldo")} por ${pesos(d.totalAdeudado)}`;
    const venc = d.totalVencido > 0 ? `, de los que ${pesos(d.totalVencido)} ya están vencidos` : "";
    const filas = d.deudores.filas;
    // La primera línea contesta «¿cuánto me deben?»; la lista, «¿quién me debe?».
    // Antes solo venía «el mayor es…» y el modelo armaba la lista con los números
    // crudos de `datos`, en una línea y separados por comas.
    const monto = pesosDeLista(filas.map((f) => f.saldo));
    const lista = lineasDeLista(
      filas,
      (f) => `${f.paciente} — ${monto(f.saldo)}${f.facturas > 1 ? ` (${f.facturas} facturas)` : ""}`,
    );
    const cola = lista
      ? " De mayor a menor:"
      : filas[0]
        ? ` Es ${filas[0].paciente} con ${pesos(filas[0].saldo)}.`
        : "";
    return `${cab}${venc}${fraseRecorte(d.deudores, "pacientes")}.${cola}${lista}`;
  },
});
