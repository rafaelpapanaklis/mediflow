/**
 * Google Calendar — al desconectar, revocar el permiso en Google (hueco #9).
 *
 * Sin esto la app seguía en «Cuentas y permisos» de la cuenta de Google aunque
 * la clínica la hubiera desconectado. Revocar el refresh token quita el permiso
 * entero (Google invalida también sus access tokens).
 *
 * Es best-effort y con tope de tiempo: desconectar SIEMPRE limpia nuestros
 * datos, aunque Google tarde, ya haya perdido el token o no responda. Lo que
 * NO hace: no borra el calendario ni los eventos ya creados (se quedan en la
 * cuenta de Google; la pantalla lo dice).
 */

export interface ClienteRevocacion {
  revokeToken(token: string): Promise<unknown>;
}

export interface ResultadoRevocacion {
  /** Tokens distintos que se intentaron revocar. */
  intentados: number;
  /** Cuántos aceptó Google (o ya no eran válidos: el permiso ya no existía). */
  revocados: number;
}

const TOPE_MS = 5000;

function yaNoEraValido(err: unknown): boolean {
  const e = err as any;
  const dato = e?.response?.data?.error;
  return dato === "invalid_token" || dato === "invalid_grant" || /invalid_token|invalid_grant/i.test(String(e?.message ?? ""));
}

/**
 * Revoca cada token DISTINTO una sola vez (el del usuario y el de la clínica
 * suelen ser el mismo). Nunca lanza. `crearCliente` se inyecta en las pruebas.
 */
export async function revocarTokensGoogle(
  tokens: (string | null | undefined)[],
  crearCliente?: () => ClienteRevocacion,
  topeMs: number = TOPE_MS,
): Promise<ResultadoRevocacion> {
  const unicos = Array.from(new Set(tokens.filter((t): t is string => typeof t === "string" && t.length > 0)));
  if (unicos.length === 0) return { intentados: 0, revocados: 0 };

  let fabrica = crearCliente;
  if (!fabrica) {
    const { getOAuthClient } = await import("@/lib/google-calendar");
    fabrica = () => getOAuthClient() as unknown as ClienteRevocacion;
  }

  const resultados = await Promise.all(
    unicos.map(async (token) => {
      let reloj: ReturnType<typeof setTimeout> | undefined;
      try {
        const limite = new Promise<"tope">((res) => { reloj = setTimeout(() => res("tope"), topeMs); });
        const r = await Promise.race([fabrica!().revokeToken(token).then(() => "ok" as const), limite]);
        return r === "ok";
      } catch (e) {
        if (yaNoEraValido(e)) return true;
        console.error("[google-calendar] no se pudo revocar el permiso en Google:", (e as any)?.response?.data?.error ?? (e as any)?.message ?? e);
        return false;
      } finally {
        if (reloj) clearTimeout(reloj);
      }
    }),
  );
  return { intentados: unicos.length, revocados: resultados.filter(Boolean).length };
}
