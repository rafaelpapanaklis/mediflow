export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { loadModerationQueue, type ModerationQueue } from "@/lib/affiliates/page-moderation";
import { PaginasSocioClient } from "./paginas-client";

export const metadata: Metadata = { title: "Páginas de socio — Admin DaleControl" };

/**
 * Cola de moderación de las páginas /socio/<slug>.
 *
 * La carga va en try/catch como el resto del admin: si la consulta falla, la
 * pantalla sale vacía con su aviso en vez de un 500. El client recarga por su
 * cuenta después de cada decisión.
 */
export default async function AdminPaginasSocioPage() {
  let queue: ModerationQueue = { pending: [], published: [] };
  let loadError = false;

  try {
    queue = await loadModerationQueue();
  } catch (e) {
    console.error("[admin/affiliates/paginas] carga inicial:", e);
    loadError = true;
  }

  return <PaginasSocioClient initial={queue} loadError={loadError} />;
}
