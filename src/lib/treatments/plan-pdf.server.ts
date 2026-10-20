import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { CLINIC_LETTERHEAD_SELECT, clinicLetterheadProps } from "@/lib/pdf/clinic-letterhead";
import { PlanTratamientoDocument, type TextosPlanPdf } from "@/lib/pdf/plan-tratamiento-document";
import { consentTimeZone } from "@/lib/consent/dates";
import { formatoEnZona } from "@/lib/fechas/fecha-en-zona";
import { leerCargos } from "@/lib/quotes/aceptacion-db";
import { leerRenglonesDelPlan } from "@/lib/quotes/desde-plan";
import { nombreDeProfesional } from "@/lib/nombre-profesional";
import { dineroExacto } from "./dinero-exacto";
import { getDict, resolveLocale } from "@/i18n/dictionaries";
import { makeT } from "@/i18n/t";
import { armarDocumentoDelPlan, nombreDeArchivo, type PagosDelPlan } from "./plan-pdf";

/**
 * buildPlanTratamientoPdf — lectura + logo + render del PDF de un plan de tratamiento (ws1-t12).
 *
 * Mismo patrón que buildQuotePdf / buildConsentPdf: se genera al pedirlo y no se
 * guarda en ninguna parte. Tenant: el plan DEBE ser de `clinicId` (el de la
 * sesión, lo pasa la ruta); sin clínica no se consulta nada — `clinicId:
 * undefined` no filtra. Devuelve null si el plan no existe o es de otra clínica.
 *
 * `verPagos`: solo quien ve la facturación (`billing.view`) recibe pagado y saldo.
 */

const ESTADO_CLAVE: Record<string, string> = {
  ACTIVE: "patients.treatmentStatus.active",
  COMPLETED: "patients.treatmentStatus.completed",
  ABANDONED: "patients.treatmentStatus.abandoned",
  PAUSED: "patients.treatmentStatus.paused",
};

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Lo que el sistema sabe de pagos del plan: las facturas no canceladas que nacieron
 * de sus presupuestos (`quotes.treatmentPlanId`), por la factura de siempre
 * (`quotes.invoiceId`) o por los cargos de «Se cobrará hoy» (`quote_charges`).
 * Sin presupuestos ligados → `facturas: 0` y el PDF no habla de pagos.
 *
 * `soloDelPlan` (revisión t8, N-P1/N-P3) dice si ese dinero es de ESTE plan sin duda:
 *  · cada concepto de cada presupuesto ligado es un procedimiento del plan (por nombre). Un
 *    presupuesto mixto (general + ortodoncia), con conceptos añadidos o de otro tratamiento, no;
 *  · no hay un abono viejo aplicado por saldo a favor (fila de abono con monto negativo en
 *    `quote_charges`): su dinero está en la factura del abono Y en la del concepto, y sumar
 *    los dos `paid` lo cuenta dos veces;
 *  · los cargos se pudieron leer (si la base no contestó, faltarían facturas).
 */
async function pagosDelPlan(clinicId: string, planId: string, conceptosDelPlan: string[]): Promise<PagosDelPlan> {
  const quotes = await prisma.quote.findMany({
    where: { clinicId, treatmentPlanId: planId },
    select: { id: true, invoiceId: true, items: { select: { name: true } } },
    take: 50,
  });
  const nada: PagosDelPlan = { pagado: 0, facturas: 0, facturado: 0, porPagar: 0, soloDelPlan: false };
  if (quotes.length === 0) return nada;
  const delPlan = new Set(conceptosDelPlan.map(normalizar));
  let soloDelPlan = quotes.every((q) => q.items.every((it) => delPlan.has(normalizar(it.name))));
  const ids = new Set<string>();
  for (const q of quotes) if (q.invoiceId) ids.add(q.invoiceId);
  const cargos = await leerCargos(prisma, clinicId, quotes.map((q) => q.id));
  if (cargos.fallo) soloDelPlan = false;
  for (const lista of cargos.porQuote.values()) {
    for (const c of lista) {
      ids.add(c.invoiceId);
      if (c.tipo === "abono" && c.monto < 0) soloDelPlan = false;
    }
  }
  if (ids.size === 0) return nada;
  const facturas = await prisma.invoice.findMany({
    where: { clinicId, id: { in: [...ids] }, status: { not: "CANCELLED" } },
    select: { paid: true, total: true },
  });
  let pagado = 0;
  let facturado = 0;
  let porPagar = 0;
  for (const f of facturas) {
    const total = Number(f.total) || 0;
    const paid = Number(f.paid) || 0;
    pagado += paid;
    facturado += total;
    porPagar += Math.max(0, total - paid);
  }
  return { pagado, facturas: facturas.length, facturado, porPagar, soloDelPlan };
}

export async function buildPlanTratamientoPdf(args: {
  planId: string;
  clinicId: string;
  verPagos: boolean;
  ahora?: Date;
}): Promise<{ buffer: Buffer; fileName: string; planNombre: string; patientId: string } | null> {
  if (!args.clinicId || !args.planId) return null;

  const plan = await prisma.treatmentPlan.findFirst({
    where: { id: args.planId, clinicId: args.clinicId },
    select: {
      id: true, patientId: true, name: true, description: true, totalCost: true, status: true, startDate: true, createdAt: true,
      patient: { select: { firstName: true, lastName: true, patientNumber: true } },
      doctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
    },
  });
  if (!plan) return null;

  // Los conceptos del plan, para saber si un presupuesto ligado trae solo cosas de este plan.
  const leidos = leerRenglonesDelPlan(plan.description);
  const conceptosDelPlan = leidos.length > 0 ? leidos.map((r) => r.nombre) : [plan.name];
  // Sin tarifario: en el PDF manda SIEMPRE el precio del plan (revisión t8, N-P2).
  const [clinic, pagos] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: args.clinicId },
      select: { ...CLINIC_LETTERHEAD_SELECT, timezone: true, locale: true },
    }),
    args.verPagos ? pagosDelPlan(args.clinicId, plan.id, conceptosDelPlan) : Promise.resolve(null),
  ]);

  const membrete = await clinicLetterheadProps(clinic);
  // Sin `@/i18n/server`: ese arrastra getCurrentUser, y aquí la sesión ya la resolvió la ruta.
  const locale = resolveLocale(clinic?.locale);
  const t = makeT(getDict(locale));
  const intl = locale === "en" ? "en-US" : "es-MX";
  const zona = consentTimeZone(clinic?.timezone);
  const ahora = args.ahora ?? new Date();
  const fechaLarga = (d: Date) => formatoEnZona(d, { day: "numeric", month: "long", year: "numeric" }, zona, intl) ?? "—";

  const documento = armarDocumentoDelPlan(
    { name: plan.name, description: plan.description, totalCost: Number(plan.totalCost) || 0, createdAt: plan.createdAt },
    pagos,
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
    pagado: t("planTratamiento.pdf.pagado"),
    saldo: t("planTratamiento.pdf.saldo"),
    notaPagos: t("planTratamiento.pdf.notaPagos"),
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
