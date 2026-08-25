export const dynamic = "force-dynamic";

import { listRealtyPlanConfigsForAdmin } from "@/lib/realty/admin";
import { RealtyPlanConfigClient } from "./plan-config-client";

/**
 * /admin/inmobiliarias/planes — el editor de `realty_plan_configs`.
 *
 * Esto es lo que hace verdad la regla dura del vertical: CAMBIAR UN PRECIO ES
 * EDITAR UNA FILA, no tocar código. La pantalla del cliente
 * (/inmobiliaria/suscripcion) lee de aquí, y el checkout de Stripe resuelve el
 * precio por `lookup_key` derivada del importe — así que subir el precio aquí
 * crea el precio nuevo en Stripe la próxima vez que alguien contrate, sin
 * dejar productos huérfanos.
 *
 * Vive BAJO /admin/inmobiliarias (no como hermana) para que el item de menú
 * "Inmobiliarias" siga encendido: admin-nav empareja por segmento.
 */
export default async function AdminRealtyPlansPage() {
  const plans = await listRealtyPlanConfigsForAdmin();
  return <RealtyPlanConfigClient plans={plans} />;
}
