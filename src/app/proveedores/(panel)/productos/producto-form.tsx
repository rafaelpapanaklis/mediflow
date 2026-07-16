"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Save,
  X,
  ImageOff,
  Package,
  DollarSign,
  Eye,
  ImagePlus,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { CardNew } from "@/components/ui/design-system/card-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  SUPPLIER_CATEGORY_OPTIONS,
  type SupplierProductDTO,
  type SupplierProductImageDTO,
} from "@/lib/suppliers/types";

const MAX_IMAGES = 8;
const UNIT_OPTIONS = ["pza", "caja", "kit", "paquete", "frasco", "rollo", "par", "blíster", "ml", "g", "unidad"];

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

type Props =
  | { mode: "create"; product?: undefined }
  | { mode: "edit"; product: SupplierProductDTO };

export function ProductoForm(props: Props) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = props.mode === "edit";
  const product = props.mode === "edit" ? props.product : undefined;

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [unit, setUnit] = useState(product?.unit ?? "pza");
  const [stock, setStock] = useState(product ? String(product.stock) : "0");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);

  const [images, setImages] = useState<SupplierProductImageDTO[]>(product?.images ?? []);
  const [pending, setPending] = useState<{ file: File; preview: string }[]>([]);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const totalImages = editing ? images.length : pending.length;

  function openPicker() {
    if (totalImages >= MAX_IMAGES) {
      toast.error(`Máximo ${MAX_IMAGES} imágenes por producto.`);
      return;
    }
    fileInputRef.current?.click();
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const room = MAX_IMAGES - totalImages;
    if (room <= 0) {
      toast.error(`Máximo ${MAX_IMAGES} imágenes por producto.`);
      return;
    }
    const toAdd = files.slice(0, room);
    if (files.length > room) {
      toast.error(`Solo se agregaron ${room}; el máximo es ${MAX_IMAGES}.`);
    }

    // Crear: las guardamos en memoria y se suben tras crear el producto.
    if (!editing || !product) {
      setPending((prev) => [...prev, ...toAdd.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
      return;
    }

    // Editar: el producto ya existe → subimos cada imagen de inmediato.
    setUploading(true);
    try {
      let ok = 0;
      for (const file of toAdd) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/proveedores/products/${product.id}/images`, { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data?.error ?? "No se pudo subir la imagen.");
          continue;
        }
        setImages((prev) => [...prev, data as SupplierProductImageDTO]);
        ok++;
      }
      if (ok > 0) toast.success(ok === 1 ? "Imagen agregada" : `${ok} imágenes agregadas`);
    } finally {
      setUploading(false);
    }
  }

  function removePending(idx: number) {
    setPending((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed.preview);
      return next;
    });
  }

  async function removeImage(image: SupplierProductImageDTO) {
    if (!product) return;
    const ok = await askConfirm({
      title: "¿Quitar esta imagen?",
      description: "La imagen se eliminará del producto.",
      variant: "danger",
      confirmText: "Quitar",
    });
    if (!ok) return;
    const res = await fetch(`/api/proveedores/products/${product.id}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: image.id }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d?.error ?? "No se pudo quitar la imagen.");
      return;
    }
    setImages((prev) => prev.filter((i) => i.id !== image.id));
    toast.success("Imagen quitada");
  }

  function validate(): string | null {
    if (!name.trim()) return "El nombre del producto es requerido.";
    const p = Number(price);
    if (price.trim() === "" || !Number.isFinite(p) || p < 0) {
      return "El precio debe ser un número mayor o igual a 0.";
    }
    const s = Math.floor(Number(stock || "0"));
    if (!Number.isInteger(s) || s < 0) return "El stock debe ser un número entero mayor o igual a 0.";
    return null;
  }

  function buildPayload() {
    return {
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      sku: sku.trim() || null,
      price: Number(price),
      unit: unit.trim() || "pza",
      stock: Math.floor(Number(stock || "0")),
      isActive,
    };
  }

  async function handleCreate() {
    const res = await fetch("/api/proveedores/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data?.error ?? "No se pudo crear el producto.");
      return;
    }

    // Subir imágenes pendientes en orden (sortOrder determinista).
    const newId = data.id as string;
    let failed = 0;
    for (const item of pending) {
      const fd = new FormData();
      fd.append("file", item.file);
      const up = await fetch(`/api/proveedores/products/${newId}/images`, { method: "POST", body: fd });
      if (!up.ok) failed++;
    }
    pending.forEach((p) => URL.revokeObjectURL(p.preview));

    if (failed > 0) {
      toast.error(`Producto creado, pero ${failed} ${failed === 1 ? "imagen no se subió" : "imágenes no se subieron"}.`);
    } else {
      toast.success("Producto creado");
    }
    router.push("/proveedores/productos");
    router.refresh();
  }

  async function handleUpdate() {
    if (!product) return;
    const res = await fetch(`/api/proveedores/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload()),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data?.error ?? "No se pudieron guardar los cambios.");
      return;
    }
    toast.success("Cambios guardados");
    router.refresh();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || uploading) return;
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    try {
      if (editing) await handleUpdate();
      else await handleCreate();
    } catch {
      toast.error("Ocurrió un error. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 880, margin: "0 auto" }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => router.push("/proveedores/productos")}
        className="btn-new btn-new--ghost btn-new--sm"
        style={{ marginBottom: 16, paddingLeft: 6 }}
      >
        <ArrowLeft size={14} /> Volver a productos
      </button>
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background: "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <div
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "var(--brand-grad)",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Package size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            {editing ? "Editar producto" : "Nuevo producto"}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            {editing
              ? "Actualiza los datos y las fotos de tu producto."
              : "Captura los datos de tu producto y agrega fotos para mostrarlo a las clínicas."}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Información */}
        <CardNew>
          <CardAccent />
          <div className="form-section__title">
            <Package size={13} style={{ color: "var(--brand)" }} /> Información del producto
            <span className="form-section__rule" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "14px" }}>
            <div className="field-new">
              <label className="field-new__label">Nombre <span className="req">*</span></label>
              <input
                className="input-new"
                placeholder="Ej: Resina compuesta A2 (jeringa 4g)"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="field-new">
              <label className="field-new__label">Descripción</label>
              <textarea
                className="input-new"
                style={{ height: 84, paddingTop: 8, resize: "vertical" }}
                placeholder="Detalles, presentación, marca, características…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <div className="field-new">
                <label className="field-new__label">Categoría</label>
                <select className="input-new" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Sin categoría</option>
                  {SUPPLIER_CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">SKU / código</label>
                <input
                  className="input-new"
                  placeholder="Opcional"
                  value={sku}
                  maxLength={100}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardNew>

        {/* Precio e inventario */}
        <CardNew>
          <CardAccent />
          <div className="form-section__title">
            <DollarSign size={13} style={{ color: "var(--success)" }} /> Precio e inventario
            <span className="form-section__rule" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <div className="field-new">
              <label className="field-new__label">Precio (MXN) <span className="req">*</span></label>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                className="input-new mono"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="field-new">
              <label className="field-new__label">Unidad</label>
              <select className="input-new" value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">Stock</label>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="input-new mono"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-1)",
                }}
              >
                <Eye size={14} style={{ color: isActive ? "var(--brand)" : "var(--text-3)", transition: "color .15s" }} />
                Visible en el marketplace
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                Si lo desactivas, las clínicas no podrán verlo ni pedirlo.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label="Visible en el marketplace"
              onClick={() => setIsActive((v) => !v)}
              style={{
                width: 44,
                height: 24,
                borderRadius: 999,
                border: isActive ? "1px solid var(--border-brand)" : "1px solid var(--border-strong)",
                background: isActive ? "var(--brand)" : "var(--bg-elev-2)",
                position: "relative",
                cursor: "pointer",
                transition: "background .15s, border-color .15s, box-shadow .15s",
                boxShadow: isActive ? "0 0 0 3px var(--brand-soft)" : "none",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: isActive ? 22 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  transition: "left .15s",
                }}
              />
            </button>
          </div>
        </CardNew>

        {/* Imágenes */}
        <CardNew>
          <CardAccent />
          <div className="form-section__title">
            <ImagePlus size={13} style={{ color: "var(--info)" }} /> Imágenes
            <span className="form-section__rule" />
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "0 0 14px" }}>
            Hasta {MAX_IMAGES} fotos · JPG, PNG, WebP o GIF (máx 10 MB c/u)
          </p>

          {/* Dropzone estilo labs: borde dashed + chip Upload violeta, drag-over con brand-soft */}
          <button
            type="button"
            onClick={openPicker}
            disabled={uploading || totalImages >= MAX_IMAGES}
            onDragOver={(e) => {
              if (uploading || totalImages >= MAX_IMAGES) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (uploading || totalImages >= MAX_IMAGES) return;
              handleFiles(e.dataTransfer.files);
            }}
            aria-label="Agregar imágenes"
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "26px 18px",
              borderRadius: 14,
              border: `1.5px dashed ${dragOver ? "var(--border-brand)" : "var(--border-strong)"}`,
              background: dragOver ? "var(--brand-soft)" : "var(--bg-elev)",
              color: "var(--text-3)",
              cursor: uploading || totalImages >= MAX_IMAGES ? "not-allowed" : "pointer",
              opacity: totalImages >= MAX_IMAGES ? 0.55 : 1,
              transition: "background .14s ease, border-color .14s ease",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--brand)",
              }}
            >
              {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              {totalImages >= MAX_IMAGES
                ? `Límite de ${MAX_IMAGES} imágenes alcanzado`
                : uploading
                  ? "Subiendo…"
                  : "Arrastra fotos aquí o haz clic para subir"}
            </span>
            {totalImages < MAX_IMAGES && !uploading && (
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {totalImages}/{MAX_IMAGES} agregadas
              </span>
            )}
          </button>

          {/* Preview de imágenes con thumbnails y botón quitar */}
          {totalImages > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
              {editing
                ? images.map((img) => (
                    <div key={img.id} className="product-thumb">
                      <img src={img.url} alt="" />
                      <button
                        type="button"
                        onClick={() => removeImage(img)}
                        aria-label="Quitar imagen"
                        className="product-thumb__remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                : pending.map((p, idx) => (
                    <div key={p.preview} className="product-thumb">
                      <img src={p.preview} alt="" />
                      <button
                        type="button"
                        onClick={() => removePending(idx)}
                        aria-label="Quitar imagen"
                        className="product-thumb__remove"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
            </div>
          )}

          {totalImages === 0 && !uploading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, color: "var(--text-4)", fontSize: 12 }}>
              <ImageOff size={14} />
              <span>Aún no agregas fotos. El producto se verá mejor con al menos una.</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </CardNew>

        {/* Acciones */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ButtonNew variant="ghost" type="button" onClick={() => router.push("/proveedores/productos")}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            variant="primary"
            type="submit"
            disabled={saving || uploading}
            icon={saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          >
            {editing ? "Guardar cambios" : "Crear producto"}
          </ButtonNew>
        </div>
      </form>

      {/* Estilos locales para las miniaturas (sin tocar globals.css). */}
      <style jsx>{`
        .product-thumb {
          position: relative;
          width: 92px;
          height: 92px;
          border-radius: 10px;
          overflow: hidden;
          border: 1px solid var(--border-soft);
          background: var(--bg-elev-2);
        }
        .product-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .product-thumb__remove {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          border: none;
          background: rgba(0, 0, 0, 0.6);
          color: #fff;
          display: grid;
          place-items: center;
          cursor: pointer;
        }
        .product-thumb__remove:hover {
          background: rgba(0, 0, 0, 0.8);
        }
      `}</style>
    </div>
  );
}
