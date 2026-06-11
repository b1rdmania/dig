import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import { SearchResults } from "./SearchResults";
import { Empty } from "./Empty";
import { ErrorMessage } from "./ErrorMessage";

interface SearchContentProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export async function SearchContent({ searchParams }: SearchContentProps) {
  const q = typeof searchParams.q === "string" ? searchParams.q.trim() : "";

  if (!q) {
    return <Empty />;
  }

  const params = new URLSearchParams({ q, limit: "20" });
  if (typeof searchParams.type === "string" && searchParams.type) {
    params.set("type", searchParams.type);
  }
  const passthrough = ["genre", "style", "country", "year", "year_min", "year_max"];
  for (const key of passthrough) {
    const value = searchParams[key];
    if (typeof value === "string" && value) {
      params.set(key, value);
    }
  }

  try {
    const data = await digFetch<SearchResponse>(
      `/v1/search?${params.toString()}`,
      { cache: "no-store" },
    );

    if (!isSearchResponse(data)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    if (data.results.length === 0) {
      const suggestions = data.meta.suggested_results;
      if (suggestions && suggestions.length > 0) {
        return (
          <Empty message="No results.">
            <DidYouMean suggestions={suggestions} />
          </Empty>
        );
      }
      return <Empty message="No results." />;
    }

    return <SearchResults data={data} />;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Something went wrong" />;
  }
}

function DidYouMean({
  suggestions,
}: {
  suggestions: NonNullable<SearchResponse["meta"]["suggested_results"]>;
}) {
  return (
    <div
      style={{
        marginTop: "var(--sp-5)",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: "var(--sp-2)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <p
        style={{
          fontSize: "var(--fs-xs)",
          color: "var(--ink-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Did you mean
      </p>
      {suggestions.map((s) => (
        <Link
          key={s.discogs_id}
          href={`/artist/${s.discogs_id}`}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "var(--fs-base)",
            color: "var(--ink)",
            textDecoration: "underline",
            textDecorationColor: "var(--rule)",
            textUnderlineOffset: "3px",
          }}
        >
          {s.name || s.title || `Artist ${s.discogs_id}`}
        </Link>
      ))}
    </div>
  );
}
