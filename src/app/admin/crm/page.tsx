export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /admin/crm — LA LIBRETA DE VENTAS DE DALECONTROL.
//
// Para qué existe: hoy los prospectos viven en la cabeza, en WhatsApp y en
// notas sueltas. Entre el 70 % y el 85 % de los prospectos se pierden por
// mal seguimiento, y no por el precio. Esta pantalla contesta la única
// pregunta que evita eso: ¿a quién le toca hoy?
//
// NO es la lista de clientes. El que ya contrató y paga vive en
// /admin/clinics; aquí está el de antes: la clínica que vi en Maps, la
// universidad que pidió informes, el consultorio que no me ha contestado.
//
// Sin guard propio: /admin/layout.tsx no renderiza children sin sesión de
// administrador. Las MUTACIONES sí verifican por su cuenta (ver
// actions.ts), porque una server action se alcanza sin pasar por ningún
// layout.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { crmListar } from "@/lib/admin/crm/service";
import { CrmClient } from "./crm-client";

export const metadata: Metadata = { title: "CRM de ventas — Admin DaleControl" };

export default async function Page() {
  let listado;
  try {
    listado = await crmListar();
  } catch (err) {
    // El motivo casi seguro: sql/crm-dalecontrol.sql todavía no se aplicó y
    // las tablas no existen. Se dice con esas palabras en vez de tirar la
    // pantalla con un stack — es el mismo trato que /admin/institutos.
    console.error("[admin/crm] no se pudo leer la lista de prospectos:", err);
    return <FaltaElSql />;
  }

  return <CrmClient listado={listado} />;
}

function FaltaElSql() {
  return (
    <div style={{ padding: 24, maxWidth: 680 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
        CRM de ventas
      </h1>
      <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6 }}>
        No se pudo leer la lista de prospectos. Lo más probable es que falte aplicar{" "}
        <code>sql/crm-dalecontrol.sql</code> en Supabase: es el que crea las dos tablas del CRM
        (<code>crm_prospects</code> y <code>crm_activities</code>). Se pega en el editor de SQL y
        se corre; es idempotente, así que no pasa nada si ya se había corrido. El detalle del
        error está en los logs del servidor.
      </p>
    </div>
  );
}
