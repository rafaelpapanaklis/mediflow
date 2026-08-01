import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import { getAccountManagerForClinic } from "@/lib/account-manager/get-for-clinic";
import { localeFromClinic } from "@/i18n/server";
import { SoporteClient } from "./soporte-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Soporte Técnico — DaleControl" };

export default async function SoportePage() {
  // El manager se resuelve en el SERVIDOR: la disponibilidad se evalúa en la
  // timezone del manager (no en la del navegador) y al cliente sólo viaja el
  // manager ASIGNADO a esta clínica — nunca el catálogo.
  //
  // getAccountManagerForClinic nunca lanza: si el SQL todavía no está aplicado
  // devuelve null y la pantalla se ve igual que siempre, con el estado vacío.
  const ctx = await getAuthContext();
  const accountManager = ctx
    ? await getAccountManagerForClinic(ctx.clinicId, { locale: localeFromClinic(ctx.clinic) })
    : null;

  return (
    <SoporteClient
      accountManager={accountManager}
      clinicName={ctx?.clinic?.name ?? ""}
    />
  );
}
