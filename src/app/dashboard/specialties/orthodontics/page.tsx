// Orthodontics — página index del módulo (kanban a nivel clínica). SPEC §6.2.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { buildKanbanData } from "@/lib/orthodontics/build-kanban-data";
import { OrthoKanbanBoard } from "@/components/specialties/orthodontics/_components/OrthoKanbanBoard";

export default async function OrthodonticsIndexPage() {
  const user = await getCurrentUser();
  if (user.clinic.category !== "DENTAL") redirect("/dashboard");
  const access = await canAccessModule(user.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    redirect(`/dashboard/marketplace?expired=${ORTHODONTICS_MODULE_KEY}`);
  }

  const cards = await buildKanbanData(user.clinicId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
      <header>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", margin: 0 }}>
          Ortodoncia
        </h1>
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
          Kanban operativo de pacientes activos. Cada card lleva fase, mes
          en tratamiento, compliance y estado financiero.
        </p>
      </header>

      <OrthoKanbanBoard cards={cards} />
    </div>
  );
}
