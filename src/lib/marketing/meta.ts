// ═══════════════════════════════════════════════════════════════════
// Publicación en Meta (Facebook / Instagram) — STUB de foundation (T1).
// Lo implementa WS-MKT-T4 (Conexiones/Meta) con la Graph API y el token
// descifrado vía crypto.ts. T5 (cron de publicación) puede importar esta
// firma y compilar contra ella aunque T4 no haya terminado.
// ═══════════════════════════════════════════════════════════════════

import type { PublishInput, PublishResult } from "./types";

/**
 * Publica un post en las redes de la clínica indicada.
 * @throws Error("NOT_IMPLEMENTED") hasta que WS-MKT-T4 lo implemente.
 */
export async function publishToMeta(
  clinicId: string,
  input: PublishInput,
): Promise<PublishResult> {
  // Referenciados para dejar explícita la firma del contrato (T4 los usará).
  void clinicId;
  void input;
  throw new Error("NOT_IMPLEMENTED");
}
