// ═══════════════════════════════════════════════════════════════════════
// PRECALIFICADOR PÚBLICO — /api/realty/calc/publico/[slug]
//
// Sin sesión, sin cuenta, sin app. Alguien que llegó de Google o de un
// anuncio contesta cinco cosas, ve para cuánto le alcanza, deja su WhatsApp
// y se convierte en un RealtyLead YA CLASIFICADO: con su creditKind y su
// presupuesto real, sin que nadie lo haya llamado. Se autocalifica solo.
//
// LA CUENTA SALE SIEMPRE DEL SLUG DE LA URL. Este endpoint jamás acepta un
// accountId: una inmobiliaria no puede meterle prospectos a otra porque no
// hay dónde pedírselo.
//
// EL SERVIDOR RECALCULA. Lo que manda el navegador son las respuestas del
// formulario, nunca el resultado: los números que se guardan en el lead
// salen de volver a correr aquí la misma función pura.
//
// Anti-abuso SIN captcha (un captcha en móvil mata la conversión):
//   · límite persistente por IP,
//   · campo trampa `website`, invisible para una persona,
//   · tope de prospectos vivos por teléfono en esta cuenta.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { mxTenDigits, MX_PHONE_ERROR } from "@/lib/phone-mx";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { getRealtyPlan } from "@/lib/realty/plans";
import { MARCA_BITACORA, resolveCreditoParams } from "@/lib/realty/calc/catalog";
import { precalificar, type TipoCredito } from "@/lib/realty/calc/infonavit";
import { fmtMXN, fmtPct, toCents } from "@/lib/realty/calc/money";
import { getCalcParamRows } from "@/lib/realty/calc/params";

export const dynamic = "force-dynamic";

/** Una familia lo corre dos o tres veces con números distintos; 10 es holgado. */
const RL = { limit: 10, windowSec: 600 };

/** Tope de prospectos vivos por teléfono: una IP móvil rota sola, el número no. */
const MAX_POR_TELEFONO = 5;

const TIPOS: TipoCredito[] = ["INFONAVIT", "FOVISSSTE", "BANCARIO", "CONTADO"];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function dinero(v: unknown): number {
  const n = num(v);
  return n !== null && n > 0 ? toCents(n) : 0;
}

async function cargarCuenta(slug: string) {
  // select explícito, NUNCA include: la fila de realty_accounts lleva
  // whatsappToken, stripeCustomerId y el correo del dueño. Nada de eso sale
  // de aquí, y no sale porque NO SE PIDE.
  return prisma.realtyAccount.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      plan: true,
      isActive: true,
      subscriptionStatus: true,
      state: true,
    },
  });
}

/**
 * GET — los parámetros y el nombre de la cuenta, para pintar el formulario.
 *
 * Mismo límite y MISMAS condiciones que el POST, a propósito. Antes el GET no
 * tenía rate limit y tampoco miraba la suscripción, así que servía para dos
 * cosas que no debía: barrer slugs sin freno cosechando el nombre y el estado
 * de cada inmobiliaria, y comparar GET-200 contra POST-403 para deducir a
 * quién se le venció el pago. Los tres casos negativos responden ahora lo
 * mismo (404 "No encontrado"): no existe, no está activa, o no le toca.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const limitado = await persistentRateLimit(req, { ...RL, scope: "realty-calc-publico" });
  if (limitado) return limitado;

  const cuenta = await cargarCuenta(String(params.slug ?? "").trim());
  if (!cuenta || !cuenta.isActive || !isRealtySubscriptionActive(cuenta)) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const plan = await getRealtyPlan(cuenta.plan);
  if (!realtyPlanHasFeature(plan, "calculators")) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  const rows = await getCalcParamRows();
  return NextResponse.json({
    cuenta: { nombre: cuenta.name, estado: cuenta.state },
    // Son tasas de impuestos y topes públicos: no hay nada que ocultar y
    // mandarlos una vez evita un viaje al servidor por cada tecleo.
    rows,
  });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const limitado = await persistentRateLimit(req, { ...RL, scope: "realty-calc-publico" });
    if (limitado) return limitado;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
    }

    // Campo trampa. Se responde 200 como si todo hubiera ido bien: un bot que
    // ve el error aprende a esquivarlo; uno que ve éxito no vuelve.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ ok: true });
    }

    // Un solo cuerpo y un solo status para los tres casos negativos: que no
    // exista, que esté apagada o que deba el pago no es asunto del visitante,
    // y distinguirlos convertía este endpoint en un delator.
    const cuenta = await cargarCuenta(String(params.slug ?? "").trim());
    const plan = cuenta ? await getRealtyPlan(cuenta.plan) : null;
    if (
      !cuenta ||
      !cuenta.isActive ||
      !isRealtySubscriptionActive(cuenta) ||
      !realtyPlanHasFeature(plan, "calculators")
    ) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    // ── Validación ────────────────────────────────────────────────────
    const nombre = typeof body.nombre === "string" ? body.nombre.trim() : "";
    if (nombre.length < 3 || nombre.length > 120) {
      return NextResponse.json({ error: "Escribe tu nombre completo." }, { status: 400 });
    }
    const telefono = mxTenDigits(typeof body.telefono === "string" ? body.telefono : "");
    if (!telefono) return NextResponse.json({ error: MX_PHONE_ERROR }, { status: 400 });

    const tipo = TIPOS.includes(body.tipo as TipoCredito) ? (body.tipo as TipoCredito) : null;
    if (!tipo) return NextResponse.json({ error: "Elige un tipo de crédito." }, { status: 400 });

    // La edad solo hace falta cuando hay plazo que recortar. Exigírsela a
    // quien paga de contado dejaba ese formulario sin poder enviarse nunca.
    const edad = num(body.edad);
    if (tipo !== "CONTADO" && (edad === null || edad < 18 || edad > 99)) {
      return NextResponse.json({ error: "Escribe una edad entre 18 y 99 años." }, { status: 400 });
    }

    // ── El servidor recalcula: es la autoridad ────────────────────────
    const resuelto = resolveCreditoParams(await getCalcParamRows(), new Date());
    if (!resuelto.ok || !resuelto.params) {
      // Faltan parámetros de plataforma. No es culpa del visitante y no se
      // le enseña el detalle interno, pero tampoco se le inventa un número.
      console.error("[realty-calc-publico] sin parámetros:", resuelto.faltantes);
      return NextResponse.json(
        { error: "La calculadora no está disponible en este momento." },
        { status: 503 },
      );
    }

    const r = precalificar(
      {
        tipo,
        salarioMensualCents: dinero(body.salario),
        ahorroCents: dinero(body.ahorro),
        deudasMensualesCents: dinero(body.deudas),
        edad: edad === null ? 0 : Math.round(edad),
        puntosInfonavit: num(body.puntos),
        unirCredito: body.unir === true,
        salarioSocioCents: dinero(body.salarioSocio),
      },
      resuelto.params,
    );
    if (!r.ok) return NextResponse.json({ error: r.error ?? "Datos incompletos." }, { status: 400 });

    // ── El prospecto ──────────────────────────────────────────────────
    try {
      const vivos = await prisma.realtyLead.count({
        where: {
          accountId: cuenta.id,
          contact: { phone: telefono },
          stage: { notIn: ["CIERRE", "PERDIDO"] },
        },
      });
      if (vivos < MAX_POR_TELEFONO) {
        await prisma.$transaction(async (tx) => {
          // RealtyContact NO tiene único (accountId, phone), así que no hay
          // upsert posible: se busca y, si no está, se crea.
          let contacto = await tx.realtyContact.findFirst({
            where: { accountId: cuenta.id, phone: telefono },
            select: { id: true },
          });
          if (!contacto) {
            contacto = await tx.realtyContact.create({
              data: {
                accountId: cuenta.id,
                name: nombre,
                phone: telefono,
                kind: "PROSPECTO",
                source: "calculadora",
              },
              select: { id: true },
            });
          }

          const lead = await tx.realtyLead.create({
            data: {
              accountId: cuenta.id,
              contactId: contacto.id,
              portal: "propio",
              stage: "NUEVO",
              creditKind: tipo,
              // Presupuesto REAL, calculado aquí. Es lo que convierte esto en
              // un prospecto ya clasificado en vez de un nombre suelto.
              budgetMin:
                r.presupuestoMinCents && r.presupuestoMinCents > 0
                  ? new Prisma.Decimal((r.presupuestoMinCents / 100).toFixed(2))
                  : null,
              budgetMax:
                r.presupuestoMaxCents && r.presupuestoMaxCents > 0
                  ? new Prisma.Decimal((r.presupuestoMaxCents / 100).toFixed(2))
                  : null,
            },
            select: { id: true },
          });

          await tx.realtyLeadActivity.create({
            data: {
              accountId: cuenta.id,
              leadId: lead.id,
              kind: "NOTA",
              // userId null: lo llenó el propio prospecto desde la web, no
              // una persona del equipo. El schema contempla justo este caso.
              userId: null,
              note: textoBitacora(nombre, r),
            },
          });
        });
      }
    } catch (e) {
      // El resultado YA se calculó: si el alta falla, el visitante ve su
      // número igual. Perder el lead es malo; romperle la pantalla, peor.
      console.error("[realty-calc-publico] no se pudo crear el prospecto:", e);
    }

    // El resultado del alta NO sale al cliente: valdría "cayó en la trampa" o
    // "ya hay cinco prospectos vivos con ese teléfono", y ninguna de las dos
    // cosas le incumbe a quien está del otro lado.
    return NextResponse.json({
      ok: true,
      resultado: {
        califica: r.califica === true,
        motivoNoCalifica: r.motivoNoCalifica ?? null,
        puntosFaltantes: r.puntosFaltantes ?? null,
        tipoLabel: r.tipoLabel ?? null,
        presupuestoMinCents: r.presupuestoMinCents ?? 0,
        presupuestoMaxCents: r.presupuestoMaxCents ?? 0,
        creditoMinCents: r.creditoMinCents ?? 0,
        creditoMaxCents: r.creditoMaxCents ?? 0,
        mensualidadMinCents: r.mensualidadMinCents ?? 0,
        mensualidadMaxCents: r.mensualidadMaxCents ?? 0,
        plazoMeses: r.plazoMeses ?? 0,
        pasos: r.pasos ?? [],
        leyenda: r.leyenda ?? "",
      },
    });
  } catch (err) {
    console.error("[realty-calc-publico] error:", err);
    return NextResponse.json(
      { error: "No pudimos calcular tu resultado. Inténtalo de nuevo." },
      { status: 500 },
    );
  }
}

function textoBitacora(nombre: string, r: ReturnType<typeof precalificar>): string {
  const l: string[] = [
    `${MARCA_BITACORA}Precalificación desde la web pública`,
    "",
    `${nombre} se precalificó solo para ${r.tipoLabel}.`,
  ];
  if (r.califica) {
    l.push(
      `Le alcanza para una casa de ${fmtMXN(r.presupuestoMinCents ?? 0)} a ${fmtMXN(r.presupuestoMaxCents ?? 0)}.`,
    );
    if ((r.creditoMaxCents ?? 0) > 0) {
      l.push(
        `Crédito estimado ${fmtMXN(r.creditoMinCents ?? 0)} a ${fmtMXN(r.creditoMaxCents ?? 0)}, mensualidad ${fmtMXN(r.mensualidadMinCents ?? 0)} a ${fmtMXN(r.mensualidadMaxCents ?? 0)} a ${Math.floor((r.plazoMeses ?? 0) / 12)} años.`,
      );
      if (r.tasaMinPct !== undefined) {
        l.push(`Tasa considerada: ${fmtPct(r.tasaMinPct)} a ${fmtPct(r.tasaMaxPct ?? r.tasaMinPct)}.`);
      }
    }
  } else {
    l.push(`TODAVÍA NO CALIFICA: ${r.motivoNoCalifica ?? ""}`);
  }
  l.push("", r.leyenda ?? "");
  return l.join("\n").slice(0, 4000);
}
