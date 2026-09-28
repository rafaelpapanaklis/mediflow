// Contratar Ortodoncia (ws1-t3, 28-sep-2026). A donde lleva el candado del
// menú, y a donde manda el guardia del módulo a quien no lo tiene.
//
// Decisión de Rafael: «que salga con candado y al darle click que salga el
// precio mensual o anual con botón para cambiar. Y también TODO lo que
// contiene, tal vez en categorías».
//
//  - Quién entra: lo decide el layout de esta ruta (clínica dental + permiso
//    `specialties.orthodontics`), igual que para el resto del módulo.
//  - Precios: se LEEN de la tabla `modules` (`price_mxn_monthly` por Prisma y
//    `price_mxn_annual` por SQL crudo, ver module-annual-price.ts). Esa tabla
//    es el catálogo de la plataforma, el mismo para todas las clínicas: no
//    lleva `clinicId`. Ningún precio va escrito en el código.
//  - Con el módulo YA activo no hay nada que contratar: se entra al módulo.
export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { getModuleAnnualPriceMxn } from "@/lib/marketplace/module-annual-price";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  RUTA_MODULO_ORTODONCIA,
  cicloInicial,
  leerEstadoCompra,
  moduloActivoALaVista,
  puedeContratarModulos,
  resumirPrecios,
  vistaPreviaSinModulo,
} from "@/lib/orthodontics/contratar";
import { VistaContratar } from "@/components/specialties/orthodontics/contratar/vista-contratar";

export default async function ContratarOrtodonciaPage({
  searchParams,
}: {
  searchParams: { compra?: string | string[]; ciclo?: string | string[] };
}) {
  const user = await getCurrentUser();

  const [activoReal, modulo] = await Promise.all([
    hasActiveOrthodonticsModule(user.clinicId),
    prisma.module.findUnique({
      where: { key: ORTHODONTICS_MODULE_KEY },
      select: { id: true, priceMxnMonthly: true, isActive: true },
    }),
  ]);

  const vistaPrevia = vistaPreviaSinModulo({
    nodeEnv: process.env.NODE_ENV,
    cookie: cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value,
  });
  const moduloActivo = moduloActivoALaVista(activoReal, vistaPrevia);
  const compra = leerEstadoCompra(searchParams.compra);

  // Ya lo tiene: al módulo. La única excepción es la vuelta de pagar
  // (`?compra=ok`): ahí la vista avisa y entra con una carga completa, para
  // que el menú deje de pintar el candado.
  if (moduloActivo && compra !== "ok") redirect(RUTA_MODULO_ORTODONCIA);

  const anualMxn = modulo?.isActive ? await getModuleAnnualPriceMxn(prisma, modulo.id) : null;
  const precios = resumirPrecios(
    modulo?.isActive ? { mensualMxn: modulo.priceMxnMonthly, anualMxn } : null,
  );
  const pedido = Array.isArray(searchParams.ciclo) ? searchParams.ciclo[0] : searchParams.ciclo;

  return (
    <VistaContratar
      precios={precios}
      cicloInicial={cicloInicial(pedido, precios.ciclos)}
      puedeContratar={puedeContratarModulos(user.role)}
      compra={compra}
      moduloActivo={moduloActivo}
      vistaPrevia={vistaPrevia && activoReal}
    />
  );
}
