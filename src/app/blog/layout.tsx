import { LiveChat } from "@/components/public/landing/sales/v2/livechat";

// Todo el blog (índice, cada artículo y las categorías) lleva el chat de
// LiveChat, igual que la portada. Las páginas siguen armando su propio shell.
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LiveChat />
    </>
  );
}
