export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { InboxClient } from "./inbox-client";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";

export const metadata: Metadata = { title: "Mensajes" }; // ws1-t1 (N-55): el «| DaleControl» lo pone la plantilla de app/layout.tsx

export default async function InboxPage() {
  // key por clínica: el Inbox carga hilos client-side (fetch al montar +
  // polling /api/inbox/since) que NO se re-disparan al cambiar de sede; sin
  // re-montar mostraría/mezclaría hilos y PHI de la clínica anterior.
  const user = await getCurrentUser();
  // Pulido WS1-T8, detrás del MISMO interruptor por clínica que el menú de dos
  // niveles (sql/menu-dos-niveles.sql): apagado, esta pantalla no cambia nada.
  const pulido = await menuDosNivelesEncendido(user.clinicId);
  return (
    <InboxClient
      key={user.clinicId}
      pulido={pulido}
      viewer={{
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        clinicName: user.clinic?.name ?? "",
        // ws1-t1 (C-119): el saludo y la fecha con la hora de la clínica.
        timezone: await zonaDeClinica(user.clinicId),
        // "inbox.send": el permiso con el que se responde. Decide también si se
        // ofrece INICIAR una conversación ("+ Componer"), porque es el mismo
        // acto. Se resuelve aquí y no en el cliente: el permiso se enciende y
        // apaga persona a persona desde el modal de equipo.
        // /api/inbox/compose lo revalida con 403.
        canSend: hasPermission(
          { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
          "inbox.send",
        ),
        // ws1-t11: 👍/👎 sobre las respuestas del bot. Mismo permiso que
        // editar sus respuestas frecuentes; la API lo revalida.
        canTeachBot: hasPermission(
          { role: user.role, permissionsOverride: user.permissionsOverride ?? [] },
          "whatsapp.send",
        ),
      }}
    />
  );
}
