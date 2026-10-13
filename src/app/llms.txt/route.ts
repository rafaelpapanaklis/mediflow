import { textoLlms } from "@/lib/llms/llms-txt";

/**
 * /llms.txt (12-oct-2026, ws1-t4, encargo de ws7, punto 3e). El texto está en
 * src/lib/llms/llms-txt.ts. Estática (sin base de datos): se genera en el build.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(textoLlms(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
