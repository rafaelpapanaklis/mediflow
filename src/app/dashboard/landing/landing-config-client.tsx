"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink, Copy, Eye, Plus, Trash2, Upload, Check, Sparkles, RefreshCw, Users, ImagePlus, ChevronLeft, ChevronRight, Star } from "lucide-react";

interface Clinic {
  id: string; name: string; slug: string; phone: string|null; email: string|null;
  address: string|null; city: string|null; logoUrl: string|null; description: string|null;
  landingActive: boolean; landingThemeColor: string|null; landingCoverUrl: string|null;
  landingGallery: string[]; landingTestimonials: any; landingFaqs: any;
  landingServices: any; landingWhatsapp: string|null; landingInstagram: string|null;
  landingFacebook: string|null; landingTiktok: string|null; landingMapEmbed: string|null;
  landingTagline: string|null;
  landingTemplate: string|null; landingYearsExperience: number|null; landingPatients: string|null;
}

interface Props { clinic: Clinic; appUrl: string }

const TABS = [
  { id:"plantilla",    label:"Plantilla"       },
  { id:"general",      label:"General"         },
  { id:"servicios",    label:"Servicios"       },
  { id:"testimonios",  label:"Testimonios"     },
  { id:"faqs",         label:"FAQs"            },
  { id:"galeria",      label:"Galería"         },
  { id:"redes",        label:"Redes y contacto"},
];

const TEMPLATES = [
  { id:"classic",    name:"Clásico",    desc:"Limpio y profesional, el estándar de MediFlow." },
  { id:"futurista",  name:"Futurista",  desc:"Moderno, con acentos de neón y gradientes." },
  { id:"healthtech", name:"Healthtech", desc:"Tecnológico y confiable, look de clínica moderna." },
  { id:"calido",     name:"Cálido",     desc:"Tonos suaves y acogedores que transmiten cercanía." },
];

// Mini-mock CSS de cada plantilla (no usa fotos reales) para el selector.
function TemplateThumb({ variant }: { variant: string }) {
  const v: Record<string, { bg:string; bar:string; chip:string; text:string }> = {
    classic:    { bg:"bg-gradient-to-br from-blue-500 to-blue-700",                  bar:"bg-white/90",  chip:"bg-white/70",       text:"bg-white/40" },
    futurista:  { bg:"bg-gradient-to-br from-fuchsia-600 via-violet-700 to-slate-900", bar:"bg-cyan-300",  chip:"bg-fuchsia-300/80", text:"bg-white/30" },
    healthtech: { bg:"bg-gradient-to-br from-emerald-400 to-teal-700",               bar:"bg-white/90",  chip:"bg-emerald-100/80", text:"bg-white/40" },
    calido:     { bg:"bg-gradient-to-br from-amber-300 via-rose-300 to-orange-400",  bar:"bg-white/95",  chip:"bg-rose-100/90",    text:"bg-amber-900/25" },
  };
  const s = v[variant] ?? v.classic;
  return (
    <div className={`relative w-full aspect-[16/10] rounded-lg overflow-hidden p-2 flex flex-col gap-1.5 ${s.bg}`}>
      <div className="flex items-center gap-1">
        <div className={`h-1.5 w-6 rounded-full ${s.bar}`} />
        <div className="ml-auto flex gap-1">
          <div className={`h-1.5 w-3 rounded-full ${s.chip}`} />
          <div className={`h-1.5 w-3 rounded-full ${s.chip}`} />
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-1">
        <div className={`h-2 w-2/3 rounded ${s.bar}`} />
        <div className={`h-1.5 w-1/2 rounded ${s.text}`} />
        <div className={`mt-1 h-2 w-10 rounded ${s.chip}`} />
      </div>
      <div className="flex gap-1">
        <div className={`h-3 flex-1 rounded ${s.text}`} />
        <div className={`h-3 flex-1 rounded ${s.text}`} />
        <div className={`h-3 flex-1 rounded ${s.text}`} />
      </div>
    </div>
  );
}

export function LandingConfigClient({ clinic: initial, appUrl }: Props) {
  const [clinic, setClinic] = useState(initial);
  const [tab, setTab]       = useState("plantilla");
  const [saving, setSaving] = useState(false);
  const [templateSel, setTemplateSel] = useState(initial.landingTemplate ?? "classic");

  const landingUrl = `${appUrl}/${clinic.slug}`;

  function updateLocal(key: string, value: any) {
    setClinic(c => ({ ...c, [key]: value }));
  }

  async function save(data: Record<string, any>, successMsg = "✅ Guardado") {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic-landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const updated = await res.json();
      setClinic(c => ({ ...c, ...updated }));
      toast.success(successMsg);
    } catch(e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function uploadImage(file: File, field: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("field", field);
    const res = await fetch("/api/landing-upload", { method:"POST", body:formData });
    if (!res.ok) throw new Error("Error al subir imagen");
    const { url } = await res.json();
    return url;
  }

  // ── Plantilla: previsualizar (sin publicar) y aplicar (publica)
  function previewTemplate(id: string = templateSel) {
    window.open(`/${clinic.slug}?preview=${id}`, "_blank", "noopener");
  }

  async function applyTemplate() {
    const name = TEMPLATES.find(t => t.id === templateSel)?.name ?? templateSel;
    updateLocal("landingTemplate", templateSel);
    if (!clinic.landingActive) updateLocal("landingActive", true);
    await save({ landingTemplate: templateSel, landingActive: true }, `✨ Tu sitio ahora usa la plantilla ${name}`);
  }

  // ── Servicios state
  const [services, setServices] = useState<any[]>(Array.isArray(clinic.landingServices) ? clinic.landingServices : []);
  function addService() { setServices(s => [...s, { name:"", desc:"", price:"", icon:"🦷" }]); }
  function removeService(i: number) { setServices(s => s.filter((_,j) => j !== i)); }
  function updateService(i: number, k: string, v: string) { setServices(s => s.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── Testimonios state
  const [testimonials, setTestimonials] = useState<any[]>(Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : []);
  function addTestimonial() { setTestimonials(t => [...t, { name:"", text:"", rating:5, date:"" }]); }
  function removeTestimonial(i: number) { setTestimonials(t => t.filter((_,j) => j !== i)); }
  function updateTestimonial(i: number, k: string, v: any) { setTestimonials(t => t.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── FAQs state
  const [faqs, setFaqs] = useState<any[]>(Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : []);
  function addFaq() { setFaqs(f => [...f, { question:"", answer:"" }]); }
  function removeFaq(i: number) { setFaqs(f => f.filter((_,j) => j !== i)); }
  function updateFaq(i: number, k: string, v: string) { setFaqs(f => f.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── Galería: reordenar (intercambia i con su vecino) y elegir portada
  async function moveGalleryPhoto(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= clinic.landingGallery.length) return;
    const nuevo = [...clinic.landingGallery];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    updateLocal("landingGallery", nuevo);
    await save({ landingGallery: nuevo }, "✅ Orden actualizado");
  }
  async function setGalleryCover(url: string) {
    updateLocal("landingCoverUrl", url);
    await save({ landingCoverUrl: url }, "✅ Portada actualizada");
  }

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6 space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Página pública de tu clínica</h1>
          <p className="text-sm text-muted-foreground">Configura cómo verán tu clínica los pacientes</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Active toggle */}
          <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
            <span className="text-sm font-semibold">{clinic.landingActive ? "🟢 Publicada" : "⚫ Oculta"}</span>
            <button onClick={async () => {
              const newVal = !clinic.landingActive;
              updateLocal("landingActive", newVal);
              await save({ landingActive: newVal });
            }} className={`w-10 h-5 rounded-full relative transition-colors ${clinic.landingActive ? "bg-emerald-500" : "bg-muted"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-card shadow transition-all ${clinic.landingActive ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          {/* View link */}
          <a href={landingUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 border border-brand-300 px-3 py-2 rounded-xl hover:bg-brand-600/15">
            <ExternalLink size={14}/> Ver página
          </a>
          {/* Copy link */}
          <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success("¡Link copiado!"); }}
            className="flex items-center gap-1.5 text-sm font-semibold border border-border px-3 py-2 rounded-xl hover:bg-muted">
            <Copy size={14}/> Copiar link
          </button>
        </div>
      </div>

      {/* Link preview */}
      <div className="bg-brand-600/15 border border-brand-200 dark:border-brand-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-brand-600 font-semibold mb-0.5">Tu link público</div>
          <div className="text-sm font-mono font-bold">{landingUrl}</div>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success("¡Link copiado!"); }}
          className="shrink-0 text-xs font-semibold text-brand-600 hover:underline">Copiar</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-border">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab===t.id ? "bg-card border border-b-0 border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PLANTILLA ── */}
      {tab === "plantilla" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="font-bold flex items-center gap-1.5"><Sparkles size={16} className="text-brand-600"/> Plantilla de tu sitio</h3>
            <p className="text-xs text-muted-foreground">Elige el estilo visual de tu página pública. Previsualiza sin publicar y aplica cuando estés listo.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TEMPLATES.map(t => {
              const selected = templateSel === t.id;
              return (
                <div key={t.id} role="button" tabIndex={0} aria-pressed={selected}
                  onClick={() => setTemplateSel(t.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTemplateSel(t.id); } }}
                  className={`cursor-pointer rounded-2xl border p-2.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${selected ? "border-brand-500 ring-2 ring-brand-500/40 bg-brand-600/5" : "border-border hover:border-brand-300"}`}>
                  <div className="relative">
                    <TemplateThumb variant={t.id} />
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 bg-brand-600 text-white rounded-full p-0.5 shadow">
                        <Check size={12}/>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{t.name}</span>
                    {clinic.landingTemplate === t.id && (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">Activa</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t.desc}</p>
                  <button type="button" onClick={e => { e.stopPropagation(); previewTemplate(t.id); }}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-brand-600 border border-brand-300 rounded-lg py-1 hover:bg-brand-600/10">
                    <Eye size={12}/> Previsualizar
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => previewTemplate()}
              className="flex items-center gap-1.5 text-sm font-semibold border border-border px-4 py-2.5 rounded-xl hover:bg-muted">
              <Eye size={15}/> Previsualizar selección
            </button>
            <button type="button" onClick={applyTemplate} disabled={saving}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-brand-600 px-4 py-2.5 rounded-xl disabled:opacity-50">
              <Check size={15}/> {saving ? "Aplicando…" : "Aplicar / Usar esta plantilla"}
            </button>
            {!clinic.landingActive && (
              <span className="text-xs text-amber-600">Aplicar también publicará tu sitio.</span>
            )}
          </div>
        </div>
      )}

      {/* ── GENERAL ── */}
      {tab === "general" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
          {/* Theme color */}
          <div>
            <label className="text-sm font-semibold block mb-2">Color principal</label>
            <div className="flex items-center gap-3">
              <input type="color" value={clinic.landingThemeColor ?? "#2563eb"}
                onChange={e => updateLocal("landingThemeColor", e.target.value)}
                className="h-10 w-20 rounded-lg cursor-pointer border border-border" />
              <span className="text-sm text-muted-foreground">{clinic.landingThemeColor ?? "#2563eb"}</span>
              <button onClick={() => save({ landingThemeColor: clinic.landingThemeColor })}
                className="text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">Guardar</button>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <label className="text-sm font-semibold block mb-1">Slogan / Tagline</label>
            <p className="text-xs text-muted-foreground mb-2">Frase corta que aparece debajo del nombre en el hero</p>
            <input value={clinic.landingTagline ?? ""}
              onChange={e => updateLocal("landingTagline", e.target.value)}
              placeholder="Ej: Tu salud dental, nuestra prioridad"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            <button onClick={() => save({ landingTagline: clinic.landingTagline })}
              className="mt-2 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">Guardar</button>
          </div>

          {/* Sobre la clínica + estadísticas */}
          <div className="border-t border-border pt-5">
            <label className="text-sm font-semibold block mb-1">Sobre la clínica</label>
            <p className="text-xs text-muted-foreground mb-2">Descripción de tu clínica para tu página pública</p>
            <textarea value={clinic.description ?? ""}
              onChange={e => updateLocal("description", e.target.value)}
              placeholder="Somos una clínica dedicada a…" rows={3}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background resize-none" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-sm font-semibold block mb-1">Años de experiencia</label>
                <input type="number" min={0} value={clinic.landingYearsExperience ?? ""}
                  onChange={e => updateLocal("landingYearsExperience", e.target.value === "" ? null : Math.trunc(Number(e.target.value)))}
                  placeholder="12"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">Pacientes atendidos</label>
                <input value={clinic.landingPatients ?? ""}
                  onChange={e => updateLocal("landingPatients", e.target.value)}
                  placeholder="8,500+"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
              </div>
            </div>
            <button onClick={() => save({
              description: clinic.description,
              landingYearsExperience: clinic.landingYearsExperience,
              landingPatients: clinic.landingPatients,
            })} disabled={saving}
              className="mt-3 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              Guardar información
            </button>
          </div>

          {/* Cover photo */}
          <div>
            <label className="text-sm font-semibold block mb-1">Foto de portada</label>
            <p className="text-xs text-muted-foreground mb-2">Imagen de fondo del hero (recomendado: 1920×600)</p>
            {clinic.landingCoverUrl && (
              <div className="relative mb-3">
                <img src={clinic.landingCoverUrl} alt="Portada" className="w-full h-32 object-cover rounded-xl" />
                <button onClick={() => { updateLocal("landingCoverUrl", null); save({ landingCoverUrl: null }); }}
                  className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-lg"><Trash2 size={12}/></button>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-semibold border border-border rounded-xl px-4 py-3 cursor-pointer hover:bg-muted w-fit">
              <Upload size={16}/> {clinic.landingCoverUrl ? "Reemplazar foto" : "Subir foto de portada"}
              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                try {
                  const url = await uploadImage(file, "cover");
                  updateLocal("landingCoverUrl", url);
                  await save({ landingCoverUrl: url });
                } catch { toast.error("Error al subir"); }
              }} />
            </label>
          </div>

          {/* Map embed */}
          <div>
            <label className="text-sm font-semibold block mb-1">Google Maps embed URL</label>
            <p className="text-xs text-muted-foreground mb-2">
              En Google Maps: Compartir → Insertar mapa → copia la URL del src del iframe
            </p>
            <input value={clinic.landingMapEmbed ?? ""}
              onChange={e => updateLocal("landingMapEmbed", e.target.value)}
              placeholder="https://www.google.com/maps/embed?pb=..."
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            <button onClick={() => save({ landingMapEmbed: clinic.landingMapEmbed })}
              className="mt-2 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">Guardar</button>
          </div>
        </div>
      )}

      {/* ── SERVICIOS ── */}
      {tab === "servicios" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">Servicios y procedimientos</h3>
              <p className="text-xs text-muted-foreground">Aparecen en la sección de servicios de tu landing</p>
            </div>
            <button onClick={addService} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> Agregar
            </button>
          </div>
          {services.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Sin servicios — agrega tu primer servicio
            </div>
          )}
          {services.map((svc, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">Servicio {i+1}</span>
                <button onClick={() => removeService(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Emoji / Ícono</label>
                  <input value={svc.icon} onChange={e => updateService(i,"icon",e.target.value)}
                    placeholder="🦷" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Precio (opcional)</label>
                  <input value={svc.price} onChange={e => updateService(i,"price",e.target.value)}
                    placeholder="Desde $500" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Nombre del servicio *</label>
                <input value={svc.name} onChange={e => updateService(i,"name",e.target.value)}
                  placeholder="Limpieza dental" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Descripción</label>
                <textarea value={svc.desc} onChange={e => updateService(i,"desc",e.target.value)}
                  placeholder="Profilaxis completa con ultrasonido…" rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
            </div>
          ))}
          {services.length > 0 && (
            <button onClick={() => save({ landingServices: services })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? "Guardando…" : "💾 Guardar servicios"}
            </button>
          )}
        </div>
      )}

      {/* ── TESTIMONIOS ── */}
      {tab === "testimonios" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">Testimonios de pacientes</h3>
              <p className="text-xs text-muted-foreground">Reseñas reales que generan confianza</p>
            </div>
            <button onClick={addTestimonial} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> Agregar
            </button>
          </div>
          {testimonials.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin testimonios aún</div>
          )}
          {testimonials.map((t, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">Testimonio {i+1}</span>
                <button onClick={() => removeTestimonial(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Nombre del paciente</label>
                  <input value={t.name} onChange={e => updateTestimonial(i,"name",e.target.value)}
                    placeholder="María García" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Calificación (1-5)</label>
                  <select value={t.rating} onChange={e => updateTestimonial(i,"rating",parseInt(e.target.value))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background">
                    {[5,4,3,2,1].map(n => <option key={n} value={n}>{"⭐".repeat(n)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Comentario</label>
                <textarea value={t.text} onChange={e => updateTestimonial(i,"text",e.target.value)}
                  placeholder="Excelente atención, el doctor fue muy amable…" rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fecha (opcional)</label>
                <input value={t.date ?? ""} onChange={e => updateTestimonial(i,"date",e.target.value)}
                  placeholder="Enero 2025" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
            </div>
          ))}
          {testimonials.length > 0 && (
            <button onClick={() => save({ landingTestimonials: testimonials })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? "Guardando…" : "💾 Guardar testimonios"}
            </button>
          )}
        </div>
      )}

      {/* ── FAQs ── */}
      {tab === "faqs" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">Preguntas frecuentes</h3>
              <p className="text-xs text-muted-foreground">Responde las dudas más comunes de tus pacientes</p>
            </div>
            <button onClick={addFaq} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> Agregar
            </button>
          </div>
          {faqs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin preguntas aún</div>
          )}
          {faqs.map((faq, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">Pregunta {i+1}</span>
                <button onClick={() => removeFaq(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Pregunta</label>
                <input value={faq.question} onChange={e => updateFaq(i,"question",e.target.value)}
                  placeholder="¿Aceptan seguros médicos?" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Respuesta</label>
                <textarea value={faq.answer} onChange={e => updateFaq(i,"answer",e.target.value)}
                  placeholder="Sí, trabajamos con los principales seguros del país…" rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
            </div>
          ))}
          {faqs.length > 0 && (
            <button onClick={() => save({ landingFaqs: faqs })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? "Guardando…" : "💾 Guardar FAQs"}
            </button>
          )}
        </div>
      )}

      {/* ── GALERÍA ── */}
      {tab === "galeria" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Galería de fotos</h3>
              <p className="text-xs text-muted-foreground">Fotos de tu clínica, instalaciones o resultados (máx 12)</p>
            </div>
            <label className={`flex items-center gap-1.5 text-sm font-semibold rounded-xl px-3 py-2 cursor-pointer shrink-0 ${clinic.landingGallery.length >= 12 ? "opacity-50 pointer-events-none border border-border" : "bg-brand-600 text-white"}`}>
              <ImagePlus size={15}/> Agregar foto
              <input type="file" accept="image/*" className="hidden" disabled={clinic.landingGallery.length >= 12}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (clinic.landingGallery.length >= 12) { toast.error("Máximo 12 fotos"); return; }
                  try {
                    const url = await uploadImage(file, "gallery");
                    const newGallery = [...clinic.landingGallery, url];
                    updateLocal("landingGallery", newGallery);
                    await save({ landingGallery: newGallery });
                  } catch { toast.error("Error al subir"); }
                }} />
            </label>
          </div>

          {/* Nota: las fotos de los doctores viven en Equipo */}
          <div className="flex items-center gap-2 text-xs bg-brand-600/10 border border-brand-200 dark:border-brand-800 rounded-xl px-3 py-2">
            <Users size={14} className="text-brand-600 shrink-0"/>
            <span className="text-muted-foreground">
              Las fotos de los doctores se suben en{" "}
              <a href="/dashboard/team" className="font-semibold text-brand-600 hover:underline">Equipo</a>.
            </span>
          </div>

          {/* Ayuda: cómo ordenar y qué es la portada */}
          {clinic.landingGallery.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Usa las flechas para ordenar las fotos. La portada es la foto grande que se muestra al inicio de tu página.
            </p>
          )}

          {clinic.landingGallery.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {clinic.landingGallery.map((url, i) => {
                const isCover = url === clinic.landingCoverUrl;
                const isFirst = i === 0;
                const isLast  = i === clinic.landingGallery.length - 1;
                return (
                  <div key={i}
                    className={`relative aspect-square rounded-xl overflow-hidden border ${isCover ? "border-brand-500 ring-2 ring-brand-500/50" : "border-border"}`}>
                    <img src={url} alt={`Foto ${i+1}`} className="w-full h-full object-cover" />

                    {/* Badge de posición — SIEMPRE visible */}
                    <span className="absolute top-1.5 left-1.5 bg-black/65 text-white text-[11px] font-bold rounded-md px-1.5 py-0.5 leading-none">
                      #{i+1}
                    </span>

                    {/* Portada — badge si ya lo es, botón "Usar como portada" si no */}
                    {isCover ? (
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold rounded-md px-1.5 py-0.5 leading-none shadow">
                        <Star size={10} className="fill-current"/> Portada
                      </span>
                    ) : (
                      <button type="button" onClick={() => setGalleryCover(url)} disabled={saving}
                        aria-label="Usar como portada" title="Usar como portada"
                        className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/65 hover:bg-brand-600 text-white text-[10px] font-semibold rounded-md px-1.5 py-0.5 leading-none transition-colors disabled:opacity-50">
                        <Star size={10}/> Portada
                      </button>
                    )}

                    {/* Flechas de reordenar — SIEMPRE visibles (deshabilitadas en los extremos) */}
                    <div className="absolute top-1/2 -translate-y-1/2 inset-x-1.5 flex justify-between pointer-events-none">
                      <button type="button" onClick={() => moveGalleryPhoto(i, -1)} disabled={saving || isFirst}
                        aria-label="Mover una posición a la izquierda" title="Mover a la izquierda"
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronLeft size={16}/>
                      </button>
                      <button type="button" onClick={() => moveGalleryPhoto(i, 1)} disabled={saving || isLast}
                        aria-label="Mover una posición a la derecha" title="Mover a la derecha"
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronRight size={16}/>
                      </button>
                    </div>

                    {/* Barra de acciones — SIEMPRE visible */}
                    <div className="absolute inset-x-0 bottom-0 flex divide-x divide-white/20 bg-black/65">
                      <label aria-label="Reemplazar foto" title="Reemplazar"
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 cursor-pointer hover:bg-white/15">
                        <RefreshCw size={12}/> <span className="hidden sm:inline">Reemplazar</span>
                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            const newUrl = await uploadImage(file, "gallery");
                            const newGallery = clinic.landingGallery.map((u,j) => j===i ? newUrl : u);
                            updateLocal("landingGallery", newGallery);
                            await save({ landingGallery: newGallery });
                          } catch { toast.error("Error al subir"); }
                        }} />
                      </label>
                      <button type="button" aria-label="Eliminar foto" title="Eliminar"
                        onClick={async () => {
                          const newGallery = clinic.landingGallery.filter((_,j) => j !== i);
                          updateLocal("landingGallery", newGallery);
                          await save({ landingGallery: newGallery });
                        }}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 hover:bg-red-600/70">
                        <Trash2 size={12}/> <span className="hidden sm:inline">Eliminar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin fotos — agrega tu primera imagen</div>
          )}
        </div>
      )}

      {/* ── REDES Y CONTACTO ── */}
      {tab === "redes" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h3 className="font-bold">Redes sociales y contacto</h3>
          {[
            { key:"landingWhatsapp",  label:"WhatsApp",  placeholder:"+52 999 123 4567", desc:"Número con código de país para botón de contacto" },
            { key:"landingInstagram", label:"Instagram",  placeholder:"@tuclinica",      desc:"Solo el @usuario" },
            { key:"landingFacebook",  label:"Facebook",   placeholder:"https://facebook.com/tuclinica", desc:"URL completa de tu página" },
            { key:"landingTiktok",    label:"TikTok",     placeholder:"@tuclinica",      desc:"Solo el @usuario" },
          ].map(field => (
            <div key={field.key}>
              <label className="text-sm font-semibold block mb-0.5">{field.label}</label>
              <p className="text-xs text-muted-foreground mb-1.5">{field.desc}</p>
              <input value={(clinic as any)[field.key] ?? ""}
                onChange={e => updateLocal(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            </div>
          ))}
          <button onClick={() => save({
            landingWhatsapp: clinic.landingWhatsapp,
            landingInstagram: clinic.landingInstagram,
            landingFacebook: clinic.landingFacebook,
            landingTiktok: clinic.landingTiktok,
          })} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
            {saving ? "Guardando…" : "💾 Guardar redes sociales"}
          </button>
        </div>
      )}
    </div>
  );
}
