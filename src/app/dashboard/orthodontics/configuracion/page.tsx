// Ola 1 (ws1-t3 · «Acceso y permisos»): Configuración quedó asignada a esta
// parte (decisión de Rafael, pregunta abierta #1 de REPORTE-ws1-t1.md).
// Doctor tratante por defecto, catálogo de tipos de cita (C7) y plantillas
// de mensaje — ver src/lib/orthodontics/clinic-settings-db.ts.
export const dynamic = "force-dynamic";

import { getOrthoClinicSettings, listarProcedimientosDeOrtodonciaAction } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { getCurrentUser } from "@/lib/auth";
import { leerPreciosPorTecnica } from "@/lib/orthodontics/precios-por-tecnica-db";
import { prisma } from "@/lib/prisma";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { canPurchaseModules, canRequestModuleCancellation } from "@/lib/marketplace/module-purchase-core";
import { OrthoConfiguracionClient } from "@/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient";
import { Lock } from "lucide-react";
import { hasPermission } from "@/lib/auth/permissions";
import { Pantalla, Vacio } from "@/components/specialties/orthodontics/modulo/piezas";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export default async function OrthodonticsConfiguracionPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  // ws1-t4 ronda 6 (fila 31): quien no puede ver la configuración ya no tiene
  // la entrada en el submenú; si llega por la dirección, se le dice en
  // palabras de la clínica, no con el nombre de un permiso.
  if (!hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride }, "settings.view")) {
    return (
      <Pantalla titulo="Configuración">
        <Vacio
          alto
          icono={Lock}
          tono="neutro"
          titulo="La configuración del módulo la cambia quien administra la clínica"
          pista="Tu usuario puede trabajar con los casos, los controles y la cobranza, pero no cambiar cómo está configurado el módulo. Si necesitas un cambio, pídeselo a quien administra la clínica."
        />
      </Pantalla>
    );
  }
  // Ola 2 (ws1-t1): el catálogo se pide aparte, en paralelo — si falla (SQL
  // de orthoIncludedInTreatment sin pegar, o sin permiso), la Configuración
  // igual se pinta: la sección de procedimientos queda vacía, no tumba la
  // pantalla.
  // ws1-t2 (28-sep-2026): la fila de clinic_modules de este módulo, para la
  // tarjeta "Suscripción" (cancelar). Sin `select` de más: solo lo que
  // `canRequestModuleCancellation` necesita para decidir si hay botón.
  const [res, procRes, clinicModule, preciosPorTecnica] = await Promise.all([
    getOrthoClinicSettings(),
    listarProcedimientosDeOrtodonciaAction(),
    prisma.clinicModule.findFirst({
      where: { clinicId: user.clinicId, module: { key: ORTHODONTICS_MODULE_KEY } },
      select: { paymentMethod: true, stripeSubscriptionId: true, status: true, currentPeriodEnd: true },
    }),
    leerPreciosPorTecnica(user.clinicId),
  ]);
  if (isFailure(res)) {
    return (
      <Pantalla titulo="Configuración">
        <div className={s.error} role="alert">
          No se pudo cargar la Configuración: {res.error}
        </div>
      </Pantalla>
    );
  }
  const cancelacion = canRequestModuleCancellation(clinicModule);
  return (
    <OrthoConfiguracionClient
      settings={res.data.settings}
      doctors={res.data.doctors}
      procedimientos={isFailure(procRes) ? [] : procRes.data.procedimientos}
      preciosPorTecnica={preciosPorTecnica}
      suscripcion={
        canPurchaseModules(user.role) && cancelacion.ok
          ? { currentPeriodEnd: clinicModule?.currentPeriodEnd.toISOString() ?? null }
          : null
      }
    />
  );
}
