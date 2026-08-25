"use client";

// ═══════════════════════════════════════════════════════════════════════
// PRECALIFICADOR PÚBLICO — el que ve alguien que NO es cliente.
//
// Es la pieza que Nocnok cobra en su plan de $1,980 y que ninguno de los
// CRM mexicanos trae dentro. Aquí va en los tres planes.
//
// ORDEN DELIBERADO: primero el número, después el teléfono.
//   1. Contesta cinco cosas y VE su resultado. Sin registro, sin muro.
//   2. Solo entonces se le ofrece dejar su WhatsApp, y a cambio de algo
//      concreto: las casas que entran en ese presupuesto.
// Pedir el teléfono antes del número sube el abandono y además es de mala
// educación: le estás cobrando por una cuenta que hizo él.
//
// Lo que el navegador calcula es una VISTA PREVIA. Al mandar el formulario,
// el servidor vuelve a correr la misma función pura y ESE es el número que
// se guarda en el prospecto.
//
// Autónomo a propósito: no importa nada de servidor ni del panel, así que la
// ficha pública (T5) solo tiene que montarlo con los parámetros.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { resolveCreditoParams, type RawCalcParamRow } from "@/lib/realty/calc/catalog";
import { precalificar, TIPOS_CREDITO, type TipoCredito } from "@/lib/realty/calc/infonavit";
import { fmtMXN, parseMoneyInput, parseNumberInput } from "@/lib/realty/calc/money";

type Estado = "form" | "enviando" | "listo";

export function PrecalificadorPublico({
  slug,
  dict,
  rows,
  onCerrar,
}: {
  slug: string;
  dict: Dictionary;
  rows: RawCalcParamRow[];
  onCerrar?: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [tipo, setTipo] = useState<TipoCredito>("INFONAVIT");
  const [salario, setSalario] = useState("");
  const [ahorro, setAhorro] = useState("");
  const [deudas, setDeudas] = useState("");
  const [edad, setEdad] = useState("");
  const [puntos, setPuntos] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [website, setWebsite] = useState(""); // campo trampa
  const [estado, setEstado] = useState<Estado>("form");
  const [error, setError] = useState<string | null>(null);

  const resuelto = useMemo(() => resolveCreditoParams(rows, new Date()), [rows]);

  // Vista previa en vivo, sin fetch: la aritmética es la misma que corre el
  // servidor y viaja con la página.
  const vista = useMemo(() => {
    if (!resuelto.ok || !resuelto.params) return null;
    const e = parseNumberInput(edad);
    const s = parseMoneyInput(salario);
    // La edad solo se exige cuando hay crédito: el campo se esconde en
    // "de contado", así que pedirla dejaba ese formulario mudo para siempre
    // —sin resultado, sin campos de contacto y sin explicar por qué—.
    if (tipo !== "CONTADO" && (e === null || e < 18)) return null;
    if (tipo !== "CONTADO" && (s === null || s <= 0)) return null;
    return precalificar(
      {
        tipo,
        salarioMensualCents: s ?? 0,
        ahorroCents: parseMoneyInput(ahorro) ?? 0,
        deudasMensualesCents: parseMoneyInput(deudas),
        edad: e === null ? 0 : Math.round(e),
        puntosInfonavit: parseNumberInput(puntos),
      },
      resuelto.params,
    );
  }, [resuelto, tipo, salario, ahorro, deudas, edad, puntos]);

  const listoParaEnviar =
    vista !== null && vista.ok === true && nombre.trim().length >= 3 && telefono.replace(/\D/g, "").length >= 10;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!listoParaEnviar || estado === "enviando") return;
    setError(null);
    setEstado("enviando");
    try {
      const res = await fetch(`/api/realty/calc/publico/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website,
          nombre: nombre.trim(),
          telefono,
          tipo,
          salario,
          ahorro,
          deudas,
          edad,
          puntos,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data?.error ?? t("publico.errorGenerico"));
        setEstado("form");
        return;
      }
      setEstado("listo");
    } catch {
      setError(t("publico.errorGenerico"));
      setEstado("form");
    }
  }

  if (estado === "listo") {
    return (
      <div style={caja}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <CheckCircle2 size={22} style={{ color: VERDE, flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: TINTA }}>
              {t("publico.gracias", { nombre: nombre.trim().split(" ")[0] })}
            </h3>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: GRIS, lineHeight: 1.6 }}>
              {t("publico.graciasBody")}
            </p>
            {vista?.califica && (
              <>
                <p style={{ margin: "12px 0 0", fontSize: 15, fontWeight: 700, color: TINTA }}>
                  {fmtMXN(vista.presupuestoMinCents!)} — {fmtMXN(vista.presupuestoMaxCents!)}
                </p>
                {/* Esta es la pantalla de la que se saca captura y se manda por
                    WhatsApp. Si algún número del módulo puede quedarse sin la
                    leyenda, es justo este: por eso va aquí también. */}
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 11,
                    color: "#7a857e",
                    fontStyle: "italic",
                    lineHeight: 1.5,
                  }}
                >
                  {vista.leyenda}
                </p>
              </>
            )}
          </div>
        </div>
        {onCerrar && (
          <button type="button" onClick={onCerrar} style={{ ...btnFantasma, marginTop: 18 }}>
            Cerrar
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} style={caja}>
      <header>
        <h3 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: TINTA, letterSpacing: "-0.01em" }}>
          {t("publico.titulo")}
        </h3>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: GRIS, lineHeight: 1.6 }}>
          {t("publico.intro")}
        </p>
      </header>

      {!resuelto.ok && (
        <p style={{ margin: "16px 0 0", fontSize: 13.5, color: GRIS }}>
          {t("publico.errorGenerico")}
        </p>
      )}

      {resuelto.ok && (
        <>
          <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
            <Campo label={t("credito.tipo")} id="pub-tipo">
              <select
                id="pub-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoCredito)}
                style={input}
              >
                {TIPOS_CREDITO.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Campo>

            <div style={dos}>
              {tipo !== "CONTADO" && (
                <Campo label={t("credito.salario")} id="pub-salario">
                  <input
                    id="pub-salario"
                    inputMode="decimal"
                    value={salario}
                    onChange={(e) => setSalario(limpiar(e.target.value))}
                    placeholder="18000"
                    style={input}
                  />
                </Campo>
              )}
              <Campo label={t("credito.ahorro")} id="pub-ahorro">
                <input
                  id="pub-ahorro"
                  inputMode="decimal"
                  value={ahorro}
                  onChange={(e) => setAhorro(limpiar(e.target.value))}
                  placeholder="150000"
                  style={input}
                />
              </Campo>
            </div>

            {tipo !== "CONTADO" && (
              <div style={dos}>
                <Campo label={t("credito.edad")} id="pub-edad">
                  <input
                    id="pub-edad"
                    inputMode="numeric"
                    value={edad}
                    onChange={(e) => setEdad(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    placeholder="32"
                    style={input}
                  />
                </Campo>
                <Campo label={t("credito.deudas")} id="pub-deudas">
                  <input
                    id="pub-deudas"
                    inputMode="decimal"
                    value={deudas}
                    onChange={(e) => setDeudas(limpiar(e.target.value))}
                    placeholder="0"
                    style={input}
                  />
                </Campo>
              </div>
            )}

            {tipo === "INFONAVIT" && (
              <Campo label={t("credito.puntos")} id="pub-puntos" hint={t("credito.puntosAyuda")}>
                <input
                  id="pub-puntos"
                  inputMode="numeric"
                  value={puntos}
                  onChange={(e) => setPuntos(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="1080"
                  style={input}
                />
              </Campo>
            )}
          </div>

          {vista && vista.ok && (
            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 12,
                background: vista.califica ? "#EDF3EF" : "#FBF3E4",
                border: `1px solid ${vista.califica ? "#BBD3C4" : "#E4D2A8"}`,
              }}
            >
              {vista.califica ? (
                <>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", color: GRIS, fontWeight: 700 }}>
                    {t("credito.presupuesto").toUpperCase()}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 24,
                      fontWeight: 700,
                      color: TINTA,
                      letterSpacing: "-0.02em",
                      lineHeight: 1.2,
                    }}
                  >
                    {fmtMXN(vista.presupuestoMinCents!)} — {fmtMXN(vista.presupuestoMaxCents!)}
                  </div>
                  {(vista.mensualidadMaxCents ?? 0) > 0 && (
                    <div style={{ marginTop: 6, fontSize: 13, color: GRIS }}>
                      {t("credito.mensualidad")}: {fmtMXN(vista.mensualidadMinCents!)} —{" "}
                      {fmtMXN(vista.mensualidadMaxCents!)} · {Math.floor(vista.plazoMeses! / 12)}{" "}
                      {t("credito.anios")}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <AlertCircle size={17} style={{ color: "#a8741a", flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong style={{ fontSize: 14, color: TINTA }}>{t("credito.noCalifica")}</strong>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: GRIS, lineHeight: 1.55 }}>
                      {vista.motivoNoCalifica}
                    </p>
                  </div>
                </div>
              )}
              <p style={{ margin: "10px 0 0", fontSize: 11, color: "#7a857e", fontStyle: "italic", lineHeight: 1.5 }}>
                {vista.leyenda}
              </p>
            </div>
          )}

          {vista && vista.ok && (
            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <div style={dos}>
                <Campo label={t("publico.nombre")} id="pub-nombre">
                  <input
                    id="pub-nombre"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    autoComplete="name"
                    style={input}
                  />
                </Campo>
                <Campo label={t("publico.telefono")} id="pub-tel" hint={t("publico.telefonoAyuda")}>
                  <input
                    id="pub-tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="55 1234 5678"
                    style={input}
                  />
                </Campo>
              </div>

              {/* Campo trampa: invisible para una persona, irresistible para un bot. */}
              <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
                <label htmlFor="pub-website">No llenar</label>
                <input
                  id="pub-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              {error && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: "#b0392b" }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!listoParaEnviar || estado === "enviando"}
                style={{
                  ...btnPrimario,
                  opacity: !listoParaEnviar || estado === "enviando" ? 0.55 : 1,
                  cursor: !listoParaEnviar || estado === "enviando" ? "not-allowed" : "pointer",
                }}
              >
                {estado === "enviando" ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {t("publico.calculando")}
                  </>
                ) : (
                  t("publico.verResultado")
                )}
              </button>

              <p style={{ margin: 0, fontSize: 11.5, color: "#7a857e", lineHeight: 1.5 }}>
                {t("publico.aviso")}
              </p>
            </div>
          )}
        </>
      )}
    </form>
  );
}

// ── Piezas locales ─────────────────────────────────────────────────────
// Estilos propios y no los tokens del panel: esto se pinta en la web
// PÚBLICA, donde no existe .realty-shell y por lo tanto no existe ninguna
// de esas variables. Heredar tokens que no están definidos deja el texto
// negro sobre negro.

const TINTA = "#14201A";
const GRIS = "#4c5a52";
const VERDE = "#2F6B4D";

const caja: React.CSSProperties = {
  position: "relative",
  background: "#FFFDF8",
  border: "1px solid #E2DCCE",
  borderRadius: 16,
  padding: 22,
  maxWidth: 560,
  color: TINTA,
  fontFamily: "inherit",
};

const input: React.CSSProperties = {
  width: "100%",
  height: 42,
  border: "1px solid #D9D2C2",
  borderRadius: 10,
  padding: "0 12px",
  fontSize: 15,
  color: TINTA,
  background: "#fff",
  outline: "none",
  fontFamily: "inherit",
};

const dos: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const btnPrimario: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  height: 46,
  border: "none",
  borderRadius: 12,
  background: VERDE,
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
  fontFamily: "inherit",
};

const btnFantasma: React.CSSProperties = {
  height: 40,
  padding: "0 16px",
  borderRadius: 10,
  border: "1px solid #D9D2C2",
  background: "#fff",
  color: GRIS,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

function limpiar(v: string): string {
  return v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function Campo({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 600, color: GRIS }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: "#7a857e", lineHeight: 1.45 }}>{hint}</span>}
    </div>
  );
}
