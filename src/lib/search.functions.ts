import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SearchResult = {
  url: string;
  title?: string;
  description?: string;
};

export const webSearch = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ q: z.string().min(1) }).parse(data))
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const fcKey = process.env["FIRECRAWL_API_KEY"];
    if (!lovableKey || !fcKey) {
      throw new Error("Firecrawl ulanmagan — env o'zgaruvchilar topilmadi");
    }
    const res = await fetch(
      "https://connector-gateway.lovable.dev/firecrawl/v2/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": fcKey,
        },
        body: JSON.stringify({ query: data.q, limit: 5 }),
      },
    );
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`Qidiruv xatosi [${res.status}]: ${JSON.stringify(json)}`);
    }
    const list: SearchResult[] = Array.isArray(json.data)
      ? json.data
      : (json.data?.web ?? json.data?.news ?? []);
    return list.map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description,
    }));
  });
