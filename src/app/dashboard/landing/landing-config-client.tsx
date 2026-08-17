"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink, Copy, Eye, Plus, Trash2, Check, Sparkles, RefreshCw, Users, ImagePlus, ChevronLeft, ChevronRight, Star, HelpCircle, Stethoscope, Share2, Monitor, Smartphone, Zap, Lock, Layers } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { ManifestEditor } from "./manifest-editor";
import type { SectionState } from "@/app/[slug]/_shared/landing-data";
import { LIVE_PREVIEW_FIELDS, parseLiveMessage, postLivePreview, type LivePreviewPatch } from "@/app/[slug]/_shared/live-preview";
import { manifestOf, plantillaLeeManifiesto, plantillasQueLeenManifiesto } from "@/app/[slug]/_shared/template-manifest";
import { prepararImagen } from "@/lib/image-client";

/** Cuánto se espera antes de mandar al iframe. Escribir un párrafo manda un
    puñado de mensajes, no uno por tecla. */
const RETARDO_VISTA_PREVIA = 350;

/** Firma comparable de un valor. `undefined` y `null` cuentan como lo mismo. */
const firma = (v: unknown) => JSON.stringify(v === undefined ? null : v);

interface Clinic {
  id: string; name: string; slug: string; phone: string|null; email: string|null;
  address: string|null; city: string|null; logoUrl: string|null; description: string|null;
  landingActive: boolean; landingThemeColor: string|null; landingCoverUrl: string|null;
  landingGallery: string[]; landingTestimonials: any; landingFaqs: any;
  landingServices: any; landingWhatsapp: string|null; landingInstagram: string|null;
  landingFacebook: string|null; landingTiktok: string|null; landingMapEmbed: string|null;
  landingTagline: string|null;
  landingTemplate: string|null; landingYearsExperience: number|null; landingPatients: string|null;
  /* Landing v2 — opcionales: una clínica que nunca abrió el editor nuevo los
     tiene en null y el manifiesto rellena los valores por defecto. */
  landingSections?: unknown; landingPhotos?: unknown;
  landingUrgentText?: string|null; landingMsiPlazos?: number[];
}

/**
 * `puedeEditar` es el permiso "landing.edit" resuelto en el servidor. Sin él la
 * pantalla se ve completa pero en solo lectura: el endpoint responde 403 y de
 * nada sirve dejar los botones puestos para que fallen al pulsarlos.
 */
interface Props { clinic: Clinic; appUrl: string; puedeEditar: boolean }

const TABS = [
  { id:"plantilla",    labelKey:"pages.landing.tabTemplate"   },
  // Se dibuja SOLA desde el manifiesto de la plantilla activa: secciones,
  // textos y ranuras de foto. Ver _shared/template-manifest.ts.
  { id:"diseno",       labelKey:"pages.landing.tabDesign"     },
  { id:"general",      labelKey:"pages.landing.tabGeneral"    },
  { id:"servicios",    labelKey:"pages.landing.tabServices"   },
  { id:"testimonios",  labelKey:"pages.landing.tabTestimonials" },
  { id:"faqs",         labelKey:"pages.landing.tabFaqs"       },
  { id:"galeria",      labelKey:"pages.landing.tabGallery"    },
  { id:"redes",        labelKey:"pages.landing.tabSocial"     },
];

const TEMPLATES = [
  { id:"classic",    nameKey:"pages.landing.templateClassicName",    descKey:"pages.landing.templateClassicDesc" },
  { id:"futurista",  nameKey:"pages.landing.templateFuturistName",   descKey:"pages.landing.templateFuturistDesc" },
  { id:"healthtech", nameKey:"pages.landing.templateHealthtechName", descKey:"pages.landing.templateHealthtechDesc" },
  { id:"calido",     nameKey:"pages.landing.templateWarmName",       descKey:"pages.landing.templateWarmDesc" },
  { id:"equipo",       nameKey:"pages.landing.templateTeamName",        descKey:"pages.landing.templateTeamDesc" },
  { id:"sonrisa",      nameKey:"pages.landing.templateSmileName",       descKey:"pages.landing.templateSmileDesc" },
  { id:"consultorio",  nameKey:"pages.landing.templateOfficeName",      descKey:"pages.landing.templateOfficeDesc" },
  { id:"especialistas",nameKey:"pages.landing.templateSpecialistsName", descKey:"pages.landing.templateSpecialistsDesc" },
];

// ── Clases visuales compartidas (rediseño Variante A — solo presentación) ──
const CARD_CLS  = "bg-card border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] shadow-[var(--shadow-1)]";
const ITEM_CLS  = "border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] p-4 space-y-3";
const INPUT_CLS = "w-full bg-[color:var(--bg-elev)] text-sm text-[color:var(--text-1)] border border-[color:var(--border-soft)] rounded-[var(--radius)] px-3 py-2.5 placeholder:text-[color:var(--text-4)] transition-colors duration-150";
const LABEL_CLS = "text-[13px] font-medium text-[color:var(--text-2)] block mb-1";
const HELP_CLS  = "text-xs text-[color:var(--text-3)]";
const H_SECTION = "text-[15px] font-semibold text-[color:var(--text-1)]";
const EMPTY_CLS = "flex flex-col items-center gap-2 border border-dashed border-[color:var(--border-strong)] rounded-[var(--radius-lg)] py-10 px-4 text-center";
const BTN_PRIMARY    = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-[var(--radius)] text-sm font-semibold text-white bg-brand-600 shadow-[var(--shadow-1)] hover:bg-brand-700 hover:shadow-[var(--shadow-2)] active:scale-[0.98] transition disabled:opacity-[.45] disabled:cursor-not-allowed";
const BTN_PRIMARY_SM = "inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-sm)] text-[12.5px] font-semibold text-white bg-brand-600 shadow-[var(--shadow-1)] hover:bg-brand-700 hover:shadow-[var(--shadow-2)] active:scale-[0.98] transition disabled:opacity-[.45] disabled:cursor-not-allowed";
const BTN_SECONDARY  = "inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-[var(--radius)] text-sm font-semibold text-[color:var(--text-2)] bg-card border border-[color:var(--border-soft)] shadow-[var(--shadow-1)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text-1)] active:scale-[0.98] transition";
const BTN_SAVE_FULL  = "w-full inline-flex items-center justify-center h-11 rounded-[var(--radius)] text-sm font-semibold text-white bg-brand-600 shadow-[var(--shadow-1)] hover:bg-brand-700 hover:shadow-[var(--shadow-2)] active:scale-[0.99] transition disabled:opacity-[.45] disabled:cursor-not-allowed";
const BTN_ICON_DANGER = "inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-[var(--radius-sm)] text-[color:var(--text-3)] hover:text-[color:var(--danger)] hover:bg-[color:var(--danger-soft)] active:scale-[0.98] transition-colors";

// Mini-mock CSS de cada plantilla (no usa fotos reales) para el selector.
function TemplateThumb({ variant }: { variant: string }) {
  const v: Record<string, { bg:string; bar:string; chip:string; text:string }> = {
    classic:    { bg:"bg-gradient-to-br from-blue-500 to-blue-700",                  bar:"bg-white/90",  chip:"bg-white/70",       text:"bg-white/40" },
    futurista:  { bg:"bg-gradient-to-br from-fuchsia-600 via-violet-700 to-slate-900", bar:"bg-cyan-300",  chip:"bg-fuchsia-300/80", text:"bg-white/30" },
    healthtech: { bg:"bg-gradient-to-br from-emerald-400 to-teal-700",               bar:"bg-white/90",  chip:"bg-emerald-100/80", text:"bg-white/40" },
    calido:     { bg:"bg-gradient-to-br from-amber-300 via-rose-300 to-orange-400",  bar:"bg-white/95",  chip:"bg-rose-100/90",    text:"bg-amber-900/25" },
    // Las cuatro nuevas. El thumb es una miniatura abstracta: lo que
    // distingue a cada una es la estructura, no el color de esa clínica.
    equipo:       { bg:"bg-gradient-to-br from-teal-600 to-emerald-800",             bar:"bg-white/90",  chip:"bg-emerald-200/80", text:"bg-white/35" },
    sonrisa:      { bg:"bg-gradient-to-br from-rose-300 via-stone-100 to-rose-400",  bar:"bg-stone-800/80", chip:"bg-rose-500/70", text:"bg-stone-800/20" },
    consultorio:  { bg:"bg-gradient-to-br from-blue-700 to-blue-900",                bar:"bg-amber-300", chip:"bg-white/70",       text:"bg-white/30" },
    especialistas:{ bg:"bg-gradient-to-br from-slate-900 to-slate-800",              bar:"bg-amber-200/90", chip:"bg-amber-200/60", text:"bg-white/15" },
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

export function LandingConfigClient({ clinic: initial, appUrl, puedeEditar }: Props) {
  const t = useT();
  const [clinic, setClinic] = useState(initial);
  const [tab, setTab]       = useState("plantilla");
  const [saving, setSaving] = useState(false);
  const [templateSel, setTemplateSel] = useState(initial.landingTemplate ?? "classic");
  /* El nonce cambia en cada guardado y RECARGA el iframe (su key depende de
     él). Es la red de seguridad: lo que se ve tras guardar sale del servidor,
     no de un parche. Los cambios sin guardar viajan por postMessage. */
  const [previewNonce, setPreviewNonce] = useState(0);
  const [previewAncho, setPreviewAncho] = useState<"escritorio" | "movil">("escritorio");
  /**
   * Lo PUBLICADO, campo por campo (nombre → JSON del valor).
   *
   * Campo por campo y no una foto entera del formulario: esta pantalla tiene
   * un botón "Guardar" por bloque, así que guardar el eslogan no publica las
   * secciones que quedaron tocadas. Con una sola foto, ese guardado apagaba
   * el aviso de "sin guardar" y la clínica se iba creyendo que su sitio ya
   * tenía cambios que seguían en el navegador.
   */
  const [publicado, setPublicado] = useState<Record<string, string> | null>(null);

  const landingUrl = `${appUrl}/${clinic.slug}`;

  function updateLocal(key: string, value: any) {
    setClinic(c => ({ ...c, [key]: value }));
  }

  /** El error legible de una respuesta que puede no ser ni JSON (413 del CDN). */
  async function motivoDelFallo(res: Response): Promise<string> {
    if (res.status === 403) return "No tienes permiso para editar la página web. Pídeselo al dueño de la clínica.";
    if (res.status === 413) return "El archivo pesa demasiado para enviarlo.";
    try {
      const j = await res.json();
      if (j?.error) return String(j.error);
    } catch { /* respuesta HTML del runtime: no hay JSON que leer */ }
    return "No pudimos guardar. Vuelve a intentarlo.";
  }

  async function save(data: Record<string, any>, successMsg = t("pages.landing.saved")) {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic-landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await motivoDelFallo(res));
      await res.json();
      // El servidor ya no devuelve la fila de la clínica (traía RFC, ids de
      // Stripe y el SID de Twilio): lo que se acaba de guardar es exactamente
      // lo que se mandó, y de ahí sale el estado local.
      setClinic(c => ({ ...c, ...data }));
      // El sitio público ya se revalidó en el servidor; aquí se refresca la
      // vista previa para que la clínica vea el cambio sin recargar nada.
      setPreviewNonce(n => n + 1);
      // Solo los campos que IBAN en este guardado pasan a "publicado": los
      // demás siguen contando como sin guardar. Se firma lo que se mandó (no
      // lo que devuelve el servidor) porque es lo mismo que arma el parche.
      setPublicado(prev => {
        const next = { ...(prev ?? {}) };
        for (const campo of LIVE_PREVIEW_FIELDS) if (campo in data) next[campo] = firma(data[campo]);
        return next;
      });
      toast.success(successMsg);
    } catch(e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  /**
   * Sube una imagen de la mini-web.
   *
   * Se comprime ANTES de salir del navegador (@/lib/image-client): el runtime
   * corta el cuerpo de la petición en ~4.5 MB y una foto de celular pesa el
   * triple. Los errores de prepararImagen ya vienen escritos para la clínica.
   */
  async function uploadImage(file: File, field: string) {
    const listo = await prepararImagen(file);
    const formData = new FormData();
    formData.append("file", listo);
    formData.append("field", field);
    const res = await fetch("/api/landing-upload", { method:"POST", body:formData });
    if (!res.ok) throw new Error(await motivoDelFallo(res));
    const { url } = await res.json();
    return url;
  }

  // ── Plantilla: previsualizar (sin publicar) y aplicar (publica)
  function previewTemplate(id: string = templateSel) {
    // /landing-preview es la ruta DINÁMICA de vista previa; /[slug] es ISR y
    // no puede leer ?preview= (DYNAMIC_SERVER_USAGE al regenerar).
    window.open(`/landing-preview/${clinic.slug}?preview=${id}`, "_blank", "noopener");
  }

  async function applyTemplate() {
    const tpl = TEMPLATES.find(item => item.id === templateSel);
    const name = tpl ? t(tpl.nameKey) : templateSel;
    updateLocal("landingTemplate", templateSel);
    if (!clinic.landingActive) updateLocal("landingActive", true);
    await save({ landingTemplate: templateSel, landingActive: true }, t("pages.landing.templateApplied", { name }));
  }

  // ── Secciones y fotos guardadas (landing v2) — el editor por manifiesto
  //    las recibe ya normalizadas y devuelve el objeto completo al guardar.
  const savedSections = useMemo(() => {
    const raw = (clinic as any).landingSections;
    if (!Array.isArray(raw)) return [] as SectionState[];
    return raw
      .filter((s: any) => s && typeof s.id === "string")
      .map((s: any, i: number) => ({
        id: s.id,
        visible: s.visible !== false,
        orden: Number.isFinite(Number(s.orden)) ? Number(s.orden) : i,
        titulo: typeof s.titulo === "string" && s.titulo.trim() ? s.titulo : null,
        subtitulo: typeof s.subtitulo === "string" && s.subtitulo.trim() ? s.subtitulo : null,
      })) as SectionState[];
  }, [clinic]);

  const savedPhotos = useMemo(() => {
    const raw = (clinic as any).landingPhotos;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v.trim()) out[k] = v;
    return out;
  }, [clinic]);

  // ── Servicios state
  const [services, setServices] = useState<any[]>(Array.isArray(clinic.landingServices) ? clinic.landingServices : []);
  function addService() { setServices(s => [...s, { name:"", desc:"", price:"", durationMin:30, icon:"🦷" }]); }
  function removeService(i: number) { setServices(s => s.filter((_,j) => j !== i)); }
  function updateService(i: number, k: string, v: string) { setServices(s => s.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── Testimonios state
  const [testimonials, setTestimonials] = useState<any[]>(Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : []);
  function addTestimonial() { setTestimonials(prev => [...prev, { name:"", text:"", rating:5, date:"" }]); }
  function removeTestimonial(i: number) { setTestimonials(prev => prev.filter((_,j) => j !== i)); }
  function updateTestimonial(i: number, k: string, v: any) { setTestimonials(prev => prev.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── FAQs state
  const [faqs, setFaqs] = useState<any[]>(Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : []);
  function addFaq() { setFaqs(f => [...f, { question:"", answer:"" }]); }
  function removeFaq(i: number) { setFaqs(f => f.filter((_,j) => j !== i)); }
  function updateFaq(i: number, k: string, v: string) { setFaqs(f => f.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  /* ══════════════════════════════════════════════════════════════════
     VISTA PREVIA EN VIVO

     El iframe ya no espera al guardado: se le manda por postMessage lo
     que hay escrito y él se repinta sin recargarse (nada de parpadeo ni
     de perder el scroll). Recargar sigue existiendo como red de
     seguridad — al guardar y al cambiar de plantilla.

     ⚠️ Viajan SOLO los campos que este formulario edita. Nunca el objeto
     `clinic`: la fila trae credenciales (tokens de WhatsApp, llave de
     Facturapi) y ya nos costó una fuga (commit 0424d5ab). Del otro lado
     hay además una allowlist que tira cualquier clave que no sea de esta
     lista, así que las dos puntas tienen que estar de acuerdo.
     ══════════════════════════════════════════════════════════════════ */
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  /** Secciones y textos que el editor por manifiesto lleva SIN guardar. */
  const [draftSections, setDraftSections] = useState<SectionState[] | null>(null);

  const livePatch = useMemo<LivePreviewPatch>(() => ({
    // Identidad y contacto: las ocho plantillas los pintan (encabezado, pie y
    // bloque de contacto), así que se ven cambiar mientras se escriben.
    name:                   clinic.name,
    phone:                  clinic.phone,
    email:                  clinic.email,
    address:                clinic.address,
    description:            clinic.description,
    landingThemeColor:      clinic.landingThemeColor,
    landingTagline:         clinic.landingTagline,
    landingYearsExperience: clinic.landingYearsExperience,
    landingPatients:        clinic.landingPatients,
    landingUrgentText:      clinic.landingUrgentText ?? null,
    landingMsiPlazos:       Array.isArray(clinic.landingMsiPlazos) ? clinic.landingMsiPlazos : [],
    landingCoverUrl:        clinic.landingCoverUrl,
    landingGallery:         clinic.landingGallery ?? [],
    landingMapEmbed:        clinic.landingMapEmbed,
    // durationMin como NÚMERO, igual que al guardar: el input lo entrega
    // en texto y la plantilla hace cuentas con él.
    landingServices:        services.map(s => ({
      ...s,
      durationMin: s.durationMin === "" || s.durationMin == null ? null : Number(s.durationMin),
    })),
    landingTestimonials:    testimonials,
    landingFaqs:            faqs,
    landingWhatsapp:        clinic.landingWhatsapp,
    landingInstagram:       clinic.landingInstagram,
    landingFacebook:        clinic.landingFacebook,
    landingTiktok:          clinic.landingTiktok,
    landingSections:        draftSections ?? savedSections,
    landingPhotos:          savedPhotos,
  }), [clinic, services, testimonials, faqs, draftSections, savedSections, savedPhotos]);

  /* ── ¿Hay algo sin guardar? Campo contra campo, contra lo publicado. ── */
  useEffect(() => {
    // Al montar, lo que hay en el formulario ES lo publicado. Después solo
    // lo toca save(), y solo en los campos que viajaron.
    if (publicado !== null) return;
    const inicial: Record<string, string> = {};
    for (const campo of LIVE_PREVIEW_FIELDS) inicial[campo] = firma((livePatch as any)[campo]);
    setPublicado(inicial);
  }, [publicado, livePatch]);

  const sinGuardar = useMemo(() => {
    if (!publicado) return false;
    return LIVE_PREVIEW_FIELDS.some(campo => firma((livePatch as any)[campo]) !== publicado[campo]);
  }, [livePatch, publicado]);

  /* ── Cerrar con cambios sin guardar avisa ──────────────────────────
     Esta pantalla tiene un botón "Guardar" por bloque: es fácil escribir el
     eslogan, cambiar de pestaña y cerrar creyendo que ya estaba publicado.
     El navegador enseña SU diálogo (el texto no se puede personalizar desde
     2011); lo que importa es que no se pierda el trabajo. */
  useEffect(() => {
    if (!sinGuardar) return;
    function alSalir(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [sinGuardar]);

  /* ── Enviar con retardo. Si el iframe todavía no cargó, postMessage no
        hace nada y el saludo de abajo lo pone al día. ───────────────── */
  const patchRef = useRef(livePatch);
  useEffect(() => { patchRef.current = livePatch; }, [livePatch]);
  useEffect(() => {
    const id = setTimeout(
      () => postLivePreview(iframeRef.current?.contentWindow, clinic.slug, livePatch),
      RETARDO_VISTA_PREVIA,
    );
    return () => clearTimeout(id);
  }, [livePatch, clinic.slug]);

  /* ── Saludo del iframe: avisa cuando ya puede recibir (al cargar y en
        cada recarga) y se le manda de una lo que haya escrito. ─────── */
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const msg = parseLiveMessage(ev, clinic.slug);
      if (!msg || msg.kind !== "ready") return;
      postLivePreview(iframeRef.current?.contentWindow, clinic.slug, patchRef.current);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clinic.slug]);

  // ── Galería: reordenar (intercambia i con su vecino) y elegir portada
  async function moveGalleryPhoto(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= clinic.landingGallery.length) return;
    const nuevo = [...clinic.landingGallery];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    updateLocal("landingGallery", nuevo);
    await save({ landingGallery: nuevo }, t("pages.landing.orderUpdated"));
  }
  async function setGalleryCover(url: string) {
    updateLocal("landingCoverUrl", url);
    await save({ landingCoverUrl: url }, t("pages.landing.coverUpdated"));
  }

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[color:var(--text-1)]">{t("pages.landing.title")}</h1>
          <p className="text-sm text-[color:var(--text-3)] mt-0.5">{t("pages.landing.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Active toggle */}
          <div className="flex items-center gap-2.5 bg-card border border-[color:var(--border-soft)] rounded-[var(--radius)] shadow-[var(--shadow-1)] h-10 pl-3 pr-2.5">
            <span className={`text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${clinic.landingActive ? "bg-[color:var(--success-soft)] text-[color:var(--success-strong)]" : "bg-[color:var(--bg-elev-2)] text-[color:var(--text-2)]"}`}>
              {clinic.landingActive ? t("pages.landing.statusPublished") : t("pages.landing.statusHidden")}
            </span>
            <button role="switch" aria-checked={clinic.landingActive} disabled={!puedeEditar || saving}
              aria-label={clinic.landingActive ? t("pages.landing.statusPublished") : t("pages.landing.statusHidden")}
              onClick={async () => {
              const newVal = !clinic.landingActive;
              updateLocal("landingActive", newVal);
              await save({ landingActive: newVal });
            }} className={`w-10 h-5 rounded-full relative transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${clinic.landingActive ? "bg-brand-600" : "bg-[color:var(--border-strong)]"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-all duration-150 ${clinic.landingActive ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          {/* View link */}
          <a href={landingUrl} target="_blank" rel="noreferrer" className={BTN_SECONDARY}>
            <ExternalLink size={16} strokeWidth={1.75}/> {t("pages.landing.viewPage")}
          </a>
          {/* Copy link */}
          <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success(t("pages.landing.linkCopied")); }}
            className={BTN_SECONDARY}>
            <Copy size={16} strokeWidth={1.75}/> {t("pages.landing.copyLink")}
          </button>
        </div>
      </div>

      {/* Link preview */}
      <div className="bg-[color:var(--brand-soft)] border border-[color:var(--border-brand)] rounded-[var(--radius)] px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[color:var(--brand)] font-bold mb-0.5">{t("pages.landing.publicLink")}</div>
          <div className="text-sm font-mono font-semibold text-[color:var(--text-1)] truncate">{landingUrl}</div>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success(t("pages.landing.linkCopied")); }}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] text-[12.5px] font-semibold text-[color:var(--brand)] hover:bg-brand-600/10 active:scale-[0.98] transition">
          <Copy size={15} strokeWidth={1.75}/> {t("pages.landing.copy")}
        </button>
      </div>

      {/* Tabs → control segmentado del sistema. Fuera del <fieldset>: mirar las
          pestañas no es editar, y un usuario de solo lectura tiene que poder
          recorrer su sitio aunque no pueda tocarlo. */}
      <div className="overflow-x-auto -mx-1 px-1 pb-0.5">
        <div className="segment-new min-w-max" role="tablist" aria-label={t("pages.landing.title")}>
          {TABS.map(tb => (
            <button key={tb.id} role="tab" aria-selected={tab===tb.id} onClick={() => setTab(tb.id)}
              className={`segment-new__btn ${tab===tb.id ? "segment-new__btn--active" : ""}`}>
              {t(tb.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Solo lectura: se dice ANTES de que intente escribir, no con un 403
          después de haber redactado media página. */}
      {!puedeEditar && (
        <div className="flex items-start gap-2.5 bg-[color:var(--warning-soft)] border border-[color:var(--warning-border-strong)] rounded-[var(--radius)] px-4 py-3">
          <Lock size={16} strokeWidth={1.75} className="text-[color:var(--warning-strong)] shrink-0 mt-0.5" />
          <div className="text-sm text-[color:var(--text-2)]">
            <span className="font-semibold text-[color:var(--text-1)]">Estás viendo tu sitio en solo lectura.</span>{" "}
            Puedes recorrerlo y copiar el enlace, pero para cambiarlo o publicarlo hace falta el
            permiso <span className="font-mono text-[12.5px]">landing.edit</span>, que da el dueño de la clínica desde Equipo.
          </div>
        </div>
      )}

      {/* Todo lo editable vive dentro del <fieldset>: deshabilitarlo apaga de
          una vez inputs, botones y selectores de archivo, sin depender de que
          cada control nuevo se acuerde de preguntar por el permiso. `min-w-0`
          es obligatorio: un fieldset trae min-width:min-content y sin eso
          rompe el flex de la columna. */}
      <fieldset disabled={!puedeEditar} className="min-w-0 border-0 p-0 m-0 space-y-5 disabled:opacity-70">

      {/* ── PLANTILLA ── */}
      {tab === "plantilla" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <div>
            <h3 className={`${H_SECTION} flex items-center gap-1.5`}><Sparkles size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.templateHeading")}</h3>
            <p className={`${HELP_CLS} mt-0.5`}>{t("pages.landing.templateHelp")}</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TEMPLATES.map(tpl => {
              const selected = templateSel === tpl.id;
              return (
                <div key={tpl.id} role="button" tabIndex={0} aria-pressed={selected}
                  onClick={() => setTemplateSel(tpl.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTemplateSel(tpl.id); } }}
                  className={`cursor-pointer rounded-[var(--radius-lg)] border p-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${selected ? "border-[color:var(--brand)] ring-2 ring-brand-500/40 bg-[color:var(--brand-softer)]" : "border-[color:var(--border-soft)] hover:border-[color:var(--border-brand)]"}`}>
                  <div className="relative">
                    <TemplateThumb variant={tpl.id} />
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 bg-brand-600 text-white rounded-full p-0.5 shadow-[var(--shadow-2)]">
                        <Check size={12} strokeWidth={2}/>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[color:var(--text-1)]">{t(tpl.nameKey)}</span>
                    {clinic.landingTemplate === tpl.id && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[color:var(--success-strong)] bg-[color:var(--success-soft)] px-1.5 py-0.5 rounded-full">{t("pages.landing.templateActive")}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[color:var(--text-3)] mt-0.5 leading-snug">{t(tpl.descKey)}</p>
                  <button type="button" onClick={e => { e.stopPropagation(); previewTemplate(tpl.id); }}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-[color:var(--brand)] border border-[color:var(--border-brand)] rounded-[var(--radius-sm)] py-1.5 hover:bg-brand-600/10 active:scale-[0.98] transition">
                    <Eye size={14} strokeWidth={1.75}/> {t("pages.landing.preview")}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => previewTemplate()} className={BTN_SECONDARY}>
              <Eye size={16} strokeWidth={1.75}/> {t("pages.landing.previewSelection")}
            </button>
            <button type="button" onClick={applyTemplate} disabled={saving} className={BTN_PRIMARY}>
              <Check size={16} strokeWidth={1.75}/> {saving ? t("pages.landing.applying") : t("pages.landing.applyTemplate")}
            </button>
            {!clinic.landingActive && (
              <span className="text-xs text-[color:var(--warning-strong)]">{t("pages.landing.applyWillPublish")}</span>
            )}
          </div>
        </div>
      )}

      {/* ── DISEÑO: se dibuja solo desde el manifiesto de la plantilla ──
          Solo si la plantilla activa LEE el manifiesto. Las cuatro primeras
          (classic —la de por defecto—, futurista, healthtech y cálido) traen su
          lista de secciones escrita en el JSX: enseñarles estos interruptores
          era prometer algo que no pasaba. Quién sí y quién no sale del propio
          manifiesto, no de una lista escrita aquí. */}
      {tab === "diseno" && !plantillaLeeManifiesto(clinic.landingTemplate) && (
        <div className={`${CARD_CLS} p-5 space-y-3`}>
          <h3 className={`${H_SECTION} flex items-center gap-1.5`}>
            <Layers size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> Esta plantilla no se arma por secciones
          </h3>
          <p className="text-sm text-[color:var(--text-2)] leading-relaxed">
            “{manifestOf(clinic.landingTemplate).nombre}”
            {" "}trae su estructura fija: el orden de los bloques y sus títulos vienen de fábrica y
            se llenan solos con lo que escribes en las demás pestañas. Aquí no hay interruptores
            porque no habría nada que encender.
          </p>
          <p className={HELP_CLS}>
            Si quieres decidir qué secciones aparecen, cambia a{" "}
            <span className="font-semibold text-[color:var(--text-2)]">
              {plantillasQueLeenManifiesto().map(m => m.nombre).join(", ")}
            </span>.
          </p>
          <button type="button" onClick={() => setTab("plantilla")} className={BTN_SECONDARY}>
            <Sparkles size={16} strokeWidth={1.75}/> Ver las plantillas
          </button>
        </div>
      )}

      {tab === "diseno" && plantillaLeeManifiesto(clinic.landingTemplate) && (
        <ManifestEditor
          templateId={clinic.landingTemplate ?? "classic"}
          /* El borrador manda: así cambiar de pestaña y volver no pierde lo
             que la clínica llevaba escrito (ni descuadra la vista previa). */
          sections={draftSections ?? savedSections}
          photos={savedPhotos}
          saving={saving}
          onDraftSections={setDraftSections}
          onSaveSections={async (secs) => {
            updateLocal("landingSections", secs);
            setDraftSections(secs);
            await save({ landingSections: secs });
          }}
          onSavePhotos={async (fotos) => {
            updateLocal("landingPhotos", fotos);
            await save({ landingPhotos: fotos });
          }}
          onUpload={uploadImage}
        />
      )}

      {/* ── GENERAL ── */}
      {tab === "general" && (
        <div className={`${CARD_CLS} p-5 divide-y divide-[color:var(--border-soft)]`}>
          {/* Datos de contacto — los pintan las ocho plantillas (encabezado,
              pie y bloque de contacto) y hasta ahora solo se podían cambiar en
              Configuración, lejos de la vista previa. Son los mismos campos de
              la clínica: cambiarlos aquí los cambia en todo el producto. */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>Nombre de la clínica</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>
              Como aparece arriba del todo en tu sitio y en los mensajes a tus pacientes.
            </p>
            <input value={clinic.name ?? ""}
              onChange={e => updateLocal("name", e.target.value)}
              placeholder="Clínica Dental Sonrisa"
              className={INPUT_CLS} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className={LABEL_CLS}>Teléfono</label>
                <input value={clinic.phone ?? ""} inputMode="tel"
                  onChange={e => updateLocal("phone", e.target.value)}
                  placeholder="999 123 4567"
                  className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Correo</label>
                <input value={clinic.email ?? ""} inputMode="email"
                  onChange={e => updateLocal("email", e.target.value)}
                  placeholder="hola@tuclinica.com"
                  className={INPUT_CLS} />
              </div>
            </div>
            <div className="mt-3">
              <label className={LABEL_CLS}>Dirección</label>
              <input value={clinic.address ?? ""}
                onChange={e => updateLocal("address", e.target.value)}
                placeholder="Calle 20 #123, Col. Centro"
                className={INPUT_CLS} />
            </div>
            <button onClick={() => save({
              name: clinic.name,
              phone: clinic.phone,
              email: clinic.email,
              address: clinic.address,
            })} disabled={saving} className={`${BTN_PRIMARY_SM} mt-3`}>
              <Check size={16} strokeWidth={1.75}/> Guardar contacto
            </button>
          </div>

          {/* Theme color */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>{t("pages.landing.primaryColor")}</label>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="color" value={clinic.landingThemeColor ?? "#2563eb"}
                onChange={e => updateLocal("landingThemeColor", e.target.value)}
                aria-label={t("pages.landing.primaryColor")}
                className="h-10 w-16 rounded-[var(--radius)] cursor-pointer border border-[color:var(--border-soft)] bg-transparent p-1" />
              <span className="text-sm font-mono text-[color:var(--text-3)]">{clinic.landingThemeColor ?? "#2563eb"}</span>
              <button onClick={() => save({ landingThemeColor: clinic.landingThemeColor })} className={BTN_PRIMARY_SM}>
                <Check size={16} strokeWidth={1.75}/> {t("common.save")}
              </button>
            </div>
          </div>

          {/* Tagline */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>{t("pages.landing.taglineLabel")}</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>{t("pages.landing.taglineHelp")}</p>
            <input value={clinic.landingTagline ?? ""}
              onChange={e => updateLocal("landingTagline", e.target.value)}
              placeholder={t("pages.landing.taglinePlaceholder")}
              className={INPUT_CLS} />
            <button onClick={() => save({ landingTagline: clinic.landingTagline })} className={`${BTN_PRIMARY_SM} mt-2`}>
              <Check size={16} strokeWidth={1.75}/> {t("common.save")}
            </button>
          </div>

          {/* Sobre la clínica + estadísticas */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>{t("pages.landing.aboutClinic")}</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>{t("pages.landing.aboutClinicHelp")}</p>
            <textarea value={clinic.description ?? ""}
              onChange={e => updateLocal("description", e.target.value)}
              placeholder={t("pages.landing.aboutClinicPlaceholder")} rows={3}
              className={`${INPUT_CLS} resize-none`} />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.yearsExperience")}</label>
                <input type="number" min={0} value={clinic.landingYearsExperience ?? ""}
                  onChange={e => updateLocal("landingYearsExperience", e.target.value === "" ? null : Math.trunc(Number(e.target.value)))}
                  placeholder="12"
                  className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.patientsServed")}</label>
                <input value={clinic.landingPatients ?? ""}
                  onChange={e => updateLocal("landingPatients", e.target.value)}
                  placeholder="8,500+"
                  className={INPUT_CLS} />
              </div>
            </div>
            <button onClick={() => save({
              description: clinic.description,
              landingYearsExperience: clinic.landingYearsExperience,
              landingPatients: clinic.landingPatients,
            })} disabled={saving} className={`${BTN_PRIMARY_SM} mt-3`}>
              <Check size={16} strokeWidth={1.75}/> {t("pages.landing.saveInfo")}
            </button>
          </div>

          {/* Urgencias — el bloque no se pinta si el texto está vacío */}
          <div className="py-6 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label className={`${LABEL_CLS} flex items-center gap-1.5`}>
                  <Zap size={14} strokeWidth={1.75} className="text-[color:var(--warning-strong)]" /> Aviso de urgencias
                </label>
                <p className={`${HELP_CLS} -mt-0.5`}>
                  Qué haces con quien llega con dolor. Vacío = el bloque no aparece.
                </p>
                {!plantillaLeeManifiesto(clinic.landingTemplate) && (
                  <p className="text-xs text-[color:var(--warning-strong)] mt-1">
                    “{manifestOf(clinic.landingTemplate).nombre}” no pinta este aviso. Se guarda y
                    aparece en cuanto cambies a una plantilla que sí lo tenga.
                  </p>
                )}
              </div>
              <button role="switch" aria-checked={!!clinic.landingUrgentText}
                aria-label="Mostrar el aviso de urgencias"
                onClick={() => {
                  const nuevo = clinic.landingUrgentText ? null : "Guardamos espacios al día para urgencias. Llámanos y te acomodamos hoy.";
                  updateLocal("landingUrgentText", nuevo);
                  save({ landingUrgentText: nuevo });
                }}
                className={`w-10 h-5 rounded-full relative transition-colors duration-150 shrink-0 ${clinic.landingUrgentText ? "bg-brand-600" : "bg-[color:var(--border-strong)]"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-all duration-150 ${clinic.landingUrgentText ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            {clinic.landingUrgentText != null && (
              <>
                <textarea value={clinic.landingUrgentText ?? ""}
                  onChange={e => updateLocal("landingUrgentText", e.target.value)}
                  placeholder="Guardamos dos espacios al día para dolor agudo."
                  rows={2} className={`${INPUT_CLS} resize-none mt-2`} />
                <button onClick={() => save({ landingUrgentText: clinic.landingUrgentText })}
                  disabled={saving} className={`${BTN_PRIMARY_SM} mt-3`}>
                  <Check size={16} strokeWidth={1.75}/> Guardar urgencias
                </button>
              </>
            )}
          </div>

          {/* Meses sin intereses — vacío = no se muestra nada de MSI */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>Meses sin intereses</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>
              Marca los plazos que aceptas. Sin ninguno marcado, la plantilla no
              menciona mensualidades.
            </p>
            {!plantillaLeeManifiesto(clinic.landingTemplate) && (
              <p className="text-xs text-[color:var(--warning-strong)] -mt-1 mb-2">
                “{manifestOf(clinic.landingTemplate).nombre}” no tiene bloque de mensualidades. Se
                guarda y aparece en cuanto cambies a una plantilla que sí lo tenga.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {[3, 6, 9, 12, 18, 24].map(m => {
                const actuales: number[] = Array.isArray(clinic.landingMsiPlazos) ? clinic.landingMsiPlazos : [];
                const on = actuales.includes(m);
                return (
                  <button key={m} type="button" aria-pressed={on}
                    onClick={() => {
                      const nuevos = on ? actuales.filter(x => x !== m) : [...actuales, m].sort((a, b) => a - b);
                      updateLocal("landingMsiPlazos", nuevos);
                    }}
                    className={`h-9 px-3.5 rounded-[var(--radius-sm)] text-[12.5px] font-semibold mono transition ${on ? "bg-brand-600 text-white" : "bg-card border border-[color:var(--border-soft)] text-[color:var(--text-2)] hover:bg-[color:var(--bg-hover)]"}`}>
                    {m} meses
                  </button>
                );
              })}
            </div>
            <button onClick={() => save({ landingMsiPlazos: Array.isArray(clinic.landingMsiPlazos) ? clinic.landingMsiPlazos : [] })}
              disabled={saving} className={`${BTN_PRIMARY_SM} mt-3`}>
              <Check size={16} strokeWidth={1.75}/> Guardar plazos
            </button>
          </div>

          {/* Cover photo */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>{t("pages.landing.coverPhoto")}</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>{t("pages.landing.coverPhotoHelp")}</p>
            {clinic.landingCoverUrl && (
              <div className="relative mb-3">
                <img src={clinic.landingCoverUrl} alt={t("pages.landing.coverAlt")} className="w-full h-32 object-cover rounded-[var(--radius)] border border-[color:var(--border-soft)]" />
                <button aria-label={t("common.delete")} onClick={() => { updateLocal("landingCoverUrl", null); save({ landingCoverUrl: null }); }}
                  className="absolute top-2 right-2 inline-flex items-center justify-center w-9 h-9 rounded-[var(--radius-sm)] bg-[color:var(--danger)] text-white shadow-[var(--shadow-2)] hover:bg-[color:var(--danger-strong)] active:scale-[0.98] transition"><Trash2 size={16} strokeWidth={1.75}/></button>
              </div>
            )}
            <label className="flex flex-col items-center justify-center gap-2 text-center border border-dashed border-[color:var(--border-strong)] rounded-[var(--radius-lg)] py-8 px-4 cursor-pointer text-[color:var(--text-2)] hover:border-[color:var(--border-brand)] hover:bg-[color:var(--brand-softer)] transition-colors">
              <ImagePlus size={20} strokeWidth={1.75} className="text-[color:var(--brand)]"/>
              <span className="text-sm font-semibold">{clinic.landingCoverUrl ? t("pages.landing.replacePhoto") : t("pages.landing.uploadCoverPhoto")}</span>
              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                try {
                  const url = await uploadImage(file, "cover");
                  updateLocal("landingCoverUrl", url);
                  await save({ landingCoverUrl: url });
                } catch (err: any) { toast.error(err?.message ?? t("pages.landing.uploadError")); }
              }} />
            </label>
          </div>

          {/* Map embed */}
          <div className="py-6 first:pt-0 last:pb-0">
            <label className={LABEL_CLS}>{t("pages.landing.mapEmbedLabel")}</label>
            <p className={`${HELP_CLS} -mt-0.5 mb-2`}>
              {t("pages.landing.mapEmbedHelp")}
            </p>
            <input value={clinic.landingMapEmbed ?? ""}
              onChange={e => updateLocal("landingMapEmbed", e.target.value)}
              placeholder="https://www.google.com/maps/embed?pb=..."
              className={INPUT_CLS} />
            <button onClick={() => save({ landingMapEmbed: clinic.landingMapEmbed })} className={`${BTN_PRIMARY_SM} mt-2`}>
              <Check size={16} strokeWidth={1.75}/> {t("common.save")}
            </button>
          </div>
        </div>
      )}

      {/* ── SERVICIOS ── */}
      {tab === "servicios" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className={`${H_SECTION} flex items-center gap-1.5`}><Stethoscope size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.servicesHeading")}</h3>
              <p className={`${HELP_CLS} mt-0.5`}>{t("pages.landing.servicesHelp")}</p>
            </div>
            <button onClick={addService} className={`${BTN_PRIMARY_SM} shrink-0`}>
              <Plus size={16} strokeWidth={1.75}/> {t("common.add")}
            </button>
          </div>
          {services.length === 0 && (
            <div className={EMPTY_CLS}>
              <Stethoscope size={24} strokeWidth={1.5} className="text-[color:var(--text-4)]"/>
              <p className="text-sm text-[color:var(--text-3)]">{t("pages.landing.servicesEmpty")}</p>
            </div>
          )}
          {services.map((svc, i) => (
            <div key={i} className={ITEM_CLS}>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[color:var(--text-3)]">{t("pages.landing.serviceN", { n: i+1 })}</span>
                <button aria-label={t("common.delete")} onClick={() => removeService(i)} className={BTN_ICON_DANGER}><Trash2 size={16} strokeWidth={1.75}/></button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={LABEL_CLS}>{t("pages.landing.emojiIcon")}</label>
                  <input value={svc.icon} onChange={e => updateService(i,"icon",e.target.value)}
                    placeholder="🦷" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>{t("pages.landing.priceOptional")}</label>
                  <input value={svc.price} onChange={e => updateService(i,"price",e.target.value)}
                    placeholder={t("pages.landing.priceFromPlaceholder")} className={INPUT_CLS} />
                </div>
                <div>
                  {/* La duración manda en la reserva: es el hueco que se aparta
                      en la agenda cuando el paciente elige este procedimiento. */}
                  <label className={LABEL_CLS}>Duración (min)</label>
                  <input type="number" min={5} max={600} step={5}
                    value={svc.durationMin ?? ""}
                    onChange={e => updateService(i,"durationMin", e.target.value === "" ? "" : String(Math.max(5, Math.min(600, Number(e.target.value)))))}
                    placeholder="30" className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.serviceName")}</label>
                <input value={svc.name} onChange={e => updateService(i,"name",e.target.value)}
                  placeholder={t("pages.landing.serviceNamePlaceholder")} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t("common.description")}</label>
                <textarea value={svc.desc} onChange={e => updateService(i,"desc",e.target.value)}
                  placeholder={t("pages.landing.serviceDescPlaceholder")} rows={2}
                  className={`${INPUT_CLS} resize-none`} />
              </div>
            </div>
          ))}
          {services.length > 0 && (
            <button onClick={() => save({
              // durationMin viaja como NÚMERO: el input lo entrega en texto y
              // un "30" string haría fallar las cuentas de la reserva.
              landingServices: services.map(s => ({
                ...s,
                durationMin: s.durationMin === "" || s.durationMin == null ? null : Number(s.durationMin),
              })),
            })} disabled={saving} className={BTN_SAVE_FULL}>
              {saving ? t("common.saving") : t("pages.landing.saveServices")}
            </button>
          )}
        </div>
      )}

      {/* ── TESTIMONIOS ── */}
      {tab === "testimonios" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className={`${H_SECTION} flex items-center gap-1.5`}><Star size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.testimonialsHeading")}</h3>
              <p className={`${HELP_CLS} mt-0.5`}>{t("pages.landing.testimonialsHelp")}</p>
            </div>
            <button onClick={addTestimonial} className={`${BTN_PRIMARY_SM} shrink-0`}>
              <Plus size={16} strokeWidth={1.75}/> {t("common.add")}
            </button>
          </div>
          {testimonials.length === 0 && (
            <div className={EMPTY_CLS}>
              <Star size={24} strokeWidth={1.5} className="text-[color:var(--text-4)]"/>
              <p className="text-sm text-[color:var(--text-3)]">{t("pages.landing.testimonialsEmpty")}</p>
            </div>
          )}
          {testimonials.map((item, i) => (
            <div key={i} className={ITEM_CLS}>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[color:var(--text-3)]">{t("pages.landing.testimonialN", { n: i+1 })}</span>
                <button aria-label={t("common.delete")} onClick={() => removeTestimonial(i)} className={BTN_ICON_DANGER}><Trash2 size={16} strokeWidth={1.75}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS}>{t("pages.landing.testimonialPatientName")}</label>
                  <input value={item.name} onChange={e => updateTestimonial(i,"name",e.target.value)}
                    placeholder="María García" className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>{t("pages.landing.rating")}</label>
                  <select value={item.rating} onChange={e => updateTestimonial(i,"rating",parseInt(e.target.value))}
                    className={INPUT_CLS}>
                    {[5,4,3,2,1].map(n => <option key={n} value={n}>{"⭐".repeat(n)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.comment")}</label>
                <textarea value={item.text} onChange={e => updateTestimonial(i,"text",e.target.value)}
                  placeholder={t("pages.landing.commentPlaceholder")} rows={2}
                  className={`${INPUT_CLS} resize-none`} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.dateOptional")}</label>
                <input value={item.date ?? ""} onChange={e => updateTestimonial(i,"date",e.target.value)}
                  placeholder={t("pages.landing.datePlaceholder")} className={INPUT_CLS} />
              </div>
            </div>
          ))}
          {testimonials.length > 0 && (
            <button onClick={() => save({ landingTestimonials: testimonials })} disabled={saving} className={BTN_SAVE_FULL}>
              {saving ? t("common.saving") : t("pages.landing.saveTestimonials")}
            </button>
          )}
        </div>
      )}

      {/* ── FAQs ── */}
      {tab === "faqs" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className={`${H_SECTION} flex items-center gap-1.5`}><HelpCircle size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.faqsHeading")}</h3>
              <p className={`${HELP_CLS} mt-0.5`}>{t("pages.landing.faqsHelp")}</p>
            </div>
            <button onClick={addFaq} className={`${BTN_PRIMARY_SM} shrink-0`}>
              <Plus size={16} strokeWidth={1.75}/> {t("common.add")}
            </button>
          </div>
          {faqs.length === 0 && (
            <div className={EMPTY_CLS}>
              <HelpCircle size={24} strokeWidth={1.5} className="text-[color:var(--text-4)]"/>
              <p className="text-sm text-[color:var(--text-3)]">{t("pages.landing.faqsEmpty")}</p>
            </div>
          )}
          {faqs.map((faq, i) => (
            <div key={i} className={ITEM_CLS}>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[color:var(--text-3)]">{t("pages.landing.questionN", { n: i+1 })}</span>
                <button aria-label={t("common.delete")} onClick={() => removeFaq(i)} className={BTN_ICON_DANGER}><Trash2 size={16} strokeWidth={1.75}/></button>
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.question")}</label>
                <input value={faq.question} onChange={e => updateFaq(i,"question",e.target.value)}
                  placeholder={t("pages.landing.questionPlaceholder")} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>{t("pages.landing.answer")}</label>
                <textarea value={faq.answer} onChange={e => updateFaq(i,"answer",e.target.value)}
                  placeholder={t("pages.landing.answerPlaceholder")} rows={2}
                  className={`${INPUT_CLS} resize-none`} />
              </div>
            </div>
          ))}
          {faqs.length > 0 && (
            <button onClick={() => save({ landingFaqs: faqs })} disabled={saving} className={BTN_SAVE_FULL}>
              {saving ? t("common.saving") : t("pages.landing.saveFaqs")}
            </button>
          )}
        </div>
      )}

      {/* ── GALERÍA ── */}
      {tab === "galeria" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className={`${H_SECTION} flex items-center gap-1.5`}><ImagePlus size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.galleryHeading")}</h3>
              <p className={`${HELP_CLS} mt-0.5`}>{t("pages.landing.galleryHelp")}</p>
            </div>
            <label className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[var(--radius-sm)] text-[12.5px] font-semibold cursor-pointer shrink-0 transition ${clinic.landingGallery.length >= 12 ? "opacity-[.45] pointer-events-none border border-[color:var(--border-soft)] text-[color:var(--text-3)]" : "bg-brand-600 text-white shadow-[var(--shadow-1)] hover:bg-brand-700 hover:shadow-[var(--shadow-2)] active:scale-[0.98]"}`}>
              <ImagePlus size={16} strokeWidth={1.75}/> {t("pages.landing.addPhoto")}
              <input type="file" accept="image/*" className="hidden" disabled={clinic.landingGallery.length >= 12}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (clinic.landingGallery.length >= 12) { toast.error(t("pages.landing.maxPhotos")); return; }
                  try {
                    const url = await uploadImage(file, "gallery");
                    const newGallery = [...clinic.landingGallery, url];
                    updateLocal("landingGallery", newGallery);
                    await save({ landingGallery: newGallery });
                  } catch (err: any) { toast.error(err?.message ?? t("pages.landing.uploadError")); }
                }} />
            </label>
          </div>

          {/* Nota: las fotos de los doctores viven en Equipo */}
          <div className="flex items-center gap-2 text-xs bg-[color:var(--brand-soft)] border border-[color:var(--border-brand)] rounded-[var(--radius)] px-3 py-2.5">
            <Users size={16} strokeWidth={1.75} className="text-[color:var(--brand)] shrink-0"/>
            <span className="text-[color:var(--text-2)]">
              {t("pages.landing.doctorPhotosNote")}{" "}
              <a href="/dashboard/team" className="font-semibold text-[color:var(--brand)] hover:underline">{t("pages.landing.teamLink")}</a>.
            </span>
          </div>

          {/* Ayuda: cómo ordenar y qué es la portada */}
          {clinic.landingGallery.length > 0 && (
            <p className={HELP_CLS}>
              {t("pages.landing.galleryOrderHelp")}
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
                    className={`relative aspect-square rounded-[var(--radius)] overflow-hidden border ${isCover ? "border-[color:var(--brand)] ring-2 ring-brand-500/50" : "border-[color:var(--border-soft)]"}`}>
                    <img src={url} alt={t("pages.landing.photoN", { n: i+1 })} className="w-full h-full object-cover" />

                    {/* Badge de posición — SIEMPRE visible */}
                    <span className="absolute top-1.5 left-1.5 bg-black/65 text-white text-[11px] font-bold rounded-md px-1.5 py-0.5 leading-none">
                      #{i+1}
                    </span>

                    {/* Portada — badge si ya lo es, botón "Usar como portada" si no */}
                    {isCover ? (
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold rounded-md px-1.5 py-0.5 leading-none shadow-[var(--shadow-2)]">
                        <Star size={10} strokeWidth={1.75} className="fill-current"/> {t("pages.landing.cover")}
                      </span>
                    ) : (
                      <button type="button" onClick={() => setGalleryCover(url)} disabled={saving}
                        aria-label={t("pages.landing.useAsCover")} title={t("pages.landing.useAsCover")}
                        className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/65 hover:bg-brand-600 text-white text-[10px] font-semibold rounded-md px-1.5 py-0.5 leading-none transition-colors disabled:opacity-[.45]">
                        <Star size={10} strokeWidth={1.75}/> {t("pages.landing.cover")}
                      </button>
                    )}

                    {/* Flechas de reordenar — SIEMPRE visibles (deshabilitadas en los extremos) */}
                    <div className="absolute top-1/2 -translate-y-1/2 inset-x-1.5 flex justify-between pointer-events-none">
                      <button type="button" onClick={() => moveGalleryPhoto(i, -1)} disabled={saving || isFirst}
                        aria-label={t("pages.landing.moveLeftAria")} title={t("pages.landing.moveLeft")}
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronLeft size={16} strokeWidth={1.75}/>
                      </button>
                      <button type="button" onClick={() => moveGalleryPhoto(i, 1)} disabled={saving || isLast}
                        aria-label={t("pages.landing.moveRightAria")} title={t("pages.landing.moveRight")}
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronRight size={16} strokeWidth={1.75}/>
                      </button>
                    </div>

                    {/* Barra de acciones — SIEMPRE visible */}
                    <div className="absolute inset-x-0 bottom-0 flex divide-x divide-white/20 bg-black/65">
                      <label aria-label={t("pages.landing.replacePhotoAria")} title={t("pages.landing.replace")}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 cursor-pointer hover:bg-white/15 transition-colors">
                        <RefreshCw size={14} strokeWidth={1.75}/> <span className="hidden sm:inline">{t("pages.landing.replace")}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            const newUrl = await uploadImage(file, "gallery");
                            const newGallery = clinic.landingGallery.map((u,j) => j===i ? newUrl : u);
                            updateLocal("landingGallery", newGallery);
                            await save({ landingGallery: newGallery });
                          } catch (err: any) { toast.error(err?.message ?? t("pages.landing.uploadError")); }
                        }} />
                      </label>
                      <button type="button" aria-label={t("pages.landing.deletePhotoAria")} title={t("common.delete")}
                        onClick={async () => {
                          const newGallery = clinic.landingGallery.filter((_,j) => j !== i);
                          updateLocal("landingGallery", newGallery);
                          await save({ landingGallery: newGallery });
                        }}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 hover:bg-[color:var(--danger)] transition-colors">
                        <Trash2 size={14} strokeWidth={1.75}/> <span className="hidden sm:inline">{t("common.delete")}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={EMPTY_CLS}>
              <ImagePlus size={24} strokeWidth={1.5} className="text-[color:var(--text-4)]"/>
              <p className="text-sm text-[color:var(--text-3)]">{t("pages.landing.galleryEmpty")}</p>
            </div>
          )}
        </div>
      )}

      {/* ── REDES Y CONTACTO ── */}
      {tab === "redes" && (
        <div className={`${CARD_CLS} p-5 space-y-4`}>
          <h3 className={`${H_SECTION} flex items-center gap-1.5`}><Share2 size={16} strokeWidth={1.75} className="text-[color:var(--brand)]"/> {t("pages.landing.socialHeading")}</h3>
          {[
            { key:"landingWhatsapp",  label:"WhatsApp",  placeholder:"+52 999 123 4567", descKey:"pages.landing.whatsappDesc" },
            { key:"landingInstagram", label:"Instagram",  placeholder:"@tuclinica",      descKey:"pages.landing.handleDesc" },
            { key:"landingFacebook",  label:"Facebook",   placeholder:"https://facebook.com/tuclinica", descKey:"pages.landing.facebookDesc" },
            { key:"landingTiktok",    label:"TikTok",     placeholder:"@tuclinica",      descKey:"pages.landing.handleDesc" },
          ].map(field => (
            <div key={field.key}>
              <label className={LABEL_CLS}>{field.label}</label>
              <p className={`${HELP_CLS} -mt-0.5 mb-1.5`}>{t(field.descKey)}</p>
              <input value={(clinic as any)[field.key] ?? ""}
                onChange={e => updateLocal(field.key, e.target.value)}
                placeholder={field.placeholder}
                className={INPUT_CLS} />
            </div>
          ))}
          <button onClick={() => save({
            landingWhatsapp: clinic.landingWhatsapp,
            landingInstagram: clinic.landingInstagram,
            landingFacebook: clinic.landingFacebook,
            landingTiktok: clinic.landingTiktok,
          })} disabled={saving} className={BTN_SAVE_FULL}>
            {saving ? t("common.saving") : t("pages.landing.saveSocial")}
          </button>
        </div>
      )}
      </fieldset>
      </div>

      {/* ── VISTA PREVIA EN VIVO ──────────────────────────────────────
          Los cambios sin guardar llegan por postMessage y la plantilla se
          repinta SOLA (ver _shared/live-preview.tsx). El iframe se recarga
          únicamente al guardar y al cambiar de plantilla (previewNonce y
          templateSel están en la key), que es la red de seguridad. Apunta a
          /landing-preview, que es la ruta DINÁMICA: /[slug] es ISR y no puede
          leer ?preview=. Se oculta por debajo de xl: en pantalla chica el
          editor ya ocupa todo. */}
      <aside className="hidden xl:block w-[420px] shrink-0">
        <div className="sticky top-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[color:var(--text-1)]">Vista previa</span>
            {sinGuardar && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 bg-[color:var(--warning-soft)] text-[color:var(--warning-strong)] border border-[color:var(--warning-border-strong)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--warning)]" />
                Sin guardar
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => setPreviewAncho("escritorio")}
                aria-pressed={previewAncho === "escritorio"} aria-label="Ver en escritorio"
                className={`w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] transition ${previewAncho === "escritorio" ? "bg-brand-600 text-white" : "text-[color:var(--text-3)] hover:bg-[color:var(--bg-hover)]"}`}>
                <Monitor size={14} />
              </button>
              <button type="button" onClick={() => setPreviewAncho("movil")}
                aria-pressed={previewAncho === "movil"} aria-label="Ver en móvil"
                className={`w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] transition ${previewAncho === "movil" ? "bg-brand-600 text-white" : "text-[color:var(--text-3)] hover:bg-[color:var(--bg-hover)]"}`}>
                <Smartphone size={14} />
              </button>
              <button type="button" onClick={() => setPreviewNonce(n => n + 1)}
                aria-label="Recargar la vista previa"
                className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-[color:var(--text-3)] hover:bg-[color:var(--bg-hover)] transition">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          <div className={`${CARD_CLS} overflow-hidden transition-shadow ${sinGuardar ? "!border-[color:var(--warning)] ring-2 ring-[color:var(--warning-soft-strong)]" : ""}`}
            style={{ height: "calc(100vh - 120px)" }}>
            <iframe
              ref={iframeRef}
              key={`${templateSel}-${previewNonce}`}
              src={`/landing-preview/${clinic.slug}?preview=${templateSel}`}
              title="Vista previa de tu sitio"
              className="border-0 bg-white origin-top-left"
              style={previewAncho === "movil"
                ? { width: 390, height: "calc((100vh - 120px) / 0.94)", transform: "scale(0.94)", margin: "0 auto", display: "block" }
                : { width: "285.7%", height: "calc((100vh - 120px) / 0.35)", transform: "scale(0.35)" }}
            />
          </div>

          <p className="text-[11px] text-[color:var(--text-3)] leading-snug">
            {sinGuardar
              ? "Esto es un borrador: se ve aquí, pero tu sitio público sigue como estaba. Guarda para publicarlo."
              : "Lo que ves aquí es tu sitio público, tal cual. Al escribir se actualiza al momento."}
          </p>
        </div>
      </aside>
    </div>
  );
}
