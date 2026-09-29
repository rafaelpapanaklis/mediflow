import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { labelParentesco } from "@/lib/consent/default-signer";
import { elegirTutorPagador } from "@/lib/invoices/destinatarios";
import { ACTIVE_PLAN_STATUSES } from "./specialty-kpis";

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
 * El responsable de pago (tutor u otra persona) de cada factura, con su teléfono y correo — en UNA tanda
 * para todas (ws1-t10: la ficha de Caja trae hasta 100 facturas). Se busca, en este orden:
 *   1. el responsable del CASO al que pertenece la factura: la factura principal del tratamiento
 *      (`plan.invoiceId`) o un control/extra ligado (`invoices.orthodonticTreatmentPlanId`);
 *   2. si la factura no está ligada a ningún caso (otra factura de ortodoncia del mismo paciente, una
 *      hecha a mano…): el responsable del caso ACTIVO más reciente del paciente que lo tenga;
 *   3. si tampoco: el tutor registrado del paciente que paga (principal y responsable legal).
 * Solo lo de la clínica de la sesión. Sin nada de eso o sin columnas: la factura no sale en el mapa.
 * Nunca lanza.
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
    // 1. Por el caso al que la factura está ligada.
    const principales = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, invoiceId: { in: ids }, deletedAt: null },
      select: { invoiceId: true, ...conGuardian },
    });
    for (const p of principales) {
      if (p.invoiceId && p.responsibleGuardian) salida.set(p.invoiceId, aContacto(p.responsibleGuardian));
    }
    let faltan = ids.filter((id) => !salida.has(id));
    if (faltan.length === 0) return salida;

    // Controles y extras: ligados al caso por la columna de la factura (SQL crudo, tolerante a que falte).
    try {
      const ligadas = await prisma.$queryRaw<{ id: string; plan: string | null }[]>`
        SELECT "id", "orthodonticTreatmentPlanId" AS "plan" FROM "invoices"
         WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(faltan)})
           AND "orthodonticTreatmentPlanId" IS NOT NULL`;
      const planIds = Array.from(new Set(ligadas.map((l) => l.plan).filter((x): x is string => !!x)));
      if (planIds.length > 0) {
        const casos = await prisma.orthodonticTreatmentPlan.findMany({
          where: { clinicId, id: { in: planIds }, deletedAt: null },
          select: { id: true, ...conGuardian },
        });
        const porCaso = new Map(casos.map((c) => [c.id, c.responsibleGuardian]));
        for (const l of ligadas) {
          const g = l.plan ? porCaso.get(l.plan) : null;
          if (g) salida.set(l.id, aContacto(g));
        }
      }
    } catch {
      // Sin la columna de las facturas ligadas: se sigue con lo que hay.
    }
    faltan = faltan.filter((id) => !salida.has(id));
    if (faltan.length === 0) return salida;

    // 2 y 3. Por el PACIENTE de la factura, aunque la factura no esté ligada a un caso.
    const facturas = await prisma.invoice.findMany({
      where: { clinicId, id: { in: faltan } },
      select: { id: true, patientId: true },
    });
    const pacientes = Array.from(new Set(facturas.map((f) => f.patientId).filter((x): x is string => !!x)));
    if (pacientes.length === 0) return salida;

    // 2. El caso activo más reciente del paciente que tenga responsable.
    const casosDelPaciente = await prisma.orthodonticTreatmentPlan.findMany({
      where: { clinicId, patientId: { in: pacientes }, deletedAt: null, status: { in: ACTIVE_PLAN_STATUSES }, responsibleGuardianId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { patientId: true, ...conGuardian },
    });
    const dePaciente = new Map<string, ContactoDelResponsable>();
    for (const c of casosDelPaciente) {
      if (c.responsibleGuardian && !dePaciente.has(c.patientId)) dePaciente.set(c.patientId, aContacto(c.responsibleGuardian));
    }
    // 3. Si no, el tutor registrado que paga.
    const sinCaso = pacientes.filter((p) => !dePaciente.has(p));
    if (sinCaso.length > 0) {
      const tutores = await prisma.guardian.findMany({
        where: { clinicId, patientId: { in: sinCaso }, deletedAt: null, OR: [{ principal: true }, { esResponsableLegal: true }] },
        select: { patientId: true, fullName: true, parentesco: true, phone: true, email: true, principal: true, esResponsableLegal: true },
      });
      for (const pid of sinCaso) {
        const t = elegirTutorPagador(tutores.filter((g) => g.patientId === pid));
        if (t) dePaciente.set(pid, aContacto(t));
      }
    }
    for (const f of facturas) {
      const c = f.patientId ? dePaciente.get(f.patientId) : null;
      if (c) salida.set(f.id, c);
    }
  } catch (e) {
    // Sin columna del responsable (SQL de alta-caso sin pegar) o sin tabla: como si no hubiera responsable.
    console.warn("[facturas:responsable] no se pudo buscar el responsable de pago:", e);
  }
  return salida;
}

/** El de UNA factura. */
export async function contactoDelResponsableDeLaFactura(clinicId: string, invoiceId: string): Promise<ContactoDelResponsable | null> {
  return (await contactosDeResponsablesDeFacturas(clinicId, [invoiceId])).get(invoiceId) ?? null;
}
