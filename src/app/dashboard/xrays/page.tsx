export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { patientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { XraysPatientsList } from "./patients-list-client";

export const metadata: Metadata = { title: "Radiografías — DaleControl" };

export default async function XraysPage() {
  const user = await getCurrentUser();
  // EQ-07: la misma puerta que GET /api/xrays. Sin "Ver radiografías" la
  // página no se abre (y el link de la paleta cae en /dashboard?denied=).
  requirePermissionOrRedirect(user, "xrays.view");
  const clinicId = user.clinicId;
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };

  // Las dos consultas no dependen una de otra: antes iban en cascada (la
  // segunda esperaba a la primera) y ahora van juntas. Son las MISMAS dos; no
  // se añade ninguna. El interruptor del rediseño va en el mismo viaje.
  //
  // REDISEÑO — el MISMO interruptor por clínica que enciende el menú de dos
  // niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la lista de hoy, tal cual). Su respuesta
  // vive 60 s en memoria por clínica: aquí cae en la caché que el layout
  // acaba de llenar.
  const [patients, xrayFiles, rediseno] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId,
        status: "ACTIVE",
        // Visibilidad por paciente: no listar/mostrar pacientes restringidos a quien no está en su visibleUserIds.
        AND: [...patientVisibilityAnd(viewer)],
      },
      orderBy: { firstName: "asc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        patientNumber: true,
        dob: true,
        gender: true,
      },
    }),
    // Conteo de radiografías + última fecha por paciente.
    //
    // Usamos $queryRaw con cast `category::text` para evitar
    // "operator does not exist: text = FileCategory" cuando la columna
    // patient_files.category quedó como TEXT en alguna DB legacy aunque
    // schema.prisma la declare como enum FileCategory. El cast textual
    // funciona en ambos casos (text vs enum) sin requerir migración
    // urgente del tipo de columna.
    prisma.$queryRaw<Array<{ patientId: string | null; createdAt: Date }>>`
      SELECT "patientId", "createdAt"
      FROM patient_files
      WHERE "clinicId" = ${clinicId}
        AND category::text IN ('XRAY_PERIAPICAL', 'XRAY_PANORAMIC', 'XRAY_BITEWING', 'XRAY_OCCLUSAL')
    `,
    menuDosNivelesEncendido(clinicId),
  ]);
  const countByPatient = new Map<string, number>();
  const lastByPatient = new Map<string, Date>();
  for (const f of xrayFiles) {
    if (!f.patientId) continue;
    countByPatient.set(f.patientId, (countByPatient.get(f.patientId) ?? 0) + 1);
    const prev = lastByPatient.get(f.patientId);
    if (!prev || f.createdAt > prev) lastByPatient.set(f.patientId, f.createdAt);
  }

  const patientsWithMeta = patients.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    patientNumber: p.patientNumber,
    dob: p.dob ? p.dob.toISOString() : null,
    gender: p.gender ?? null,
    xrayCount: countByPatient.get(p.id) ?? 0,
    lastXrayAt: lastByPatient.get(p.id)?.toISOString() ?? null,
  }));

  return <XraysPatientsList patients={patientsWithMeta} rediseno={rediseno} />;
}
