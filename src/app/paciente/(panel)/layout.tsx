// Layout del panel del paciente. Implementa A10.
// Server component: valida sesión con getPatientPortalContext(); si no hay,
// redirect("/paciente/login?next=/paciente"). Render: <PacientePortalShell
// me={ctx.account}>{children}</PacientePortalShell>.
// Referencia de patrón: src/app/laboratorios/(panel)/layout.tsx.
import { redirect } from "next/navigation";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { PacientePortalShell } from "@/components/paciente/portal-shell";

export const dynamic = "force-dynamic";

export default async function PacientePanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getPatientPortalContext();
  if (!ctx) redirect("/paciente/login?next=/paciente");

  return <PacientePortalShell me={ctx.account}>{children}</PacientePortalShell>;
}
