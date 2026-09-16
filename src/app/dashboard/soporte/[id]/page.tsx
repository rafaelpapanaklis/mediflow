import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { TicketClient } from "./ticket-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ticket de soporte — DaleControl" };

export default async function TicketPage({ params }: { params: { id: string } }) {
  // REDISEÑO (ws1-t4) — el MISMO interruptor por clínica que enciende el menú de
  // dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado: sin clínica, sin tabla o con error → false = el hilo
  // de hoy, tal cual. Sin consultas nuevas: `getCurrentUser` va en React
  // `cache()` y el layout ya lo llamó en esta misma carga, y el interruptor
  // también lo resolvió el layout y vive 60 s en memoria por clínica.
  const user = await getCurrentUser();
  const rediseno = await menuDosNivelesEncendido(user?.clinicId);
  return <TicketClient ticketId={params.id} rediseno={rediseno} />;
}
