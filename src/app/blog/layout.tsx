import { WhatsappWidget } from "@/components/public/landing/sales/v2/whatsapp-widget";

// Todo el blog (índice, cada artículo y las categorías) lleva el botón de
// WhatsApp, igual que la portada. Las páginas siguen armando su propio shell.
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <WhatsappWidget />
    </>
  );
}
