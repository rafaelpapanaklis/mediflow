export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════════════
// VISITAS Y LLAVES del panel de inmuebles.
//
// Reemplaza el placeholder de la Ola 0 sin tocar el layout, el sidebar ni el
// contrato: el item del menú y los permisos `visits.manage` / `keys.manage`
// ya existían desde entonces.
//
// DOS CANDADOS, y son dos y no tres a propósito:
//   1. MODO de la cuenta — sale del MISMO campo `modes` del contrato que usa
//      el sidebar, no de un if inventado aquí. Una cuenta de rentista
//      (OWNER) no comercializa para terceros y no tiene agenda de visitas.
//   2. PERMISO del rol.
// NO hay candado de FEATURE porque el item `visitas` lleva `featureKey: null`
// en el contrato: la agenda no está gateada por plan. Copiar el gate de
// prospectos aquí habría apagado la agenda a quien sí la paga.
//
// Las llaves piden su PROPIO permiso (`keys.manage`). Un override REEMPLAZA
// los defaults del rol, así que alguien puede tener la agenda y no las
// llaves: la pestaña se esconde y la API vuelve a comprobarlo.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRouteOrigin, listVisitsWindow } from "@/lib/realty/visits";
import { countKeysOut } from "@/lib/realty/keys";
import { realtyDateISO } from "@/components/realty/visits/visit-core";
import { VisitsScreen } from "@/components/realty/visits/visits-screen";
import visitsDict from "@/i18n/dictionaries/realty/visits.json";
import type { Dictionary } from "@/i18n/t";

const AREA = "visitas";

export const metadata: Metadata = { title: "Visitas — DaleControl Inmuebles" };

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

/** Un id de la URL: string, no vacío y de largo razonable. Si no, null. */
function idParam(value: string | string[] | undefined): string | null {
  // Next entrega un ARRAY cuando el parámetro viene repetido
  // (?inmueble=a&inmueble=b). Sin esta guarda, ese array llegaría a la
  // consulta como si fuera un id.
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= 40 ? clean : null;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // El sidebar ya esconde esta sección si el modo de la cuenta no la tiene,
  // pero esconder un menú NO es control de acceso: quien escriba la URL a
  // mano llegaría igual. El recorte real es este redirect.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  // i18n — CONVENCIÓN B: aquí se RECORTA el sub-árbol y el componente llama a
  // makeRealtyT SIN prefijo. Este diccionario no se cuelga del barril de
  // realty a propósito (ver la nota dentro de visits.json).
  const locale = ctx.account.locale === "en" ? "en" : "es";
  const dict = (visitsDict as unknown as Record<string, Dictionary>)[locale];
  const denied = dict.denied as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "visits.manage")) {
    return <Aviso texto={denied.permission as string} />;
  }
  const canKeys = hasRealtyPermission(permUser, "keys.manage");

  const timeZone = ctx.account.timezone || "America/Mexico_City";
  const todayISO = realtyDateISO(new Date(), timeZone);

  // La primera ventana es HOY en vista de día. El componente NO la vuelve a
  // pedir al montar (ver la guarda de `firstKey`): sin eso la agenda hacía
  // dos consultas idénticas cada vez que alguien abría la pantalla.
  const initial = await listVisitsWindow(ctx, { fromISO: todayISO, days: 1 });

  // El origen de la ruta y el conteo de llaves son EXTRAS: si algo falla, la
  // agenda tiene que abrir igual. La ruta arranca entonces en la primera
  // visita y el badge de llaves sale en cero, que es lo que la pantalla ya
  // sabe pintar.
  let origin: Awaited<ReturnType<typeof getRouteOrigin>> = null;
  try {
    origin = await getRouteOrigin(ctx);
  } catch (e) {
    console.error("[realty/visitas] no se pudo resolver la oficina de origen:", e);
  }

  let keysOverdue = 0;
  if (canKeys) {
    try {
      keysOverdue = (await countKeysOut(ctx)).overdue;
    } catch (e) {
      console.error("[realty/visitas] no se pudieron contar las llaves fuera:", e);
    }
  }

  // 🔑 La puerta desde la ficha del inmueble y la del prospecto. Esas
  // pantallas son de otras terminales, así que el contrato es una LIGA:
  //   /inmobiliaria/visitas?nueva=1&inmueble=<id>[&prospecto=<id>]
  // Los ids NO se confían: el diálogo los resuelve contra la API, que los
  // recorta por cuenta, por oficina y por rol. Uno ajeno no enseña nada.
  const propertyId = idParam(searchParams?.inmueble);
  const leadId = idParam(searchParams?.prospecto);
  const preselect =
    searchParams?.nueva === "1" || propertyId || leadId ? { propertyId, leadId } : null;

  return (
    <VisitsScreen
      dict={dict}
      locale={locale}
      preselect={preselect}
      initial={{ ...initial, me: { realtyUserId: ctx.realtyUserId, role: ctx.role } }}
      origin={origin}
      canKeys={canKeys}
      keysOverdue={keysOverdue}
      // Un AGENT solo se agenda a sí mismo. Lo fuerza el servidor
      // (createVisit / moveVisit); aquí solo se esconde el gesto.
      canAssign={ctx.role !== "AGENT"}
    />
  );
}
