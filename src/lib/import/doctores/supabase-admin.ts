// Cliente admin de Supabase, en su propio módulo para que los tests puedan
// sustituirlo (mock.module de un path local propio, no del paquete de
// terceros: mockear "@supabase/supabase-js" directo no interceptó de forma
// fiable la importación transitiva dentro del pipeline de runImport en
// pruebas — se investigó pero no se aisló la causa exacta; este nivel de
// indirección la evita del todo). Copia deliberada del cliente admin de
// team/route.ts: un route.ts no exporta nada más que su handler.
import { createClient } from "@supabase/supabase-js";

export function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
