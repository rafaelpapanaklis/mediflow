// Calendario de publicaciones (WS-MKT-T3). Server component: solo guarda auth y
// monta el cliente, que pide los posts por rango visible a /api/marketing/posts.

import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-context";
import CalendarClient from "./calendar-client";

export const dynamic = "force-dynamic";

export default async function MarketingCalendarPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return <CalendarClient />;
}
