/**
 * B9 (QA ws1-t10) — el alta de paciente decía "Recordá pedirle el CURP…"
 * (voseo) en vez de "Recuerda…" (tuteo, el idioma visual del panel: español
 * neutro con TÚ, nunca voseo). Ronda 2 (decisión del gerente, 28-sep-2026):
 * se buscó voseo en TODA la app, no solo en el alta de paciente, y apareció
 * un segundo caso: `agenda.editApptModal.selectDoctor` ("Seleccioná un
 * doctor" → "Selecciona un doctor"). Este archivo guarda contra los dos Y
 * contra que vuelva a colarse un imperativo/presente en voseo ("Recordá",
 * "Fijate", "Tenés"…) en CUALQUIER clave del diccionario es.json.
 *
 * Run: npx tsx --test src/i18n/__tests__/voseo-alta-paciente.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import es from "../dictionaries/es.json";

// Palabras que terminan igual que un verbo en voseo ("está", "así", "país"…)
// pero no lo son: para no marcarlas en falso. "-rá/-rás/-rán" (futuro de
// cualquier verbo: infinitivo + desinencia, SIEMPRE con una r antes de la á)
// se filtra aparte, no aquí (ver FUTURO).
const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Sin acentos: se comparan contra `sinAcentos(limpia)` más abajo.
const FALSOS_POSITIVOS = new Set(
  [
    "esta", "este", "estes", "asi", "ademas", "seria", "podria", "deberia", "habria", "tendria", "haria",
    "aqui", "alli", "curp", "despues", "interes", "estres", "pais", "cafe", "traves", "jamas", "atras",
    "detras", "demas", "ingles", "frances",
  ].map(sinAcentos),
);
/** Futuro 3ª persona de CUALQUIER verbo: infinitivo (termina en r) + á. */
const FUTURO = /rá$/i;
/** Imperativo/presente en voseo rioplatense: "recordá", "fijate"→"fijá", "tenés", "vivís"… */
const VOSEO = /^[a-záéíóúñ]+(á|és|ís)$/i;

/** Todas las palabras que parecen voseo en un diccionario i18n, como {clave: "palabra en «frase»"}. */
function buscarVoseo(dic: Record<string, unknown>): string[] {
  const hallazgos: string[] = [];
  function recorrer(o: unknown, ruta: string) {
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) recorrer(v, `${ruta}.${k}`);
    } else if (typeof o === "string") {
      // Cualquier corrida de letras es una "palabra": no solo separadas por
      // espacio, también por "/" o "-" ("Antes/Después", "antes-después").
      for (const palabra of o.match(/[a-záéíóúñ]+/gi) ?? []) {
        if (FALSOS_POSITIVOS.has(sinAcentos(palabra))) continue;
        if (FUTURO.test(palabra)) continue;
        if (VOSEO.test(palabra)) hallazgos.push(`${ruta}: "${palabra}" en "${o}"`);
      }
    }
  }
  recorrer(dic, "");
  return hallazgos;
}

test("es.json completo: ningún texto usa voseo (el panel es tuteo en todo el idioma visual)", () => {
  const hallazgos = buscarVoseo(es as any);
  assert.deepEqual(hallazgos, []);
});

test("curpPendingHint dice «Recuerda», no «Recordá» (B9, ronda 1)", () => {
  assert.match((es as any).shell.newPatient.curpPendingHint, /Recuerda pedirle el CURP/);
  assert.doesNotMatch((es as any).shell.newPatient.curpPendingHint, /Recordá/);
});

test("editApptModal.selectDoctor dice «Selecciona», no «Seleccioná» (B9, ronda 2)", () => {
  assert.equal((es as any).agenda.editApptModal.selectDoctor, "Selecciona un doctor");
});
