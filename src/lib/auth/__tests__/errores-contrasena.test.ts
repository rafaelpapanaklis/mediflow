import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AYUDA_CONTRASENA,
  MENSAJE_CONTRASENA_FILTRADA,
  esCorreoYaRegistrado,
  leerErrorContrasena,
  traducirErrorDeAuth,
} from "../errores-contrasena";

/**
 * Con la protección de contraseñas filtradas encendida en Supabase, el alta le
 * enseñaba al usuario «Password is known to be weak and easy to guess, please
 * choose a different one.»: las superficies pasaban `error.message` tal cual.
 * Estos tests fijan la traducción y, al final, que cada superficie la use.
 */

const FILTRADA_EN = "Password is known to be weak and easy to guess, please choose a different one.";
// Cualquier palabra que delate que se coló el texto de GoTrue.
const INGLES = /\b(password|should|weak|characters|registered|invalid|failed|error)\b/i;

// ── La contraseña filtrada ────────────────────────────────────────────────

test("filtrada: el texto es exactamente el pedido", () => {
  assert.equal(
    MENSAJE_CONTRASENA_FILTRADA,
    "Esta contraseña apareció en filtraciones públicas y es fácil de adivinar. Elige otra.",
  );
});

test("filtrada: por el mensaje en inglés, sin código (GoTrue viejo o error ya serializado)", () => {
  const r = leerErrorContrasena({ message: FILTRADA_EN });
  assert.deepEqual(r, { motivo: "filtrada", mensaje: MENSAJE_CONTRASENA_FILTRADA });
});

test("filtrada: por reasons, aunque el mensaje cambie de redacción", () => {
  const r = leerErrorContrasena({ message: "Nope", code: "weak_password", reasons: ["pwned"] });
  assert.equal(r?.motivo, "filtrada");
});

test("filtrada: en la forma cruda de GoTrue (error_code + weak_password.reasons)", () => {
  const r = leerErrorContrasena({
    error_code: "weak_password",
    msg: FILTRADA_EN,
    weak_password: { reasons: ["pwned"] },
  });
  assert.equal(r?.motivo, "filtrada");
});

test("filtrada: gana a «corta» cuando Supabase da los dos motivos", () => {
  const r = leerErrorContrasena({ code: "weak_password", reasons: ["length", "pwned"] });
  assert.equal(r?.motivo, "filtrada");
});

test("con reasons, el texto no se interpreta: «pwned» en el mensaje no la vuelve filtrada", () => {
  const r = leerErrorContrasena({
    code: "weak_password",
    reasons: ["length"],
    message: "Password should be at least 10 characters and not be a pwned password.",
  });
  assert.equal(r?.motivo, "corta");
  assert.equal(r?.minimo, 10);
});

test("filtrada: también si llega como string o como Error", () => {
  assert.equal(leerErrorContrasena(FILTRADA_EN)?.motivo, "filtrada");
  assert.equal(leerErrorContrasena(new Error(FILTRADA_EN))?.motivo, "filtrada");
});

// ── Los demás errores de contraseña ───────────────────────────────────────

test("corta: nunca anuncia un mínimo menor que el de nuestros formularios (8)", () => {
  const r = leerErrorContrasena({ message: "Password should be at least 6 characters." });
  assert.equal(r?.motivo, "corta");
  assert.equal(r?.minimo, 8);
  assert.equal(r?.mensaje, "La contraseña es demasiado corta. Usa al menos 8 caracteres.");
});

test("corta: si Supabase exige más de 8, se dice el de Supabase", () => {
  const r = leerErrorContrasena({
    message: "Password should be at least 12 characters.",
    code: "weak_password",
    reasons: ["length"],
  });
  assert.equal(r?.minimo, 12);
  assert.match(r!.mensaje, /al menos 12 caracteres/);
});

test("corta: por reasons sin número en el mensaje cae al mínimo propio", () => {
  assert.equal(leerErrorContrasena({ code: "weak_password", reasons: ["length"] })?.minimo, 8);
});

test("caracteres: nombra solo las clases que Supabase pide", () => {
  const r = leerErrorContrasena({
    message:
      "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.",
  });
  assert.equal(r?.motivo, "caracteres");
  assert.equal(
    r?.mensaje,
    "La contraseña debe incluir al menos una minúscula, una mayúscula y un número.",
  );
});

test("caracteres: con símbolos", () => {
  const r = leerErrorContrasena({
    message:
      "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};':\"|<>?,./`~.",
  });
  assert.match(r!.mensaje, /una minúscula, una mayúscula, un número y un símbolo\.$/);
});

test("caracteres: por reasons, sin lista que leer, da el consejo general", () => {
  const r = leerErrorContrasena({ code: "weak_password", reasons: ["characters"] });
  assert.equal(r?.motivo, "caracteres");
  assert.doesNotMatch(r!.mensaje, INGLES);
});

test("igual: por código y por mensaje", () => {
  assert.equal(leerErrorContrasena({ code: "same_password", message: "x" })?.motivo, "igual");
  assert.equal(
    leerErrorContrasena({ message: "New password should be different from the old password." })
      ?.motivo,
    "igual",
  );
});

test("larga: más de 72 caracteres", () => {
  const r = leerErrorContrasena({ message: "Password cannot be longer than 72 characters" });
  assert.equal(r?.motivo, "larga");
});

test("débil: weak_password con un motivo que no conocemos", () => {
  const r = leerErrorContrasena({ code: "weak_password", message: "Whatever", reasons: ["nuevo"] });
  assert.equal(r?.motivo, "debil");
  assert.doesNotMatch(r!.mensaje, INGLES);
});

test("ningún mensaje de contraseña sale en inglés", () => {
  const casos: unknown[] = [
    { message: FILTRADA_EN },
    { message: "Password should be at least 6 characters." },
    { message: "Password should contain at least one character of each: 0123456789" },
    { code: "same_password" },
    { message: "Password cannot be longer than 72 characters" },
    { code: "weak_password" },
  ];
  for (const caso of casos) {
    const r = leerErrorContrasena(caso);
    assert.ok(r, `sin traducción: ${JSON.stringify(caso)}`);
    assert.doesNotMatch(r.mensaje, INGLES);
  }
});

// ── Lo que NO es de contraseña ────────────────────────────────────────────

test("devuelve null si el error no es de contraseña (quien llama sigue con lo suyo)", () => {
  for (const caso of [
    null,
    undefined,
    "",
    {},
    { message: "User already registered" },
    { message: "Auth session missing!" },
    { message: "Invalid login credentials", code: "invalid_credentials" },
    { message: "fetch failed" },
  ]) {
    assert.equal(leerErrorContrasena(caso), null, JSON.stringify(caso));
  }
});

test("esCorreoYaRegistrado: las tres redacciones y los dos códigos", () => {
  assert.equal(esCorreoYaRegistrado({ message: "User already registered" }), true);
  assert.equal(
    esCorreoYaRegistrado({ message: "A user with this email address has already been registered" }),
    true,
  );
  assert.equal(esCorreoYaRegistrado({ message: "Email already exists" }), true);
  assert.equal(esCorreoYaRegistrado({ code: "email_exists" }), true);
  assert.equal(esCorreoYaRegistrado({ code: "user_already_exists" }), true);
  assert.equal(esCorreoYaRegistrado({ message: FILTRADA_EN }), false);
  assert.equal(esCorreoYaRegistrado(null), false);
});

test("esCorreoYaRegistrado: un choque de TELÉFONO no se le achaca al correo", () => {
  const dePhone = {
    code: "phone_exists",
    message: "A user with this phone number has already been registered",
  };
  assert.equal(esCorreoYaRegistrado(dePhone), false);
  assert.equal(esCorreoYaRegistrado({ message: dePhone.message }), false);
  assert.doesNotMatch(traducirErrorDeAuth(dePhone, "No se pudo crear la cuenta."), /correo/);
});

// ── traducirErrorDeAuth: nunca deja pasar el inglés ───────────────────────

test("traducirErrorDeAuth: la filtrada sale con su texto, no con el respaldo", () => {
  assert.equal(
    traducirErrorDeAuth({ message: FILTRADA_EN, code: "weak_password" }, "Error al crear cuenta"),
    MENSAJE_CONTRASENA_FILTRADA,
  );
});

test("traducirErrorDeAuth: traduce lo que el usuario puede provocar", () => {
  const casos: Array<[unknown, RegExp]> = [
    [{ message: "User already registered" }, /Ya existe una cuenta/],
    [{ message: 'Email address "a@b" is invalid', code: "email_address_invalid" }, /correo no es válido/],
    [{ message: "Unable to validate email address: invalid format" }, /correo no es válido/],
    [{ message: "email rate limit exceeded", code: "over_email_send_rate_limit" }, /Demasiados intentos/],
    [
      { message: "For security purposes, you can only request this after 32 seconds." },
      /Demasiados intentos/,
    ],
    [{ message: "Signups not allowed for this instance" }, /registro no está disponible/],
    [{ message: "fetch failed" }, /Revisa tu conexión/],
  ];
  for (const [error, esperado] of casos) {
    const texto = traducirErrorDeAuth(error, "RESPALDO");
    assert.match(texto, esperado, JSON.stringify(error));
    assert.doesNotMatch(texto, INGLES);
  }
});

test("traducirErrorDeAuth: lo que no reconoce cae al respaldo, jamás al inglés", () => {
  for (const error of [
    { message: "Database error saving new user" },
    { message: "Something nobody has seen before", code: "unexpected_failure" },
    null,
    undefined,
    {},
  ]) {
    assert.equal(traducirErrorDeAuth(error, "No se pudo crear la cuenta."), "No se pudo crear la cuenta.");
  }
});

// ── Cableado: cada superficie pasa por el traductor ───────────────────────
// Un helper que nadie llama no arregla nada. Se lee el código fuente porque
// levantar Supabase para cada formulario no cabe en un test de unidad.

const RAIZ = join(__dirname, "..", "..", "..", "..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

const SUPERFICIES: Array<{ ruta: string; usa: RegExp }> = [
  { ruta: "src/app/api/auth/register/route.ts", usa: /traducirErrorDeAuth\(/ },
  { ruta: "src/app/api/auth/change-password/route.ts", usa: /leerErrorContrasena\(/ },
  { ruta: "src/app/api/team/route.ts", usa: /traducirErrorDeAuth\(/ },
  {
    ruta: "src/app/api/admin/clinics/[id]/users/[userId]/reset-password/route.ts",
    usa: /leerErrorContrasena\(/,
  },
  { ruta: "src/app/api/afiliados/auth/register/route.ts", usa: /traducirErrorDeAuth\(/ },
  { ruta: "src/components/public/auth/recovery/reset-password-form.tsx", usa: /leerErrorContrasena\(/ },
  { ruta: "src/app/dashboard/settings/settings-client.tsx", usa: /leerErrorContrasena\(/ },
];

for (const { ruta, usa } of SUPERFICIES) {
  test(`cableado: ${ruta} pasa el error de Supabase por el traductor`, () => {
    const codigo = fuente(ruta);
    assert.match(codigo, /@\/lib\/auth\/errores-contrasena/);
    assert.match(codigo, usa);
  });
}

test("cableado: el alta ya no le pasa al usuario el message de Supabase", () => {
  const codigo = fuente("src/app/api/auth/register/route.ts");
  assert.doesNotMatch(codigo, /error:\s*authError\?\.message/);
});

test("cableado: el alta de equipo ya no le pasa al usuario el message de Supabase", () => {
  const codigo = fuente("src/app/api/team/route.ts");
  assert.doesNotMatch(codigo, /error:\s*msg\s*\|\|/);
});

test("cableado: Configuración ya no enseña e.message al cambiar la contraseña", () => {
  const codigo = fuente("src/app/dashboard/settings/settings-client.tsx");
  const funcion = codigo.slice(codigo.indexOf("async function changePassword()"));
  const cuerpo = funcion.slice(0, funcion.indexOf("async function disconnectGcal()"));
  assert.doesNotMatch(cuerpo, /toast\.error\(e\.message/);
});

test("medidor de fuerza: lleva la línea de ayuda y no cambia las reglas", () => {
  assert.equal(AYUDA_CONTRASENA, "Evita contraseñas comunes; no la reutilices");
  const codigo = fuente("src/components/public/auth/password-strength.tsx");
  assert.match(codigo, /AYUDA_CONTRASENA/);
  // Las cuatro reglas de scorePassword, tal como estaban.
  assert.match(codigo, /if \(pwd\.length >= 8\) s\+\+;/);
  assert.match(codigo, /if \(pwd\.length >= 12\) s\+\+;/);
  assert.match(codigo, /if \(\/\[a-z\]\/\.test\(pwd\) && \/\[A-Z\]\/\.test\(pwd\)\) s\+\+;/);
  assert.match(codigo, /if \(\/\\d\/\.test\(pwd\) && \/\[\^\\w\\s\]\/\.test\(pwd\)\) s\+\+;/);
});

test("diccionarios: las llaves de error de contraseña existen en es y en en", () => {
  for (const idioma of ["es", "en"]) {
    const dic = JSON.parse(fuente(`src/i18n/dictionaries/${idioma}.json`));
    const nodo = dic?.settings?.client?.pwError;
    assert.ok(nodo, `${idioma}.json: falta settings.client.pwError`);
    for (const motivo of ["filtrada", "corta", "caracteres", "debil", "igual", "larga", "otro"]) {
      assert.equal(typeof nodo[motivo], "string", `${idioma}.json: falta pwError.${motivo}`);
    }
  }
  const es = JSON.parse(fuente("src/i18n/dictionaries/es.json"));
  assert.equal(es.settings.client.pwError.filtrada, MENSAJE_CONTRASENA_FILTRADA);
});
