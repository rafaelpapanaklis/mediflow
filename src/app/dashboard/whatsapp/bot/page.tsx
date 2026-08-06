export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { BotClient } from "./bot-client";

export const metadata: Metadata = { title: "Bot de WhatsApp — DaleControl" };

export default async function WhatsAppBotPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  // Ver la config es "whatsapp.view"; cambiarla es "whatsapp.send" — el mismo
  // permiso que exigen las rutas PATCH/POST/DELETE del bot. Sin él la pantalla
  // se muestra en solo lectura en vez de dejar que el guardado falle con 403.
  const canEdit = hasPermission(user, "whatsapp.send");
  return <BotClient key={user.clinicId} canEdit={canEdit} />;
}
