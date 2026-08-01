export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { toAdminRow } from "@/lib/account-manager/admin";
import type { AccountManagerAdminRow } from "@/lib/account-manager/types";
import { AccountManagersClient } from "./account-managers-client";

export const metadata: Metadata = { title: "Managers de cuenta — Admin DaleControl" };

// AccountManager es un catálogo GLOBAL (sin clinicId): el owner ve todos.
// La carga va en try/catch porque sql/account-managers.sql se aplica a mano
// DESPUÉS del deploy — mientras tanto la pantalla se muestra vacía con el aviso
// de "falta correr el SQL" en vez de reventar con un 500.
export default async function AdminAccountManagersPage() {
  let managers: AccountManagerAdminRow[] = [];
  let sqlPending = false;

  try {
    const rows = await prisma.accountManager.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        photoUrl: true,
        whatsappE164: true,
        whatsappDisplay: true,
        days: true,
        startMinutes: true,
        endMinutes: true,
        timezone: true,
        status: true,
        createdAt: true,
        _count: { select: { clinics: true } },
      },
    });
    managers = rows.map(toAdminRow);
  } catch (e) {
    console.warn("[admin/account-managers] tabla no disponible todavía:", e);
    sqlPending = true;
  }

  return <AccountManagersClient initial={managers} sqlPending={sqlPending} />;
}
