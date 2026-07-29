"use client";

import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Suma una vista al artículo (fire-and-forget, no renderiza nada).
//
// Vive en el cliente porque /blog/[slug] es ISR: el server component sólo corre
// al regenerar la página, así que contar ahí no mediría lectores.
//
// Dedupe por sesión de navegador: recargar o volver con el botón "atrás" no
// cuenta doble. Cualquier fallo se ignora — el tracking JAMÁS rompe la página.
// ─────────────────────────────────────────────────────────────────────────────

export function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;

    try {
      const key = `dc-blog-viewed:${slug}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* modo privado (Safari lanza): contamos igual, sin dedupe */
    }

    void fetch("/api/blog/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  }, [slug]);

  return null;
}
