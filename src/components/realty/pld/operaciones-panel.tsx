"use client";

// ═══════════════════════════════════════════════════════════════════════
// LAS OPERACIONES CONTRA EL UMBRAL.
//
// 🔴 ESTA PANTALLA COMPARA. No dictamina, no presenta nada y no decide por
// nadie: dice qué obligación se disparó y con qué números se comparó.
//
// 🔴 LA BANDERA ROJA DEL EFECTIVO NO SE APAGA. Cuando el efectivo rebasa
// el tope, la operación es ILEGAL — no "revisable". Se puede dejar
// constancia de que alguien la miró (cashAckNote), y aun así el renglón
// sigue marcado y sigue contando en el tablero. Un botón que la apagara
// convertiría la alerta en una molestia que se quita con un clic.
//
// 🔴 SIN UMBRALES CAPTURADOS NO SE PINTA NINGUNA OBLIGACIÓN. Las
// operaciones salen igual —la lista sirve— pero todas en "no rebasa
// umbral", que es literalmente lo que el servidor sabe: no ha comparado
// contra nada. La pantalla enseña arriba qué falta capturar.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { Tarjeta, Boton, Campo, Nota } from "@/components/realty/calc/ui";
import { fmtMXN, fmtMXN2, toCents } from "@/lib/realty/calc/money";
import type { TFunction } from "@/i18n/t";
import {
  LEYENDA_EFECTIVO_PROHIBIDO,
  LEYENDA_UMBRALES,
  PLD_ESTADO_LABELS,
  PLD_NIVEL_LABELS,
  type OperacionRow,
  type UmbralesVigentes,
} from "@/lib/realty/pld/contrato";
import { fmtFecha, fmtFechaHora } from "@/lib/realty/pld/formato";
import {
  AreaTexto,
  AvisoAmbar,
  BanderaRoja,
  ErrorLinea,
  Filtros,
  InputTexto,
  Modal,
  Pastilla,
  Tabla,
  Td,
  Th,
  TONO_ESTADO,
  TONO_NIVEL,
  Vacio,
} from "./ui";

/** "" = todas. */
export type FiltroOperacion = "" | "umbral" | "sinExpediente" | "bandera" | "alerta";

export function PanelOperaciones({
  operaciones,
  umbrales,
  puedeGestionar,
  timeZone,
  locale,
  t,
  filtro,
  onFiltro,
  onRefrescar,
}: {
  operaciones: OperacionRow[];
  umbrales: UmbralesVigentes | null;
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  filtro: FiltroOperacion;
  onFiltro: (f: FiltroOperacion) => void;
  onRefrescar: () => void;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);

  const conteos = useMemo(
    () => ({
      todas: operaciones.length,
      umbral: operaciones.filter((o) => o.nivel !== "NINGUNO").length,
      sinExpediente: operaciones.filter(
        (o) => o.requiereExpediente && o.estadoExpediente !== "COMPLETO",
      ).length,
      bandera: operaciones.filter((o) => o.efectivoProhibido).length,
      alerta: operaciones.filter((o) => o.urgentFlaggedAt && !o.urgentDoneAt).length,
    }),
    [operaciones],
  );

  const visibles = useMemo(
    () =>
      operaciones.filter((o) => {
        if (filtro === "umbral") return o.nivel !== "NINGUNO";
        if (filtro === "sinExpediente")
          return o.requiereExpediente && o.estadoExpediente !== "COMPLETO";
        if (filtro === "bandera") return o.efectivoProhibido;
        if (filtro === "alerta") return !!o.urgentFlaggedAt && !o.urgentDoneAt;
        return true;
      }),
    [operaciones, filtro],
  );

  const seleccionada = abierta ? (operaciones.find((o) => o.dealId === abierta) ?? null) : null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Tarjeta titulo={t("operaciones.titulo")} padded={false}>
        <div style={{ padding: "14px 18px", display: "grid", gap: 10 }}>
          <Filtros
            valor={filtro}
            onCambiar={(v) => onFiltro(v as FiltroOperacion)}
            items={[
              { key: "", label: t("operaciones.filtroTodas"), contador: conteos.todas },
              { key: "umbral", label: t("operaciones.filtroSobreUmbral"), contador: conteos.umbral },
              {
                key: "sinExpediente",
                label: t("operaciones.filtroSinExpediente"),
                contador: conteos.sinExpediente,
              },
              { key: "bandera", label: t("operaciones.filtroBandera"), contador: conteos.bandera },
              { key: "alerta", label: t("operaciones.filtroAlerta"), contador: conteos.alerta },
            ]}
          />
          {umbrales ? (
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.55 }}>
              {t("operaciones.comparadoCon", {
                identificacion: fmtMXN(toCents(umbrales.identificacion)),
                aviso: fmtMXN(toCents(umbrales.aviso)),
                efectivo: fmtMXN(toCents(umbrales.efectivo)),
              })}{" "}
              {LEYENDA_UMBRALES}
            </p>
          ) : (
            <AvisoAmbar>{t("operaciones.sinUmbrales")}</AvisoAmbar>
          )}
        </div>

        {visibles.length === 0 ? (
          <Vacio texto={t("operaciones.sinOperaciones")} />
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>{t("operaciones.columnaFecha")}</Th>
                <Th>{t("operaciones.columnaInmueble")}</Th>
                <Th>{t("operaciones.columnaCliente")}</Th>
                <Th>{t("operaciones.columnaMonto")}</Th>
                <Th>{t("operaciones.columnaEfectivo")}</Th>
                <Th>{t("operaciones.columnaNivel")}</Th>
                <Th>{t("operaciones.columnaExpediente")}</Th>
                <Th ancho={1}>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((o) => (
                <tr key={o.dealId}>
                  <Td>
                    <div>{fmtFecha(o.closedAt, timeZone, locale)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>
                      {o.kind === "VENTA" ? t("operaciones.venta") : t("operaciones.renta")}
                    </div>
                  </Td>
                  <Td>{o.propertyTitle}</Td>
                  <Td>{o.contactName ?? "—"}</Td>
                  <Td numerico>{fmtMXN(toCents(o.amount))}</Td>
                  <Td numerico>
                    <span style={{ color: o.efectivoProhibido ? "#b03030" : undefined, fontWeight: o.efectivoProhibido ? 700 : undefined }}>
                      {fmtMXN(toCents(o.efectivo))}
                    </span>
                  </Td>
                  <Td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      <Pastilla tono={TONO_NIVEL[o.nivel]}>{PLD_NIVEL_LABELS[o.nivel]}</Pastilla>
                      {o.efectivoProhibido && (
                        <Pastilla tono="peligro">{t("operaciones.banderaRoja")}</Pastilla>
                      )}
                      {o.urgentFlaggedAt && !o.urgentDoneAt && (
                        <Pastilla tono="peligro">{t("operaciones.alerta24")}</Pastilla>
                      )}
                      {o.presentada && (
                        <Pastilla tono="ok">{t("operaciones.presentada")}</Pastilla>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {o.estadoExpediente ? (
                      <Pastilla tono={TONO_ESTADO[o.estadoExpediente]}>
                        {PLD_ESTADO_LABELS[o.estadoExpediente]}
                      </Pastilla>
                    ) : (
                      <Pastilla tono={o.requiereExpediente ? "peligro" : "neutral"}>
                        {t("operaciones.sinExpediente")}
                      </Pastilla>
                    )}
                  </Td>
                  <Td>
                    <Boton onClick={() => setAbierta(o.dealId)}>{t("operaciones.revisar")}</Boton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {seleccionada && (
        <ModalOperacion
          operacion={seleccionada}
          umbrales={umbrales}
          puedeGestionar={puedeGestionar}
          timeZone={timeZone}
          locale={locale}
          t={t}
          onCerrar={() => setAbierta(null)}
          onRefrescar={onRefrescar}
        />
      )}
    </div>
  );
}

/**
 * Lo que una persona puede DECIDIR sobre una operación: cuánto se liquidó
 * en efectivo, dejar constancia de que se revisó la bandera roja y levantar
 * o cerrar la alerta urgente.
 *
 * Ningún umbral ni ningún veredicto se guardan: el nivel se recalcula
 * siempre contra el parámetro vigente. Guardarlo dejaría a una operación
 * evaluada con la UMA del año pasado diciendo "no rebasa" para siempre.
 */
function ModalOperacion({
  operacion,
  umbrales,
  puedeGestionar,
  timeZone,
  locale,
  t,
  onCerrar,
  onRefrescar,
}: {
  operacion: OperacionRow;
  umbrales: UmbralesVigentes | null;
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  onCerrar: () => void;
  onRefrescar: () => void;
}) {
  // 🔴 Arranca VACÍO cuando nadie declaró nada, aunque haya pagos en
  // efectivo registrados. Precargarlo con la suma haría que guardar sin
  // tocar el campo congelara esa cifra como declaración, y desde entonces
  // un pago nuevo ya no movería la bandera roja.
  const [efectivo, setEfectivo] = useState(
    operacion.cashDeclared != null ? String(operacion.cashDeclared) : "",
  );
  const [acuse, setAcuse] = useState(operacion.cashAckNote ?? "");
  const [motivo, setMotivo] = useState(operacion.urgentReason ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excedente =
    umbrales && operacion.efectivo > umbrales.efectivo
      ? operacion.efectivo - umbrales.efectivo
      : 0;

  async function enviar(parche: Record<string, unknown>) {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/pld/operaciones/${operacion.dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parche),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return false;
      }
      onRefrescar();
      return true;
    } catch {
      setError(t("errores.generico"));
      return false;
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      abierto
      titulo={operacion.propertyTitle}
      onCerrar={onCerrar}
      ancho={680}
      pie={<Boton onClick={onCerrar}>{t("ficha.cerrar")}</Boton>}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Pastilla tono={TONO_NIVEL[operacion.nivel]}>
          {PLD_NIVEL_LABELS[operacion.nivel]}
        </Pastilla>
        <Pastilla tono="neutral">
          {t("operaciones.columnaMonto")}: {fmtMXN2(toCents(operacion.amount))}
        </Pastilla>
        {operacion.closedAt && (
          <Pastilla tono="neutral">{fmtFecha(operacion.closedAt, timeZone, locale)}</Pastilla>
        )}
      </div>

      <ErrorLinea texto={error} />

      {/* ── La bandera roja ── */}
      {operacion.efectivoProhibido && (
        <BanderaRoja>
          <strong style={{ fontWeight: 700, display: "block", marginBottom: 4 }}>
            {t("operaciones.banderaRoja")}
            {excedente > 0 ? ` — ${t("operaciones.excedente")} ${fmtMXN2(toCents(excedente))}` : ""}
          </strong>
          {LEYENDA_EFECTIVO_PROHIBIDO}
          {operacion.cashAckAt && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-3)" }}>
              {t("operaciones.acusado")} · {fmtFechaHora(operacion.cashAckAt, timeZone, locale)}
            </div>
          )}
        </BanderaRoja>
      )}

      {/* ── Efectivo declarado ── */}
      <Campo
        label={t("operaciones.efectivoDeclarado")}
        htmlFor="pld-op-efectivo"
        hint={`${t("operaciones.efectivoAyuda")} ${t("operaciones.efectivoPagos", {
          monto: fmtMXN2(toCents(operacion.efectivoPagos)),
        })}`}
      >
        <InputTexto
          id="pld-op-efectivo"
          value={efectivo}
          disabled={!puedeGestionar}
          onChange={(v) => setEfectivo(v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
        />
      </Campo>
      {puedeGestionar && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Boton
            variante="primario"
            disabled={guardando}
            onClick={() =>
              void enviar({ cashDeclared: efectivo.trim() === "" ? null : Number(efectivo) })
            }
          >
            {guardando ? t("ficha.guardando") : t("ficha.guardar")}
          </Boton>
        </div>
      )}

      {/* ── Constancia de que se revisó (NO apaga la bandera) ── */}
      {operacion.efectivoProhibido && puedeGestionar && (
        <div style={{ display: "grid", gap: 10 }}>
          <Campo label={t("operaciones.acuseNota")} htmlFor="pld-op-acuse">
            <AreaTexto
              id="pld-op-acuse"
              filas={2}
              maxLength={1200}
              value={acuse}
              onChange={setAcuse}
            />
          </Campo>
          <Nota tono="aviso">{t("operaciones.acuseNoApaga")}</Nota>
          <div>
            <Boton disabled={guardando} onClick={() => void enviar({ cashAckNote: acuse })}>
              {t("operaciones.acusar")}
            </Boton>
          </div>
        </div>
      )}

      {/* ── La alerta de 24 horas ── */}
      <div style={{ display: "grid", gap: 10 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-3)",
            fontWeight: 700,
          }}
        >
          {t("operaciones.alerta24")}
        </h3>
        {umbrales ? (
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.55 }}>
            {t("operaciones.alerta24Ayuda", { horas: umbrales.horasAvisoUrgente })}
          </p>
        ) : (
          <AvisoAmbar>{t("operaciones.alertaSinPlazo")}</AvisoAmbar>
        )}

        {operacion.urgentFlaggedAt && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border-soft)",
              background: "var(--bg-elev-2)",
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.55,
            }}
          >
            <div>
              {t("operaciones.venceEn")}:{" "}
              <strong style={{ fontWeight: 700 }}>
                {fmtFechaHora(operacion.urgentDueAt, timeZone, locale)}
              </strong>
            </div>
            {operacion.urgentDoneAt && (
              <div style={{ marginTop: 4 }}>
                {t("operaciones.alertaAtendida")} ·{" "}
                {fmtFechaHora(operacion.urgentDoneAt, timeZone, locale)}
              </div>
            )}
          </div>
        )}

        {puedeGestionar && (
          <>
            <Campo label={t("operaciones.motivoAlerta")} htmlFor="pld-op-motivo">
              <AreaTexto
                id="pld-op-motivo"
                filas={2}
                maxLength={1200}
                value={motivo}
                onChange={setMotivo}
              />
            </Campo>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Boton
                disabled={guardando || !motivo.trim()}
                onClick={() => void enviar({ urgentReason: motivo })}
              >
                {t("operaciones.levantarAlerta")}
              </Boton>
              {operacion.urgentFlaggedAt && !operacion.urgentDoneAt && (
                <Boton
                  variante="primario"
                  disabled={guardando}
                  onClick={() => void enviar({ urgentDone: true })}
                >
                  {t("operaciones.cerrarAlerta")}
                </Boton>
              )}
              {/* Levantar por error tiene que poder deshacerse: se manda el
                  motivo VACÍO, que es lo que la API entiende por "bájala". */}
              {operacion.urgentFlaggedAt && (
                <Boton
                  disabled={guardando}
                  onClick={() => {
                    setMotivo("");
                    void enviar({ urgentReason: "" });
                  }}
                >
                  {t("operaciones.bajarAlerta")}
                </Boton>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
