export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { RealtyPlaceholder } from "@/components/realty/realty-placeholder";

// Placeholder de la Ola 0. La terminal de la Ola 1 que se encargue de esta
// área REEMPLAZA este archivo completo — sin tocar el layout, el sidebar ni
// el contrato.
const AREA = "inmuebles";

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // El sidebar ya esconde esta sección si el modo de la cuenta no la
  // tiene, pero esconder un menú NO es control de acceso: quien escriba
  // la URL a mano llegaría igual. El recorte real es este redirect, y sale
  // del MISMO campo `modes` del contrato — no de un if inventado aquí.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  return <RealtyPlaceholder areaKey={AREA} locale={ctx.account.locale} />;
}
