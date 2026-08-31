import { createFileRoute } from "@tanstack/react-router";

type Category = "all" | "web" | "wikipedia" | "news" | "images" | "videos";
type ResultType = "web" | "wikipedia" | "news" | "image" | "video";

type SearchResult = {
  id: string;
  type: ResultType;
  title: string;
  snippet: string;
  url: string;
  displayUrl: string;
  thumbnailUrl: string | null;
  source: string;
  publishedAt: string | null;
  author: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

const CATEGORIES = new Set<Category>(["all", "web", "wikipedia", "news", "images", "videos"]);

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

async function hashId(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sourceName(raw: string) {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function displayUrl(raw: string) {
  try {
    const url = new URL(raw);
    const path = url.pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      })
      .join(" › ");

    return url.hostname.replace(/^www\./, "") + (path ? " › " + path : "");
  } catch {
    return raw;
  }
}

function queryForCategory(query: string, category: Category) {
  if (category === "wikipedia") return query + " site:wikipedia.org";
  if (category === "videos") return query + " (site:youtube.com OR site:vimeo.com)";
  return query;
}

function sourcesForCategory(category: Category) {
  if (category === "images") return ["images"];
  if (category === "news") return ["news"];
  if (category === "all") return ["web", "news", "images"];
  return ["web"];
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function runSearch(input: {
  query: string;
  category: Category;
  page: number;
  pageSize: number;
}): Promise<SearchResult[]> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const firecrawlKey = process.env["FIRECRAWL_API_KEY"];

  if (!lovableKey || !firecrawlKey) {
    throw new Error("Firecrawl connector is not configured");
  }

  const requested = Math.min(100, Math.max(input.pageSize, input.page * input.pageSize));
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
        query: queryForCategory(input.query, input.category),
        limit: requested,
        sources: sourcesForCategory(input.category),
        safe: true,
        timeout: 30000,
        ignoreInvalidURLs: true,
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
  const web = Array.isArray(data) ? data : Array.isArray(data?.web) ? data.web : [];
  const news = Array.isArray(data?.news) ? data.news : [];
  const images = Array.isArray(data?.images) ? data.images : [];

  const rows: Array<{ kind: ResultType; item: any }> = [];
  if (input.category === "images") {
    images.forEach((item: any) => rows.push({ kind: "image", item }));
  } else if (input.category === "news") {
    news.forEach((item: any) => rows.push({ kind: "news", item }));
  } else if (input.category === "all") {
    web.forEach((item: any) =>
      rows.push({
        kind: /wikipedia\.org/i.test(String(item?.url || "")) ? "wikipedia" : "web",
        item,
      }),
    );
    news.forEach((item: any) => rows.push({ kind: "news", item }));
    images.forEach((item: any) => rows.push({ kind: "image", item }));
  } else {
    web.forEach((item: any) =>
      rows.push({
        kind:
          input.category === "wikipedia"
            ? "wikipedia"
            : input.category === "videos"
              ? "video"
              : "web",
        item,
      }),
    );
  }

  const start = Math.max(0, (input.page - 1) * input.pageSize);
  const selected = rows.slice(start, start + input.pageSize);
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const row of selected) {
    const item = row.item ?? {};
    const pageUrl = String(
      item?.url || item?.metadata?.sourceURL || item?.metadata?.url || "",
    ).trim();
    const imageUrl = String(item?.imageUrl || "").trim();
    const targetUrl = pageUrl || (row.kind === "image" ? imageUrl : "");

    if (!targetUrl || seen.has(targetUrl)) continue;
    seen.add(targetUrl);

    const title = String(
      item?.title || item?.metadata?.title || sourceName(targetUrl),
    ).trim();

    const snippet = String(
      item?.description ||
        item?.snippet ||
        item?.metadata?.description ||
        item?.markdown ||
        "",
    )
      .replace(/[#*_>\[\]`]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 700);

    results.push({
      id: await hashId("firecrawl:" + targetUrl),
      type: row.kind,
      title,
      snippet,
      url: pageUrl || targetUrl,
      displayUrl: displayUrl(pageUrl || targetUrl),
      thumbnailUrl:
        row.kind === "image"
          ? imageUrl || null
          : String(item?.imageUrl || item?.screenshot || "").trim() || null,
      source: sourceName(pageUrl || targetUrl),
      publishedAt: normalizeDate(item?.date || item?.publishedAt),
      author: typeof item?.author === "string" ? item.author : null,
      width: Number.isFinite(Number(item?.imageWidth)) ? Number(item.imageWidth) : null,
      height: Number.isFinite(Number(item?.imageHeight)) ? Number(item.imageHeight) : null,
      durationSeconds: null,
    });
  }

  return results;
}

async function handle(request: Request) {
  const startedAt = Date.now();

  try {
    const url = new URL(request.url);
    const body =
      request.method === "POST"
        ? await request.json().catch(() => ({}))
        : Object.fromEntries(url.searchParams.entries());

    const query = String(body?.query ?? body?.q ?? "").trim().slice(0, 300);
    const requestedCategory = String(body?.category ?? "all") as Category;
    const category = CATEGORIES.has(requestedCategory) ? requestedCategory : "all";
    const page = Math.max(1, Math.min(5, Number(body?.page) || 1));
    const pageSize = Math.max(
      1,
      Math.min(20, Number(body?.pageSize ?? body?.limit) || 10),
    );

    if (!query) {
      return new Response(
        JSON.stringify({
          query,
          category,
          page,
          totalEstimated: 0,
          tookMs: Date.now() - startedAt,
          results: [],
          engine: "firecrawl-lovable",
          error: { code: "INVALID_QUERY", message: "Query is required" },
        }),
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const results = await runSearch({ query, category, page, pageSize });

    return new Response(
      JSON.stringify({
        query,
        category,
        page,
        totalEstimated:
          (page - 1) * pageSize +
          results.length +
          (results.length === pageSize ? pageSize : 0),
        results,
        engine: "firecrawl-lovable",
        tookMs: Date.now() - startedAt,
        summary: null,
        searchSuggestionHtml: null,
        searchQueries: [],
        error: results.length
          ? null
          : { code: "NO_RESULTS", message: "No web results found." },
      }),
      { status: 200, headers: corsHeaders(request) },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        results: [],
        engine: "firecrawl-lovable",
        tookMs: Date.now() - startedAt,
        error: {
          code: "FIRECRAWL_ERROR",
          message: error instanceof Error ? error.message : "Search failed",
        },
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
