import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la service role (sin sesión persistente). Para «Ver
 * como clínica» (generar el enlace del dueño, revocar la sesión vencida). Vive
 * aparte para poder sustituirlo en las pruebas.
 */
export function clienteAdminSupabase(serviceRoleKey: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
