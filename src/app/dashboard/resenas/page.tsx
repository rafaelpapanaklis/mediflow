import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { ResenasClient } from "./ResenasClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseñas — DaleControl" };

export default async function ResenasPage() {
  // key por clínica: ResenasClient hace fetch de /api/reviews solo al montar y
  // no re-dispara en el soft refresh del cambio de sede → mostraría reseñas de
  // la clínica anterior. Re-montar por clinicId lo evita.
  const user = await getCurrentUser();
  // REDISEÑO (ws1-t6) — el MISMO interruptor por clínica que enciende el menú de
  // dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio. Falla cerrado (→ false = la pantalla de hoy, tal cual). No añade un
  // viaje a la base: la respuesta vive 60 s en memoria por clínica y el layout
  // ya la pidió en esta misma carga.
  const rediseno = await menuDosNivelesEncendido(user.clinicId);
  return <ResenasClient key={user.clinicId} rediseno={rediseno} />;
}
