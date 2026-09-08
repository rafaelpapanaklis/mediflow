/**
 * WS2-T5 · LA PUERTA del instituto: entrar, no poder entrar, y que te lo
 * digan con la verdad.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-puerta.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * TRES CLASES DE PRUEBA, y cada una dice cuál es (mismo criterio que
 * edu-integridad.test.ts):
 *
 *  · EJECUTADAS — `puerta-core.ts` es puro a propósito, así que la regla de
 *    la contraseña, la caducidad de la temporal y la ruta de vuelta se
 *    corren de verdad, con sus casos límite.
 *  · DE FUENTE — lo que vive dentro de un componente de React o de un route
 *    handler que importa prisma no se puede cargar aquí. Se lee el archivo
 *    y se comprueba que la llamada esté puesta. El archivo se juzga por lo
 *    que HACE: los comentarios se quitan antes de buscar, para que ninguna
 *    prueba pase por lo que dice la prosa.
 *  · DE FRONTERA — la regla de fuerza de la contraseña es un ESPEJO
 *    deliberado de `scorePassword` del dental (no se importa: este vertical
 *    no importa piezas del dental). Si allá cambian el criterio, esta
 *    prueba se pone roja ANTES de que la ayuda vuelva a mentir — que es
 *    exactamente el H-161 otra vez.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_LOGIN_MENSAJES,
  EDU_PASSWORD_AYUDA,
  EDU_PASSWORD_MAX,
  EDU_PASSWORD_MIN,
  EDU_TEMP_PASSWORD_CADUCADA,
  EDU_TEMP_PASSWORD_DIAS,
  eduLoginMensaje,
  eduLoginMotivo,
  eduPasswordCheck,
  eduPasswordScore,
  eduRutaDeVuelta,
  eduTempPasswordEstado,
} from "../puerta-core";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** El archivo SIN comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return crudo(...tramos)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

const CORE = "src/lib/edu/puerta-core.ts";
const LOGIN_FORM = "src/components/edu/edu-login-form.tsx";
const PASS_FORM = "src/components/edu/edu-cambiar-contrasena-form.tsx";
const HTTP = "src/components/edu/edu-http.ts";
const RUTA_INTENTO = "src/app/api/instituto/auth/intento/route.ts";
const RUTA_SESION = "src/app/api/instituto/auth/session/route.ts";
const RUTA_PASS = "src/app/api/instituto/auth/cambiar-contrasena/route.ts";
const NOT_FOUND = "src/app/instituto/not-found.tsx";
const ERROR_RAIZ = "src/app/instituto/error.tsx";
const PASS_DENTAL = "src/components/public/auth/password-strength.tsx";

// ═══════════════════════════════════════════════════════════════════════
// 1 · H-161 · LA REGLA DE LA CONTRASEÑA Y SU AYUDA DICEN LO MISMO
// ═══════════════════════════════════════════════════════════════════════

test("H-161 (ejecutada): `contrasenita` PASA — que es justo lo que la ayuda vieja negaba", () => {
  // El hallazgo, en un caso: doce minúsculas seguidas. El texto pedía
  // "mayúsculas, minúsculas y números" y el servidor la aceptaba.
  const check = eduPasswordCheck("contrasenita");
  assert.equal(check.ok, true, "la regla del servidor no se ha endurecido: 12 caracteres bastan");
  assert.equal(check.motivo, null);
  // Y la ayuda lo DICE: la alternativa que cumple es la del largo.
  assert.equal(check.alternativas.find((a) => a.clave === "largo")?.cumple, true);
  assert.equal(check.alternativas.find((a) => a.clave === "mayus")?.cumple, false);
});

test("H-161 (ejecutada): la ayuda menciona las tres alternativas de verdad", () => {
  assert.match(EDU_PASSWORD_AYUDA, new RegExp(`${EDU_PASSWORD_MIN} caracteres`));
  assert.match(EDU_PASSWORD_AYUDA, /12 caracteres o más/);
  assert.match(EDU_PASSWORD_AYUDA, /mayúsculas y minúsculas/);
  assert.match(EDU_PASSWORD_AYUDA, /número y un signo/);
  // Y NO promete la regla vieja, que exigía las tres cosas a la vez.
  assert.doesNotMatch(
    EDU_PASSWORD_AYUDA,
    /mayúsculas, minúsculas y números/,
    "ésa es la frase del hallazgo: pide tres cosas que el servidor no exige juntas",
  );
});

test("H-161 (ejecutada): los casos límite de la regla", () => {
  const casos: [string, boolean, string][] = [
    ["", false, "vacía"],
    ["Ab1!", false, "corta aunque tenga de todo"],
    ["contrase", false, "8 minúsculas: largo sí, alternativa ninguna"],
    ["Contrase", true, "8 con mayúscula y minúscula"],
    ["contrasena1!", true, "12 largo (y además número y signo)"],
    ["abcdefgh1!", true, "10 con número y signo"],
    ["abcdefgh12", false, "10 con números pero sin signo ni mayúscula"],
    ["ABCDEFGHIJKL", true, "12 aunque sean todas mayúsculas"],
  ];
  for (const [pwd, esperado, porque] of casos) {
    assert.equal(eduPasswordCheck(pwd).ok, esperado, `${JSON.stringify(pwd)} — ${porque}`);
  }
});

test("H-161 (ejecutada): más de 72 se rechaza aunque cumpla todo lo demás", () => {
  const larga = "Aa1!".repeat(20); // 80 caracteres, cumple las tres alternativas
  const check = eduPasswordCheck(larga);
  assert.equal(check.demasiadoLarga, true);
  assert.equal(check.ok, false);
  assert.match(check.motivo ?? "", new RegExp(String(EDU_PASSWORD_MAX)));
  // Y el motivo NO dice "es muy débil", que sería mentira.
  assert.doesNotMatch(check.motivo ?? "", /débil|no cumple la regla/);
});

test("H-161 (FRONTERA): el espejo de scorePassword sigue coincidiendo con el del dental", () => {
  // No se importa el módulo del dental (este vertical no importa sus
  // piezas): se lee su fuente y se comprueba que las CUATRO condiciones del
  // puntaje siguen siendo las mismas. El día que allá cambien el criterio,
  // esta prueba se pone roja antes de que la ayuda vuelva a mentir.
  assert.ok(existsSync(join(RAIZ, PASS_DENTAL)), `no se encontró ${PASS_DENTAL}: ¿lo movieron?`);
  const dental = fuente(PASS_DENTAL).replace(/\s+/g, " ");
  for (const condicion of [
    "if (pwd.length >= 8) s++;",
    "if (pwd.length >= 12) s++;",
    "if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;",
    "if (/\\d/.test(pwd) && /[^\\w\\s]/.test(pwd)) s++;",
  ]) {
    assert.ok(
      dental.includes(condicion.replace(/\s+/g, " ")),
      `el dental ya no calcula el puntaje así (${condicion}): revisa el espejo de puerta-core.ts`,
    );
  }
  // Y el espejo da los mismos números en la tabla de ejemplos.
  assert.equal(eduPasswordScore(""), 0);
  assert.equal(eduPasswordScore("abcdefgh"), 1);
  assert.equal(eduPasswordScore("contrasenita"), 2);
  assert.equal(eduPasswordScore("Contrasenita"), 3);
  assert.equal(eduPasswordScore("Contrasenita1!"), 4);
});

test("H-161 (fuente): el formulario y el endpoint usan LA MISMA función", () => {
  const form = fuente(PASS_FORM);
  assert.match(form, /eduPasswordCheck\(/, "el formulario ya no aplica la regla de puerta-core");
  assert.match(form, /EDU_PASSWORD_AYUDA/, "la ayuda tiene que salir de la constante, no a mano");
  assert.doesNotMatch(
    form,
    /mayúsculas, minúsculas y números/,
    "volvió el texto del hallazgo al formulario",
  );

  const ruta = fuente(RUTA_PASS);
  assert.match(ruta, /eduPasswordCheck\(/, "el endpoint ya no aplica la regla de puerta-core");
  assert.doesNotMatch(
    ruta,
    /from "@\/components\/public\//,
    "el endpoint del instituto volvió a importar una pieza del dental",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-153 · LA TEMPORAL CADUCA
// ═══════════════════════════════════════════════════════════════════════

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-09-07T12:00:00.000Z");

test("H-153 (ejecutada): una cuenta SIN temporal no caduca nunca", () => {
  const e = eduTempPasswordEstado(
    { mustChangePassword: false, createdAt: new Date("2020-01-01T00:00:00Z") },
    AHORA,
  );
  assert.equal(e.aplica, false);
  assert.equal(e.caducada, false);
  assert.equal(e.caduca, null);
});

test("H-153 (ejecutada): la temporal caduca a los EDU_TEMP_PASSWORD_DIAS días", () => {
  const reciente = eduTempPasswordEstado(
    { mustChangePassword: true, createdAt: new Date(AHORA.getTime() - 3 * DIA) },
    AHORA,
  );
  assert.equal(reciente.aplica, true);
  assert.equal(reciente.caducada, false);
  assert.equal(reciente.diasRestantes, EDU_TEMP_PASSWORD_DIAS - 3);

  const vieja = eduTempPasswordEstado(
    {
      mustChangePassword: true,
      createdAt: new Date(AHORA.getTime() - (EDU_TEMP_PASSWORD_DIAS + 1) * DIA),
    },
    AHORA,
  );
  assert.equal(vieja.caducada, true);
  assert.equal(vieja.diasRestantes, 0);

  // El instante EXACTO cuenta como caducada: un límite abierto por arriba
  // es un límite que un reloj con un segundo de deriva se salta.
  const justo = eduTempPasswordEstado(
    {
      mustChangePassword: true,
      createdAt: new Date(AHORA.getTime() - EDU_TEMP_PASSWORD_DIAS * DIA),
    },
    AHORA,
  );
  assert.equal(justo.caducada, true);
});

test("H-153 (ejecutada): manda `updatedByAt` sobre `createdAt` — es cuándo se EMITIÓ", () => {
  // El caso real: cuenta de hace un año a la que la dirección le acaba de
  // restablecer la contraseña. Si se mirara `createdAt`, la temporal
  // recién emitida nacería caducada.
  const e = eduTempPasswordEstado(
    {
      mustChangePassword: true,
      createdAt: new Date(AHORA.getTime() - 400 * DIA),
      updatedByAt: new Date(AHORA.getTime() - 1 * DIA),
    },
    AHORA,
  );
  assert.equal(e.caducada, false);
  assert.equal(e.diasRestantes, EDU_TEMP_PASSWORD_DIAS - 1);
});

test("H-153 (ejecutada): sin ninguna fecha NO se caduca a nadie", () => {
  // Dejar fuera a una persona por un dato que falta es peor que la
  // temporal que se quería cerrar.
  const e = eduTempPasswordEstado({ mustChangePassword: true }, AHORA);
  assert.equal(e.aplica, true);
  assert.equal(e.caducada, false);
  assert.equal(e.caduca, null);
});

test("H-153 (ejecutada): acepta fechas en texto ISO (una fila ya serializada)", () => {
  const e = eduTempPasswordEstado(
    { mustChangePassword: true, updatedByAt: "2026-08-01T12:00:00.000Z" },
    AHORA,
  );
  assert.equal(e.caducada, true);
});

test("H-153 (fuente): el CANJE de una temporal caducada se rechaza", () => {
  // Éste es el candado de verdad: con mustChangePassword encendida el panel
  // ya está cerrado, así que convertirse en definitiva es lo ÚNICO que una
  // temporal puede hacer.
  const ruta = fuente(RUTA_PASS);
  assert.match(ruta, /eduTempPasswordEstado\([\s\S]{0,60}?\)\.caducada/);
  assert.match(ruta, /EDU_TEMP_PASSWORD_CADUCADA/);
  // Y va ANTES de tocar Supabase.
  const iGate = ruta.indexOf("caducada");
  const iSupabase = ruta.indexOf("updateUserById");
  assert.ok(iGate > -1 && iSupabase > -1 && iGate < iSupabase);
});

test("H-153 (fuente): el login cuenta los intentos con failban, en las tres fases", () => {
  const ruta = fuente(RUTA_INTENTO);
  assert.match(ruta, /from "@\/lib\/failban"/);
  assert.match(ruta, /failbanGuard\(/);
  assert.match(ruta, /recordAuthFailure\(/);
  assert.match(ruta, /recordAuthSuccess\(/);
  // Espacio de nombres PROPIO: compartir el del dental haría que los fallos
  // de una recepción bloquearan a un alumno desde la misma IP.
  assert.match(ruta, /instituto-login/);
  assert.doesNotMatch(ruta, /clinic-login/);

  const form = fuente(LOGIN_FORM);
  assert.match(form, /\/api\/instituto\/auth\/intento/);
  for (const fase of ['"check"', '"fail"', '"success"']) {
    assert.ok(form.includes(fase), `al login le falta la fase ${fase}`);
  }
  // FAIL-OPEN: solo un 429 explícito detiene el intento.
  assert.match(form, /status === 429/);
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-158 · «DADA DE BAJA» NO ES «NO ERES DE AQUÍ»
// ═══════════════════════════════════════════════════════════════════════

test("H-158 (ejecutada): el mensaje de baja pide REACTIVAR, no que te den de alta", () => {
  const baja = eduLoginMensaje("baja", "Instituto del Norte");
  assert.match(baja, /Instituto del Norte/);
  assert.match(baja, /REACTIVE/);
  assert.doesNotMatch(
    baja,
    /que te dé de alta/,
    "es el texto del hallazgo: darla de alta otra vez crea una cuenta nueva y deja el historial colgando de la vieja",
  );
  // Sin nombre de instituto sigue siendo verdad y sigue pidiendo lo mismo.
  assert.match(eduLoginMensaje("baja"), /REACTIVE/);
  // Y "no eres de aquí" es OTRO mensaje, con otra instrucción.
  assert.match(EDU_LOGIN_MENSAJES.ajena, /que te dé de alta/);
});

test("H-158 (ejecutada): los motivos de la URL vienen de un catálogo CERRADO", () => {
  assert.equal(eduLoginMotivo("sesion"), "sesion");
  assert.equal(eduLoginMotivo("baja"), "baja");
  assert.equal(eduLoginMotivo("cualquier-cosa"), null);
  assert.equal(eduLoginMotivo(null), null);
  assert.equal(eduLoginMotivo(42), null);
  // Un motivo inventado no puede acabar pintando texto en la puerta.
  assert.equal(eduLoginMotivo("<script>"), null);
});

test("H-158 (fuente): el sí/no del login distingue la baja mirando SIN isActive", () => {
  const ruta = fuente(RUTA_SESION);
  assert.match(ruta, /supabaseId: user\.id/);
  assert.match(ruta, /isActive: true/, "sigue haciendo falta para saber que NO está activa");
  assert.match(ruta, /motivo: "baja"/);
  assert.match(ruta, /motivo: "ajena"/);
  // El login pinta lo que diga el servidor.
  const form = fuente(LOGIN_FORM);
  assert.match(form, /data\?\.error/);
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-156 · UN 401 DEVUELVE AL LOGIN
// ═══════════════════════════════════════════════════════════════════════

test("H-156 (ejecutada): la ruta de vuelta solo acepta rutas del instituto", () => {
  assert.equal(eduRutaDeVuelta("/instituto/caja?turno=3"), "/instituto/caja?turno=3");
  assert.equal(eduRutaDeVuelta("/instituto/pacientes/abc/expediente"), "/instituto/pacientes/abc/expediente");

  // Los redirects abiertos, uno por uno.
  assert.equal(eduRutaDeVuelta("//sitio-que-copia-el-login.mx"), null);
  assert.equal(eduRutaDeVuelta("https://sitio-que-copia-el-login.mx"), null);
  assert.equal(eduRutaDeVuelta("/instituto/\\evil.mx"), null);
  assert.equal(eduRutaDeVuelta("/dashboard"), null, "el panel dental no es una vuelta de aquí");
  assert.equal(eduRutaDeVuelta("/instituto"), null, "sin la barra final no es una ruta del panel");
  // Los bucles.
  assert.equal(eduRutaDeVuelta("/instituto/login"), null);
  assert.equal(eduRutaDeVuelta("/instituto/login?motivo=sesion"), null);
  assert.equal(eduRutaDeVuelta("/instituto/cambiar-contrasena"), null);
  // Y lo que no es texto.
  assert.equal(eduRutaDeVuelta(null), null);
  assert.equal(eduRutaDeVuelta({}), null);
  assert.equal(eduRutaDeVuelta("/instituto/" + "x".repeat(400)), null);
});

test("H-156 (fuente): eduRequest manda al login en un 401, una sola vez y con la vuelta", () => {
  const http = fuente(HTTP);
  assert.match(http, /status === 401/);
  assert.match(http, /instituto\/login\?motivo=sesion/);
  assert.match(http, /volver=/);
  assert.match(http, /yendoAlLogin/, "sin la bandera, cuatro peticiones piden cuatro navegaciones");
  // Y sigue LANZANDO: la navegación no es instantánea y quien llamó no
  // puede seguir a la línea siguiente pintando un "Guardado" verde.
  assert.match(http, /throw new Error\(message\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · H-155 y H-157 · LAS DOS PANTALLAS DE ÚLTIMO RECURSO
// ═══════════════════════════════════════════════════════════════════════

test("H-155: existe el 404 del instituto y NO manda a la landing del dental", () => {
  assert.ok(existsSync(join(RAIZ, NOT_FOUND)), "sigue faltando src/app/instituto/not-found.tsx");
  const src = fuente(NOT_FOUND);
  assert.match(src, /\/instituto/, "su salida tiene que ser del instituto");
  // La landing comercial del dental es la raíz: ni un href="/" ni el
  // /dashboard del otro producto.
  assert.doesNotMatch(src, /href="\/"/, "manda a la portada comercial del producto dental");
  assert.doesNotMatch(src, /\/dashboard/);
});

test("H-157: existe el error.tsx que atrapa lo que lanza el layout del panel", () => {
  assert.ok(existsSync(join(RAIZ, ERROR_RAIZ)), "sigue faltando src/app/instituto/error.tsx");
  const src = crudo(ERROR_RAIZ);
  assert.ok(src.startsWith('"use client"'), "un error.tsx tiene que ser de cliente");
  assert.match(fuente(ERROR_RAIZ), /reset/, "sin reset no hay forma de reintentar");
  assert.match(fuente(ERROR_RAIZ), /\/instituto\/login/);
  assert.doesNotMatch(fuente(ERROR_RAIZ), /href="\/"/);
  // El del grupo (panel) SIGUE existiendo: es el que deja el menú en pie
  // cuando falla una PANTALLA. Éste es el de más afuera.
  assert.ok(existsSync(join(RAIZ, "src/app/instituto/(panel)/error.tsx")));
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · EL CORE ES PURO
// ═══════════════════════════════════════════════════════════════════════

test("puerta-core.ts es PURO: ni prisma, ni server-only, ni un new Date() escondido", () => {
  const src = fuente(CORE);
  assert.doesNotMatch(src, /from "@\/lib\/prisma"/);
  assert.doesNotMatch(src, /server-only/);
  assert.doesNotMatch(src, /next\/(headers|server)/);
  assert.doesNotMatch(
    src,
    /new Date\(\)/,
    "la hora entra por parámetro: un new Date() aquí hace la caducidad imposible de probar",
  );
  // Y el mensaje de la temporal caducada dice qué hacer, no qué falló.
  assert.match(EDU_TEMP_PASSWORD_CADUCADA, /Pídele a la dirección/);
});
