"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL EXPEDIENTE: identificación, semáforo PEP, beneficiario controlador y
// los papeles de la bóveda.
//
// ── 🔴 EL DETALLE SE PIDE AL ABRIR, NO VIENE CON LA PANTALLA ──────────
// La lista solo trae el resumen. El RFC, la CURP, el domicilio y los
// beneficiarios se piden aquí (GET /api/realty/pld/expedientes/[id]) y esa
// petición es la que deja renglón en la bitácora. Es lo que hace que la
// bóveda de diez años pueda decir quién consultó qué: si el detalle bajara
// con la pantalla, todos habrían consultado todo con solo entrar.
//
// ── 🔴 "NO" POR OMISIÓN NO ES "NO" DECLARADO ─────────────────────────
// El desplegable del cuestionario PEP arranca en el valor guardado, pero
// mientras nadie lo GUARDE el expediente no cuenta como integrado: el sello
// `pepAskedAt` lo pone el servidor al recibir la llave `pep`. Por eso el
// aviso de "sin contestar" se pinta aunque el desplegable diga "No".
//
// ── 🔴 LOS PAPELES NO SE BORRAN: SE ARCHIVAN ─────────────────────────
// El botón de borrar solo aparece cuando ya pasó `retainUntil`, y aun así
// el corte de verdad lo hace la API (409 RETENTION_ACTIVE). Esconder un
// botón no es control de acceso; esto es solo para no ofrecer lo imposible.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, ExternalLink, Trash2, Upload } from "lucide-react";
import { Boton, Campo, Nota, Rejilla, Selector } from "@/components/realty/calc/ui";
import type { TFunction } from "@/i18n/t";
import {
  LEYENDA_BOVEDA,
  PLD_DOC_KIND_LABELS,
  PLD_DOC_KIND_LIST,
  PLD_ESTADO_LABELS,
  PLD_PEP_KINDS,
  PLD_PEP_LABELS,
  PLD_PERSON_KINDS,
  PLD_PERSON_KIND_LABELS,
  PLD_RISK_LABELS,
  type BeneficiarioControlador,
  type DocumentoRow,
  type ExpedienteResumen,
  type ExpedienteRow,
  type PldDocKind,
  type PldPepKind,
  type PldPersonKind,
} from "@/lib/realty/pld/contrato";
import { fmtBytes, fmtFecha, isoAInputFecha } from "@/lib/realty/pld/formato";
import {
  AreaTexto,
  AvisoAmbar,
  ErrorLinea,
  InputFecha,
  InputTexto,
  Modal,
  Pastilla,
  TONO_ESTADO,
  TONO_RIESGO,
  Vacio,
} from "./ui";

/** Lo que el formulario edita. Strings siempre: es lo que los inputs dan. */
interface Borrador {
  personKind: PldPersonKind;
  rfc: string;
  curp: string;
  birthDate: string;
  nationality: string;
  occupation: string;
  address: string;
  pep: PldPepKind;
  pepDetail: string;
  notes: string;
  beneficialOwners: BeneficiarioControlador[];
}

function borradorDe(e: ExpedienteRow, timeZone: string): Borrador {
  return {
    personKind: e.personKind,
    rfc: e.rfc ?? "",
    curp: e.curp ?? "",
    birthDate: isoAInputFecha(e.birthDate, timeZone),
    nationality: e.nationality ?? "",
    occupation: e.occupation ?? "",
    address: e.address ?? "",
    pep: e.pep,
    pepDetail: e.pepDetail ?? "",
    notes: e.notes ?? "",
    beneficialOwners: e.beneficialOwners,
  };
}

export function FichaExpediente({
  fileId,
  resumen,
  puedeGestionar,
  timeZone,
  locale,
  t,
  onCerrar,
  onRefrescar,
}: {
  fileId: string;
  /** Lo que ya sabe la lista, para pintar la cabecera sin esperar. */
  resumen: ExpedienteResumen | null;
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  onCerrar: () => void;
  onRefrescar: () => void;
}) {
  const [expediente, setExpediente] = useState<ExpedienteRow | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // 🔴 `t` NO va en las dependencias: makeRealtyT devuelve una función
  // NUEVA en cada render, así que meterla aquí convierte esto en un bucle
  // infinito de peticiones. El texto de error se resuelve dentro.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/pld/expedientes/${fileId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        expediente?: ExpedienteRow;
        error?: string;
      };
      if (!res.ok || !json.expediente) {
        setError(json.error || "No pudimos abrir el expediente. Inténtalo otra vez.");
        return;
      }
      setExpediente(json.expediente);
      setBorrador(borradorDe(json.expediente, timeZone));
    } catch {
      setError("No pudimos abrir el expediente. Inténtalo otra vez.");
    } finally {
      setCargando(false);
    }
  }, [fileId, timeZone]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!expediente || !borrador) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const res = await fetch("/api/realty/pld/expedientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: expediente.contactId,
          personKind: borrador.personKind,
          rfc: borrador.rfc,
          curp: borrador.curp,
          birthDate: borrador.birthDate,
          nationality: borrador.nationality,
          occupation: borrador.occupation,
          address: borrador.address,
          // Mandar `pep` es lo que sella pepAskedAt en el servidor: guardar
          // el expediente ES contestar el cuestionario.
          pep: borrador.pep,
          pepDetail: borrador.pepDetail,
          notes: borrador.notes,
          // Una persona física no declara beneficiario controlador. Se manda
          // la lista VACÍA y no se omite la llave: cambiar de moral a física
          // tiene que borrar lo que se había declarado.
          beneficialOwners:
            borrador.personKind === "FISICA" ? [] : borrador.beneficialOwners,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return;
      }
      setGuardado(true);
      await cargar();
      onRefrescar();
    } catch {
      setError(t("errores.generico"));
    } finally {
      setGuardando(false);
    }
  }

  const cabecera = expediente
    ? {
        nombre: expediente.contactName,
        estado: expediente.estado,
        risk: expediente.risk,
        motivos: expediente.motivosRiesgo,
      }
    : resumen
      ? {
          nombre: resumen.contactName,
          estado: resumen.estado,
          risk: resumen.risk,
          motivos: resumen.motivosRiesgo,
        }
      : null;

  const esMoral = borrador ? borrador.personKind !== "FISICA" : false;

  return (
    <Modal
      abierto
      titulo={cabecera?.nombre ?? t("expedientes.verExpediente")}
      onCerrar={onCerrar}
      ancho={860}
      pie={
        <>
          <Boton onClick={onCerrar}>{t("ficha.cerrar")}</Boton>
          {puedeGestionar && (
            <Boton
              variante="primario"
              // `cargando` también apaga el botón: el remontaje del padre ya
              // impide arrastrar un borrador de otro expediente, pero
              // recargar DESPUÉS de guardar deja el borrador viejo unos
              // milisegundos y guardar dos veces seguidas pisaría lo que el
              // servidor acaba de devolver.
              disabled={guardando || cargando || !borrador}
              onClick={() => void guardar()}
            >
              {guardando ? t("ficha.guardando") : t("ficha.guardar")}
            </Boton>
          )}
        </>
      }
    >
      {cabecera && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <Pastilla tono={TONO_ESTADO[cabecera.estado]}>
            {PLD_ESTADO_LABELS[cabecera.estado]}
          </Pastilla>
          <Pastilla tono={TONO_RIESGO[cabecera.risk]}>{PLD_RISK_LABELS[cabecera.risk]}</Pastilla>
          {/* El riesgo, en palabras. Una etiqueta de colores sin motivo no
              se puede accionar. */}
          <span style={{ fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5 }}>
            {cabecera.motivos.join(" ")}
          </span>
        </div>
      )}

      <ErrorLinea texto={error} />
      {guardado && !error && <Nota>{t("ficha.guardado")}</Nota>}

      {cargando || !borrador || !expediente ? (
        <Vacio texto={t("bitacora.cargando")} />
      ) : (
        <>
          {/* ── Datos de identificación ── */}
          <Seccion titulo={t("ficha.datos")}>
            <Rejilla min={200}>
              <Campo label={t("ficha.tipoPersona")} htmlFor="pld-tipo">
                <Selector
                  id="pld-tipo"
                  value={borrador.personKind}
                  onChange={(v) =>
                    setBorrador({ ...borrador, personKind: v as PldPersonKind })
                  }
                  options={PLD_PERSON_KINDS.map((k) => ({
                    value: k,
                    label: PLD_PERSON_KIND_LABELS[k],
                  }))}
                />
              </Campo>
              <Campo label={t("ficha.rfc")} htmlFor="pld-rfc">
                <InputTexto
                  id="pld-rfc"
                  mayusculas
                  maxLength={20}
                  value={borrador.rfc}
                  onChange={(v) => setBorrador({ ...borrador, rfc: v })}
                  disabled={!puedeGestionar}
                />
              </Campo>
              {/* La CURP es de personas FÍSICAS. Una sociedad no tiene. */}
              {!esMoral && (
                <Campo label={t("ficha.curp")} htmlFor="pld-curp">
                  <InputTexto
                    id="pld-curp"
                    mayusculas
                    maxLength={20}
                    value={borrador.curp}
                    onChange={(v) => setBorrador({ ...borrador, curp: v })}
                    disabled={!puedeGestionar}
                  />
                </Campo>
              )}
              {!esMoral && (
                <Campo label={t("ficha.nacimiento")} htmlFor="pld-nacimiento">
                  <InputFecha
                    id="pld-nacimiento"
                    value={borrador.birthDate}
                    onChange={(v) => setBorrador({ ...borrador, birthDate: v })}
                    disabled={!puedeGestionar}
                  />
                </Campo>
              )}
              <Campo label={t("ficha.nacionalidad")} htmlFor="pld-nacionalidad">
                <InputTexto
                  id="pld-nacionalidad"
                  maxLength={60}
                  value={borrador.nationality}
                  onChange={(v) => setBorrador({ ...borrador, nationality: v })}
                  disabled={!puedeGestionar}
                />
              </Campo>
              <Campo label={t("ficha.ocupacion")} htmlFor="pld-ocupacion">
                <InputTexto
                  id="pld-ocupacion"
                  maxLength={160}
                  value={borrador.occupation}
                  onChange={(v) => setBorrador({ ...borrador, occupation: v })}
                  disabled={!puedeGestionar}
                />
              </Campo>
            </Rejilla>
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <Campo label={t("ficha.domicilio")} htmlFor="pld-domicilio">
                <AreaTexto
                  id="pld-domicilio"
                  filas={2}
                  maxLength={400}
                  value={borrador.address}
                  onChange={(v) => setBorrador({ ...borrador, address: v })}
                  disabled={!puedeGestionar}
                />
              </Campo>
              <Campo label={t("ficha.notas")} htmlFor="pld-notas">
                <AreaTexto
                  id="pld-notas"
                  filas={2}
                  maxLength={2000}
                  value={borrador.notes}
                  onChange={(v) => setBorrador({ ...borrador, notes: v })}
                  disabled={!puedeGestionar}
                />
              </Campo>
            </div>
            {expediente.reviewedAt && (
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--text-4)" }}>
                {t("ficha.revisadoPor")}: {fmtFecha(expediente.reviewedAt, timeZone, locale)}
                {expediente.reviewedByName ? ` · ${expediente.reviewedByName}` : ""}
              </p>
            )}
          </Seccion>

          {/* ── Semáforo PEP ── */}
          <Seccion titulo={t("ficha.pepTitulo")}>
            {!expediente.pepAskedAt && <AvisoAmbar>{t("ficha.pepSinPreguntar")}</AvisoAmbar>}
            <div style={{ marginTop: expediente.pepAskedAt ? 0 : 12, display: "grid", gap: 12 }}>
              <Campo label={t("ficha.pepPregunta")} htmlFor="pld-pep">
                <Selector
                  id="pld-pep"
                  value={borrador.pep}
                  onChange={(v) => setBorrador({ ...borrador, pep: v as PldPepKind })}
                  options={PLD_PEP_KINDS.map((k) => ({ value: k, label: PLD_PEP_LABELS[k] }))}
                />
              </Campo>
              {/* El detalle solo tiene sentido si la respuesta no es "no". */}
              {borrador.pep !== "NO" && (
                <Campo label={t("ficha.pepDetalle")} htmlFor="pld-pep-detalle">
                  <AreaTexto
                    id="pld-pep-detalle"
                    filas={2}
                    maxLength={800}
                    value={borrador.pepDetail}
                    onChange={(v) => setBorrador({ ...borrador, pepDetail: v })}
                    disabled={!puedeGestionar}
                  />
                </Campo>
              )}
            </div>
          </Seccion>

          {/* ── Beneficiario controlador (solo moral o fideicomiso) ── */}
          {esMoral && (
            <Seccion titulo={t("ficha.beneficiarios")}>
              <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5 }}>
                {t("ficha.beneficiariosAyuda")}
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {borrador.beneficialOwners.map((b, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      border: "1px solid var(--border-soft)",
                      borderRadius: 10,
                      background: "var(--bg-elev-2)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <Rejilla min={150}>
                      <Campo label={t("ficha.beneficiarioNombre")}>
                        <InputTexto
                          value={b.name}
                          maxLength={160}
                          disabled={!puedeGestionar}
                          onChange={(v) => cambiarBeneficiario(i, { name: v })}
                        />
                      </Campo>
                      <Campo label={t("ficha.rfc")}>
                        <InputTexto
                          value={b.rfc ?? ""}
                          mayusculas
                          maxLength={20}
                          disabled={!puedeGestionar}
                          onChange={(v) => cambiarBeneficiario(i, { rfc: v })}
                        />
                      </Campo>
                      <Campo label={t("ficha.beneficiarioPct")}>
                        <InputTexto
                          value={b.pct == null ? "" : String(b.pct)}
                          maxLength={6}
                          disabled={!puedeGestionar}
                          onChange={(v) => {
                            // Se guarda como número o null. Un "" no puede
                            // volverse 0: cero por ciento y "no capturado"
                            // no son lo mismo.
                            const limpio = v.replace(/[^\d.]/g, "");
                            const n = limpio === "" ? null : Number(limpio);
                            cambiarBeneficiario(i, {
                              pct: n != null && Number.isFinite(n) ? Math.min(100, n) : null,
                            });
                          }}
                        />
                      </Campo>
                      <Campo label={t("ficha.beneficiarioPep")} htmlFor={`pld-benef-pep-${i}`}>
                        <Selector
                          id={`pld-benef-pep-${i}`}
                          value={b.pep ?? "NO"}
                          onChange={(v) => cambiarBeneficiario(i, { pep: v as PldPepKind })}
                          options={PLD_PEP_KINDS.map((k) => ({
                            value: k,
                            label: PLD_PEP_LABELS[k],
                          }))}
                        />
                      </Campo>
                    </Rejilla>
                    {puedeGestionar && (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Boton
                          onClick={() =>
                            setBorrador({
                              ...borrador,
                              beneficialOwners: borrador.beneficialOwners.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          {t("ficha.quitar")}
                        </Boton>
                      </div>
                    )}
                  </div>
                ))}
                {borrador.beneficialOwners.length === 0 && (
                  <Vacio texto={t("ficha.sinBeneficiarios")} />
                )}
                {puedeGestionar && borrador.beneficialOwners.length < 20 && (
                  <div>
                    <Boton
                      onClick={() =>
                        setBorrador({
                          ...borrador,
                          beneficialOwners: [
                            ...borrador.beneficialOwners,
                            { name: "", rfc: null, curp: null, pct: null, pep: "NO" },
                          ],
                        })
                      }
                    >
                      {t("ficha.agregarBeneficiario")}
                    </Boton>
                  </div>
                )}
              </div>
            </Seccion>
          )}

          {/* ── Los papeles ── */}
          <Seccion titulo={t("ficha.papeles")}>
            <Papeles
              fileId={fileId}
              documentos={expediente.documents}
              puedeGestionar={puedeGestionar}
              timeZone={timeZone}
              locale={locale}
              t={t}
              onCambio={async () => {
                await cargar();
                onRefrescar();
              }}
            />
          </Seccion>
        </>
      )}
    </Modal>
  );

  function cambiarBeneficiario(i: number, parche: Partial<BeneficiarioControlador>) {
    if (!borrador) return;
    setBorrador({
      ...borrador,
      beneficialOwners: borrador.beneficialOwners.map((b, j) =>
        j === i ? { ...b, ...parche } : b,
      ),
    });
  }
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--text-3)",
          fontWeight: 700,
        }}
      >
        {titulo}
      </h3>
      {children}
    </section>
  );
}

// ── Los papeles de la bóveda ───────────────────────────────────────────

function Papeles({
  fileId,
  documentos,
  puedeGestionar,
  timeZone,
  locale,
  t,
  onCambio,
}: {
  fileId: string;
  documentos: DocumentoRow[];
  puedeGestionar: boolean;
  timeZone: string;
  locale: string;
  t: TFunction;
  onCambio: () => void | Promise<void>;
}) {
  const [kind, setKind] = useState<PldDocKind>("IDENTIFICACION");
  const [nombre, setNombre] = useState("");
  const [expedido, setExpedido] = useState("");
  const [vence, setVence] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function subir() {
    if (!archivo) return;
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", archivo);
      form.append("kind", kind);
      if (nombre.trim()) form.append("name", nombre.trim());
      if (expedido) form.append("issuedAt", expedido);
      if (vence) form.append("expiresAt", vence);

      const res = await fetch(`/api/realty/pld/expedientes/${fileId}/documentos`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return;
      }
      setArchivo(null);
      setNombre("");
      setExpedido("");
      setVence("");
      await onCambio();
    } catch {
      setError(t("errores.generico"));
    } finally {
      setSubiendo(false);
    }
  }

  /**
   * Abrir un papel: la API devuelve una URL FIRMADA de vida corta.
   *
   * 🔴 La pestaña se abre ANTES del await. Un window.open() después de una
   * petición ya no viene de un clic y el navegador lo bloquea como
   * emergente — el usuario vería que "no pasa nada" al pulsar Abrir.
   */
  async function abrir(doc: DocumentoRow) {
    setOcupado(doc.id);
    setError(null);
    const ventana = window.open("", "_blank", "noopener,noreferrer");
    try {
      const res = await fetch(`/api/realty/pld/documentos/${doc.id}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) {
        ventana?.close();
        setError(json.error || t("errores.generico"));
        return;
      }
      if (ventana) ventana.location.href = json.url;
      else window.location.href = json.url;
    } catch {
      ventana?.close();
      setError(t("errores.generico"));
    } finally {
      setOcupado(null);
    }
  }

  async function archivar(doc: DocumentoRow, activar: boolean) {
    setOcupado(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/realty/pld/documentos/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archivar: activar }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || t("errores.generico"));
        return;
      }
      await onCambio();
    } catch {
      setError(t("errores.generico"));
    } finally {
      setOcupado(null);
    }
  }

  async function borrar(doc: DocumentoRow) {
    setOcupado(doc.id);
    setError(null);
    try {
      const res = await fetch(`/api/realty/pld/documentos/${doc.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // El 409 de retención trae su propio mensaje con la fecha exacta:
        // se enseña tal cual en vez de un "algo salió mal".
        setError(json.error || t("errores.generico"));
        return;
      }
      await onCambio();
    } catch {
      setError(t("errores.generico"));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Nota>{LEYENDA_BOVEDA}</Nota>
      <ErrorLinea texto={error} />

      {documentos.length === 0 ? (
        <Vacio texto={t("ficha.sinPapeles")} />
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {documentos.map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                background: d.archivedAt ? "var(--bg-elev-2)" : "var(--bg)",
                opacity: d.archivedAt ? 0.7 : 1,
              }}
            >
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                    {PLD_DOC_KIND_LABELS[d.kind]}
                  </span>
                  {d.archivedAt && <Pastilla tono="neutral">{t("ficha.archivado")}</Pastilla>}
                  {d.vencido && !d.archivedAt && (
                    <Pastilla tono="peligro">{t("expedientes.vencidos")}</Pastilla>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 3, lineHeight: 1.5 }}>
                  {d.name} · {fmtBytes(d.bytes)}
                  {d.expiresAt ? ` · ${t("ficha.venceEl")} ${fmtFecha(d.expiresAt, timeZone, locale)}` : ""}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 2 }}>
                  {t("ficha.conservarHasta")} {fmtFecha(d.retainUntil, timeZone, locale)}
                  {d.uploadedByName ? ` · ${d.uploadedByName}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Boton
                  icon={<ExternalLink size={13} />}
                  disabled={ocupado === d.id}
                  onClick={() => void abrir(d)}
                >
                  {t("ficha.abrir")}
                </Boton>
                {puedeGestionar && (
                  <Boton
                    icon={d.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    disabled={ocupado === d.id}
                    onClick={() => void archivar(d, !d.archivedAt)}
                  >
                    {d.archivedAt ? t("ficha.desarchivar") : t("ficha.archivar")}
                  </Boton>
                )}
                {/* Solo cuando la ley ya lo permite. El corte de verdad lo
                    hace la API: esto es para no ofrecer lo imposible. */}
                {puedeGestionar && d.puedeBorrarse && (
                  <Boton
                    icon={<Trash2 size={13} />}
                    disabled={ocupado === d.id}
                    onClick={() => void borrar(d)}
                  >
                    {t("ficha.borrar")}
                  </Boton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {puedeGestionar && (
        <div
          style={{
            padding: 12,
            border: "1px dashed var(--border-soft)",
            borderRadius: 10,
            display: "grid",
            gap: 12,
          }}
        >
          <Rejilla min={170}>
            <Campo label={t("ficha.tipoDocumento")} htmlFor="pld-doc-kind">
              <Selector
                id="pld-doc-kind"
                value={kind}
                onChange={(v) => setKind(v as PldDocKind)}
                options={PLD_DOC_KIND_LIST.map((k) => ({
                  value: k,
                  label: PLD_DOC_KIND_LABELS[k],
                }))}
              />
            </Campo>
            <Campo label={t("ficha.expedidoEl")} htmlFor="pld-doc-expedido">
              <InputFecha id="pld-doc-expedido" value={expedido} onChange={setExpedido} />
            </Campo>
            <Campo
              label={t("ficha.venceEl")}
              htmlFor="pld-doc-vence"
              hint={t("ficha.venceAyuda")}
            >
              <InputFecha id="pld-doc-vence" value={vence} onChange={setVence} />
            </Campo>
          </Rejilla>
          <Campo label={t("ficha.nombreDocumento")} htmlFor="pld-doc-nombre">
            <InputTexto id="pld-doc-nombre" maxLength={160} value={nombre} onChange={setNombre} />
          </Campo>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "inherit" }}
            />
            <Boton
              variante="primario"
              icon={<Upload size={14} />}
              disabled={!archivo || subiendo}
              onClick={() => void subir()}
            >
              {subiendo ? t("ficha.subiendo") : t("ficha.subir")}
            </Boton>
          </div>
        </div>
      )}
    </div>
  );
}
