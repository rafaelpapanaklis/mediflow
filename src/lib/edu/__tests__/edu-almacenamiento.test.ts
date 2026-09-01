/**
 * DaleControl INSTITUCIONAL — LA CUOTA DE ALMACENAMIENTO POR INSTITUTO.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-almacenamiento.test.ts
 *
 * Todo sin base de datos: funciones puras, un `where` y lecturas del código
 * fuente para lo que no se puede probar de otra forma sin levantar Postgres
 * (el ORDEN del corte dentro de /sign, por ejemplo).
 *
 * Lo que fija:
 *  1. 🔴 la suma es POR INSTITUTO y las sedes NO la dividen;
 *  2. los UMBRALES 80 / 95 / 100 y la invariante "100 % ⟺ bloqueado";
 *  3. 🔴 el CORTE de la subida, y que va ANTES de firmar;
 *  4. 🔴 QUIÉN VE el medidor: ni ALUMNO, ni DOCENTE, ni CAJA;
 *  5. 🔴 el PRECIO del TB extra vive en UNA constante, y ninguna pantalla
 *     lo escribe a mano;
 *  6. la cuota se VE y no se edita desde el panel de la escuela;
 *  7. el .sql y el esquema dicen los mismos 5 TB que el código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDU_ALM_INCLUIDO_BYTES,
  EDU_ALM_NOTA_ALCANCE,
  EDU_ALM_TB_EXTRA_MXN,
  EDU_ALM_TB_MAX,
  EDU_ALM_TB_MIN,
  EDU_ALM_UMBRAL_AVISO,
  EDU_ALM_UMBRAL_CRITICO,
  EDU_BYTES_POR_TB,
  eduAlmBytesDeTb,
  eduAlmCabe,
  eduAlmCostoExtraMxn,
  eduAlmLleno,
  eduAlmMxnLabel,
  eduAlmNivel,
  eduAlmPorcentaje,
  eduAlmPrecioLabel,
  eduAlmRechazo,
  eduAlmRestanteBytes,
  eduAlmTb,
  eduAlmTbExtra,
  eduAlmTbLabel,
  eduAlmTexto,
  eduAlmValidarTb,
  eduAlmacenamientoWhere,
  type EduAlmMedidor,
} from "../almacenamiento-core";
import { EDU_MAX_STUDY_BYTES, eduFormatBytes } from "../estudios-core";
import { eduPuedeVerAlmacenamiento, EDU_ALMACENAMIENTO_NONE_DETAIL } from "../visibility";
import type { EduRole } from "../types";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/**
 * El código SIN sus comentarios. Varias de estas pruebas miran el fuente, y
 * un comentario que EXPLICA por qué algo no se hace ("EduStudy ni siquiera
 * tiene campusId") no puede hacerlas fallar: entonces la única forma de
 * pasar sería no explicarlo.
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** Todos los archivos .ts/.tsx bajo una carpeta, en profundidad. */
function arbol(...tramos: string[]): { ruta: string; src: string }[] {
  const raiz = join(RAIZ, ...tramos);
  const salida: { ruta: string; src: string }[] = [];
  const pila = [raiz];
  while (pila.length > 0) {
    const dir = pila.pop() as string;
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entrada.name);
      if (entrada.isDirectory()) pila.push(p);
      else if (/\.tsx?$/.test(entrada.name)) salida.push({ ruta: p, src: readFileSync(p, "utf8") });
    }
  }
  return salida;
}

const TB = EDU_BYTES_POR_TB;

/** Un medidor con la cuota por omisión (5 TB) y lo usado que se le diga. */
function medidor(over: Partial<EduAlmMedidor> = {}): EduAlmMedidor {
  return { usadoBytes: 0, cuotaBytes: EDU_ALM_INCLUIDO_BYTES, estudios: 0, ...over };
}

/** Un medidor al X % exacto de su cuota. */
function alPorciento(pct: number, cuotaBytes = EDU_ALM_INCLUIDO_BYTES): EduAlmMedidor {
  // ceil y no round: con round, el 79 % de 5 TB cae en 78.999…% y la
  // prueba del umbral mediría el redondeo del helper y no el umbral.
  return medidor({ cuotaBytes, usadoBytes: Math.ceil((cuotaBytes * pct) / 100) });
}

// ─────────────────────────────────────────────────────────────────────
// 1 · LA CUOTA ES POR INSTITUTO. LAS SEDES NO LA DIVIDEN.
// ─────────────────────────────────────────────────────────────────────

test("el where de la suma tiene UNA sola llave: el instituto", () => {
  const w = eduAlmacenamientoWhere("inst-1");
  assert.deepEqual(w, { institutionId: "inst-1" });
  // La prueba que importa: NADA de campus. En cuanto alguien agregue un
  // campusId "para afinar el reporte", una escuela con dos edificios ve la
  // mitad de su consumo y cree que le sobra el doble de espacio.
  assert.equal(Object.keys(w).length, 1);
  assert.equal("campusId" in w, false);
});

test("un institutionId vacío revienta en vez de sumar el consumo de TODAS las escuelas", () => {
  // En Prisma `where: { institutionId: undefined }` NO devuelve cero filas:
  // BORRA el filtro. Aquí eso sería sumarle a un instituto el consumo del
  // vecino, así que se lanza.
  assert.throws(() => eduAlmacenamientoWhere(""), /institutionId/);
  assert.throws(() => eduAlmacenamientoWhere(undefined as unknown as string), /institutionId/);
});

test("tres sedes con 5 TB son 5 TB entre las tres, no 15", () => {
  // La suma de los estudios de las tres sedes se compara contra UNA cuota.
  const sedeNorte = 2 * TB;
  const sedeSur = 2 * TB;
  const sedeCentro = 1.2 * TB;
  const m = medidor({ usadoBytes: sedeNorte + sedeSur + sedeCentro, estudios: 900 });

  assert.equal(eduAlmLleno(m), true);
  assert.equal(eduAlmPorcentaje(m), 100);
  // Si la cuota se multiplicara por sede (15 TB), esto cabría de sobra.
  assert.equal(eduAlmCabe(m, 1), false);
});

test("el módulo de servidor suma con ese where y no filtra por campus", () => {
  const src = sinComentarios(crudo("src", "lib", "edu", "almacenamiento.ts"));
  assert.match(src, /eduAlmacenamientoWhere\(institutionId\)/);
  // Un aggregate, no traer las filas: una escuela con 40 000 estudios
  // tumbaría la pantalla que intente contarlos en memoria.
  assert.match(src, /prisma\.eduStudy\.aggregate/);
  assert.match(src, /_sum:\s*\{\s*sizeBytes:\s*true\s*\}/);
  assert.equal(/campusId/.test(src), false);
  // El groupBy del /admin agrupa por instituto, no por sede.
  assert.match(src, /by:\s*\["institutionId"\]/);
});

test("el tablero de dirección NO le pasa la sede al medidor", () => {
  // El resto del tablero SÍ se filtra por la sede elegida en la barra
  // superior (dirCtx). El medidor no: la cuota es del instituto.
  const page = crudo("src", "app", "instituto", "(panel)", "direccion", "page.tsx");
  assert.match(page, /getEduAlmacenamientoPanel\(ctx\)/);
  assert.equal(/getEduAlmacenamientoPanel\(dirCtx/.test(page), false);
  assert.equal(/getEduAlmacenamientoPanel\(sede/.test(page), false);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · LOS UMBRALES: 80 ÁMBAR, 95 ROJO, 100 BLOQUEADO
// ─────────────────────────────────────────────────────────────────────

test("los umbrales son 80 y 95", () => {
  assert.equal(EDU_ALM_UMBRAL_AVISO, 80);
  assert.equal(EDU_ALM_UMBRAL_CRITICO, 95);
});

test("verde hasta el 80 %", () => {
  assert.equal(eduAlmNivel(alPorciento(0)), "ok");
  assert.equal(eduAlmNivel(alPorciento(50)), "ok");
  assert.equal(eduAlmNivel(alPorciento(79)), "ok");
  assert.equal(eduAlmPorcentaje(alPorciento(79)), 79);
});

test("ÁMBAR justo al 80 %, y dice cuánto queda", () => {
  const m = alPorciento(80);
  assert.equal(eduAlmNivel(m), "aviso");
  assert.equal(eduAlmPorcentaje(m), 80);
  // 1 TB de 5 TB. El texto tiene que traer el número, no un "ojo".
  assert.equal(eduAlmRestanteBytes(m), TB);
  assert.match(eduAlmTexto(m).titulo, /Queda 1\.0 TB/);
});

test("ROJO al 95 %", () => {
  assert.equal(eduAlmNivel(alPorciento(94)), "aviso");
  assert.equal(eduAlmNivel(alPorciento(95)), "critico");
  assert.equal(eduAlmNivel(alPorciento(99)), "critico");
});

test("al 100 % el medidor DICE que la subida está bloqueada, y qué hacer", () => {
  const m = alPorciento(100);
  assert.equal(eduAlmNivel(m), "lleno");
  assert.equal(eduAlmLleno(m), true);
  assert.equal(eduAlmPorcentaje(m), 100);

  const t = eduAlmTexto(m);
  assert.match(t.titulo, /BLOQUEADA/);
  // Las dos salidas, con todas sus letras: contratar más o liberar espacio.
  assert.match(t.detalle, /contratar más TB/i);
  assert.match(t.detalle, /liberar espacio/i);
  // Y el precio sale de la constante, no de un número tecleado.
  assert.match(t.detalle, new RegExp(String(EDU_ALM_TB_EXTRA_MXN)));
});

test("100 % significa BLOQUEADO y nada más: al 99.6 % todavía se puede subir", () => {
  // La invariante que sostiene la pantalla. El porcentaje se calcula hacia
  // ABAJO justo para esto: redondear al alza pintaría "100 %" (o sea, "no
  // puedes subir") con gigas libres todavía.
  const m = medidor({ cuotaBytes: 5 * TB, usadoBytes: Math.round(5 * TB * 0.996) });
  assert.equal(eduAlmPorcentaje(m), 99);
  assert.equal(eduAlmLleno(m), false);
  assert.equal(eduAlmNivel(m), "critico");
  assert.equal(eduAlmCabe(m, 1024), true);
});

test("pasarse de la cuota no rompe la barra: sigue en 100 y el restante es 0", () => {
  // Puede pasar: dos subidas en vuelo a la vez (ver la carrera de /sign y
  // /confirm). La pantalla tiene que aguantarlo sin pintar 118 %.
  const m = medidor({ usadoBytes: 6 * TB });
  assert.equal(eduAlmPorcentaje(m), 100);
  assert.equal(eduAlmRestanteBytes(m), 0);
  assert.equal(eduAlmNivel(m), "lleno");
});

test("una cuota de cero deja el medidor al 100 y no en blanco", () => {
  const m = medidor({ cuotaBytes: 0, usadoBytes: 0 });
  assert.equal(eduAlmPorcentaje(m), 100);
  assert.equal(eduAlmLleno(m), true);
  assert.equal(eduAlmCabe(m, 1), false);
});

test("el medidor aguanta datos rotos sin inventar espacio", () => {
  const m = medidor({ usadoBytes: NaN as unknown as number, cuotaBytes: 5 * TB });
  assert.equal(eduAlmRestanteBytes(m), 5 * TB);
  assert.equal(eduAlmPorcentaje(m), 0);
});

// ─────────────────────────────────────────────────────────────────────
// 3 · EL CORTE DE LA SUBIDA
// ─────────────────────────────────────────────────────────────────────

test("cabe lo que cabe: el corte es usado + lo que viene contra la cuota", () => {
  const m = medidor({ usadoBytes: 5 * TB - 100 }); // quedan 100 bytes
  assert.equal(eduAlmCabe(m, 100), true);
  assert.equal(eduAlmCabe(m, 101), false);
});

test("el rechazo dice CUÁNTO QUEDA y CUÁNTO PESA el archivo", () => {
  const m = medidor({ usadoBytes: 5 * TB - 200 * 1024 * 1024 }); // quedan 200 MB
  const mensaje = eduAlmRechazo(m, 1024 * 1024 * 1024); // 1 GB
  assert.match(mensaje, /1\.0 GB/); // lo que pesa
  assert.match(mensaje, /200\.0 MB/); // lo que queda
  assert.match(mensaje, /dirección/i); // a quién avisarle
});

test("con la cuota llena el rechazo lo dice, y promete que lo subido no se pierde", () => {
  const mensaje = eduAlmRechazo(alPorciento(100), 1024);
  assert.match(mensaje, /lleno/i);
  assert.match(mensaje, /no se pierde/i);
});

test("🔴 el corte vive en /sign y va ANTES de firmar la URL", () => {
  const src = crudo("src", "lib", "edu", "estudios.ts");
  const iCorte = src.indexOf("eduAlmCabe(medidor, declared)");
  const iFirma = src.indexOf("await eduSignUpload(path)");
  assert.ok(iCorte > 0, "el corte de cuota no está en estudios.ts");
  assert.ok(iFirma > 0, "no se encontró la firma de la URL");
  // Firmar primero significa que alguien se pasa veinte minutos subiendo
  // una tomografía que iba a rebotar igual.
  assert.ok(iCorte < iFirma, "el corte de cuota tiene que ir ANTES de firmar");
  // 507 y no 413: el archivo no es demasiado grande, es la escuela la que
  // no tiene sitio.
  assert.match(src, /eduAlmRechazo\(medidor, declared\),\s*507/);
});

test("los DOS topes siguen valiendo: el del archivo y el de la escuela", () => {
  const src = crudo("src", "lib", "edu", "estudios.ts");
  // El de 2 GB por archivo no se tocó.
  assert.match(src, /declared > EDU_MAX_STUDY_BYTES/);
  assert.equal(EDU_MAX_STUDY_BYTES, 2 * 1024 * 1024 * 1024);
  // Y son distintos: un archivo de 1 GB pasa el primero y no el segundo si
  // a la escuela le quedan 200 MB.
  const m = medidor({ usadoBytes: 5 * TB - 200 * 1024 * 1024 });
  const unGiga = 1024 * 1024 * 1024;
  assert.ok(unGiga < EDU_MAX_STUDY_BYTES);
  assert.equal(eduAlmCabe(m, unGiga), false);
});

test("🔴 /confirm NO rechaza por cuota: registra y deja rastro", () => {
  const src = crudo("src", "lib", "edu", "estudios.ts");
  // El mensaje de rechazo por cuota aparece UNA sola vez en todo el
  // archivo: en /sign. Si apareciera dos, /confirm estaría tirando
  // radiografías que alguien ya subió enteras por una carrera que no podía
  // ver.
  assert.equal(src.split("eduAlmRechazo(").length - 1, 1);
  // Y lo que sí hace es dejar el rebase auditable.
  assert.match(src, /cuota rebasada por una subida en vuelo/);
  // La decisión está escrita, no implícita.
  const doc = crudo("src", "lib", "edu", "almacenamiento.ts");
  assert.match(doc, /LA CARRERA ENTRE \/sign Y \/confirm/);
});

test("el 507 del corte llega a la pantalla con palabras, no como un 413 mudo", () => {
  // El cliente de subida convierte CUALQUIER respuesta no-ok de /sign en el
  // texto que mandó el servidor, y la pantalla lo pinta en su alerta.
  const cliente = crudo("src", "components", "edu", "expediente", "edu-upload-client.ts");
  assert.match(cliente, /if \(!firmaRes\.ok\)/);
  assert.match(cliente, /mensajeDeError\(firmaRes/);
  assert.match(cliente, /body\.error/);
  const pantalla = crudo("src", "components", "edu", "expediente", "estudios-screen.tsx");
  assert.match(pantalla, /err instanceof Error \? err\.message/);
});

// ─────────────────────────────────────────────────────────────────────
// 4 · QUIÉN VE EL MEDIDOR
// ─────────────────────────────────────────────────────────────────────

test("solo DIRECCION ve el medidor", () => {
  assert.equal(eduPuedeVerAlmacenamiento({ role: "DIRECCION", eduUserId: "u1" }), true);
});

test("🔴 ni ALUMNO, ni DOCENTE, ni CAJA alcanzan el medidor", () => {
  for (const role of ["ALUMNO", "DOCENTE", "CAJA"] as EduRole[]) {
    assert.equal(
      eduPuedeVerAlmacenamiento({ role, eduUserId: "u1" }),
      false,
      `${role} no debería ver la cuota de almacenamiento`,
    );
  }
});

test("un rol que todavía no existe tampoco lo ve (lista blanca, no negra)", () => {
  // Si mañana el enum gana COORDINADOR o RECTOR, la respuesta por omisión
  // tiene que ser "no", no "se me olvidó agregarlo a los que no".
  assert.equal(eduPuedeVerAlmacenamiento({ role: "RECTOR" as EduRole, eduUserId: "u1" }), false);
  assert.equal(eduPuedeVerAlmacenamiento(null as unknown as { role: EduRole; eduUserId: string }), false);
});

test("el alcance lo decide visibility.ts y la pantalla solo obedece", () => {
  const server = crudo("src", "lib", "edu", "almacenamiento.ts");
  assert.match(server, /if \(!eduPuedeVerAlmacenamiento\(ctx\)\) return null;/);
  const page = crudo("src", "app", "instituto", "(panel)", "direccion", "page.tsx");
  // La página pide el medidor por la puerta CON cerradura, no por la que
  // usa el corte de la subida.
  assert.match(page, /getEduAlmacenamientoPanel/);
  assert.equal(/getEduAlmacenamientoMedidor/.test(page), false);
  // Y hay un texto para quien no lo ve, en el mismo sitio que los demás.
  assert.match(EDU_ALMACENAMIENTO_NONE_DETAIL, /dirección/i);
});

test("el corte de la subida NO lleva cerradura de rol: un alumno también sube", () => {
  // Si el corte pasara por eduPuedeVerAlmacenamiento, la cuota solo se
  // aplicaría a la dirección — o sea, a nadie.
  const server = crudo("src", "lib", "edu", "almacenamiento.ts");
  const i = server.indexOf("export async function getEduAlmacenamientoMedidor");
  const j = server.indexOf("export async function getEduAlmacenamientoPanel");
  assert.ok(i > 0 && j > i);
  const cuerpoMedidor = server.slice(i, j);
  assert.equal(/eduPuedeVerAlmacenamiento/.test(cuerpoMedidor), false);
});

// ─────────────────────────────────────────────────────────────────────
// 5 · EL PRECIO DEL TB EXTRA — UNA SOLA CONSTANTE
// ─────────────────────────────────────────────────────────────────────

test("el TB extra cuesta $400 MXN al mes, y ese número vive en UNA constante", () => {
  assert.equal(EDU_ALM_TB_EXTRA_MXN, 400);
  assert.match(eduAlmPrecioLabel(), /\$400 MXN al mes por TB extra/);
});

test("🔴 ninguna pantalla escribe el precio a mano", () => {
  const pantallas = [
    ["src", "app", "admin", "institutos", "institutos-client.tsx"],
    ["src", "app", "admin", "institutos", "page.tsx"],
    ["src", "components", "edu", "direccion", "almacenamiento-card.tsx"],
  ];
  for (const ruta of pantallas) {
    const src = crudo(...ruta);
    const nombre = ruta.join("/");
    // Un "$400" o un "400 MXN" tecleado aquí es el bug: el día que el
    // precio suba, la mitad de las pantallas seguiría cobrando el viejo.
    assert.equal(/\$\s*400/.test(src), false, `${nombre} tiene el precio escrito a mano`);
    assert.equal(/400\s*MXN/.test(src), false, `${nombre} tiene el precio escrito a mano`);
    // Y tampoco lo multiplican por su cuenta.
    assert.equal(/\*\s*400\b/.test(src), false, `${nombre} multiplica por el precio a mano`);
  }
});

test("la cuenta del extra: contratados − 5 incluidos, por el precio", () => {
  assert.equal(eduAlmCostoExtraMxn(5 * TB), 0); // lo incluido no se factura
  assert.equal(eduAlmCostoExtraMxn(1 * TB), 0); // por debajo, tampoco (nunca negativo)
  assert.equal(eduAlmCostoExtraMxn(10 * TB), 5 * EDU_ALM_TB_EXTRA_MXN); // 2 000
  assert.equal(eduAlmCostoExtraMxn(20 * TB), 15 * EDU_ALM_TB_EXTRA_MXN); // 6 000
  assert.equal(eduAlmCostoExtraMxn(50 * TB), 45 * EDU_ALM_TB_EXTRA_MXN); // 18 000
});

test("la cuota puede valer 10, 20 o 50 TB sin tocar código", () => {
  for (const tb of [10, 20, 50, 137]) {
    const bytes = eduAlmBytesDeTb(tb);
    assert.equal(eduAlmTb(bytes), tb);
    assert.equal(eduAlmTbExtra(bytes), tb - 5);
    assert.equal(eduAlmValidarTb(tb), null);
  }
});

test("los TB se teclean enteros y dentro de unos topes", () => {
  assert.equal(eduAlmValidarTb(EDU_ALM_TB_MIN), null);
  assert.equal(eduAlmValidarTb(EDU_ALM_TB_MAX), null);
  assert.match(eduAlmValidarTb(0) ?? "", /mínima/);
  assert.match(eduAlmValidarTb(-3) ?? "", /mínima/);
  assert.match(eduAlmValidarTb(EDU_ALM_TB_MAX + 1) ?? "", /máxima/);
  assert.match(eduAlmValidarTb(7.5) ?? "", /enteros/);
  assert.match(eduAlmValidarTb("diez") ?? "", /Escribe/);
});

test("las etiquetas del /admin se leen como un contrato", () => {
  assert.equal(eduAlmTbLabel(5 * TB), "5 TB");
  assert.equal(eduAlmTbLabel(eduAlmBytesDeTb(20)), "20 TB");
  assert.equal(eduAlmTbLabel(1.5 * TB), "1.5 TB");
  assert.equal(eduAlmMxnLabel(6000), "$6,000 MXN");
});

// ─────────────────────────────────────────────────────────────────────
// 6 · SE VE, NO SE EDITA (desde el panel de la escuela)
// ─────────────────────────────────────────────────────────────────────

test("🔴 ningún endpoint del instituto escribe la cuota", () => {
  // La única escritura del producto sale del /admin de DaleControl. Si
  // apareciera una aquí, el cobro por TB extra dejaría de existir.
  // Ni un solo archivo bajo /api/instituto la nombra siquiera.
  for (const { ruta, src } of arbol("src", "app", "api", "instituto")) {
    assert.equal(
      /storageQuotaBytes/.test(src),
      false,
      `${ruta} toca la cuota, y esa columna no se escribe desde el panel`,
    );
  }
  // Y en el dominio hay UNA escritura, la del /admin.
  const server = crudo("src", "lib", "edu", "almacenamiento.ts");
  assert.equal(
    server.split("data: { storageQuotaBytes:").length - 1,
    1,
    "solo puede haber UN update de la cuota",
  );
  const i = server.indexOf("export async function setEduAlmacenamientoCuotaTb");
  assert.ok(i > 0 && server.indexOf("data: { storageQuotaBytes:") > i, "y vive en la puerta del /admin");
  const tarjeta = crudo("src", "components", "edu", "direccion", "almacenamiento-card.tsx");
  assert.equal(/<button/.test(tarjeta), false, "la tarjeta de dirección no tiene botones");
  assert.equal(/<form/.test(tarjeta), false, "la tarjeta de dirección no tiene formulario");
});

test("la escritura del /admin vuelve a exigir sesión de administrador", () => {
  // Una server action es un POST que se alcanza sin pasar por ningún
  // layout: confiar en el layout dejaría la cuota escribible por cualquiera.
  const actions = crudo("src", "app", "admin", "institutos", "actions.ts");
  assert.match(actions, /const admin = await getAdminSession\(\);/);
  assert.match(actions, /if \(!admin\) return \{ ok: false, error: "No autorizado" \};/);
  // Y deja rastro: subir una cuota cambia lo que se le factura a un cliente.
  assert.match(actions, /ADMIN_AUDIT/);
});

test("el instituto NO entra a Stripe por esta puerta", () => {
  // Se mide por los IMPORTS y no por la palabra: las dos pantallas DICEN
  // que el contrato no pasa por Stripe, y decirlo no puede fallar la prueba.
  const archivos = [
    crudo("src", "lib", "edu", "almacenamiento.ts"),
    crudo("src", "app", "admin", "institutos", "institutos-client.tsx"),
    crudo("src", "app", "admin", "institutos", "actions.ts"),
    crudo("src", "app", "admin", "institutos", "page.tsx"),
  ];
  for (const src of archivos) {
    assert.equal(
      /import[^;]*stripe/i.test(src),
      false,
      "el contrato institucional se administra a mano, sin Stripe",
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// 7 · LOS 5 TB DICEN LO MISMO EN LOS TRES SITIOS
// ─────────────────────────────────────────────────────────────────────

test("5 TB son 5 497 558 138 880 bytes", () => {
  assert.equal(EDU_BYTES_POR_TB, 1024 ** 4);
  assert.equal(EDU_ALM_INCLUIDO_BYTES, 5 * 1024 ** 4);
  assert.equal(EDU_ALM_INCLUIDO_BYTES, 5497558138880);
});

test("el esquema y el .sql traen EL MISMO default que la constante", () => {
  const esquema = crudo("prisma", "schema.prisma");
  assert.match(esquema, /storageQuotaBytes BigInt @default\(5497558138880\)/);

  const sql = crudo("sql", "edu-cuota-storage.sql");
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS "storageQuotaBytes" BIGINT NOT NULL DEFAULT 5497558138880/,
  );
  // Idempotente y sin DROP, como todos los .sql del vertical.
  assert.equal(/DROP /i.test(sql), false);
  assert.match(sql, /\$edu\$/);
});

test("un instituto nuevo nace con los 5 TB incluidos", () => {
  // El default de la columna hace de backfill para las filas que ya
  // existen: no hace falta UPDATE y ningún instituto se queda en cero.
  const m = medidor();
  assert.equal(m.cuotaBytes, EDU_ALM_INCLUIDO_BYTES);
  assert.equal(eduAlmTbExtra(m.cuotaBytes), 0);
  assert.equal(eduAlmCostoExtraMxn(m.cuotaBytes), 0);
  assert.equal(eduAlmNivel(m), "ok");
});

// ─────────────────────────────────────────────────────────────────────
// 8 · EL FORMATEADOR ES EL QUE YA EXISTÍA
// ─────────────────────────────────────────────────────────────────────

test("eduFormatBytes aprendió TB y no olvidó lo de antes", () => {
  assert.equal(eduFormatBytes(5 * TB), "5.0 TB");
  assert.equal(eduFormatBytes(EDU_MAX_STUDY_BYTES), "2.0 GB");
  assert.equal(eduFormatBytes(1024 * 1024), "1.0 MB");
  assert.equal(eduFormatBytes(0), "0 B");
  assert.equal(eduFormatBytes(-1), "—");
});

test("no hay un SEGUNDO formateador de bytes en el vertical", () => {
  // Con dos, el día que cambie el redondeo la misma escuela leería "5.0 TB"
  // en un sitio y "5120.0 GB" en otro, y nadie sabría cuál está bien.
  const core = crudo("src", "lib", "edu", "almacenamiento-core.ts");
  assert.match(core, /import \{ eduFormatBytes \} from "@\/lib\/edu\/estudios-core"/);
  assert.equal(/function eduFormat/.test(core), false);
});

test("el medidor CONFIESA que cuenta estudios y no todo el bucket", () => {
  // Las firmas de consentimiento viven en el mismo bucket y no tienen fila
  // con su tamaño. No se estiman: un medidor que inventa bytes es peor que
  // no tener medidor, porque se le cree.
  assert.match(EDU_ALM_NOTA_ALCANCE, /ESTUDIOS/);
  assert.match(EDU_ALM_NOTA_ALCANCE, /firmas de consentimiento/i);
  assert.match(EDU_ALM_NOTA_ALCANCE, /no inventa bytes/i);

  const tarjeta = crudo("src", "components", "edu", "direccion", "almacenamiento-card.tsx");
  assert.match(tarjeta, /EDU_ALM_NOTA_ALCANCE/);
  assert.match(tarjeta, /estudios/);
});
