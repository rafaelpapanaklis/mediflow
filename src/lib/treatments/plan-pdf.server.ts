import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { CLINIC_LETTERHEAD_SELECT, clinicLetterheadProps } from "@/lib/pdf/clinic-letterhead";
import { PlanTratamientoDocument, type TextosPlanPdf } from "@/lib/pdf/plan-tratamiento-document";
import { consentTimeZone } from "@/lib/consent/dates";
import { formatoEnZona } from "@/lib/fechas/fecha-en-zona";
import { nombreDeProfesional } from "@/lib/nombre-profesional";
import { dineroExacto } from "./dinero-exacto";
import { getDict, resolveLocale } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { armarDocumentoDelPlan, nombreDeArchivo } from "./plan-pdf";

/**
 * buildPlanTratamientoPdf — lectura + logo + render del PDF de un plan de tratamiento (ws1-t12).
 *
 * Mismo patrón que buildQuotePdf / buildConsentPdf: se genera al pedirlo y no se
 * guarda en ninguna parte. Tenant: el plan DEBE ser de `clinicId` (el de la
 * sesión, lo pasa la ruta); sin clínica no se consulta nada — `clinicId:
 * undefined` no filtra. Devuelve null si el plan no existe o es de otra clínica.
 */

const ESTADO_CLAVE: Record<string, string> = {
  ACTIVE: "patients.treatmentStatus.active",
  COMPLETED: "patients.treatmentStatus.completed",
  ABANDONED: "patients.treatmentStatus.abandoned",
  PAUSED: "patients.treatmentStatus.paused",
};

export async function buildPlanTratamientoPdf(args: {
  planId: string;
  clinicId: string;
  ahora?: Date;
}): Promise<{ buffer: Buffer; fileName: string; planNombre: string; patientId: string } | null> {
  if (!args.clinicId || !args.planId) return null;

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: args.planId, clinicId: args.clinicId },
    select: {
      id: true, patientId: true, name: true, description: true, totalCost: true, status: true, startDate: true,
      patient: { select: { firstName: true, lastName: true, patientNumber: true } },
      doctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
    },
  });
  if (!plan) return null;

  // Sin tarifario: en el PDF manda SIEMPRE el precio del plan (revisión t8, N-P2). Y sin facturas:
  // el PDF no lleva «Pagado» ni «Saldo» (decisión del gerente, tercera vuelta t8).
  const clinic = await prisma.clinic.findUnique({
    where: { id: args.clinicId },
    select: { ...CLINIC_LETTERHEAD_SELECT, timezone: true, locale: true },
  });

  const membrete = await clinicLetterheadProps(clinic);
  // Sin `@/i18n/server`: ese arrastra getCurrentUser, y aquí la sesión ya la resolvió la ruta.
  const locale = resolveLocale(clinic?.locale);
  const t = makeT(getDict(locale));
  const intl = locale === "en" ? "en-US" : "es-MX";
  const zona = consentTimeZone(clinic?.timezone);
  const ahora = args.ahora ?? new Date();
  const fechaLarga = (d: Date) => formatoEnZona(d, { day: "numeric", month: "long", year: "numeric" }, zona, intl) ?? "—";

  const documento = armarDocumentoDelPlan(
    { name: plan.name, description: plan.description, totalCost: Number(plan.totalCost) || 0 },
  );

  const pacienteNombre = `${plan.patient?.firstName ?? ""} ${plan.patient?.lastName ?? ""}`.trim() || "—";
  const doctorNombre = nombreDeProfesional(plan.doctor);
  const cedula = plan.doctor?.cedulaProfesional?.trim();
  const clinicName = membrete.clinicName;

  const textos: TextosPlanPdf = {
    titulo: t("planTratamiento.pdf.titulo"),
    paciente: t("planTratamiento.pdf.paciente"),
    fecha: t("planTratamiento.pdf.fecha"),
    doctor: t("planTratamiento.pdf.doctor"),
    cedula: cedula ? t("planTratamiento.pdf.cedula", { cedula }) : "",
    plan: t("planTratamiento.pdf.plan"),
    estado: t("planTratamiento.pdf.estado"),
    inicio: t("planTratamiento.pdf.inicio"),
    procedimientos: t("planTratamiento.pdf.procedimientos"),
    concepto: t("planTratamiento.pdf.concepto"),
    zona: t("planTratamiento.pdf.zona"),
    cantidad: t("planTratamiento.pdf.cantidad"),
    precio: t("planTratamiento.pdf.precio"),
    importe: t("planTratamiento.pdf.importe"),
    subtotalFase: t("planTratamiento.pdf.subtotalFase"),
    subtotal: t("planTratamiento.pdf.subtotal"),
    descuento: t("planTratamiento.pdf.descuento"),
    redondeo: t("planTratamiento.pdf.redondeo"),
    ajuste: t("planTratamiento.pdf.ajuste"),
    total: t("planTratamiento.pdf.total"),
    leyenda: t("planTratamiento.pdf.leyenda"),
    firmaPaciente: t("planTratamiento.pdf.firmaPaciente"),
    firmaDoctor: t("planTratamiento.pdf.firmaDoctor"),
    fechaPorLlenar: t("planTratamiento.pdf.fechaPorLlenar"),
    pie: t("planTratamiento.pdf.pie", { clinica: clinicName }),
    pagina: (n, total) => t("planTratamiento.pdf.pagina", { n, total }),
    continua: t("planTratamiento.pdf.continua"),
  };

  const element = createElement(PlanTratamientoDocument, {
    ...membrete,
    textos,
    pacienteNombre,
    pacienteFolio: plan.patient?.patientNumber ? String(plan.patient.patientNumber) : null,
    doctorNombre,
    planNombre: plan.name,
    estadoPlan: t(ESTADO_CLAVE[plan.status] ?? ESTADO_CLAVE.ACTIVE),
    fechaEmision: fechaLarga(ahora),
    fechaInicio: plan.startDate ? fechaLarga(plan.startDate) : null,
    documento,
    dinero: dineroExacto,
  });

  const buffer = await renderToBuffer(element as any);
  const dia = formatoEnZona(ahora, { year: "numeric", month: "2-digit", day: "2-digit" }, zona, "en-CA") ?? "";
  return {
    buffer,
    fileName: nombreDeArchivo(t("planTratamiento.pdf.archivo"), pacienteNombre, dia),
    planNombre: plan.name,
    patientId: plan.patientId,
  };
}
