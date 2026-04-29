import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Mismo maxAge que server.ts. El middleware corre en cada request a /dashboard,
// y getUser() refresca el access_token cuando está cerca de expirar — el
// refresh dispara set() acá, que escribe la cookie nueva con maxAge 30 días
// desde NOW. Eso es exactamente la rolling session que pide el spec.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value; },
        set(name: string, value: string, options: any) {
          const finalOptions = { ...options, maxAge: options?.maxAge ?? SESSION_MAX_AGE_SECONDS };
          request.cookies.set({ name, value, ...finalOptions });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...finalOptions });
        },
        remove(name: string, options: any) {
          request.cookies.set({ name, value: "", ...options, maxAge: 0 });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );
  // getUser dispara internamente refresh del access_token si está cerca de
  // expirar (≤ 1h por default en Supabase). El set() override de arriba se
  // ejecuta y la cookie se reemite con expiración fresca de 30 días.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return response;
}
