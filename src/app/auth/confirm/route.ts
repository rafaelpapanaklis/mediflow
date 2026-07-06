import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Aterrizaje de enlaces de Supabase Auth. Dos consumidores hoy:
 *  - admin impersonate: ?token_hash=&type=email&next=/dashboard (verifyOtp).
 *  - recuperación de contraseña: /api/auth/forgot-password manda el correo con
 *    redirectTo=/auth/confirm?next=/reset-password. Con el template default
 *    ({{ .ConfirmationURL }}, PKCE) Supabase llega con ?code= →
 *    exchangeCodeForSession (mismo navegador que pidió el reset, el
 *    code_verifier vive en cookie). Si el template migra a
 *    token_hash/type=recovery (recomendado SSR), cae en la rama verifyOtp y
 *    funciona también cross-dispositivo.
 * En fallo: flujos de recovery → /reset-password?error=link_invalido (ofrece
 * pedir otro enlace); el resto conserva /login?error=invalid_token.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type       = searchParams.get("type") as any;
  const code       = searchParams.get("code");
  const rawNext    = searchParams.get("next") ?? "/dashboard";
  // Solo paths internos: un next absoluto o "//host" sería open redirect.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const isRecovery = type === "recovery" || next === "/reset-password";
  const fail = NextResponse.redirect(
    isRecovery
      ? `${origin}/reset-password?error=link_invalido`
      : `${origin}/login?error=invalid_token`,
  );

  // Supabase puede llegar ya con error en la query (p. ej. otp_expired).
  if (searchParams.get("error")) return fail;

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return fail;
  }

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return fail;
}
