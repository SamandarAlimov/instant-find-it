import { createFileRoute } from "@tanstack/react-router";

type SearchResult = {
  url: string;
  title?: string;
  description?: string;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  let allowOrigin = "";

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol === "https:" &&
      (host === "alsamos.com" || host.endsWith(".alsamos.com"))
    ) {
      allowOrigin = origin;
    }
  } catch {
    // ignore invalid origin
  }

  if (!allowOrigin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    allowOrigin = origin;
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin || "https://alsamos.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

async function runSearch(query: string, limit = 10): Promise<SearchResult[]> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const firecrawlKey = process.env["FIRECRAWL_API_KEY"];

  if (!lovableKey || !firecrawlKey) {
    throw new Error("Firecrawl connector is not configured");
  }

  const response = await fetch(
    "https://connector-gateway.lovable.dev/firecrawl/v2/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": firecrawlKey,
      },
      body: JSON.stringify({
        query,
        limit: Math.max(1, Math.min(20, limit)),
        sources: ["web", "news", "images"],
        safe: true,
      }),
      signal: AbortSignal.timeout(35000),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(
      `Firecrawl search failed [${response.status}]: ${String(
        payload?.error || "unknown error",
      ).slice(0, 300)}`,
    );
  }

  const data = payload?.data ?? payload ?? {};
  const web = Array.isArray(data) ? data : Array.isArray(data.web) ? data.web : [];
  const news = Array.isArray(data?.news) ? data.news : [];

  return [...web, ...news]
    .filter((item: any) => typeof item?.url === "string" && item.url)
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map((item: any) => ({
      url: item.url,
      title: item.title || item.metadata?.title,
      description:
        item.description ||
        item.snippet ||
        item.metadata?.description ||
        undefined,
    }));
}

async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    const body =
      request.method === "POST"
        ? await request.json().catch(() => ({}))
        : Object.fromEntries(url.searchParams.entries());

    const query = String(body?.query ?? body?.q ?? "").trim().slice(0, 300);
    const limit = Number(body?.limit) || 10;

    if (!query) {
      return new Response(
        JSON.stringify({ results: [], error: "Query is required" }),
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const startedAt = Date.now();
    const results = await runSearch(query, limit);

    return new Response(
      JSON.stringify({
        query,
        results,
        engine: "firecrawl-lovable",
        tookMs: Date.now() - startedAt,
        error: null,
      }),
      { status: 200, headers: corsHeaders(request) },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        results: [],
        engine: "firecrawl-lovable",
        error: error instanceof Error ? error.message : "Search failed",
      }),
      { status: 502, headers: corsHeaders(request) },
    );
  }
}

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: corsHeaders(request) }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
