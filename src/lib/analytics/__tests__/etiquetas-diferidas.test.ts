/**
 * Etiquetas diferidas del layout (12-oct-2026, ws1-t4, punto 3a del encargo de
 * ws7). Run: npm run test:portada-seo (va junto a las pruebas de SEO).
 *
 * Fallan con el código anterior: no existía etiquetas-diferidas.ts y el layout
 * pedía gtag.js y fbevents.js con `afterInteractive` (en cuanto hidrataba).
 *
 * El script se ejecuta en un `vm` con un window/document de mentira que
 * registra los <script> que se añaden al <head> y los listeners.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import vm from "node:vm";
import { URL_FBEVENTS, URL_GTAG, scriptEtiquetasDiferidas } from "../etiquetas-diferidas";
import { GA4_MEASUREMENT_ID } from "../ga4";
import { META_PIXEL_ID } from "../meta-pixel";

const aqui = dirname(fileURLToPath(import.meta.url));
/** Los valores nacen en otro contexto de vm (otro Array/Object): se comparan por JSON. */
const igual = (a: unknown, b: unknown, msg?: string) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

type Ventana = {
  dataLayer?: IArguments[];
  gtag?: (...a: unknown[]) => void;
  fbq?: { (...a: unknown[]): void; queue: IArguments[] };
  __dcDiferir?: (f: () => void) => void;
  scripts: string[];
  listeners: Record<string, Array<() => void>>;
  idle: Array<() => void>;
  disparar: (ev: string) => void;
};

function arrancar(pathname: string, readyState = "loading"): Ventana {
  const w: Ventana = {
    scripts: [],
    listeners: {},
    idle: [],
    disparar(ev) { (w.listeners[ev] ?? []).splice(0).forEach((f) => f()); },
  };
  const ctx = {
    window: w,
    location: { pathname },
    document: {
      readyState,
      head: { appendChild: (s: { src: string }) => w.scripts.push(s.src) },
      createElement: () => ({} as { src: string }),
    },
    setTimeout: () => 0,
  };
  Object.assign(w, {
    addEventListener: (ev: string, f: () => void) => { (w.listeners[ev] ??= []).push(f); },
    requestIdleCallback: (f: () => void) => { w.idle.push(f); return 1; },
  });
  vm.runInNewContext(scriptEtiquetasDiferidas(), ctx);
  return w;
}

describe("etiquetas diferidas", () => {
  it("define gtag y fbq al instante (encolan) pero NO pide gtag.js ni fbevents.js hasta estar ocioso", () => {
    const w = arrancar("/");
    assert.equal(typeof w.gtag, "function");
    assert.equal(typeof w.fbq, "function");
    assert.deepEqual(w.scripts, []);
    const configs = w.dataLayer!.map((a) => Array.from(a));
    igual(configs[1], ["config", "AW-18276007996"]);
    igual(configs[2], ["config", GA4_MEASUREMENT_ID, { send_page_view: false }]);
    igual(Array.from(w.fbq!.queue[0]), ["init", META_PIXEL_ID]);

    // un evento mandado antes de que llegue el script no se pierde: queda en la cola
    w.gtag!("event", "sign_up", { send_to: GA4_MEASUREMENT_ID });
    w.fbq!("track", "PageView");
    igual(Array.from(w.dataLayer!.at(-1)!), ["event", "sign_up", { send_to: GA4_MEASUREMENT_ID }]);
    igual(Array.from(w.fbq!.queue.at(-1)!), ["track", "PageView"]);

    // load → idle → se piden los dos, una sola vez
    w.disparar("load");
    assert.deepEqual(w.scripts, []);
    w.idle.splice(0).forEach((f) => f());
    igual(w.scripts, [URL_GTAG, URL_FBEVENTS]);
    w.disparar("pointerdown");
    assert.equal(w.scripts.length, 2);
  });

  it("el primer gesto del usuario adelanta la carga (sin esperar a load)", () => {
    const w = arrancar("/");
    w.disparar("touchstart");
    igual(w.scripts, [URL_GTAG, URL_FBEVENTS]);
    // lo que se registre después corre en seguida
    let corrio = false;
    w.__dcDiferir!(() => { corrio = true; });
    assert.equal(corrio, true);
  });

  it("en rutas privadas: Ads sí, GA4 no, fbq no existe", () => {
    for (const ruta of ["/dashboard", "/admin/marketing", "/paciente", "/portal/x", "/afiliados/panel"]) {
      const w = arrancar(ruta, "complete");
      assert.equal(w.fbq, undefined, ruta);
      const ids = w.dataLayer!.filter((a) => a[0] === "config").map((a) => a[1]);
      igual(ids, ["AW-18276007996"], ruta);
      w.idle.splice(0).forEach((f) => f());
      igual(w.scripts, [URL_GTAG], ruta);
    }
  });

  it("el layout usa este script y ya no carga gtag.js ni el snippet de Meta con afterInteractive", () => {
    const layout = readFileSync(join(aqui, "../../../app/layout.tsx"), "utf8");
    assert.ok(layout.includes("scriptEtiquetasDiferidas()"));
    assert.ok(!layout.includes("googletagmanager.com/gtag/js"), "gtag.js sigue como <Script src> en el layout");
    assert.ok(!layout.includes("connect.facebook.net"), "el snippet de Meta sigue inline en el layout");
  });
});
