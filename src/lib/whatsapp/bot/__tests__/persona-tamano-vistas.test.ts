/**
 * Contador de la persona del bot (ws1-t5, revisión en panel.108): el tope de
 * 12,000 solo se veía en la vista de siempre y casi todas las clínicas usan la
 * del rediseño. Los umbrales y textos viven en `avisoDeTamanoDePersona` y las
 * DOS vistas la pintan.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PERSONA_AVISO_CARACTERES,
  PERSONA_MAX_CARACTERES,
  avisoDeTamanoDePersona,
  errorDeTamanoDePersona,
} from "../ai-prompt";

const raiz = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

test("niveles: normal, aviso y tope, con el contador en formato es-MX", () => {
  const corta = avisoDeTamanoDePersona("Hola", null);
  assert.equal(corta.nivel, "normal");
  assert.equal(corta.aviso, null);
  assert.equal(corta.contador, "4 / 12,000 caracteres");

  assert.equal(avisoDeTamanoDePersona("x".repeat(PERSONA_AVISO_CARACTERES), null).nivel, "normal");
  const larga = avisoDeTamanoDePersona("x".repeat(PERSONA_AVISO_CARACTERES + 1), null);
  assert.equal(larga.nivel, "aviso");
  assert.match(larga.aviso!, /menos de 6,000/);

  assert.equal(avisoDeTamanoDePersona("x".repeat(PERSONA_MAX_CARACTERES), null).nivel, "aviso");
  const pasada = avisoDeTamanoDePersona("x".repeat(PERSONA_MAX_CARACTERES + 1), null);
  assert.equal(pasada.nivel, "tope");
  assert.equal(pasada.contador, "12,001 / 12,000 caracteres");
  assert.match(pasada.aviso!, /no se puede guardar así/);
});

test("una persona ya guardada más larga que el tope sigue funcionando y se dice así", () => {
  const guardada = "y".repeat(PERSONA_MAX_CARACTERES + 500);
  const t = avisoDeTamanoDePersona(`  ${guardada}\n`, guardada);
  assert.equal(t.nivel, "tope");
  assert.match(t.aviso!, /El bot las sigue usando tal cual/);
  // Y la API la deja pasar (mismo criterio: sin editar no se bloquea).
  assert.equal(errorDeTamanoDePersona(guardada, guardada), null);
  // Editada: el aviso de la pantalla y la API dicen que no.
  const editada = `${guardada}z`;
  assert.match(avisoDeTamanoDePersona(editada, guardada).aviso!, /no se puede guardar así/);
  assert.ok(errorDeTamanoDePersona(editada, guardada));
});

test("las dos vistas del bot pintan el contador con la MISMA función", () => {
  const vieja = leer("src/app/dashboard/whatsapp/bot/bot-client.tsx");
  const nueva = leer("src/components/dashboard/whatsapp-rediseno/bot.tsx");
  for (const [nombre, src] of [["bot-client.tsx", vieja], ["rediseno/bot.tsx", nueva]] as const) {
    assert.match(src, /import \{ avisoDeTamanoDePersona \} from "@\/lib\/whatsapp\/bot\/ai-prompt"/, nombre);
    assert.match(src, /avisoDeTamanoDePersona\(form\.persona, config\??\.persona\)/, nombre);
    // Ninguna repite el número a mano.
    assert.doesNotMatch(src, /12[,_]?000|6[,_]?000/, nombre);
  }
  // El rediseño con sus clases (tokens del módulo), no con estilos en línea.
  assert.match(nueva, /s\.contadorPersona/);
  assert.match(nueva, /s\.contadorTope/);
  assert.match(nueva, /s\.contadorAviso/);
  const css = leer("src/components/dashboard/whatsapp-rediseno/whatsapp-rediseno.module.css");
  assert.match(css, /\.contadorTope \{\s*color: var\(--danger-strong/);
  assert.match(css, /\.contadorAviso \{\s*color: var\(--warning-strong/);
  assert.match(css, /\.contadorPersona \{[^}]*color: var\(--m2-texto-3\)/);
});
