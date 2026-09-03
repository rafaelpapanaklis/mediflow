export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /admin/crm/[id] — la ficha de UN prospecto y su bitácora.
//
// Es una ruta propia y no un panel lateral a propósito: con un prospecto
// se pasa rato, y hace falta poder mandar la URL, volver con el botón
// atrás y tener sitio para la bitácora completa. El mismo criterio que
// /admin/clinics/[id] y /admin/affiliates/[id].
//
// La lectura y la resolución de la clínica vinculada viven en el servicio
// (cada una con su catch): esta página sólo decide entre pintar, avisar de
// que falta el SQL, o 404.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { crmObtener } from "@/lib/admin/crm/service";
import { CrmProspectoClient } from "./prospecto-client";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const ficha = await crmObtener(params.id).catch(() => null);
  return {
    title: ficha
      ? `${ficha.prospecto.name} — CRM — Admin DaleControl`
      : "Prospecto — CRM — Admin DaleControl",
  };
}

export default async function Page({ params }: { params: { id: string } }) {
  let ficha;
  try {
    ficha = await crmObtener(params.id);
  } catch (err) {
    console.error("[admin/crm/[id]] no se pudo leer el prospecto:", err);
    return (
      <div style={{ padding: 24, maxWidth: 680 }}>
        <Link href="/admin/crm" style={{ fontSize: 12, color: "var(--text-3)" }}>
          ← CRM de ventas
        </Link>
        <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6 }}>
          No se pudo leer este prospecto. Lo más probable es que falte aplicar{" "}
          <code>sql/crm-dalecontrol.sql</code> en Supabase. El detalle está en los logs del
          servidor.
        </p>
      </div>
    );
  }

  if (!ficha) notFound();

  return <CrmProspectoClient ficha={ficha} />;
}
