/**
 * Sabina — «nunca puede más que el usuario que le escribe».
 *
 * `npm run test:sabina-permisos-equipo`
 *
 * El Super Admin decide desde Equipo qué puede hacer Sabina en nombre de cada
 * usuario. Esta suite demuestra, sin base y sin Anthropic, que:
 *
 *  1. La regla es una INTERSECCIÓN: lo marcado para Sabina que el usuario no
 *     tiene NO se le da. Es la prueba que importa de todo el trabajo, y va
 *     contra las herramientas REALES del catálogo y contra la confirmación.
 *  2. Vive en un solo sitio (`crearSabinaCtx`): una herramienta escrita mañana
 *     que mire el permiso por su cuenta con el ctx también queda recortada.
 *  3. El recorte llega al endpoint de la fase 2 aunque la acción no declare la
 *     key que el endpoint pide.
 *  4. El doctor lee la razón correcta: «tú no tienes ese permiso» o «el Super
 *     Admin se lo quitó a Sabina».
 *  5. Apagada no consulta, no llama al modelo, no escribe.
 */
import "../engine-sin-server-only"; // PRIMERO: engine.ts y engine-propuestas.ts arrastran "server-only"
import "../tools/__tests__/preparar"; // prisma real prohibido: todo va por dobles
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  ALL_PERMISSION_KEYS,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  type PermissionKey,
} from "@/lib/auth/permissions";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  AJUSTES_SABINA_POR_DEFECTO,
  FRASE_SABINA_APAGADA,
  SABINA_SIN_PERMISOS,
  causaSinPermiso,
  overrideDeSabina,
  permisosDeSabina,
  type AjustesSabina,
} from "../permisos-sabina";
import { esTablaDeSabinaAusente, leerAjustesSabina, leerAjustesSabinaConEstado } from "../ajustes-sabina";
import { conPermisosDeSabina, permisosDeSabinaEnCurso } from "../recorte-en-curso";
import { crearSabinaCtx, type SabinaCtx, type SabinaTool } from "../tipos";
import { correrHerramienta, tienePermiso } from "../tools/base";
import { CATALOGO_SABINA } from "../tools/index";
import { base, CL_NORTE, TZ_NORTE, U_DOC_N } from "../tools/__tests__/siembra";
import { fraseSinPermiso, garantizarAvisoSinPermiso, resultadoParaModelo } from "../engine-core";
import { definirAccion, fraseSinPermisoAccion, type PropuestaPreparada } from "../engine-acciones";
import { ejecutarSabina, type LlamarModelo, type TurnoModelo } from "../engine";
import { confirmarPropuesta, guardarPropuesta } from "../engine-propuestas";
import { crearBaseDePropuestas } from "../engine-propuestas-doble";

/* ── utilería ───────────────────────────────────────────────────────── */

function lector(ajustes: AjustesSabina | null) {
  return { leerAjustes: async () => ajustes };
}

/** La sesión tal cual la da `getAuthContext`, para un usuario de la clínica del norte. */
function sesion(role: string, permissionsOverride: string[] = []) {
  return {
    clinicId: CL_NORTE,
    userId: U_DOC_N,
    role,
    permissionsOverride,
    clinic: { timezone: TZ_NORTE, category: "DENTAL" },
  };
}

async function ctxDe(role: string, override: string[], ajustes: AjustesSabina | null): Promise<SabinaCtx> {
  const c = await crearSabinaCtx(sesion(role, override), lector(ajustes));
  assert.ok(c, "con sesión completa tiene que haber ctx");
  return c;
}

const herramienta = (nombre: string) => {
  const t = CATALOGO_SABINA.find((h) => h.nombre === nombre);
  assert.ok(t, `no existe la herramienta ${nombre} en el catálogo real`);
  return t;
};

/* ══════════════════════════════════════════════════════════════════════
 * 1 · LA INTERSECCIÓN — la prueba que importa
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 usuario SIN el permiso + Sabina con él marcado = Sabina NO puede (herramienta real, sin tocar la base)", async () => {
  // Un doctor al que el Super Admin le dejó solo la agenda. En la lista de Sabina
  // alguien marcó facturación: no le sirve de nada.
  const db = base();
  const ctx = { ...(await ctxDe("DOCTOR", ["agenda.view"], { activa: true, permisos: ["agenda.view", "billing.view"] })), db };

  const r = await correrHerramienta(herramienta("ingresos_por_periodo"), ctx, { desde: "2026-09-01", hasta: "2026-09-10" });
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal((r as any).permiso, "billing.view");
  assert.equal(db.contador.llamadas.length, 0, "se consultó la base sin permiso");
  // Y la razón es la del USUARIO: él no lo tiene.
  assert.equal(causaSinPermiso(ctx, "billing.view"), "usuario");

  // Lo que sí tienen los dos, pasa.
  const agenda = await correrHerramienta(herramienta("citas_del_dia"), ctx, {});
  assert.notEqual((agenda as any).motivo, "sin_permiso");
});

test("🔴 recepción (sin billing.refund por rol) + Sabina con TODO el catálogo marcado = sigue sin billing.refund", async () => {
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: [...ALL_PERMISSION_KEYS] });
  assert.equal(tienePermiso(ctx, "billing.refund"), false);
  assert.equal(tienePermiso(ctx, "medicalRecord.edit"), false);
  assert.equal(tienePermiso(ctx, "billing.charge"), true, "lo que el rol sí da, se conserva");
  assert.deepEqual(
    getEffectivePermissions({ role: "RECEPTIONIST", permissionsOverride: ctx.permissionsOverride }),
    ROLE_DEFAULT_PERMISSIONS.RECEPTIONIST,
  );
});

test("🔴 Sabina nunca es superconjunto: todos los roles × listas de Sabina al azar", async () => {
  // Semilla fija: si falla, falla igual la próxima vez.
  let semilla = 20260914;
  const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const muestra = () => ALL_PERMISSION_KEYS.filter(() => azar() < 0.5);

  for (const role of Object.keys(ROLE_DEFAULT_PERMISSIONS)) {
    for (let i = 0; i < 40; i++) {
      const override = i % 3 === 0 ? [] : muestra();
      const ajustes: AjustesSabina = { activa: azar() < 0.9, permisos: i % 4 === 0 ? [] : muestra() };
      const ctx = await ctxDe(role, override, ajustes);
      const usuario = new Set(getEffectivePermissions({ role: role as any, permissionsOverride: override }));
      for (const key of ALL_PERMISSION_KEYS) {
        if (tienePermiso(ctx, key)) {
          assert.ok(usuario.has(key), `${role}: Sabina tiene ${key} y el usuario no (override ${override.length}, sabina ${ajustes.permisos.length})`);
          if (role === "SUPER_ADMIN") continue; // a él no se le aplica la fila (prueba aparte)
          assert.ok(ajustes.activa, `${role}: Sabina apagada y aun así tiene ${key}`);
          assert.ok(ajustes.permisos.length === 0 || ajustes.permisos.includes(key), `${role}: ${key} no estaba marcada para Sabina`);
        }
      }
    }
  }
});

test("🔴 quitarle un permiso al USUARIO se lo quita a Sabina en el mismo instante, aunque en su lista siga marcado", async () => {
  const ajustesSabina: AjustesSabina = { activa: true, permisos: ["billing.create", "billing.view", "agenda.view"] };

  const antes = await ctxDe("DOCTOR", [], ajustesSabina);
  assert.equal(tienePermiso(antes, "billing.create"), true);

  // El Super Admin le quita «Crear facturas» al doctor desde Permisos. La fila de
  // Sabina no se toca: la siguiente petición ya no lo tiene.
  const sinFacturar = ROLE_DEFAULT_PERMISSIONS.DOCTOR.filter((k) => k !== "billing.create");
  const despues = await ctxDe("DOCTOR", sinFacturar, ajustesSabina);
  assert.equal(tienePermiso(despues, "billing.create"), false);
  assert.equal(causaSinPermiso(despues, "billing.create"), "usuario");
  assert.equal(tienePermiso(despues, "billing.view"), true);
});

test("«añadir» es devolverle a Sabina lo que se le quitó, nunca darle algo que el usuario no tiene", async () => {
  const quitado = await ctxDe("DOCTOR", [], { activa: true, permisos: ["agenda.view"] });
  assert.equal(tienePermiso(quitado, "patients.view"), false);
  assert.equal(causaSinPermiso(quitado, "patients.view"), "sabina", "el doctor sí lo tiene: se lo quitaron a Sabina");

  const devuelto = await ctxDe("DOCTOR", [], { activa: true, permisos: ["agenda.view", "patients.view"] });
  assert.equal(tienePermiso(devuelto, "patients.view"), true);

  const imposible = await ctxDe("DOCTOR", [], { activa: true, permisos: ["agenda.view", "billing.refund"] });
  assert.equal(tienePermiso(imposible, "billing.refund"), false, "el doctor no reembolsa: Sabina tampoco");
  assert.equal(causaSinPermiso(imposible, "billing.refund"), "usuario");
});

test("misma convención que permissionsOverride: vacío = todo lo del usuario; con keys = exactamente esas", () => {
  const todo = permisosDeSabina({ role: "DOCTOR", permissionsOverride: [] }, { activa: true, permisos: [] });
  assert.deepEqual(todo.permitidas, ROLE_DEFAULT_PERMISSIONS.DOCTOR);
  assert.deepEqual(todo.quitadas, []);

  const sinFila = permisosDeSabina({ role: "DOCTOR", permissionsOverride: [] }, null);
  assert.deepEqual(sinFila, todo, "sin fila = lo de siempre");
  assert.deepEqual(AJUSTES_SABINA_POR_DEFECTO, { activa: true, permisos: [] });

  const exactas = permisosDeSabina({ role: "DOCTOR", permissionsOverride: [] }, { activa: true, permisos: ["agenda.view", "patients.view"] });
  assert.deepEqual(exactas.permitidas, ["agenda.view", "patients.view"]);
  assert.equal(exactas.quitadas.length, ROLE_DEFAULT_PERMISSIONS.DOCTOR.length - 2);
});

test("🔴 una lista de Sabina con keys que ya no existen concede NADA, no todo (el mismo cinturón que el override)", async () => {
  const ctx = await ctxDe("ADMIN", [], { activa: true, permisos: ["billing.read", "constructor", "__proto__"] });
  for (const key of ALL_PERMISSION_KEYS) assert.equal(tienePermiso(ctx, key), false, `concedió ${key}`);
});

test("🔴 sin permisos se escribe como override LLENO: `[]` le devolvería a Sabina los defaults del rol", async () => {
  assert.equal(Object.prototype.hasOwnProperty.call(ALL_PERMISSIONS, SABINA_SIN_PERMISOS), false, "el centinela no puede ser una key real");
  assert.deepEqual(overrideDeSabina([]), [SABINA_SIN_PERMISOS]);
  // La trampa, demostrada: con `[]` un ADMIN lo tendría todo.
  assert.equal(hasPermission({ role: "ADMIN", permissionsOverride: [] }, "billing.refund"), true);

  const apagada = await ctxDe("ADMIN", [], { activa: false, permisos: [] });
  assert.deepEqual(apagada.permissionsOverride, [SABINA_SIN_PERMISOS]);
  for (const key of ALL_PERMISSION_KEYS) assert.equal(tienePermiso(apagada, key), false, `apagada y concedió ${key}`);
  assert.equal(apagada.sabina?.apagada, true);
});

test("a un SUPER_ADMIN no se le aplica la fila (nadie se la puede editar): Sabina = lo que él puede", async () => {
  // Una fila de cuando era doctor, apagada. Subió a SUPER_ADMIN: Equipo ya no le
  // deja tocarla, así que aplicarla lo dejaría sin Sabina para siempre.
  const ctx = await ctxDe("SUPER_ADMIN", [], { activa: false, permisos: ["agenda.view"] });
  assert.equal(ctx.sabina?.apagada, false);
  assert.equal(tienePermiso(ctx, "billing.refund"), true);
  // Y aun así nunca más que él: con su override recortado, Sabina recortada.
  const recortado = await ctxDe("SUPER_ADMIN", ["agenda.view"], null);
  assert.equal(tienePermiso(recortado, "billing.refund"), false);
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · UN SOLO SITIO — `crearSabinaCtx`
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 una herramienta NUEVA que mira el permiso por su cuenta (sin el runner) ya viene recortada", async () => {
  // Así escribiría alguien, mañana, la herramienta de «cobrar» sin conocer este
  // mecanismo: `hasPermission` con el rol y el override del ctx.
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: ["agenda.view", "billing.view"] });
  const cobrarDelFuturo = (c: SabinaCtx) =>
    hasPermission({ role: c.role, permissionsOverride: c.permissionsOverride }, "billing.charge");
  assert.equal(hasPermission({ role: "RECEPTIONIST", permissionsOverride: [] }, "billing.charge"), true, "recepción SÍ cobra");
  assert.equal(cobrarDelFuturo(ctx), false, "Sabina no puede cobrar en su nombre");

  // Y por el runner, con una herramienta que no existe en el catálogo.
  let ejecutada = false;
  const nueva: SabinaTool = {
    nombre: "cobrar_pago",
    descripcion: "Del futuro.",
    parametros: z.object({}),
    permiso: "billing.charge",
    ejecutar: async () => {
      ejecutada = true;
      return { ok: 1 };
    },
    resumir: () => "cobrado",
    vacio: () => false,
  };
  const r = await correrHerramienta(nueva, ctx, {});
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal(ejecutada, false);
  assert.equal(causaSinPermiso(ctx, "billing.charge"), "sabina");
});

test("crearSabinaCtx lee los ajustes de ESA clínica y ESE usuario, y sin sesión no lee nada", async () => {
  const leidos: Array<[string, string]> = [];
  const leer = { leerAjustes: async (c: string, u: string) => (leidos.push([c, u]), null) };
  assert.equal(await crearSabinaCtx({ clinicId: "", userId: "u", role: "ADMIN" }, leer), null);
  assert.equal(await crearSabinaCtx(null, leer), null);
  assert.equal(leidos.length, 0, "se leyó la base con una sesión a medias");

  await crearSabinaCtx({ clinicId: " cl-a ", userId: " u-1 ", role: "ADMIN" }, leer);
  assert.deepEqual(leidos, [["cl-a", "u-1"]]);
});

test("🔴 si leer los ajustes falla, NO hay ctx (no se cae a «sin recorte»); si la tabla aún no existe, lo de siempre", async () => {
  const timeout = Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" });
  await assert.rejects(
    crearSabinaCtx(sesion("ADMIN"), { leerAjustes: async () => { throw timeout; } }),
    /Timed out/,
  );

  const donde: any[] = [];
  const sinTabla = {
    sabinaUserPermission: {
      findFirst: async (args: any) => {
        donde.push(args.where);
        throw Object.assign(new Error("The table `public.sabina_user_permissions` does not exist"), { code: "P2021" });
      },
    },
  };
  assert.equal(await leerAjustesSabina(CL_NORTE, U_DOC_N, sinTabla), null);
  assert.deepEqual(await leerAjustesSabinaConEstado(CL_NORTE, U_DOC_N, sinTabla), { disponible: false, ajustes: null });
  assert.deepEqual(donde[0], { userId: U_DOC_N, clinicId: CL_NORTE }, "la lectura filtra por clínica Y usuario");

  const conTimeout = { sabinaUserPermission: { findFirst: async () => { throw timeout; } } };
  await assert.rejects(leerAjustesSabina(CL_NORTE, U_DOC_N, conTimeout), /Timed out/);
  await assert.rejects(leerAjustesSabina("", U_DOC_N, conTimeout), /sesion_invalida/);

  assert.equal(esTablaDeSabinaAusente({ code: "P2021" }), true);
  assert.equal(esTablaDeSabinaAusente({ code: "42P01" }), true);
  assert.equal(esTablaDeSabinaAusente({ code: "P2022" }), false, "una columna que falta NO abre");
  assert.equal(esTablaDeSabinaAusente(timeout), false);

  const fila = { sabinaUserPermission: { findFirst: async () => ({ enabled: false, permissions: ["agenda.view"] }) } };
  assert.deepEqual(await leerAjustesSabina(CL_NORTE, U_DOC_N, fila), { activa: false, permisos: ["agenda.view"] });
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · LA FASE 2 — confirmar y el endpoint real
 * ══════════════════════════════════════════════════════════════════════ */

const mundo = { llamadasAlHandler: 0, pedidas: [] as string[] };

/**
 * Un handler con la forma de los de verdad: mira los permisos de la SESIÓN (el
 * usuario, que tiene todo) con `denyIfMissingPermission`. Pide dos keys aunque
 * la acción declare solo una — el caso de una factura que además cobra.
 */
async function handlerQueCobra(_req: any) {
  mundo.llamadasAlHandler += 1;
  const usuarioDeLaSesion = { role: "RECEPTIONIST", permissionsOverride: [] as string[] };
  for (const key of ["billing.create", "billing.charge"] as PermissionKey[]) {
    mundo.pedidas.push(key);
    const denegado = denyIfMissingPermission(usuarioDeLaSesion, key);
    if (denegado) return denegado;
  }
  return new Response(JSON.stringify({ invoice: { id: "inv_1" } }), { status: 201, headers: { "content-type": "application/json" } });
}

const facturarYCobrar = definirAccion({
  nombre: "facturar_y_cobrar",
  descripcion: "Del futuro.",
  titulo: "Facturar",
  boton: "Sí, facturar",
  queHace: "facturar",
  permiso: "billing.create",
  deshacer: { reversible: false, aviso: "No se puede deshacer." },
  parametros: z.object({}),
  datos: z.object({ total: z.number() }),
  preparar: async () => {
    throw new Error("no se usa aquí");
  },
  huella: async () => "igual",
  ejecutar: async (llave, _ctx, datos) => {
    const r = await llave.llamar(handlerQueCobra, { metodo: "POST", ruta: "/api/invoices", cuerpo: datos });
    return r.status === 201 ? { ok: true, frase: "Facturé y cobré." } : { ok: false, tipo: "sin_permiso", frase: `El sistema dijo ${r.status}.` };
  },
});

const propuestaFactura: PropuestaPreparada = {
  accion: "facturar_y_cobrar",
  titulo: "Facturar",
  boton: "Sí, facturar",
  queHace: "facturar",
  deshacer: { reversible: false, aviso: "No se puede deshacer." },
  tarjeta: { frase: "Facturar $500 a María", detalles: [], avisos: [] },
  datos: { total: 500 },
  huella: "igual",
};

let reloj = 1_757_800_000_000;
const ahora = () => reloj;

function peticion() {
  return new Request("https://app.dalecontrol.mx/api/sabina/propuestas/x/confirmar", {
    method: "POST",
    headers: { cookie: "sb-sesion=abc", host: "app.dalecontrol.mx", origin: "https://app.dalecontrol.mx" },
  });
}

async function proponerYConfirmar(ctx: SabinaCtx) {
  const base = crearBaseDePropuestas(ahora);
  const vista = await guardarPropuesta({ ctx, propuesta: propuestaFactura, pedido: "factura", conversacionId: null, modelo: "m", db: base.db, ahora, req: peticion() as any });
  return confirmarPropuesta({ ctx, id: vista.id, req: peticion() as any, acciones: [facturarYCobrar], db: base.db, ahora });
}

beforeEach(() => {
  Object.assign(mundo, { llamadasAlHandler: 0, pedidas: [] });
});

test("🔴 confirmar: el usuario sí puede, el Super Admin se lo quitó a Sabina → no se llama al endpoint, y la frase lo dice", async () => {
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: ["agenda.view", "billing.view"] });
  const d = await proponerYConfirmar(ctx);
  assert.equal(mundo.llamadasAlHandler, 0, "llegó al endpoint");
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(d.vista?.resultado?.tipo, "sin_permiso");
  assert.equal(d.vista?.resultado?.frase, fraseSinPermisoAccion("facturar", "sabina"));
  assert.match(d.vista!.resultado!.frase, /Tú sí puedes facturar/);
  assert.match(d.vista!.resultado!.frase, /Super Admin/);
});

test("🔴 confirmar: la key que la acción NO declaró también se corta dentro del endpoint real", async () => {
  // El Super Admin le dejó a Sabina facturar (billing.create) pero no cobrar.
  // La acción solo declara billing.create; el endpoint pide además billing.charge
  // y, mirando la sesión, recepción SÍ cobra. El recorte viaja al handler.
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: ["billing.create", "billing.view"] });
  const d = await proponerYConfirmar(ctx);
  assert.equal(mundo.llamadasAlHandler, 1);
  assert.deepEqual(mundo.pedidas, ["billing.create", "billing.charge"]);
  assert.equal(d.vista?.estado, "fallida", "Sabina cobró lo que el Super Admin le quitó");
  assert.match(d.vista!.resultado!.frase, /403/);

  // Con cobrar devuelto, la misma propuesta pasa: el recorte no inventa negativas.
  const conCobro = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: ["billing.create", "billing.charge"] });
  mundo.llamadasAlHandler = 0;
  const ok = await proponerYConfirmar(conCobro);
  assert.equal(ok.vista?.estado, "hecha");
});

test("confirmar sin recorte (lo de siempre): el endpoint se llama y escribe", async () => {
  const ctx = await ctxDe("RECEPTIONIST", [], null);
  const d = await proponerYConfirmar(ctx);
  assert.equal(d.vista?.estado, "hecha");
  assert.equal(mundo.llamadasAlHandler, 1);
});

test("confirmar con Sabina apagada: nada llega al endpoint y se dice que está apagada", async () => {
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: false, permisos: [] });
  const d = await proponerYConfirmar(ctx);
  assert.equal(mundo.llamadasAlHandler, 0);
  assert.equal(d.vista?.resultado?.frase, FRASE_SABINA_APAGADA);
});

test("el recorte en curso vive SOLO durante el handler (y sus promesas), no se escapa a otras peticiones", async () => {
  const usuario = { role: "RECEPTIONIST", permissionsOverride: [] as string[] };
  const ctx = await ctxDe("RECEPTIONIST", [], { activa: true, permisos: ["agenda.view"] });

  assert.equal(permisosDeSabinaEnCurso(), null);
  assert.equal(hasPermission(usuario, "billing.charge"), true);

  let otraPeticion: boolean | null = null;
  const fuera = new Promise<void>((r) => setTimeout(() => { otraPeticion = hasPermission(usuario, "billing.charge"); r(); }, 1));

  await conPermisosDeSabina(ctx, async () => {
    assert.equal(hasPermission(usuario, "billing.charge"), false);
    assert.equal(hasPermission(usuario, "agenda.view"), true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(hasPermission(usuario, "billing.charge"), false, "tras un await sigue recortado");
  });
  await fuera;
  assert.equal(otraPeticion, true, "otra petición concurrente quedó recortada");
  assert.equal(hasPermission(usuario, "billing.charge"), true);
  assert.equal(permisosDeSabinaEnCurso(), null);
  // Si en el almacén hubiera algo que no es un conjunto, se niega todo (no se abre).
  const clave = Symbol.for("dalecontrol.sabina.permisos-en-curso");
  const lector = (globalThis as any)[clave];
  (globalThis as any)[clave] = () => ["billing.charge"];
  try {
    assert.equal(hasPermission(usuario, "billing.charge"), false);
  } finally {
    (globalThis as any)[clave] = lector;
  }
  assert.equal(hasPermission(usuario, "billing.charge"), true);
  // Y el recorte nunca concede: un usuario sin la key sigue sin ella.
  await conPermisosDeSabina(ctx, async () => {
    assert.equal(hasPermission({ role: "READONLY", permissionsOverride: [] }, "agenda.create"), false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · LA FRASE — dos razones distintas
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 las dos razones se dicen distinto, y a quien SÍ tiene el permiso no se le dice «no tienes acceso»", () => {
  const delUsuario = fraseSinPermiso("billing.view", "usuario");
  const deSabina = fraseSinPermiso("billing.view", "sabina");
  assert.equal(delUsuario, "No tienes acceso a facturación, eso no te lo puedo contestar.");
  assert.notEqual(deSabina, delUsuario);
  assert.match(deSabina, /Tú sí tienes acceso a facturación/);
  assert.match(deSabina, /Super Admin/);
  assert.doesNotMatch(deSabina, /No tienes acceso/);
  assert.equal(fraseSinPermiso("billing.view"), delUsuario, "sin causa, la de siempre");
  assert.equal(fraseSinPermiso("billing.view", "apagada"), FRASE_SABINA_APAGADA);

  assert.match(fraseSinPermisoAccion("agendar citas"), /^No tienes permiso para agendar citas/);
  assert.match(fraseSinPermisoAccion("agendar citas", "sabina"), /^Tú sí puedes agendar citas, pero el Super Admin/);
});

test("🔴 la red determinista: si el modelo le dice «no tienes acceso» a quien sí lo tiene, se añade la frase correcta", () => {
  const causa = () => "sabina" as const;
  const mentira = "No tienes acceso a facturación. Hoy tienes 8 citas.";
  const arreglada = garantizarAvisoSinPermiso(mentira, ["billing.view"], causa);
  assert.ok(arreglada.includes(fraseSinPermiso("billing.view", "sabina")), arreglada);

  // Si ya lo dijo bien, no se repite.
  const bien = `${fraseSinPermiso("billing.view", "sabina")} Hoy tienes 8 citas.`;
  assert.equal(garantizarAvisoSinPermiso(bien, ["billing.view"], causa), bien);

  // Y la de siempre sigue igual para quien no lo tiene.
  assert.equal(garantizarAvisoSinPermiso(mentira, ["billing.view"]), mentira);
});

test("la orden al modelo cambia con la causa", () => {
  const res = { ok: false as const, motivo: "sin_permiso" as const, permiso: "billing.view" };
  const deSabina = JSON.parse(resultadoParaModelo(res, { causa: "sabina" }));
  assert.match(deSabina.instruccion, /EL USUARIO SÍ TIENE ESTE PERMISO/);
  assert.ok(deSabina.instruccion.includes(fraseSinPermiso("billing.view", "sabina")));
  const delUsuario = JSON.parse(resultadoParaModelo(res));
  assert.match(delUsuario.instruccion, /NO TIENE ACCESO/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · EL MOTOR ENTERO
 * ══════════════════════════════════════════════════════════════════════ */

function turno(bloques: TurnoModelo["bloques"], stopReason: string): TurnoModelo {
  return { bloques, stopReason, tokensEntrada: 100, tokensSalida: 20, error: null };
}

test("🔴 motor: el doctor sí ve ingresos, el Super Admin se los quitó a Sabina → la base no se toca y la respuesta nombra al Super Admin", async () => {
  const db = base();
  const ctx = { ...(await ctxDe("ADMIN", [], { activa: true, permisos: ["agenda.view", "today.view"] })), db };
  const turnos = [
    turno([{ type: "tool_use", id: "tu_1", name: "ingresos_por_periodo", input: { desde: "2026-09-01", hasta: "2026-09-10" } }], "tool_use"),
    // El modelo se equivoca de razón a propósito.
    turno([{ type: "text", text: "No tienes acceso a facturación." }], "end_turn"),
  ];
  const enviados: any[] = [];
  let i = 0;
  const llamar: LlamarModelo = async (args) => {
    enviados.push(args.messages);
    return turnos[Math.min(i++, turnos.length - 1)];
  };
  const salida = await ejecutarSabina({ ctx, pregunta: "¿cuánto ingresé este mes?", tools: CATALOGO_SABINA, llamar });

  assert.equal(db.contador.llamadas.length, 0, "se consultó la base");
  assert.ok(salida.respuesta.includes(fraseSinPermiso("billing.view", "sabina")), salida.respuesta);
  assert.deepEqual(salida.sinPermiso, ["billing.view"]);
  const ultimo = enviados[1].at(-1).content.find((b: any) => b.type === "tool_result");
  assert.match(JSON.parse(ultimo.content).instruccion, /SÍ TIENE ESTE PERMISO/);
});

test("🔴 motor: apagada → ni una llamada al modelo, ni una consulta", async () => {
  const db = base();
  const ctx = { ...(await ctxDe("ADMIN", [], { activa: false, permisos: [] })), db };
  let llamadas = 0;
  const salida = await ejecutarSabina({
    ctx,
    pregunta: "¿cuántas citas tengo hoy?",
    tools: CATALOGO_SABINA,
    llamar: async () => {
      llamadas += 1;
      return turno([{ type: "text", text: "Tienes 8." }], "end_turn");
    },
  });
  assert.equal(llamadas, 0);
  assert.equal(db.contador.llamadas.length, 0);
  assert.equal(salida.respuesta, FRASE_SABINA_APAGADA);
  assert.equal(salida.fallo, false);
  assert.deepEqual(salida.consumo, [], "no se cobra nada al monedero");
});
