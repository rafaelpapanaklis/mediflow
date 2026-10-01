export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { AprendeClient } from "./aprende-client";

export const metadata: Metadata = { title: "Bot de WhatsApp · Aprende de tu equipo — DaleControl" };

/**
 * ws1-t11. Ver pide el permiso del bot Y el del Inbox (los textos salen de las
 * conversaciones); aprobar, calificar y elegir tono pide «whatsapp.send», el
 * mismo que editar las respuestas frecuentes. Las API repiten las dos guardias.
 */
export default async function AprendePage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  requirePermissionOrRedirect(user, "inbox.view");
  const canEdit = hasPermission(user, "whatsapp.send");
  return <AprendeClient key={user.clinicId} canEdit={canEdit} />;
}
