export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { BotClient } from "./bot-client";

export const metadata: Metadata = { title: "Bot de WhatsApp — DaleControl" };

export default async function WhatsAppBotPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  // Ver la config es "whatsapp.view"; cambiarla es "whatsapp.send" — el mismo
  // permiso que exigen las rutas PATCH/POST/DELETE del bot. Sin él la pantalla
  // se muestra en solo lectura en vez de dejar que el guardado falle con 403.
  const canEdit = hasPermission(user, "whatsapp.send");
  // REDISEÑO (ws1-t5): el MISMO interruptor por clínica que enciende el menú
  // de dos niveles. Esta página no pide nada más a la base (el cliente carga
  // el bot por fetch); la respuesta vive 60 s en memoria por clínica y el
  // layout la acaba de pedir en esta misma petición, así que se resuelve de la
  // caché (o se une a la consulta en vuelo), sin consulta nueva. Falla cerrado.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <BotClient key={user.clinicId} canEdit={canEdit} rediseno={rediseno} />;
}
