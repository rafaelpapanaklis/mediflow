"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL CALENDARIO DEL CORTE Y EL ARCHIVO DEL AVISO.
//
// 🔴 EL INFORME EN CEROS SE PINTA IGUAL QUE LOS DEMÁS. Un mes sin
// operaciones TAMBIÉN se reporta, y no presentarlo se sanciona igual. Por
// eso el calendario enseña TODOS los meses, con su fecha límite igual de
// visible, y el que no tiene operaciones sale marcado "en ceros" — no
// escondido. Un periodo vacío que no apareciera en pantalla sería justo la
// omisión que este módulo existe para evitar.
//
// 🔴 DESCARGAR NO ES PRESENTAR. El botón baja una hoja de concentrado; el
// archivo lo sube el cliente en el portal del SAT y DESPUÉS marca el
// periodo a mano. La leyenda va PEGADA al botón, siempre visible, nunca
// detrás de un tooltip: es la frase que separa "te ordeno el papeleo" de
// "cumplo por ti".
//
// 🔴 "PRESENTADO" LO PONE UNA PERSONA. No hay cron que marque periodos y
// bajar el archivo no marca nada. Y se puede DESHACER: alguien marca el mes
// equivocado y tiene que poder corregirlo — lo que queda es la bitácora.
// ═══════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { Boton, Campo, Nota, Tarjeta } from "@/components/realty/calc/ui";
import type { TFunction } from "@/i18n/t";
import {
  LEYENDA_DESCARGA_AVISO,
  LEYENDA_EN_CEROS,
  type PeriodoRow,
} from "@/lib/realty/pld/contrato";
import { fmtFecha, fmtFechaHora } from "@/lib/realty/pld/formato";
import {
  AreaTexto,
  AvisoAmbar,
  ErrorLinea,
  InputTexto,
  Modal,
  Pastilla,
  Tabla,
  Td,
  Th,
  Vacio,
} from "./ui";

export function PanelCalendario({
  periodos,
  hayUmbrales,
  puedeGestionar,
  timeZone,
  locale,
  t,
  onRefrescar,
}: {
  periodos: PeriodoRow[];
  hayUmbrales: boolean;
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  onRefrescar: () => void;
}) {
  const [bajando, setBajando] = useState<string | null>(null);
  const [marcando, setMarcando] = useState<PeriodoRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Baja el concentrado por fetch y NO por un <a href> a secas.
   *
   * La ruta responde 409 con un JSON cuando faltan los umbrales; una
   * navegación normal le enseñaría al usuario ese JSON crudo en una
   * pestaña. Así se lee el error y se dice en español.
   */
  async function descargar(p: PeriodoRow) {
    setBajando(p.periodMonth);
    setError(null);
    try {
      const res = await fetch(`/api/realty/pld/avisos/${p.periodMonth}/archivo`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error || t("errores.generico"));
        return;
      }
      const blob = await res.blob();
      // El nombre lo pone el servidor en la cabecera; si un proxy la come,
      // se arma uno equivalente en vez de quedarse sin descarga.
      const disp = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(disp);
      const nombre = m?.[1] || `aviso-${p.periodMonth}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("errores.generico"));
    } finally {
      setBajando(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <AvisoAmbar>{LEYENDA_EN_CEROS}</AvisoAmbar>

      <Tarjeta titulo={t("calendario.titulo")} padded={false}>
        <div style={{ padding: "14px 18px", display: "grid", gap: 10 }}>
          {/* La leyenda vive junto al botón, no en un pie de página. */}
          <Nota tono="aviso">{LEYENDA_DESCARGA_AVISO}</Nota>
          <ErrorLinea texto={error} />
        </div>

        {!hayUmbrales || periodos.length === 0 ? (
          <Vacio
            texto={hayUmbrales ? t("calendario.sinPeriodos") : t("calendario.sinUmbrales")}
          />
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>{t("calendario.columnaPeriodo")}</Th>
                <Th>{t("calendario.columnaVence")}</Th>
                <Th>{t("calendario.columnaOperaciones")}</Th>
                <Th>{t("calendario.columnaEstado")}</Th>
                <Th ancho={1}>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.periodMonth}>
                  <Td>
                    <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{p.etiqueta}</div>
                    <div style={{ marginTop: 4 }}>
                      <Pastilla tono={p.kind === "EN_CEROS" ? "info" : "neutral"}>
                        {p.kind === "EN_CEROS"
                          ? t("calendario.enCeros")
                          : t("calendario.conOperaciones")}
                      </Pastilla>
                    </div>
                  </Td>
                  <Td>
                    <div>{fmtFecha(p.dueDate, timeZone, locale)}</div>
                    <div
                      style={{
                        fontSize: 11,
                        marginTop: 2,
                        color: p.vencido ? "#b03030" : "var(--text-4)",
                        fontWeight: p.vencido ? 700 : 400,
                      }}
                    >
                      {p.diasRestantes === 0
                        ? t("calendario.hoyVence")
                        : p.diasRestantes > 0
                          ? t("calendario.diasRestantes", { dias: p.diasRestantes })
                          : t("calendario.diasVencido", { dias: Math.abs(p.diasRestantes) })}
                    </div>
                  </Td>
                  <Td numerico>
                    <div>{p.operaciones}</div>
                    {p.sinExpediente > 0 && (
                      <div style={{ fontSize: 11, color: "#a8741a", marginTop: 2, fontWeight: 600 }}>
                        {t("calendario.sinExpedienteAviso", { n: p.sinExpediente })}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Pastilla
                      tono={
                        p.status === "PRESENTADO" ? "ok" : p.vencido ? "peligro" : "aviso"
                      }
                    >
                      {p.status === "PRESENTADO"
                        ? t("calendario.presentado")
                        : p.vencido
                          ? t("calendario.vencido")
                          : t("calendario.pendiente")}
                    </Pastilla>
                    {p.presentedAt && (
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3, lineHeight: 1.45 }}>
                        {fmtFechaHora(p.presentedAt, timeZone, locale)}
                        {p.presentedByName ? ` · ${p.presentedByName}` : ""}
                        {p.acuse ? (
                          <div>
                            {t("calendario.acuse")}: {p.acuse}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Boton
                        icon={<Download size={13} />}
                        disabled={bajando === p.periodMonth}
                        onClick={() => void descargar(p)}
                      >
                        {bajando === p.periodMonth
                          ? t("calendario.descargando")
                          : t("calendario.descargar")}
                      </Boton>
                      {puedeGestionar && (
                        <Boton
                          icon={<CheckCircle2 size={13} />}
                          variante={p.status === "PRESENTADO" ? "ghost" : "primario"}
                          onClick={() => setMarcando(p)}
                        >
                          {p.status === "PRESENTADO"
                            ? t("calendario.desmarcar")
                            : t("calendario.marcar")}
                        </Boton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {marcando && (
        <ModalMarcar
          periodo={marcando}
          t={t}
          onCerrar={() => setMarcando(null)}
          onHecho={() => {
            setMarcando(null);
            onRefrescar();
          }}
        />
      )}
    </div>
  );
}

function ModalMarcar({
  periodo,
  t,
  onCerrar,
  onHecho,
}: {
  periodo: PeriodoRow;
  t: TFunction;
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const desmarcar = periodo.status === "PRESENTADO";
  const [acuse, setAcuse] = useState(periodo.acuse ?? "");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/pld/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodMonth: periodo.periodMonth,
          presentado: !desmarcar,
          acuse,
          notas,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return;
      }
      onHecho();
    } catch {
      setError(t("errores.generico"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      abierto
      titulo={`${desmarcar ? t("calendario.desmarcar") : t("calendario.marcar")} — ${periodo.etiqueta}`}
      onCerrar={onCerrar}
      ancho={560}
      pie={
        <>
          <Boton onClick={onCerrar}>{t("ficha.cerrar")}</Boton>
          <Boton variante="primario" disabled={guardando} onClick={() => void enviar()}>
            {guardando ? t("ficha.guardando") : t("calendario.confirmar")}
          </Boton>
        </>
      }
    >
      <Nota tono="aviso">{LEYENDA_DESCARGA_AVISO}</Nota>
      <ErrorLinea texto={error} />

      {desmarcar ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
          {t("calendario.desmarcarAyuda")}
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
            {t("calendario.marcarAyuda")}
          </p>
          {periodo.sinExpediente > 0 && (
            <AvisoAmbar>
              {t("calendario.sinExpedienteAviso", { n: periodo.sinExpediente })}
            </AvisoAmbar>
          )}
          <Campo label={t("calendario.acuse")} htmlFor="pld-acuse">
            <InputTexto id="pld-acuse" maxLength={400} value={acuse} onChange={setAcuse} />
          </Campo>
          <Campo label={t("ficha.notas")} htmlFor="pld-acuse-notas">
            <AreaTexto
              id="pld-acuse-notas"
              filas={2}
              maxLength={2000}
              value={notas}
              onChange={setNotas}
            />
          </Campo>
        </>
      )}
    </Modal>
  );
}
