import type { Metadata } from "next";
import Link from "next/link";
import { AdminSettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuración — Admin MediFlow" };

export default function AdminSettingsPage() {
  return <AdminSettingsClient />;
}
