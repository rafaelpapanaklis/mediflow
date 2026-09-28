/**
 * B9 (QA ws1-t10) — el alta de paciente decía "Recordá pedirle el CURP…"
 * (voseo) en vez de "Recuerda…" (tuteo, el idioma visual del panel: español
 * neutro con TÚ, nunca voseo). Guarda contra que vuelva a colarse un
 * imperativo/presente en voseo ("Recordá", "Fijate", "Tenés"…) en las claves
 * de `shell.newPatient` (Pacientes → Nuevo paciente).
 *
 * Run: npx tsx --test src/i18n/__tests__/voseo-alta-paciente.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import es from "../dictionaries/es.json";

// Palabras que terminan igual que un verbo en voseo ("está", "así"…) pero
// no lo son: para no marcarlas en falso.
const FALSOS_POSITIVOS = /^(esta|est[aá]|as[ií]|adem[aá]s|ser[ií]a|podr[ií]a|deber[ií]a|habr[ií]a|tendr[ií]a|har[ií]a|aqu[ií]|all[ií]|curp)$/i;

test("shell.newPatient: ninguna clave usa voseo (el panel es tuteo en todo el idioma visual)", () => {
  const sección = (es as any).shell.newPatient as Record<string, unknown>;
  const conVoseo: string[] = [];
  for (const [clave, valor] of Object.entries(sección)) {
    if (typeof valor !== "string") continue;
    for (const palabra of valor.split(/\s+/)) {
      const limpia = palabra.replace(/[^a-záéíóúñ]/gi, "");
      if (!limpia) continue;
      if (FALSOS_POSITIVOS.test(limpia)) continue;
      if (/^[a-záéíóúñ]+(á|és|ís)$/i.test(limpia) || /^vos$/i.test(limpia)) conVoseo.push(`${clave}: "${palabra}" en "${valor}"`);
    }
  }
  assert.deepEqual(conVoseo, []);
});

test("curpPendingHint dice «Recuerda», no «Recordá»", () => {
  assert.match((es as any).shell.newPatient.curpPendingHint, /Recuerda pedirle el CURP/);
  assert.doesNotMatch((es as any).shell.newPatient.curpPendingHint, /Recordá/);
});
