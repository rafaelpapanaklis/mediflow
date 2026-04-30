/**
 * Scanner F — LFPDPPP / ARCO.
 *
 *   F.1 Existe endpoint ARCO funcional con flujo Acceso/Rectificación/
 *       Cancelación/Oposición.
 *   F.2 Soft delete del paciente con retención clínica + anonimización de PII.
 *   F.3 Endpoint de export de datos (portabilidad).
 *   F.4 Política de retención configurada (cron + tabla).
 *   F.5 Aviso de privacidad linkeado desde register/login/footer.
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { AuditItem, ScanResult } from "../types";
import { repoRoot, walk, readManyAbs, safeSnippet } from "../fs-helpers";

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(repoRoot(), rel)); return true; }
  catch { return false; }
}

export async function runArcoScan(): Promise<ScanResult> {
  const t0 = Date.now();
  const items: AuditItem[] = [];

  // F.1 — endpoint ARCO funcional. Buscar /api/arco* o similar.
  const apiRoutes = await walk(path.join(repoRoot(), "src/app/api"), [".ts"]);
  const arcoRoutes = apiRoutes.filter(p => /\barco\b/i.test(p));
  if (arcoRoutes.length === 0) {
    items.push({
      category: "arco",
      severity: "critical",
      file: "src/app/api/",
      line: 0,
      title: "No hay endpoint ARCO (LFPDPPP art. 28)",
      description:
        "LFPDPPP exige que el titular pueda ejercer derechos ARCO (Acceso, Rectificación, Cancelación, Oposición) y que la clínica responda en máx 20 días hábiles. No se detectó ningún /api/arco*.",
      suggestion:
        "Crea /api/arco-request con GET (export de datos del titular), PATCH (rectificación), POST con action='cancel' (cancelación con anonimización), POST con action='oppose'. Cada acción debe loggear en arco_requests con timestamp, user, motivo y resolución.",
      code_snippet: "",
    });
  } else {
    const arcoFiles = await readManyAbs(arcoRoutes);
    const allContent = arcoFiles.map(f => f.content).join("\n");
    const supports = {
      access: /\baccess\b|\bexport(Patient)?Data\b|GET/i.test(allContent),
      rect: /\brectif/i.test(allContent) || /PATCH|PUT/i.test(allContent),
      cancel: /\bcancel|delete|anonimiz/i.test(allContent),
      oppose: /\bopo(s|n)/i.test(allContent),
    };
    const missing = Object.entries(supports).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      items.push({
        category: "arco",
        severity: "high",
        file: arcoFiles[0].rel,
        line: 1,
        title: `Endpoint ARCO incompleto, falta: ${missing.join(", ")}`,
        description:
          "Existe el endpoint pero el handler no parece cubrir las 4 letras del ARCO. La autoridad puede multar si la clínica no responde a una solicitud específica.",
        suggestion:
          "Agrega los handlers faltantes. Cada acción debe quedar registrada en arco_requests para auditoría.",
        code_snippet: safeSnippet(arcoFiles[0].content.slice(0, 240)),
      });
    }
  }

  // F.2 — patient delete: hard vs soft con anonimización
  const patientRoutes = apiRoutes.filter(p => /\/patients?\/\[id\]\/route\.ts$/.test(p));
  const patientFiles = await readManyAbs(patientRoutes);
  for (const f of patientFiles) {
    const hasDelete = /export\s+async\s+function\s+DELETE/.test(f.content);
    if (!hasDelete) continue;
    const isHardDelete = /prisma\.patient\.delete(\b|\s|\()/i.test(f.content);
    const isSoftWithAnon =
      /status:\s*['"]ARCHIVED['"]/.test(f.content) &&
      /anonimi|redact|null.*firstName|null.*lastName|null.*curp|null.*rfc/i.test(f.content);
    const isSoftWithoutAnon =
      /status:\s*['"]ARCHIVED['"]/.test(f.content) && !isSoftWithAnon;
    if (isHardDelete) {
      items.push({
        category: "arco",
        severity: "critical",
        file: f.rel,
        line: 1,
        title: "DELETE de paciente es hard delete",
        description:
          "El endpoint borra físicamente al paciente. NOM-024 exige retención de la historia clínica por 5 años; un hard delete pierde data legalmente requerida.",
        suggestion:
          "Cambia a soft delete: status=ARCHIVED + anonimiza PII (firstName='—', lastName='—', email=null, phone=null, curp=null, rfc=null). Los registros clínicos asociados (records, appointments, prescriptions) quedan intactos.",
        code_snippet: safeSnippet(f.content.slice(0, 240)),
      });
    } else if (isSoftWithoutAnon) {
      items.push({
        category: "arco",
        severity: "medium",
        file: f.rel,
        line: 1,
        title: "Soft delete de paciente sin anonimización de PII",
        description:
          "ARCHIVED preserva la historia clínica (correcto NOM-024), pero la PII (nombre, email, teléfono, CURP, RFC) sigue accesible. LFPDPPP exige anonimizar al ejercerse Cancelación/Oposición.",
        suggestion:
          "Tras setear status=ARCHIVED, sobrescribe firstName/lastName con un placeholder y null en email/phone/curp/rfc. Mantén patientNumber para trazabilidad interna.",
        code_snippet: safeSnippet(f.content.slice(0, 240)),
      });
    }
  }

  // F.3 — endpoint de portabilidad
  const portabilityCandidates = apiRoutes.filter(p =>
    /export[-_]?cda|patient[-_]?export|portability|arco-?request/i.test(p),
  );
  if (portabilityCandidates.length === 0) {
    items.push({
      category: "arco",
      severity: "high",
      file: "src/app/api/",
      line: 0,
      title: "Sin endpoint de portabilidad de datos",
      description:
        "LFPDPPP art. 22 (derecho de Acceso) exige que la clínica entregue los datos del titular en formato estructurado. No se detectó endpoint que devuelva expediente completo en JSON/PDF/CDA.",
      suggestion:
        "Crea /api/patients/[id]/export con GET que devuelva JSON con: datos personales, citas, historia clínica, prescripciones, archivos (signed URLs con TTL 24h), facturación. O un PDF generado con react-pdf.",
      code_snippet: "",
    });
  }

  // F.4 — política de retención
  const cronFiles = await readManyAbs(await walk(path.join(repoRoot(), "src/app/api/cron"), [".ts"]));
  const hasRetentionCron = cronFiles.some(f =>
    /retention|retencion|purg(e|a)|cleanup.*audit|cleanup.*log/i.test(f.rel + f.content),
  );
  if (!hasRetentionCron) {
    items.push({
      category: "arco",
      severity: "medium",
      file: "src/app/api/cron/",
      line: 0,
      title: "Sin política de retención automática",
      description:
        "No hay cron que aplique una política de retención por tipo de dato (audit_logs antiguos, archivos huérfanos, sesiones expiradas, ARCO requests cerradas). Sin esto, la DB acumula PII y crece sin límite.",
      suggestion:
        "Crea /api/cron/retention que corra diario y borre/anonimice según política. Documenta el cron en docs/RETENTION.md con TTL por tipo.",
      code_snippet: "",
    });
  }

  // F.5 — aviso de privacidad
  const hasPrivacyPage =
    (await exists("src/app/privacidad/page.tsx")) ||
    (await exists("src/app/privacy/page.tsx")) ||
    (await exists("src/app/legal/privacy/page.tsx"));
  if (!hasPrivacyPage) {
    items.push({
      category: "arco",
      severity: "high",
      file: "src/app/",
      line: 0,
      title: "Sin página /privacidad",
      description:
        "LFPDPPP art. 16 exige aviso de privacidad accesible y vigente. No se detectó /privacidad ni equivalente.",
      suggestion:
        "Crea src/app/privacidad/page.tsx con: identidad del responsable, finalidades del tratamiento, mecanismo de ejercer ARCO, transferencias a terceros (Supabase, Anthropic, Stripe), consentimiento.",
      code_snippet: "",
    });
  } else {
    // Verifica que login/signup la enlacen.
    const loginForm = (await readManyAbs([
      path.join(repoRoot(), "src/components/public/auth/signup/signup-form.tsx"),
    ])).find(Boolean);
    if (loginForm && !/\/privacidad|\/privacy/.test(loginForm.content)) {
      items.push({
        category: "arco",
        severity: "medium",
        file: loginForm.rel,
        line: 1,
        title: "Signup no enlaza al aviso de privacidad",
        description:
          "El formulario de registro no muestra link al aviso de privacidad ni un checkbox de consentimiento explícito. LFPDPPP exige que el titular acepte EL aviso antes del tratamiento de datos.",
        suggestion:
          "Agrega un checkbox no pre-marcado: '[ ] He leído y acepto el aviso de privacidad' con link a /privacidad. El submit del form debe rechazar si está vacío.",
        code_snippet: safeSnippet(loginForm.content.slice(0, 240)),
      });
    }
  }

  return { items, duration_ms: Date.now() - t0 };
}
