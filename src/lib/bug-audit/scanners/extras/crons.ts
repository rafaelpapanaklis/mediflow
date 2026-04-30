/**
 * Scanner B — Crons + service keys.
 *
 *   B.1 Endpoints en /api/cron/* validan CRON_SECRET o x-vercel-cron-signature.
 *   B.2 SUPABASE_SERVICE_ROLE_KEY referenciado en archivos cliente ("use client",
 *       hooks, components). Cualquier match = CRITICAL.
 *   B.3 createBrowserClient con service-role key.
 *   B.4 Crons que no iteran por todas las clínicas (multi-tenant).
 */

import path from "node:path";
import type { BugItem } from "../../types";
import { repoRoot, walk, readManyAbs, isUseClient, findLineMatches, safeSnippet , makeItem } from "../../helpers";

export async function runCronScan(): Promise<BugItem[]> {  const items: BugItem[] = [];

  // B.1 — cron auth
  const cronDir = path.join(repoRoot(), "src/app/api/cron");
  const cronFiles = await readManyAbs(await walk(cronDir, [".ts"]));
  for (const f of cronFiles) {
    const validates =
      /process\.env\.CRON_SECRET/.test(f.content) ||
      /x-vercel-cron-signature/i.test(f.content) ||
      /vercel-cron\/?\d/.test(f.content);
    if (!validates) {
      items.push(makeItem({
        category: "crons",
        severity: "critical",
        file: f.rel,
        line: 1,
        title: "Cron expuesto sin auth",
        description:
          "El cron no valida CRON_SECRET ni la cabecera x-vercel-cron-signature. Cualquiera con la URL puede dispararlo y saturar la DB o Anthropic API.",
        suggestion:
          "Al inicio del handler: const auth = req.headers.get('authorization'); if (auth !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse('unauthorized', { status: 401 }).",
        code_snippet: safeSnippet(f.content.slice(0, 240)),
      }));
    }

    // B.4 — iteración multi-tenant. Si el cron consulta una entidad por
    // clínica pero NO usa findMany sobre Clinic ni groupBy clinicId, es
    // sospechoso. Heurística:
    const touchesPerClinic = /prisma\.(appointment|invoice|patient|treatmentPlan)/.test(f.content);
    const iteratesAll =
      /prisma\.clinic\.findMany/.test(f.content) ||
      /groupBy.*clinicId/i.test(f.content);
    if (touchesPerClinic && !iteratesAll) {
      items.push(makeItem({
        category: "crons",
        severity: "high",
        file: f.rel,
        line: 1,
        title: "Cron multi-tenant probablemente roto",
        description:
          "Toca entidades por clínica (appointments/invoices/patients) pero no se ve un loop por todas las clínicas activas ni un groupBy clinicId. Si solo procesa una clínica, las demás no reciben el job.",
        suggestion:
          "Comienza con const clinics = await prisma.clinic.findMany({ where: { /* activas */ } }); itera y procesa cada una con su propio scope clinicId.",
        code_snippet: safeSnippet(f.content.slice(0, 240)),
      }));
    }
  }

  // B.2 / B.3 — service-role en cliente
  const allFiles = await readManyAbs(await walk(path.join(repoRoot(), "src"), [".ts", ".tsx"]));
  for (const f of allFiles) {
    if (!isUseClient(f.content)) continue;
    const matches = findLineMatches(
      f.content,
      /SUPABASE_SERVICE_ROLE_KEY|service_role/g,
    );
    for (const m of matches) {
      items.push(makeItem({
        category: "crons",
        severity: "critical",
        file: f.rel,
        line: m.line,
        title: "SUPABASE_SERVICE_ROLE_KEY referenciada en archivo cliente",
        description:
          "Este archivo tiene 'use client' y referencia la service-role key. Si llega al bundle del browser, cualquier visitante tiene acceso admin total a la DB.",
        suggestion:
          "Mueve la lógica que usa service-role a un Route Handler (server). Desde el cliente solo se llama al endpoint, NUNCA se importa la key.",
        code_snippet: safeSnippet(m.text),
      }));
    }
    // createBrowserClient con service key
    const browserSvc = findLineMatches(
      f.content,
      /createBrowserClient\([^)]*SUPABASE_SERVICE_ROLE_KEY/,
    );
    for (const m of browserSvc) {
      items.push(makeItem({
        category: "crons",
        severity: "critical",
        file: f.rel,
        line: m.line,
        title: "createBrowserClient con service-role key",
        description:
          "El browser client NUNCA debe instanciarse con la service-role. La anon key es la correcta para el cliente.",
        suggestion: "Reemplaza por NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        code_snippet: safeSnippet(m.text),
      }));
    }
  }

  return items;
}
