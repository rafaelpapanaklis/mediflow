"use client";

// ═══════════════════════════════════════════════════════════════════════
// Calculadora de ISR PARA QUIEN VENDE.
//
// El resultado más importante no es el impuesto: es el SÍ/NO de la
// exención, porque eso es lo que el dueño quiere oír en la primera cita.
// Por eso el veredicto va arriba, en grande, y el desglose debajo.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { MX_STATES, resolveIsrParams, type RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { calcularIsrVenta } from "@/lib/realty/calc/isr";
import { fmtMXN, fmtPct, parseMoneyInput, parseNumberInput } from "@/lib/realty/calc/money";
import { AccionesResultado, type AccionesTextos } from "./acciones";
import {
  Campo,
  Casilla,
  CifraGrande,
  Faltantes,
  FilaDesglose,
  InputDinero,
  InputNumero,
  Leyenda,
  Nota,
  Rejilla,
  Selector,
  Tarjeta,
} from "./ui";

export function IsrCalc({
  rows,
  t,
  acciones,
  estadoInicial,
}: {
  rows: RawCalcParamRow[];
  t: TFunction;
  acciones: AccionesTextos;
  estadoInicial: string;
}) {
  const anioActual = new Date().getFullYear();
  const [estado, setEstado] = useState(estadoInicial);
  const [precioVenta, setPrecioVenta] = useState("5000000");
  const [precioCompra, setPrecioCompra] = useState("1500000");
  const [anioCompra, setAnioCompra] = useState("2015");
  const [anioVenta, setAnioVenta] = useState(String(anioActual));
  const [casaHabitacion, setCasaHabitacion] = useState(true);
  const [usoExencion, setUsoExencion] = useState(false);
  const [mejoras, setMejoras] = useState("");
  const [anioMejoras, setAnioMejoras] = useState("");
  const [gastosCompra, setGastosCompra] = useState("");
  const [gastosVenta, setGastosVenta] = useState("");

  const resuelto = useMemo(() => resolveIsrParams(rows, estado, new Date()), [rows, estado]);

  const r = useMemo(() => {
    if (!resuelto.ok || !resuelto.params) return null;
    const pv = parseMoneyInput(precioVenta);
    const pc = parseMoneyInput(precioCompra);
    const ac = parseNumberInput(anioCompra);
    if (pv === null || pv <= 0 || pc === null || pc <= 0 || ac === null) return null;
    return calcularIsrVenta(
      {
        precioVentaCents: pv,
        precioAdquisicionCents: pc,
        anioAdquisicion: Math.round(ac),
        anioVenta: Math.round(parseNumberInput(anioVenta) ?? anioActual),
        esCasaHabitacion: casaHabitacion,
        usoExencionReciente: usoExencion,
        mejorasCents: parseMoneyInput(mejoras),
        anioMejoras: parseNumberInput(anioMejoras),
        gastosAdquisicionCents: parseMoneyInput(gastosCompra),
        gastosVentaCents: parseMoneyInput(gastosVenta),
      },
      resuelto.params,
    );
  }, [
    resuelto,
    precioVenta,
    precioCompra,
    anioCompra,
    anioVenta,
    casaHabitacion,
    usoExencion,
    mejoras,
    anioMejoras,
    gastosCompra,
    gastosVenta,
    anioActual,
  ]);

  const textoCompartible = useMemo(() => {
    if (!r || !r.ok) return "";
    const lineas: string[] = [`ISR por la venta — ${resuelto.params?.stateName ?? ""}`, ""];
    if (r.exento) {
      lineas.push(
        `EXENTO. El precio de venta (${fmtMXN(parseMoneyInput(precioVenta) ?? 0)}) está por debajo del tope de la exención de casa habitación (${fmtMXN(r.limiteExentoCents!)}).`,
      );
      lineas.push(`Ganancia estimada: ${fmtMXN(r.gananciaTotalCents!)} — sin ISR que pagar.`);
    } else {
      if (r.exentoParcial) {
        lineas.push(
          `Exento en parte: hasta ${fmtMXN(r.limiteExentoCents!)} no grava; el excedente sí. Grava el ${fmtPct(r.proporcionGravada! * 100)} de la ganancia.`,
        );
      } else if (r.motivoNoExento) {
        lineas.push(r.motivoNoExento);
      }
      lineas.push(
        `Ganancia estimada: ${fmtMXN(r.gananciaTotalCents!)}`,
        `Ganancia gravada: ${fmtMXN(r.gananciaGravadaCents!)}`,
        `ISR estimado: ${fmtMXN(r.isrCents!)} (tasa efectiva ${fmtPct(r.tasaEfectivaPct!)})`,
      );
      if (r.cedularCents! > 0) {
        lineas.push(`Impuesto cedular del estado: ${fmtMXN(r.cedularCents!)}`);
        lineas.push(`Total de impuestos: ${fmtMXN(r.totalImpuestosCents!)}`);
      }
    }
    lineas.push("", r.leyenda!);
    return lineas.join("\n");
  }, [r, resuelto, precioVenta]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Tarjeta titulo={t("isr.title")} sub={t("isr.intro")}>
        <div style={{ display: "grid", gap: 14 }}>
          <Rejilla>
            <Campo label={t("isr.precioVenta")} htmlFor="isr-pv">
              <InputDinero id="isr-pv" value={precioVenta} onChange={setPrecioVenta} />
            </Campo>
            <Campo label={t("isr.precioCompra")} htmlFor="isr-pc">
              <InputDinero id="isr-pc" value={precioCompra} onChange={setPrecioCompra} />
            </Campo>
          </Rejilla>
          <Rejilla>
            <Campo label={t("isr.anioCompra")} htmlFor="isr-ac">
              <InputNumero
                id="isr-ac"
                value={anioCompra}
                onChange={setAnioCompra}
                min={1950}
                max={anioActual}
              />
            </Campo>
            <Campo label={t("isr.anioVenta")} htmlFor="isr-av">
              <InputNumero
                id="isr-av"
                value={anioVenta}
                onChange={setAnioVenta}
                min={1990}
                max={anioActual + 1}
              />
            </Campo>
            <Campo label={t("common.estado")} htmlFor="isr-estado">
              <Selector
                id="isr-estado"
                value={estado}
                onChange={setEstado}
                options={MX_STATES.map((s) => ({ value: s.code, label: s.name }))}
              />
            </Campo>
          </Rejilla>
          <Rejilla min={260}>
            <Casilla
              id="isr-casa"
              checked={casaHabitacion}
              onChange={setCasaHabitacion}
              label={t("isr.casaHabitacion")}
            />
            <Casilla
              id="isr-exencion"
              checked={usoExencion}
              onChange={setUsoExencion}
              label={t("isr.usoExencion")}
            />
          </Rejilla>
          <Rejilla>
            <Campo label={`${t("isr.mejoras")} (${t("common.opcional")})`} htmlFor="isr-mej">
              <InputDinero id="isr-mej" value={mejoras} onChange={setMejoras} />
            </Campo>
            <Campo label={`${t("isr.anioMejoras")} (${t("common.opcional")})`} htmlFor="isr-anmej">
              <InputNumero
                id="isr-anmej"
                value={anioMejoras}
                onChange={setAnioMejoras}
                min={1950}
                max={anioActual}
              />
            </Campo>
          </Rejilla>
          <Rejilla>
            <Campo label={`${t("isr.gastosCompra")} (${t("common.opcional")})`} htmlFor="isr-gc">
              <InputDinero id="isr-gc" value={gastosCompra} onChange={setGastosCompra} />
            </Campo>
            <Campo label={`${t("isr.gastosVenta")} (${t("common.opcional")})`} htmlFor="isr-gv">
              <InputDinero id="isr-gv" value={gastosVenta} onChange={setGastosVenta} />
            </Campo>
          </Rejilla>
        </div>
      </Tarjeta>

      {!resuelto.ok && (
        <Faltantes
          faltantes={resuelto.faltantes}
          titulo={t("faltantes.title")}
          cuerpo={t("faltantes.body")}
        />
      )}

      {resuelto.ok && !r && <Nota>{t("common.sinDatos")}</Nota>}
      {r && !r.ok && <Nota tono="aviso">{r.error}</Nota>}

      {r && r.ok && (
        <Tarjeta titulo={t("common.resultado")}>
          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 11,
                padding: "16px 18px",
                borderRadius: 12,
                background: r.exento ? "var(--brand-softer)" : "rgba(191, 130, 20, 0.10)",
                border: `1px solid ${r.exento ? "var(--border-brand)" : "rgba(191, 130, 20, 0.32)"}`,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1, color: r.exento ? "var(--brand)" : "#a8741a" }}>
                {r.exento ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)" }}>
                  {r.exento
                    ? t("isr.exento")
                    : r.exentoParcial
                      ? t("isr.exentoParcial")
                      : t("isr.gravado")}
                </div>
                <p style={{ margin: "5px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55 }}>
                  {r.exento
                    ? t("isr.exentoBody")
                    : r.exentoParcial
                      ? `Hasta ${fmtMXN(r.limiteExentoCents!)} no grava; sobre el excedente sí. Queda gravado el ${fmtPct(r.proporcionGravada! * 100)} de la ganancia.`
                      : r.motivoNoExento}
                </p>
              </div>
            </div>

            <Rejilla min={200}>
              <CifraGrande label={t("isr.ganancia")} valor={fmtMXN(r.gananciaTotalCents!)} />
              {!r.exento && (
                <CifraGrande
                  label={t("isr.isr")}
                  valor={fmtMXN(r.isrCents!)}
                  sub={`${t("isr.tasaEfectiva")} ${fmtPct(r.tasaEfectivaPct!)}`}
                  destacado
                />
              )}
              {r.cedularCents! > 0 && (
                <CifraGrande
                  label={t("isr.cedular")}
                  valor={fmtMXN(r.cedularCents!)}
                  sub={`${r.cedularPct}% · ${resuelto.params?.stateName}`}
                />
              )}
              <CifraGrande label={t("isr.neto")} valor={fmtMXN(r.netoVendedorCents!)} />
            </Rejilla>

            {[...(r.avisos ?? []), ...resuelto.avisos].map((a, i) => (
              <Nota key={i} tono="aviso">
                {a}
              </Nota>
            ))}

            <div>
              <h4
                style={{
                  margin: "0 0 4px",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-3)",
                  fontWeight: 700,
                }}
              >
                {t("common.desglose")}
              </h4>
              {r.renglones!.map((f) => (
                <FilaDesglose
                  key={f.clave}
                  etiqueta={`${f.esDeduccion ? "− " : ""}${f.etiqueta}`}
                  explicacion={f.explicacion}
                  valor={fmtMXN(f.montoCents)}
                />
              ))}
              <FilaDesglose etiqueta={t("isr.ganancia")} valor={fmtMXN(r.gananciaTotalCents!)} fuerte />
              {!r.exento && (
                <>
                  <FilaDesglose
                    etiqueta={t("isr.gananciaGravada")}
                    explicacion={`Se divide entre ${r.aniosParaDividir} ${r.aniosParaDividir === 1 ? "año" : "años"} y se le aplica la tarifa anual; el resultado se vuelve a multiplicar por los mismos años.`}
                    valor={fmtMXN(r.gananciaGravadaCents!)}
                  />
                  <FilaDesglose
                    etiqueta={t("isr.totalImpuestos")}
                    valor={fmtMXN(r.totalImpuestosCents!)}
                    fuerte
                  />
                </>
              )}
            </div>

            <AccionesResultado
              texto={textoCompartible}
              titulo="isr-venta"
              pdf={{
                tipo: "isr",
                estado,
                precioVenta,
                precioCompra,
                anioCompra,
                anioVenta,
                casaHabitacion,
                usoExencion,
                mejoras,
                anioMejoras,
                gastosCompra,
                gastosVenta,
              }}
              textos={acciones}
            />
            <Leyenda texto={r.leyenda!} />
          </div>
        </Tarjeta>
      )}
    </div>
  );
}
