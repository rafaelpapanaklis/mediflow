import { getServerT } from "@/i18n/server";
import { mensajeSinPermisoClinico } from "@/lib/auth/guardia-clinica";
import { SinAcceso, TITULO_SIN_ACCESO } from "./sin-acceso";

/**
 * «Sin acceso» de las páginas de especialidad para quien no tiene «Ver
 * expediente clínico» (ws1-t11 · lead 12). Server component: la página corta
 * ANTES de cargar nada clínico y monta esto en su lugar.
 */
export async function SinAccesoClinico() {
  const { t, locale } = await getServerT();
  return (
    <SinAcceso
      titulo={TITULO_SIN_ACCESO[locale.startsWith("en") ? "en" : "es"]}
      texto={mensajeSinPermisoClinico(["medicalRecord.view"])}
      volver={t("menuDosNiveles.cajaSinPermisoVolver")}
    />
  );
}
