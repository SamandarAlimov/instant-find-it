import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, ExternalLink, Loader2 } from "lucide-react";
import { webSearch, type SearchResult } from "@/lib/search.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Web Search — Firecrawl" },
      { name: "description", content: "Real vaqtda internetdan qidiruv — Firecrawl asosida." },
      { property: "og:title", content: "Web Search — Firecrawl" },
      { property: "og:description", content: "Real vaqtda internetdan qidiruv." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await webSearch({ data: { q: q.trim() } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xatolik yuz berdi");
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-3xl font-bold text-foreground">Web Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Firecrawl orqali real internetdan realtime qidiruv
        </p>

        <form onSubmit={onSearch} className="mt-6 flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Qidiruv so'zi..."
            className="flex-1"
          />
          <Button type="submit" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2">Qidirish</span>
          </Button>
        </form>

        {error && (
          <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-8 space-y-3">
          {results?.length === 0 && (
            <p className="text-sm text-muted-foreground">Hech narsa topilmadi.</p>
          )}
          {results?.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-medium text-foreground">
                  {r.title || r.url}
                </h2>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              {r.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {r.description}
                </p>
              )}
              <p className="mt-2 truncate text-xs text-muted-foreground/70">
                {r.url}
              </p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
