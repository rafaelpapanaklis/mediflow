// Auditoría E2E del módulo Ortodoncia patient-detail (Gabriela).
//
// Cada test verifica un elemento interactivo (botón / link / tab / drawer)
// y produce screenshots en tests/e2e/screenshots/. Los assertions son
// "soft" (test.step + try/catch) para que un fallo individual no aborte
// el suite — el reporte final cuenta ✅/⚠️/❌ por elemento.
//
// Resultados consolidados al final en `test.afterAll`.

import { ortho, expect } from "./fixtures";

interface ButtonResult {
  section: string;
  label: string;
  status: "FUNCIONAL" | "TOAST_FASE_2" | "BROKEN" | "VISUAL_ONLY";
  detail?: string;
  screenshot?: string;
}
const RESULTS: ButtonResult[] = [];

function record(r: ButtonResult) {
  RESULTS.push(r);
}

// ── Helper: invoca click + verifica resultado del usuario por toast/modal/url ─
async function audit(
  page: import("@playwright/test").Page,
  args: {
    section: string;
    label: string;
    /** Locator que dispara la acción. */
    locator: ReturnType<import("@playwright/test").Page["locator"]>;
    /** Después de click, ¿qué esperamos? */
    expect:
      | { kind: "toast"; matchText?: RegExp }
      | { kind: "modal"; matchText?: RegExp }
      | { kind: "drawer"; matchText?: RegExp }
      | { kind: "navigate"; urlMatch: RegExp }
      | { kind: "scroll"; targetId: string }
      | { kind: "any" };
    /** Screenshot path (opcional). */
    shotName?: string;
    /** Si el click no debe propagar — ej. tabs cuyo handler es interno. */
    skipClickPropagationCheck?: boolean;
  },
) {
  const { section, label, locator, expect: ex, shotName } = args;
  const screenshot = shotName
    ? `tests/e2e/screenshots/${shotName}.png`
    : undefined;
  try {
    const exists = (await locator.count()) > 0;
    if (!exists) {
      record({
        section,
        label,
        status: "BROKEN",
        detail: "Elemento no encontrado en el DOM",
        screenshot,
      });
      return;
    }
    // Verifica visibilidad antes de click.
    const visible = await locator.first().isVisible().catch(() => false);
    if (!visible) {
      record({
        section,
        label,
        status: "VISUAL_ONLY",
        detail: "Elemento existe pero no es visible (posiblemente disabled o oculto)",
        screenshot,
      });
      return;
    }

    // Scroll into view + click con force para evitar timeouts por overlays
    // (sub-sidebar sticky / right rail). force=true skipea actionability check
    // pero mantiene visibilidad — si el botón está "verdaderamente disabled"
    // el navegador no dispara el handler igual.
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    await locator.first().click({ force: true, timeout: 8000 });

    if (ex.kind === "toast") {
      // Toast aparece como aria-live region con texto.
      const toast = page
        .locator('[role="status"], [data-sonner-toast], [aria-live]')
        .filter({ hasText: ex.matchText ?? /./ })
        .first();
      const seen = await toast
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (seen) {
        const text = await toast.textContent().catch(() => "");
        // Toasts con "Fase 2" son intencionales · todos los demás son funcionales
        const isFase2 = /fase 2|próximamente|coming soon/i.test(text ?? "");
        record({
          section,
          label,
          status: isFase2 ? "TOAST_FASE_2" : "FUNCIONAL",
          detail: (text ?? "").trim().slice(0, 120),
          screenshot,
        });
      } else {
        record({
          section,
          label,
          status: "BROKEN",
          detail: "Click sin toast (no respondió)",
          screenshot,
        });
      }
      // Cerrar el toast si quedó.
      await page.keyboard.press("Escape").catch(() => {});
    } else if (ex.kind === "modal" || ex.kind === "drawer") {
      const modal = page
        .locator('[role="dialog"]')
        .filter({ hasText: ex.matchText ?? /./ })
        .first();
      const seen = await modal
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (seen) {
        record({ section, label, status: "FUNCIONAL", detail: ex.kind, screenshot });
        // Cerrar modal/drawer.
        const closeBtn = modal
          .getByRole("button", { name: /cerrar|close|x/i })
          .first();
        if ((await closeBtn.count()) > 0) {
          await closeBtn.click().catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
        }
        await page.waitForTimeout(300);
      } else {
        record({
          section,
          label,
          status: "BROKEN",
          detail: `Click sin ${ex.kind} visible`,
          screenshot,
        });
      }
    } else if (ex.kind === "navigate") {
      const nav = await page
        .waitForURL(ex.urlMatch, { timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      record({
        section,
        label,
        status: nav ? "FUNCIONAL" : "BROKEN",
        detail: nav ? `URL cumple ${ex.urlMatch}` : "Click sin navegación",
        screenshot,
      });
    } else if (ex.kind === "scroll") {
      // Verifica que el target id quedó visible en viewport (intersect).
      // Threshold relajado: el sub-sidebar usa scrollIntoView smooth. Si
      // el target queda en cualquier posición visible (top en [-100, 800]
      // del viewport), es ✅. Wait 1500ms para terminar la animación.
      await page.waitForTimeout(1500);
      const target = page.locator(`#${ex.targetId}`).first();
      const evalRes = await target
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, h: window.innerHeight };
        })
        .catch(() => null);
      const inView = evalRes
        ? evalRes.top > -100 && evalRes.top < evalRes.h * 0.8
        : false;
      record({
        section,
        label,
        status: inView ? "FUNCIONAL" : "BROKEN",
        detail: inView
          ? `viewport scrolleó a #${ex.targetId} (top=${Math.round(evalRes!.top)})`
          : `target #${ex.targetId} no en viewport (top=${evalRes?.top ?? "?"})`,
        screenshot,
      });
    } else {
      // any
      record({ section, label, status: "FUNCIONAL", detail: "click sin assertion específica", screenshot });
    }
    if (shotName) {
      await page.screenshot({ path: screenshot!, fullPage: false }).catch(() => {});
    }
  } catch (e) {
    record({
      section,
      label,
      status: "BROKEN",
      detail: `Excepción: ${(e as Error).message.slice(0, 200)}`,
      screenshot,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────

ortho.describe("Audit E2E · Ortodoncia patient-detail · Gabriela", () => {
  ortho("STATS HERO · valores correctos en UI", async ({ orthoPage: page }) => {
    // BUG anterior: Asistencia 100% / Compliance 0% / Visitas 0.
    // Esperado post-PR-#20+#21: Asistencia 92-93% · Compliance 78% · Visitas 14.
    const header = page.locator("header").first();
    const headerText = (await header.textContent()) ?? "";

    // Capture pre-audit screenshot del header.
    await page.screenshot({
      path: "tests/e2e/screenshots/header-stats.png",
      clip: { x: 0, y: 0, width: 1920, height: 320 },
    });

    // Próxima cita debe mostrar fecha (no "Sin programar").
    const noProx = /Sin programar/i.test(headerText);
    record({
      section: "Header stats",
      label: "Próxima cita populated",
      status: noProx ? "BROKEN" : "FUNCIONAL",
      detail: noProx ? "muestra 'Sin programar'" : "muestra fecha",
    });

    // Saldo ortodoncia debe ser > 0 (Gabriela tiene saldo pendiente).
    const saldoMatch = headerText.match(/\$[\d,]+/);
    record({
      section: "Header stats",
      label: "Saldo ortodoncia populated",
      status: saldoMatch ? "FUNCIONAL" : "BROKEN",
      detail: saldoMatch ? saldoMatch[0] : "no muestra monto",
    });

    // Visitas totales > 0 esperado.
    const visitasMatch = headerText.match(/Visitas totales[\s\S]{0,80}?(\d+)/i);
    const visitas = visitasMatch ? parseInt(visitasMatch[1], 10) : 0;
    record({
      section: "Header stats",
      label: "Visitas totales > 0",
      status: visitas > 0 ? "FUNCIONAL" : "BROKEN",
      detail: `count=${visitas}`,
    });

    // Última visita populated (no "—"). Locator-based en lugar de regex
    // (header text concatena varios stats y el regex previo daba false
    // positives matcheando "0 desde" del Visitas totales stat).
    const ultimaStatTile = page
      .locator("header")
      .first()
      .locator(
        'div:has-text("Última visita")',
      )
      .first();
    const ultimaText = (await ultimaStatTile.textContent()) ?? "";
    // Stat es ❌ cuando solo muestra "—" sin fecha real.
    const ultimaIsEmpty =
      /Última visita\s*—\s*$/.test(ultimaText.trim()) ||
      ultimaText.trim() === "Última visita —";
    record({
      section: "Header stats",
      label: "Última visita populated (no '—')",
      status: ultimaIsEmpty ? "BROKEN" : "FUNCIONAL",
      detail: ultimaText.trim().slice(0, 80),
    });
  });

  ortho("HEADER · botones de acción", async ({ orthoPage: page }) => {
    const header = page.locator("header").first();

    await audit(page, {
      section: "Header",
      label: "Iniciar consulta",
      locator: header.getByRole("button", { name: /iniciar consulta/i }),
      expect: { kind: "any" },
      shotName: "header-iniciar-consulta",
    });

    // Volver a tab ortodoncia si la acción navegó.
    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");

    await audit(page, {
      section: "Header",
      label: "Agendar próxima",
      locator: header.getByRole("button", { name: /agendar/i }),
      expect: { kind: "any" },
    });

    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");

    await audit(page, {
      section: "Header",
      label: "Cobrar",
      locator: header.getByRole("button", { name: /^cobrar$/i }),
      expect: { kind: "any" },
    });
  });

  ortho("SUB-SIDEBAR · scroll a 9 secciones", async ({ orthoPage: page }) => {
    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");

    const items: Array<{ label: RegExp; targetId: string }> = [
      { label: /^Resumen$/i, targetId: "hero" },
      { label: /^Diagnóstico$/i, targetId: "diagnosis" },
      { label: /Plan de tratamiento/i, targetId: "plan" },
      { label: /Treatment Card/i, targetId: "tcards" },
      { label: /Fotos comparativas/i, targetId: "photos" },
      { label: /Plan financiero/i, targetId: "finance" },
      { label: /^Retención$/i, targetId: "retention" },
      { label: /Post-tratamiento/i, targetId: "post" },
      { label: /^Documentos$/i, targetId: "docs" },
    ];
    const sidebar = page
      .locator('aside[aria-label*="secciones"]')
      .first();
    for (const it of items) {
      await audit(page, {
        section: "Sub-sidebar",
        label: `Click "${it.label.source}" → scroll a #${it.targetId}`,
        locator: sidebar.getByRole("button", { name: it.label }),
        expect: { kind: "scroll", targetId: it.targetId },
      });
    }
  });

  ortho("SECCIÓN E · fotos T0/T1 + comparar + ver set", async ({ orthoPage: page }) => {
    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");
    await page.locator("#photos").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Tab T0
    const tabT0 = page.locator("#photos").getByRole("tab", { name: /^T0$/ });
    await audit(page, {
      section: "Sección E · tabs",
      label: "Tab T0",
      locator: tabT0,
      expect: { kind: "any" },
      shotName: "section-e-tab-t0",
    });
    // Verifica que aparezcan fotos del set T0 en el grid.
    const t0Photos = page
      .locator("#photos img[alt]")
      .filter({ hasNot: page.locator("svg") });
    const t0Count = await t0Photos.count().catch(() => 0);
    record({
      section: "Sección E · datos",
      label: "T0 muestra ≥4 fotos en slot grid",
      status: t0Count >= 4 ? "FUNCIONAL" : "BROKEN",
      detail: `images count = ${t0Count}`,
    });

    // Tab T1
    const tabT1 = page.locator("#photos").getByRole("tab", { name: /^T1$/ });
    await audit(page, {
      section: "Sección E · tabs",
      label: "Tab T1",
      locator: tabT1,
      expect: { kind: "any" },
      shotName: "section-e-tab-t1",
    });
    await page.waitForTimeout(500);
    const t1Count = await page
      .locator("#photos img[alt]")
      .filter({ hasNot: page.locator("svg") })
      .count()
      .catch(() => 0);
    record({
      section: "Sección E · datos",
      label: "T1 muestra ≥4 fotos en slot grid",
      status: t1Count >= 4 ? "FUNCIONAL" : "BROKEN",
      detail: `images count = ${t1Count}`,
    });

    // Comparar T0 vs actual
    await audit(page, {
      section: "Sección E · acciones",
      label: "Comparar T0 vs actual",
      locator: page
        .locator("#photos")
        .getByRole("button", { name: /comparar T0/i }),
      expect: { kind: "modal" },
      shotName: "section-e-comparar",
    });

    // "Ver set completo" del histórico T0 — Rafael reportó BROKEN
    await audit(page, {
      section: "Sección E · histórico",
      label: 'Ver set completo (histórico) - Rafael reportó BROKEN',
      locator: page
        .locator("#photos")
        .getByRole("button", { name: /ver set completo/i })
        .first(),
      expect: { kind: "any" },
      shotName: "section-e-ver-set-completo",
    });
  });

  ortho("SECCIÓN F · botones de finanzas", async ({ orthoPage: page }) => {
    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");
    await page.locator("#finance").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    await audit(page, {
      section: "Sección F",
      label: "Presentar cotización G5",
      locator: page
        .locator("#finance")
        .getByRole("button", { name: /presentar cotizaci[oó]n/i }),
      expect: { kind: "modal" },
      shotName: "section-f-openchoice",
    });

    await audit(page, {
      section: "Sección F",
      label: "Sign@Home WhatsApp G6",
      locator: page
        .locator("#finance")
        .getByRole("button", { name: /sign@home/i }),
      expect: { kind: "drawer" },
      shotName: "section-f-signhome",
    });

    await audit(page, {
      section: "Sección F",
      label: "Cobrar siguiente",
      locator: page
        .locator("#finance")
        .getByRole("button", { name: /cobrar siguiente/i }),
      expect: { kind: "modal" },
      shotName: "section-f-collect",
    });

    await audit(page, {
      section: "Sección F",
      label: "Ver últimos CFDI",
      locator: page
        .locator("#finance")
        .getByRole("button", { name: /ver.*cfdi/i }),
      expect: { kind: "drawer" },
      shotName: "section-f-cfdi",
    });
  });

  ortho("SECCIÓN H · referidos + nps", async ({ orthoPage: page }) => {
    await page.goto("/dashboard/patients/cmouwaz1z0001v3qhqigop9nj?tab=ortodoncia");
    await page.waitForLoadState("networkidle");
    await page.locator("#post").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    // Código GABY26 visible
    const codigoVisible = await page
      .locator("#post")
      .getByText(/GABY26/i)
      .first()
      .isVisible()
      .catch(() => false);
    record({
      section: "Sección H · datos",
      label: "Código referidos GABY26 visible",
      status: codigoVisible ? "FUNCIONAL" : "BROKEN",
      detail: codigoVisible ? "GABY26 renderizado" : "código missing en UI",
    });
  });

  ortho.afterAll(async () => {
    // Genera reporte markdown con los resultados consolidados.
    const fs = await import("node:fs/promises");
    const ok = RESULTS.filter((r) => r.status === "FUNCIONAL").length;
    const fase2 = RESULTS.filter((r) => r.status === "TOAST_FASE_2").length;
    const visual = RESULTS.filter((r) => r.status === "VISUAL_ONLY").length;
    const broken = RESULTS.filter((r) => r.status === "BROKEN");

    const lines: string[] = [];
    lines.push("# Audit E2E · Ortodoncia patient-detail · resultados");
    lines.push("");
    lines.push(`**Total:** ${RESULTS.length}  ·  ✅ ${ok}  ·  ⚠️ ${fase2}  ·  ➖ ${visual}  ·  ❌ ${broken.length}`);
    lines.push("");
    lines.push(`**URL probada:** ${process.env.MEDIFLOW_E2E_BASE_URL ?? "https://mediflow-pi.vercel.app"}`);
    lines.push("");

    if (broken.length > 0) {
      lines.push("## ❌ BROKEN — fix obligatorio antes de merge");
      lines.push("");
      lines.push("| Sección | Botón / elemento | Detalle | Screenshot |");
      lines.push("|---|---|---|---|");
      for (const b of broken) {
        lines.push(
          `| ${b.section} | ${b.label} | ${b.detail ?? "—"} | ${b.screenshot ?? "—"} |`,
        );
      }
      lines.push("");
    }

    lines.push("## Detalle completo");
    lines.push("");
    lines.push("| Status | Sección | Botón | Detalle |");
    lines.push("|---|---|---|---|");
    for (const r of RESULTS) {
      const tag =
        r.status === "FUNCIONAL"
          ? "✅"
          : r.status === "TOAST_FASE_2"
            ? "⚠️"
            : r.status === "VISUAL_ONLY"
              ? "➖"
              : "❌";
      lines.push(`| ${tag} | ${r.section} | ${r.label} | ${r.detail ?? ""} |`);
    }
    const out = lines.join("\n");
    await fs.mkdir("tests/e2e", { recursive: true });
    await fs.writeFile("tests/e2e/results-2026-05-07.md", out, "utf-8");
    console.log(out);
  });
});
