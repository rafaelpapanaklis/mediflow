"use server";
// Ortodoncia — Cobro (ws1-t1, Ola 1): TODO lo que necesita la Sección F para
// pintarse, en una sola llamada. `SectionFinance` (client component) la
// invoca directamente al montar y después de cada acción — mismo patrón de
// "autofetch" que ya usa `AvisoAnticiposPorRevisar` en Caja, pero por
// server action en vez de una ruta GET nueva (menos superficie que tocar).
//
// Permiso: `billing.view` — leer cobranza es facturación, no expediente
// clínico (ver `_ctx.ts` sobre por qué esta parte no usa `medicalRecord.*`).
//
// No llama a `cargarCobranzaDelCaso` (el cargador con I/O de `cobranza-db.ts`,
// Ola 0): esta action YA necesita leer `invoice` y `condiciones` para el
// recargo (F10) y el resumen de la factura, así que repetir esas mismas 2
// consultas en el cargador dedicado sería una vuelta de más. Se usa la
// versión PURA (`cobranzaDelCaso`, sin I/O, EXACTAMENTE el mismo contrato de
// Ola 0, sin tocarlo) con el mismo input que arma el cargador original.

import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/auth/permissions";
import { menuDosNivelesEncendido } from "@/lib/menu-dos-niveles/interruptor";
import { cobranzaDelCasoUnificada, deudaDelCaso, type CobranzaDelCaso, type DeudaDelCaso } from "@/lib/orthodontics/cobranza-caso";
import { normalizarOrthoBillingMode, ORTHO_BILLING_MODE_LABELS, type OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { cargarCargosDeControlDelCaso, vencimientoDeFacturaPrincipal } from "@/lib/orthodontics/cobranza-controles-db";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import { getPatientCreditBalance } from "@/lib/patient-credit";
import { leerConfigDeCobro, type ConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import { leerBillingDelCaso, type BillingDelCaso } from "@/lib/orthodontics/cobro/caso-db";
import { borradorInicialDelCaso, type ConceptoDeExtra } from "@/lib/orthodontics/cobro/borrador-factura";
import type { BorradorDeFactura } from "@/components/dashboard/factura-ficha-rediseno/datos";
import { listarExtrasDelCaso, type ExtraDelCaso } from "@/lib/orthodontics/cobro/extras-db";
import { listarPromesasDelCaso, type PromesaDePago } from "@/lib/orthodontics/cobro/promesas-db";
import { calcularRecargo, diasEntre } from "@/lib/orthodontics/cobro/reglas";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { ESTADOS_LIGABLES, conceptoDeFactura, facturaSinLigarReciente } from "@/lib/orthodontics/cobro/facturas-ligables";
import { extrasPendientesPorCasos, idsDeFacturasLigadasAUnCaso } from "@/lib/orthodontics/cobro/extras-db";
import { getOrthoBillingActionContext } from "../_helpers";
import { loadCasoParaCobro } from "./_ctx";
import { elegirPrecioColocacion, listarProcedimientosDeOrtodoncia, type OrthoProcedureRow } from "@/lib/orthodontics/catalog-procedures";
import { precioDeControlDelCaso } from "@/lib/orthodontics/precio-control-del-caso-db";
import { cargarPlanDetalle } from "@/lib/orthodontics/plan-detalle-db";
import { cargarProgresoDeControles } from "@/lib/orthodontics/controles-hechos-db";
import { aparatologiaElegida, estimadoPorControles, ordenarConSugeridosPrimero, procedimientosQueFaltanEnElCatalogo, procedimientosSugeridos, type EstimadoPorControles } from "@/lib/orthodontics/plan-detalle";
import { limitarConcurrencia } from "@/lib/limitar-concurrencia";
import { controlesPorCobrarDe, type ControlPorCobrar } from "@/lib/orthodontics/cobro/controles-por-cobrar";
import { fail, isFailure, ok, type ActionResult } from "../result";

const ROLES_DE_DIRECCION = new Set(["SUPER_ADMIN", "ADMIN"]);

export interface FacturaResumen {
  id: string;
  invoiceNumber: string | null;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

export type { ControlPorCobrar };

export interface PanelDeCobro {
  patientId: string;
  /** ws1-t4 #77 — en «Pago por control», los controles con factura sin pagar, del más viejo al más nuevo. Vacío en «Precio total». */
  controlesPorCobrar: ControlPorCobrar[];
  invoiceId: string | null;
  invoice: FacturaResumen | null;
  /** Las condiciones crudas de la factura (para F7, precargar el editor de plan). */
  condiciones: CondicionesPago | null;
  cobranza: CobranzaDelCaso | null;
  /**
   * ws1-t4 (saldo a favor en Ortodoncia) — el saldo a favor del PACIENTE, del
   * libro `patient_credits` (`getPatientCreditBalance`): la MISMA cifra que su
   * resumen, esté o no el caso con factura. Se usa al cobrar («Usar saldo a
   * favor»); no resta de `deuda`.
   */
  saldoAFavor: number;
  /**
   * ws1-t4 (revisión final, fallo 1) — LO QUE DEBE EL CASO, con la misma
   * función (`deudaDelCaso`) que Cobranza, Casos y la cabecera: plan o
   * colocación + controles + extras sin pagar.
   */
  deuda: DeudaDelCaso;
  /** Ola 2 (ws1-t1) — modo CON EL QUE NACIÓ este caso (no el default actual de la clínica). */
  billingMode: OrthoBillingMode;
  billingModeLabel: string;
  /** Recargo por atraso sugerido HOY sobre `cobranza.cuotaDeHoy`, o 0. Nunca se cobra solo. */
  recargoSugerido: number;
  billingDelCaso: BillingDelCaso;
  config: ConfigDeCobro;
  extras: ExtraDelCaso[];
  promesas: PromesaDePago[];
  /** `menuDosNivelesEncendido(clinicId)`: sin esto, la factura no ofrece "a plazos". */
  redisenoFacturas: boolean;
  clinicTaxMode: string | null;
  /**
   * ws1-t4: la sesión puede registrar pagos (billing.charge). Sin esto no se
   * ofrece «Cobrar» (el POST del pago ya lo exigía; el botón no).
   */
  puedeCobrar: boolean;
  /** SUPER_ADMIN/ADMIN: puede cambiar la política de cobro de la clínica (F9/F10). */
  puedeConfigurarPolitica: boolean;
  /**
   * ronda 3 (ws1-t2, H9): con qué arranca «Abrir plan de pago» / «Abrir
   * factura de colocación/enganche» — concepto (técnica), precio de
   * referencia del caso y doctor tratante, en vez de un editor en blanco.
   * Editable siempre: solo evita partir de cero.
   */
  borradorInicial: BorradorDeFactura;
  /** H7: conceptos de ortodoncia que se cobran aparte (catálogo de la clínica), para «Cobrar extra». Los que el plan de tratamiento propone, primero. */
  catalogoDeExtras: ConceptoDeExtra[];
  /** ws1-t12: lo que el plan eligió (microtornillos, miniplacas…) y el catálogo NO tiene: «Cobrar extra» lo dice y manda a Configuración → Procedimientos. */
  procedimientosFaltantes: string[];
  /**
   * ws1-t12 — los controles que prevé el plan de tratamiento del caso y en cuál va. `null` = el plan no
   * dice cuántos controles prevé. `estimado` solo en «Pago por control» (controles previstos × precio del
   * control del catálogo): es una ESTIMACIÓN, nada se cobra solo — cada control se cobra al atenderlo.
   */
  controlesDelPlan: {
    previstos: number;
    hechos: number;
    /** Precio de «Control de ortodoncia» del catálogo (solo se busca en «Pago por control»). */
    precioPorControl: number | null;
    estimado: EstimadoPorControles | null;
  } | null;
  /**
   * H5: una factura de ortodoncia recién creada que no quedó ligada al caso
   * (se cortó entre crearla y ligarla). Solo si el caso no tiene plan vigente.
   */
  facturaSinLigar: { id: string; invoiceNumber: string; concepto: string; total: number; fecha: string } | null;
}

/** H5: la factura de ortodoncia recién creada que no quedó ligada a ningún caso (`null` si no hay o no se pudo buscar). */
async function buscarFacturaSinLigar(clinicId: string, patientId: string): Promise<PanelDeCobro["facturaSinLigar"]> {
  try {
    const recientes = await prisma.invoice.findMany({
      where: {
        clinicId,
        patientId,
        status: { in: [...ESTADOS_LIGABLES] },
        appointmentId: null,
        orthodonticTreatmentPlan: null,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, invoiceNumber: true, items: true, total: true, status: true, appointmentId: true, createdAt: true },
    });
    const ligadas = await idsDeFacturasLigadasAUnCaso(clinicId, recientes.map((r) => r.id));
    const hallada = facturaSinLigarReciente(
      recientes.map((r) => ({ ...r, ligadaACaso: ligadas.has(r.id) ? "extra" : null })),
      new Date(),
    );
    if (!hallada) return null;
    return {
      id: hallada.id,
      invoiceNumber: hallada.invoiceNumber,
      concepto: conceptoDeFactura(hallada.items),
      total: hallada.total,
      fecha: hallada.createdAt.toISOString(),
    };
  } catch (e) {
    console.warn("[ortodoncia:cobro] no se pudo buscar una factura sin ligar:", e);
    return null;
  }
}

export async function cargarPanelDeCobro(treatmentPlanId: string): Promise<ActionResult<PanelDeCobro>> {
  const ctxResult = await getOrthoBillingActionContext("billing.view");
  if (isFailure(ctxResult)) return ctxResult;
  const { ctx } = ctxResult.data;

  // ws1-t10 — medido en panel.108 (cada ida a la base ≈ 160–320 ms): ninguna consulta
  // es lenta por sí sola; lo que sumaba >10 s eran ~20 idas y vueltas EN FILA (el caso,
  // luego las siete de la primera tanda, luego el precio de la colocación, luego el
  // catálogo —que se leía dos veces—, luego la factura, luego otra tanda…). Ahora todo lo
  // que no depende de otra cosa arranca junto, con un tope de 6 en vuelo (el pooler), y lo
  // que depende del caso arranca en cuanto el caso llega. Los `select` y los filtros por
  // clínica son los mismos. Las lecturas se piden antes de saber si el caso es de esta
  // clínica y visible para quien pregunta, pero todas filtran por `clinicId` de la sesión y
  // NADA se devuelve si el caso no pasa: es la misma respuesta, en menos tiempo.
  const correr = limitarConcurrencia(6);
  // Una lectura que nadie llegó a esperar (salida temprana) no debe tumbar el proceso.
  const pedir = <T,>(tarea: () => Promise<T>): Promise<T> => {
    const p = correr(tarea);
    p.catch(() => {});
    return p;
  };

  const pCaso = pedir(() => loadCasoParaCobro({ ctx, treatmentPlanId }));
  const pModo = pedir(() => cargarModoDeCobro(ctx.clinicId, treatmentPlanId));
  const pClinica = pedir(() => prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { cfdiTaxMode: true, timezone: true } }));
  const pRediseno = pedir(() => menuDosNivelesEncendido(ctx.clinicId));
  const pConfig = pedir(() => leerConfigDeCobro(ctx.clinicId));
  // El catálogo de ortodoncia se lee UNA vez: de él salen los extras (H7) y el precio de la colocación.
  // Si no se puede leer, el extra parte sin lista y la colocación sin precio de referencia.
  const pCatalogo = pedir((): Promise<OrthoProcedureRow[]> => listarProcedimientosDeOrtodoncia(ctx.clinicId).catch(() => []));
  const pBillingDelCaso = pedir(() => leerBillingDelCaso(treatmentPlanId, ctx.clinicId));
  // ws1-t12: el plan de tratamiento completo (controles previstos, aparatología, aditamentos). Sin la columna, null.
  const pPlanDetalle = pedir(() => cargarPlanDetalle(ctx.clinicId, treatmentPlanId).catch(() => null));
  const pExtras = pedir(() => listarExtrasDelCaso(treatmentPlanId, ctx.clinicId));
  const pPromesas = pedir(() => listarPromesasDelCaso(treatmentPlanId, ctx.clinicId));
  // Lo que se debe en extras, con la MISMA consulta que Cobranza y Casos (tablero-data.ts).
  const pExtrasPendientes = pedir(() => extrasPendientesPorCasos(ctx.clinicId, [treatmentPlanId]));

  const casoResult = await pCaso;
  if (isFailure(casoResult)) return casoResult;
  const caso = casoResult.data;

  // Lo que depende del caso arranca ya, sin esperar a las demás lecturas.
  const pInvoice = caso.invoiceId
    ? pedir(() =>
        prisma.invoice.findFirst({
          where: { id: caso.invoiceId!, clinicId: ctx.clinicId },
          select: { id: true, invoiceNumber: true, total: true, paid: true, balance: true, status: true, dueDate: true, createdAt: true, payments: { select: { amount: true, method: true } } },
        }),
      )
    : null;
  const pCondiciones = caso.invoiceId
    ? pedir(() => leerCondicionesDeFacturas(prisma, { clinicId: ctx.clinicId, invoiceIds: [caso.invoiceId!] }))
    : null;
  const pSaldoAFavor = pedir(() => getPatientCreditBalance(ctx.clinicId, caso.patientId));
  const pCargosControl: Promise<Awaited<ReturnType<typeof cargarCargosDeControlDelCaso>>> = pModo.then((crudo) =>
    normalizarOrthoBillingMode(crudo) === "PAGO_POR_CONTROL"
      ? pedir(() => cargarCargosDeControlDelCaso(ctx.clinicId, treatmentPlanId))
      : [],
  );
  pCargosControl.catch(() => {});
  // H5: sin factura en el caso ya se sabe que no hay plan vigente: se busca la huérfana sin esperar.
  const pSinLigar = caso.invoiceId ? null : pedir(() => buscarFacturaSinLigar(ctx.clinicId, caso.patientId));

  // Ya están todas en camino (con su tope de 6 en vuelo): esto solo las espera.
  const [redisenoFacturas, clinica, billingDelCaso, config] = await Promise.all([pRediseno, pClinica, pBillingDelCaso, pConfig]);
  const [extras, promesas, billingModeCrudo, filasCatalogo] = await Promise.all([pExtras, pPromesas, pModo, pCatalogo]);
  const billingMode = normalizarOrthoBillingMode(billingModeCrudo);
  // Solo en PAGO_POR_CONTROL el borrador es la colocación, y solo ahí hace falta el precio.
  const precioColocacion = billingMode === "PAGO_POR_CONTROL" ? elegirPrecioColocacion(filasCatalogo) : null;

  // ws1-t12: el plan de tratamiento del caso alimenta el cobro — la colocación lleva la aparatología elegida
  // en su concepto, «Cobrar extra» propone primero lo que el plan pide (microtornillo, barra palatina…) y
  // los controles previstos dan el estimado de «Pago por control».
  const planDetalle = await pPlanDetalle;
  const aparatologia = aparatologiaElegida(planDetalle);

  // H7: solo lo activo y «con costo aparte»; lo que el plan propone, primero.
  const filasDeExtras = filasCatalogo.filter((f) => f.isActive && f.orthoIncludedInTreatment === false);
  const sugeridos = procedimientosSugeridos(planDetalle, filasDeExtras);
  const motivoPorId = new Map(sugeridos.map((x) => [x.procedureId, x.motivo]));
  const catalogoDeExtras: ConceptoDeExtra[] = ordenarConSugeridosPrimero(filasDeExtras, sugeridos).map((f) => ({
    name: f.name,
    price: Number(f.basePrice) || 0,
    ...(motivoPorId.has(f.id) ? { sugerido: true, motivo: motivoPorId.get(f.id) } : {}),
  }));

  const procedimientosFaltantes = procedimientosQueFaltanEnElCatalogo(planDetalle, filasCatalogo.filter((f) => f.isActive));

  // «Control X de N» y, en «Pago por control», el estimado. Solo se calcula si el plan dice cuántos controles prevé.
  const previstos = planDetalle?.controlesPrevistos ?? null;
  const zonaDelCaso = clinica?.timezone || "America/Mexico_City";
  let controlesDelPlan: PanelDeCobro["controlesDelPlan"] = null;
  if (previstos) {
    const [progreso, precio] = await Promise.all([
      cargarProgresoDeControles(ctx.clinicId, zonaDelCaso, [{ planId: treatmentPlanId, patientId: caso.patientId, inicio: caso.inicio }]),
      // ws1-t12 (6b): el precio por control del caso (de su técnica); sin él, el del catálogo.
      billingMode === "PAGO_POR_CONTROL" ? precioDeControlDelCaso(ctx.clinicId, treatmentPlanId).catch(() => null) : Promise.resolve(null),
    ]);
    const precioPorControl = precio?.precio ?? null;
    controlesDelPlan = {
      previstos,
      hechos: progreso.get(treatmentPlanId)?.hechos ?? 0,
      precioPorControl,
      estimado: billingMode === "PAGO_POR_CONTROL" ? estimadoPorControles(previstos, precioPorControl) : null,
    };
  }

  const base = {
    catalogoDeExtras,
    patientId: caso.patientId,
    billingDelCaso,
    config,
    extras,
    promesas,
    redisenoFacturas,
    clinicTaxMode: clinica?.cfdiTaxMode ?? null,
    puedeCobrar: hasPermission({ role: ctx.role as never, permissionsOverride: ctx.permissionsOverride }, "billing.charge"),
    puedeConfigurarPolitica: ROLES_DE_DIRECCION.has(ctx.role),
    billingMode,
    billingModeLabel: ORTHO_BILLING_MODE_LABELS[billingMode],
    borradorInicial: borradorInicialDelCaso({ ...caso, aparatologia }, billingMode === "PAGO_POR_CONTROL", precioColocacion),
    controlesDelPlan,
    procedimientosFaltantes,
  };

  const zonaHoraria = clinica?.timezone || "America/Mexico_City";

  const invoice = pInvoice ? await pInvoice : null;
  if (caso.invoiceId && !invoice) return fail("La factura del tratamiento ya no existe");

  const [condicionesResult, saldoAFavorPrevio, cargosControl, extrasPendientes] = await Promise.all([
    pCondiciones ?? Promise.resolve({ porFactura: new Map<string, CondicionesPago>() }),
    pSaldoAFavor,
    pCargosControl,
    pExtrasPendientes,
  ]);

  const condiciones = invoice ? condicionesResult.porFactura.get(invoice.id) ?? null : null;
  // ws1-t10 (H·F "Factura cancelada") — una factura CANCELLED no cuenta como
  // deuda del caso (mismo criterio que cobranza-db.ts): el total cancelado
  // no se sigue anunciando como pendiente.
  const facturaVigente = invoice && invoice.status !== "CANCELLED" ? invoice : null;
  const cobranza = cobranzaDelCasoUnificada({
    modo: billingMode,
    facturaPrincipal: facturaVigente
      ? {
          condiciones,
          totalFactura: facturaVigente.total,
          cobros: facturaVigente.payments,
          pagado: facturaVigente.paid,
          invoiceId: facturaVigente.id,
          vencimiento: vencimientoDeFacturaPrincipal(billingMode, facturaVigente.dueDate, facturaVigente.createdAt, zonaHoraria),
        }
      : null,
    cargosControl,
    saldoAFavorPrevio,
    ahora: new Date(),
    zonaHoraria,
  });

  const hoy = hoyEnZona(new Date(), zonaHoraria);
  const cuotaVencida = cobranza?.cuotaDeHoy?.estado === "vencida" ? cobranza.cuotaDeHoy : null;
  const recargoSugerido = cuotaVencida
    ? calcularRecargo(config.lateFee, cuotaVencida.falta, cuotaVencida.vencimiento ? diasEntre(cuotaVencida.vencimiento, hoy) : 0)
    : 0;

  const controlesPorCobrar = controlesPorCobrarDe(cargosControl);

  // H5: sin plan vigente, ¿hay una factura de ortodoncia recién creada sin ligar? (Con factura en el
  // caso, solo si esa factura está cancelada; sin factura ya se pidió arriba, en paralelo.)
  const facturaSinLigar: PanelDeCobro["facturaSinLigar"] = facturaVigente
    ? null
    : pSinLigar
      ? await pSinLigar
      : await buscarFacturaSinLigar(ctx.clinicId, caso.patientId);

  return ok({
    ...base,
    controlesPorCobrar,
    invoiceId: caso.invoiceId,
    invoice: invoice ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total, paid: invoice.paid, balance: invoice.balance, status: invoice.status } : null,
    condiciones,
    cobranza,
    saldoAFavor: Math.max(0, Math.round((Number(saldoAFavorPrevio) || 0) * 100) / 100),
    deuda: deudaDelCaso(cobranza, extrasPendientes.get(treatmentPlanId)),
    recargoSugerido,
    facturaSinLigar,
  });
}
