"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA LISTA DE EXPEDIENTES.
//
// 🔴 LO QUE ESTA TABLA TIENE ES UN RESUMEN, NO EL EXPEDIENTE. Nombre,
// estado, riesgo y qué tipo de papel falta. El RFC, la CURP, el domicilio y
// los beneficiarios NO están en esta pantalla: se piden al abrir un
// expediente concreto (GET /api/realty/pld/expedientes/[id]) y esa petición
// es la que deja renglón en la bitácora. Ver ExpedienteResumen.
//
// ── ABRIR UN EXPEDIENTE NUEVO ES UNA COREOGRAFÍA DE DOS TIEMPOS ───────
// El POST crea la fila en el servidor, pero la lista de esta pantalla la
// pintó el render anterior: el expediente recién creado NO está en `datos`.
// Por eso se guarda el contactId como "pendiente", se pide router.refresh()
// y un efecto abre la ficha en cuanto la fila aparece en las props nuevas.
// Abrirla antes enseñaría un expediente que el servidor todavía no ha
// confirmado.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Search } from "lucide-react";
import { Boton, Campo, Tarjeta } from "@/components/realty/calc/ui";
import type { TFunction } from "@/i18n/t";
import {
  PLD_DOC_KIND_LABELS,
  PLD_ESTADO_LABELS,
  PLD_PERSON_KIND_LABELS,
  PLD_RISK_LABELS,
  type ContactoLite,
  type ExpedienteResumen,
} from "@/lib/realty/pld/contrato";
import { fmtFecha } from "@/lib/realty/pld/formato";
import { FichaExpediente } from "./ficha";
import {
  ErrorLinea,
  Filtros,
  InputTexto,
  Modal,
  Pastilla,
  Tabla,
  Td,
  Th,
  TONO_ESTADO,
  TONO_RIESGO,
  Vacio,
} from "./ui";

/** Filtros de la lista. "" = todos. */
export type FiltroExpediente = "" | "INCOMPLETO" | "VENCIDO" | "PEP";

export function PanelExpedientes({
  expedientes,
  contactos,
  puedeGestionar,
  timeZone,
  locale,
  t,
  filtro,
  onFiltro,
  onRefrescar,
}: {
  expedientes: ExpedienteResumen[];
  contactos: ContactoLite[];
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  filtro: FiltroExpediente;
  onFiltro: (f: FiltroExpediente) => void;
  onRefrescar: () => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [pendiente, setPendiente] = useState<string | null>(null);

  // Ver la cabecera: la ficha se abre cuando la fila recién creada aparece
  // en las props, no cuando el POST responde.
  useEffect(() => {
    if (!pendiente) return;
    const e = expedientes.find((x) => x.contactId === pendiente);
    if (e) {
      setAbierto(e.id);
      setPendiente(null);
    }
  }, [pendiente, expedientes]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return expedientes.filter((e) => {
      if (filtro === "PEP" && e.pep === "NO") return false;
      if ((filtro === "INCOMPLETO" || filtro === "VENCIDO") && e.estado !== filtro) return false;
      if (q && !e.contactName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expedientes, filtro, busqueda]);

  const conteos = useMemo(
    () => ({
      todos: expedientes.length,
      incompletos: expedientes.filter((e) => e.estado === "INCOMPLETO").length,
      vencidos: expedientes.filter((e) => e.estado === "VENCIDO").length,
      pep: expedientes.filter((e) => e.pep !== "NO").length,
    }),
    [expedientes],
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Tarjeta
        titulo={t("expedientes.titulo")}
        accion={
          puedeGestionar ? (
            <Boton
              variante="primario"
              icon={<FilePlus2 size={14} />}
              onClick={() => setNuevoAbierto(true)}
            >
              {t("expedientes.nuevo")}
            </Boton>
          ) : undefined
        }
        padded={false}
      >
        <div style={{ padding: "14px 18px", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
              <Search
                size={14}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 11,
                  top: 12,
                  color: "var(--text-4)",
                  pointerEvents: "none",
                }}
              />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={t("expedientes.buscar")}
                aria-label={t("expedientes.buscar")}
                style={{
                  width: "100%",
                  height: 38,
                  paddingLeft: 32,
                  paddingRight: 11,
                  background: "var(--bg)",
                  color: "var(--text-1)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  fontSize: 13.5,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <Filtros
              valor={filtro}
              onCambiar={(v) => onFiltro(v as FiltroExpediente)}
              items={[
                { key: "", label: t("operaciones.filtroTodas"), contador: conteos.todos },
                {
                  key: "INCOMPLETO",
                  label: t("expedientes.filtroIncompletos"),
                  contador: conteos.incompletos,
                },
                {
                  key: "VENCIDO",
                  label: t("expedientes.filtroVencidos"),
                  contador: conteos.vencidos,
                },
                { key: "PEP", label: t("expedientes.filtroPep"), contador: conteos.pep },
              ]}
            />
          </div>
        </div>

        {visibles.length === 0 ? (
          <Vacio
            texto={
              expedientes.length === 0
                ? t("expedientes.sinExpedientes")
                : t("expedientes.sinResultados")
            }
          />
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>{t("expedientes.columnaCliente")}</Th>
                <Th>{t("expedientes.columnaEstado")}</Th>
                <Th>{t("expedientes.columnaRiesgo")}</Th>
                <Th>{t("expedientes.documentos")}</Th>
                <Th>{t("expedientes.columnaActualizado")}</Th>
                <Th ancho={1}>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{e.contactName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 2 }}>
                      {PLD_PERSON_KIND_LABELS[e.personKind]}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      <Pastilla tono={TONO_ESTADO[e.estado]}>
                        {PLD_ESTADO_LABELS[e.estado]}
                      </Pastilla>
                    </div>
                    {/* Qué falta, por su nombre. Un "incompleto" sin decir de
                        qué no le ahorra un solo clic a nadie. */}
                    {(e.faltantes.length > 0 || e.vencidos.length > 0) && (
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--text-4)",
                          marginTop: 4,
                          lineHeight: 1.45,
                        }}
                      >
                        {e.faltantes.length > 0 && (
                          <div>
                            {t("expedientes.faltan")}:{" "}
                            {e.faltantes.map((k) => PLD_DOC_KIND_LABELS[k]).join(", ")}
                          </div>
                        )}
                        {e.vencidos.length > 0 && (
                          <div>
                            {t("expedientes.vencidos")}:{" "}
                            {e.vencidos.map((k) => PLD_DOC_KIND_LABELS[k]).join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Pastilla tono={TONO_RIESGO[e.risk]}>{PLD_RISK_LABELS[e.risk]}</Pastilla>
                    {e.pep !== "NO" && (
                      <div style={{ marginTop: 4 }}>
                        <Pastilla tono="info">{t("expedientes.esPep")}</Pastilla>
                      </div>
                    )}
                  </Td>
                  <Td numerico>{e.documentos}</Td>
                  <Td>
                    <div>{fmtFecha(e.updatedAt, timeZone, locale)}</div>
                    {e.reviewedByName && (
                      <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>
                        {e.reviewedByName}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Boton onClick={() => setAbierto(e.id)}>{t("expedientes.verExpediente")}</Boton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      {abierto && (
        <FichaExpediente
          fileId={abierto}
          resumen={expedientes.find((e) => e.id === abierto) ?? null}
          puedeGestionar={puedeGestionar}
          timeZone={timeZone}
          locale={locale}
          t={t}
          onCerrar={() => setAbierto(null)}
          onRefrescar={onRefrescar}
        />
      )}

      <ModalNuevoExpediente
        abierto={nuevoAbierto}
        contactos={contactos}
        t={t}
        onCerrar={() => setNuevoAbierto(false)}
        onCreado={(contactId) => {
          setNuevoAbierto(false);
          setPendiente(contactId);
          onRefrescar();
        }}
        onIrA={(fileId) => {
          setNuevoAbierto(false);
          setAbierto(fileId);
        }}
        expedientes={expedientes}
      />
    </div>
  );
}

/**
 * Elegir de quién es el expediente.
 *
 * Los contactos que YA tienen expediente salen igual, marcados: el índice
 * único (accountId, contactId) rechazaría un duplicado, así que enseñar
 * solo a los que faltan dejaría a quien busca a Juan Pérez convencido de
 * que Juan Pérez no está en su cartera. Se enseña, se marca y se salta.
 */
function ModalNuevoExpediente({
  abierto,
  contactos,
  expedientes,
  t,
  onCerrar,
  onCreado,
  onIrA,
}: {
  abierto: boolean;
  contactos: ContactoLite[];
  expedientes: ExpedienteResumen[];
  t: TFunction;
  onCerrar: () => void;
  onCreado: (contactId: string) => void;
  onIrA: (fileId: string) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q ? contactos.filter((c) => c.name.toLowerCase().includes(q)) : contactos;
    return base.slice(0, 60);
  }, [contactos, busqueda]);

  async function crear(contactId: string) {
    setGuardando(contactId);
    setError(null);
    try {
      const res = await fetch("/api/realty/pld/expedientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return;
      }
      onCreado(contactId);
    } catch {
      setError(t("errores.generico"));
    } finally {
      setGuardando(null);
    }
  }

  return (
    <Modal
      abierto={abierto}
      titulo={t("expedientes.elegirContacto")}
      onCerrar={onCerrar}
      ancho={560}
    >
      <Campo label={t("expedientes.buscar")} htmlFor="pld-buscar-contacto">
        <InputTexto id="pld-buscar-contacto" value={busqueda} onChange={setBusqueda} />
      </Campo>
      <ErrorLinea texto={error} />
      {visibles.length === 0 ? (
        <Vacio texto={t("expedientes.sinContactos")} />
      ) : (
        <div style={{ display: "grid", gap: 6, maxHeight: 380, overflowY: "auto" }}>
          {visibles.map((c) => {
            const existente = c.conExpediente
              ? (expedientes.find((e) => e.contactId === c.id) ?? null)
              : null;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "9px 12px",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  background: "var(--bg)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                    {c.name}
                  </div>
                  {c.phone && (
                    <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>{c.phone}</div>
                  )}
                </div>
                {existente ? (
                  <Boton onClick={() => onIrA(existente.id)}>
                    {t("expedientes.yaTieneExpediente")}
                  </Boton>
                ) : (
                  <Boton
                    variante="primario"
                    disabled={guardando !== null}
                    onClick={() => void crear(c.id)}
                  >
                    {guardando === c.id ? t("ficha.guardando") : t("expedientes.nuevo")}
                  </Boton>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
