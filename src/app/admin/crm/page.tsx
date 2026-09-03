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
//
// ── LO QUE SE CARGA DE MÁS, Y POR QUÉ CADA COSA TRAE SU CATCH ──────────
// Además de los prospectos se leen dos cosas, y NINGUNA puede tumbar la
// pantalla:
//   · las cuentas de /admin/clinics (sólo id y nombre) para poder decir
//     qué cuenta nació de un prospecto ganado;
//   · "mis textos", para poder copiarlos desde cualquier tarjeta.
// Las dos son accesorias: sin ellas el CRM sigue sirviendo entero, así que
// un fallo suyo se traga y se sigue. Lo que SÍ tumba la pantalla es no
// poder leer los prospectos, y eso ya se dice con todas sus letras.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { crmListar } from "@/lib/admin/crm/service";
import { crmTextosListar } from "@/lib/admin/crm/textos-service";
import { CrmClient } from "./crm-client";
import { CrmTabs } from "./crm-tabs";

export const metadata: Metadata = { title: "CRM de ventas — Admin DaleControl" };

/**
 * Tope de cuentas que se mandan al selector de "¿qué cuenta nació de este
 * prospecto?". Es un <select>, no un buscador: con más de esto habría que
 * cambiarlo por otra cosa, y mientras tanto el formulario deja teclear el
 * id a mano para el que no salga en la lista.
 */
const CLINICAS_MAX = 500;

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

  const [clinicas, textos] = await Promise.all([
    prisma.clinic
      .findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: CLINICAS_MAX })
      .catch((e) => {
        console.error("[admin/crm] no se pudo leer la lista de clínicas:", e);
        return [] as { id: string; name: string }[];
      }),
    // crmTextosListar NO lanza: si falta su SQL devuelve la lista vacía.
    crmTextosListar(),
  ]);

  return <CrmClient listado={listado} clinicas={clinicas} textos={textos.textos} />;
}

function FaltaElSql() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
        CRM de ventas
      </h1>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 720 }}>
        A quién le queremos vender.
      </p>
      <CrmTabs activo="prospectos" />
      <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, maxWidth: 680 }}>
        No se pudo leer la lista de prospectos. Lo más probable es que falte aplicar{" "}
        <code>sql/crm-dalecontrol.sql</code> en Supabase: es el que crea las dos tablas del CRM
        (<code>crm_prospects</code> y <code>crm_activities</code>). Se pega en el editor de SQL y
        se corre; es idempotente, así que no pasa nada si ya se había corrido. El detalle del
        error está en los logs del servidor.
      </p>
      <p style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.6, maxWidth: 680 }}>
        Si al terminar «Mis textos» sigue diciendo que le falta una tabla, es que también hay que
        correr <code>sql/crm-textos.sql</code>: son dos archivos distintos.
      </p>
    </div>
  );
}
