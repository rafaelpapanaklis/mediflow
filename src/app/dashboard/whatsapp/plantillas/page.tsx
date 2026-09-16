export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { hasPermission } from "@/lib/auth/permissions";
import { parseWaTemplates } from "@/lib/whatsapp/template-config";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { TemplatesClient } from "./templates-client";

export const metadata: Metadata = { title: "Plantillas de WhatsApp — DaleControl" };

export default async function WhatsAppTemplatesPage() {
  const user = await getCurrentUser();
  // Mismo gate que la pantalla madre y la del bot.
  requirePermissionOrRedirect(user, "whatsapp.view");
  // Ver la config es "whatsapp.view"; cambiarla es "whatsapp.send" — el mismo
  // permiso que exige el PUT. Sin él se muestra en solo lectura en vez de
  // dejar que el guardado falle con un 403.
  const canEdit = hasPermission(user, "whatsapp.send");
  // REDISEÑO (ws1-t5): el MISMO interruptor por clínica que enciende el menú
  // de dos niveles. Esta página no pide nada más a la base (las plantillas
  // vienen de la sesión); la respuesta vive 60 s en memoria por clínica y el
  // layout la acaba de pedir en esta misma petición, así que se resuelve de la
  // caché (o se une a la consulta en vuelo), sin consulta nueva. Falla cerrado.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);

  return (
    <TemplatesClient
      key={user.clinicId}
      canEdit={canEdit}
      rediseno={rediseno}
      connected={user.clinic.waConnected ?? false}
      // Solo el booleano: el id de la cuenta de Meta no tiene por qué viajar al
      // navegador, y lo único que decide la pantalla es si se pueden crear.
      hasWaba={Boolean(user.clinic.waBusinessAccountId)}
      // Se pasa ya parseado: una entrada corrupta en el Json no debe llegar a
      // los inputs como texto raro.
      templates={parseWaTemplates(user.clinic.waTemplates)}
      billingOk={user.clinic.waBillingOk ?? false}
    />
  );
}
