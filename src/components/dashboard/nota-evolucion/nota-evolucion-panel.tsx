"use client";

// Nota de evolución (documento) en la ficha del paciente: la LISTA de las notas
// que ya tiene y, desde ahí mismo, la creación de una nueva. Rafael: «una vez
// creada una nota van a quedar en listado en su página, ahí mismo donde se
// crean más». Una sola pantalla con cuatro vistas, no cuatro pantallas.
//
// Es un camino nuevo AL LADO de la nota de siempre (pestaña «Nueva consulta»,
// sobre medical_records). No la sustituye ni la lee.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Bold, FileText, Heading2, Italic, List, ListOrdered, Loader2, PenLine, Plus, Underline } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvisoDatosFaltantes } from "@/components/dashboard/documentos-paciente/aviso-datos-faltantes";
import {
  DocumentoHoja, DocumentoMesa, DocumentoRaiz, clasesDocumento,
} from "@/components/dashboard/documentos-paciente/documento-hoja";
import { NotaVisor } from "./nota-documento";
import type { NotaCompleta, NotaResumen, PlantillaNota, PreviewNota } from "./tipos";

type Vista =
  | { tipo: "lista" }
  | { tipo: "elegir" }
  | { tipo: "editar"; hoja: PreviewNota; notaId: string | null }
  | { tipo: "leer"; nota: NotaCompleta };

interface Props {
  patientId: string;
  currentUserId: string;
  /** Permiso "medicalRecord.edit", resuelto en el server. La API lo revalida. */
  canWrite: boolean;
}

/** El 403 se distingue para decirlo con palabras y no con la clave del permiso. */
class SinPermiso extends Error {}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (res.status === 403 && !(json && json.code)) throw new SinPermiso();
  if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
  return json as T;
}

const conJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function NotaEvolucionPanel({ patientId, currentUserId, canWrite }: Props) {
  const t = useT();
  const [notas, setNotas] = useState<NotaResumen[] | null>(null);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setErrorLista(null);
    try {
      setNotas(await pedir<NotaResumen[]>(`/api/patient-documents?patientId=${encodeURIComponent(patientId)}`));
    } catch (err) {
      if (err instanceof SinPermiso) setSinPermiso(true);
      else setErrorLista(err instanceof Error ? err.message : String(err));
    }
  }, [patientId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const volver = useCallback(() => setVista({ tipo: "lista" }), []);

  async function abrir(n: NotaResumen) {
    setOcupado(true);
    try {
      const nota = await pedir<NotaCompleta>(`/api/patient-documents/${n.id}`);
      // Un borrador propio se sigue escribiendo; todo lo demás se lee.
      if (nota.status === "DRAFT" && canWrite && nota.doctorId === currentUserId) {
        setVista({
          tipo: "editar",
          notaId: nota.id,
          hoja: { templateId: "", title: nota.title, body: nota.body, encabezado: nota.encabezado, faltantes: nota.faltantes },
        });
      } else {
        setVista({ tipo: "leer", nota });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function elegir(p: PlantillaNota) {
    setOcupado(true);
    try {
      const hoja = await pedir<PreviewNota>(
        `/api/patient-documents/preview?patientId=${encodeURIComponent(patientId)}&templateId=${encodeURIComponent(p.id)}`,
      );
      setVista({ tipo: "editar", hoja, notaId: null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  async function guardar(hoja: PreviewNota, notaId: string | null, body: string, firmar: boolean) {
    setOcupado(true);
    try {
      const nota = notaId
        ? firmar
          ? await pedir<NotaCompleta>(`/api/patient-documents/${notaId}/sign`, conJson("POST", { body }))
          : await pedir<NotaCompleta>(`/api/patient-documents/${notaId}`, conJson("PATCH", { body }))
        : await pedir<NotaCompleta>(
            "/api/patient-documents",
            conJson("POST", { patientId, templateId: hoja.templateId, body, sign: firmar }),
          );
      toast.success(t(firmar ? "notaEvolucionDoc.toast.signed" : "notaEvolucionDoc.toast.draftSaved"));
      await cargar();
      setVista(firmar ? { tipo: "leer", nota } : { tipo: "lista" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setOcupado(false);
    }
  }

  if (vista.tipo === "elegir") {
    return <ElegirPlantilla onElegir={elegir} onVolver={volver} ocupado={ocupado} />;
  }

  if (vista.tipo === "editar") {
    return (
      <Editor
        key={vista.notaId ?? `nueva-${vista.hoja.templateId}`}
        hoja={vista.hoja}
        patientId={patientId}
        ocupado={ocupado}
        onVolver={volver}
        onGuardar={(body, firmar) => guardar(vista.hoja, vista.notaId, body, firmar)}
      />
    );
  }

  if (vista.tipo === "leer") {
    return <NotaVisor nota={vista.nota} canWrite={canWrite} inicio={<Volver onClick={volver} />} />;
  }

  return (
    <CardNew
      title={t("notaEvolucionDoc.title")}
      sub={t("notaEvolucionDoc.subtitle")}
      action={
        canWrite ? (
          <ButtonNew variant="primary" size="sm" onClick={() => setVista({ tipo: "elegir" })}>
            <Plus size={14} aria-hidden /> {t("notaEvolucionDoc.new")}
          </ButtonNew>
        ) : undefined
      }
    >
      {sinPermiso ? (
        <p className="py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>{t("notaEvolucionDoc.list.noPermission")}</p>
      ) : errorLista ? (
        <div className="space-y-2 text-sm">
          <p style={{ color: "var(--text-2)" }}>{t("notaEvolucionDoc.list.error")}</p>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>{errorLista}</p>
          <ButtonNew size="sm" onClick={() => void cargar()}>{t("notaEvolucionDoc.list.retry")}</ButtonNew>
        </div>
      ) : notas === null ? (
        <Cargando />
      ) : notas.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: "var(--text-3)" }}>
          {t(canWrite ? "notaEvolucionDoc.list.empty" : "notaEvolucionDoc.list.emptyReadOnly")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {notas.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void abrir(n)}
                className="flex w-full items-center gap-3 py-3 text-left hover:opacity-80 disabled:opacity-60"
              >
                <FileText size={16} aria-hidden style={{ color: "var(--text-3)" }} className="flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{n.title}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--text-3)" }}>
                    {n.fecha}
                    {n.doctorNombre ? ` · ${n.doctorNombre}` : ""}
                  </span>
                </span>
                <BadgeNew tone={n.status === "SIGNED" ? "success" : "warning"}>
                  {t(n.status === "SIGNED" ? "notaEvolucionDoc.status.signed" : "notaEvolucionDoc.status.draft")}
                </BadgeNew>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CardNew>
  );
}

function Volver({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <ButtonNew variant="ghost" size="sm" onClick={onClick}>
      <ArrowLeft size={14} aria-hidden /> {t("notaEvolucionDoc.back")}
    </ButtonNew>
  );
}

function Cargando() {
  return (
    <div className="flex justify-center py-6" style={{ color: "var(--text-3)" }}>
      <Loader2 size={18} className="animate-spin" aria-hidden />
    </div>
  );
}

function ElegirPlantilla({
  onElegir, onVolver, ocupado,
}: { onElegir: (p: PlantillaNota) => void; onVolver: () => void; ocupado: boolean }) {
  const t = useT();
  const [plantillas, setPlantillas] = useState<PlantillaNota[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    pedir<PlantillaNota[]>("/api/patient-documents/templates")
      .then((p) => vivo && setPlantillas(p))
      .catch((err) => vivo && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="space-y-3">
      <Volver onClick={onVolver} />
      <CardNew title={t("notaEvolucionDoc.pick.title")} sub={t("notaEvolucionDoc.pick.subtitle")}>
        {error ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{error}</p>
        ) : plantillas === null ? (
          <Cargando />
        ) : plantillas.length === 0 ? (
          <div className="space-y-2 py-4 text-center text-sm" style={{ color: "var(--text-3)" }}>
            <p>{t("notaEvolucionDoc.pick.empty")}</p>
            <Link href="/dashboard/plantillas" className="font-medium underline" style={{ color: "var(--brand)" }}>
              {t("notaEvolucionDoc.pick.goToTemplates")}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {plantillas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => onElegir(p)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border p-3 text-left text-sm font-medium text-foreground hover:opacity-80 disabled:opacity-60"
                >
                  <FileText size={15} aria-hidden style={{ color: "var(--text-3)" }} />
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardNew>
    </div>
  );
}

function Editor({
  hoja, patientId, ocupado, onVolver, onGuardar,
}: {
  hoja: PreviewNota;
  patientId: string;
  ocupado: boolean;
  onVolver: () => void;
  onGuardar: (body: string, firmar: boolean) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const caja = useRef<HTMLDivElement>(null);
  const tocado = useRef(false);

  // Lo tecleado vive solo en el DOM: salir sin guardar lo pierde. Se pregunta.
  const salir = async () => {
    if (tocado.current) {
      const ok = await confirm({
        title: t("notaEvolucionDoc.editor.leaveTitle"),
        description: t("notaEvolucionDoc.editor.leaveBody"),
      });
      if (!ok) return;
    }
    onVolver();
  };

  // El HTML se siembra UNA vez (el `key` del padre remonta el editor si cambia
  // la hoja). No va por `dangerouslySetInnerHTML` porque React lo reescribiría
  // en cada render y se comería lo tecleado. `hoja.body` viene ya saneado del
  // servidor, y lo que salga de aquí se vuelve a sanear allí al guardar.
  useEffect(() => {
    if (caja.current) caja.current.innerHTML = hoja.body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviar = (firmar: boolean) => {
    const body = caja.current?.innerHTML ?? "";
    if (!(caja.current?.textContent ?? "").trim()) {
      toast.error(t("notaEvolucionDoc.editor.empty"));
      return;
    }
    onGuardar(body, firmar);
  };

  // Formato con los comandos del navegador: producen justo las etiquetas de la
  // lista blanca del saneado (b, i, u, listas, h2). Lo que no lo sea se cae allí.
  const formato = (comando: string, valor?: string) => {
    caja.current?.focus();
    document.execCommand(comando, false, valor);
    tocado.current = true;
  };
  const HERRAMIENTAS: { clave: string; icono: typeof Bold; comando: string; valor?: string }[] = [
    { clave: "bold", icono: Bold, comando: "bold" },
    { clave: "italic", icono: Italic, comando: "italic" },
    { clave: "underline", icono: Underline, comando: "underline" },
    { clave: "heading", icono: Heading2, comando: "formatBlock", valor: "h2" },
    { clave: "list", icono: List, comando: "insertUnorderedList" },
    { clave: "numbered", icono: ListOrdered, comando: "insertOrderedList" },
  ];

  return (
    <DocumentoRaiz className="space-y-3">
      {/* El aviso va ARRIBA y fuera de la hoja: se lee antes de escribir, no al firmar. */}
      <AvisoDatosFaltantes faltantes={hoja.faltantes} patientId={patientId} documento="nota" />
      <DocumentoMesa>
        <div className={clasesDocumento.barra}>
          <Volver onClick={() => void salir()} />
          <div className={clasesDocumento.barraAcciones}>
            <ButtonNew size="sm" disabled={ocupado} onClick={() => enviar(false)}>
              {t("notaEvolucionDoc.editor.saveDraft")}
            </ButtonNew>
            <ButtonNew variant="primary" size="sm" disabled={ocupado} onClick={() => enviar(true)}>
              {ocupado ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <PenLine size={13} aria-hidden />}{" "}
              {t("notaEvolucionDoc.editor.sign")}
            </ButtonNew>
          </div>
        </div>
        <DocumentoHoja encabezado={hoja.encabezado} titulo={hoja.title} tipo={t("notaEvolucionDoc.kind")} firmado={null}>
          <div className={clasesDocumento.herramientas} role="toolbar" aria-label={t("notaEvolucionDoc.editor.toolbar")}>
            {HERRAMIENTAS.map((h) => (
              <button
                key={h.clave}
                type="button"
                className={clasesDocumento.herramienta}
                disabled={ocupado}
                title={t(`notaEvolucionDoc.editor.format.${h.clave}`)}
                aria-label={t(`notaEvolucionDoc.editor.format.${h.clave}`)}
                // mousedown y no click: un click le quita el foco (y la selección) al texto.
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  formato(h.comando, h.valor);
                }}
              >
                <h.icono size={16} aria-hidden />
              </button>
            ))}
          </div>
          <div
            ref={caja}
            contentEditable={!ocupado}
            suppressContentEditableWarning
            onInput={() => {
              tocado.current = true;
            }}
            role="textbox"
            aria-multiline="true"
            aria-label={t("notaEvolucionDoc.editor.label")}
            className={`${clasesDocumento.cuerpo} ${clasesDocumento.cuerpoEditable}`}
          />
          <p className={clasesDocumento.pista}>{t("notaEvolucionDoc.editor.headerHint")}</p>
          <p className={clasesDocumento.pista}>{t("notaEvolucionDoc.editor.signHint")}</p>
        </DocumentoHoja>
      </DocumentoMesa>
    </DocumentoRaiz>
  );
}
