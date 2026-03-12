import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuración — MediFlow" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  return <SettingsClient user={user as any} clinic={user.clinic as any} />;
}
