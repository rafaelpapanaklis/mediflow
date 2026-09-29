// Ortodoncia — carta de alta del caso (H66). Mismas guardias que los otros PDF del caso.

import { NextResponse } from "next/server";
import { cargarNombreDeTecnica } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { differenceInMonths } from "date-fns";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getAuthContext } from "@/lib/auth-context";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import { puedeVerExpediente } from "@/lib/orthodontics/permiso-expediente";
import { DischargeLetterPdf } from "@/lib/orthodontics/pdf-templates/discharge-letter";
import { techniqueLabel } from "@/lib/orthodontics/consent-texts";
import { cargarMembreteOrto } from "@/lib/orthodontics/pdf/membrete-orto-db";
import { nombreDeArchivoPdf } from "@/lib/orthodontics/pdf/nombre-de-archivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  if (!(await hasActiveOrthodonticsModule(ctx.clinicId))) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return NextResponse.json({ error: MENSAJE_SIN_ACCESO_ORTODONCIA }, { status: 403 });
  }
  if (!puedeVerExpediente(ctx)) {
    return NextResponse.json({ error: "No tienes permiso para ver el expediente de este paciente." }, { status: 403 });
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, deletedAt: null },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      diagnosis: { select: { diagnosedById: true } },
      phases: { select: { phaseKey: true, completedAt: true } },
    },
  });
  if (!plan) return NextResponse.json({ error: "Caso no encontrado" }, { status: 404 });

  const denied = await assertPatientVisible(plan.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (denied) return denied;

  // Solo tiene sentido con la aparatología ya retirada (retención o terminado).
  if (plan.status !== "RETENTION" && plan.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "La carta de alta se emite cuando el caso está en retención o terminado." },
      { status: 400 },
    );
  }

  const [membrete, regimen] = await Promise.all([
    // ws1-t4: membrete común de ortodoncia (logo, clínica, paciente, doctor con cédula y especialidad).
    cargarMembreteOrto({
      clinicId: ctx.clinicId,
      patientId: plan.patientId,
      doctorId: plan.treatingDoctorId ?? plan.diagnosis.diagnosedById,
    }),
    prisma.orthoRetentionRegimen
      .findUnique({
        where: { treatmentPlanId: plan.id },
        select: { debondedAt: true, checkups: { orderBy: { monthsFromDebond: "asc" }, select: { monthsFromDebond: true, scheduledDate: true } } },
      })
      .catch(() => null),
  ]);

  const inicio = plan.installedAt ?? plan.startDate;
  const fin = regimen?.debondedAt ?? plan.phases.find((p) => p.phaseKey === "FINISHING")?.completedAt ?? null;

  const buffer = await renderToBuffer(
    <DischargeLetterPdf
      membrete={membrete}
      techniqueLabel={techniqueLabel(plan.technique, await cargarNombreDeTecnica(ctx.clinicId, plan.id))}
      startDate={inicio ? inicio.toISOString() : null}
      endDate={fin ? fin.toISOString() : null}
      durationMonths={inicio && fin ? Math.max(0, differenceInMonths(fin, inicio)) : null}
      retentionPlanText={plan.retentionPlanText ?? null}
      revisiones={(regimen?.checkups ?? []).map((c) => ({ meses: c.monthsFromDebond, fecha: c.scheduledDate.toISOString() }))}
    />,
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreDeArchivoPdf("carta-de-alta", membrete.paciente.nombre)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
