"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";

const SERVICIOS = [
  "corte",
  "color completo",
  "mechas/highlights",
  "balayage",
  "alisado keratina",
  "permanente",
  "tratamiento capilar",
  "barba",
  "corte + barba",
];

const TIPOS_CABELLO = [
  "liso fino",
  "liso grueso",
  "ondulado",
  "rizado",
  "crespo",
];

const VOLUMENES_REVELADOR = ["10", "20", "30", "40"];

const COLOR_SERVICES = ["color completo", "mechas/highlights", "balayage"];

interface Props {
  patientId: string;
  onSaved: (record: any) => void;
}

export function HairSalonForm({ patientId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
    servicio: "",
    tipoCabello: "",
    colors: [{ marca: "", tono: "", proporcion: "", reveladorVolumen: "20" }],
    processingTime: "",
    productosAplicados: "",
    estilista: "",
    notasProximaVisita: "",
    // Diagnóstico capilar
    porosidad: "",
    nivelDano: 0,
    tipoCueroCabelludo: "",
    elasticidad: "",
    grosorCabello: "",
    // Preferencias del cliente
    estiloPreferido: "",
    largoIdeal: "",
    frecuenciaVisita: "",
    productosFavoritos: "",
    alergias: "",
    // Recomendaciones para casa
    champuRecomendado: "",
    acondicionador: "",
    tratamientoMascarilla: "",
    frecuenciaLavado: "",
    notasCuidado: "",
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const showColorFormula = COLOR_SERVICES.includes(form.servicio);

  function addColor() {
    set("colors", [
      ...form.colors,
      { marca: "", tono: "", proporcion: "", reveladorVolumen: "20" },
    ]);
  }

  function updateColor(i: number, field: string, value: string) {
    const colors = [...form.colors];
    (colors[i] as any)[field] = value;
    set("colors", colors);
  }

  async function handleSave() {
    if (!form.servicio) {
      toast.error("Selecciona el servicio realizado");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/clinical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          subjective: form.subjective,
          objective: form.objective,
          assessment: form.assessment,
          plan: form.plan,
          specialtyData: {
            type: "hair_salon",
            servicio: form.servicio,
            tipoCabello: form.tipoCabello,
            colorFormula: showColorFormula
              ? { colors: form.colors, processingTime: form.processingTime }
              : null,
            productosAplicados: form.productosAplicados,
            estilista: form.estilista,
            notasProximaVisita: form.notasProximaVisita,
            diagnosticoCapilar: {
              porosidad: form.porosidad,
              nivelDano: form.nivelDano,
              tipoCueroCabelludo: form.tipoCueroCabelludo,
              elasticidad: form.elasticidad,
              grosorCabello: form.grosorCabello,
            },
            preferenciasCliente: {
              estiloPreferido: form.estiloPreferido,
              largoIdeal: form.largoIdeal,
              frecuenciaVisita: form.frecuenciaVisita,
              productosFavoritos: form.productosFavoritos,
              alergias: form.alergias,
            },
            recomendacionesCasa: {
              champuRecomendado: form.champuRecomendado,
              acondicionador: form.acondicionador,
              tratamientoMascarilla: form.tratamientoMascarilla,
              frecuenciaLavado: form.frecuenciaLavado,
              notasCuidado: form.notasCuidado,
            },
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const record = await res.json();

      // Save color formula separately if applicable
      if (showColorFormula) {
        await fetch("/api/formulas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            type: "hair_color",
            formula: {
              colors: form.colors,
              processingTime: form.processingTime,
            },
            notes: form.notasProximaVisita,
          }),
        }).catch(() => {
          /* endpoint may not exist yet */
        });
      }

      onSaved(record);
      toast.success("Registro de salón guardado");
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SOAP */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Motivo de visita</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="¿Qué busca el cliente hoy?"
            value={form.subjective}
            onChange={(e) => set("subjective", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Observaciones del cabello</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Estado actual del cabello, daño, raíces…"
            value={form.objective}
            onChange={(e) => set("objective", e.target.value)}
          />
        </div>
      </div>

      {/* SERVICIO Y TIPO */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Servicio</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Servicio</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.servicio}
              onChange={(e) => set("servicio", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {SERVICIOS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de cabello</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tipoCabello}
              onChange={(e) => set("tipoCabello", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {TIPOS_CABELLO.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* COLOR FORMULA */}
      {showColorFormula && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">Fórmula de color</h3>
            <button
              className="text-xs font-semibold text-brand-600 hover:underline"
              onClick={addColor}
            >
              + Agregar color
            </button>
          </div>
          <div className="space-y-2">
            {form.colors.map((c, i) => (
              <div key={i} className="grid grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Marca</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. Wella"
                    value={c.marca}
                    onChange={(e) => updateColor(i, "marca", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tono</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. 7/1"
                    value={c.tono}
                    onChange={(e) => updateColor(i, "tono", e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Proporción</Label>
                  <input
                    className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder="Ej. 1:1.5"
                    value={c.proporcion}
                    onChange={(e) =>
                      updateColor(i, "proporcion", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Revelador volumen</Label>
                  <select
                    className="flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    value={c.reveladorVolumen}
                    onChange={(e) =>
                      updateColor(i, "reveladorVolumen", e.target.value)
                    }
                  >
                    {VOLUMENES_REVELADOR.map((v) => (
                      <option key={v} value={v}>
                        Vol. {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Tiempo de procesamiento (minutos)</Label>
            <input
              type="number"
              className="flex h-9 w-32 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. 35"
              value={form.processingTime}
              onChange={(e) => set("processingTime", e.target.value)}
            />
          </div>
        </div>
      )}

      {/* PRODUCTOS & ESTILISTA */}
      <div className="rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold mb-3">Detalles adicionales</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Productos aplicados</Label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
              placeholder="Shampoo, acondicionador, tratamiento, protector térmico…"
              value={form.productosAplicados}
              onChange={(e) => set("productosAplicados", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Estilista</Label>
              <input
                className="flex h-10 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Nombre del estilista"
                value={form.estilista}
                onChange={(e) => set("estilista", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* DIAGNÓSTICO CAPILAR */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-3">🔍 Diagnóstico capilar</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Porosidad</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.porosidad}
              onChange={(e) => set("porosidad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="baja">Baja (cerrada)</option>
              <option value="media">Media (normal)</option>
              <option value="alta">Alta (abierta)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de cuero cabelludo</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.tipoCueroCabelludo}
              onChange={(e) => set("tipoCueroCabelludo", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {["Normal", "Graso", "Seco", "Mixto", "Con caspa", "Con dermatitis"].map((t) => (
                <option key={t} value={t.toLowerCase()}>{t}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Elasticidad</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.elasticidad}
              onChange={(e) => set("elasticidad", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="buena">Buena</option>
              <option value="media">Media</option>
              <option value="baja">Baja (se quiebra)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Grosor del cabello</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.grosorCabello}
              onChange={(e) => set("grosorCabello", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="fino">Fino</option>
              <option value="medio">Medio</option>
              <option value="grueso">Grueso</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Nivel de daño (1-5)</Label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const colors = [
                "bg-green-500 hover:bg-green-600",
                "bg-lime-500 hover:bg-lime-600",
                "bg-yellow-500 hover:bg-yellow-600",
                "bg-orange-500 hover:bg-orange-600",
                "bg-red-500 hover:bg-red-600",
              ];
              return (
                <button
                  key={n}
                  type="button"
                  className={`h-10 w-10 rounded-lg text-sm font-bold text-white transition-all ${
                    form.nivelDano === n
                      ? colors[n - 1] + " ring-2 ring-offset-2 ring-brand-600 dark:ring-offset-gray-900"
                      : "bg-muted text-muted-foreground hover:opacity-80"
                  }`}
                  onClick={() => set("nivelDano", n)}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* PREFERENCIAS DEL CLIENTE */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-3">💇 Preferencias del cliente</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Estilo preferido</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Ej. Bob asimétrico, degradado…"
              value={form.estiloPreferido}
              onChange={(e) => set("estiloPreferido", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Largo ideal</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.largoIdeal}
              onChange={(e) => set("largoIdeal", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="muy_corto">Muy corto (pixie)</option>
              <option value="corto">Corto (por encima de hombros)</option>
              <option value="medio">Medio (hombros)</option>
              <option value="largo">Largo</option>
              <option value="muy_largo">Muy largo</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Frecuencia de visita</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.frecuenciaVisita}
              onChange={(e) => set("frecuenciaVisita", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="3_semanas">Cada 3 semanas</option>
              <option value="mensual">Mensual</option>
              <option value="6_semanas">Cada 6 semanas</option>
              <option value="2_meses">Cada 2 meses</option>
              <option value="3_meses">Cada 3+ meses</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Productos favoritos</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Marcas o productos que usa el cliente"
              value={form.productosFavoritos}
              onChange={(e) => set("productosFavoritos", e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Alergias a tintes/productos</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-card dark:border-border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Reacciones conocidas a tintes, químicos, ingredientes…"
            value={form.alergias}
            onChange={(e) => set("alergias", e.target.value)}
          />
        </div>
      </div>

      {/* RECOMENDACIONES PARA CASA */}
      <div className="rounded-xl border border-border dark:border-border p-4">
        <h3 className="text-sm font-bold mb-3">🏠 Recomendaciones para casa</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Champú recomendado</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Marca y tipo de champú"
              value={form.champuRecomendado}
              onChange={(e) => set("champuRecomendado", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Acondicionador</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Marca y tipo de acondicionador"
              value={form.acondicionador}
              onChange={(e) => set("acondicionador", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tratamiento/mascarilla</Label>
            <input
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              placeholder="Tratamiento o mascarilla recomendada"
              value={form.tratamientoMascarilla}
              onChange={(e) => set("tratamientoMascarilla", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Frecuencia de lavado</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-border bg-card dark:border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              value={form.frecuenciaLavado}
              onChange={(e) => set("frecuenciaLavado", e.target.value)}
            >
              <option value="">Seleccionar…</option>
              <option value="diario">Diario</option>
              <option value="cada_2_dias">Cada 2 días</option>
              <option value="cada_3_dias">Cada 3 días</option>
              <option value="2_por_semana">2 veces por semana</option>
              <option value="1_por_semana">1 vez por semana</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label>Notas adicionales de cuidado</Label>
          <textarea
            className="flex min-h-[60px] w-full rounded-lg border border-border bg-card dark:border-border px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Evitar plancha, usar protector térmico, no lavar en 48h…"
            value={form.notasCuidado}
            onChange={(e) => set("notasCuidado", e.target.value)}
          />
        </div>
      </div>

      {/* DIAGNÓSTICO Y PLAN */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Resultado / Observaciones</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Resultado del servicio, satisfacción del cliente…"
            value={form.assessment}
            onChange={(e) => set("assessment", e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Notas para próxima visita</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-none"
            placeholder="Retocar raíz en 4 semanas, cambiar tono…"
            value={form.notasProximaVisita}
            onChange={(e) => set("notasProximaVisita", e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? "Guardando…" : "Guardar registro de salón"}
        </Button>
      </div>
    </div>
  );
}
