import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseJs } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { getBarberContext } from "@/lib/barber-auth";
import { persistentRateLimit } from "@/lib/failban";
import { leerErrorContrasena } from "@/lib/auth/errores-contrasena";
import { problemaContrasenaNueva } from "@/lib/barber/contrasena";

export const dynamic = "force-dynamic";

/**
 * POST /api/barber/auth/contrasena — la persona cambia SU contraseña.
 *
 * Copia en Barber de /api/auth/change-password (que no se toca: resuelve la
 * sesión con getAuthContext, que es de clínicas). Mismas reglas:
 *  · el usuario es SIEMPRE el de la sesión; del cuerpo solo salen contraseñas;
 *  · fuerza: la del registro y la recuperación (problemaContrasenaNueva →
 *    scorePassword del dental) y tope de 72;
 *  · voluntario: pide la actual, la comprueba en un cliente desechable (no
 *    toca las cookies) con el MISMO freno por persona que el dental, y cambia
 *    con la sesión de la propia persona, así que NO se cierra la sesión.
 *
 * Responde { error, code }: `code` es lo que la pantalla traduce (es/en);
 * `error` va en español por si alguien lo lee tal cual.
 * Ninguna contraseña se registra, ni la vieja ni la nueva.
 */

type Codigo =
  | "sin_sesion"
  | "debil"
  | "larga"
  | "no_coinciden"
  | "falta_actual"
  | "actual_incorrecta"
  | "igual"
  | "filtrada"
  | "rechazada"
  | "error";

const TEXTO: Record<Codigo, string> = {
  sin_sesion: "Tu sesión se cerró. Vuelve a entrar para cambiar tu contraseña.",
  debil: "Muy débil: usa al menos 8 caracteres y mezcla mayúsculas, minúsculas y números.",
  larga: "Usa 72 caracteres o menos.",
  no_coinciden: "Las contraseñas nuevas no coinciden.",
  falta_actual: "Escribe tu contraseña actual.",
  actual_incorrecta: "Tu contraseña actual no es correcta.",
  igual: "La contraseña nueva tiene que ser distinta de la actual.",
  filtrada: "Esa contraseña apareció en filtraciones públicas. Elige otra.",
  rechazada: "Esa contraseña no se acepta. Prueba con otra más larga y variada.",
  error: "No pudimos cambiar tu contraseña. Inténtalo de nuevo.",
};

function falla(code: Codigo, status: number) {
  return NextResponse.json({ error: TEXTO[code], code }, { status });
}

/** Cliente desechable: comprueba una contraseña sin tocar las cookies del navegador. */
async function abreConEsta(email: string, password: string): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !email) return null;
  try {
    const sonda = createSupabaseJs(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await sonda.auth.signInWithPassword({ email, password });
    if (!data?.user) return false;
    // scope "local": la global cerraría también la sesión del navegador.
    try {
      await sonda.auth.signOut({ scope: "local" });
    } catch {
      /* solo era la sonda */
    }
    return true;
  } catch {
    return null;
  }
}

function codigoDeSupabase(error: unknown): Codigo {
  const de = leerErrorContrasena(error);
  if (!de) return "error";
  if (de.motivo === "igual") return "igual";
  if (de.motivo === "filtrada") return "filtrada";
  if (de.motivo === "larga") return "larga";
  return "rechazada";
}

export async function POST(req: NextRequest) {
  const ctx = await getBarberContext();
  if (!ctx) return falla("sin_sesion", 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return falla("error", 400);
  }
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmacion = typeof body?.confirmacion === "string" ? body.confirmacion : "";
  const actual = typeof body?.currentPassword === "string" ? body.currentPassword : "";

  const problema = problemaContrasenaNueva(password);
  if (problema) return falla(problema, 400);
  if (confirmacion !== password) return falla("no_coinciden", 400);

  // El correo de la CUENTA (Supabase Auth), no el de la fila de barber_users:
  // la contraseña es de la cuenta.
  const sesion = await createSessionClient();
  const { data } = await sesion.auth.getUser();
  const cuenta = data?.user;
  if (!cuenta || cuenta.id !== ctx.user.supabaseId) return falla("sin_sesion", 401);
  const email = cuenta.email ?? "";

  // ── Voluntario: con la contraseña actual ─────────────────────────────
  if (!actual) return falla("falta_actual", 400);
  // Adivinar la actual con una sesión ajena abierta: tope por persona. Misma
  // llave que el dental: una persona, una cubeta, entre por donde entre.
  const freno = await persistentRateLimit(req, {
    id: cuenta.id,
    scope: "cambio-contrasena:actual",
    limit: 10,
    windowSec: 15 * 60,
  });
  if (freno) return freno;

  const correcta = await abreConEsta(email, actual);
  if (correcta === null) {
    // Sin cómo comprobarla no se cambia nada (falla cerrado).
    console.error("[barber/auth/contrasena] no se pudo comprobar la contraseña actual");
    return falla("error", 500);
  }
  if (!correcta) return falla("actual_incorrecta", 400);
  if (password === actual) return falla("igual", 400);

  // Con la sesión de la persona (no con la service role): sigue dentro.
  const { error } = await sesion.auth.updateUser({ password });
  if (error) {
    const code = codigoDeSupabase(error);
    if (code === "error") console.error("[barber/auth/contrasena] supabase falló:", (error as { message?: string }).message ?? "");
    return falla(code, code === "error" ? 500 : 400);
  }

  console.log(JSON.stringify({ type: "barber.password.changed", barberUserId: ctx.barberUserId, forced: false }));
  return NextResponse.json({ ok: true });
}
