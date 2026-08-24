import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getBarberContext, assertBarberPermission, BarberForbiddenError } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import {
  BARBER_WEB_TEMPLATE_DEFAULT,
  esPlantillaBarberWeb,
  fusionarConfigBarberWeb,
  fusionarPlantilla,
  normalizarConfigBarberWeb,
  rutaWebBarberia,
  validarConfigBarberWeb,
} from "@/lib/barber/landing";

/* ═══════════════════════════════════════════════════════════════════════
   GUARDAR LA PÁGINA WEB DE LA BARBERÍA.

   ── LAS TRES PUERTAS, TODAS EN EL SERVIDOR ────────────────────────
   1. Sesión de barbería (getBarberContext). El barbershopId sale de
      AQUÍ, nunca del body: no hay forma de escribir en otra barbería.
   2. Permiso `web.edit` (assertBarberPermission).
   3. Plan con `miniWebEditor` (Avanzado y Profesional).

   La tercera es la que suele quedarse solo en la interfaz. El sidebar ya
   esconde "Mi web" en Básico, pero esconder un botón no es un candado:
   quien conozca la ruta manda el PATCH igual. Por eso está aquí, del
   lado del que escribe en la base.

   ── CONCURRENCIA: `version`, y fusión antes de rendirse ───────────
   El editor dental usaba `updatedAt` como marca y devolvía 409 SIEMPRE:
   la columna guarda microsegundos que un Date de JavaScript no puede
   escribir, y además la bumpeaban veinte procesos ajenos. Aquí la marca
   es la columna `version`, un entero que solo sube este endpoint.

   Y cuando la versión no coincide tampoco se contesta 409 de entrada:
   se FUSIONA con lo que hay en la base (ver fusionarConfigBarberWeb).
   Solo si las dos pestañas cambiaron EL MISMO campo a cosas distintas
   sale un 409, y dice cuál. Guardar dos veces seguido, o tocar cosas
   distintas desde dos pestañas, no molesta a nadie.

   ── REVALIDAR ─────────────────────────────────────────────────────
   /b/[slug] es ISR de 5 minutos. Sin `revalidatePath` la barbería
   guarda, va a ver su página y no ve el cambio — el otro bug del
   editor dental. Se revalida en CADA guardado que entra.
   ═══════════════════════════════════════════════════════════════════════ */

export const dynamic = "force-dynamic";

/** Cuántas veces se reintenta cuando la fila se mueve por debajo. */
const INTENTOS = 3;

type Contexto = NonNullable<Awaited<ReturnType<typeof getBarberContext>>>;

/** Las tres puertas. Devuelve el contexto o la respuesta de error. */
async function puerta(): Promise<{ ctx: Contexto } | { error: NextResponse }> {
  const ctx = await getBarberContext();
  if (!ctx) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  try {
    assertBarberPermission(ctx, "web.edit");
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return {
        error: NextResponse.json(
          { error: "No tienes permiso para editar la página de la barbería." },
          { status: 403 },
        ),
      };
    }
    throw e;
  }

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (plan.features.miniWebEditor !== true) {
    return {
      error: NextResponse.json(
        {
          error:
            "El editor de tu página web está disponible en los planes Avanzado y Profesional. Tu página sigue publicada con la plantilla por defecto.",
          plan: plan.id,
          necesitaPlan: true,
        },
        { status: 403 },
      ),
    };
  }

  return { ctx };
}

/**
 * ¿Es el error de "esa tabla no existe"?
 *
 * `barber_landing_configs` nace en sql/barber_complemento.sql y ese SQL
 * todavía no está aplicado en Supabase. Sin este caso, el editor
 * respondería un 500 sin explicación y nadie sabría por dónde empezar.
 */
function tablaSinCrear(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2010";
}

const RESPUESTA_SIN_TABLA = NextResponse.json(
  {
    error:
      "La tabla de la mini-web todavía no existe en la base. Falta aplicar sql/barber_complemento.sql en Supabase.",
    sinTabla: true,
  },
  { status: 503 },
);

/* ══════════════════════════════════════════════════════════════
   GET — el estado actual, para recuperarse de un conflicto
   ══════════════════════════════════════════════════════════════ */

export async function GET() {
  const p = await puerta();
  if ("error" in p) return p.error;
  const { ctx } = p;

  try {
    const fila = await prisma.barberLandingConfig.findUnique({
      where: { barbershopId: ctx.barbershopId },
      select: { template: true, config: true, version: true, publishedAt: true },
    });

    return NextResponse.json({
      template: esPlantillaBarberWeb(fila?.template) ? fila!.template : BARBER_WEB_TEMPLATE_DEFAULT,
      config: normalizarConfigBarberWeb(fila?.config),
      version: fila?.version ?? 0,
      publishedAt: fila?.publishedAt ?? null,
      slug: ctx.barbershop.slug,
    });
  } catch (e) {
    if (tablaSinCrear(e)) return RESPUESTA_SIN_TABLA;
    throw e;
  }
}

/* ══════════════════════════════════════════════════════════════
   PATCH — guardar y publicar
   ══════════════════════════════════════════════════════════════ */

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

  const template = esPlantillaBarberWeb(body.template) ? body.template : BARBER_WEB_TEMPLATE_DEFAULT;

  const { config, invalidos } = validarConfigBarberWeb(body.config);
  if (!config) {
    // Nada a medias: o entra todo, o no entra nada. Guardar solo lo válido
    // deja a la barbería creyendo que publicó un cambio que no salió.
    return NextResponse.json(
      { error: `Esto no tiene el formato esperado: ${invalidos.join(", ")}.` },
      { status: 400 },
    );
  }

  /* `base` es lo que ESTA pestaña tenía por publicado cuando empezó a
     editar. No se escribe nunca: solo se compara, y es lo único que
     permite distinguir "me pisaron" de "toqué algo que el otro no tocó". */
  const baseCruda = (body.base ?? {}) as Record<string, unknown>;
  const baseConfig = normalizarConfigBarberWeb(baseCruda.config);
  const baseTemplate = esPlantillaBarberWeb(baseCruda.template)
    ? (baseCruda.template as string)
    : BARBER_WEB_TEMPLATE_DEFAULT;

  const ahora = new Date();
  const comun = {
    updatedByUserId: ctx.barberUserId,
    publishedAt: ahora,
  };

  try {
    for (let intento = 0; intento < INTENTOS; intento++) {
      /* 1 · El camino feliz: la versión que traigo es la que hay. Un solo
             UPDATE atómico; si entra, se acabó. */
      const directo = await prisma.barberLandingConfig.updateMany({
        where: { barbershopId: ctx.barbershopId, version },
        data: { ...comun, template, config: config as object, version: version + 1 },
      });
      if (directo.count > 0) {
        return ok(ctx.barbershop.slug, template, config, version + 1, ahora);
      }

      /* 2 · No entró. ¿No existe la fila, o se movió? */
      const fila = await prisma.barberLandingConfig.findUnique({
        where: { barbershopId: ctx.barbershopId },
        select: { template: true, config: true, version: true },
      });

      if (!fila) {
        // Primera vez. `version` empieza en 1 para que la siguiente
        // escritura de esta misma pestaña tenga con qué compararse.
        try {
          await prisma.barberLandingConfig.create({
            data: {
              barbershopId: ctx.barbershopId,
              template,
              config: config as object,
              version: 1,
              ...comun,
            },
          });
          return ok(ctx.barbershop.slug, template, config, 1, ahora);
        } catch (e) {
          // Otra pestaña la creó entre la lectura y la escritura. Se
          // reintenta: en la vuelta siguiente ya existe y se fusiona.
          if ((e as { code?: string })?.code === "P2002") continue;
          throw e;
        }
      }

      /* 3 · La fila se movió. Fusionar en vez de rendirse. */
      const servidorConfig = normalizarConfigBarberWeb(fila.config);
      const servidorTemplate = esPlantillaBarberWeb(fila.template)
        ? fila.template
        : BARBER_WEB_TEMPLATE_DEFAULT;

      const fusion = fusionarConfigBarberWeb(baseConfig, config, servidorConfig);
      const plantillaFundida = fusionarPlantilla(baseTemplate, template, servidorTemplate);

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

      const fundido = await prisma.barberLandingConfig.updateMany({
        where: { barbershopId: ctx.barbershopId, version: fila.version },
        data: {
          ...comun,
          template: plantillaFundida.template,
          config: fusion.config as object,
          version: fila.version + 1,
        },
      });
      if (fundido.count > 0) {
        return ok(
          ctx.barbershop.slug,
          plantillaFundida.template,
          fusion.config,
          fila.version + 1,
          ahora,
        );
      }
      // Se movió otra vez entre la lectura y la escritura: se reintenta.
    }

    // Tres vueltas con la fila moviéndose todo el rato. Es tan raro que
    // decirlo tal cual es más útil que inventar una explicación.
    return NextResponse.json(
      {
        error: "Tu página se está guardando desde otro lado ahora mismo. Inténtalo otra vez.",
        conflicto: true,
        campos: [],
      },
      { status: 409 },
    );
  } catch (e) {
    if (tablaSinCrear(e)) return RESPUESTA_SIN_TABLA;
    console.error("[barber-landing] PATCH falló:", e);
    return NextResponse.json({ error: "No se pudo guardar. Inténtalo otra vez." }, { status: 500 });
  }
}

/**
 * Acuse de recibo + revalidación.
 *
 * Se devuelve el config REALMENTE guardado (que tras una fusión no es el
 * que mandó el cliente) para que la pantalla actualice su `base`. Sin
 * eso, el siguiente guardado compararía contra una base vieja y vería
 * conflictos donde no los hay.
 */
function ok(
  slug: string,
  template: string,
  config: unknown,
  version: number,
  publishedAt: Date,
): NextResponse {
  try {
    revalidatePath(rutaWebBarberia(slug));
  } catch (e) {
    // Best-effort: el cambio YA está en la base. Como mucho tarda lo que
    // tarde el ISR en caducar, que es el comportamiento de antes.
    console.error("[barber-landing] revalidatePath falló:", e);
  }
  return NextResponse.json({ ok: true, template, config, version, publishedAt });
}
