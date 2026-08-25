export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// CALCULADORAS del panel de inmuebles.
//
// Reemplaza el placeholder de la Ola 0 sin tocar el layout, el sidebar ni
// el contrato: el item del menú, el permiso `calculators.use` y la feature
// `calculators` ya existían.
//
// TRES CANDADOS, y ninguno es decorativo:
//   1. MODO de la cuenta — sale del mismo campo `modes` del contrato que usa
//      el sidebar, no de un if inventado aquí.
//   2. FEATURE del plan — el layout ya esconde el item, pero esconder un
//      menú NO es control de acceso: quien escriba la URL llegaría igual.
//   3. PERMISO del rol.
// Los tres se repiten en cada ruta de API: esto decide qué se PINTA, aquello
// decide qué se EJECUTA.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission, type RealtyPermissionKey } from "@/lib/realty/permissions";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getCalcParamRows } from "@/lib/realty/calc/params";
import { MARCA_BITACORA, stateCodeFromName } from "@/lib/realty/calc/catalog";
import { filtroLeadsDelRol } from "@/lib/realty/calc/access";
import {
  CalculadorasScreen,
  type CalculoGuardado,
} from "@/components/realty/calc/calculadoras-screen";
import calcDict from "@/i18n/dictionaries/realty/calc.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "calculadoras";

export const metadata: Metadata = { title: "Calculadoras — DaleControl Inmuebles" };

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

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  // i18n — CONVENCIÓN B: aquí se RECORTA el sub-árbol y el componente llama
  // a makeRealtyT SIN prefijo. Este diccionario no se cuelga del barril de
  // realty a propósito (ver la nota dentro de calc.json).
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (calcDict as unknown as Record<string, Dictionary>)[locale];

  if (!realtyPlanHasFeature(ctx.plan, "calculators")) {
    return <Aviso texto={(dict.errores as Dictionary).sinPlan as string} />;
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "calculators.use" as RealtyPermissionKey)) {
    return <Aviso texto={(dict.errores as Dictionary).sinPermiso as string} />;
  }

  const rows = await getCalcParamRows();

  // Historial: la bitácora no tiene columna Json, así que los cálculos se
  // reconocen por la primera línea de la nota (ver MARCA_BITACORA).
  //
  // El historial enseña nombre de prospecto y nota financiera, así que pide
  // leads.view además de calculators.use: un override de solo "calculators.use"
  // (que REEMPLAZA los defaults del rol) no puede traer la cartera de regalo.
  // El alcance por rol sale del punto único, no de un if copiado aquí.
  let historial: CalculoGuardado[] = [];
  const puedeVerProspectos = hasRealtyPermission(permUser, "leads.view" as RealtyPermissionKey);
  try {
    if (!puedeVerProspectos) throw new Error("sin permiso de prospectos");
    const filas = await prisma.realtyLeadActivity.findMany({
      where: {
        accountId: ctx.accountId,
        note: { startsWith: MARCA_BITACORA },
        lead: filtroLeadsDelRol(ctx),
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        leadId: true,
        note: true,
        createdAt: true,
        lead: { select: { contact: { select: { name: true } } } },
      },
    });
    const fecha = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ctx.account.timezone || "America/Mexico_City",
    });
    historial = filas.map((f) => ({
      id: f.id,
      leadId: f.leadId,
      prospecto: f.lead?.contact?.name ?? "—",
      nota: (f.note ?? "").slice(MARCA_BITACORA.length),
      cuando: fecha.format(f.createdAt),
    }));
  } catch (e) {
    // Sin historial se sigue calculando: es un extra, no la pantalla.
    if (puedeVerProspectos) console.error("[realty-calc] no se pudo leer el historial:", e);
  }

  return (
    <CalculadorasScreen
      dict={dict}
      rows={rows}
      estadoInicial={stateCodeFromName(ctx.account.state)}
      historial={historial}
    />
  );
}
