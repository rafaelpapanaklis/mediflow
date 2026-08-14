"use client";
// Página PÚBLICA de firma del consentimiento informado.
//
// Se abre desde la liga que la clínica le manda al paciente por WhatsApp, o en
// la tableta del consultorio con el paciente delante. Sin sesión: el token de
// la URL es la credencial.
//
// El flujo tiene tres momentos y por eso la pantalla los rotula arriba:
//   1. LEER — el texto íntegro. El GET marca `viewedAt`: un consentimiento que
//      nadie abrió antes de firmar no es informado.
//   2. FIRMAR — casilla de aceptación + firma. La casilla y el trazo son dos
//      actos distintos a propósito.
//   3. TESTIGOS — sólo después de firmar y sólo si están presentes (flujo de
//      tableta). Es OPCIONAL: quien firma desde su casa no tiene testigos y no
//      se le bloquea nada; el panel muestra "Testigos 0/2".
//
// MAQUETACIÓN: Tailwind con la paleta del producto (violeta sobre slate-50),
// misma familia visual que /presupuesto/[token] — es la otra pantalla que ve el
// paciente y las dos tienen que parecer de la misma clínica. Antes esto iba con
// `style={{}}` en línea y `system-ui`, y se notaba.
//
// La carta NO se pinta como un bloque `pre-wrap`: `parseConsentText` la parte en
// secciones tituladas. El texto NO se transforma —lo que se firma es el mismo
// string que guardó el servidor—, solo se presenta legible en un teléfono.
//
// LÓGICA INTACTA: mismos endpoints públicos, mismas validaciones, mismo
// SignaturePad con theme="light".

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle, CalendarClock, Check, CheckCircle2, Download, FileText,
  Loader2, PenLine, ShieldCheck, UserCheck, Users, XCircle,
} from "lucide-react";
import { SignaturePad } from "@/components/ui/signature-pad";
import { parseConsentText, splitConsentBody } from "@/lib/consent/render";

interface ConsentPublicData {
  procedure: string;
  content: string;
  expiresAt: string;
  signedAt: string | null;
  signatureUrl: string | null;
  signerName: string | null;
  signerRelation: string | null;
  revokedAt: string | null;
  witness1Name: string | null;
  witness1SignedAt: string | null;
  witness2Name: string | null;
  witness2SignedAt: string | null;
  patient: { firstName: string; lastName: string } | null;
  clinic: { name: string; phone: string | null; logoUrl: string | null } | null;
}

/** Por qué no se puede mostrar el documento. Cambia el icono y el texto de ayuda. */
type LoadErrorKind = "expired" | "missing" | "generic";

export default function ConsentPage({ params }: { params: { token: string } }) {
  const [form, setForm] = useState<ConsentPublicData | null>(null);
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<LoadErrorKind>("generic");
  const [signing, setSigning] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent/public/${params.token}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        // 410 = la liga caducó (se puede pedir una nueva a la clínica);
        // 404 = no existe. Son dos mensajes distintos para el paciente.
        setErrorKind(res.status === 410 ? "expired" : res.status === 404 ? "missing" : "generic");
        setError(data.error ?? "No se pudo cargar el formulario");
        return;
      }
      setForm(data);
    } catch {
      setErrorKind("generic");
      setError("Error al cargar el formulario");
    }
  }, [params.token]);

  useEffect(() => { load(); }, [load]);

  async function sign() {
    if (!signature) { setMsg("Dibuja tu firma en el recuadro."); return; }
    if (!agreed) { setMsg("Marca la casilla de aceptación antes de firmar."); return; }
    setSigning(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/consent/public/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo registrar la firma.");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  if (error) {
    const Icon = errorKind === "expired" ? CalendarClock : AlertCircle;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white border border-slate-200 shadow-sm">
            <Icon size={26} className={errorKind === "expired" ? "text-amber-500" : "text-red-500"} />
          </span>
          <h1 className="mt-4 text-lg font-bold text-slate-800">
            {errorKind === "expired" ? "Este enlace ya venció" : "Documento no disponible"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{error}</p>
          <p className="mt-3 text-xs text-slate-400 leading-relaxed">
            {errorKind === "expired"
              ? "Pídele a tu clínica que te mande una liga nueva: tu carta sigue guardada, solo caducó el enlace para firmarla."
              : "Comprueba que abriste la liga completa que te envió tu clínica."}
          </p>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-violet-600" size={32} aria-label="Cargando" />
      </div>
    );
  }

  const patientName = `${form.patient?.firstName ?? ""} ${form.patient?.lastName ?? ""}`.trim();
  const isRepresented = Boolean(form.signerName);
  const signerLabel = isRepresented ? form.signerName : patientName;
  const isSigned = Boolean(form.signedAt);
  const isRevoked = Boolean(form.revokedAt);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 py-3.5 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {form.clinic?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.clinic.logoUrl}
              alt={form.clinic?.name ?? ""}
              className="h-9 w-9 rounded-lg object-contain bg-white border border-slate-200"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 border border-violet-100">
              <FileText size={17} className="text-violet-600" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-800 truncate">{form.clinic?.name}</h1>
            <p className="text-xs text-slate-500">Carta de consentimiento informado</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4 pb-16">
        {!isRevoked && <StepBar signed={isSigned} />}

        {isRevoked && (
          <section className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="flex items-center gap-2">
              <XCircle size={17} className="text-red-600 shrink-0" />
              <h2 className="text-sm font-bold text-red-800">Consentimiento revocado</h2>
            </div>
            <p className="mt-1.5 text-xs text-red-700 leading-relaxed">
              Este consentimiento fue revocado el {fmtDateTime(form.revokedAt)}. Si tienes dudas,
              comunícate con {form.clinic?.name ?? "la clínica"}
              {form.clinic?.phone ? ` al ${form.clinic.phone}` : ""}.
            </p>
          </section>
        )}

        {isSigned && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={17} className="text-emerald-600 shrink-0" />
              <h2 className="text-sm font-bold text-emerald-800">Consentimiento firmado</h2>
            </div>
            <p className="mt-1.5 text-xs text-emerald-800 leading-relaxed">
              Firmado por <strong>{signerLabel}</strong> el {fmtDateTime(form.signedAt)}
              {isRepresented ? ", como representante legal del paciente" : ""}.
            </p>
            <a
              href={`/api/consent/public/${params.token}/pdf`}
              className="mt-3 inline-flex items-center justify-center gap-2 w-full rounded-xl bg-white border border-emerald-300 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <Download size={15} /> Descargar mi carta (PDF)
            </a>
          </section>
        )}

        {/* Encabezado del documento */}
        <section className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Procedimiento</p>
          <p className="text-sm font-bold text-violet-900">{form.procedure}</p>
          <p className="mt-1 text-xs text-violet-800">
            Paciente: <strong className="font-semibold">{patientName}</strong>
          </p>
        </section>

        {isRepresented && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
            <UserCheck size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              Firma <strong>{form.signerName}</strong> en nombre del paciente, en calidad de
              representante legal{form.signerRelation ? ` (${form.signerRelation})` : ""}.
            </p>
          </section>
        )}

        {/* La carta */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <ConsentLetter content={form.content} />
        </section>

        {/* Firma del paciente / representante */}
        {!isSigned && !isRevoked ? (
          <>
            <section className="rounded-xl border-2 border-violet-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 shrink-0">
                  <PenLine size={16} className="text-violet-700" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">
                    {isRepresented ? "Firma del representante legal" : "Firma del paciente"}
                  </h2>
                  <p className="text-xs text-slate-500">{signerLabel}</p>
                </div>
              </div>

              <p className="mt-3 mb-2 text-sm font-semibold text-violet-800">
                Firma aquí con tu dedo o stylus
              </p>
              <SignaturePad
                theme="light"
                width={640}
                height={190}
                onChange={setSignature}
                ariaLabel="Recuadro para firmar"
                hintLabel="Traza tu firma dentro del recuadro"
              />
            </section>

            <label
              htmlFor="agree"
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 cursor-pointer"
            >
              <input
                type="checkbox"
                id="agree"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-violet-600"
              />
              <span className="text-xs text-slate-700 leading-relaxed">
                He leído y entendido esta carta de consentimiento informado, pude preguntar lo que
                quise y se resolvieron mis dudas. Acepto de forma libre y voluntaria el tratamiento
                descrito y confirmo que la información que di sobre el estado de salud es verídica y
                completa.
              </span>
            </label>

            {msg ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
                <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-red-700">{msg}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={sign}
              disabled={signing || !agreed || !signature}
              className={`w-full rounded-2xl py-4 text-base font-bold transition-colors flex items-center justify-center gap-2 ${
                agreed && signature && !signing
                  ? "bg-violet-600 text-white hover:bg-violet-700"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              {signing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {signing ? "Firmando…" : "Firmar consentimiento"}
            </button>

            <p className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-relaxed">
              <ShieldCheck size={13} className="shrink-0 mt-0.5" />
              <span>
                Al firmar se registran la fecha, la hora y el dispositivo desde el que firmas, como
                evidencia de la firma electrónica conforme a los arts. 89 y 89 bis del Código de
                Comercio y 210-A del CFPC.
              </span>
            </p>
          </>
        ) : null}

        {/* Testigos — sólo tras la firma y sólo si están presentes. */}
        {isSigned && !isRevoked ? (
          <WitnessSection token={params.token} form={form} onSaved={load} />
        ) : null}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicador de pasos
// ---------------------------------------------------------------------------

/**
 * Leer → Firmar → Testigos. Sirve para lo mismo en los dos escenarios: al
 * paciente que abre la liga en su casa le dice cuánto falta, y al equipo que le
 * pasa la tableta le recuerda que después de la firma queda el paso de testigos
 * (opcional, pero es el que siempre se olvida cuando hay alguien acompañando).
 */
function StepBar({ signed }: { signed: boolean }) {
  // "Leer" se marca hecho en cuanto la pantalla carga porque el GET ya escribió
  // `viewedAt`: para el expediente el documento YA se abrió. Solo un paso puede
  // ser el actual (aria-current="step" duplicado le mentiría a un lector de
  // pantalla), y ese es firmar mientras no haya firma, o testigos después.
  const steps = [
    { label: "Leer", icon: FileText, done: true, current: false },
    { label: "Firmar", icon: PenLine, done: signed, current: !signed },
    { label: "Testigos", icon: Users, done: false, current: signed },
  ];
  return (
    <ol className="flex items-stretch gap-1.5">
      {steps.map((s, i) => {
        const Icon = s.done ? Check : s.icon;
        const tone = s.done
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : s.current
            ? "bg-violet-600 border-violet-600 text-white"
            : "bg-white border-slate-200 text-slate-400";
        return (
          <li
            key={s.label}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-bold ${tone}`}
            aria-current={s.current ? "step" : undefined}
          >
            <Icon size={13} className="shrink-0" />
            <span className="truncate">
              {i + 1}. {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// La carta, en secciones legibles
// ---------------------------------------------------------------------------

function ConsentLetter({ content }: { content: string }) {
  const doc = parseConsentText(content);

  return (
    <article className="text-[13px] leading-relaxed text-slate-600">
      {doc.title ? (
        <h2 className="text-center text-sm font-bold text-slate-800">{doc.title}</h2>
      ) : null}

      {doc.preamble ? (
        <div
          className={`whitespace-pre-wrap text-xs text-slate-500 ${doc.title ? "mt-2" : ""} ${
            doc.sections.length ? "border-b border-slate-100 pb-3" : ""
          }`}
        >
          {doc.preamble}
        </div>
      ) : null}

      {doc.sections.map((section, i) => (
        <section key={`${section.number ?? "s"}-${i}`} className="mt-4">
          <h3 className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-700">
            {section.number != null ? (
              <span className="tabular-nums text-slate-400">{section.number}.</span>
            ) : null}
            {section.title}
          </h3>
          {splitConsentBody(section.body).map((block, bi) =>
            block.kind === "bullets" ? (
              <ul key={bi} className="mb-2 list-disc space-y-1 pl-5 marker:text-violet-400">
                {block.lines.map((line, li) => (
                  <li key={li}>{line}</li>
                ))}
              </ul>
            ) : (
              <div key={bi} className="mb-2 space-y-0.5">
                {block.lines.map((line, li) => (
                  <p key={li}>{line}</p>
                ))}
              </div>
            ),
          )}
        </section>
      ))}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Testigos (opcional, hasta dos)
// ---------------------------------------------------------------------------

function WitnessSection({
  token, form, onSaved,
}: {
  token: string;
  form: ConsentPublicData;
  onSaved: () => Promise<void> | void;
}) {
  // Cerrado por defecto: el caso común es el paciente firmando desde su casa,
  // donde no hay testigos que capturar y una sección abierta parecería un paso
  // pendiente.
  const [open, setOpen] = useState(false);
  const done1 = Boolean(form.witness1SignedAt);
  const done2 = Boolean(form.witness2SignedAt);
  const bothDone = done1 && done2;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 shrink-0">
            <Users size={16} className="text-slate-500" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Testigos (opcional)</h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              Si hubo personas presentes cuando firmaste, pueden dejar aquí su nombre y su firma.
            </p>
          </div>
        </div>
        {!bothDone ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-bold text-violet-700 hover:text-violet-800"
          >
            {open ? "Ocultar" : "Agregar testigo"}
          </button>
        ) : null}
      </div>

      {done1 ? <WitnessDone n={1} name={form.witness1Name} at={form.witness1SignedAt} /> : null}
      {done2 ? <WitnessDone n={2} name={form.witness2Name} at={form.witness2SignedAt} /> : null}

      {open && !bothDone ? (
        <WitnessForm token={token} slot={done1 ? 2 : 1} onSaved={async () => { setOpen(false); await onSaved(); }} />
      ) : null}
    </section>
  );
}

function WitnessDone({ n, name, at }: { n: number; name: string | null; at: string | null }) {
  return (
    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700">
      <CheckCircle2 size={14} className="shrink-0" />
      <span>
        Testigo {n}: <strong>{name}</strong> · {fmtDateTime(at)}
      </span>
    </p>
  );
}

function WitnessForm({
  token, slot, onSaved,
}: {
  token: string;
  slot: 1 | 2;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setMsg("Escribe el nombre del testigo."); return; }
    if (!signature) { setMsg("El testigo debe firmar en el recuadro."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/consent/public/${token}/witness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ witness: slot, name: name.trim(), signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo guardar la firma del testigo.");
      await onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3.5 border-t border-slate-200 pt-3.5">
      <label
        htmlFor={`witness-${slot}`}
        className="mb-1.5 block text-xs font-bold text-slate-600"
      >
        Nombre completo del testigo {slot}
      </label>
      <input
        id={`witness-${slot}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre y apellidos"
        className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
      />
      <SignaturePad
        theme="light"
        width={640}
        height={170}
        onChange={setSignature}
        ariaLabel={`Recuadro de firma del testigo ${slot}`}
        hintLabel="Firma del testigo"
      />
      {msg ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-red-700">
          <AlertCircle size={14} className="shrink-0" /> {msg}
        </p>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-colors ${
          busy ? "bg-slate-200 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-800"
        }`}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        {busy ? "Guardando…" : `Guardar firma del testigo ${slot}`}
      </button>
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
