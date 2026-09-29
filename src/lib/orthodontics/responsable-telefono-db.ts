import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { labelParentesco } from "@/lib/consent/default-signer";

/**
 * El teléfono del responsable de pago del caso cuya factura del tratamiento es
 * `invoiceId` (de esta clínica), o null. El recordatorio de mensualidad de Alertas
 * y los cobros automáticos van a ESE teléfono; el aviso de la factura, al del
 * paciente: para el tope de «un aviso de cobro al día» hay que mirar los dos.
 * Nunca lanza (sin columna o sin tabla: null).
 */
export async function telefonoDelResponsableDeLaFactura(clinicId: string, invoiceId: string): Promise<string | null> {
  if (!clinicId || !invoiceId) return null;
  try {
    const plan = await prisma.orthodonticTreatmentPlan.findFirst({
      where: { clinicId, invoiceId, deletedAt: null },
      select: { responsibleGuardian: { select: { phone: true } } },
    });
    const tel = plan?.responsibleGuardian?.phone?.trim();
    return tel ? tel : null;
  } catch {
    return null;
  }
}

export interface ContactoDelResponsable {
  nombre: string;
  /** «madre», «padre»… ya legible, o vacío. */
  parentesco: string;
  telefono: string | null;
  correo: string | null;
}

/**
 * El responsable de pago (tutor u otra persona) del CASO al que pertenece cada
 * factura, con su teléfono y correo — en UNA tanda para todas (ws1-t10: la ficha
 * de Caja trae hasta 100 facturas). Llega al caso por la factura principal del
 * tratamiento (`plan.invoiceId`) o, para un control o un extra, por
 * `invoices.orthodonticTreatmentPlanId`. Solo lo de la clínica de la sesión. Sin
 * columna, sin caso o sin responsable: la factura no sale en el mapa. Nunca lanza.
 */
export async function contactosDeResponsablesDeFacturas(
  clinicId: string,
  invoiceIds: string[],
): Promise<Map<string, ContactoDelResponsable>> {
  const salida = new Map<string, ContactoDelResponsable>();
  const ids = Array.from(new Set(invoiceIds.filter((x) => typeof x === "string" && x)));
  if (!clinicId || ids.length === 0) return salida;
  const conGuardian = { responsibleGuardian: { select: { fullName: true, parentesco: true, phone: true, email: true } } } as const;
  const aContacto = (g: { fullName: string; parentesco: unknown; phone: string | null; email: string | null }): ContactoDelResponsable => ({
    nombre: g.fullName,
    parentesco: labelParentesco(String(g.parentesco ?? "")),
    telefono: g.phone?.trim() || null,
    correo: g.email?.trim() || null,
  });
  try {
    const principales = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, invoiceId: { in: ids }, deletedAt: null },
      select: { invoiceId: true, ...conGuardian },
    });
    for (const p of principales) {
      if (p.invoiceId && p.responsibleGuardian) salida.set(p.invoiceId, aContacto(p.responsibleGuardian));
    }
    const faltan = ids.filter((id) => !salida.has(id));
    if (faltan.length === 0) return salida;

    // Controles y extras: ligados al caso por la columna de la factura (SQL crudo, tolerante a que falte).
    let ligadas: { id: string; plan: string | null }[] = [];
    try {
      ligadas = await prisma.$queryRaw<{ id: string; plan: string | null }[]>`
        SELECT "id", "orthodonticTreatmentPlanId" AS "plan" FROM "invoices"
         WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(faltan)})
           AND "orthodonticTreatmentPlanId" IS NOT NULL`;
    } catch {
      return salida;
    }
    const planIds = Array.from(new Set(ligadas.map((l) => l.plan).filter((x): x is string => !!x)));
    if (planIds.length === 0) return salida;
    const casos = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, id: { in: planIds }, deletedAt: null },
      select: { id: true, ...conGuardian },
    });
    const porCaso = new Map(casos.map((c) => [c.id, c.responsibleGuardian]));
    for (const l of ligadas) {
      const g = l.plan ? porCaso.get(l.plan) : null;
      if (g) salida.set(l.id, aContacto(g));
    }
  } catch {
    // Sin columna del responsable (SQL de alta-caso sin pegar) o sin tabla: como si no hubiera responsable.
  }
  return salida;
}

/** El de UNA factura. */
export async function contactoDelResponsableDeLaFactura(clinicId: string, invoiceId: string): Promise<ContactoDelResponsable | null> {
  return (await contactosDeResponsablesDeFacturas(clinicId, [invoiceId])).get(invoiceId) ?? null;
}
