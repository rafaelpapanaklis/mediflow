/**
 * Scanner H — Cobertura de tests.
 *
 *   H.1 Inventario de archivos en src/app/api sin test correspondiente.
 *       Calcula % por carpeta crítica con metas declaradas.
 *   H.2 Tests E2E para flujos críticos (Playwright/Cypress).
 *   H.3 Tests corren en CI antes del deploy.
 */

import path from "node:path";
import fs from "node:fs/promises";
import type { BugItem } from "../../types";
import { repoRoot, walk, readManyAbs , makeItem } from "../../helpers";

const CRITICAL_AREAS: Record<string, { path: string; goal: number }> = {
  auth:           { path: "src/app/api/auth",        goal: 100 },
  billing:        { path: "src/app/api/invoices",    goal: 80 },
  prescriptions:  { path: "src/app/api/prescriptions", goal: 80 },
  records:        { path: "src/app/api/records",     goal: 70 },
  permissions:    { path: "src/app/api/team",        goal: 100 },
};

const E2E_FLOWS = [
  { id: "login",      hint: /\b(login|sign[-_]?in)\b/i },
  { id: "patient",    hint: /\b(patient|paciente).*\b(create|new|nuevo)/i },
  { id: "appointment", hint: /\b(appointment|cita|agenda)/i },
  { id: "billing",    hint: /\b(billing|invoice|cobr|charge|pay)/i },
  { id: "permissions", hint: /\b(permis|role)/i },
];

async function exists(rel: string): Promise<boolean> {
  try { await fs.access(path.join(repoRoot(), rel)); return true; }
  catch { return false; }
}

export async function runTestCoverageScan(): Promise<BugItem[]> {  const items: BugItem[] = [];

  // H.1 — cobertura por área crítica
  const allTests = await walk(path.join(repoRoot(), "src"), [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]);
  const testsByName = new Set(
    allTests.map(p => path.basename(p).replace(/\.(test|spec)\.(ts|tsx)$/, "")),
  );
  for (const [area, { path: areaPath, goal }] of Object.entries(CRITICAL_AREAS)) {
    if (!(await exists(areaPath))) continue;
    const routes = await walk(path.join(repoRoot(), areaPath), [".ts"]);
    const routeFiles = routes.filter(p => /route\.ts$/.test(p));
    if (routeFiles.length === 0) continue;
    const testsArr = Array.from(testsByName);
    const covered = routeFiles.filter(p => {
      // Heurística: existe un test cuyo nombre incluye el directorio padre.
      const dirName = path.basename(path.dirname(p));
      return testsArr.some(t => t.includes(dirName));
    });
    const pct = Math.round((covered.length / routeFiles.length) * 100);
    if (pct < goal) {
      items.push(makeItem({
        category: "tests",
        severity: pct < goal / 2 ? "high" : "medium",
        file: areaPath,
        line: 0,
        title: `Cobertura ${area}: ${pct}% (meta ${goal}%)`,
        description:
          `${covered.length}/${routeFiles.length} route handlers en ${areaPath} tienen un .test.ts o .spec.ts asociado. Por debajo del threshold del área crítica.`,
        suggestion:
          `Agrega tests para los handlers sin cobertura. Para auth/permissions la meta es 100% (cualquier regresión rompe seguridad). Usa Vitest o Jest con supertest para tests de Route Handlers.`,
        code_snippet: routeFiles.filter(p => !covered.includes(p)).slice(0, 3).map(p => path.relative(repoRoot(), p).replace(/\\/g, "/")).join("\n"),
      }));
    }
  }

  // H.2 — tests E2E críticos
  const e2eDirs = ["e2e", "tests/e2e", "playwright", "cypress"];
  let e2eRoot: string | null = null;
  for (const d of e2eDirs) {
    if (await exists(d)) { e2eRoot = d; break; }
  }
  if (!e2eRoot) {
    items.push(makeItem({
      category: "tests",
      severity: "high",
      file: "",
      line: 0,
      title: "Sin suite de tests E2E",
      description:
        "No se detectó playwright/, cypress/ ni e2e/. Los flujos críticos (login, crear paciente, agendar cita, cobrar factura, cambiar permisos) no tienen prueba de extremo a extremo. Cualquier refactor de UI puede romper sin que CI lo detecte.",
      suggestion:
        "Configura Playwright (npx playwright install) y crea e2e/ con un test por flujo crítico. Corrélos en CI antes del deploy.",
      code_snippet: "",
    }));
  } else {
    const e2eFiles = await readManyAbs(await walk(path.join(repoRoot(), e2eRoot), [".ts", ".spec.ts"]));
    const allContent = e2eFiles.map(f => f.content).join("\n");
    for (const flow of E2E_FLOWS) {
      const covered = flow.hint.test(allContent);
      if (!covered) {
        items.push(makeItem({
          category: "tests",
          severity: "high",
          file: e2eRoot,
          line: 0,
          title: `Sin test E2E para flujo crítico: ${flow.id}`,
          description:
            `La suite ${e2eRoot}/ no contiene un test que cubra el flujo "${flow.id}". Una regresión en este flujo llega a producción sin detectarse.`,
          suggestion:
            `Crea ${e2eRoot}/${flow.id}.spec.ts con el happy path mínimo del flujo.`,
          code_snippet: "",
        }));
      }
    }
  }

  // H.3 — tests en CI
  const ciFiles = [
    ".github/workflows/test.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/main.yml",
    ".github/workflows/deploy.yml",
  ];
  let ciHasTests = false;
  for (const c of ciFiles) {
    if (!(await exists(c))) continue;
    const content = await fs.readFile(path.join(repoRoot(), c), "utf-8").catch(() => "");
    if (/npm\s+(run\s+)?test|vitest|jest|playwright|cypress/i.test(content)) {
      ciHasTests = true;
      break;
    }
  }
  if (!ciHasTests) {
    items.push(makeItem({
      category: "tests",
      severity: "medium",
      file: ".github/workflows/",
      line: 0,
      title: "CI no corre tests antes del deploy",
      description:
        "No se detectó workflow de GitHub Actions con `npm test`, vitest, jest, playwright o cypress. El deploy a Vercel pasa sin filtro de tests.",
      suggestion:
        "Crea .github/workflows/test.yml con npm install + npm run typecheck + npm test. Activa branch protection en main exigiendo el workflow verde.",
      code_snippet: "",
    }));
  }

  return items;
}
