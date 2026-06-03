"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Landmark,
  Wallet,
  Banknote,
  ShieldCheck,
  BadgeCheck,
  Building2,
  MapPin,
  Navigation,
  Truck,
  Tag,
  CreditCard,
  CheckCircle2,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  SUPPLIER_CATEGORY_OPTIONS,
  SUPPLIER_STATUS_LABELS,
} from "@/lib/suppliers/types";
import type { SupplierStatus } from "@/lib/suppliers/types";

interface ProfileInitial {
  businessName: string;
  email: string;
  slug: string;
  status: SupplierStatus;
  rfc: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  description: string;
  categories: string[];
  payTransferEnabled: boolean;
  payMercadoPagoEnabled: boolean;
  payCashEnabled: boolean;
  mpConnected: boolean;
}

const STATUS_TONE: Record<SupplierStatus, "success" | "warning" | "danger"> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "danger",
  SUSPENDED: "danger",
};

// Barra superior de acento para las cards de sección (.card ya es
// position:relative + overflow:hidden). Puramente decorativa.
function CardAccent() {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        insetInline: 0,
        top: 0,
        height: 3,
        background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
        pointerEvents: "none",
      }}
    />
  );
}

export function ProfileForm({ canEdit, initial }: { canEdit: boolean; initial: ProfileInitial }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [businessName, setBusinessName] = useState(initial.businessName);
  const [rfc, setRfc] = useState(initial.rfc);
  const [phone, setPhone] = useState(initial.phone);
  const [address, setAddress] = useState(initial.address);
  const [city, setCity] = useState(initial.city);
  const [state, setState] = useState(initial.state);
  const [description, setDescription] = useState(initial.description);
  const [categories, setCategories] = useState<string[]>(initial.categories);

  // ── Campos extra (no vienen en `initial`): se prefilllean por GET y solo se
  // envían en el PATCH si el usuario los editó, para que un GET lento o fallido
  // nunca pise el valor ya guardado. Mismo patrón que el perfil del laboratorio.
  const [whatsapp, setWhatsapp] = useState("");
  const [website, setWebsite] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [shippingNote, setShippingNote] = useState("");
  const touched = useRef<Record<"whatsapp" | "website" | "mapsUrl" | "minOrder" | "shippingNote", boolean>>({
    whatsapp: false,
    website: false,
    mapsUrl: false,
    minOrder: false,
    shippingNote: false,
  });

  useEffect(() => {
    let active = true;
    fetch("/api/proveedores/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        if (!touched.current.whatsapp && typeof d.whatsapp === "string") setWhatsapp(d.whatsapp);
        if (!touched.current.website && typeof d.website === "string") setWebsite(d.website);
        if (!touched.current.mapsUrl && typeof d.mapsUrl === "string") setMapsUrl(d.mapsUrl);
        if (!touched.current.shippingNote && typeof d.shippingNote === "string") setShippingNote(d.shippingNote);
        if (!touched.current.minOrder && typeof d.minOrderAmount === "number") setMinOrder(String(d.minOrderAmount));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cobros B2B ──────────────────────────────────────────────────────
  const [payTransferEnabled, setPayTransferEnabled] = useState(initial.payTransferEnabled);
  const [payMercadoPagoEnabled, setPayMercadoPagoEnabled] = useState(initial.payMercadoPagoEnabled);
  const [payCashEnabled, setPayCashEnabled] = useState(initial.payCashEnabled);
  // El token guardado nunca llega al cliente; sólo sabemos si está conectado.
  const [mpConnected, setMpConnected] = useState(initial.mpConnected);
  const [mpToken, setMpToken] = useState(""); // vacío = no cambiar al guardar

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    if (!canEdit) return;
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  async function save() {
    if (!businessName.trim()) {
      toast.error("El nombre del negocio es requerido.");
      return;
    }
    const mapsTrimmed = mapsUrl.trim();
    if (touched.current.mapsUrl && mapsTrimmed !== "" && !/^https?:\/\//i.test(mapsTrimmed)) {
      toast.error("El enlace de Google Maps debe empezar con http:// o https://.");
      return;
    }
    const minTrimmed = minOrder.trim();
    if (touched.current.minOrder && minTrimmed !== "") {
      const n = Math.floor(Number(minTrimmed));
      if (!Number.isInteger(n) || n < 0) {
        toast.error("El pedido mínimo debe ser un número entero mayor o igual a 0.");
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        businessName,
        rfc,
        phone,
        address,
        city,
        state,
        description,
        categories,
        payTransferEnabled,
        payMercadoPagoEnabled,
        payCashEnabled,
        // Sólo enviamos el token si el proveedor escribió uno nuevo.
        ...(mpToken.trim() ? { mpAccessToken: mpToken.trim() } : {}),
      };
      // Campos extra: solo si el usuario los editó (undefined = el backend no toca).
      if (touched.current.whatsapp) payload.whatsapp = whatsapp;
      if (touched.current.website) payload.website = website;
      if (touched.current.mapsUrl) payload.mapsUrl = mapsUrl;
      if (touched.current.shippingNote) payload.shippingNote = shippingNote;
      if (touched.current.minOrder) payload.minOrderAmount = minTrimmed === "" ? null : Math.floor(Number(minTrimmed));

      const res = await fetch("/api/proveedores/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo guardar el perfil.");
      }
      if (mpToken.trim()) {
        setMpConnected(true);
        setMpToken("");
      }
      toast.success("Perfil actualizado");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function disconnectMp() {
    setSaving(true);
    try {
      const res = await fetch("/api/proveedores/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mpAccessToken: "" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "No se pudo desconectar MercadoPago.");
      }
      setMpConnected(false);
      setMpToken("");
      toast.success("MercadoPago desconectado");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al desconectar");
    } finally {
      setSaving(false);
    }
  }

  const chip = (active: boolean): React.CSSProperties => ({
    textDecoration: "none",
    cursor: canEdit ? "pointer" : "default",
    opacity: canEdit ? 1 : 0.7,
    fontFamily: "inherit",
    ...(active
      ? { background: "var(--brand-soft)", color: "#c4b5fd", borderColor: "rgba(124,58,237,0.4)" }
      : {}),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!canEdit && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--warning-soft)",
            border: "1px solid rgba(245,158,11,0.25)",
            color: "#fcd34d",
            fontSize: 12,
          }}
        >
          <ShieldCheck size={16} style={{ flexShrink: 0 }} />
          <span>
            Solo el propietario o un gerente del negocio puede editar el perfil. Tienes acceso de solo lectura.
          </span>
        </div>
      )}

      {/* Estado de la cuenta (solo lectura) */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <BadgeCheck size={13} style={{ color: "var(--success)" }} /> Estado de la cuenta{" "}
          <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>Estado</span>
            <BadgeNew tone={STATUS_TONE[initial.status]} dot>
              {SUPPLIER_STATUS_LABELS[initial.status]}
            </BadgeNew>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>Correo (inicio de sesión)</span>
            <span style={{ color: "var(--text-1)", wordBreak: "break-word" }}>{initial.email}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ color: "var(--text-3)" }}>URL pública</span>
            <span
              className="mono"
              style={{
                color: "var(--violet-400)",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                borderRadius: 8,
                padding: "2px 8px",
                fontSize: 12,
              }}
            >
              /{initial.slug}
            </span>
          </div>
        </div>
      </CardNew>

      {/* Datos del negocio */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <Building2 size={13} style={{ color: "var(--violet-400)" }} /> Datos del negocio{" "}
          <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Nombre comercial</label>
            <input
              className="input-new"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Nombre del negocio"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">RFC</label>
            <input
              className="input-new"
              value={rfc}
              onChange={(e) => setRfc(e.target.value)}
              disabled={!canEdit || saving}
              maxLength={13}
              placeholder="Opcional"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Descripción</label>
            <textarea
              className="input-new"
              style={{ minHeight: 90, height: "auto", resize: "vertical", paddingTop: 8 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || saving}
              placeholder="Describe tu negocio para las clínicas…"
            />
          </div>
        </div>
      </CardNew>

      {/* Contacto y ubicación */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <MapPin size={13} style={{ color: "var(--info)" }} /> Contacto y ubicación{" "}
          <span className="form-section__rule" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label">Teléfono</label>
            <input
              className="input-new"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">WhatsApp</label>
            <input
              className="input-new"
              value={whatsapp}
              onChange={(e) => { touched.current.whatsapp = true; setWhatsapp(e.target.value); }}
              disabled={!canEdit || saving}
              placeholder="Ej. 55 1234 5678"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Sitio web</label>
            <input
              className="input-new"
              type="url"
              value={website}
              onChange={(e) => { touched.current.website = true; setWebsite(e.target.value); }}
              disabled={!canEdit || saving}
              placeholder="https://"
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Ciudad</label>
            <input
              className="input-new"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Estado</label>
            <input
              className="input-new"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label">Dirección</label>
            <input
              className="input-new"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit || saving}
            />
          </div>
          <div className="field-new" style={{ gridColumn: "1 / -1" }}>
            <label className="field-new__label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Navigation size={12} style={{ color: "var(--info)" }} /> Link de Google Maps
            </label>
            <input
              className="input-new"
              type="url"
              value={mapsUrl}
              onChange={(e) => { touched.current.mapsUrl = true; setMapsUrl(e.target.value); }}
              disabled={!canEdit || saving}
              placeholder="https://maps.google.com/…"
            />
            <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              Pega el enlace de tu ubicación para que las clínicas te encuentren.
            </span>
          </div>
        </div>
      </CardNew>

      {/* Pedido y envío */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <Truck size={13} style={{ color: "var(--violet-400)" }} /> Pedido y envío{" "}
          <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-new" style={{ maxWidth: 240 }}>
            <label className="field-new__label">Pedido mínimo (MXN)</label>
            <input
              className="input-new mono"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={minOrder}
              onChange={(e) => { touched.current.minOrder = true; setMinOrder(e.target.value); }}
              disabled={!canEdit || saving}
              placeholder="Opcional"
            />
            <span style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              Monto mínimo de compra que deben alcanzar las clínicas. Déjalo vacío si no aplica.
            </span>
          </div>
          <div className="field-new">
            <label className="field-new__label">Nota de envío / entrega</label>
            <textarea
              className="input-new"
              style={{ minHeight: 80, height: "auto", resize: "vertical", paddingTop: 8 }}
              value={shippingNote}
              onChange={(e) => { touched.current.shippingNote = true; setShippingNote(e.target.value); }}
              disabled={!canEdit || saving}
              placeholder="Ej. Envío gratis en pedidos mayores a $1,000. Entregas de lunes a viernes…"
            />
          </div>
        </div>
      </CardNew>

      {/* Categorías */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <Tag size={13} style={{ color: "var(--violet-400)" }} /> Categorías{" "}
          <span className="form-section__rule" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SUPPLIER_CATEGORY_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className="tag-new"
              style={chip(categories.includes(opt))}
              disabled={!canEdit || saving}
              onClick={() => toggle(categories, setCategories, opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </CardNew>

      {/* Cobros — métodos de pago B2B que aceptas de las clínicas */}
      <CardNew>
        <CardAccent />
        <div className="form-section__title">
          <Wallet size={13} style={{ color: "var(--violet-400)" }} /> Cobros (pagos de clínicas){" "}
          <span className="form-section__rule" />
        </div>
        <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          Activa los métodos por los que aceptas recibir el pago de tus pedidos. Las clínicas sólo
          verán los que tengas habilitados al hacer el checkout.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <PayToggle
            icon={<Landmark size={16} style={{ color: "var(--violet-400)" }} />}
            title="Transferencia (SPEI)"
            subtitle="La clínica transfiere a tus cuentas CLABE."
            checked={payTransferEnabled}
            disabled={!canEdit || saving}
            onChange={setPayTransferEnabled}
          />
          <PayToggle
            icon={<Wallet size={16} style={{ color: "var(--violet-400)" }} />}
            title="MercadoPago"
            subtitle="Cobro en línea directo a tu cuenta de MercadoPago."
            checked={payMercadoPagoEnabled}
            disabled={!canEdit || saving}
            onChange={setPayMercadoPagoEnabled}
          />
          <PayToggle
            icon={<Banknote size={16} style={{ color: "var(--violet-400)" }} />}
            title="Efectivo"
            subtitle="La clínica paga en efectivo al recibir el pedido."
            checked={payCashEnabled}
            disabled={!canEdit || saving}
            onChange={setPayCashEnabled}
          />

          {/* Token de MercadoPago (sólo si el método está activo) */}
          {payMercadoPagoEnabled && (
            <div
              style={{
                marginTop: 4,
                padding: 14,
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                background: "var(--bg-elev)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  <CreditCard size={15} style={{ color: "var(--violet-400)" }} />
                  Conexión con MercadoPago
                </div>
                <BadgeNew tone={mpConnected ? "success" : "warning"} dot>
                  {mpConnected ? "Conectado" : "Sin conectar"}
                </BadgeNew>
              </div>
              <div className="field-new">
                <label className="field-new__label">Access Token</label>
                <input
                  className="input-new mono"
                  type="password"
                  value={mpToken}
                  onChange={(e) => setMpToken(e.target.value)}
                  disabled={!canEdit || saving}
                  autoComplete="off"
                  placeholder={
                    mpConnected
                      ? "•••••••• (guardado) — pega uno nuevo para reemplazar"
                      : "Pega tu Access Token (APP_USR-…)"
                  }
                />
              </div>
              <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0, lineHeight: 1.5, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <ShieldCheck size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
                El cobro va directo a tu cuenta. Tu token nunca se muestra ni se comparte con las
                clínicas; sólo se guarda de forma segura.
              </p>
              {canEdit && mpConnected && (
                <div>
                  <ButtonNew variant="ghost" type="button" onClick={disconnectMp} disabled={saving}>
                    Desconectar MercadoPago
                  </ButtonNew>
                </div>
              )}
            </div>
          )}
        </div>
      </CardNew>

      {canEdit && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </ButtonNew>
        </div>
      )}
    </div>
  );
}

// ── Fila de método de cobro con switch on/off ───────────────────────────
function PayToggle({
  icon,
  title,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-soft)"}`,
        background: checked ? "var(--brand-soft)" : "var(--bg-elev)",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color .15s, background .15s",
        fontFamily: "inherit",
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: checked ? "var(--brand-softer)" : "var(--bg-elev-2)",
          border: `1px solid ${checked ? "var(--border-brand)" : "var(--border-soft)"}`,
          flexShrink: 0,
          transition: "background .15s, border-color .15s",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{title}</span>
          {checked && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--success)",
              }}
            >
              <CheckCircle2 size={12} /> Activo
            </span>
          )}
        </span>
        <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--violet-500, #7c3aed)" : "var(--border-strong)",
          position: "relative",
          flexShrink: 0,
          transition: "background .15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left .15s",
          }}
        />
      </span>
    </button>
  );
}
