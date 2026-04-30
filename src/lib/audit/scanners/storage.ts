/**
 * Scanner C — Storage / signed URLs.
 *
 *   C.1 Buckets públicos sensibles (consulta a storage.buckets via prisma raw —
 *       opcional; si falla, reportamos como info).
 *   C.2 getPublicUrl en código que sirve archivos clínicos (radiografías,
 *       patient_files, consent_form, etc.) → CRITICAL, pedimos signed URL.
 *   C.3 Path traversal: storage.upload con filePath que incluye `..` o input
 *       de usuario sin sanitizar.
 *   C.4 Tamaño y MIME: endpoints de upload sin validar maxFileSize y sin
 *       chequear magic bytes.
 */

import path from "node:path";
import type { AuditItem, ScanResult } from "../types";
import { prisma } from "@/lib/prisma";
import { repoRoot, walk, readManyAbs, findLineMatches, safeSnippet } from "../fs-helpers";

const CLINICAL_HINTS = /xray|patient[_-]?file|consent|fiel|prescription|signature|cfdi|medical[_-]?record|odontogr/i;

export async function runStorageScan(): Promise<ScanResult> {
  const t0 = Date.now();
  const items: AuditItem[] = [];

  // C.1 — buckets públicos sensibles. Best-effort; en algunos planes esta
  // tabla no es accesible vía Prisma, por eso wrap en try.
  try {
    const buckets = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; public: boolean }>>(
      `SELECT id, name, public FROM storage.buckets`,
    );
    for (const b of buckets) {
      if (!b.public) continue;
      if (CLINICAL_HINTS.test(b.name)) {
        items.push({
          category: "storage",
          severity: "critical",
          file: "(supabase storage)",
          line: 0,
          title: `Bucket público con archivos clínicos: ${b.name}`,
          description:
            "Bucket marcado como public=true contiene material clínico (radiografías, archivos del paciente, firmas, etc.). Cualquiera con la URL puede listar/descargar.",
          suggestion:
            "Cambia el bucket a privado y sirve archivos vía createSignedUrl con TTL corto (5 min). Migra las URLs almacenadas si las tablas guardan rutas absolutas.",
          code_snippet: `bucket.name=${b.name} public=true`,
        });
      }
    }
  } catch {
    // No fail — solo dejamos marca de que no pudimos chequear.
    items.push({
      category: "storage",
      severity: "low",
      file: "(supabase storage)",
      line: 0,
      title: "No se pudo consultar storage.buckets",
      description:
        "El scanner intentó listar buckets vía SELECT FROM storage.buckets pero falló. Verifica manualmente en Supabase Dashboard → Storage que ningún bucket con archivos clínicos tenga 'public' encendido.",
      suggestion:
        "Revisa Storage → Configuration de cada bucket. Para clínicos: privacy=private + signed URLs.",
      code_snippet: "",
    });
  }

  // C.2 / C.3 / C.4 — análisis de código
  const tsFiles = await readManyAbs(await walk(path.join(repoRoot(), "src"), [".ts", ".tsx"]));
  for (const f of tsFiles) {
    // C.2 — getPublicUrl en archivo cuyo path o contenido sugiere clínico
    const fileIsClinical = CLINICAL_HINTS.test(f.rel);
    const publicUrlMatches = findLineMatches(f.content, /\.getPublicUrl\(/);
    for (const m of publicUrlMatches) {
      const contextLines = f.lines.slice(Math.max(0, m.line - 4), m.line + 2).join("\n");
      const contextClinical = fileIsClinical || CLINICAL_HINTS.test(contextLines);
      if (contextClinical) {
        items.push({
          category: "storage",
          severity: "critical",
          file: f.rel,
          line: m.line,
          title: "getPublicUrl en flujo clínico",
          description:
            "Este archivo sirve archivos clínicos pero usa getPublicUrl. La URL queda persistida en HTML/DB y es válida indefinidamente — viola control de acceso y LFPDPPP.",
          suggestion:
            "Reemplaza por await supabase.storage.from(bucket).createSignedUrl(path, 300) (5 min). En el componente cliente, refresca la URL al expirar.",
          code_snippet: safeSnippet(m.text.trim()),
        });
      }
    }

    // C.3 — path traversal en upload
    const uploadMatches = findLineMatches(f.content, /storage\.from\([^)]*\)\.upload\(/);
    for (const m of uploadMatches) {
      // Mira las 2 líneas anteriores y la actual para detectar concatenación
      // con req body / params.
      const ctx = f.lines.slice(Math.max(0, m.line - 4), m.line + 1).join("\n");
      const concatsUserInput =
        /\$\{[^}]*\b(body|params|searchParams|formData|req\.|request\.|input|filename|originalName)/i.test(ctx) &&
        !/sanitize|slugify|crypto\.randomUUID|nanoid|replace\(\/\\\.\\\.\//.test(ctx);
      const allowsDotDot = /\.\.\//.test(ctx);
      if (concatsUserInput || allowsDotDot) {
        items.push({
          category: "storage",
          severity: "high",
          file: f.rel,
          line: m.line,
          title: "Posible path traversal en upload",
          description:
            "El filePath de storage.upload se construye con input del usuario sin sanitización visible. Un attacker puede escribir fuera del prefijo esperado y sobrescribir archivos de otra clínica.",
          suggestion:
            "Genera el path server-side: const filePath = `${clinicId}/${crypto.randomUUID()}-${slug(originalName)}`. NO uses originalName directo y NUNCA permitas '..' ni '/' del cliente.",
          code_snippet: safeSnippet(ctx),
        });
      }
    }

    // C.4 — uploads sin validación de tamaño/MIME
    const isUploadEndpoint =
      /\/api\/.+\/route\.ts$/.test(f.rel) &&
      /storage\.from\([^)]*\)\.upload\(/.test(f.content);
    if (isUploadEndpoint) {
      const validatesSize =
        /\.size\s*>/.test(f.content) ||
        /MAX_FILE_SIZE|MAX_BYTES|max(File)?Size/.test(f.content);
      const validatesMime =
        /\.type\s*\.startsWith|\bmagicBytes?\b|\bfile-type\b|allowedMime|ALLOWED_MIME/.test(f.content);
      if (!validatesSize || !validatesMime) {
        items.push({
          category: "storage",
          severity: validatesSize || validatesMime ? "medium" : "high",
          file: f.rel,
          line: 1,
          title: "Upload sin validación completa de tamaño/MIME",
          description:
            `Endpoint de upload sin validar ${!validatesSize ? "tamaño" : ""}${!validatesSize && !validatesMime ? " y " : ""}${!validatesMime ? "MIME (magic bytes)" : ""}. Permite que un cliente suba un binario gigante o un archivo con Content-Type falso.`,
          suggestion:
            "Valida file.size <= MAX_BYTES (ej. 10*1024*1024 para radiografías). Para MIME, revisa magic bytes con la librería 'file-type' — NO confíes en file.type del cliente.",
          code_snippet: safeSnippet(f.content.slice(0, 240)),
        });
      }
    }
  }

  return { items, duration_ms: Date.now() - t0 };
}
