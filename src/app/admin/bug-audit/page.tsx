export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { BugAuditClient } from "./bug-audit-client";

export const metadata: Metadata = { title: "Auditoría de bugs · Admin DaleControl" };

/**
 * Panel de auditoría de bugs — zona /admin/* (platform owner).
 * Auth = sesión en BD vía isAdminAuthed(): el middleware sólo comprueba que la
 * cookie `admin_token` esté presente; la validación real (sesión viva, no
 * revocada, AdminUser activo) la hacen el layout de /admin y cada ruta de
 * /api/admin/*. No requiere getCurrentUser/Supabase aquí.
 */
export default function BugAuditPage() {
  return <BugAuditClient />;
}
