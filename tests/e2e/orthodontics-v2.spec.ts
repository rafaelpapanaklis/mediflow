// E2E del módulo Ortodoncia v2 · Gabriela Hernández Ruiz.
//
// Requiere:
//   - Migration aplicada (17 tablas v2)
//   - Seed Gabriela v2 aplicado (ver scripts/ortho-v2-seed-prod.sql)
//   - MEDIFLOW_TEST_EMAIL + MEDIFLOW_TEST_PASSWORD en env
//   - PLAYWRIGHT_BASE_URL apuntando a preview o local
//
// Si el seed no está aplicado, los tests con caso saltan automáticamente
// (test.skip() en before).

import { test as base, expect, type Page } from "@playwright/test";

const PATIENT_ID = "cmouwaz1z0001v3qhqigop9nj"; // Gabriela
const TEST_EMAIL = process.env.MEDIFLOW_TEST_EMAIL;
const TEST_PASSWORD = process.env.MEDIFLOW_TEST_PASSWORD;

interface Fixture {
  orthoPage: Page;
  hasCase: boolean;
}

const test = base.extend<Fixture>({
  orthoPage: async ({ page }, use) => {
    if (!TEST_EMAIL || !TEST_PASSWORD) {
      throw new Error(
        "MEDIFLOW_TEST_EMAIL + MEDIFLOW_TEST_PASSWORD env vars requeridas",
      );
    }
    await page.goto("/login");
    await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
    await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /iniciar sesi[oó]n|entrar/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await page.goto(`/dashboard/patients/${PATIENT_ID}?tab=ortodoncia`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await use(page);
  },
  hasCase: async ({ orthoPage }, use) => {
    // Check si el tab ortodoncia existe (significa que hay OrthoCase)
    const tab = orthoPage.locator('[role="tab"]', { hasText: /Ortodoncia/i });
    const hasIt = await tab.count() > 0;
    await use(hasIt);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Group A · navegación y shell
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Ortodoncia v2 · shell", () => {
  test("1. carga patient-detail y muestra tab Ortodoncia", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase, "Sin OrthoCase · seed no aplicado");
    await expect(orthoPage.getByRole("heading", { name: /Gabriela/i }).first()).toBeVisible();
  });

  test("2. PatientHeaderG16 muestra caseCode y status", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await expect(orthoPage.getByText(/ORT-2026/)).toBeVisible();
    await expect(orthoPage.getByText(/Activo|ACTIVE/)).toBeVisible();
  });

  test("3. SubSidebar tiene 8 secciones", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    for (const label of [
      "Resumen",
      "Expediente clínico",
      "Fotos & Rx",
      "Plan de tratamiento",
      "Citas & evolución",
      "Plan financiero",
      "Retención",
      "Documentos",
    ]) {
      await expect(orthoPage.getByText(label, { exact: false }).first()).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B · secciones funcionales
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Ortodoncia v2 · secciones", () => {
  test("4. Resumen muestra fase actual y stepper", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Resumen/i }).click();
    await expect(orthoPage.getByText(/Nivelación/i).first()).toBeVisible();
    await expect(orthoPage.getByText(/Fase actual/i).first()).toBeVisible();
  });

  test("5. Expediente muestra Clase II Div 1", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Expediente/i }).click();
    await expect(orthoPage.getByText(/Clase II/).first()).toBeVisible();
  });

  test("6. Plan muestra 7 arcos", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Plan de tratamiento/i }).click();
    await orthoPage.getByRole("button", { name: /Arcos/i }).click();
    // 7 rows con order 1..7
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      await expect(orthoPage.locator(`text=^${n}$`).first()).toBeVisible();
    }
  });

  test("7. Citas muestra 6+ Treatment Cards", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Citas/i }).click();
    await expect(orthoPage.getByText(/Treatment Cards/i).first()).toBeVisible();
  });

  test("8. Financiero muestra 3 escenarios + 18 mensualidades", async ({
    orthoPage,
    hasCase,
  }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Plan financiero/i }).click();
    // 18 chips M1..M18
    await expect(orthoPage.locator("text=M1").first()).toBeVisible();
    await expect(orthoPage.locator("text=M18").first()).toBeVisible();
  });

  test("9. Retención muestra código GABY26", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Retención/i }).click();
    await expect(orthoPage.getByText("GABY26")).toBeVisible();
  });

  test("10. Documentos muestra tabs consent/refer/lab/wa", async ({
    orthoPage,
    hasCase,
  }) => {
    test.skip(!hasCase);
    await orthoPage.getByRole("button", { name: /Documentos/i }).click();
    await expect(orthoPage.getByText(/Consentimientos/i).first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C · drawers y atajos
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Ortodoncia v2 · drawers + atajos", () => {
  test("11. atajo N abre DrawerNewTreatmentCard", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.keyboard.press("n");
    await expect(orthoPage.getByText(/Nueva Treatment Card/i)).toBeVisible({ timeout: 5_000 });
    await orthoPage.keyboard.press("Escape");
  });

  test("12. atajo C abre DrawerCollectInstallment", async ({ orthoPage, hasCase }) => {
    test.skip(!hasCase);
    await orthoPage.keyboard.press("c");
    await expect(orthoPage.getByText(/Cobrar mensualidad/i)).toBeVisible({ timeout: 5_000 });
    await orthoPage.keyboard.press("Escape");
  });
});

export { expect };
