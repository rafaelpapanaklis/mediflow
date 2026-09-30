// Decisiones puras del callback de Google Calendar (/api/google/callback).
// Sin imports de Next ni de Prisma: se prueban con tsx --test.
//
// POR QUÉ EXISTE EL SALTO: el `redirect_uri` registrado en Google
// (GOOGLE_REDIRECT_URI) puede vivir en un host distinto al de la app
// (NEXT_PUBLIC_APP_URL): hoy es `mediflow-pi.vercel.app` contra
// `www.dalecontrol.com`. La cookie de sesión de Supabase es de host (sin
// `domain`), así que en el host del callback el navegador no la manda, y desde
// 064fdab1 (22-abr-2026) el callback exige sesión → toda conexión nueva acababa
// en `gcal=error` sin guardar nada. Si Google nos devuelve a un host que no es
// el de la app, reenviamos la MISMA respuesta (code/state/error) al callback del
// host de la app, donde sí está la sesión. El intercambio del code sigue usando
// GOOGLE_REDIRECT_URI (Google exige el mismo redirect_uri que en la ida), así que
// funciona desde cualquier host.

/** Por qué terminó en error la conexión; viaja en `?gcal=error&motivo=…`. */
export type MotivoErrorGcal =
  | "denegado"     // Google devolvió ?error= (el usuario canceló, o su cuenta no puede usar la app)
  | "incompleto"   // faltan code o state
  | "state"        // firma del state inválida
  | "sesion"       // no hay sesión de DaleControl en este navegador/host
  | "otra_cuenta"  // la sesión es de otro usuario que el que inició la conexión
  | "token"        // Google no aceptó el code (caducado, redirect_uri distinto, secreto)
  | "guardar"      // Google autorizó pero falló algo nuestro después
  | "cuenta_distinta" // la clínica ya está conectada con OTRA cuenta de Google: primero se desconecta
  | "calendario"  // se conectó, pero no se pudo crear el calendario de la clínica
  | "permisos";   // Google autorizó, pero la persona desmarcó el permiso de Calendar

export const MOTIVOS_ERROR_GCAL: readonly MotivoErrorGcal[] = [
  "denegado", "incompleto", "state", "sesion", "otra_cuenta", "token", "guardar",
  "cuenta_distinta", "calendario", "permisos",
];

/** Marca que evita un segundo salto (y cualquier bucle) si los hosts no casan. */
export const PARAM_SALTO = "salto";

const hostDe = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
};

/**
 * Si la petición llegó al host del redirect_uri y ese host no es el de la app,
 * devuelve la URL del callback en el host de la app con la misma query (más la
 * marca de salto). Si no hay que saltar, `null`.
 *
 * `hostPeticion` sale de x-forwarded-host/host: aquí solo decide a dónde se
 * redirige, y el destino es siempre NEXT_PUBLIC_APP_URL, nunca ese host.
 * `haySesionAqui`: si el navegador ya trae cookie de Supabase en este host
 * (alguien que usa el panel directo en ese dominio), se queda aquí como antes.
 */
export function urlDeSaltoAlHostDeLaApp(opts: {
  hostPeticion: string | null;
  query: URLSearchParams;
  appUrl: string | undefined;
  redirectUri: string | undefined;
  haySesionAqui?: boolean;
}): string | null {
  const { hostPeticion, query, appUrl, redirectUri, haySesionAqui } = opts;
  if (!hostPeticion || haySesionAqui || query.has(PARAM_SALTO)) return null;
  const hostApp = hostDe(appUrl);
  const hostRedirect = hostDe(redirectUri);
  if (!hostApp || !hostRedirect || hostApp === hostRedirect) return null;
  const aqui = hostPeticion.toLowerCase();
  if (aqui !== hostRedirect) return null;
  const destino = new URL("/api/google/callback", appUrl);
  query.forEach((v, k) => destino.searchParams.append(k, v));
  destino.searchParams.set(PARAM_SALTO, "1");
  return destino.toString();
}

/**
 * ¿Se deja conectar esta cuenta de Google a la clínica? Una clínica tiene UNA
 * conexión: si un admin conecta otra cuenta encima, se pisarían los tokens y el
 * calendario, y los eventos ya creados quedarían en la cuenta anterior, fuera
 * del alcance de cualquier cambio o cancelación posterior. Para cambiar de
 * cuenta se desconecta primero.
 *
 * La misma cuenta sí puede reconectar (renovar permisos). Si alguno de los dos
 * correos se desconoce no hay con qué comparar y se deja pasar.
 */
export function decidirConexionDeClinica(o: {
  clinicaYaConectada: boolean;
  correoDeLaClinica: string | null | undefined;
  correoNuevo: string | null | undefined;
}): "ok" | "cuenta_distinta" {
  if (!o.clinicaYaConectada) return "ok";
  const a = o.correoDeLaClinica?.trim().toLowerCase();
  const b = o.correoNuevo?.trim().toLowerCase();
  if (!a || !b) return "ok";
  return a === b ? "ok" : "cuenta_distinta";
}

/** Clave de i18n del aviso que ve el usuario al volver con `gcal=error`. */
export function claveAvisoErrorGcal(motivo: string | null | undefined): string {
  return (MOTIVOS_ERROR_GCAL as readonly string[]).includes(motivo ?? "")
    ? `settings.client.gcalError_${motivo}`
    : "settings.client.gcalConnectErrorToast";
}
