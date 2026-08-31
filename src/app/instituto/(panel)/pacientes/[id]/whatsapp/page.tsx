export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getEduContext } from "@/lib/edu-auth";
import { hasEduPermission } from "@/lib/edu/permissions";
import { getEduPatient } from "@/lib/edu/pacientes";
import { eduPatientFullName } from "@/lib/edu/pacientes-core";
import { listEduPatientConsents } from "@/lib/edu/consentimientos";
import { listEduPatientCharges } from "@/lib/edu/caja";
import { eduWaConnectionDTO, getEduWaConfig, listEduWaMessages } from "@/lib/edu/whatsapp";
import { EduDenied } from "@/components/edu/edu-denied";
import { EduPacienteWhatsapp } from "@/components/edu/whatsapp/paciente-whatsapp";

/**
 * /instituto/pacientes/[id]/whatsapp — mandarle documentos al paciente.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTA PESTAÑA NO EXIGE "whatsapp.view", Y ÉSA ES LA DECISIÓN.
 *
 * "whatsapp.view" y "whatsapp.manage" son de la CONFIGURACIÓN —conectar la
 * cuenta del instituto, encender los avisos de toda la escuela— y solo las
 * tiene la dirección. Mandarle un documento a un paciente concreto no es
 * eso: caja entrega el recibo en el mostrador y el alumno manda la carta de
 * consentimiento con el paciente en el sillón. Si esta pestaña exigiera
 * aquellas keys, o solo la dirección mandaría algo, o habría que darle a
 * caja la llave de la conexión entera.
 *
 * Así que cada mitad se abre con el permiso DE SU DOCUMENTO:
 *   · las cartas → "consentimientos.view" (la tienen los cuatro roles);
 *   · los recibos → "caja.view" MÁS el alcance de "charges", que para
 *     docente y alumno no devuelve ni una fila.
 *
 * Y quien no tenga ninguna de las dos no ve la pestaña (la filtra el layout)
 * ni la página (lo dice EduDenied).
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 El PACIENTE se busca dentro del alcance: uno de otra escuela —o de
 * otro alumno— da 404, igual que uno que no existe.
 */
export default async function PacienteWhatsappPage({ params }: { params: { id: string } }) {
  const ctx = await getEduContext();
  if (!ctx) redirect("/instituto/login");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const puedeCartas = hasEduPermission(permUser, "consentimientos.view");
  const puedeRecibos = hasEduPermission(permUser, "caja.view");

  if (!puedeCartas && !puedeRecibos) {
    return (
      <EduDenied
        permission="consentimientos.view"
        what="Mandarle al paciente por WhatsApp su carta de consentimiento (con consentimientos.view) o el recibo de un cobro (con caja.view)."
      />
    );
  }

  const paciente = await getEduPatient(ctx, params.id);
  if (!paciente) notFound();

  const cfg = await getEduWaConfig(ctx.institutionId);
  const connection = eduWaConnectionDTO(cfg);

  // Cada lista solo se consulta si su permiso está: pedir los cobros de un
  // paciente para luego no pintarlos es una consulta de dinero que alguien
  // sin dinero acaba de provocar.
  const [consents, charges, messages] = await Promise.all([
    puedeCartas
      ? listEduPatientConsents(ctx, paciente.id, ctx.institution.timezone)
      : Promise.resolve([]),
    puedeRecibos ? listEduPatientCharges(ctx, paciente.id) : Promise.resolve([]),
    listEduWaMessages(ctx, { patientId: paciente.id, take: 30 }),
  ]);

  return (
    <EduPacienteWhatsapp
      patientId={paciente.id}
      patientName={eduPatientFullName(paciente)}
      patientPhone={paciente.phone}
      connection={connection}
      consents={consents.map((c) => ({
        id: c.id,
        procedure: c.procedure,
        estado: c.estado,
        createdLabel: c.createdLabel,
      }))}
      charges={charges.map((c) => ({
        id: c.id,
        folio: c.folio,
        totalCents: c.totalCents,
        balanceCents: c.balanceCents,
        status: c.status,
        chargedAt: c.chargedAt,
      }))}
      messages={messages}
      canSendConsent={puedeCartas}
      canSendReceipt={puedeRecibos}
    />
  );
}
