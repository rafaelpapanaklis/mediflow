/**
 * Scanner E — Validación de ENV.
 *
 *   E.1 Existe schema zod (src/env.ts, src/lib/env.ts, env.mjs) que valida
 *       todas las env críticas al boot.
 *   E.2 Naming: cualquier var sensible que empiece con NEXT_PUBLIC_ y no
 *       debería ser pública.
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { AuditItem, ScanResult } from "../types";
import { repoRoot, walk, readManyAbs, findLineMatches, safeSnippet } from "../fs-helpers";

const CRITICAL_VARS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
];

// Vars sensibles que NUNCA deberían tener prefijo NEXT_PUBLIC_.
const NEVER_PUBLIC = [
  "DATABASE_URL", "DIRECT_URL",
  "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE",
  "STRIPE_SECRET", "STRIPE_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "CRON_SECRET", "JWT_SECRET",
  "SIGNATURE_MASTER_KEY", "DATA_ENCRYPTION_KEY",
  "FACTURAPI_KEY",
];

async function fileExists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(repoRoot(), rel)); return true; }
  catch { return false; }
}

export async function runEnvScan(): Promise<ScanResult> {
  const t0 = Date.now();
  const items: AuditItem[] = [];

  // E.1 — schema zod existe?
  const candidates = ["src/env.ts", "src/env.mjs", "src/lib/env.ts", "env.mjs"];
  let envSchemaPath: string | null = null;
  for (const c of candidates) {
    if (await fileExists(c)) { envSchemaPath = c; break; }
  }

  if (!envSchemaPath) {
    items.push({
      category: "env",
      severity: "high",
      file: "",
      line: 0,
      title: "No existe schema de validación de variables de entorno",
      description:
        "El proyecto no tiene src/env.ts ni equivalente que valide DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, etc. Si una falta en runtime, los endpoints fallan con error difuso en vez de un error claro al boot.",
      suggestion:
        "Crea src/env.ts con zod: const envSchema = z.object({ DATABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), ... }); export const env = envSchema.parse(process.env). Importa env desde el resto del código.",
      code_snippet: "",
    });
  } else {
    // Si existe, chequea que cubra todas las CRITICAL_VARS.
    const f = (await readManyAbs([path.join(repoRoot(), envSchemaPath)]))[0];
    if (f) {
      const missing = CRITICAL_VARS.filter(v => !f.content.includes(v));
      if (missing.length > 0) {
        items.push({
          category: "env",
          severity: "critical",
          file: envSchemaPath,
          line: 1,
          title: `Schema de env existe pero no valida: ${missing.join(", ")}`,
          description:
            "El schema zod no incluye todas las vars críticas. Si alguna no está seteada en producción, el código falla en runtime con error genérico.",
          suggestion:
            `Agrega cada var faltante al envSchema. Para opcionales usa z.string().optional(); para requeridas z.string().min(1).`,
          code_snippet: safeSnippet(f.content.slice(0, 300)),
        });
      }
    }
  }

  // E.2 — NEXT_PUBLIC_ con vars sensibles. Buscamos en código + .env.example.
  const tsFiles = await readManyAbs(await walk(path.join(repoRoot(), "src"), [".ts", ".tsx"]));
  const envExamplePath = path.join(repoRoot(), ".env.example");
  if (await fileExists(".env.example")) {
    const f = (await readManyAbs([envExamplePath]))[0];
    if (f) tsFiles.push(f);
  }

  for (const f of tsFiles) {
    const matches = findLineMatches(f.content, /\bNEXT_PUBLIC_\w+/g);
    for (const m of matches) {
      const varName = m.text.match(/NEXT_PUBLIC_\w+/)?.[0] ?? "";
      const isLeak = NEVER_PUBLIC.some(p => varName.toUpperCase().includes(p));
      if (isLeak) {
        items.push({
          category: "env",
          severity: "critical",
          file: f.rel,
          line: m.line,
          title: `Variable sensible expuesta como NEXT_PUBLIC_: ${varName}`,
          description:
            "Esta variable contiene un secret (DATABASE_URL, service-role key, Stripe secret, etc.) pero tiene prefijo NEXT_PUBLIC_, lo que la inserta en el bundle del browser. Cualquier visitante del sitio la lee con DevTools.",
          suggestion:
            `Renombra a ${varName.replace(/^NEXT_PUBLIC_/, "")} y úsala solo en código server (Route Handlers, Server Components). En .env.example refleja el cambio. Después de mergear, ROTA la credencial actual — está comprometida.`,
          code_snippet: safeSnippet(m.text.trim()),
        });
      }
    }
  }

  return { items, duration_ms: Date.now() - t0 };
}
