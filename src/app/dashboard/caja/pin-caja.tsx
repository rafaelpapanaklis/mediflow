"use client";
// Caja — lo del PIN que no es abrir, cortar ni retirar:
//   · CampoPin       el cuadro de 6 dígitos, igual en todos los modales.
//   · OlvidePin      «¿Olvidaste tu PIN?»: solo texto, sin endpoint.
//   · ModalCambiarPin «Cambiar mi PIN» (o «Crear mi PIN» si aún no tiene).
// Textos en `cashRegister.pin.*` (es/en).
import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";
import { claveDelTextoOlvidePin, cuerpoDePinNuevo, soloDigitosDelPin, validarCambioDePin, type MotivoPinRechazado } from "./pin-doble";

export function CampoPin({
  etiqueta, value, onChange, autoFocus, fuente, requerido = true, icono = false,
}: {
  etiqueta: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  /** La familia tipográfica del cuadro: la pantalla de siempre la pasa en monoespaciada; con el rediseño, `undefined`. */
  fuente?: string;
  requerido?: boolean;
  icono?: boolean;
}) {
  return (
    <div className="field-new" style={{ marginBottom: 14 }}>
      <label className="field-new__label" style={icono ? { display: "flex", alignItems: "center", gap: 6 } : undefined}>
        {icono && <KeyRound size={13} strokeWidth={1.75} />} {etiqueta}{requerido && <> <span className="req">*</span></>}
      </label>
      <input type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} className="input-new"
        autoFocus={autoFocus} autoComplete="off"
        style={{ fontFamily: fuente, fontVariantNumeric: "tabular-nums", letterSpacing: "0.25em", textAlign: "center", fontSize: 14 }}
        placeholder="••••••" value={value}
        onChange={e => onChange(soloDigitosDelPin(e.target.value))} />
    </div>
  );
}

/**
 * «¿Olvidaste tu PIN?» — junto a donde se pide el PIN. Solo explica; no llama a nada.
 * `esSuperAdmin` viene del servidor: al dueño le dice que lo restablezca él mismo.
 */
export function OlvidePin({ esSuperAdmin = false }: { esSuperAdmin?: boolean }) {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ marginTop: -6, marginBottom: 14, textAlign: "center" }} data-olvide-pin>
      <button type="button" onClick={() => setAbierto(v => !v)} aria-expanded={abierto}
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontSize: 12, color: "var(--brand)", textDecoration: "underline" }}>
        {t("cashRegister.pin.olvidaste")}
      </button>
      {abierto && (
        <p role="status" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-2)" }}>
          {t(claveDelTextoOlvidePin(esSuperAdmin))}
        </p>
      )}
    </div>
  );
}

/** El mensaje de cada motivo de rechazo del PIN doble. */
export function useMensajePin() {
  const t = useT();
  return (m: MotivoPinRechazado) =>
    m === "no-coinciden" ? t("cashRegister.pin.noCoinciden") : t("cashRegister.pin.seisDigitos");
}

export function ModalCambiarPin({
  tienePin, rediseno, esSuperAdmin = false, onClose, onGuardado,
}: {
  tienePin: boolean;
  rediseno?: boolean;
  /** Quien lo abre es el dueño (SUPER_ADMIN): cambia el texto de «¿Olvidaste tu PIN?». */
  esSuperAdmin?: boolean;
  onClose: () => void;
  /** El servidor aceptó el PIN nuevo. */
  onGuardado: () => void;
}) {
  const t = useT();
  const mensaje = useMensajePin();
  const [actual, setActual] = useState("");
  const [nuevo, setNuevo] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Misma regla que los demás cuadros de PIN: monoespaciada solo con el rediseño apagado.
  const fuente = rediseno ? undefined : "var(--font-mono, monospace)";

  async function guardar() {
    const r = validarCambioDePin({ tieneActual: tienePin, actual, nuevo, confirmacion });
    if (r.ok === false) {
      // No coinciden / no son 6 dígitos: se avisa y NO se manda nada.
      setError(r.motivo === "actual-formato" ? t("cashRegister.pin.actualSeisDigitos") : mensaje(r.motivo));
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const res = await fetch("/api/caja/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoDePinNuevo({ pin: r.pin, confirmacion, currentPin: r.currentPin })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || t("cashRegister.errorGeneric")); return; }
      toast.success(tienePin ? t("cashRegister.pin.cambiado") : t("cashRegister.pin.creado"));
      onGuardado();
    } catch {
      setError(t("cashRegister.errorGeneric"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !guardando && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="caja-pin-titulo" onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title" id="caja-pin-titulo">{tienePin ? t("cashRegister.pin.cambiarTitulo") : t("cashRegister.pin.crearTitulo")}</div>
          <button onClick={onClose} type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}><X size={16} strokeWidth={1.75} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); void guardar(); }}>
          <div className="modal__body">
            {!tienePin && (
              <p style={{ color: "var(--text-3)", fontSize: 12, margin: "0 0 12px" }}>{t("cashRegister.pin.crearAyuda")}</p>
            )}
            {tienePin && <CampoPin etiqueta={t("cashRegister.pin.actual")} value={actual} onChange={setActual} autoFocus fuente={fuente} />}
            {tienePin && <OlvidePin esSuperAdmin={esSuperAdmin} />}
            <CampoPin etiqueta={t("cashRegister.pin.nuevo")} value={nuevo} onChange={setNuevo} autoFocus={!tienePin} fuente={fuente} />
            <CampoPin etiqueta={t("cashRegister.pin.confirmarNuevo")} value={confirmacion} onChange={setConfirmacion} fuente={fuente} />
            {error && (
              <p role="alert" data-pin-error style={{ color: "var(--danger)", fontSize: 12.5, margin: "0 0 4px" }}>{error}</p>
            )}
          </div>
          <div className="modal__footer">
            <ButtonNew variant="ghost" type="button" onClick={onClose}>{t("common.cancel")}</ButtonNew>
            <ButtonNew variant="primary" type="submit" disabled={guardando}>{tienePin ? t("cashRegister.pin.guardar") : t("cashRegister.pin.crear")}</ButtonNew>
          </div>
        </form>
      </div>
    </div>
  );
}
