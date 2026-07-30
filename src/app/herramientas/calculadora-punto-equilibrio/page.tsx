import type { Metadata } from "next";
import Link from "next/link";
import { buildMetadata } from "@/lib/seo";
import type { BlogFaqItem } from "@/lib/blog/types";
import { getHerramientaBySlug } from "@/lib/herramientas/data";
import { toolOgUrl } from "@/lib/herramientas/json-ld";
import { ToolPageShell } from "@/components/herramientas/page-shell";
import { BreakEvenTool } from "./tool";

// ─────────────────────────────────────────────────────────────────────────────
// /herramientas/calculadora-punto-equilibrio
//
// Página estática (data en el repo). El único cliente es <BreakEvenTool />.
// ─────────────────────────────────────────────────────────────────────────────

const tool = getHerramientaBySlug("calculadora-punto-equilibrio")!;

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
    q: "¿Qué cuenta como gasto fijo y qué como costo variable en un consultorio?",
    a: "Fijo es lo que pagas aunque no atiendas a nadie: renta, sueldos base, luz, internet, software, contador, seguros y pagos de crédito. Variable es lo que sólo existe porque hiciste ese tratamiento: insumos, laboratorio, material de esterilización, comisión de la terminal y honorarios pagados por porcentaje. La duda clásica es el sueldo del especialista: si cobra por porcentaje o por procedimiento es variable; si tiene sueldo fijo mensual, va en los gastos fijos. Tu propio retiro no es un gasto fijo: es la utilidad que quieres sacar por encima del punto de equilibrio.",
  },
  {
    q: "¿Por qué el resultado se redondea hacia arriba?",
    a: "Porque no puedes cobrar un tratamiento y medio. Si la división te da 44.2 tratamientos al mes, con 44 te quedas corto y el mes cierra en rojo, aunque sea por poco. La calculadora siempre sube al siguiente entero para que el número que ves sea el primer mes que de verdad queda cubierto.",
  },
  {
    q: "¿Cada cuánto conviene recalcular el punto de equilibrio?",
    a: "Cuando cambie cualquiera de las tres piezas: una revisión de renta, una contratación, un aumento de precios de tu proveedor o de tu laboratorio, o un ajuste de tarifas. En la práctica, revisarlo cada trimestre es suficiente para la mayoría de los consultorios, y siempre antes de tomar una decisión grande como abrir un sillón nuevo, sumar un especialista o mudarte de local.",
  },
];

const FEATURES = [
  "Calcula el margen por tratamiento en pesos y en porcentaje",
  "Indica los tratamientos al mes necesarios para cubrir los gastos fijos",
  "Muestra el equivalente por semana y por día hábil",
  "Calcula el ingreso mensual de equilibrio",
];

export default function CalculadoraPuntoEquilibrioPage() {
  return (
    <ToolPageShell
      tool={tool}
      lede="Con tus gastos fijos, tu precio promedio y tu costo variable por tratamiento, esta calculadora te dice cuántos tratamientos al mes necesitas para dejar de perder — y su equivalente por semana y por día hábil."
      faq={FAQ}
      featureList={FEATURES}
      ctaTitle="Tus números al día, sin hojas de cálculo"
      ctaText="Caja, tratamientos cobrados y pendientes por paciente, todo registrado donde ya trabajas. Cuando los datos están en un solo lugar, el punto de equilibrio deja de ser una estimación anual."
    >
      <div className="blog-prose">
        <p>
          Esta <strong>calculadora de punto de equilibrio</strong> responde la pregunta más
          incómoda de cualquier consultorio dental: cuántos tratamientos tienes que hacer al mes
          para dejar de perder dinero. No es una métrica de contador, es un número operativo — el
          que te dice si la semana que llevas va bien o vas a tener que meter dinero de tu bolsa
          para cerrar el mes.
        </p>
        <p>
          La lógica es sencilla y por eso funciona. Cada tratamiento que cobras deja un margen: el
          precio menos lo que te costó hacerlo (insumos, laboratorio, comisión de la terminal). Ese
          margen es lo único que puede pagar la renta, los sueldos, la luz y el software. Divide tus
          gastos fijos del mes entre el margen de un tratamiento promedio y tienes el número de
          tratamientos que necesitas para llegar a ceros. Todo lo que hagas por encima de ahí, es
          utilidad.
        </p>
        <p>
          La trampa más común está en la mezcla de las dos categorías. Muchos consultorios meten
          los insumos entre los gastos fijos y el sueldo del especialista entre los variables, y el
          resultado deja de significar algo. La regla práctica: si lo pagas aunque el consultorio
          esté cerrado toda la semana, es fijo; si sólo aparece porque atendiste a alguien, es
          variable. Y tu propio retiro no va en ninguna de las dos: es la utilidad que buscas por
          encima del equilibrio, no un gasto que haya que cubrir para empatar.
        </p>
        <p>
          El resultado se redondea hacia arriba porque no existe medio tratamiento, y viene
          traducido a semana y a día hábil por una razón: 44 tratamientos al mes suena abstracto,
          pero &quot;dos por día&quot; es algo que puedes comparar contra tu agenda de mañana. Si el
          número por día está lejos de lo que ves en tu agenda, tienes tres palancas y conviene
          revisarlas en este orden: subir el margen (precio o costo del tratamiento), bajar los
          gastos fijos, y ocupar mejor las horas que ya pagas —empezando por{" "}
          <Link href="/herramientas/calculadora-citas-perdidas">las citas que se caen</Link>, que
          son horas de sillón ya pagadas que no facturan nada.
        </p>
      </div>

      <div style={{ marginTop: 26 }}>
        <BreakEvenTool />
      </div>
    </ToolPageShell>
  );
}
