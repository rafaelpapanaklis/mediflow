// Debug · captura full screenshot de PatientHeaderG16 + SectionHero
// para inspeccionar visualmente qué stats están renderizando.
import { ortho, expect } from "./fixtures";

ortho("DEBUG · screenshots de stats hero", async ({ orthoPage: page }) => {
  await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  // Screenshot del header (PatientHeaderG16) — top 320px del viewport
  await page.screenshot({
    path: "tests/e2e/screenshots/debug-header.png",
    clip: { x: 0, y: 0, width: 1920, height: 320 },
  });

  // Screenshot de Sección A (SectionHero) — scroll a ella
  await page.locator("#hero").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "tests/e2e/screenshots/debug-section-hero.png",
    clip: { x: 0, y: 0, width: 1920, height: 800 },
  });

  // Captura el text content del header completo
  const headerText = (await page.locator("header").first().textContent()) ?? "";
  console.log("\n=== HEADER FULL TEXT (PatientHeaderG16) ===");
  console.log(headerText.replace(/\s+/g, " ").slice(0, 500));

  // Captura el text content de SectionHero
  const sectionHeroText = (await page.locator("#hero").textContent()) ?? "";
  console.log("\n=== SECTION HERO TEXT (Sección A) ===");
  console.log(sectionHeroText.replace(/\s+/g, " ").slice(0, 500));

  // Captura RightRail next-appointment doctor
  const rightRailText = (await page.locator("aside").last().textContent()) ?? "";
  console.log("\n=== RIGHT RAIL TEXT (sidebar derecha) ===");
  console.log(rightRailText.replace(/\s+/g, " ").slice(0, 600));

  expect(true).toBe(true);
});
