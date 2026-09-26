// Guardar el clic de Google Ads ligado a la clínica recién creada (WS1-T6).
//
// Núcleo SIN Prisma: recibe el `exec` que ejecuta el INSERT, así se prueba sin
// base. click-store.ts lo cablea a prisma.$executeRaw.
//
// TOLERA QUE LA TABLA NO EXISTA: sql/ws1-t6-ads-clics.sql la crea Rafael a mano
// y el código puede desplegarse antes. Por eso es SQL crudo y no un modelo de
// Prisma (un modelo sin tabla, o una columna nueva en clinics, tumbaría
// consultas). Cualquier error se traga: un alta NUNCA falla por medir.

import { clickDeCookies, tieneClickId, type FuenteClick } from "./click-ids";

export type ResultadoGuardarClick = "guardado" | "sin-clic" | "sin-tabla" | "error";

export interface FilaClick {
  clinicId: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  clickedAt: Date;
  source: FuenteClick;
}

/**
 * ¿El error es «falta la tabla clinic_ads_clicks»? Postgres 42P01 (Prisma lo
 * envuelve en P2010) o el mensaje de esa relación. Una columna o un tipo que no
 * existen NO cuentan: ese diagnóstico sería falso.
 */
export function esTablaInexistente(err: unknown): boolean {
  const e = err as { meta?: { code?: string; message?: string }; message?: string } | null;
  const texto = `${e?.meta?.message ?? ""} ${e?.message ?? ""}`;
  if (e?.meta?.code === "42P01") return true;
  // «column "x" of relation "clinic_ads_clicks" does not exist» NO es la tabla que falta.
  return !/\bcolumn\b/i.test(texto) && /relation "?(public\.)?"?clinic_ads_clicks"? does not exist/i.test(texto);
}

let avisoSinTabla = false;

export async function guardarClickAdsDeAlta(
  exec: (fila: FilaClick) => Promise<unknown>,
  input: {
    /** clinicId de la clínica que ACABA de crear el servidor, nunca de la petición. */
    clinicId: string;
    leerCookie: (nombre: string) => string | null | undefined;
  },
): Promise<ResultadoGuardarClick> {
  try {
    const { clinicId, leerCookie } = input;
    if (!clinicId) return "error";
    const click = clickDeCookies(leerCookie);
    if (!click || !tieneClickId(click.ids)) return "sin-clic";
    await exec({
      clinicId,
      gclid: click.ids.gclid ?? null,
      gbraid: click.ids.gbraid ?? null,
      wbraid: click.ids.wbraid ?? null,
      clickedAt: new Date(click.at),
      source: click.fuente,
    });
    return "guardado";
  } catch (err) {
    if (esTablaInexistente(err)) {
      if (!avisoSinTabla) {
        avisoSinTabla = true;
        console.warn("[ads-click] falta la tabla clinic_ads_clicks: aplica sql/ws1-t6-ads-clics.sql (el alta sigue igual)");
      }
      return "sin-tabla";
    }
    console.warn("[ads-click] no se pudo guardar el clic de Ads:", (err as Error)?.message ?? err);
    return "error";
  }
}
