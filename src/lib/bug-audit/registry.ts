import "server-only";
import type { BugItem, ScannerSection, ScannerResult } from "./types";

import {
  scanAuthCoverage,
  scanIDOR,
  scanMassAssignment,
  scanSqlInjection,
  scanSecretsInClient,
  scanDangerousHTML,
  scanAuditLogIntegrity,
  scanHardcodedSecrets,
} from "./scanners/security";
import {
  scanNPlusOne,
  scanNoSelect,
  scanHeavyImports,
  scanUseEffectLeaks,
} from "./scanners/performance";
import {
  scanTypeScriptAny,
  scanConsoleLogs,
  scanTodos,
  scanSwallowedErrors,
} from "./scanners/quality";
import { scanBrokenButtons } from "./scanners/frontend";
import { scanRLSCoverage, scanOrphanFKs } from "./scanners/db";

// Extras (originalmente en branch bug-audit-extras como /run-extras endpoint
// + src/lib/audit/scanners/*). Consolidados aquí: el endpoint /run ahora
// corre los 29 scanners y el endpoint /run-extras se eliminó.
import { runWebhookScan }      from "./scanners/extras/webhooks";
import { runCronScan }         from "./scanners/extras/crons";
import { runStorageScan }      from "./scanners/extras/storage";
import { runAIScan }           from "./scanners/extras/ai";
import { runEnvScan }          from "./scanners/extras/env";
import { runArcoScan }         from "./scanners/extras/arco";
import { runBackupScan }       from "./scanners/extras/backups";
import { runTestCoverageScan } from "./scanners/extras/test-coverage";
import { runA11yScan }         from "./scanners/extras/a11y";
import { runMigrationScan }    from "./scanners/extras/migrations";

interface ScannerDef {
  section: ScannerSection;
  name: string;
  run: () => Promise<BugItem[]>;
}

const SCANNERS: ScannerDef[] = [
  // Backend (DB structural)
  { section: "backend", name: "rls-coverage",      run: scanRLSCoverage },
  { section: "backend", name: "fk-orphans",        run: scanOrphanFKs },
  // Backend (extras)
  { section: "backend", name: "crons",             run: runCronScan },
  { section: "backend", name: "backups",           run: runBackupScan },
  { section: "backend", name: "migrations",        run: runMigrationScan },

  // Security
  { section: "security", name: "auth-coverage",    run: scanAuthCoverage },
  { section: "security", name: "idor",             run: scanIDOR },
  { section: "security", name: "mass-assignment",  run: scanMassAssignment },
  { section: "security", name: "sql-injection",    run: scanSqlInjection },
  { section: "security", name: "secrets-client",   run: scanSecretsInClient },
  { section: "security", name: "dangerous-html",   run: scanDangerousHTML },
  { section: "security", name: "audit-log",        run: scanAuditLogIntegrity },
  { section: "security", name: "hardcoded-secrets",run: scanHardcodedSecrets },
  // Security (extras)
  { section: "security", name: "webhooks",         run: runWebhookScan },
  { section: "security", name: "storage",          run: runStorageScan },
  { section: "security", name: "ai",               run: runAIScan },
  { section: "security", name: "env",              run: runEnvScan },
  { section: "security", name: "arco",             run: runArcoScan },

  // Performance
  { section: "performance", name: "n-plus-one",    run: scanNPlusOne },
  { section: "performance", name: "no-select",     run: scanNoSelect },
  { section: "performance", name: "heavy-imports", run: scanHeavyImports },
  { section: "performance", name: "useeffect-leak",run: scanUseEffectLeaks },

  // Quality
  { section: "quality", name: "ts-any",            run: scanTypeScriptAny },
  { section: "quality", name: "console-log",       run: scanConsoleLogs },
  { section: "quality", name: "todo",              run: scanTodos },
  { section: "quality", name: "swallowed-error",   run: scanSwallowedErrors },
  // Quality (extras)
  { section: "quality", name: "tests",             run: runTestCoverageScan },

  // Frontend
  { section: "frontend", name: "broken-buttons",   run: scanBrokenButtons },
  // Frontend (extras)
  { section: "frontend", name: "a11y",             run: runA11yScan },
];

export async function runAllScanners(
  filterSections?: ScannerSection[],
): Promise<ScannerResult[]> {
  const out: ScannerResult[] = [];
  // Agrupamos por sección para reportar duración por sección.
  const sections: ScannerSection[] = filterSections ?? ["backend", "security", "performance", "quality", "frontend"];
  for (const sec of sections) {
    const t0 = Date.now();
    const items: BugItem[] = [];
    for (const sc of SCANNERS.filter((s) => s.section === sec)) {
      try {
        const got = await sc.run();
        items.push(...got);
      } catch (e) {
        // Un scanner que falla NO debe tirar la auditoría entera.
        items.push({
          category: "console-log",
          severity: "low",
          file: `scanner:${sc.name}`,
          line: null,
          title: `Scanner ${sc.name} falló`,
          description: `Error al ejecutar el scanner: ${(e as Error).message}`,
          suggestion: "Revisá el código del scanner y los archivos de muestra que pueden romperlo.",
          code_snippet: null,
          fingerprint: `scanner-fail-${sc.name}`,
        });
      }
    }
    out.push({ section: sec, items, durationMs: Date.now() - t0 });
  }
  return out;
}

/** Lista plana de nombres por sección — para mostrar progreso en la UI. */
export const SCANNER_SECTIONS: Record<ScannerSection, string[]> = {
  backend:    SCANNERS.filter((s) => s.section === "backend").map((s) => s.name),
  security:   SCANNERS.filter((s) => s.section === "security").map((s) => s.name),
  performance:SCANNERS.filter((s) => s.section === "performance").map((s) => s.name),
  quality:    SCANNERS.filter((s) => s.section === "quality").map((s) => s.name),
  frontend:   SCANNERS.filter((s) => s.section === "frontend").map((s) => s.name),
};
