export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// ESTUDIO IA del panel de inmuebles.
//
// Los MISMOS cuatro candados que abre `openStudioGate` en las rutas de
// API, en el mismo orden. No es duplicación por descuido: esto decide qué
// se PINTA y aquello decide qué se EJECUTA. Quien escriba la URL a mano
// llega igual a la página, así que la página también tiene que negarse — y
// quien llame al endpoint con fetch se salta la página entera.
//
// La diferencia está en la RESPUESTA: aquí se explica en una frase por qué
// no se puede, allá se devuelve un 403. Un redirect silencioso a /inicio
// deja a la persona sin saber si se equivocó de liga o si le falta el plan.
//
// ⚠️ EL ITEM DEL MENÚ NO EXISTE TODAVÍA. REALTY_NAV_ITEMS vive en
// src/lib/realty/types.ts, que esta terminal tiene PROHIBIDO tocar. La
// pantalla funciona por URL y el renglón que falta va en el reporte, para
// que lo agregue quien integre la ola.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import {
  REALTY_STUDIO_FEATURE,
  REALTY_STUDIO_PERMISSION,
} from "@/lib/realty/studio/types";
import { RealtyStudioScreen } from "@/components/realty/studio/studio-screen";
import studioDict from "@/i18n/dictionaries/realty/studio.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "estudio";

export const metadata: Metadata = { title: "Estudio con IA — DaleControl Inmuebles" };

function Aviso({ texto }: { texto: string }) {
  return (
    <div className="realty-page">
      <div
        style={{
          padding: 20,
          borderRadius: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-2)",
          fontSize: 13.5,
          lineHeight: 1.6,
          maxWidth: 620,
        }}
      >
        {texto}
      </div>
    </div>
  );
}

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // El MODO sale del contrato, no de un if inventado aquí. Hoy el item no
  // existe, así que `item` es undefined y no recorta nada; el día que se
  // agregue con sus `modes`, esta línea ya obedece sin tocarse.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  // i18n — CONVENCIÓN B: aquí se RECORTA el sub-árbol y el componente llama
  // a makeRealtyT SIN prefijo (ver la nota dentro de studio.json).
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (studioDict as unknown as Record<string, Dictionary>)[locale];
  const errores = dict.errores as Dictionary;

  // 🔴 Por FEATURE, nunca por el id del plan: los planes se editan en
  // realty_plan_configs sin desplegar, y un `plan === "INMOBILIARIA"` a mano
  // se queda viejo el día que alguien mueva la escalera.
  if (!realtyPlanHasFeature(ctx.plan, REALTY_STUDIO_FEATURE)) {
    return <Aviso texto={errores.sinPlan as string} />;
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, REALTY_STUDIO_PERMISSION)) {
    return <Aviso texto={errores.sinPermiso as string} />;
  }

  if (!isRealtySubscriptionActive(ctx.account) || !ctx.account.isActive) {
    return <Aviso texto={errores.sinSuscripcion as string} />;
  }

  // La cartera para el selector. Se cuentan las fotos porque el reel las
  // NECESITA: enseñar "sin fotos" en la lista evita elegir un inmueble,
  // apretar "preparar" y recibir un error que ya se sabía de antemano.
  //
  // No se filtra por asesor a propósito: el permiso que abre esta pantalla
  // es `properties.edit`, y quien puede editar la ficha ya ve el inmueble en
  // /inmobiliaria/inmuebles. Recortar aquí sería inventar una regla de
  // visibilidad que el resto del panel no aplica.
  let properties: Array<{ id: string; title: string; photos: number }> = [];
  try {
    const rows = await prisma.realtyProperty.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        _count: { select: { photos: true } },
      },
    });
    properties = rows.map((r) => ({
      id: r.id,
      title: r.title,
      photos: r._count.photos,
    }));
  } catch (e) {
    // Sin cartera la pantalla se pinta igual y dice "todavía no tienes
    // inmuebles": es mucho mejor que una pantalla en blanco.
    console.error("[realty/studio] no se pudo leer la cartera:", e);
  }

  return <RealtyStudioScreen dict={dict} properties={properties} />;
}
