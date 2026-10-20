export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { listTemplates } from "@/lib/document-templates/service";
import { TEMPLATES_WRITE_PERMISSION } from "@/lib/document-templates/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { ORTHO_DEFAULT_TEMPLATES, ensureOrthoDefaults } from "@/lib/clinical-shared/evolution-templates/seed-orthodontics";
import { listarPlantillasNota, type PlantillaNotaDTO } from "@/lib/orthodontics/plantillas-nota-service";
import { catalogoLigable, repoHojasVigente, tablaHojasExiste } from "@/lib/indicaciones/db";
import { listarHojas } from "@/lib/indicaciones/servicio";
import type { HojaDTO, ProcedimientoLigable } from "@/lib/indicaciones/tipos";
import { repoVersiones } from "@/lib/plantillas-fabrica/db";
import { restaurableDe } from "@/lib/plantillas-fabrica/consentimiento";
import { PlantillasClient } from "./plantillas-client";
import { esPrecargada } from "./tarjeta";

export default async function PlantillasPage() {
  const user = await getCurrentUser();
  // Mismo permiso que enseña la opción en el menú y que exige la API para
  // escribir: doctor o (super)admin. Ver src/lib/document-templates/permissions.ts.
  requirePermissionOrRedirect(user, TEMPLATES_WRITE_PERMISSION);

  const templates = await listTemplates(prisma, user.clinicId, { includeInactive: true });

  // Plantillas de fábrica editables (ws1-t6): la versión de cada clínica vive en
  // `clinic_template_versions` (sql/salamanca-plantillas-orto-versiones.sql). Sin la
  // tabla las de fábrica siguen siendo de solo lectura; nada se rompe.
  let versionesDisponibles = false;
  try {
    versionesDisponibles = await repoVersiones.disponible();
  } catch (err) {
    console.error("[plantillas] versiones por clínica:", err);
  }

  // Las notas de la hoja de control de Ortodoncia (ws1-t5): solo con el módulo
  // contratado. Si la tabla o la lectura fallan, la pestaña no sale y el resto
  // de Plantillas sigue funcionando.
  let orto: PlantillaNotaDTO[] | null = null;
  try {
    if (await hasActiveOrthodonticsModule(user.clinicId)) {
      const fabrica = ORTHO_DEFAULT_TEMPLATES.map((t) => t.name);
      orto = await listarPlantillasNota(prisma, user.clinicId, fabrica, repoVersiones);
      // Las de fábrica nacen la primera vez que alguien las necesita (aquí o en la hoja).
      if (fabrica.some((n) => !orto!.some((o) => o.name.toLowerCase() === n.toLowerCase()))) {
        await ensureOrthoDefaults({ clinicId: user.clinicId, createdBy: user.id });
        orto = await listarPlantillasNota(prisma, user.clinicId, fabrica, repoVersiones);
      }
    }
  } catch (err) {
    console.error("[plantillas] notas de ortodoncia:", err);
    orto = null;
  }

  // Indicaciones y constancia (ws1-t10): solo con la tabla creada
  // (sql/ws1-t10-indicaciones-y-constancia.sql). Sin ella, las dos pestañas no salen.
  let hojas: HojaDTO[] | null = null;
  let procedimientos: ProcedimientoLigable[] = [];
  try {
    if (await tablaHojasExiste()) {
      procedimientos = await catalogoLigable(user.clinicId);
      hojas = await listarHojas(repoHojasVigente, user.clinicId, async () => procedimientos);
    }
  } catch (err) {
    console.error("[plantillas] indicaciones y constancia:", err);
    hojas = null;
  }

  return (
    <PlantillasClient
      key={user.clinicId}
      initialOrto={orto}
      initialHojas={hojas}
      versionesDisponibles={versionesDisponibles}
      procedimientos={procedimientos}
      initialTemplates={templates.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        body: t.body,
        isActive: t.isActive,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        precargada: esPrecargada(t.createdById),
        restaurable: restaurableDe({ kind: t.kind, name: t.name, body: t.body, createdById: t.createdById }),
      }))}
    />
  );
}
