import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  assertRealtyPermission,
  getRealtyContext,
  RealtyForbiddenError,
} from "@/lib/realty-auth";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { rateLimitKey } from "@/lib/rate-limit";
import {
  esPlantillaRealtyWeb,
  rutaAgenteWeb,
  rutaInmuebleWeb,
  fusionarConfigRealtyWeb,
  fusionarPlantilla,
  normalizarConfigRealtyWeb,
  plantillaEfectiva,
  rutaContactoWeb,
  rutaPropiedadesWeb,
  rutaWebInmobiliaria,
  validarConfigRealtyWeb,
  type RealtyWebConfig,
  type RealtyWebTemplateId,
} from "@/lib/realty/landing";

/* ═══════════════════════════════════════════════════════════════════════
   GUARDAR LA WEB PÚBLICA DE UNA CUENTA DE INMUEBLES.

   ── CONCURRENCIA: `version`, y FUSIÓN antes de rendirse ───────────
   🔴 El editor dental usaba `updatedAt` como marca y devolvía 409 SIEMPRE,
   por dos motivos independientes y cada uno suficiente: (a) la columna
   guarda MICROsegundos que un `Date` de JavaScript no puede escribir, así
   que el `where` no encontraba nunca la fila; y (b) `updatedAt` es de la
   fila de la clínica, que bumpean veinte procesos ajenos (Stripe, tokens,
   settings). Una sola pestaña, un solo usuario, 409 todas las veces.

   Aquí la marca es la columna `version`: un entero que SOLO sube este
   endpoint. Y un 409 tampoco sirve de nada por sí solo —"recarga y pierde
   lo que escribiste" no es una salida—, así que antes se FUSIONA a tres
   bandas (base / mío / servidor). Solo hay conflicto cuando dos pestañas
   cambiaron EL MISMO campo a valores DISTINTOS, y la respuesta dice cuál.

   ── ISR: revalidar SIEMPRE que entre un guardado ──────────────────
   🔴 /i/[slug] es ISR de 5 minutos. Sin `revalidatePath`, la inmobiliaria
   cambia un texto, entra a su página, no lo ve y da por perdido lo que
   escribió. Ese fue el bug de "tarda cinco minutos" del dental. Se
   revalidan TODAS las superficies que leen la configuración —portada,
   buscador, contacto, el sitemap del vertical, y las fichas y páginas de
   asesor DE ESTA CUENTA, una a una— porque el patrón de ruta global tiraría
   la caché de todos los demás inquilinos.

   ── LAS TRES PUERTAS ──────────────────────────────────────────────
   Sesión → permiso `web.edit` → feature `webEditor` del plan. El sidebar
   ya esconde "Mi web" a quien no la tiene, pero esconder un botón no es un
   candado: quien conozca la ruta manda el PATCH igual.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/** Vueltas antes de rendirse cuando la fila se mueve entre lectura y escritura. */
const INTENTOS = 3;

type Contexto = NonNullable<Awaited<ReturnType<typeof getRealtyContext>>>;

const RESPUESTA_SIN_TABLA = NextResponse.json(
  {
    error:
      "La tabla de la web pública todavía no existe en la base. Falta aplicar sql/realty.sql en Supabase.",
    sinTabla: true,
  },
  { status: 503 },
);

function tablaSinCrear(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2010";
}

/** Las tres puertas. Devuelve el contexto o la respuesta de error. */
async function puerta(): Promise<{ ctx: Contexto } | { error: NextResponse }> {
  const ctx = await getRealtyContext();
  if (!ctx) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  try {
    assertRealtyPermission(ctx, "web.edit");
  } catch (e) {
    if (e instanceof RealtyForbiddenError) {
      return {
        error: NextResponse.json(
          { error: "No tienes permiso para editar la web de la cuenta." },
          { status: 403 },
        ),
      };
    }
    throw e;
  }

  // El plan viene YA resuelto en el contexto (getRealtyContext lo trae de
  // realty_plan_configs con caché y fallback al seed): no se vuelve a leer.
  // Y se pregunta por `webEditor`, NO por el id del plan: la tabla es
  // editable sin redeploy y quemar "PROPIETARIO" aquí congelaría el
  // producto en el estado de hoy.
  if (!realtyPlanHasFeature(ctx.plan, "webEditor")) {
    return {
      error: NextResponse.json(
        {
          // Sin nombrar planes: qué plan trae `webEditor` se decide en la
          // tabla realty_plan_configs y se edita sin redeploy. Un mensaje que
          // diga "está en Asesor e Inmobiliaria" se vuelve mentira el día que
          // alguien mueva la feature — y hoy MISMO lo es, porque el seed se
          // la da a los tres planes.
          error:
            "Tu plan incluye la web pública con la plantilla por defecto, pero no el editor visual.",
          plan: ctx.plan.id,
          necesitaPlan: true,
        },
        { status: 403 },
      ),
    };
  }

  // Freno por CUENTA. Cada guardado que entra dispara una tanda de
  // revalidaciones (portada, buscador, contacto, sitemap y hasta 120 fichas):
  // un bucle en el cliente podría convertir el editor en un generador de
  // carga contra la caché del vertical entero.
  if (!rateLimitKey(`realty-web-save:${ctx.accountId}`, 40, 60_000)) {
    return {
      error: NextResponse.json(
        { error: "Estás guardando demasiado seguido. Espera un minuto." },
        { status: 429 },
      ),
    };
  }

  return { ctx };
}

/* ── GET ──────────────────────────────────────────────────────────── */

export async function GET() {
  const p = await puerta();
  if ("error" in p) return p.error;
  const { ctx } = p;

  try {
    const fila = await prisma.realtyLandingConfig.findUnique({
      where: { accountId: ctx.accountId },
      select: { template: true, data: true, published: true, version: true, updatedAt: true },
    });

    const config = normalizarConfigRealtyWeb(fila?.data);
    return NextResponse.json({
      template: plantillaEfectiva(fila?.template, ctx.mode),
      config: { ...config, publicada: fila ? fila.published : true },
      // Sin fila, `version: 0`. El primer PATCH manda ese 0, el UPDATE
      // condicionado no encuentra nada y cae al camino del create, que
      // arranca en 1 (que es el default de la columna).
      version: fila?.version ?? 0,
      publicada: fila ? fila.published : true,
      slug: ctx.account.slug,
      modo: ctx.mode,
      actualizado: fila?.updatedAt ?? null,
    });
  } catch (e) {
    if (tablaSinCrear(e)) return RESPUESTA_SIN_TABLA;
    console.error("[realty-landing] GET falló:", e);
    return NextResponse.json({ error: "No se pudo leer la configuración." }, { status: 500 });
  }
}

/* ── PATCH ────────────────────────────────────────────────────────── */

export async function PATCH(req: NextRequest) {
  const p = await puerta();
  if ("error" in p) return p.error;
  const { ctx } = p;

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("forma");
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const version = Number(body.version);
  if (!Number.isInteger(version) || version < 0) {
    return NextResponse.json({ error: "Falta la versión de la página" }, { status: 400 });
  }

  // La plantilla tiene que venir, y tiene que existir. Sin este primer
  // corte, un `template` ausente o con una errata caía por
  // `plantillaEfectiva` a la de fábrica del modo y el camino directo la
  // escribía TAL CUAL: la cuenta perdía su plantilla en silencio, sin 409 y
  // sin haber pedido nada.
  if (!esPlantillaRealtyWeb(body.template)) {
    return NextResponse.json({ error: "Falta la plantilla o no existe." }, { status: 400 });
  }
  // Y tiene que ser de SU modo: una AGENT no puede guardarse "corporativa"
  // ni escribiendo el PATCH a mano. El sujeto de la página no es una
  // preferencia estética.
  const template = plantillaEfectiva(body.template, ctx.mode);
  if (body.template !== template) {
    return NextResponse.json(
      {
        error:
          "Esa plantilla no es de tu tipo de cuenta. Si acabas de cambiar el tipo de cuenta, recarga esta pantalla: las plantillas que se ofrecen son otras.",
      },
      { status: 400 },
    );
  }

  const { config, invalidos } = validarConfigRealtyWeb(body.config);
  if (!config) {
    // Nada a medias: o entra todo, o no entra nada.
    return NextResponse.json(
      { error: `Esto no tiene el formato esperado: ${invalidos.join(", ")}.` },
      { status: 400 },
    );
  }

  const baseCruda = (body.base ?? {}) as Record<string, unknown>;
  const baseConfig = normalizarConfigRealtyWeb(baseCruda.config);
  const baseTemplate = plantillaEfectiva(baseCruda.template, ctx.mode);

  const comun = { updatedByUserId: ctx.realtyUserId };

  try {
    for (let intento = 0; intento < INTENTOS; intento++) {
      /* 1 · El camino feliz: la versión que traigo es la que hay. Un solo
             UPDATE atómico; si entra, se acabó. */
      const directo = await prisma.realtyLandingConfig.updateMany({
        where: { accountId: ctx.accountId, version },
        data: {
          ...comun,
          template,
          data: config as object,
          published: config.publicada,
          version: version + 1,
        },
      });
      if (directo.count > 0) return await ok(ctx.accountId, ctx.account.slug, template, config, version + 1);

      /* 2 · No entró. ¿No existe la fila, o se movió? */
      const fila = await prisma.realtyLandingConfig.findUnique({
        where: { accountId: ctx.accountId },
        select: { template: true, data: true, published: true, version: true },
      });

      if (!fila) {
        try {
          await prisma.realtyLandingConfig.create({
            data: {
              accountId: ctx.accountId,
              template,
              data: config as object,
              published: config.publicada,
              version: 1,
              ...comun,
            },
          });
          return await ok(ctx.accountId, ctx.account.slug, template, config, 1);
        } catch (e) {
          // Otra pestaña la creó entre la lectura y la escritura. Se
          // reintenta: en la vuelta siguiente ya existe y se fusiona.
          if ((e as { code?: string })?.code === "P2002") continue;
          throw e;
        }
      }

      /* 3 · La fila se movió. Fusionar en vez de rendirse. */
      const servidorConfig: RealtyWebConfig = {
        ...normalizarConfigRealtyWeb(fila.data),
        publicada: fila.published,
      };
      const servidorTemplate = plantillaEfectiva(fila.template, ctx.mode);

      const fusion = fusionarConfigRealtyWeb(baseConfig, config, servidorConfig);
      const plantillaFundida = fusionarPlantilla(
        baseTemplate as RealtyWebTemplateId,
        template,
        servidorTemplate,
      );

      if (fusion.conflictos.length > 0 || plantillaFundida.conflicto) {
        const campos = [...fusion.conflictos];
        if (plantillaFundida.conflicto) campos.unshift("la plantilla");
        // Conflicto de verdad: los dos cambiaron LO MISMO a cosas
        // distintas. Se devuelve el estado actual entero para que la
        // pantalla pueda ofrecer algo mejor que "recarga y pierde todo".
        return NextResponse.json(
          {
            error: `Alguien más editó ${campos.join(", ")} desde que abriste esta pantalla.`,
            conflicto: true,
            campos,
            version: fila.version,
            template: servidorTemplate,
            config: servidorConfig,
          },
          { status: 409 },
        );
      }

      const fundido = await prisma.realtyLandingConfig.updateMany({
        where: { accountId: ctx.accountId, version: fila.version },
        data: {
          ...comun,
          template: plantillaFundida.template,
          data: fusion.config as object,
          published: fusion.config.publicada,
          version: fila.version + 1,
        },
      });
      if (fundido.count > 0) {
        return await ok(
          ctx.accountId,
          ctx.account.slug,
          plantillaFundida.template,
          fusion.config,
          fila.version + 1,
        );
      }
      // Se movió otra vez entre la lectura y la escritura: se reintenta.
    }

    // Tres vueltas con la fila moviéndose todo el rato. Es tan raro que
    // decirlo tal cual es más útil que inventar una explicación.
    //
    // 🔴 Este 409 lleva el estado ACTUAL igual que el otro. Sin él, la
    // pantalla recibía un cuerpo sin `config` y, al ofrecer "quedarme con lo
    // suyo", adoptaba la config VACÍA: el editor se quedaba en blanco y
    // marcado como limpio. Un cuerpo a medias es peor que un error.
    const ultima = await prisma.realtyLandingConfig.findUnique({
      where: { accountId: ctx.accountId },
      select: { template: true, data: true, published: true, version: true },
    });
    return NextResponse.json(
      {
        error: "Tu página se está guardando desde otro lado ahora mismo. Inténtalo otra vez.",
        conflicto: true,
        campos: [],
        ...(ultima
          ? {
              version: ultima.version,
              template: plantillaEfectiva(ultima.template, ctx.mode),
              config: {
                ...normalizarConfigRealtyWeb(ultima.data),
                publicada: ultima.published,
              },
            }
          : {}),
      },
      { status: 409 },
    );
  } catch (e) {
    if (tablaSinCrear(e)) return RESPUESTA_SIN_TABLA;
    console.error("[realty-landing] PATCH falló:", e);
    return NextResponse.json({ error: "No se pudo guardar. Inténtalo otra vez." }, { status: 500 });
  }
}

/**
 * Acuse de recibo + revalidación.
 *
 * Se devuelve el config REALMENTE guardado (que tras una fusión no es el
 * que mandó el cliente) para que la pantalla actualice su `base`. Sin eso,
 * el siguiente guardado compararía contra una base vieja y vería
 * conflictos donde no los hay.
 */
/** Tope de fichas y asesores que se revalidan una a una. Ver abajo. */
const TOPE_REVALIDACION = 120;

async function ok(
  accountId: string,
  slug: string,
  template: RealtyWebTemplateId,
  config: RealtyWebConfig,
  version: number,
): Promise<NextResponse> {
  try {
    revalidatePath(rutaWebInmobiliaria(slug));
    revalidatePath(rutaPropiedadesWeb(slug));
    revalidatePath(rutaContactoWeb(slug));
    // 🔴 El sitemap TAMBIÉN lee la configuración (`published`). Sin esto,
    // una cuenta que apaga su web se sirve con noindex al instante pero
    // /i/sitemap.xml la sigue anunciando a Google hasta una hora.
    revalidatePath("/i/sitemap.xml");

    // Las fichas y las páginas de asesor se revalidan UNA A UNA, de ESTA
    // cuenta. La alternativa —revalidatePath(patrón, "page")— es una línea
    // más corta pero tira la caché de las fichas de TODAS las cuentas del
    // vertical: con quinientas inmobiliarias, que una cambie un color deja
    // frías las páginas de las otras cuatrocientas noventa y nueve.
    const [inmuebles, agentes] = await Promise.all([
      prisma.realtyProperty.findMany({
        where: { accountId, isPublished: true },
        select: { id: true, publicUrlSlug: true },
        orderBy: { updatedAt: "desc" },
        take: TOPE_REVALIDACION + 1,
      }),
      prisma.realtyAgentProfile.findMany({
        where: { accountId, active: true, publicSlug: { not: null } },
        select: { publicSlug: true },
        take: 60,
      }),
    ]);

    if (inmuebles.length > TOPE_REVALIDACION) {
      // Cartera enorme: nombrarlas una a una costaría más que el propio
      // guardado. Se cae al patrón global, que es correcto aunque caro, y se
      // deja dicho en el log por qué.
      console.warn(
        `[realty-landing] ${slug} tiene más de ${TOPE_REVALIDACION} inmuebles publicados: se revalida por patrón (afecta a todo el vertical).`,
      );
      revalidatePath("/i/[slug]/propiedades/[inmueble]", "page");
    } else {
      for (const inm of inmuebles) {
        revalidatePath(rutaInmuebleWeb(slug, inm.publicUrlSlug ?? inm.id));
      }
    }
    for (const a of agentes) {
      if (a.publicSlug) revalidatePath(rutaAgenteWeb(slug, a.publicSlug));
    }
  } catch (e) {
    // Best-effort: el cambio YA está en la base. Como mucho tarda lo que
    // tarde el ISR en caducar, que es el comportamiento de antes.
    console.error("[realty-landing] revalidatePath falló:", e);
  }
  return NextResponse.json({ ok: true, template, config, version });
}
