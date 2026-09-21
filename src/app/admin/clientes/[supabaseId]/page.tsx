export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClienteDetalle } from "@/lib/admin/clientes";
import { isStripeConfigured, STRIPE_SETUP_INSTRUCTIONS } from "@/lib/stripe";
import { cargarCliente } from "../datos";
import { ClienteDetalleClient } from "./cliente-detalle-client";

export const metadata: Metadata = { title: "Detalle de cliente — Admin DaleControl" };

/**
 * La ficha de un cliente junta DOS cargas, a propósito:
 *
 *  • `getClienteDetalle` (@/lib/admin/clientes) — la facturación: cobros de
 *    suscripción, serie de ingresos, datos de Stripe. No se toca: es lo que
 *    sostiene los botones que mueven dinero.
 *  • `cargarCliente` (../datos) — las clínicas MEDIDAS (actividad, accesos,
 *    pagos), que es lo que `evaluarSaludClinica` necesita para decir qué sede
 *    hay que atender. La misma medición que /admin/clinics y que la lista.
 *
 * Van en serie y no en paralelo porque cada una abre su propia tanda de
 * consultas: juntas pasarían de 7 en vuelo y el pooler empieza a dar timeouts.
 */
export default async function AdminClienteDetallePage({ params }: { params: { supabaseId: string } }) {
  const cliente = await getClienteDetalle(params.supabaseId);
  if (!cliente) notFound();

  const { cliente: cartera, planPrices, ahoraISO, ingresos, soloComoUsuario } =
    await cargarCliente(params.supabaseId);
  if (!cartera) notFound();

  return (
    <ClienteDetalleClient
      cliente={cliente}
      cartera={cartera}
      planPrices={planPrices}
      ahoraISO={ahoraISO}
      ingresos={ingresos}
      soloComoUsuario={soloComoUsuario}
      stripeConfigured={isStripeConfigured()}
      stripeInstructions={STRIPE_SETUP_INSTRUCTIONS}
    />
  );
}
