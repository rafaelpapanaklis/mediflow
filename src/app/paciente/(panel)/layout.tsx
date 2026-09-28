// Layout del panel del paciente. Implementa A10.
// Server component: valida sesión con getPatientPortalContext(); si no hay,
// redirect("/paciente/login?next=/paciente"). Render: <PacientePortalShell
// me={ctx.account}>{children}</PacientePortalShell>.
// Referencia de patrón: src/app/laboratorios/(panel)/layout.tsx.
import { redirect } from "next/navigation";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { PacientePortalShell } from "@/components/paciente/portal-shell";
import { tieneOrtodonciaEnPortal } from "@/lib/patient-portal/ortodoncia-menu.server";

export const dynamic = "force-dynamic";

export default async function PacientePanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getPatientPortalContext();
  if (!ctx) redirect("/paciente/login?next=/paciente");

  // «Ortodoncia» solo sale en el menú si hay caso abierto y módulo activo. Se
  // decide aquí, en el layout: una vez por carga del portal, no por página.
  const tieneOrtodoncia = await tieneOrtodonciaEnPortal(ctx.links);

  return (
    <PacientePortalShell me={ctx.account} tieneOrtodoncia={tieneOrtodoncia}>
      {children}
    </PacientePortalShell>
  );
}
