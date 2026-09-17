import type { Metadata } from "next";
import { getAuthContext } from "@/lib/auth-context";
import { getAccountManagerForClinic } from "@/lib/account-manager/get-for-clinic";
import { localeFromClinic } from "@/i18n/server";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
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
  //
  // REDISEÑO (ws1-t4) — el MISMO interruptor por clínica que enciende el menú de
  // dos niveles (`clinic_feature_flags`, bandera `menu-dos-niveles`), no uno
  // propio: Rafael prueba «el diseño nuevo» como una sola cosa. Falla cerrado
  // (sin tabla, sin fila o con error → false = la pantalla de hoy, tal cual).
  // No añade una consulta: el layout ya lo resolvió en esta misma carga y la
  // respuesta vive 60 s en memoria por clínica. Va en el mismo Promise.all que
  // el manager para no esperar en cascada.
  const ctx = await getAuthContext();
  const [accountManager, rediseno] = ctx
    ? await Promise.all([
        getAccountManagerForClinic(ctx.clinicId, { locale: localeFromClinic(ctx.clinic) }),
        menuDosNivelesEncendido(ctx.clinicId),
      ])
    : [null, false];

  return (
    <SoporteClient
      accountManager={accountManager}
      clinicName={ctx?.clinic?.name ?? ""}
      rediseno={rediseno}
    />
  );
}
