export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { InboxClient } from "./inbox-client";

export const metadata: Metadata = { title: "Inbox — DaleControl" };

export default async function InboxPage() {
  // key por clínica: el Inbox carga hilos client-side (fetch al montar +
  // polling /api/inbox/since) que NO se re-disparan al cambiar de sede; sin
  // re-montar mostraría/mezclaría hilos y PHI de la clínica anterior.
  const user = await getCurrentUser();
  return (
    <InboxClient
      key={user.clinicId}
      viewer={{
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        clinicName: user.clinic?.name ?? "",
        // "inbox.send": el permiso con el que se responde. Decide también si se
        // ofrece INICIAR una conversación ("+ Componer"), porque es el mismo
        // acto. Se resuelve aquí y no en el cliente: el permiso se enciende y
        // apaga persona a persona desde el modal de equipo.
        // /api/inbox/compose lo revalida con 403.
        canSend: hasPermission(
          { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
          "inbox.send",
        ),
      }}
    />
  );
}
