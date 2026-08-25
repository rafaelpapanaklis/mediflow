"use client";

// ═══════════════════════════════════════════════════════════════════════
// PRECALIFICADOR DE CRÉDITO (versión del panel).
//
// La misma aritmética pura que corre la versión pública y que revalida el
// servidor. Lo único que cambia aquí es lo que rodea al número: buscar en
// el inventario propio y guardar en la bitácora del prospecto.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { resolveCreditoParams, type RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { precalificar, TIPOS_CREDITO, type TipoCredito } from "@/lib/realty/calc/infonavit";
import { fmtMXN, fmtPct, parseMoneyInput, parseNumberInput } from "@/lib/realty/calc/money";
import { AccionesResultado, type AccionesTextos } from "./acciones";
import {
  Campo,
  Casilla,
  CifraGrande,
  Faltantes,
  InputDinero,
  InputNumero,
  Leyenda,
  ListaPasos,
  Nota,
  Rejilla,
  Selector,
  Tarjeta,
} from "./ui";

export function Precalificador({
  rows,
  t,
  acciones,
}: {
  rows: RawCalcParamRow[];
  t: TFunction;
  acciones: AccionesTextos;
}) {
  const [tipo, setTipo] = useState<TipoCredito>("INFONAVIT");
  const [salario, setSalario] = useState("18000");
  const [puntos, setPuntos] = useState("");
  const [ahorro, setAhorro] = useState("200000");
  const [deudas, setDeudas] = useState("");
  const [edad, setEdad] = useState("32");
  const [unir, setUnir] = useState(false);
  const [salarioSocio, setSalarioSocio] = useState("");
  const [tasaPropia, setTasaPropia] = useState("");
  const [inventario, setInventario] = useState<number | null>(null);

  const resuelto = useMemo(() => resolveCreditoParams(rows, new Date()), [rows]);

  const r = useMemo(() => {
    if (!resuelto.ok || !resuelto.params) return null;
    const s = parseMoneyInput(salario);
    const e = parseNumberInput(edad);
    // La edad solo se pide cuando hay plazo que recortar; en "de contado" el
    // campo ni se enseña, así que exigirla dejaba la pantalla muda.
    if (tipo !== "CONTADO" && e === null) return null;
    if (tipo !== "CONTADO" && (s === null || s <= 0)) return null;
    return precalificar(
      {
        tipo,
        salarioMensualCents: s ?? 0,
        ahorroCents: parseMoneyInput(ahorro) ?? 0,
        deudasMensualesCents: parseMoneyInput(deudas),
        edad: e === null ? 0 : Math.round(e),
        puntosInfonavit: parseNumberInput(puntos),
        unirCredito: unir,
        salarioSocioCents: parseMoneyInput(salarioSocio),
        tasaAnualPropia: parseNumberInput(tasaPropia),
      },
      resuelto.params,
    );
  }, [resuelto, tipo, salario, ahorro, deudas, edad, puntos, unir, salarioSocio, tasaPropia]);

  const min = r?.presupuestoMinCents ?? null;
  const max = r?.presupuestoMaxCents ?? null;
  const califica = r?.ok === true && r?.califica === true;

  // Cuántos inmuebles propios entran en el rango. Es una consulta remota, así
  // que sí se debouncea — a diferencia del recálculo, que es local.
  useEffect(() => {
    if (!califica || min === null || max === null || max <= 0) {
      setInventario(null);
      return;
    }
    let vivo = true;
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/realty/calc/inventario?min=${min}&max=${max}`);
        const data = await res.json().catch(() => ({}));
        if (vivo && res.ok) setInventario(Number((data as { count?: number }).count ?? 0));
      } catch {
        if (vivo) setInventario(null);
      }
    }, 400);
    return () => {
      vivo = false;
      window.clearTimeout(handle);
    };
  }, [califica, min, max]);

  const textoCompartible = useMemo(() => {
    if (!r || !r.ok) return "";
    if (!r.califica) {
      return [
        `Precalificación — ${r.tipoLabel}`,
        "",
        r.motivoNoCalifica ?? "",
        "",
        ...(r.pasos ?? []).map((p) => `• ${p}`),
        "",
        r.leyenda!,
      ].join("\n");
    }
    const lineas = [
      `Precalificación — ${r.tipoLabel}`,
      "",
      `Te alcanza para una casa de ${fmtMXN(r.presupuestoMinCents!)} a ${fmtMXN(r.presupuestoMaxCents!)}`,
    ];
    if (r.creditoMaxCents! > 0) {
      lineas.push(
        `Crédito estimado: ${fmtMXN(r.creditoMinCents!)} a ${fmtMXN(r.creditoMaxCents!)}`,
        `Mensualidad aproximada: ${fmtMXN(r.mensualidadMinCents!)} a ${fmtMXN(r.mensualidadMaxCents!)}`,
        `Plazo: ${Math.floor(r.plazoMeses! / 12)} años · tasa ${fmtPct(r.tasaMinPct!)} a ${fmtPct(r.tasaMaxPct!)}`,
      );
    }
    lineas.push("", ...(r.pasos ?? []).map((p) => `• ${p}`), "", r.leyenda!);
    return lineas.join("\n");
  }, [r]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Tarjeta titulo={t("credito.title")} sub={t("credito.intro")}>
        <div style={{ display: "grid", gap: 14 }}>
          <Rejilla>
            <Campo
              label={t("credito.tipo")}
              htmlFor="pre-tipo"
              hint={TIPOS_CREDITO.find((x) => x.id === tipo)?.ayuda}
            >
              <Selector
                id="pre-tipo"
                value={tipo}
                onChange={(v) => setTipo(v as TipoCredito)}
                options={TIPOS_CREDITO.map((x) => ({ value: x.id, label: x.label }))}
              />
            </Campo>
            {tipo !== "CONTADO" && (
              <Campo label={t("credito.salario")} htmlFor="pre-salario">
                <InputDinero id="pre-salario" value={salario} onChange={setSalario} />
              </Campo>
            )}
            <Campo
              label={t("credito.ahorro")}
              htmlFor="pre-ahorro"
            >
              <InputDinero id="pre-ahorro" value={ahorro} onChange={setAhorro} />
            </Campo>
          </Rejilla>

          {tipo !== "CONTADO" && (
            <Rejilla>
              <Campo label={t("credito.edad")} htmlFor="pre-edad">
                <InputNumero id="pre-edad" value={edad} onChange={setEdad} min={18} max={99} sufijo="años" />
              </Campo>
              <Campo
                label={`${t("credito.deudas")} (${t("common.opcional")})`}
                htmlFor="pre-deudas"
                hint={t("credito.deudasAyuda")}
              >
                <InputDinero id="pre-deudas" value={deudas} onChange={setDeudas} />
              </Campo>
              {tipo === "INFONAVIT" && (
                <Campo
                  label={`${t("credito.puntos")} (${t("common.opcional")})`}
                  htmlFor="pre-puntos"
                  hint={t("credito.puntosAyuda")}
                >
                  <InputNumero id="pre-puntos" value={puntos} onChange={setPuntos} min={0} max={5000} />
                </Campo>
              )}
              {tipo === "BANCARIO" && (
                <Campo
                  label={`${t("credito.tasaPropia")} (${t("common.opcional")})`}
                  htmlFor="pre-tasa"
                  hint={t("credito.tasaPropiaAyuda")}
                >
                  <InputNumero id="pre-tasa" value={tasaPropia} onChange={setTasaPropia} sufijo="%" />
                </Campo>
              )}
            </Rejilla>
          )}

          {tipo === "INFONAVIT" && (
            <Rejilla min={260}>
              <Casilla id="pre-unir" checked={unir} onChange={setUnir} label={t("credito.unir")} />
              {unir && (
                <Campo label={t("credito.salarioSocio")} htmlFor="pre-socio">
                  <InputDinero id="pre-socio" value={salarioSocio} onChange={setSalarioSocio} />
                </Campo>
              )}
            </Rejilla>
          )}
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

      {r && r.ok && !r.califica && (
        <Tarjeta titulo={t("credito.noCalifica")}>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
              <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 1, color: "#a8741a" }} />
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-1)", lineHeight: 1.55 }}>
                {r.motivoNoCalifica}
              </p>
            </div>
            <ListaPasos titulo={t("common.queSigue")} pasos={r.pasos ?? []} />
            <AccionesResultado
              texto={textoCompartible}
              titulo="precalificacion"
              pdf={{ tipo: "precalificacion", credito: tipo, salario, ahorro, deudas, edad, puntos, unir, salarioSocio, tasaPropia }}
              textos={acciones}
            />
            <Leyenda texto={r.leyenda!} />
          </div>
        </Tarjeta>
      )}

      {r && r.ok && r.califica && (
        <Tarjeta titulo={t("common.resultado")}>
          <div style={{ display: "grid", gap: 16 }}>
            <Rejilla min={230}>
              <CifraGrande
                label={t("credito.presupuesto")}
                valor={`${fmtMXN(r.presupuestoMinCents!)} a ${fmtMXN(r.presupuestoMaxCents!)}`}
                destacado
              />
              {r.creditoMaxCents! > 0 && (
                <>
                  <CifraGrande
                    label={t("credito.credito")}
                    valor={`${fmtMXN(r.creditoMinCents!)} a ${fmtMXN(r.creditoMaxCents!)}`}
                    sub={`${t("credito.tasa")} ${fmtPct(r.tasaMinPct!)} — ${fmtPct(r.tasaMaxPct!)}`}
                  />
                  <CifraGrande
                    label={t("credito.mensualidad")}
                    valor={`${fmtMXN(r.mensualidadMinCents!)} a ${fmtMXN(r.mensualidadMaxCents!)}`}
                    sub={`${t("credito.plazo")}: ${Math.floor(r.plazoMeses! / 12)} ${t("credito.anios")}`}
                  />
                </>
              )}
            </Rejilla>

            {inventario !== null && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--brand-softer)",
                  border: "1px solid var(--border-brand)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "var(--text-1)",
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={16} style={{ color: "var(--brand)" }} />
                  {inventario > 0
                    ? t("credito.inventario", { count: inventario })
                    : t("credito.inventarioCero")}
                </span>
                {inventario > 0 && (
                  <Link
                    // En PESOS, no en centavos: el resto del panel trabaja en
                    // pesos y mandar centavos multiplicaba el filtro por cien.
                    href={`/inmobiliaria/inmuebles?precioMax=${Math.round(max / 100)}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "var(--brand)",
                      textDecoration: "none",
                    }}
                  >
                    {t("credito.verInventario")}
                    <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            )}

            {[...(r.avisos ?? []), ...resuelto.avisos].map((a, i) => (
              <Nota key={i} tono="aviso">
                {a}
              </Nota>
            ))}

            <ListaPasos titulo={t("common.queSigue")} pasos={r.pasos ?? []} />

            <AccionesResultado
              texto={textoCompartible}
              titulo="precalificacion"
              pdf={{ tipo: "precalificacion", credito: tipo, salario, ahorro, deudas, edad, puntos, unir, salarioSocio, tasaPropia }}
              textos={acciones}
            />
            <Leyenda texto={r.leyenda!} />
          </div>
        </Tarjeta>
      )}
    </div>
  );
}

// Aquí vivía BotonPrecalificar, que envolvía un <button> dentro de un <a>:
// contenido interactivo anidado, HTML inválido. No lo usaba nadie, así que se
// borra en vez de arreglarse — quien lo necesite, que enlace con <Link> a
// secas y lo estilice.
