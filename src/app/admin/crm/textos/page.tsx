export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /admin/crm/textos — MIS TEXTOS: el guion de venta.
//
// Para qué existe: el mensaje bueno se escribe una vez y se manda cien.
// Hoy vive en las notas del teléfono o se reescribe cada vez, y reescribir
// es lo que hace que se mande peor —o que no se mande.
//
// Segmento ESTÁTICO al lado del dinámico /admin/crm/[id]. Next resuelve
// primero el estático, así que "textos" nunca se lee como el id de un
// prospecto. (Lo que Next NO admite son dos segmentos DINÁMICOS distintos
// al mismo nivel; un estático y uno dinámico conviven sin problema.)
//
// Sin guard propio: /admin/layout.tsx no renderiza children sin sesión de
// administrador. Las MUTACIONES sí verifican por su cuenta (ver
// ../textos-actions.ts), porque una server action se alcanza sin pasar por
// ningún layout.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import { crmTextosListar } from "@/lib/admin/crm/textos-service";
import { CrmTabs } from "../crm-tabs";
import { CrmTextosClient } from "./textos-client";

export const metadata: Metadata = { title: "Mis textos — CRM — Admin DaleControl" };

export default async function Page() {
  // crmTextosListar NO lanza: si la tabla todavía no existe devuelve
  // `falta: true` y la pantalla lo dice con esas palabras, en vez de
  // enseñar una libreta vacía que se leería como "no has escrito nada".
  const listado = await crmTextosListar();

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
          CRM de ventas
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 720 }}>
          Los mensajes que le mandas a un prospecto, escritos una vez. Desde la ficha de cada uno
          se copian ya con su nombre y su ciudad puestos.
        </p>
      </div>

      <CrmTabs activo="textos" />

      <CrmTextosClient listado={listado} />
    </div>
  );
}
