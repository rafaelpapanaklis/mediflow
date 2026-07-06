"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SalesNav } from "./sales/nav";
import { Header } from "./header";
import { SpecNav } from "./specialty/spec-nav";

// Las landings públicas (home, roadmap, 17 especialidades) son estáticas
// (SSG/ISR): el server ya no llama getSession() y el HTML siempre sale con
// isLoggedIn=false. Tras hidratar, detectamos la cookie de Supabase
// (sb-<ref>-auth-token, legible por JS — ver lib/supabase/client.ts) para
// que el nav muestre "Ir al dashboard". Bots y visitantes sin sesión ven el
// flujo no-logueado, igual que antes.
function useHasSupabaseSession(): boolean {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    // Fast-path: sin cookie sb-*-auth-token no hay nada que validar.
    const hasAuthCookie = document.cookie.split(";").some((chunk) => {
      const name = chunk.trim().split("=")[0];
      return (
        name.startsWith("sb-") &&
        name.includes("-auth-token") &&
        !name.includes("code-verifier")
      );
    });
    if (!hasAuthCookie) return;

    // La cookie puede estar VENCIDA (quedaba "Ir al panel" fantasma que
    // rebotaba al login). Validamos la sesión real; getSession auto-renueva
    // con el refresh token si puede, y si no, el nav queda como visitante.
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled && data.session) setIsLoggedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return isLoggedIn;
}

export function SalesNavSession() {
  return <SalesNav isLoggedIn={useHasSupabaseSession()} />;
}

export function HeaderSession() {
  return <Header isLoggedIn={useHasSupabaseSession()} />;
}

export function SpecNavSession({ currentSlug }: { currentSlug: string }) {
  return <SpecNav currentSlug={currentSlug} isLoggedIn={useHasSupabaseSession()} />;
}
