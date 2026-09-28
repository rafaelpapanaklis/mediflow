import type { Metadata } from "next";
import { AdminSettingsClient } from "./settings-client";
import { prisma } from "@/lib/prisma";
import { getResolvedPlans } from "@/lib/plans";
import { leerCuentaSpeiParaEditar } from "@/lib/billing/spei-directo";
import { leerModulosEnVenta } from "@/lib/marketplace/module-price-admin";
import { computeMrrModulos, loadModulosContratados } from "@/lib/admin/modulos";

export const metadata: Metadata = { title: "Configuración — Admin DaleControl" };

export default async function AdminSettingsPage() {
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
  const [planConfigs, cuentaSpei] = await Promise.all([
    getResolvedPlans(),
    // Nunca lanza por tabla ausente: sin el SQL aplicado devuelve null.
    leerCuentaSpeiParaEditar().catch(() => null),
  ]);
  // Módulos que se venden aparte del plan: su precio (tabla `modules`) y quién
  // los tiene hoy. En fila y después de la tanda de arriba; ninguna de las dos
  // lanza (sin base devuelven vacío y la pestaña se pinta sin ese bloque).
  const enVenta = await leerModulosEnVenta();
  const contratados = enVenta.length > 0 ? await loadModulosContratados() : null;
  // Mismo universo que el MRR: los módulos de una clínica archivada no cuentan.
  const vivas = contratados?.medido
    ? await prisma.clinic
        .findMany({ where: { archivedAt: null }, select: { id: true } })
        .catch(() => null)
    : null;
  const uso = contratados?.medido && vivas
    ? computeMrrModulos(contratados.filas, new Date(), new Set(vivas.map((c) => c.id)))
    : null;
  const modulosEnVenta = enVenta.map((m) => {
    const linea = uso?.porModulo.find((l) => l.moduleKey === m.key);
    return {
      ...m,
      uso: uso
        ? { clinicas: linea?.clinicas ?? 0, pagando: linea?.pagando ?? 0, cortesia: linea?.cortesia ?? 0, total: linea?.total ?? 0 }
        : null,
    };
  });
  return (
    <AdminSettingsClient
      envStatus={envStatus}
      planConfigs={planConfigs}
      cuentaSpei={cuentaSpei}
      modulosEnVenta={modulosEnVenta}
    />
  );
}
