// Implants — vista per-paciente. Carga el implante con todas sus
// relaciones y monta ImplantsTab. Spec §6.

export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { puedeClinico } from "@/lib/auth/guardia-clinica";
import { SinAccesoClinico } from "@/components/dashboard/sin-permiso-rediseno/sin-acceso-clinico";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { destinoModuloVencido } from "@/components/dashboard/marketplace-oculto/servidor";
import { IMPLANTS_MODULE_KEY } from "@/lib/implants/permissions";
import { ImplantsTab } from "@/components/specialties/implants/ImplantsTab";
import type { ImplantFull } from "@/lib/types/implants";

interface PageProps {
  params: Promise<{ patientId: string }>;
}

export default async function ImplantsPatientPage({ params }: PageProps) {
  const { patientId } = await params;
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  if (user.clinic.category !== "DENTAL") {
    redirect("/dashboard");
  }
  const access = await canAccessModule(user.clinicId, IMPLANTS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(await destinoModuloVencido(user.clinicId, IMPLANTS_MODULE_KEY));
  }

  // ws1-t11 · lead 12: lo clínico pide «Ver expediente clínico» también en la
  // página (guardia-clinica, con el override por persona), antes de cargar nada.
  if (!puedeClinico(user, "ver")) return <SinAccesoClinico />;

  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      clinicId: user.clinicId,
      deletedAt: null,
      // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
      AND: [...patientVisibilityAnd(viewer)],
    },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!patient) notFound();

  const implants = (await prisma.implant.findMany({
    where: { patientId, clinicId: user.clinicId },
    include: {
      surgicalRecord: true,
      healingPhase: true,
      secondStage: true,
      prostheticPhase: true,
      complications: { orderBy: { detectedAt: "desc" } },
      followUps: { orderBy: { scheduledAt: "asc" } },
      consents: { orderBy: { createdAt: "desc" } },
      passport: true,
    },
    orderBy: { placedAt: "desc" },
  })) as unknown as ImplantFull[];

  return (
    <div className="p-6">
      <ImplantsTab
        patientId={patient.id}
        patientName={`${patient.firstName} ${patient.lastName}`}
        doctorId={user.id}
        doctorName={`${user.firstName} ${user.lastName}`}
        doctorCedula={user.cedulaProfesional ?? null}
        implants={implants}
      />
    </div>
  );
}
