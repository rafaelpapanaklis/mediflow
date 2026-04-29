import { createBrowserClient } from "@supabase/ssr";

// Cookie de auth persistente 30 días en el browser. Cuando el usuario hace
// signInWithPassword desde el cliente, Supabase escribe document.cookie con
// estas opciones — sin maxAge serían session cookies y se perderían al
// cerrar el browser. El refresh server-side (middleware.ts) las re-emite
// con la misma duración en cada request, dando la rolling session esperada.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: "lax",
        path: "/",
        // secure se infiere automaticamente segun el protocolo (https en prod).
      },
    },
  );
}
