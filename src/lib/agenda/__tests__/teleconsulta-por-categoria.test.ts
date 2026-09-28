// Teleconsulta oculta en clínicas dentales (decisión de Rafael, 28-sep-2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { modoDeLaCita, teleconsultaDisponible } from "../teleconsulta-por-categoria";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

test("una clínica dental no tiene teleconsulta; las demás la conservan", () => {
  assert.equal(teleconsultaDisponible("DENTAL"), false);
  for (const c of ["MEDICINE", "NUTRITION", "PSYCHOLOGY", "PHYSIOTHERAPY", "OTHER"]) {
    assert.equal(teleconsultaDisponible(c), true, c);
  }
});

test("sin categoría conocida falla cerrado", () => {
  assert.equal(teleconsultaDisponible(null), false);
  assert.equal(teleconsultaDisponible(undefined), false);
  assert.equal(teleconsultaDisponible(""), false);
});

test("en dental la cita nueva es presencial aunque la petición pida teleconsulta", () => {
  assert.equal(modoDeLaCita("DENTAL", true), "IN_PERSON");
  assert.equal(modoDeLaCita("DENTAL", false), "IN_PERSON");
  assert.equal(modoDeLaCita("PSYCHOLOGY", true), "TELECONSULTATION");
  assert.equal(modoDeLaCita("PSYCHOLOGY", false), "IN_PERSON");
  assert.equal(modoDeLaCita("PSYCHOLOGY", "true"), "IN_PERSON", "solo un `true` de verdad");
});

test("el servidor decide el modo con la categoría de la SESIÓN, y la sala nueva se niega en dental", () => {
  const citas = leer("src/app/api/appointments/route.ts");
  assert.match(citas, /mode: modoDeLaCita\(session\.clinic\.category, body\.isTeleconsult\)/);
  const sala = leer("src/app/api/teleconsulta/room/route.ts");
  assert.match(sala, /negarApiPorCategoria\("\/dashboard\/teleconsulta", ctx\.clinicCategory\)/);
});

test("la pantalla de la lista pasa por el guardia en la propia página, y la agenda clásica no ofrece el modo", () => {
  const pagina = leer("src/app/dashboard/teleconsulta/page.tsx");
  assert.match(pagina, /await exigirCategoriaParaPagina\("\/dashboard\/teleconsulta"\)/);
  const agenda = leer("src/app/dashboard/appointments/appointments-client.tsx");
  assert.match(agenda, /\{teleconsultaDisponible\(clinicCategory\) && \(/);
});

test("no se borró nada: la sala pública y las rutas de entrar y cerrar siguen ahí", () => {
  for (const rel of [
    "src/app/teleconsulta/[appointmentId]/page.tsx",
    "src/app/api/teleconsulta/join/[appointmentId]/route.ts",
    "src/app/api/teleconsulta/end/route.ts",
  ]) {
    assert.ok(leer(rel).length > 0, rel);
  }
});
