export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { mercadoPagoConfigurado } from "@/lib/ai-wallet/metodos-recarga";
import { SaldoClient } from "./saldo-client";

export const metadata: Metadata = { title: "Saldo de IA — DaleControl" };

export default async function AiWalletSaldoPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "whatsapp.view");
  // REDISEÑO (ws1-t5): el MISMO interruptor por clínica que enciende el menú
  // de dos niveles. Esta página no pide nada más a la base (el cliente carga
  // el monedero por fetch); la respuesta vive 60 s en memoria por clínica y el
  // layout la acaba de pedir en esta misma petición, así que se resuelve de la
  // caché (o se une a la consulta en vuelo), sin consulta nueva. Falla cerrado.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  // Mercado Pago solo se ofrece si DaleControl tiene token de plataforma: lo
  // decide el servidor, y el día que aparezca la opción vuelve sola.
  return (
    <SaldoClient key={user.clinicId} rediseno={rediseno} mercadoPago={mercadoPagoConfigurado()} />
  );
}
