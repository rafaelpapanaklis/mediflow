import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Sesión persistente tipo Gmail/Slack: la cookie de auth vive 30 días y se
// renueva en cada request (rolling). Si el usuario no entra durante 30 días,
// expira y vuelve a /login. Cerrar el browser/pestaña no la borra.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: any) {
          // Forzamos maxAge si no viene seteado, así las cookies de Supabase
          // (sb-<ref>-auth-token.*) dejan de ser session cookies y persisten.
          // Si Supabase explicita un maxAge (p. ej. el del refresh token),
          // respetamos ese valor.
          const finalOptions = { ...options, maxAge: options?.maxAge ?? SESSION_MAX_AGE_SECONDS };
          try { cookieStore.set({ name, value, ...finalOptions }); } catch {}
        },
        remove(name: string, options: any) {
          // Eliminación explícita: maxAge: 0 fuerza al browser a borrar la
          // cookie. Sin esto se quedaba con value vacío pero misma expiración.
          try { cookieStore.set({ name, value: "", ...options, maxAge: 0 }); } catch {}
        },
      },
    }
  );
}
