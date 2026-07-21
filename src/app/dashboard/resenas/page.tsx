import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { ResenasClient } from "./ResenasClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseñas — DaleControl" };

export default async function ResenasPage() {
  // key por clínica: ResenasClient hace fetch de /api/reviews solo al montar y
  // no re-dispara en el soft refresh del cambio de sede → mostraría reseñas de
  // la clínica anterior. Re-montar por clinicId lo evita.
  const user = await getCurrentUser();
  return <ResenasClient key={user.clinicId} />;
}
