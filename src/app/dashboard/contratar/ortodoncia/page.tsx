// Contratar Ortodoncia (ws1-t3, 28-sep-2026). A donde lleva el candado del
// menú, y a donde manda el guardia del módulo a quien no lo tiene.
//
// Decisión de Rafael: «que salga con candado y al darle click que salga el
// precio mensual o anual con botón para cambiar. Y también TODO lo que
// contiene, tal vez en categorías».
//
//  - Vive FUERA de /dashboard/orthodontics a propósito (ver
//    RUTA_CONTRATAR_ORTODONCIA en src/lib/orthodontics/contratar.ts): así el
//    layout del módulo, que es donde está su guardia, no se monta nunca para
//    una clínica que no lo tiene.
//  - Quién entra: clínica dental + permiso `specialties.orthodontics`, igual
//    que al módulo. Se comprueba AQUÍ, en la página, que sí corre en cada visita.
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
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { sedesHermanasConOrtodoncia } from "@/lib/orthodontics/contratar-sedes";
import { getModuleAnnualPriceMxn } from "@/lib/marketplace/module-annual-price";
import { pagoDeModuloConfirmado } from "@/lib/marketplace/module-checkout-session";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  cicloInicial,
  decidirEntradaAContratar,
  leerEstadoCompra,
  moduloActivoALaVista,
  puedeContratarModulos,
  resumirPrecios,
  vistaPreviaSinModulo,
} from "@/lib/orthodontics/contratar";
import { RaizModulo } from "@/components/specialties/orthodontics/modulo/piezas";
import { VistaContratar } from "@/components/specialties/orthodontics/contratar/vista-contratar";

export default async function ContratarOrtodonciaPage({
  searchParams,
}: {
  searchParams: { compra?: string | string[]; ciclo?: string | string[]; session_id?: string | string[] };
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
  // «Pago recibido» solo si Stripe lo confirma para ESTA clínica: que la URL
  // diga `?compra=ok` no prueba nada (cualquiera puede escribirlo o reabrirlo
  // del historial). Sin confirmación, la página se pinta como si no se hubiera
  // pagado. La activación no depende de esto: la hace el webhook.
  const pedida = leerEstadoCompra(searchParams.compra);
  const sessionId = Array.isArray(searchParams.session_id) ? searchParams.session_id[0] : searchParams.session_id;
  const compra =
    pedida === "ok" &&
    !(await pagoDeModuloConfirmado({ sessionId, clinicId: user.clinicId, moduleKey: ORTHODONTICS_MODULE_KEY }))
      ? null
      : pedida;

  const entrada = decidirEntradaAContratar({
    esDental: user.clinic.category === "DENTAL",
    tienePermiso: hasPermission(
      { role: user.role, permissionsOverride: user.permissionsOverride },
      "specialties.orthodontics",
    ),
    moduloActivo,
    compra,
  });
  if (entrada.tipo === "redirigir") redirect(entrada.a);

  const [anualMxn, sedesHermanas] = await Promise.all([
    modulo?.isActive ? getModuleAnnualPriceMxn(prisma, modulo.id) : Promise.resolve(null),
    // Decisión de Rafael (ws1-t2, ronda 5): cada sede contrata Ortodoncia por
    // su cuenta. Si el dueño tiene otras sedes dentales, la página le enseña
    // cuáles ya la tienen — sin tocar ni un dato de paciente.
    sedesHermanasConOrtodoncia(user.supabaseId, user.clinicId),
  ]);
  const precios = resumirPrecios(
    modulo?.isActive ? { mensualMxn: modulo.priceMxnMonthly, anualMxn } : null,
  );
  const pedido = Array.isArray(searchParams.ciclo) ? searchParams.ciclo[0] : searchParams.ciclo;

  // `RaizModulo`: los tokens y la tipografía del rediseño, los mismos del módulo.
  return (
    <RaizModulo>
      <VistaContratar
        precios={precios}
        cicloInicial={cicloInicial(pedido, precios.ciclos)}
        puedeContratar={puedeContratarModulos(user.role)}
        compra={compra}
        moduloActivo={moduloActivo}
        vistaPrevia={vistaPrevia && activoReal}
        sedeActualNombre={user.clinic.name}
        sedesHermanas={sedesHermanas}
      />
    </RaizModulo>
  );
}
