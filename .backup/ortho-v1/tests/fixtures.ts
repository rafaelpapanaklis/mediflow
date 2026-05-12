// Fixtures Playwright para E2E del módulo Ortodoncia.
//
// Hace login con MEDIFLOW_TEST_EMAIL + MEDIFLOW_TEST_PASSWORD (env vars,
// nunca hardcoded), navega al patient-detail de Gabriela en tab ortodoncia
// y entrega `page` autenticada lista para auditar.

import { test as base, expect, type Page } from "@playwright/test";

const PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj"; // Gabriela en prod (Rafael Clinica)

const TEST_EMAIL = process.env.MEDIFLOW_TEST_EMAIL;
const TEST_PASSWORD = process.env.MEDIFLOW_TEST_PASSWORD;

export const ortho = base.extend<{ orthoPage: Page }>({
  orthoPage: async ({ page }, use) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) {
      throw new Error(
        "MEDIFLOW_TEST_EMAIL + MEDIFLOW_TEST_PASSWORD env vars requeridas. Setea en tu shell antes de correr los tests.",
      );
    }

    // 1. Login
    await page.goto("/login");
    await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
    await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /iniciar sesi[oó]n|entrar/i }).click();
    // Espera a que se complete el login y aterrice en /dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // 2. Navega al patient-detail de Gabriela en tab Ortodoncia.
    await page.goto(`/dashboard/patients/${PATIENT_ID}?tab=ortodoncia`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // 3. Espera a que el módulo Ortodoncia esté visible (heading o sub-sidebar).
    // PatientHeaderG16 contiene "Gabriela" — y la sub-sidebar tiene "Ortodoncia · secciones".
    await expect(
      page.getByRole("heading", { name: /Gabriela/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await use(page);
  },
});

export { expect };
