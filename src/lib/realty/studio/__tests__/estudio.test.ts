import "./_sin-server-only"; // ← PRIMERO, antes de nada del servidor.

// ═══════════════════════════════════════════════════════════════════════
// Pruebas del ESTUDIO IA. Sin base de datos y sin red.
//
// Cubren las DOS reglas que no se negocian —el tope de gasto y la marca de
// agua quemada— y la matemática que las sostiene. La marca se prueba
// COMPONIENDO UNA IMAGEN DE VERDAD con sharp y mirando los píxeles: que una
// función se llame `burnIllustrativeWatermark` no prueba que queme nada.
// ═══════════════════════════════════════════════════════════════════════
import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";

// El diccionario se importa como módulo (resolveJsonModule) y no con
// require(): es lo mismo que hace la página, así que si un día el JSON deja
// de ser válido, esta prueba se cae por la misma razón que el build.
import studioDict from "@/i18n/dictionaries/realty/studio.json";

import {
  buildStudioSpend,
  dailyCapMicros,
  formatMicrosUsd,
  microsToUsd,
  monthAnchorUtc,
  STAGING_IMAGE_MICROS,
  studioFits,
  textCallMicros,
  usdToMicros,
} from "@/lib/realty/studio/pricing";
import {
  isRealtyAiPhoto,
  REALTY_AI_PHOTO_PREFIX,
  REALTY_COPY_TONES,
  REALTY_REEL_TEMPLATES,
  REALTY_STAGING_STYLES,
  REALTY_STAGING_WATERMARK,
} from "@/lib/realty/studio/types";
import {
  buildReelPlan,
  formatReelDuration,
  reelRecordedMs,
} from "@/lib/realty/studio/reel-plan";
import {
  parseSocial,
  photosForVision,
  VISION_MAX_EDGE,
  VISION_MAX_PHOTOS,
} from "@/lib/realty/studio/copy";
import { burnIllustrativeWatermark } from "@/lib/realty/studio/staging";

// ── EL TOPE ─────────────────────────────────────────────────────────────

test("el tope NO se puede apagar con una variable de entorno mal puesta", () => {
  const porDefecto = usdToMicros(2);
  // Un dedazo, un vacío o un cero NO pueden dejar la IA sin freno.
  for (const malo of ["", "0", "-5", "abc", "  ", "NaN", undefined]) {
    assert.equal(dailyCapMicros(malo), porDefecto, `"${malo}" apagó el tope`);
  }
  // "Infinity" es el caso feo: Number("Infinity") sí es un número > 0, pero
  // no es FINITO, y usdToMicros(Infinity) daría un tope que nadie alcanza.
  assert.equal(dailyCapMicros("Infinity"), porDefecto, "Infinity apagó el tope");
  // Un valor legítimo sí se respeta.
  assert.equal(dailyCapMicros("10"), usdToMicros(10));
});

test("studioFits cierra la puerta justo en el borde, no un peso después", () => {
  const cap = usdToMicros(2);
  assert.equal(studioFits(cap - 1, cap), true, "un micro antes todavía cabe");
  assert.equal(studioFits(cap, cap), false, "EN el tope ya no cabe");
  assert.equal(studioFits(cap + 1, cap), false, "pasado el tope no cabe");
  // Un tope de cero no es "sin límite": es que no se puede gastar.
  assert.equal(studioFits(0, 0), false, "cap 0 dejó gastar");
});

test("buildStudioSpend nunca reporta restante negativo ni se pasa de 100 %", () => {
  const cap = usdToMicros(2);
  const pasado = buildStudioSpend({
    spentMicros: cap * 3,
    capMicros: cap,
    monthMicros: cap * 9,
    resetsAt: new Date("2026-08-26T06:00:00Z"),
  });
  assert.equal(pasado.remainingMicros, 0, "restante negativo");
  assert.equal(pasado.exhausted, true);
  // Agotado NO es "cerca del límite": son avisos distintos y la pantalla
  // enseña uno u otro, nunca los dos.
  assert.equal(pasado.nearLimit, false);

  const cerca = buildStudioSpend({
    spentMicros: Math.round(cap * 0.85),
    capMicros: cap,
    monthMicros: cap,
    resetsAt: new Date(),
  });
  assert.equal(cerca.exhausted, false);
  assert.equal(cerca.nearLimit, true, "al 85 % debería avisar");

  const holgado = buildStudioSpend({
    spentMicros: Math.round(cap * 0.5),
    capMicros: cap,
    monthMicros: cap,
    resetsAt: new Date(),
  });
  assert.equal(holgado.nearLimit, false, "al 50 % no debe alarmar");
});

test("el costo del texto se cobra por el modelo REAL y se redondea hacia arriba", () => {
  // Opus 5: $5 de entrada y $25 de salida por millón de tokens (tabla
  // pública). 1000 entrada + 500 salida = 5000 + 12500 = 17 500 micros.
  assert.equal(
    textCallMicros({ model: "claude-opus-5", inputTokens: 1000, outputTokens: 500 }),
    17_500,
  );
  // Haiku es 5 veces más barato que Opus: el mismo trabajo NO puede costar
  // lo mismo, o el tope estaría midiendo una tarifa que nadie aplicó.
  const opus = textCallMicros({ model: "claude-opus-5", inputTokens: 1000, outputTokens: 500 });
  const haiku = textCallMicros({ model: "claude-haiku-4-5", inputTokens: 1000, outputTokens: 500 });
  assert.equal(haiku * 5, opus);
  // Un modelo desconocido NO puede salir gratis: cae a la tarifa más cara.
  assert.equal(
    textCallMicros({ model: "modelo-que-no-existe", inputTokens: 1000, outputTokens: 500 }),
    17_500,
  );
  // Nada de cobrar de menos por redondeo, y nada de negativos.
  assert.ok(textCallMicros({ model: "claude-opus-5", inputTokens: 1, outputTokens: 0 }) >= 1);
  assert.equal(textCallMicros({ model: "claude-opus-5", inputTokens: -5, outputTokens: -5 }), 0);
});

test("una imagen cuesta MUCHO más que un texto — por eso tiene su propio freno", () => {
  const texto = textCallMicros({ model: "claude-opus-5", inputTokens: 1200, outputTokens: 400 });
  assert.ok(
    STAGING_IMAGE_MICROS > texto * 10,
    `la imagen (${STAGING_IMAGE_MICROS}) debería costar >10x el texto (${texto})`,
  );
  // Con el tope de 2 USD deben caber al menos unas cuantas imágenes al día:
  // un tope que solo alcanza para una no sirve para trabajar.
  const caben = Math.floor(usdToMicros(2) / STAGING_IMAGE_MICROS);
  assert.ok(caben >= 5 && caben <= 40, `caben ${caben} imágenes al día`);
});

test("el dinero se cuenta en enteros: sumar 80 veces no arrastra decimales", () => {
  let total = 0;
  for (let i = 0; i < 80; i++) {
    total += textCallMicros({ model: "claude-opus-5", inputTokens: 900, outputTokens: 300 });
  }
  assert.equal(Number.isInteger(total), true, "el total dejó de ser entero");
  assert.equal(total, 80 * (900 * 5 + 300 * 25));
});

test("el costo se enseña con decimales suficientes para no parecer todo igual", () => {
  // Con dos decimales, TODAS las generaciones de texto dirían "$0.02".
  assert.notEqual(formatMicrosUsd(usdToMicros(0.017)), formatMicrosUsd(usdToMicros(0.023)));
  assert.equal(formatMicrosUsd(usdToMicros(1.5)), "$1.50 USD");
  // Un negativo no se pinta como deuda.
  assert.equal(formatMicrosUsd(-999), "$0.000 USD");
  assert.equal(microsToUsd(usdToMicros(0.19)).toFixed(2), "0.19");
});

// ── LA MARCA DE AGUA (con sharp de verdad) ──────────────────────────────

/** Una imagen lisa del color que se pida, para medir contra ella. */
async function lienzo(width: number, height: number, gris: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({
    create: { width, height, channels: 3, background: { r: gris, g: gris, b: gris } },
  })
    .jpeg()
    .toBuffer();
}

/** Brillo promedio (0-255) de una franja horizontal de la imagen. */
async function brilloDeLaFranja(
  buf: Buffer,
  desdeArriba: number,
  alto: number,
): Promise<number> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const franja = await sharp(buf)
    .extract({ left: 0, top: desdeArriba, width: w, height: alto })
    .greyscale()
    .raw()
    .toBuffer();
  let suma = 0;
  for (let i = 0; i < franja.length; i++) suma += franja[i];
  return suma / franja.length;
}

test("la marca QUEMA píxeles de verdad: la franja de abajo se oscurece", async () => {
  const W = 1024;
  const H = 1024;
  // Un lienzo BLANCO: si la marca no pinta nada, la franja seguirá blanca.
  const original = await lienzo(W, H, 255);
  const marcada = await burnIllustrativeWatermark(original);

  const sharp = (await import("sharp")).default;
  const meta = await sharp(marcada).metadata();
  assert.equal(meta.width, W, "la marca cambió el ancho");
  assert.equal(meta.height, H, "la marca cambió el alto");
  assert.equal(meta.format, "jpeg");

  const banda = Math.max(44, Math.round(H * 0.08));
  const abajoAntes = await brilloDeLaFranja(original, H - banda, banda);
  const abajoDespues = await brilloDeLaFranja(marcada, H - banda, banda);

  assert.ok(abajoAntes > 240, `el lienzo no era blanco (${abajoAntes})`);
  assert.ok(
    abajoDespues < 160,
    `la franja de la marca no se oscureció: ${abajoAntes} → ${abajoDespues}`,
  );

  // Y la FOTO no se destruyó: arriba sigue blanco.
  const arriba = await brilloDeLaFranja(marcada, 0, Math.round(H * 0.3));
  assert.ok(arriba > 240, `la marca manchó la foto entera (arriba: ${arriba})`);
});

test("la marca sobrevive a formas raras: panorámica larga y miniatura", async () => {
  for (const [W, H] of [
    [2000, 300], // panorámica: una banda al 8 % serían 24 px, ilegible
    [200, 200], // miniatura
    [640, 1600], // vertical de teléfono
  ] as Array<[number, number]>) {
    const marcada = await burnIllustrativeWatermark(await lienzo(W, H, 255));
    const sharp = (await import("sharp")).default;
    const meta = await sharp(marcada).metadata();
    assert.equal(meta.width, W, `${W}x${H}: cambió el ancho`);
    assert.equal(meta.height, H, `${W}x${H}: cambió el alto`);

    const banda = Math.max(44, Math.round(H * 0.08));
    // El mínimo de 44 px existe justo para la panorámica.
    assert.ok(banda >= 44, `${W}x${H}: banda de ${banda}px`);
    assert.ok(banda <= H, `${W}x${H}: la banda (${banda}) no cabe en el alto`);

    const oscura = await brilloDeLaFranja(marcada, H - banda, banda);
    assert.ok(oscura < 170, `${W}x${H}: la franja no se marcó (brillo ${oscura})`);
  }
});

test("la marca falla CERRADO: una entrada que no es imagen no devuelve nada sin marcar", async () => {
  await assert.rejects(
    () => burnIllustrativeWatermark(Buffer.from("esto no es una imagen")),
    "aceptó basura en vez de lanzar — devolver el buffer tal cual dejaría salir una imagen sin marca",
  );
});

test("el texto de la marca es el que dice la ley, y no se configura", () => {
  assert.equal(REALTY_STAGING_WATERMARK, "IMAGEN ILUSTRATIVA");
  // Una marca que se pueda pisar desde el entorno no es una marca.
  assert.equal(burnIllustrativeWatermark.length, 1, "la función acepta más de un argumento");
});

test("una foto generada se reconoce por su nombre, venga como path o URL firmada", () => {
  const path = `cuenta1/inmueble9/fotos/${REALTY_AI_PHOTO_PREFIX}m4x-a1b2c3.jpg`;
  assert.equal(isRealtyAiPhoto(path), true);
  assert.equal(isRealtyAiPhoto(`https://x.supabase.co/${path}?token=abc&x=1`), true);
  // Una foto normal NO puede confundirse.
  assert.equal(isRealtyAiPhoto("cuenta1/inmueble9/fotos/1699-portada.jpg"), false);
  // Y un inmueble que se llame "ia-algo" no contamina la carpeta de fotos.
  assert.equal(isRealtyAiPhoto("cuenta1/ia-loft/fotos/1699.jpg"), false);
  assert.equal(isRealtyAiPhoto(null), false);
  assert.equal(isRealtyAiPhoto(""), false);
});

// ── EL REEL ─────────────────────────────────────────────────────────────

const INMUEBLE = {
  title: "Casa en Providencia",
  price: "$4,850,000 MXN",
  operation: "VENTA",
  bedrooms: 3,
  bathrooms: 2,
  parking: 2,
  builtM2: 180,
  colonia: "Providencia",
  city: "Guadalajara",
  photoUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"],
};

test("sin fotos NO hay reel: se dice, en vez de entregar un video negro", () => {
  const plan = buildReelPlan({
    property: { ...INMUEBLE, photoUrls: [] },
    template: "recorrido",
    accountName: "Inmobiliaria X",
    logoUrl: null,
    cta: "Escríbenos",
  });
  assert.equal(plan, null);
  // Las cadenas vacías tampoco cuentan como foto.
  assert.equal(
    buildReelPlan({
      property: { ...INMUEBLE, photoUrls: ["", ""] },
      template: "recorrido",
      accountName: "X",
      logoUrl: null,
      cta: "c",
    }),
    null,
  );
});

test("el reel sale en 9:16 REAL — lo que recortan TikTok y Reels es el precio", () => {
  const plan = buildReelPlan({
    property: INMUEBLE,
    template: "recorrido",
    accountName: "Inmobiliaria X",
    logoUrl: null,
    cta: "Escríbenos: 33 1234 5678",
  });
  assert.ok(plan);
  assert.equal(plan!.width, 1080);
  assert.equal(plan!.height, 1920);
  assert.equal(plan!.width / plan!.height, 9 / 16);
  assert.ok(plan!.totalMs > 0);
  assert.equal(formatReelDuration(14_300), "14.3 s");
});

test("las tres plantillas cambian el RITMO, no un color", () => {
  const hacer = (template: "recorrido" | "antes-de-que-se-vaya" | "tour-rapido") =>
    buildReelPlan({
      property: INMUEBLE,
      template,
      accountName: "X",
      logoUrl: null,
      cta: "c",
    })!;

  const recorrido = hacer("recorrido");
  const rapido = hacer("tour-rapido");
  // Un "tour rápido" con fotos de 2.6 s no es un tour rápido.
  assert.ok(
    rapido.scenes[0].durationMs < recorrido.scenes[0].durationMs,
    "el tour rápido no es más rápido",
  );
  // El gancho de la primera pantalla es distinto en cada plantilla.
  assert.notEqual(recorrido.scenes[0].title, hacer("antes-de-que-se-vaya").scenes[0].title);
});

test("el reel no pone letrero en todas las escenas ni deja la primera muda", () => {
  const plan = buildReelPlan({
    property: INMUEBLE,
    template: "recorrido",
    accountName: "X",
    logoUrl: null,
    cta: "Escríbenos",
  })!;
  assert.ok(plan.scenes[0].title, "la primera escena se quedó sin gancho");
  const conTexto = plan.scenes.filter((s) => s.title).length;
  assert.ok(conTexto < plan.scenes.length, "TODAS las escenas llevan letrero: parece anuncio");
  // El precio aparece en algún lado: es el dato que decide si siguen viendo.
  assert.ok(plan.scenes.some((s) => s.title === INMUEBLE.price), "el precio no sale nunca");
  // Y el zoom alterna, para que dos fotos seguidas no se sientan iguales.
  assert.notEqual(plan.scenes[0].zoomFrom, plan.scenes[1].zoomFrom);
});

test("el reel no se alarga sin fin aunque el inmueble tenga 40 fotos", () => {
  const plan = buildReelPlan({
    property: { ...INMUEBLE, photoUrls: Array.from({ length: 40 }, (_, i) => `f${i}.jpg`) },
    template: "tour-rapido",
    accountName: "X",
    logoUrl: null,
    cta: "c",
  })!;
  assert.ok(plan.scenes.length <= 10, `${plan.scenes.length} escenas es un reel que nadie ve`);
  assert.ok(plan.totalMs < 60_000, "más de un minuto para un reel vertical");
});

// ── LOS TEXTOS ──────────────────────────────────────────────────────────

test("los hashtags conservan los acentos y la ñ", () => {
  const r = parseSocial(
    [
      "POST:",
      "Tres recámaras a dos cuadras del parque.",
      "",
      "HASHTAGS:",
      "#CasasEnMichoacán #Providencia #BienesRaícesMX #Guadalajara #niños_felices",
      "",
      "COMENTARIO:",
      "Escríbenos por mensaje directo.",
    ].join("\n"),
  );
  assert.ok(r.hashtags.includes("CasasEnMichoacán"), `se cortó el acento: ${r.hashtags}`);
  assert.ok(r.hashtags.includes("BienesRaícesMX"));
  assert.ok(r.hashtags.includes("niños_felices"));
  assert.ok(!r.post.includes("#"), "los hashtags se colaron en el post");
  assert.equal(r.firstComment, "Escríbenos por mensaje directo.");
});

test("si el modelo ignora las etiquetas, el texto NO se pierde", () => {
  // Degradar a "todo en el post" es útil; tirar la generación pagada, no.
  const crudo = "Casa de 3 recámaras en Providencia, lista para entregar.";
  const r = parseSocial(crudo);
  assert.equal(r.post, crudo);
  assert.deepEqual(r.hashtags, []);
  assert.equal(r.firstComment, "");
});

test("los hashtags no se repiten ni desbordan la lista", () => {
  const r = parseSocial(
    `POST:\nHola\n\nHASHTAGS:\n${Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(" ")} #tag1 #tag1`,
  );
  assert.equal(r.hashtags.length, 15, "no se recortó a 15");
  assert.equal(new Set(r.hashtags).size, r.hashtags.length, "hay hashtags repetidos");
});

// ── EL PLAN Y EL GRABADOR NO PUEDEN CONTRADECIRSE ───────────────────────

test("la duración que promete el plan es la que el navegador va a grabar", () => {
  for (const template of ["recorrido", "antes-de-que-se-vaya", "tour-rapido"] as const) {
    const plan = buildReelPlan({
      property: INMUEBLE,
      template,
      accountName: "X",
      logoUrl: null,
      cta: "c",
    })!;
    // El grabador recorre las escenas y para en la suma de sus duraciones.
    // Si el plan restara los cruces (como un editor con solapamiento real),
    // la pantalla diría "11.3 s" para un archivo de 13 s.
    assert.equal(
      plan.totalMs,
      reelRecordedMs(plan.scenes),
      `${template}: el plan promete ${plan.totalMs} ms y se graban ${reelRecordedMs(plan.scenes)} ms`,
    );
    // Y el cruce NO puede ser lo que separe a los dos: es un encimado en la
    // cola de cada escena, no un adelanto de la siguiente.
    assert.notEqual(
      plan.totalMs,
      reelRecordedMs(plan.scenes) - plan.crossfadeMs * (plan.scenes.length - 1),
      `${template}: volvió a descontarse el cruce`,
    );
  }
});

test("reelRecordedMs mide lo que SÍ cargó, no lo que se planeó", () => {
  // El navegador descarta las fotos que no bajaron; si una de cinco falla,
  // el video dura cuatro escenas y la barra de progreso tiene que saberlo.
  assert.equal(reelRecordedMs([{ durationMs: 1000 }, { durationMs: 1500 }]), 2500);
  assert.equal(reelRecordedMs([]), 0);
  // Una duración corrupta no puede acortar el total por debajo de cero.
  assert.equal(reelRecordedMs([{ durationMs: -9000 }, { durationMs: 1000 }]), 1000);
});

// ── EL MES DEL PANEL ────────────────────────────────────────────────────

test("el mes empieza en la zona de la CUENTA, no seis horas antes", () => {
  const TZ = "America/Mexico_City";
  // 2026-08-01T02:00Z son todavía las 20:00 del 31 de JULIO en México: el
  // mes en curso es julio, y el corte tiene que ser el 1 de julio.
  const finDeJulio = monthAnchorUtc(new Date("2026-08-01T02:00:00Z"), TZ);
  assert.equal(finDeJulio.getUTCFullYear(), 2026);
  assert.equal(finDeJulio.getUTCMonth(), 6, "se adelantó a agosto estando aún en julio");
  assert.equal(finDeJulio.getUTCDate(), 1);

  // Seis horas después ya es 1 de agosto en México.
  const yaAgosto = monthAnchorUtc(new Date("2026-08-01T08:00:00Z"), TZ);
  assert.equal(yaAgosto.getUTCMonth(), 7, "no entró en agosto");

  // El ancla es MEDIODÍA UTC para que ningún horario de verano la empuje al
  // día anterior al bajarla a la medianoche local.
  assert.equal(yaAgosto.getUTCHours(), 12);
  assert.equal(yaAgosto.getUTCDate(), 1);

  // Una zona horaria basura NO puede tumbar el panel de consumo.
  const roto = monthAnchorUtc(new Date("2026-08-15T12:00:00Z"), "No/Existe");
  assert.equal(roto.getUTCMonth(), 7);
  assert.equal(roto.getUTCDate(), 1);
});

// ── LAS FOTOS QUE MIRA LA IA ────────────────────────────────────────────

test("sin fotos NO se toca la red: la lista vacía se resuelve en seco", async () => {
  // Si esto pidiera algo, un inmueble sin fotos tardaría en redactar por
  // nada. Los nulos y las cadenas vacías tampoco cuentan como foto.
  assert.deepEqual(await photosForVision([]), []);
  assert.deepEqual(await photosForVision([null, undefined, ""]), []);
});

test("tres fotos a 768 px caben de sobra en el tope del día", () => {
  // Una imagen cuesta ≈ ancho×alto/750 tokens de ENTRADA.
  const tokensPorFoto = Math.ceil((VISION_MAX_EDGE * VISION_MAX_EDGE) / 750);
  const entrada = tokensPorFoto * VISION_MAX_PHOTOS + 500; // + el bloque de datos
  const costo = textCallMicros({
    model: "claude-opus-5",
    inputTokens: entrada,
    outputTokens: 400,
  });
  const caben = Math.floor(usdToMicros(2) / costo);
  assert.ok(
    caben >= 30,
    `solo caben ${caben} descripciones con fotos al día (${formatMicrosUsd(costo)} cada una)`,
  );
  // Y no puede pasarse al otro extremo: si alguien sube el lado largo a
  // 1568, la misma cuenta da ~4x y el tope alcanza para un puñado.
  assert.ok(VISION_MAX_EDGE <= 1024, "el lado largo se disparó");
  assert.ok(VISION_MAX_PHOTOS <= 4, "demasiadas fotos por generación");
});

// ── i18n: la llave cruda no se ve como error, se ve como feature que falta ──

test("las llaves que pinta la pantalla existen en los DOS idiomas", () => {
  const dict = studioDict as unknown as Record<string, any>;

  const hoja = (o: any, k: string): unknown => {
    let n = o;
    for (const p of k.split(".")) {
      if (n == null || typeof n === "string") return undefined;
      n = n[p];
    }
    return n;
  };

  // Las llaves que se arman con una plantilla: `t(\`tabs.${k}\`)`. Se
  // expanden con los MISMOS arreglos que recorre la pantalla, importados
  // del contrato — no con una copia a mano que se quede vieja.
  const plantillas: Record<string, readonly string[]> = {
    "tabs.": ["reel", "staging", "texto", "consumo"],
    "kinds.": ["reel", "staging", "description", "social"],
    "reel.plantillas.": REALTY_REEL_TEMPLATES,
    "staging.estilos.": REALTY_STAGING_STYLES,
    "texto.tonos.": REALTY_COPY_TONES,
  };

  const usadas = new Set<string>(["errores.sinPlan", "errores.sinPermiso", "errores.sinSuscripcion"]);
  for (const f of [
    "src/components/realty/studio/studio-screen.tsx",
    "src/components/realty/studio/reel-composer.tsx",
  ]) {
    // Rutas desde la raíz del repo, que es desde donde corre npm run test:*.
    // Si un día se corre desde otro sitio, el aviso dice QUÉ pasó en vez de
    // dejar un ENOENT sin contexto.
    assert.ok(fs.existsSync(f), `no se encontró ${f} — corre la prueba desde la raíz del repo`);
    const src = fs.readFileSync(f, "utf8");
    // t("llave.literal")
    const literales = src.match(/\bt\(\s*"[^"]+"/g) ?? [];
    for (const m of literales) usadas.add(m.replace(/^\bt\(\s*"/, "").replace(/"$/, ""));
    // t(`prefijo.${x}`) — se expande por el prefijo.
    const conPlantilla = src.match(/\bt\(\s*`[^`]+`/g) ?? [];
    for (const m of conPlantilla) {
      const tpl = m.replace(/^\bt\(\s*`/, "").replace(/`$/, "");
      const prefijo = tpl.split("$")[0];
      const valores = plantillas[prefijo];
      assert.ok(valores, `plantilla de llave sin mapear en la prueba: ${tpl}`);
      for (const v of valores) usadas.add(prefijo + v);
    }
  }

  assert.ok(usadas.size > 40, `solo se detectaron ${usadas.size} llaves: el escaneo se rompió`);

  const faltan: string[] = [];
  for (const k of Array.from(usadas)) {
    if (typeof hoja(dict.es, k) !== "string") faltan.push(`es:${k}`);
    if (typeof hoja(dict.en, k) !== "string") faltan.push(`en:${k}`);
  }
  assert.deepEqual(faltan, [], "hay llaves que se pintarían CRUDAS en pantalla");
});

test("los dos idiomas tienen el MISMO árbol: una rama de menos deja media pantalla en inglés", () => {
  const dict = studioDict as unknown as Record<string, any>;
  const rutas = (o: any, pre = ""): string[] => {
    const out: string[] = [];
    for (const k of Object.keys(o)) {
      if (k.startsWith("_")) continue;
      const v = o[k];
      const p = pre ? `${pre}.${k}` : k;
      if (v && typeof v === "object") out.push(...rutas(v, p));
      else out.push(p);
    }
    return out;
  };
  const es = rutas(dict.es).sort();
  const en = rutas(dict.en).sort();
  assert.deepEqual(es, en, "los árboles de es y en se separaron");
  assert.ok(es.length >= 60, `solo ${es.length} llaves: el diccionario se vació`);
});
