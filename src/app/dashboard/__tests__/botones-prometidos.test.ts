/**
 * BOTONES QUE PROMETÍAN Y NO CUMPLÍAN — hallazgos 27, 34, 43, y la interfaz de
 * 25 y 29 (WS1-T5).
 *
 * Run: npm run test:botones-prometidos
 *
 * Por qué se prueba leyendo el código fuente y no montando React: son fallos de
 * CABLEADO —una ruta mal escrita, un endpoint que no existe, un `onClick` que
 * falta—, y el cableado se ve en el archivo. Es la misma técnica que ya usa
 * src/lib/auth/__tests__/endpoint-permission-gates.test.ts para vigilar que
 * cada endpoint llame a su gate. Un test de render no encontraría nada más y
 * costaría un renderer entero; estos fallos, en cambio, vuelven en cuanto
 * alguien reescriba la línea, y esto los caza.
 *
 * Cada bloque dice qué se rompió y en qué queda.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");            // src/
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const hay  = (rel: string) => existsSync(join(SRC, rel));

/**
 * El archivo SIN comentarios. Las comprobaciones en negativo —"esta llamada ya
 * no está", "ese almacén no se usa"— tienen que mirar el código y no la prosa:
 * si no, el propio comentario que explica el arreglo ("antes iba a X, ahora
 * no") hace fallar al test que vigila que ya no vaya a X.
 */
function codigo(rel: string): string {
  return leer(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")                    // bloques /* … */ y /** … */
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))                 // líneas de comentario
    .join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 27 — "Agregar" de Lista de espera: 404 por una letra
// ═══════════════════════════════════════════════════════════════════════════
test("h27 · Lista de espera apunta a /dashboard/walk-in, que existe", () => {
  const src = leer("components/dashboard/home/home-receptionist.tsx");
  const codigoSolo = codigo("components/dashboard/home/home-receptionist.tsx");

  // La ruta mala: /dashboard/walkin (sin guion). Alimentaba los DOS botones de
  // la tarjeta —"Agregar" y el CTA del estado vacío— desde el inicio de
  // recepción, todos los días.
  assert.ok(
    !/["'`]\/dashboard\/walkin\b/.test(codigoSolo),
    "sigue apuntando a /dashboard/walkin, que no existe",
  );
  const destino = src.match(/router\.push\(["'`](\/dashboard\/walk-in[^"'`]*)["'`]\)/);
  assert.ok(destino, "la tarjeta de lista de espera debe llevar a /dashboard/walk-in");

  // Y la página a la que lleva tiene que estar de verdad en el árbol.
  assert.ok(hay("app/dashboard/walk-in/page.tsx"), "falta la página /dashboard/walk-in");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 34 — "Marcar sesión" de Paquetes: el contador 3/10 no avanzaba
// ═══════════════════════════════════════════════════════════════════════════
test("h34 · Marcar sesión llama a un endpoint que EXISTE, con su verbo", () => {
  const src = leer("app/dashboard/packages/packages-client.tsx");

  // La ruta que se llamaba antes no existió nunca: bajo src/app/api/packages
  // solo hay route.ts, [id]/route.ts y redeem/route.ts.
  assert.ok(
    !/packages\/redemptions\//.test(codigo("app/dashboard/packages/packages-client.tsx")),
    "sigue llamando a /api/packages/redemptions/[id]/use-session, que no existe",
  );
  assert.ok(!hay("app/api/packages/redemptions"), "no existe la carpeta redemptions");

  const handler = src.slice(src.indexOf("async function handleMarkSession"));
  const bloque = handler.slice(0, handler.indexOf("\n  }"));
  assert.match(bloque, /["'`]\/api\/packages\/redeem["'`]/, "debe usar /api/packages/redeem");
  assert.match(bloque, /method:\s*["'`]PATCH["'`]/, "descontar una sesión es el PATCH");
  assert.match(bloque, /redeemId/, "el cuerpo va con { redeemId }");

  // Y ese endpoint tiene que exponer el PATCH que se le pide.
  const redeem = leer("app/api/packages/redeem/route.ts");
  assert.match(redeem, /export async function PATCH/);
  assert.match(redeem, /redeemId/);
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 43 — seis botones sin onClick, con cursor de mano y hover de marca
// ═══════════════════════════════════════════════════════════════════════════

/** ¿La etiqueta <button …> que contiene `ancla` trae un onClick? */
function botonConAncla(src: string, ancla: string): string | null {
  const i = src.indexOf(ancla);
  if (i === -1) return null;
  const abre = src.lastIndexOf("<button", i);
  const cierra = src.indexOf("</button>", i);
  return abre === -1 || cierra === -1 ? null : src.slice(abre, cierra);
}

test("h43 · Asistente IA: Compartir, Más y Adjuntar se quitaron; Exportar funciona", () => {
  const src = leer("app/dashboard/ai-assistant/ai-assistant-client.tsx");

  // Se QUITAN. "Adjuntar archivo" prometía un flujo entero que no existe
  // (subida, almacenamiento y envío del archivo al modelo). "Compartir"
  // prometía un enlace público a una conversación clínica —permisos,
  // caducidad, PHI fuera de la clínica— y detrás no había nada. "Más" era un
  // menú de desbordamiento sin menú, y lo único que habría contenido —nueva
  // conversación— ya está al lado.
  for (const [icono, nombre] of [
    ["<Paperclip", "Adjuntar archivo"],
    ["<Share2", "Compartir"],
    ["<MoreHorizontal", "Más"],
  ] as const) {
    assert.ok(
      !codigo("app/dashboard/ai-assistant/ai-assistant-client.tsx").includes(icono),
      `"${nombre}" sigue pintándose y no hace nada`,
    );
  }

  // Se IMPLEMENTA: los turnos ya están en memoria, así que exportar es un
  // volcado a un archivo y cabe entero en el cliente.
  const exportar = botonConAncla(src, "<Download");
  assert.ok(exportar, "el botón Exportar debe seguir existiendo");
  assert.match(exportar, /onClick=\{exportConversation\}/, "Exportar sin handler");
  assert.match(src, /const exportConversation = useCallback/, "falta el handler de Exportar");
  // El archivo sale del panel a la máquina del doctor: tiene que decir que es
  // apoyo de IA y no una nota clínica.
  assert.match(src, /No es una nota clínica/, "el volcado debe llevar el aviso");
});

test("h43 · Radiografías: Voltear horizontal y Por severidad ya hacen algo", () => {
  const src = leer("app/dashboard/xrays/xrays-client.tsx");

  const voltear = botonConAncla(src, "<FlipHorizontal");
  assert.ok(voltear, "falta el botón Voltear horizontal");
  assert.match(voltear, /onClick=/, "Voltear horizontal sigue sin onClick");
  assert.match(voltear, /aria-pressed=/, "es un interruptor: debe decir si está puesto");
  // Y voltear tiene que llegar de verdad a la imagen, en el mismo transform que
  // el zoom y la rotación, para que las anotaciones se espejen con ella.
  assert.match(src, /transform:.*scaleX\(-1\)/, "el volteo no llega al visor");
  // Y voltear no puede convertirse en un fallo peor que el botón muerto:
  // `getBoundingClientRect` da la caja EN PANTALLA, así que sobre una imagen
  // espejada hay que deshacer el espejo o la marca cae en el diente contrario.
  assert.match(src, /const x = flipped \? 1 - sx : sx/,
    "medir o anotar sobre una radiografía volteada colocaría la marca espejada");

  const severidad = botonConAncla(src, 'pages.xrays.bySeverity');
  assert.ok(severidad, "falta el botón Por severidad");
  assert.match(severidad, /onClick=/, "Por severidad sigue sin onClick");
  assert.match(src, /listedFindings/, "la lista debe consumir el orden elegido");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 25 (interfaz) — la pantalla deja de prometer lo que la ley no permite
// ═══════════════════════════════════════════════════════════════════════════
test("h25 · con la nota firmada no hay formulario editable ni botón de guardar", () => {
  const src = leer("components/clinical/dental-form.tsx");

  assert.match(src, /const isLocked = isEditing && initialSpec\.status === "SIGNED"/,
    "el form tiene que saber que la nota está firmada");
  // Un <fieldset disabled> apaga de una vez todos los controles nativos.
  assert.match(src, /<fieldset\s*\n?\s*disabled=\{isLocked\}/,
    "el cuerpo del form debe quedar deshabilitado");
  // El botón "Guardar cambios" era la promesa imposible: no se pinta.
  assert.match(src, /\{!isLocked && \(\s*\n\s*<div style=\{\{ display: "flex", justifyContent: "flex-end"/,
    "el botón de guardar no puede pintarse sobre una nota firmada");
  // El odontograma no se pinta con controles de formulario: `disabled` no le
  // llega y hay que quitarle los clics a mano.
  assert.match(src, /pointerEvents: isLocked \? "none" : undefined/,
    "el odontograma seguiría aceptando marcas que nunca se guardan");
  // Y el submit por tecla Enter tampoco puede colarse.
  assert.match(src, /async function handleSave\(\) \{[\s\S]{0,400}?if \(isLocked\) return;/,
    "handleSave debe cortar en seco si la nota está firmada");

  // El camino que sí existe, cableado a su ruta.
  assert.match(src, /\/api\/clinical-notes\/\$\{initialRecord\.id\}\/addendum/,
    "falta el cableado de la adenda");
  assert.ok(hay("app/api/clinical-notes/[id]/addendum/route.ts"), "falta la ruta de adenda");
});

// ═══════════════════════════════════════════════════════════════════════════
// HALLAZGO 29 — recargar a media consulta ya no borra lo escrito
// ═══════════════════════════════════════════════════════════════════════════
test("h29 · hay borrador local de la consulta, y vive donde debe", () => {
  const src = leer("components/clinical/dental-form.tsx");

  assert.match(src, /sessionStorage\.setItem/, "no hay autoguardado del borrador");
  assert.match(src, /sessionStorage\.getItem/, "no se recupera nada al recargar");
  assert.match(src, /clearDraft\(\);\s*\n\s*onSaved\(record\)/,
    "el borrador debe tirarse cuando la consulta ya se guardó de verdad");

  // Dónde NO puede quedar texto clínico: el ordenador del consultorio lo usan
  // varias personas al día, y localStorage sobrevive al cierre de la pestaña.
  assert.ok(
    !/localStorage/.test(codigo("components/clinical/dental-form.tsx")),
    "el borrador clínico no puede ir a localStorage",
  );
  // Tampoco viaja a ningún sitio: el borrador no es expediente.
  const guardado = src.slice(src.indexOf("BORRADOR LOCAL"), src.indexOf("function toggleProc"));
  assert.ok(!/fetch\(/.test(guardado), "el borrador no se manda a ningún servidor");
});
