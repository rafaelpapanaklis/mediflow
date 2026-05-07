import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.MEDIFLOW_E2E_BASE_URL ?? "https://mediflow-pi.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests E2E corren en serie contra prod/preview real. Paralelizar arriesga
  // rate limits y rompe el orden patient/setup.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1920, height: 1080 },
    // Tiempo extra porque el dashboard tiene mucha data inicial.
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Override del default 1280×720 — el rediseño Ortodoncia espera
        // viewport ≥1440 para que el grid 220+1fr+320 + sub-sidebar + right
        // rail no colapse. Tests al 1920×1080 reproducen el monitor del doctor.
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
