import "server-only";
import {
  walkFiles,
  readFileText,
  relPath,
  lineAt,
  lineOf,
  makeItem,
  safeSnippet,
} from "../helpers";
import type { BugItem } from "../types";

/**
 * 2.1 Auth coverage — endpoints que NO llaman getCurrentUser /
 * getAuthContext / loadClinicSession antes de tocar Prisma.
 *
 * Excepciones permitidas (regex en path):
 * - /api/auth/*          (login, signup, forgot, reset)
 * - /api/public/*        (rutas públicas)
 * - /api/cron/*          (verificadas con CRON_SECRET en header)
 * - /api/portal/*        (portal de paciente con token)
 * - /api/og/*            (OG images)
 * - /api/landing/*       (forms públicos de landings)
 */
const AUTH_EXEMPT_REGEX = /\/api\/(auth|public|cron|portal|og|landing|reservar|live|tv)\b/;

export async function scanAuthCoverage(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src/app/api");
  for (const f of files) {
    if (!f.endsWith("/route.ts") && !f.endsWith("\\route.ts")) continue;
    const rel = relPath(f);
    if (AUTH_EXEMPT_REGEX.test(rel)) continue;
    const txt = await readFileText(f);
    const callsAuth =
      /getCurrentUser\s*\(/.test(txt) ||
      /getAuthContext\s*\(/.test(txt) ||
      /loadClinicSession\s*\(/.test(txt) ||
      /getServerSession\s*\(/.test(txt) ||
      /getDbUser\s*\(/.test(txt) ||
      /requireAuth\s*\(/.test(txt) ||
      /CRON_SECRET/.test(txt);
    const touchesPrisma = /\bprisma\.[a-zA-Z]+\.(find|create|update|delete|count|aggregate|upsert)/.test(txt);
    if (touchesPrisma && !callsAuth) {
      items.push(
        makeItem({
          category: "auth",
          severity: "critical",
          file: rel,
          line: 1,
          title: "Endpoint sin auth check antes de tocar la DB",
          description:
            "El handler hace queries a Prisma sin haber llamado getCurrentUser/getAuthContext/loadClinicSession. Cualquier request anónimo puede leer/mutar datos.",
          suggestion:
            "Agrega `const ctx = await getAuthContext(); if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });` al inicio del handler. Si el endpoint es público a propósito, mové el path bajo /api/public/.",
          code_snippet: safeSnippet(txt.split("\n").slice(0, 10).join("\n")),
        }),
      );
    }
  }
  return items;
}

/**
 * 2.3 IDOR — endpoints con [id] en el path que hacen findFirst/findUnique
 * SIN incluir clinicId en el where. Permite cross-tenant acceso.
 */
export async function scanIDOR(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src/app/api");
  for (const f of files) {
    if (!f.endsWith("/route.ts") && !f.endsWith("\\route.ts")) continue;
    const rel = relPath(f);
    if (!/\[id\]|\[\w+Id\]/.test(rel)) continue;
    if (AUTH_EXEMPT_REGEX.test(rel)) continue;
    const txt = await readFileText(f);
    // Match findFirst/findUnique/update/delete con id de params; flag si
    // el bloque where: { ... } no menciona clinicId/userId scope.
    const re = /prisma\.(\w+)\.(findFirst|findUnique|update|delete|deleteMany|updateMany)\s*\(\s*\{[\s\S]*?where\s*:\s*\{([\s\S]*?)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const whereBody = m[3];
      const usesParamId = /params\.id|params\.\w+Id|id\s*:\s*params\./.test(whereBody);
      const hasScopeGuard = /clinicId|userId|patient(:\s*\{|\.\s*clinicId)|medicalRecord:\s*\{[\s\S]*?clinicId/.test(whereBody);
      if (usesParamId && !hasScopeGuard) {
        const off = m.index;
        const ln = lineAt(txt, off);
        items.push(
          makeItem({
            category: "idor",
            severity: "critical",
            file: rel,
            line: ln,
            title: `IDOR potencial: ${m[1]}.${m[2]} con params.id sin clinicId`,
            description:
              "El query usa el id del path params sin filtrar por clinicId. Un usuario de otra clínica con un id válido puede leer/mutar este recurso.",
            suggestion:
              "Cambia el where a `{ id: params.id, clinicId: ctx.clinicId }`. Para recursos anidados (medicalRecord, prescription) usa la relación: `medicalRecord: { clinicId: ctx.clinicId }`.",
            code_snippet: safeSnippet(lineOf(txt, ln)),
          }),
        );
      }
    }
  }
  return items;
}

/**
 * 2.4 Mass assignment — prisma.X.update({ data: body }) o data: { ...body }
 * sin allowlist explícita.
 */
export async function scanMassAssignment(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src/app/api");
  for (const f of files) {
    if (!f.endsWith("/route.ts") && !f.endsWith("\\route.ts")) continue;
    const rel = relPath(f);
    const txt = await readFileText(f);
    const re = /prisma\.\w+\.(update|create|upsert)\s*\(\s*\{[\s\S]*?data\s*:\s*([^,}\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      const dataExpr = m[2].trim();
      // body, req.body, parsed.data, ...body, ...req.body son red flags.
      const flag =
        /^body\b/.test(dataExpr) ||
        /^req\.body\b/.test(dataExpr) ||
        /^parsed\.data\b/.test(dataExpr) ||
        /^\.\.\.body/.test(dataExpr) ||
        /^\{\s*\.\.\.body/.test(dataExpr) ||
        /^\{\s*\.\.\.req\.body/.test(dataExpr);
      if (flag) {
        const ln = lineAt(txt, m.index);
        items.push(
          makeItem({
            category: "mass-assignment",
            severity: "high",
            file: rel,
            line: ln,
            title: "Mass assignment: data viene del body sin allowlist",
            description:
              "Pasar el body completo a Prisma permite que un cliente actualice campos sensibles (role, clinicId, isOwner, permissionsOverride) si los incluye en el JSON.",
            suggestion:
              "Validá con Zod y picá explícitamente los campos permitidos: `data: { firstName: parsed.data.firstName, lastName: parsed.data.lastName }`. Nunca uses `data: body` o `data: { ...body }` en endpoints autenticados de usuario.",
            code_snippet: safeSnippet(lineOf(txt, ln)),
          }),
        );
      }
    }
  }
  return items;
}

/**
 * 2.5 SQL injection — uso de $queryRawUnsafe / $executeRawUnsafe con
 * interpolación de strings (sin Prisma.sql tagged template).
 */
export async function scanSqlInjection(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    if (!/queryRawUnsafe|executeRawUnsafe/.test(txt)) continue;
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      if (/queryRawUnsafe|executeRawUnsafe/.test(line) && /\$\{/.test(line)) {
        items.push(
          makeItem({
            category: "sql-injection",
            severity: "critical",
            file: rel,
            line: i + 1,
            title: "queryRawUnsafe con interpolación ${} — SQL injection",
            description:
              "$queryRawUnsafe / $executeRawUnsafe NO escapa parámetros. Cualquier ${variable} en el SQL puede ser inyectado por el atacante.",
            suggestion:
              "Cambia a `prisma.$queryRaw\\`SELECT ... WHERE col = ${value}\\`` (tagged template — Prisma escapa). Para identifiers dinámicos usa `Prisma.sql` o validá contra una allowlist literal.",
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 2.7 Secrets en cliente — process.env.* en archivos client (use client)
 * que NO empieza con NEXT_PUBLIC_.
 */
export async function scanSecretsInClient(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    if (!rel.includes("/components/") && !rel.includes("/app/")) continue;
    const txt = await readFileText(f);
    if (!/^"use client"/m.test(txt)) continue;
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      const re = /process\.env\.([A-Z][A-Z0-9_]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const name = m[1];
        if (!name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV") {
          items.push(
            makeItem({
              category: "secrets",
              severity: "critical",
              file: rel,
              line: i + 1,
              title: `Secret leak: process.env.${name} en client component`,
              description:
                "Variables de entorno sin prefijo NEXT_PUBLIC_ se reemplazan en el bundle del cliente como `undefined`. Si no, el secret se shippea al navegador y queda público.",
              suggestion:
                `Si el valor debe ser visible al cliente, renombra a NEXT_PUBLIC_${name}. Si es un secret real (API key, service role), movelo a un endpoint API y consumelo desde el cliente con fetch.`,
              code_snippet: safeSnippet(line),
            }),
          );
        }
      }
    });
  }
  return items;
}

/**
 * 2.6 dangerouslySetInnerHTML sin sanitizar (heurística: no se importa
 * DOMPurify en el archivo).
 */
export async function scanDangerousHTML(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src", [".tsx", ".jsx"]);
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    if (!/dangerouslySetInnerHTML/.test(txt)) continue;
    const sanitizes = /DOMPurify|sanitize-html|isomorphic-dompurify/.test(txt);
    if (!sanitizes) {
      const lines = txt.split("\n");
      lines.forEach((line, i) => {
        if (/dangerouslySetInnerHTML/.test(line)) {
          items.push(
            makeItem({
              category: "xss",
              severity: "high",
              file: rel,
              line: i + 1,
              title: "dangerouslySetInnerHTML sin sanitización",
              description:
                "Renderizar HTML directo desde una fuente no-confiable (DB, body, query) permite XSS. No detectamos importación de DOMPurify ni sanitize-html en el archivo.",
              suggestion:
                "Si el HTML es estático (literal en código): silenciá este hallazgo. Si viene de DB o input: importa DOMPurify y pasalo por sanitize() antes de inyectar.",
              code_snippet: safeSnippet(line),
            }),
          );
        }
      });
    }
  }
  return items;
}

/**
 * 2.18 Audit log integrity — NOM-024 prohíbe modificar/borrar audit_logs.
 * Cualquier prisma.auditLog.delete/update en código = CRITICAL.
 */
export async function scanAuditLogIntegrity(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      if (/prisma\.auditLog\.(delete|deleteMany|update|updateMany)/.test(line)) {
        items.push(
          makeItem({
            category: "audit-log",
            severity: "critical",
            file: rel,
            line: i + 1,
            title: "Mutación de audit_logs detectada (rompe NOM-024)",
            description:
              "NOM-024-SSA3-2012 exige que los registros de auditoría sean inmutables. Cualquier delete/update sobre prisma.auditLog rompe el cumplimiento.",
            suggestion:
              "Eliminá la operación. Si necesitás 'archivar' eventos viejos, copiá a otra tabla con un job y luego nunca los borres ni modifiques.",
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 2.21 Secrets en git — strings hardcoded que parezcan tokens.
 */
export async function scanHardcodedSecrets(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  const patterns: Array<[RegExp, string]> = [
    [/sk_live_[A-Za-z0-9]{20,}/g, "Stripe live key"],
    [/sk_test_[A-Za-z0-9]{20,}/g, "Stripe test key"],
    [/AKIA[0-9A-Z]{16}/g, "AWS access key"],
    [/eyJ[A-Za-z0-9_-]{40,}/g, "JWT token literal"],
  ];
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      // Skip comentarios obvios y .env.example.
      if (/^\s*\/\//.test(line) || /\.env\.example/.test(rel)) return;
      for (const [pat, label] of patterns) {
        if (pat.test(line)) {
          items.push(
            makeItem({
              category: "secrets",
              severity: "critical",
              file: rel,
              line: i + 1,
              title: `Secret hardcodeado en código: ${label}`,
              description:
                "Detectamos un string que parece un secret real comprometido en el repo. Cualquiera con acceso al git history lo puede ver.",
              suggestion:
                "Mové el valor a una variable de entorno y rotá la credencial inmediatamente (las claves expuestas en git deben asumirse comprometidas para siempre, aunque borres el commit).",
              code_snippet: safeSnippet(line),
            }),
          );
          break;
        }
      }
    });
  }
  return items;
}
