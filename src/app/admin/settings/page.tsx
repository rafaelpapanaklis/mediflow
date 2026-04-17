import type { Metadata } from "next";
import { AdminSettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Configuración — Admin MediFlow" };

export default function AdminSettingsPage() {
  // Sólo podemos leer env vars en el server. Las exponemos como booleanos al
  // cliente (no filtramos ningún secreto, solo si están definidas).
  const envStatus = {
    ADMIN_PASSWORD:         Boolean(process.env.ADMIN_PASSWORD),
    ADMIN_SECRET_TOKEN:     Boolean(process.env.ADMIN_SECRET_TOKEN),
    ADMIN_TOTP_SECRET:      Boolean(process.env.ADMIN_TOTP_SECRET),
    SUPABASE_URL:           Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_ANON_KEY:      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    DATABASE_URL:           Boolean(process.env.DATABASE_URL),
    DIRECT_URL:             Boolean(process.env.DIRECT_URL),
    STRIPE_SECRET_KEY:      Boolean(process.env.STRIPE_SECRET_KEY),
    STRIPE_WEBHOOK_SECRET:  Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    RESEND_API_KEY:         Boolean(process.env.RESEND_API_KEY),
    WHATSAPP_TOKEN:         Boolean(process.env.MEDIFLOW_WHATSAPP_TOKEN),
    WHATSAPP_PHONE_ID:      Boolean(process.env.MEDIFLOW_WHATSAPP_PHONE_ID),
  };
  return <AdminSettingsClient envStatus={envStatus} />;
}
