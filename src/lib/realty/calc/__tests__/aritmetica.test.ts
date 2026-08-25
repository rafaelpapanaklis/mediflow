// ═══════════════════════════════════════════════════════════════════════
// ARITMÉTICA DE LAS TRES CALCULADORAS.
//
// Pruebas PURAS: no necesitan Postgres, ni sesión, ni navegador. Corren en
// menos de un segundo y son la red que atrapa el peor modo de falla de este
// módulo — un número mal calculado NO se ve como un error, se ve como una
// respuesta. Nadie va a notar que el ISR está mal hasta que el vendedor
// llegue a la notaría con una cifra que no es.
//
//   npx tsx --test src/lib/realty/calc/__tests__/aritmetica.test.ts
//
// (Sin script en package.json a propósito: el guardia del vertical marca
// package.json como PROHIBIDO y esta ola no lo toca.)
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MX_STATES,
  resolveCreditoParams,
  resolveEscrituracionParams,
  resolveIsrParams,
  sanitizarMeta,
  type RawCalcParamRow,
} from "../catalog";
import { buildSeed, TARIFA_ISR_ANUAL_2024 } from "../seed";
import { calcularEscrituracion } from "../escrituracion";
import { calcularIsrVenta, isrSegunTarifa } from "../isr";
import { precalificar } from "../infonavit";
import {
  fromCents,
  monthlyPayment,
  presentValueOfAnnuity,
  sumCents,
  toCents,
} from "../money";

// La semilla, servida como si viniera de la tabla.
const ROWS: RawCalcParamRow[] = buildSeed().map((r) => ({
  kind: r.kind,
  stateCode: r.stateCode,
  year: r.year,
  value: r.value,
  meta: r.meta,
  effectiveFrom: `${r.effectiveFrom}T00:00:00.000Z`,
}));

/** Una fecha fija: las pruebas no pueden depender del día que se corran. */
const HOY = new Date("2026-06-15T12:00:00.000Z");

function escrituracionDe(state: string) {
  const r = resolveEscrituracionParams(ROWS, state, HOY);
  assert.equal(r.ok, true, `no se resolvieron los parámetros de ${state}: ${JSON.stringify(r.faltantes)}`);
  return r.params!;
}

function isrDe(state: string) {
  const r = resolveIsrParams(ROWS, state, HOY);
  assert.equal(r.ok, true, `no se resolvió el ISR de ${state}: ${JSON.stringify(r.faltantes)}`);
  return r.params!;
}

function creditoParams() {
  const r = resolveCreditoParams(ROWS, HOY);
  assert.equal(r.ok, true, `no se resolvió el crédito: ${JSON.stringify(r.faltantes)}`);
  return r.params!;
}

// ── 1. Dinero sin deriva ───────────────────────────────────────────────

test("las sumas de dinero no derivan (el caso clásico del float)", () => {
  // 179.99 + 180 + 180 en pesos da 539.9899999999999.
  const total = sumCents(toCents(179.99), toCents(180), toCents(180));
  assert.equal(total, 53999);
  assert.equal(fromCents(total), 539.99);
});

test("valor presente y mensualidad son inversas exactas", () => {
  const pago = toCents(12000);
  const i = 0.105 / 12;
  const n = 240;
  const capital = presentValueOfAnnuity(pago, i, n);
  const vuelta = monthlyPayment(capital, i, n);
  // Redondeo a centavo en los dos sentidos: tolerancia de un peso.
  assert.ok(Math.abs(vuelta - pago) <= 100, `${vuelta} vs ${pago}`);
});

// ── 2. La tarifa del ISR está bien capturada ───────────────────────────

test("la tarifa del artículo 152 encadena: cada cuota fija sale de la anterior", () => {
  for (let i = 1; i < TARIFA_ISR_ANUAL_2024.length; i++) {
    const prev = TARIFA_ISR_ANUAL_2024[i - 1];
    const cur = TARIFA_ISR_ANUAL_2024[i];
    const esperado = prev.cuota + ((prev.ls! - prev.li) * prev.pct) / 100;
    assert.ok(
      Math.abs(esperado - cur.cuota) < 0.05,
      `tramo ${i}: la cuota fija debería ser ~${esperado.toFixed(2)} y es ${cur.cuota}`,
    );
  }
});

test("la tarifa es continua: los límites no dejan huecos ni se traslapan", () => {
  for (let i = 1; i < TARIFA_ISR_ANUAL_2024.length; i++) {
    const prev = TARIFA_ISR_ANUAL_2024[i - 1];
    const cur = TARIFA_ISR_ANUAL_2024[i];
    assert.ok(cur.li > prev.li, `los límites inferiores deben ir subiendo (tramo ${i})`);
    assert.ok(
      Math.abs(cur.li - prev.ls!) < 0.02,
      `hueco entre ${prev.ls} y ${cur.li} en el tramo ${i}`,
    );
  }
});

test("el ISR de la tarifa crece con la base y nunca es negativo", () => {
  assert.equal(isrSegunTarifa(0, TARIFA_ISR_ANUAL_2024), 0);
  assert.equal(isrSegunTarifa(-5000, TARIFA_ISR_ANUAL_2024), 0);
  let anterior = -1;
  for (const base of [1000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000]) {
    const isr = isrSegunTarifa(base, TARIFA_ISR_ANUAL_2024);
    assert.ok(isr > anterior, `el ISR debe crecer con la base (${base})`);
    assert.ok(isr < toCents(base), "el ISR no puede superar la base gravable");
    anterior = isr;
  }
});

// ── 3. CASO DEL REVISOR — escrituración de $2,000,000 en CDMX ──────────

test("CASO 1 · escrituración de una casa de $2,000,000 en CDMX cae entre 5% y 10%", () => {
  const params = escrituracionDe("CMX");
  const r = calcularEscrituracion({ precioCents: toCents(2_000_000) }, params);

  assert.equal(r.ok, true);
  assert.ok(r.totalPctMin! >= 5, `el mínimo quedó en ${r.totalPctMin!.toFixed(2)}%, por debajo del 5%`);
  assert.ok(r.totalPctMax! <= 10, `el máximo quedó en ${r.totalPctMax!.toFixed(2)}%, por encima del 10%`);
  assert.ok(r.totalMinCents! < r.totalMaxCents!, "el rango debe tener dos extremos distintos");

  // El desglose tiene que sumar exactamente el total (sin centavos perdidos).
  const sumaMin = sumCents(...r.conceptos!.map((c) => c.minCents));
  const sumaMax = sumCents(...r.conceptos!.map((c) => c.maxCents));
  assert.equal(sumaMin, r.totalMinCents);
  assert.equal(sumaMax, r.totalMaxCents);

  // Y el costo real es precio + gastos.
  assert.equal(r.costoRealMinCents, toCents(2_000_000) + r.totalMinCents!);
});

test("la base gravable es el MAYOR de precio, catastral y avalúo", () => {
  const params = escrituracionDe("JAL");
  const soloPrecio = calcularEscrituracion({ precioCents: toCents(1_000_000) }, params);
  const conCatastral = calcularEscrituracion(
    { precioCents: toCents(1_000_000), valorCatastralCents: toCents(1_400_000) },
    params,
  );
  assert.equal(soloPrecio.baseOrigen, "precio");
  assert.equal(conCatastral.baseOrigen, "catastral");
  assert.equal(conCatastral.baseGravableCents, toCents(1_400_000));
  assert.ok(conCatastral.totalMinCents! > soloPrecio.totalMinCents!);
  assert.ok(conCatastral.baseAdvertencia, "debe advertir que no se usó el precio");
});

test("el avalúo respeta su tarifa mínima en un inmueble barato", () => {
  const params = escrituracionDe("YUC");
  const r = calcularEscrituracion({ precioCents: toCents(300_000) }, params);
  const avaluo = r.conceptos!.find((c) => c.clave === "avaluo")!;
  // 0.15% de 300 mil son 450 pesos: el piso de 3,000 tiene que ganar.
  assert.equal(avaluo.minCents, toCents(params.avaluoPisoMin));
});

test("el IVA grava solo honorarios, nunca el ISAI ni los derechos", () => {
  const params = escrituracionDe("CMX");
  const r = calcularEscrituracion({ precioCents: toCents(2_000_000) }, params);
  const notario = r.conceptos!.find((c) => c.clave === "notario")!;
  const avaluo = r.conceptos!.find((c) => c.clave === "avaluo")!;
  const iva = r.conceptos!.find((c) => c.clave === "iva")!;
  const esperado = Math.round(((notario.minCents + avaluo.minCents) * params.ivaHonorariosPct) / 100);
  assert.equal(iva.minCents, esperado);
});

test("un estado sin fila NO se inventa: sale como faltante", () => {
  const sinCmx = ROWS.filter((r) => !(r.kind === "ISAI" && r.stateCode === "CMX"));
  const r = resolveEscrituracionParams(sinCmx, "CMX", HOY);
  assert.equal(r.ok, false);
  assert.equal(r.faltantes.length, 1);
  assert.match(r.faltantes[0].etiqueta, /Ciudad de M/);
  assert.match(r.faltantes[0].comoResolver, /Par[aá]metros/);
});

// ── 4. CASO DEL REVISOR — ISR ──────────────────────────────────────────

test("CASO 2 · venta de $5,000,000 de casa habitación sin exención previa: EXENTO", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(5_000_000),
      precioAdquisicionCents: toCents(1_500_000),
      anioAdquisicion: 2015,
      anioVenta: 2026,
      esCasaHabitacion: true,
      usoExencionReciente: false,
    },
    params,
  );

  assert.equal(r.ok, true);
  // El tope: 700,000 UDIS × 8.83 = 6,181,000 pesos. 5 millones caben.
  assert.equal(fromCents(r.limiteExentoCents!), 6_181_000);
  assert.equal(r.exento, true, "debería salir exento: está por debajo del tope");
  assert.equal(r.isrCents, 0);
  assert.equal(r.gananciaGravadaCents, 0);
  assert.equal(r.totalImpuestosCents, 0);
  // La ganancia SÍ existe aunque esté exenta: es información del vendedor.
  assert.ok(r.gananciaTotalCents! > 0);
});

test("CASO 3 · venta de $8,000,000: exenta la parte hasta el tope, gravada la diferencia", () => {
  const params = isrDe("JAL");
  const precio = 8_000_000;
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(precio),
      precioAdquisicionCents: toCents(3_000_000),
      anioAdquisicion: 2016,
      anioVenta: 2026,
      esCasaHabitacion: true,
      usoExencionReciente: false,
    },
    params,
  );

  assert.equal(r.ok, true);
  assert.equal(r.exento, false);
  assert.equal(r.exentoParcial, true, "debe ser exención PARCIAL, no pérdida total de la exención");

  // La proporción gravada es el excedente sobre el precio, no todo el precio.
  const limite = fromCents(r.limiteExentoCents!);
  const esperada = (precio - limite) / precio;
  assert.ok(
    Math.abs(r.proporcionGravada! - esperada) < 1e-9,
    `proporción gravada ${r.proporcionGravada} vs esperada ${esperada}`,
  );
  assert.ok(r.proporcionGravada! > 0 && r.proporcionGravada! < 1, "no puede gravar el 100%");

  // Y la ganancia gravada es esa proporción de la ganancia total.
  const gravadaEsperada = Math.round(r.gananciaTotalCents! * r.proporcionGravada!);
  assert.equal(r.gananciaGravadaCents, gravadaEsperada);
  assert.ok(r.gananciaGravadaCents! < r.gananciaTotalCents!, "la exención tiene que morder");

  assert.ok(r.isrCents! > 0, "con parte gravada tiene que haber impuesto");
  assert.ok(
    r.isrCents! < r.gananciaGravadaCents!,
    "el ISR no puede superar la ganancia que lo genera",
  );
  assert.ok(r.tasaEfectivaPct! > 0 && r.tasaEfectivaPct! < 35, "tasa efectiva fuera de rango legal");
});

// 🔴 NO se compara isr contra ganancia×(isr/ganancia): eso da delta 0 POR
// CONSTRUCCIÓN aunque el ISR estuviera completamente mal. Los números de
// abajo salieron A LÁPIZ con la tarifa del Anexo 8 y van clavados; si la
// aritmética cambia, hay que rehacer la cuenta a mano antes de tocarlos.
test("CASO 3 · el ISR coincide con la tarifa del 152 aplicada a mano", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(8_000_000),
      precioAdquisicionCents: toCents(3_000_000),
      anioAdquisicion: 2016,
      anioVenta: 2026,
      esCasaHabitacion: true,
      usoExencionReciente: false,
    },
    params,
  );

  // A mano, paso por paso:
  //   factor   = INPC dic-2015 (89.047) → dic-2024 (137.949) = 1.5491706…
  //   terreno  = 3,000,000 × 20% = 600,000
  //   constr.  = 2,400,000, depreciada 10 años al 3% ⇒ ×0.70 = 1,680,000
  //   costo    = (600,000 + 1,680,000) × 1.5491706 = 3,532,109.xx
  //   ganancia = 8,000,000 − 3,532,109 = 4,467,891
  //   gravada  = 4,467,891 × (8,000,000 − 6,181,000)/8,000,000 = 1,015,886.69
  //   ÷10 años = 101,588.67 → tramo li 75,984.56, cuota 4,461.94, 10.88%
  //   tarifa   = 4,461.94 + (101,588.67 − 75,984.56) × 0.1088 = 7,247.67
  //   ISR      = 7,247.67 × 10 = 72,476.70
  assert.equal(r.inpcAnioBase, 2015, "la base del factor es el diciembre ANTERIOR a la compra");
  assert.equal(r.inpcAnioFinal, 2024);
  assert.equal(r.aniosParaDividir, 10);
  assert.equal(fromCents(r.gananciaAcumulableCents!), 101_588.67);
  assert.equal(fromCents(r.isrCents!), 72_476.7);

  // Y la tarifa sola, por separado, sobre esa misma base.
  assert.equal(isrSegunTarifa(101_588.67, TARIFA_ISR_ANUAL_2024), toCents(7_247.67));
});

test("el factor de INPC indexa TANTOS años como los que deprecia", () => {
  const params = isrDe("JAL");
  // Comprada en 2016 y vendida en 2017: un año de tenencia tiene que ser un
  // año de inflación. Con la base puesta en dic-2016 el factor salía 1.0000
  // clavado — un año de costo deducible perdido y más impuesto del real.
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(3_000_000),
      precioAdquisicionCents: toCents(1_000_000),
      anioAdquisicion: 2016,
      anioVenta: 2017,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  assert.equal(r.inpcAnioBase, 2015);
  assert.equal(r.inpcAnioFinal, 2016);
  // 92.039 / 89.047 = 1.0336 — la inflación de 2016, que es la que toca.
  assert.ok(
    r.factorActualizacion! > 1.03 && r.factorActualizacion! < 1.04,
    `factor ${r.factorActualizacion}: debería traer un año de inflación`,
  );
});

test("usar la exención hace dos años quita la exención entera", () => {
  const params = isrDe("JAL");
  const base = {
    precioVentaCents: toCents(4_000_000),
    precioAdquisicionCents: toCents(1_000_000),
    anioAdquisicion: 2018,
    anioVenta: 2026,
    esCasaHabitacion: true,
  };
  const limpio = calcularIsrVenta({ ...base, usoExencionReciente: false }, params);
  const usada = calcularIsrVenta({ ...base, usoExencionReciente: true }, params);

  assert.equal(limpio.exento, true);
  assert.equal(usada.exento, false);
  assert.equal(usada.proporcionGravada, 1, "sin exención grava el 100% de la ganancia");
  assert.ok(usada.isrCents! > 0);
  assert.match(usada.motivoNoExento!, /3 a/);
});

test("un local o un terreno no tienen exención por más barato que sea", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(900_000),
      precioAdquisicionCents: toCents(400_000),
      anioAdquisicion: 2019,
      anioVenta: 2026,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  assert.equal(r.exento, false);
  assert.equal(r.proporcionGravada, 1);
  assert.match(r.motivoNoExento!, /CASA HABITACI/);
});

test("el costo se actualiza por INPC y la construcción se deprecia", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(7_000_000),
      precioAdquisicionCents: toCents(1_000_000),
      anioAdquisicion: 2015,
      anioVenta: 2026,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  // INPC dic-2024 / INPC dic-2015 = 137.949 / 89.047 = 1.5492…
  assert.ok(r.factorActualizacion! > 1.5 && r.factorActualizacion! < 1.6, `factor ${r.factorActualizacion}`);
  // Con 11 años de depreciación al 3%, la construcción vale el 67% de su
  // costo, así que el costo actualizado NO es simplemente costo × factor.
  const ingenuo = Math.round(toCents(1_000_000) * r.factorActualizacion!);
  assert.ok(
    r.costoActualizadoCents! < ingenuo,
    "la depreciación de la construcción tiene que bajar el costo actualizado",
  );
  assert.ok(r.costoActualizadoCents! > toCents(1_000_000), "pero sigue por encima del costo histórico");
});

test("la división de la ganancia se topa en 20 años", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(6_000_000),
      precioAdquisicionCents: toCents(500_000),
      anioAdquisicion: 2000,
      anioVenta: 2026,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  // 2000 no está sembrado en el INPC: tiene que decirlo, no inventarlo.
  assert.equal(r.ok, false);
  assert.equal(r.faltaInpcDe, 2000);
  assert.match(r.error!, /INPC de 2000/);

  const conDato = calcularIsrVenta(
    {
      precioVentaCents: toCents(6_000_000),
      precioAdquisicionCents: toCents(500_000),
      anioAdquisicion: 2010,
      anioVenta: 2036,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  assert.equal(conDato.aniosTranscurridos, 26);
  assert.equal(conDato.aniosParaDividir, 20, "el tope de 20 años del artículo 120");
});

test("el impuesto cedular estatal se suma aparte del ISR federal", () => {
  const conCedular = isrDe("ROO"); // Quintana Roo: 5%
  const sinCedular = isrDe("JAL");
  assert.equal(conCedular.cedularPct, 5);
  assert.equal(sinCedular.cedularPct, 0);

  const entrada = {
    precioVentaCents: toCents(3_000_000),
    precioAdquisicionCents: toCents(800_000),
    anioAdquisicion: 2016,
    anioVenta: 2026,
    esCasaHabitacion: false,
    usoExencionReciente: false,
  };
  const conQr = calcularIsrVenta(entrada, conCedular);
  const conJal = calcularIsrVenta(entrada, sinCedular);

  assert.equal(conQr.isrCents, conJal.isrCents, "el ISR federal es el mismo");
  assert.ok(conQr.cedularCents! > 0);
  assert.equal(conQr.cedularCents, Math.round((conQr.gananciaGravadaCents! * 5) / 100));
  assert.equal(conQr.totalImpuestosCents, conQr.isrCents! + conQr.cedularCents!);
  assert.ok(conQr.totalImpuestosCents! > conJal.totalImpuestosCents!);
});

test("vender en pérdida no genera impuesto negativo", () => {
  const params = isrDe("JAL");
  const r = calcularIsrVenta(
    {
      precioVentaCents: toCents(900_000),
      precioAdquisicionCents: toCents(1_500_000),
      anioAdquisicion: 2020,
      anioVenta: 2026,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    params,
  );
  assert.equal(r.gananciaTotalCents, 0);
  assert.equal(r.isrCents, 0);
  assert.equal(r.totalImpuestosCents, 0);
});

test("la comisión del asesor baja el impuesto (es deducible)", () => {
  const params = isrDe("JAL");
  const base = {
    precioVentaCents: toCents(7_000_000),
    precioAdquisicionCents: toCents(2_000_000),
    anioAdquisicion: 2018,
    anioVenta: 2026,
    esCasaHabitacion: false,
    usoExencionReciente: false,
  };
  const sin = calcularIsrVenta(base, params);
  const con = calcularIsrVenta({ ...base, gastosVentaCents: toCents(350_000) }, params);
  assert.ok(con.isrCents! < sin.isrCents!, "los gastos de venta tienen que reducir la ganancia");
});

// ── 5. Precalificador ──────────────────────────────────────────────────

test("el precalificador estima por capacidad de pago y respeta el tope", () => {
  const params = creditoParams();
  const r = precalificar(
    {
      tipo: "INFONAVIT",
      salarioMensualCents: toCents(18_000),
      ahorroCents: toCents(200_000),
      deudasMensualesCents: toCents(0),
      edad: 30,
      puntosInfonavit: 1200,
    },
    params,
  );
  assert.equal(r.ok, true);
  assert.equal(r.califica, true);
  assert.equal(r.plazoMeses, 360, "a los 30 años cabe el plazo completo");
  // 30% de 18,000 son 5,400 al mes disponibles.
  assert.equal(fromCents(r.pagoDisponibleCents!), 5400);
  assert.ok(r.creditoMaxCents! >= r.creditoMinCents!, "tasa baja ⇒ crédito mayor");
  assert.ok(r.creditoMaxCents! <= r.topeProductoCents!, "nunca por encima del tope del producto");
  assert.equal(r.presupuestoMaxCents, r.creditoMaxCents! + toCents(200_000));
  assert.ok(r.leyenda!.includes("no es asesoría"));
});

test("los puntos son una puerta: por debajo del mínimo NO califica", () => {
  const params = creditoParams();
  const r = precalificar(
    {
      tipo: "INFONAVIT",
      salarioMensualCents: toCents(40_000),
      ahorroCents: toCents(1_000_000),
      edad: 30,
      puntosInfonavit: 900,
    },
    params,
  );
  assert.equal(r.califica, false, "con 900 puntos no hay crédito por mucho sueldo que haya");
  assert.equal(r.puntosFaltantes, 180);
  assert.ok(r.pasos!.length > 0, "tiene que decirle cómo conseguir los puntos");
});

test("la edad recorta el plazo y por lo tanto el crédito", () => {
  const params = creditoParams();
  const entrada = {
    tipo: "INFONAVIT" as const,
    salarioMensualCents: toCents(25_000),
    ahorroCents: toCents(0),
    edad: 30,
    puntosInfonavit: 1200,
  };
  const joven = precalificar(entrada, params);
  const mayor = precalificar({ ...entrada, edad: 55 }, params);

  assert.equal(joven.plazoMeses, 360);
  assert.equal(mayor.plazoMeses, 180, "a los 55, quedan 15 años hasta los 70");
  assert.equal(mayor.plazoRecortadoPorEdad, true);
  assert.ok(mayor.creditoMaxCents! < joven.creditoMaxCents!, "menos plazo ⇒ menos crédito");

  const fuera = precalificar({ ...entrada, edad: 72 }, params);
  assert.equal(fuera.califica, false);
  assert.match(fuera.motivoNoCalifica!, /edad l/);
});

test("las deudas se restan de la capacidad de pago", () => {
  const params = creditoParams();
  const entrada = {
    tipo: "BANCARIO" as const,
    salarioMensualCents: toCents(50_000),
    ahorroCents: toCents(800_000),
    edad: 35,
  };
  const limpio = precalificar(entrada, params);
  const endeudado = precalificar({ ...entrada, deudasMensualesCents: toCents(10_000) }, params);
  assert.ok(endeudado.creditoMaxCents! < limpio.creditoMaxCents!);

  const ahogado = precalificar({ ...entrada, deudasMensualesCents: toCents(30_000) }, params);
  assert.equal(ahogado.califica, false, "35% de 50 mil son 17,500: 30 mil de deuda lo entierra");
});

// 🔴 Los esperados van CLAVADOS y no recalculados con la fórmula del código:
// la versión anterior de esta prueba reimplementaba la fórmula ROTA y pasaba
// por tautología mientras el precalificador prometía casas financiadas al
// 97.75% declarando un aforo del 90%.
//
// El banco presta como mucho aforo×V, así que el comprador pone (1−aforo)×V:
//     V = ahorro / (1 − aforo).   Con aforo del 90%: V = ahorro × 10.
test("el banco topa por aforo: con 90% de aforo, el enganche multiplica por diez", () => {
  const params = creditoParams();
  assert.equal(params.bancario.aforoMaximoPct, 90, "la prueba asume el aforo sembrado");

  const sueldoDeSobra = toCents(120_000);
  const casos: [number, number][] = [
    // [ahorro en pesos, presupuesto esperado en pesos]
    [100_000, 1_000_000],
    [300_000, 3_000_000],
  ];
  for (const [ahorro, esperado] of casos) {
    const r = precalificar(
      { tipo: "BANCARIO", salarioMensualCents: sueldoDeSobra, ahorroCents: toCents(ahorro), edad: 35 },
      params,
    );
    assert.equal(fromCents(r.presupuestoMaxCents!), esperado, `con ${ahorro} de enganche`);
    // Y el aforo que eso implica es EXACTAMENTE el declarado, no otro.
    const ltv = ((r.presupuestoMaxCents! - toCents(ahorro)) / r.presupuestoMaxCents!) * 100;
    assert.ok(Math.abs(ltv - 90) < 0.01, `aforo implícito ${ltv.toFixed(2)}%, se declaró 90%`);
  }
});

test("sin enganche, un crédito bancario no alcanza para NADA", () => {
  const params = creditoParams();
  const r = precalificar(
    { tipo: "BANCARIO", salarioMensualCents: toCents(120_000), ahorroCents: 0, edad: 35 },
    params,
  );
  // Ningún banco financia el 100%. Prometer una casa con cero enganche era el
  // peor de los dos errores de la fórmula vieja.
  assert.equal(r.presupuestoMaxCents, 0);
});

test("con mucho ahorro manda la capacidad de pago, no el aforo", () => {
  const params = creditoParams();
  const r = precalificar(
    { tipo: "BANCARIO", salarioMensualCents: toCents(20_000), ahorroCents: toCents(2_000_000), edad: 35 },
    params,
  );
  // 2,000,000 / 0.1 = 20 millones por aforo, así que aquí el techo es el sueldo.
  assert.equal(r.presupuestoMaxCents, r.creditoMaxCents! + toCents(2_000_000));
});

test("la mensualidad se pinta en orden aunque el tope recorte el crédito", () => {
  const params = creditoParams();
  // Fovissste topa en 1.42 M, así que con 30 mil de sueldo el tope muerde los
  // dos escenarios: el de tasa alta paga MÁS, y sin ordenar salía "de $10,173
  // a $8,604" — el rango al revés, en la pantalla de portada.
  for (const tipo of ["INFONAVIT", "FOVISSSTE", "BANCARIO"] as const) {
    for (const sueldo of [15_000, 30_000, 120_000, 1_000_000]) {
      const r = precalificar(
        {
          tipo,
          salarioMensualCents: toCents(sueldo),
          ahorroCents: toCents(500_000),
          edad: 32,
          puntosInfonavit: 1200,
        },
        params,
      );
      if (!r.califica) continue;
      assert.ok(
        r.mensualidadMinCents! <= r.mensualidadMaxCents!,
        `${tipo} con ${sueldo}: min ${r.mensualidadMinCents} > max ${r.mensualidadMaxCents}`,
      );
      assert.ok(
        r.creditoMinCents! <= r.creditoMaxCents!,
        `${tipo} con ${sueldo}: el crédito también tiene que ir en orden`,
      );
    }
  }
});

test("de contado el presupuesto es el ahorro y no hay crédito", () => {
  const params = creditoParams();
  const r = precalificar(
    { tipo: "CONTADO", salarioMensualCents: 0, ahorroCents: toCents(3_500_000), edad: 60 },
    params,
  );
  assert.equal(r.califica, true);
  assert.equal(r.creditoMaxCents, 0);
  assert.equal(r.presupuestoMaxCents, toCents(3_500_000));
});

test("de contado NO se pide la edad (el formulario público ni la enseña)", () => {
  const params = creditoParams();
  const r = precalificar(
    { tipo: "CONTADO", salarioMensualCents: 0, ahorroCents: toCents(2_000_000), edad: 0 },
    params,
  );
  assert.equal(r.ok, true, "exigir la edad dejaba el formulario público mudo para siempre");
  assert.equal(r.califica, true);
  assert.equal(r.presupuestoMaxCents, toCents(2_000_000));
});

test("la mensualidad estimada nunca rebasa la capacidad de pago", () => {
  const params = creditoParams();
  for (const salario of [8_000, 15_000, 35_000, 90_000]) {
    const r = precalificar(
      {
        tipo: "INFONAVIT",
        salarioMensualCents: toCents(salario),
        ahorroCents: 0,
        edad: 32,
        puntosInfonavit: 1200,
      },
      params,
    );
    assert.ok(
      r.mensualidadMaxCents! <= r.pagoDisponibleCents! + 100,
      `sueldo ${salario}: mensualidad ${r.mensualidadMaxCents} > disponible ${r.pagoDisponibleCents}`,
    );
  }
});

// ── 6. La semilla ──────────────────────────────────────────────────────

test("la semilla trae los 32 estados y ninguna llave repetida", () => {
  const rows = buildSeed();
  const isaiEstados = rows.filter((r) => r.kind === "ISAI" && r.stateCode !== "MX");
  assert.equal(isaiEstados.length, 32, "faltan estados en la tabla de ISAI");
  for (const s of MX_STATES) {
    assert.ok(
      isaiEstados.some((r) => r.stateCode === s.code),
      `falta el ISAI de ${s.name}`,
    );
  }
  const llaves = new Set(rows.map((r) => `${r.kind}|${r.stateCode}|${r.year}|${r.effectiveFrom}`));
  assert.equal(llaves.size, rows.length, "hay filas que chocarían con el índice único");
});

test("toda fila sembrada declara su fuente", () => {
  const sinFuente = buildSeed().filter((r) => {
    const f = r.meta.fuente;
    return typeof f !== "string" || f.trim() === "";
  });
  assert.deepEqual(
    sinFuente.map((r) => `${r.kind}/${r.stateCode}`),
    [],
    "un parámetro sin fuente no se puede auditar",
  );
});

test("las tasas de ISAI están en un rango creíble", () => {
  for (const r of buildSeed()) {
    if (r.kind !== "ISAI" || r.stateCode === "MX") continue;
    assert.ok(r.value >= 1 && r.value <= 6, `ISAI de ${r.stateCode} fuera de rango: ${r.value}%`);
  }
});

test("el INPC sembrado va siempre en aumento", () => {
  const inpc = buildSeed()
    .filter((r) => r.kind === "INPC")
    .sort((a, b) => a.year - b.year);
  for (let i = 1; i < inpc.length; i++) {
    assert.ok(
      inpc[i].value > inpc[i - 1].value,
      `el INPC de ${inpc[i].year} no puede ser menor que el de ${inpc[i - 1].year}`,
    );
  }
});

test("un parámetro absurdo del admin sale como faltante, no como Infinity", () => {
  // topeAnios = 0 producía una división entre cero cuyo Infinity viajaba
  // hasta el desglose de la pantalla; tasaAnualMin = 0 regalaba un crédito
  // sin intereses. Un parámetro fuera de rango es tan inútil como uno que
  // falta, y bastante más peligroso.
  const roto: RawCalcParamRow[] = ROWS.map((r) =>
    r.kind === "UDI"
      ? { ...r, meta: { ...(r.meta ?? {}), topeAnios: 0 } }
      : r.kind === "INFONAVIT"
        ? { ...r, meta: { ...(r.meta ?? {}), tasaAnualMin: 0 } }
        : r,
  );
  const isr = resolveIsrParams(roto, "JAL", HOY);
  assert.equal(isr.ok, false);
  assert.ok(isr.faltantes.some((f) => /Tope de a/.test(f.etiqueta)));

  const cre = resolveCreditoParams(roto, HOY);
  assert.equal(cre.ok, false);
  assert.ok(cre.faltantes.some((f) => /Tasas de Infonavit/.test(f.etiqueta)));
});

test("los puntos escritos por debajo del mínimo CIERRAN la puerta, aunque sean 0", () => {
  const params = creditoParams();
  const base = {
    tipo: "INFONAVIT" as const,
    salarioMensualCents: toCents(40_000),
    ahorroCents: toCents(500_000),
    edad: 30,
  };
  // Un 0 o un negativo los escribió alguien: son un dato capturado, no un
  // "no sé". Tratarlos como "no me dijiste" abría la puerta en vez de cerrarla.
  for (const puntos of [0, -50, 900]) {
    const r = precalificar({ ...base, puntosInfonavit: puntos }, params);
    assert.equal(r.califica, false, `con ${puntos} puntos no puede calificar`);
  }
  // Y no decirlos sí deja pasar, con aviso.
  const sinDecir = precalificar({ ...base, puntosInfonavit: null }, params);
  assert.equal(sinDecir.califica, true);
  assert.ok(sinDecir.avisos!.some((a) => /puntos/i.test(a)), "tiene que avisar que faltan");
});

test("una tasa capturada fuera de la banda razonable se ignora", () => {
  const params = creditoParams();
  const base = {
    tipo: "BANCARIO" as const,
    salarioMensualCents: toCents(50_000),
    ahorroCents: toCents(1_000_000),
    edad: 35,
  };
  const normal = precalificar(base, params);
  // Un 0.001% dibujaría un crédito absurdo en un PDF con membrete.
  const absurda = precalificar({ ...base, tasaAnualPropia: 0.001 }, params);
  assert.equal(absurda.tasaMinPct, normal.tasaMinPct, "una tasa fuera de banda no manda");
  const creible = precalificar({ ...base, tasaAnualPropia: 9.5 }, params);
  assert.equal(creible.tasaMinPct, 9.5);
  assert.equal(creible.tasaMaxPct, 9.5);
});

test("el meta que sale al público lleva lista blanca", () => {
  const conBasura = {
    fuente: "x",
    porVerificar: true,
    cedularPct: 5,
    notaInternaDelAdmin: "el contacto del notario es 55-1234-5678",
    tokenQueAlguienPego: "sk_live_no_deberia_estar_aqui",
  };
  const limpio = sanitizarMeta("ISAI", conBasura)!;
  assert.equal(limpio.cedularPct, 5, "lo que las calculadoras leen se conserva");
  assert.equal(limpio.fuente, "x");
  assert.equal(limpio.notaInternaDelAdmin, undefined, "una nota interna no se publica");
  assert.equal(limpio.tokenQueAlguienPego, undefined, "y menos algo con pinta de credencial");
});

test("con la tabla vacía, nada revienta: todo sale como faltante", () => {
  const vacio: RawCalcParamRow[] = [];
  const esc = resolveEscrituracionParams(vacio, "JAL", HOY);
  const isr = resolveIsrParams(vacio, "JAL", HOY);
  const cre = resolveCreditoParams(vacio, HOY);
  for (const r of [esc, isr, cre]) {
    assert.equal(r.ok, false);
    assert.ok(r.faltantes.length > 0, "tiene que decir QUÉ falta");
    for (const f of r.faltantes) {
      assert.ok(f.etiqueta.length > 0);
      assert.ok(f.comoResolver.length > 0);
    }
  }
});

test("un parámetro con vigencia futura no se usa todavía", () => {
  const futuro: RawCalcParamRow[] = ROWS.concat([
    {
      kind: "ISAI",
      stateCode: "JAL",
      year: 2027,
      value: 3.5,
      meta: { fuente: "prueba" },
      effectiveFrom: "2027-01-01T00:00:00.000Z",
    },
  ]);
  const r = resolveEscrituracionParams(futuro, "JAL", HOY);
  assert.equal(r.ok, true);
  assert.equal(r.params!.isaiPct, 2, "en 2026 manda la fila de 2026, no la de 2027");

  const enDosMilVeintisiete = resolveEscrituracionParams(futuro, "JAL", new Date("2027-03-01T00:00:00.000Z"));
  assert.equal(enDosMilVeintisiete.params!.isaiPct, 3.5, "ya en 2027 manda la nueva");
});

test("todo resultado lleva su leyenda de que no es asesoría", () => {
  const esc = calcularEscrituracion({ precioCents: toCents(1_000_000) }, escrituracionDe("JAL"));
  const isr = calcularIsrVenta(
    {
      precioVentaCents: toCents(2_000_000),
      precioAdquisicionCents: toCents(900_000),
      anioAdquisicion: 2018,
      anioVenta: 2026,
      esCasaHabitacion: false,
      usoExencionReciente: false,
    },
    isrDe("JAL"),
  );
  const pre = precalificar(
    { tipo: "FOVISSSTE", salarioMensualCents: toCents(20_000), ahorroCents: 0, edad: 40 },
    creditoParams(),
  );
  for (const r of [esc, isr, pre]) {
    assert.ok(r.leyenda, "falta la leyenda");
    assert.match(r.leyenda!, /no es asesor[ií]a fiscal ni financiera/i);
    assert.match(r.leyenda!, /2026|2025/);
  }
});
