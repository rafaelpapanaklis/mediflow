export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { AuditoriaClient } from "./auditoria-client";

// Bitácora de la clínica. SOLO ADMIN/dueño — recepción/doctor no.
export default async function DashboardAuditoriaPage() {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.isAdmin) redirect("/dashboard");
  // REDISEÑO (ws1-t6) — el MISMO interruptor por clínica que enciende el menú de
  // dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual). No añade un
  // viaje a la base: la respuesta vive 60 s en memoria por clínica y el layout
  // ya la pidió en esta misma carga.
  const rediseno = await menuDosNivelesEncendido(ctx.clinicId);
  // El filtro «Ortodoncia (todo)» solo sale en sedes dentales con el módulo
  // contratado de verdad (ws1-t5). Solo decide si se PINTA la opción: las
  // filas siguen saliendo de la clínica de la sesión, como siempre.
  const ortodoncia =
    ctx.clinicCategory === "DENTAL" &&
    (await hasActiveOrthodonticsModule(ctx.clinicId).catch(() => false));
  return <AuditoriaClient key={ctx.clinicId} rediseno={rediseno} ortodoncia={ortodoncia} />;
}
