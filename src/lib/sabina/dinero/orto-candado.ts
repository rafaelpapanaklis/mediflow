/**
 * Sabina NO cobra ortodoncia (ws1-t11, decisión de Rafael del 28-sep-2026).
 *
 * Una mensualidad, un control o un extra de un caso de ortodoncia se cobran en
 * el panel, en la pantalla de cobro del caso: ahí están el calendario de pagos,
 * el convenio, el recibo del módulo y el aviso al paciente. Un cobro hecho por
 * `cobrar_factura` entraría a la factura sin nada de eso. Así que si la factura
 * es de ortodoncia, `cobrar_factura` no prepara tarjeta: contesta con el dato y
 * con el enlace.
 *
 * ── CUÁNDO UNA FACTURA ES DE ORTODONCIA ────────────────────────────────
 * Las dos formas en que el módulo liga una factura a un caso:
 *  · es LA factura del tratamiento (`orthodontic_treatment_plans.invoiceId`: el
 *    plan a plazos, o la colocación en «pago por control»);
 *  · cuelga del caso por `invoices.orthodonticTreatmentPlanId`: un control
 *    cobrado aparte o un extra (retenedor, reposición de bracket…). Esa columna
 *    va por SQL crudo, como en `cobro/extras-db.ts`: no está en el schema.
 *
 * Da igual que la sede tenga hoy el módulo o que el caso esté cerrado: la
 * factura sigue siendo de ortodoncia.
 *
 * 🔴 Si la comprobación no se puede hacer (la base falló), NO se cobra: se dice.
 * Lo único que se tolera es que la tabla o la columna todavía no existan en
 * esta base (P2021/P2022, o el error de columna de Postgres): entonces ninguna
 * factura puede estar ligada a un caso.
 *
 * Solo lee, por `ctx.db` y con el `clinicId` de la sesión.
 */

import { Prisma } from "@prisma/client";
import { fraseDeAtraso, fraseDeProxima, fraseDeVencidos } from "@/lib/orthodontics/cobranza-modulo";
import { ENLACES_ORTO, enlaceDelCaso, fechaCorta } from "../tools/orto-comun";
import type { SabinaCtx } from "../tipos";
import { dbDineroDe, dinero, type FacturaLeida } from "./comun";

export interface FacturaDeOrtodoncia {
  /** El caso del que cuelga. */
  planId: string;
  /** `tratamiento` = la factura del plan; `del_caso` = un control o un extra. */
  clase: "tratamiento" | "del_caso";
}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string; meta?: { code?: string } } | null)?.code;
  if (code === "P2021" || code === "P2022") return true;
  // SQL crudo contra una columna que aún no existe: Postgres 42703 (o 42P01, tabla).
  const texto = `${(e as { message?: string } | null)?.message ?? ""} ${(e as { meta?: { code?: string } } | null)?.meta?.code ?? ""}`;
  return /42703|42P01|does not exist|no existe/i.test(texto);
}

/**
 * ¿Esta factura es de un caso de ortodoncia? `null` = no.
 * Lanza si no se pudo comprobar: quien llama NO cobra.
 */
export async function facturaDeOrtodoncia(ctx: SabinaCtx, f: Pick<FacturaLeida, "id">): Promise<FacturaDeOrtodoncia | null> {
  const db = dbDineroDe(ctx) as unknown as {
    orthodonticTreatmentPlan?: { findFirst(args: any): Promise<any | null> };
    $queryRaw(query: any): Promise<any[]>;
  };
  const clinicId = ctx.clinicId;

  // Un cliente sin el modelo (un doble de prueba anterior a esta tarea) no
  // tiene casos de ortodoncia: no hay a qué ligar la factura.
  if (typeof db.orthodonticTreatmentPlan?.findFirst !== "function") return null;

  try {
    const plan = await db.orthodonticTreatmentPlan.findFirst({
      where: { clinicId, invoiceId: f.id },
      select: { id: true },
    });
    if (plan) return { planId: plan.id, clase: "tratamiento" };
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
  }

  try {
    const filas = await db.$queryRaw(Prisma.sql`
      SELECT "orthodonticTreatmentPlanId" AS "planId"
        FROM "invoices"
       WHERE "id" = ${f.id} AND "clinicId" = ${clinicId}
       LIMIT 1`);
    const planId = (filas as Array<{ planId: string | null }>)[0]?.planId;
    if (typeof planId === "string" && planId) return { planId, clase: "del_caso" };
  } catch (e) {
    if (!esRelacionAusente(e)) throw e;
  }
  return null;
}

/**
 * Lo que Sabina contesta en vez de la tarjeta de cobro: el dato y el enlace.
 * El estado de las mensualidades sale del motor del módulo (la misma fila de la
 * pantalla de Cobranza); si no se pudo leer, va solo el saldo de la factura.
 */
export async function fraseNoCobraOrtodoncia(ctx: SabinaCtx, f: FacturaLeida, orto: FacturaDeOrtodoncia): Promise<string> {
  const ficha = `[la ficha de ortodoncia de ${f.paciente.nombre}](${enlaceDelCaso(f.paciente.id)})`;
  const cobranza = `[Cobranza de ortodoncia](${ENLACES_ORTO.cobranza})`;
  const queEs = orto.clase === "tratamiento" ? "la factura de su tratamiento de ortodoncia" : "un cargo de su caso de ortodoncia (un control o un extra)";

  let estado = "";
  if (orto.clase === "tratamiento") {
    try {
      const motor = await import("../tools/orto-motor");
      const leido = await motor.leerCaso(ctx, f.paciente.id, { clinico: false, controles: false, cobranza: true });
      const fila = leido?.cobranza?.fila ?? null;
      if (fila && leido?.caso?.planId === orto.planId) {
        const partes: string[] = [];
        if (fila.cuotasVencidas > 0) {
          const atraso = fraseDeAtraso(fila.diasDeAtraso);
          partes.push(`tiene ${fraseDeVencidos(fila.cuotasVencidas)} por ${dinero(fila.vencido)}${atraso ? ` (${atraso})` : ""}`);
        } else {
          partes.push("va al corriente");
        }
        if (fila.proximaFecha && fila.proximoImporte !== null) {
          const cuando = fraseDeProxima(fila.diasParaLaProxima);
          partes.push(`su próximo pago es de ${dinero(fila.proximoImporte)} el ${fechaCorta(fila.proximaFecha)}${cuando ? ` (${cuando})` : ""}`);
        }
        estado = ` Hoy ${partes.join(" y ")}.`;
      }
    } catch (e) {
      console.warn("[sabina/dinero] no se pudo leer la cobranza del caso de ortodoncia:", e);
    }
  }

  return (
    `No cobro ortodoncia. La factura ${f.folio} de ${f.paciente.nombre} es ${queEs}: le quedan ${dinero(f.saldo)} por pagar.${estado} ` +
    `Se cobra en ${ficha}, donde están su calendario de pagos y su convenio, o desde ${cobranza}. No preparé ningún cobro.`
  );
}
