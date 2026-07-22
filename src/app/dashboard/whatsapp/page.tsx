export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { WhatsAppClient } from "./whatsapp-client";

export const metadata: Metadata = { title: "WhatsApp — DaleControl" };

export default async function WhatsAppPage() {
  const user = await getCurrentUser();
  return (
    <WhatsAppClient
      key={user.clinicId}
      connected={user.clinic.waConnected ?? false}
      phoneNumberId={user.clinic.waPhoneNumberId ?? ""}
      wabaId={user.clinic.waBusinessAccountId ?? ""}
      reminderMsg={user.clinic.waReminderMsg ?? ""}
      reminder24h={user.clinic.waReminder24h ?? true}
      reminder1h={user.clinic.waReminder1h ?? false}
      clinicName={user.clinic.name}
    />
  );
}
