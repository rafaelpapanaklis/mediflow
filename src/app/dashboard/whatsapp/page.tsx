export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getEffectiveReminderSettings } from "@/lib/reminders/config";
import { getRecentReminders } from "@/lib/whatsapp/recent-reminders";
import { WhatsAppClient } from "./whatsapp-client";

export const metadata: Metadata = { title: "WhatsApp — DaleControl" };

export default async function WhatsAppPage() {
  const user = await getCurrentUser();
  // Mismo gate que las hijas (bot/ y bot/saldo/). Hasta ahora esta pantalla
  // solo mostraba la conexión y el sidebar bastaba para esconderla; el panel de
  // recordatorios trae NOMBRES DE PACIENTES, y por URL directa entraba
  // cualquier rol —incluido DOCTOR, que no tiene "whatsapp.view"—.
  requirePermissionOrRedirect(user, "whatsapp.view");
  const connected = user.clinic.waConnected ?? false;

  // Config EFECTIVA (reminderSettings Json si existe; si no, los toggles
  // legacy). Es la que de verdad usa el cron, así que es la que decide si la
  // pantalla debe advertir sobre la ventana de 24 h.
  const reminders = getEffectiveReminderSettings(user.clinic);

  // Estado real de la cola. Solo se consulta si hay WhatsApp conectado: es la
  // única vista donde se muestra el panel.
  const recent = connected
    ? await getRecentReminders(user.clinicId, user.clinic.timezone)
    : { rows: [], failed: false };

  return (
    <WhatsAppClient
      key={user.clinicId}
      connected={connected}
      phoneNumberId={user.clinic.waPhoneNumberId ?? ""}
      wabaId={user.clinic.waBusinessAccountId ?? ""}
      connMethod={user.clinic.waConnMethod ?? ""}
      reminderMsg={user.clinic.waReminderMsg ?? ""}
      reminder24h={user.clinic.waReminder24h ?? true}
      reminder1h={user.clinic.waReminder1h ?? false}
      remindersEnabled={reminders.enabled && reminders.offsets.length > 0}
      recentReminders={recent.rows}
      recentRemindersFailed={recent.failed}
      clinicName={user.clinic.name}
    />
  );
}
