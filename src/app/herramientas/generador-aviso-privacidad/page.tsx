import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getHerramientaBySlug } from "@/lib/herramientas/data";
import { toolOgUrl } from "@/lib/herramientas/json-ld";
import { ToolPageShell } from "@/components/herramientas/page-shell";
import { PrivacyNoticeTool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas/generador-aviso-privacidad
//
// Página estática (data en el repo). El único cliente es <PrivacyNoticeTool />.
// El disclaimer legal va DENTRO de la herramienta, arriba y abajo, además del
// párrafo de la intro: no es letra chica y no debe poder pasarse por alto.
// ─────────────────────────────────────────────────────────────────────────────

const tool = getHerramientaBySlug("generador-aviso-privacidad")!;

export const revalidate = 3600;

export const metadata: Metadata = buildMetadata({
  title: tool.metaTitle,
  description: tool.metaDescription,
  path: `/herramientas/${tool.slug}`,
  ogImage: toolOgUrl(tool.headline),
  keywords: tool.keywords,
});

const FAQ: BlogFaqItem[] = [
  {
    q: "¿Un consultorio dental está obligado a tener aviso de privacidad?",
    a: "Sí. La LFPDPPP aplica a cualquier particular que trate datos personales, y un consultorio trata de los más delicados: datos de salud, que la ley clasifica como sensibles. El aviso de privacidad es el documento con el que le informas al paciente qué datos recabas, para qué los usas y cómo puede ejercer sus derechos. No importa si eres un solo dentista o una clínica con diez sillones.",
  },
  {
    q: "¿Dónde tengo que poner el aviso de privacidad?",
    a: "En los lugares donde el paciente entrega sus datos. En la práctica: a la vista en recepción (impreso), en tu sitio web o tu landing si ahí se agendan citas, y como parte de la papelería de primera visita, junto a la historia clínica. Muchos consultorios piden una firma de enterado en el expediente; no sustituye al aviso visible, pero deja constancia de que se puso a disposición del paciente.",
  },
  {
    q: "¿Este generador sustituye la revisión de un abogado?",
    a: "No. Lo que obtienes es una plantilla orientativa armada con los apartados que suele llevar un aviso de privacidad simplificado y con tus datos ya insertados, para que no empieces de cero. Antes de imprimirlo y usarlo, revísalo con tu asesor legal: tu caso puede tener particularidades —transferencias a terceros, uso de imágenes clínicas en redes, tratamiento de datos de menores— que un formato general no cubre.",
  },
];

const FEATURES = [
  "Inserta los datos del responsable y su domicilio",
  "Arma las finalidades primarias y secundarias seleccionadas",
  "Declara los medios de contacto con el paciente",
  "Incluye derechos ARCO, transferencias y conservación del expediente",
  "Copia el texto o imprime el aviso en una hoja limpia",
];

export default function GeneradorAvisoPrivacidadPage() {
  return (
    <ToolPageShell
      tool={tool}
      lede="Llena los datos de tu consultorio, marca para qué usas la información de tus pacientes y obtén un aviso de privacidad simplificado listo para copiar o imprimir. Es una plantilla orientativa: revísala con tu asesor legal antes de usarla."
      faq={FAQ}
      featureList={FEATURES}
      ctaTitle="El expediente de tus pacientes, ordenado y con accesos por rol"
      ctaText="Historia clínica, radiografías y consentimientos en un solo lugar, con permisos por usuario y respaldos diarios. El aviso de privacidad se cumple más fácil cuando los datos no viven en cinco cuadernos distintos."
    >
      <div className="blog-prose">
        <p>
          Este <strong>generador de aviso de privacidad para consultorio</strong> arma, con los
          datos que tecleas, el documento que la Ley Federal de Protección de Datos Personales en
          Posesión de los Particulares (LFPDPPP) te pide poner a la vista de tus pacientes. Pones el
          nombre del responsable, el domicilio, el correo y el teléfono de contacto, marcas para qué
          usas la información y obtienes un aviso simplificado completo que puedes copiar o
          imprimir.
        </p>
        <p>
          Un consultorio dental maneja de los datos más delicados que existen: además del nombre y
          el teléfono, recaba antecedentes médicos, alergias, medicamentos, diagnósticos,
          radiografías y fotografías clínicas. La ley los llama datos personales sensibles y les
          exige un cuidado mayor. El aviso de privacidad es el documento donde declaras tres cosas
          en lenguaje que el paciente entienda: qué recabas, para qué lo usas y cómo puede ejercer
          sus derechos de acceso, rectificación, cancelación y oposición —los famosos derechos
          ARCO—.
        </p>
        <p>
          Conviene separar bien dos tipos de finalidad, porque es el punto donde más avisos quedan
          mal escritos. Las primarias son las que hacen falta para atender al paciente: integrar el
          expediente, diagnosticar, tratar, recordarle su cita y cobrarle. Las secundarias son las
          que no hacen falta para atenderlo, como enviarle promociones o campañas de prevención, y
          el paciente puede negarse a ellas sin que eso afecte su atención. Si en tu aviso todo
          aparece como necesario, estás pidiendo un consentimiento que no te corresponde; el
          generador las separa por ti según lo que marques.
        </p>
        <p>
          Hay un detalle propio del sector que casi nunca se escribe y luego genera reclamos: la
          cancelación de datos tiene un límite. La normativa sanitaria obliga a conservar el
          expediente clínico durante un plazo mínimo, así que no puedes borrar la historia clínica
          de alguien sólo porque dejó de ser tu paciente. Mejor decirlo desde el aviso que
          discutirlo después. Lo mismo con{" "}
          <Link href="/blog/whatsapp-clinicas-dentales-guia">WhatsApp</Link>: si vas a mandar
          recordatorios por ahí, decláralo como medio de contacto y evita escribir diagnósticos en
          el chat.
        </p>
        <p>
          Una advertencia que no queremos que se pierda entre el texto: lo que sale de aquí es una
          plantilla orientativa. Revísala y adáptala con tu asesor legal antes de usarla; esto no es
          asesoría jurídica.
        </p>
      </div>

      <div style={{ marginTop: 26 }}>
        <PrivacyNoticeTool />
      </div>
    </ToolPageShell>
  );
}
