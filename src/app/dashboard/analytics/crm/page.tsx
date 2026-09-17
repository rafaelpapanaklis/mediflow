export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { CrmClient } from "./crm-client";

export const metadata: Metadata = { title: "CRM — Analytics" };

export default async function CrmPage() {
  const user = await getCurrentUser();
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div style={{ padding: 32, color: "var(--text-3)", fontSize: 13 }}>
        Solo administradores pueden ver el CRM.
      </div>
    );
  }
  // REDISEÑO DE ANALÍTICA — el MISMO interruptor por clínica que enciende el
  // menú de dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`).
  // El layout del panel ya lo resolvió en este mismo request y la respuesta
  // vive 60 s en memoria por clínica: aquí no hay viaje a la base. Falla
  // cerrado: apagado, la pantalla se pinta exactamente como hoy.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <CrmClient key={user.clinicId} rediseno={rediseno} />;
}
