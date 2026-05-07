// Test focal · debugging Sección F · ¿por qué los modales no abren?
import { ortho, expect } from "./fixtures";

ortho("DEBUG · Sección F botones — screenshots detallados", async ({ orthoPage: page }) => {
  await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);

  await page.locator("#finance").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // BEFORE: full page screenshot del estado inicial.
  await page.screenshot({
    path: "tests/e2e/screenshots/debug-finance-before.png",
    fullPage: true,
  });

  // Capture all console errors during test
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  // Click "Presentar cotización G5"
  const presentar = page
    .locator("#finance")
    .getByRole("button", { name: /presentar cotizaci[oó]n/i })
    .first();
  await presentar.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // Capture button bbox + visibility before click
  const bbox = await presentar.boundingBox().catch(() => null);
  console.log("Presentar cotización bbox:", bbox);
  console.log("Visible:", await presentar.isVisible());
  console.log("Enabled:", await presentar.isEnabled());

  await presentar.click({ force: true });
  await page.waitForTimeout(2000);

  // AFTER: ¿hay dialog? ¿toast? ¿qué pasó?
  await page.screenshot({
    path: "tests/e2e/screenshots/debug-finance-after-click.png",
    fullPage: false,
  });

  const dialogCount = await page.locator('[role="dialog"]').count();
  const toastTexts = await page
    .locator('[role="status"], [data-sonner-toast], [aria-live]')
    .allTextContents()
    .catch(() => []);
  console.log("Dialogs after click:", dialogCount);
  console.log("Toasts after click:", toastTexts);
  console.log("Console errors:", errors);

  // Si hay dialog abierto, captura su contenido
  if (dialogCount > 0) {
    const dialog = page.locator('[role="dialog"]').first();
    const text = await dialog.textContent();
    console.log("Dialog content (200 chars):", text?.slice(0, 200));
  }

  // Verifica también el state del store visual: ¿se renderizó algún kind="openchoice"?
  const html = await page.content();
  const hasOpenChoice = /openchoice|ModalOpenChoice|escenario/i.test(html);
  console.log("HTML contains openchoice/scenario:", hasOpenChoice);

  expect(true).toBe(true); // No assertion — solo capture
});
