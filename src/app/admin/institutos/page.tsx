export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// /admin/institutos — LOS INSTITUTOS VISTOS DESDE DALECONTROL, y lo que
// hay que facturarles al mes por almacenamiento.
//
// Para qué existe: hoy una escuela puede tener 20 TB contratados y ese
// dinero se le va a DaleControl sin que nadie lo note, porque el contrato
// institucional NO pasa por Stripe — se administra a mano, por diseño (está
// escrito en el esquema, al lado de las fechas de vigencia). Esta pantalla
// es lo que le recuerda cobrar: TB contratados, TB usados y cuánto vale el
// extra este mes.
//
// 🔴 AQUÍ SÍ SE EDITA LA CUOTA, y es el ÚNICO sitio del producto donde se
// edita. En el panel de la escuela se VE y no se toca: si la escuela
// pudiera subírsela sola, el cobro por TB extra no existiría.
//
// Sin guard propio: /admin/layout.tsx no renderiza children sin sesión de
// administrador. La MUTACIÓN sí verifica por su cuenta (ver actions.ts),
// porque una server action se alcanza sin pasar por ningún layout.
// ═══════════════════════════════════════════════════════════════════════
import type { Metadata } from "next";
import {
  EDU_ALM_INCLUIDO_TB,
  eduAlmTotalMensualMxn,
  listEduAlmacenamientoAdmin,
} from "@/lib/edu/almacenamiento";
import { AdminInstitutosClient } from "./institutos-client";

export const metadata: Metadata = { title: "Institutos — Admin DaleControl" };

export default async function Page() {
  let rows;
  try {
    rows = await listEduAlmacenamientoAdmin();
  } catch (err) {
    // El motivo casi seguro: sql/edu-cuota-storage.sql todavía no se aplicó
    // y la columna "storageQuotaBytes" no existe. Se dice con esas palabras
    // en vez de tirar la pantalla con un stack: /admin es el panel de
    // DaleControl y esta es la única sección que depende de ese .sql.
    console.error("[admin/institutos] no se pudo leer el almacenamiento:", err);
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
          Institutos
        </h1>
        <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--text-2)", maxWidth: 640 }}>
          No se pudo leer el almacenamiento de los institutos. Lo más probable es que falte
          aplicar <code>sql/edu-cuota-storage.sql</code> en Supabase: es el que crea la columna
          de la cuota. El detalle está en los logs del servidor.
        </p>
      </div>
    );
  }

  return (
    <AdminInstitutosClient
      rows={rows}
      incluidoTb={EDU_ALM_INCLUIDO_TB}
      totalMensualMxn={eduAlmTotalMensualMxn(rows)}
    />
  );
}
