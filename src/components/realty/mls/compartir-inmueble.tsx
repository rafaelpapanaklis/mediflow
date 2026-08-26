"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL INTERRUPTOR DE LA BOLSA, PARA LA FICHA DEL INMUEBLE.
//
// Pieza AUTÓNOMA que la ficha de un inmueble (territorio de T1) monta con
// una línea. No importa nada de servidor, no navega a ninguna parte y se
// carga sola:
//
//     import { CompartirEnLaBolsa } from "@/components/realty/mls/compartir-inmueble";
//     …
//     <CompartirEnLaBolsa
//       propertyId={inmueble.id}
//       dict={mlsDict}            // el sub-árbol es/en de realty/mls.json
//       puedeEditar={puede("properties.edit")}
//     />
//
// ── POR QUÉ SE PINTA SOLA Y NO RECIBE LOS TÉRMINOS COMO PROP ───────────
// Si los recibiera, la ficha tendría que ir a buscarlos, es decir: la
// pantalla de T1 tendría que saber que existe una tabla de bolsa y una
// ruta que la lee. Se carga sola para que el día que la bolsa cambie de
// forma, la ficha del inmueble no se entere.
//
// ── LO QUE HACE CUANDO NO LE TOCA ──────────────────────────────────────
// Si la cuenta no tiene la feature, no es un modo con bolsa, o a la
// persona le falta el permiso, el componente NO pinta un bloque muerto en
// medio de la ficha:
//
//   · 404 (modo sin bolsa) / 401 / 403 → no pinta NADA. Para esa cuenta la
//     bolsa no existe y un cajón vacío solo estorba.
//   · 402 (el plan no la incluye)      → una línea de venta con el mensaje
//     que MANDA EL SERVIDOR, que ya trae el plan y el precio leídos de la
//     tabla. Cero precios en el código.
//
// ── EL INTERRUPTOR DICE LA VERDAD ──────────────────────────────────────
// Apagarlo retira el inmueble de la bolsa de TODAS las cuentas en la
// siguiente consulta: no hay copia, no hay caché, no hay trabajo diferido.
// El texto de ayuda lo dice con esas palabras porque es lo que pasa.
// ═══════════════════════════════════════════════════════════════════════

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronDown, Handshake, Loader2 } from "lucide-react";
import type { Dictionary, TFunction } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_MLS_PUBLIC_FIELDS,
  REALTY_MLS_REQUIRED_FIELDS,
  type RealtyMlsField,
} from "@/components/realty/mls/mls-contract";
import {
  AreaTexto,
  Aviso,
  Boton,
  Campo,
  Chip,
  Interruptor,
  Texto,
} from "@/components/realty/mls/mls-ui";

/** Lo que devuelve GET /api/realty/mls/listings?propertyId=… */
type Terminos = {
  listingId: string;
  active: boolean;
  sharedCommissionPct: number;
  acceptsCollaboration: boolean;
  requiresBuyerFromPartner: boolean;
  campos: RealtyMlsField[];
  notes: string | null;
};

/**
 * El porcentaje con el que arranca una ficha nueva.
 *
 * 50 es el reparto estándar del gremio en México (mitad quien capta, mitad
 * quien coloca) y es un DEFAULT, no una regla: el campo se edita antes de
 * guardar y cada acuerdo se negocia aparte. Está aquí y no en el contrato
 * porque es una sugerencia de pantalla, no una invariante del modelo.
 */
const PCT_SUGERIDO = "50";

type Estado =
  | { fase: "cargando" }
  | { fase: "oculto" }
  | { fase: "sinPlan"; mensaje: string }
  | { fase: "listo"; terminos: Terminos | null };

export function CompartirEnLaBolsa({
  propertyId,
  dict,
  puedeEditar,
  onCambio,
}: {
  propertyId: string;
  dict: Dictionary;
  /** properties.edit. Sin él se ve el estado, no se toca. */
  puedeEditar: boolean;
  /** Aviso al padre por si quiere refrescar algo suyo. Opcional. */
  onCambio?: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Borrador del formulario. Vive aparte de `estado` porque se teclea: si
  // compartiera estado con la carga, cada guardado reiniciaría el campo que
  // se está escribiendo.
  const [pct, setPct] = useState(PCT_SUGERIDO);
  const [acepta, setAcepta] = useState(true);
  const [exige, setExige] = useState(false);
  const [notas, setNotas] = useState("");
  const [campos, setCampos] = useState<Set<RealtyMlsField>>(
    () => new Set(REALTY_MLS_PUBLIC_FIELDS),
  );
  const [verCampos, setVerCampos] = useState(false);

  const aplicar = useCallback((terminos: Terminos | null) => {
    setPct(terminos ? String(terminos.sharedCommissionPct) : PCT_SUGERIDO);
    setAcepta(terminos ? terminos.acceptsCollaboration : true);
    setExige(terminos ? terminos.requiresBuyerFromPartner : false);
    setNotas(terminos?.notes ?? "");
    setCampos(
      new Set(
        terminos && terminos.campos.length > 0 ? terminos.campos : REALTY_MLS_PUBLIC_FIELDS,
      ),
    );
  }, []);

  const cargar = useCallback(async () => {
    if (!propertyId) {
      setEstado({ fase: "oculto" });
      return;
    }
    try {
      const res = await fetch(
        `/api/realty/mls/listings?propertyId=${encodeURIComponent(propertyId)}`,
        { cache: "no-store" },
      );
      if (res.status === 402) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // El mensaje viene del servidor con el plan y el precio LEÍDOS de la
        // tabla. Si por lo que sea no llegara, se calla: inventar un precio
        // aquí sería peor que no ofrecer nada.
        setEstado(
          typeof json.error === "string" && json.error
            ? { fase: "sinPlan", mensaje: json.error }
            : { fase: "oculto" },
        );
        return;
      }
      if (!res.ok) {
        setEstado({ fase: "oculto" });
        return;
      }
      const json = (await res.json()) as { listing: Terminos | null };
      aplicar(json.listing);
      setEstado({ fase: "listo", terminos: json.listing });
    } catch {
      setEstado({ fase: "oculto" });
    }
  }, [propertyId, aplicar]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/mls/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          sharedCommissionPct: Number(pct.replace(",", ".")) || 0,
          acceptsCollaboration: acepta,
          requiresBuyerFromPartner: exige,
          // Se manda la lista COMPLETA aunque esté entera: el servidor la
          // sanea contra la lista blanca y una lista vacía significa "los
          // públicos por omisión", que no es lo mismo que "ninguno".
          exposedFields: Array.from(campos),
          notes: notas,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setFlash(t("acciones.guardado"));
      setAbierto(false);
      await cargar();
      onCambio?.();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setGuardando(false);
    }
  }

  /** El interruptor. Encender por primera vez comparte con los términos del
   *  borrador; apagar retira de la bolsa de todos, de inmediato. */
  async function alternar(next: boolean) {
    const actual = estado.fase === "listo" ? estado.terminos : null;

    // Nunca se ha compartido: encenderlo es crear la ficha, así que se abre
    // el formulario en vez de publicar a ciegas con un porcentaje que nadie
    // revisó. Lo primero que mira el otro asesor no puede salir por default.
    if (!actual) {
      if (next) setAbierto(true);
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/mls/listings/${actual.listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setFlash(next ? t("compartir.estadoActivo") : t("compartir.retirado"));
      await cargar();
      onCambio?.();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setGuardando(false);
    }
  }

  function alternarCampo(campo: RealtyMlsField) {
    // Los obligatorios no se pueden quitar: sin ellos la ficha no es una
    // ficha, es una fila en blanco que ensucia el buscador de todos.
    if (REALTY_MLS_REQUIRED_FIELDS.includes(campo)) return;
    setCampos((prev) => {
      const next = new Set(prev);
      if (next.has(campo)) next.delete(campo);
      else next.add(campo);
      return next;
    });
  }

  if (estado.fase === "cargando" || estado.fase === "oculto") return null;

  if (estado.fase === "sinPlan") {
    return (
      <Caja>
        <Encabezado t={t} chip={null} />
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
          {estado.mensaje}
        </p>
        <a
          href="/inmobiliaria/suscripcion"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)" }}
        >
          {t("sinPlan.cta")}
        </a>
      </Caja>
    );
  }

  const terminos = estado.terminos;
  const enLaBolsa = terminos?.active === true;

  return (
    <Caja>
      <Encabezado
        t={t}
        chip={
          enLaBolsa ? (
            <Chip tono="ok">{t("compartir.estadoActivo")}</Chip>
          ) : (
            <Chip tono="neutro">{t("compartir.estadoInactivo")}</Chip>
          )
        }
      />

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
        {enLaBolsa ? t("enFicha.compartido") : t("enFicha.noCompartido")}
      </p>

      {puedeEditar ? (
        <Interruptor
          checked={enLaBolsa}
          disabled={guardando}
          onChange={(v) => void alternar(v)}
          label={t("enFicha.interruptor")}
          ayuda={t("compartir.retirarConfirm")}
        />
      ) : (
        <Aviso tono="neutro">{t("enFicha.sinPermiso")}</Aviso>
      )}

      {/* El resumen de los términos, para no tener que abrir el formulario
          solo para recordar cuánto se está soltando. */}
      {terminos ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <Chip tono={terminos.sharedCommissionPct > 0 ? "brand" : "neutro"}>
            {terminos.sharedCommissionPct > 0
              ? t("ficha.compartePct", { pct: terminos.sharedCommissionPct })
              : t("ficha.comparteCero")}
          </Chip>
          <Chip tono={terminos.acceptsCollaboration ? "ok" : "aviso"}>
            {terminos.acceptsCollaboration
              ? t("ficha.aceptaColaboracion")
              : t("ficha.noAceptaColaboracion")}
          </Chip>
          {terminos.requiresBuyerFromPartner ? (
            <Chip tono="neutro">{t("ficha.exigeCliente")}</Chip>
          ) : null}
          <Chip tono="neutro">
            {t("enFicha.camposContados", {
              n: terminos.campos.length,
              total: REALTY_MLS_PUBLIC_FIELDS.length,
            })}
          </Chip>
        </div>
      ) : null}

      {error ? <Aviso tono="malo">{error}</Aviso> : null}
      {flash && !error ? <Aviso tono="ok">{flash}</Aviso> : null}

      {puedeEditar && !abierto ? (
        <div>
          <Boton onClick={() => setAbierto(true)} disabled={guardando}>
            {terminos ? t("compartir.editar") : t("enFicha.abrir")}
          </Boton>
        </div>
      ) : null}

      {puedeEditar && abierto ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border-soft)",
          }}
        >
          <Campo label={t("compartir.pct")} ayuda={t("compartir.pctAyuda")} htmlFor="mls-pct">
            <div style={{ display: "flex", alignItems: "center", gap: 7, maxWidth: 190 }}>
              <Texto id="mls-pct" type="number" min={0} max={100} step={1} value={pct} onChange={setPct} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>%</span>
            </div>
          </Campo>

          <Interruptor
            checked={acepta}
            onChange={setAcepta}
            label={t("compartir.aceptaColaboracion")}
            ayuda={t("compartir.aceptaColaboracionAyuda")}
          />
          <Interruptor
            checked={exige}
            onChange={setExige}
            label={t("compartir.exigeCliente")}
            ayuda={t("compartir.exigeClienteAyuda")}
          />

          {/* Los campos van colapsados: son 28 casillas y esta tarjeta vive
              DENTRO de la ficha del inmueble, no en una pantalla propia. */}
          <div>
            <button
              type="button"
              onClick={() => setVerCampos((v) => !v)}
              aria-expanded={verCampos}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: 0,
                background: "none",
                border: "none",
                color: "var(--text-2)",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ChevronDown
                size={13}
                style={{
                  transform: verCampos ? "rotate(180deg)" : "none",
                  transition: "transform 140ms ease",
                }}
              />
              {t("compartir.campos")} ({campos.size}/{REALTY_MLS_PUBLIC_FIELDS.length})
            </button>

            {verCampos ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
                <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.6 }}>
                  {t("compartir.camposAyuda")}
                </p>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setCampos(new Set(REALTY_MLS_PUBLIC_FIELDS))}
                    style={MINI}
                  >
                    {t("compartir.camposTodos")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampos(new Set(REALTY_MLS_REQUIRED_FIELDS))}
                    style={MINI}
                  >
                    {t("compartir.camposMinimos")}
                  </button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 5,
                    gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))",
                  }}
                >
                  {REALTY_MLS_PUBLIC_FIELDS.map((campo) => {
                    const fijo = REALTY_MLS_REQUIRED_FIELDS.includes(campo);
                    return (
                      <label
                        key={campo}
                        title={fijo ? t("compartir.campoObligatorio") : undefined}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11.5,
                          color: fijo ? "var(--text-3)" : "var(--text-2)",
                          cursor: fijo ? "not-allowed" : "pointer",
                          minWidth: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={campos.has(campo)}
                          disabled={fijo}
                          onChange={() => alternarCampo(campo)}
                          style={{ width: 14, height: 14, accentColor: "var(--brand)", cursor: "inherit" }}
                        />
                        <span style={{ minWidth: 0 }}>{t(`compartir.camposLabels.${campo}`)}</span>
                      </label>
                    );
                  })}
                </div>
                {campos.has("direccion") || campos.has("lat") || campos.has("lng") ? (
                  <Aviso tono="aviso">{t("compartir.direccionAviso")}</Aviso>
                ) : null}
              </div>
            ) : null}
          </div>

          <Campo
            label={t("compartir.notas")}
            ayuda={t("compartir.notasAviso")}
            htmlFor="mls-notas"
          >
            <AreaTexto
              id="mls-notas"
              value={notas}
              onChange={setNotas}
              rows={2}
              maxLength={400}
              placeholder={t("compartir.notasPlaceholder")}
            />
          </Campo>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Boton variante="primario" onClick={() => void guardar()} disabled={guardando}>
              {guardando ? <Loader2 size={13} className="animate-spin" /> : null}
              {guardando
                ? t("compartir.guardando")
                : terminos
                  ? t("compartir.guardarEditar")
                  : t("compartir.guardar")}
            </Boton>
            <Boton
              onClick={() => {
                setAbierto(false);
                setError(null);
                aplicar(terminos);
              }}
              disabled={guardando}
            >
              {t("acciones.cancelar")}
            </Boton>
          </div>
        </div>
      ) : null}
    </Caja>
  );
}

// ── Piezas de esta tarjeta ─────────────────────────────────────────────

const MINI: CSSProperties = {
  padding: "4px 9px",
  borderRadius: 7,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

function Caja({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 14,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
      }}
    >
      {children}
    </section>
  );
}

function Encabezado({
  t,
  chip,
}: {
  t: TFunction;
  chip: ReactNode;
}) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <h3
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          margin: 0,
          fontSize: 13.5,
          fontWeight: 700,
          color: "var(--text-1)",
        }}
      >
        <Handshake size={15} style={{ color: "var(--brand)" }} />
        {t("enFicha.title")}
      </h3>
      {chip}
    </header>
  );
}
