import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit } from "@/lib/failban";
import { chat } from "@/lib/integrations/claude";
import { canSpend, chargeUsage } from "@/lib/ai-billing/wallet";
import { getPricingConfig } from "@/lib/ai-billing/pricing";
import { computeCostUsdMicros, usdMicrosToBilledCents } from "@/lib/ai-billing/pricing-core";
import { AI_FEATURE_LANDING_COPY } from "@/lib/ai-billing/types";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import {
  armarLectura, construirHechos, extraerJson, validarRedaccion, INSTRUCCIONES_DE_REDACCION,
  MAX_SERVICIOS_A_REDACTAR,
  type DatosDeClinica, type FilaDoctor, type FilaHorario, type FilaTarifario, type ServicioGuardado,
} from "@/lib/landing-autocompletar/core";

/**
 * AUTOCOMPLETAR LA PÁGINA WEB — propone, NO publica.
 *
 * Esta ruta NO escribe en `Clinic`. Ni el GET ni el POST tienen un solo
 * `update`: lo que la clínica apruebe viaja después, campo por campo, por el
 * PATCH de siempre (/api/clinic-landing), con su lista literal, sus validadores
 * y su guardia de concurrencia. Aquí solo se LEE y se REDACTA.
 *
 *   GET  · lee tarifario, doctores, horario y contacto. Gratis: no hay modelo.
 *          Los precios salen de aquí, copiados de `ProcedureCatalog`.
 *   POST · una llamada al modelo que redacta eslogan, presentación,
 *          descripciones y preguntas frecuentes. Se cobra al monedero de IA
 *          (el mismo de Sabina). El modelo NO recibe precios y el navegador NO
 *          manda texto: solo los ids de los procedimientos a describir, que se
 *          vuelven a leer de la base con el clinicId de la sesión.
 *
 * Mismo permiso que guardar la página: `landing.edit`. Y el mismo interruptor
 * que enseña el botón (`menu-dos-niveles`): con la bandera apagada la pantalla
 * de siempre no tiene esta función, y la ruta tampoco contesta.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODELO = "claude-sonnet-5";
const MAX_TOKENS_DE_SALIDA = 4000;

type Lectura = {
  clinica: DatosDeClinica;
  guardados: ServicioGuardado[];
  tarifario: FilaTarifario[];
  doctores: FilaDoctor[];
  horarios: FilaHorario[];
};

async function leerClinica(clinicId: string): Promise<Lectura | null> {
  // Cuatro consultas, todas con el clinicId de la sesión. `select` explícito:
  // de `Clinic` solo lo que se enseña; de `User`, la cédula se reduce a sí/no.
  const [clinic, tarifario, usuarios, horarios] = await Promise.all([
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        name: true, city: true, state: true, address: true, phone: true,
        landingWhatsapp: true, landingMsiPlazos: true, landingServices: true,
      },
    }),
    prisma.procedureCatalog.findMany({
      where: { clinicId, isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true, basePrice: true, duration: true, description: true },
      take: 300,
    }),
    // Los mismos que pinta la página pública (ver /[slug]/clinic-landing-server).
    prisma.user.findMany({
      where: { clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } },
      orderBy: { firstName: "asc" },
      select: { firstName: true, lastName: true, specialty: true, role: true, cedulaProfesional: true },
    }),
    prisma.clinicSchedule.findMany({
      where: { clinicId },
      orderBy: { dayOfWeek: "asc" },
      select: { dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
    }),
  ]);
  if (!clinic) return null;
  return {
    clinica: {
      name: clinic.name, city: clinic.city, state: clinic.state, address: clinic.address,
      phone: clinic.phone, landingWhatsapp: clinic.landingWhatsapp,
      landingMsiPlazos: clinic.landingMsiPlazos ?? [],
    },
    guardados: Array.isArray(clinic.landingServices) ? (clinic.landingServices as ServicioGuardado[]) : [],
    tarifario,
    doctores: usuarios.map(u => ({
      firstName: u.firstName, lastName: u.lastName, specialty: u.specialty, role: u.role,
      tieneCedula: !!u.cedulaProfesional?.trim(),
    })),
    horarios,
  };
}

/** Sesión + permiso + bandera. Devuelve el clinicId o la respuesta de rechazo. */
async function entrar(): Promise<{ clinicId: string; isAdmin: boolean } | NextResponse> {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No has iniciado sesión." }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "landing.edit");
  if (denied) return denied;
  if (!(await menuDosNivelesEncendido(ctx.clinicId))) {
    return NextResponse.json({ error: "Esta función todavía no está encendida para tu clínica." }, { status: 403 });
  }
  return { clinicId: ctx.clinicId, isAdmin: ctx.isAdmin };
}

/**
 * Cuánto va a costar redactar, ANTES de gastar. Es una cuenta aproximada
 * (≈3.5 caracteres por token en español) con los precios vivos de
 * `AiPricingConfig`: nada de cifras escritas a mano aquí.
 */
async function costoEstimadoCents(caracteresDeEntrada: number, servicios: number): Promise<number> {
  const entrada = Math.ceil(caracteresDeEntrada / 3.5);
  const salida = Math.min(MAX_TOKENS_DE_SALIDA, 650 + servicios * 70);
  const cfg = await getPricingConfig();
  return usdMicrosToBilledCents(computeCostUsdMicros(MODELO, entrada, salida, 0, cfg), cfg);
}

export async function GET() {
  try {
    const paso = await entrar();
    if (paso instanceof NextResponse) return paso;

    const datos = await leerClinica(paso.clinicId);
    if (!datos) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

    const lectura = armarLectura(datos.clinica, datos.tarifario, datos.doctores, datos.horarios, datos.guardados);
    const aRedactar = Math.min(MAX_SERVICIOS_A_REDACTAR, lectura.servicios.length);
    const hechos = construirHechos(datos.clinica, datos.doctores, datos.horarios,
      lectura.servicios.slice(0, aRedactar).map(s => ({ id: s.id, nombre: s.nombre, categoria: s.categoria, nota: s.descripcionTarifario })));
    const costo = await costoEstimadoCents(INSTRUCCIONES_DE_REDACCION.length + JSON.stringify(hechos).length, aRedactar)
      .catch(() => null);

    return NextResponse.json({ lectura, costoEstimadoCents: costo, maxServiciosARedactar: MAX_SERVICIOS_A_REDACTAR });
  } catch (err) {
    console.error("[landing-autocompletar] lectura falló", err);
    return NextResponse.json({ error: "No pudimos leer los datos de tu clínica. Vuelve a intentarlo." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const paso = await entrar();
    if (paso instanceof NextResponse) return paso;
    const { clinicId, isAdmin } = paso;

    // Freno de gasto por CLÍNICA: cada intento cuesta saldo.
    const rl = await persistentRateLimit(req, { id: `landing-autocompletar:${clinicId}`, limit: 6, windowSec: 600 });
    if (rl) return rl;

    const body = await req.json().catch(() => null);
    const ids: string[] = Array.isArray(body?.servicios)
      ? body.servicios.filter((x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 40)
          .slice(0, MAX_SERVICIOS_A_REDACTAR)
      : [];

    if (!(await canSpend(clinicId))) {
      return NextResponse.json(
        { error: "El monedero de IA de la clínica no tiene saldo. Recárgalo para redactar con IA.", sinSaldo: true, isAdmin },
        { status: 402 },
      );
    }

    const datos = await leerClinica(clinicId);
    if (!datos) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

    // Los ids vienen del navegador; los NOMBRES salen de la base, ya filtrada
    // por clinicId. Un id de otra clínica sencillamente no aparece.
    const pedidos = new Set(ids);
    const servicios = datos.tarifario
      .filter(f => pedidos.has(f.id))
      .map(f => ({ id: f.id, nombre: f.name.trim(), categoria: f.category, nota: f.description?.trim() || null }));
    const hechos = construirHechos(datos.clinica, datos.doctores, datos.horarios, servicios);

    const salida = await chat({
      model: MODELO,
      maxTokens: MAX_TOKENS_DE_SALIDA,
      system: INSTRUCCIONES_DE_REDACCION,
      messages: [{ role: "user", content: `HECHOS:\n${JSON.stringify(hechos)}` }],
    });

    if (salida.mock) {
      return NextResponse.json({ error: "La redacción con IA no está configurada en este entorno." }, { status: 503 });
    }

    // Se cobra SIEMPRE que hubo tokens, aunque la respuesta no sirva: el
    // proveedor ya los cobró. El cobro es best-effort y nunca tumba la respuesta.
    let cobradoCents: number | null = null;
    if (!salida.error && salida.inputTokens != null) {
      try {
        const cobro = await chargeUsage({
          clinicId,
          feature: AI_FEATURE_LANDING_COPY,
          model: MODELO,
          inputTokens: salida.inputTokens ?? 0,
          outputTokens: salida.outputTokens ?? 0,
          cacheTokens: salida.cacheRead ?? 0,
          cacheWriteTokens: salida.cacheCreation ?? 0,
        });
        cobradoCents = cobro?.billedCents ?? null;
      } catch (e) {
        console.error("[landing-autocompletar] no se pudo cobrar al monedero", {
          clinicId, err: e instanceof Error ? e.message : "desconocido",
        });
      }
    }

    if (salida.error) {
      console.error("[landing-autocompletar] el modelo falló", { clinicId, err: salida.error });
      return NextResponse.json({ error: "La IA no pudo redactar en este momento. Inténtalo de nuevo." }, { status: 503 });
    }

    const redaccion = validarRedaccion(extraerJson(salida.text), hechos);
    if (!redaccion) {
      return NextResponse.json(
        { error: "La IA contestó algo que no se puede usar. No se cambió nada en tu página; inténtalo de nuevo.", cobradoCents },
        { status: 502 },
      );
    }
    return NextResponse.json({ redaccion, cobradoCents });
  } catch (err) {
    console.error("[landing-autocompletar] fallo no previsto", err);
    return NextResponse.json({ error: "La redacción con IA no está disponible en este momento." }, { status: 503 });
  }
}
