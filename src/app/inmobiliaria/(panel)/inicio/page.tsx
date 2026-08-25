export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { RealtyPlaceholder } from "@/components/realty/realty-placeholder";

// Placeholder de la Ola 0. La terminal de la Ola 1 que se encargue de esta
// área REEMPLAZA este archivo completo — sin tocar el layout, el sidebar ni
// el contrato.
const AREA = "inicio";

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  // `inicio` se ve en los tres modos: no hay nada que recortar aquí.
  return <RealtyPlaceholder areaKey={AREA} locale={ctx.account.locale} />;
}
