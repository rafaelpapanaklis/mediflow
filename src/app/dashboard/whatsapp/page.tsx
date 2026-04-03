export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { WhatsAppClient } from "./whatsapp-client";

export const metadata: Metadata = { title: "WhatsApp — MediFlow" };

export default async function WhatsAppPage() {
  const user = await getCurrentUser();
  return (
    <WhatsAppClient
      connected={user.clinic.waConnected ?? false}
      phoneNumberId={user.clinic.waPhoneNumberId ?? ""}
      reminderMsg={user.clinic.waReminderMsg ?? ""}
      reminder24h={user.clinic.waReminder24h ?? true}
      reminder1h={user.clinic.waReminder1h ?? false}
      clinicName={user.clinic.name}
    />
  );
}
