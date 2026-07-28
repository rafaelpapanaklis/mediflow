export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { toBlogPostDTO } from "@/lib/blog/types";
import { BlogClient } from "./blog-client";

export const metadata: Metadata = { title: "Blog — Admin DaleControl" };

const PAGE_SIZE = 25;

// BlogPost es contenido GLOBAL (sin clinicId): el admin ve todos los artículos,
// en cualquier estado. La primera página llega renderizada desde el server; los
// filtros y la paginación siguen por GET /api/admin/blog.
export default async function AdminBlogPage() {
  const [total, rows] = await Promise.all([
    prisma.blogPost.count(),
    prisma.blogPost.findMany({ orderBy: { updatedAt: "desc" }, take: PAGE_SIZE }),
  ]);

  return (
    <BlogClient
      initial={{
        posts: rows.map(toBlogPostDTO),
        total,
        page: 1,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      }}
    />
  );
}
