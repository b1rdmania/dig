import { Suspense } from "react";
import Link from "next/link";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import { SearchResults } from "@/components/SearchResults";
import { Empty } from "@/components/Empty";
import { ErrorMessage } from "@/components/ErrorMessage";
import { IncrementalSearchWrapper } from "@/components/IncrementalSearchWrapper";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

async function SearchContent({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
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
          <Empty message="No results found">
            <DidYouMean suggestions={suggestions} />
          </Empty>
        );
      }
      return <Empty message="No results found" />;
    }

    return <SearchResults data={data} />;
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Something went wrong" />;
  }
}

function DidYouMean({ suggestions }: { suggestions: NonNullable<SearchResponse["meta"]["suggested_results"]> }) {
  return (
    <div style={{ marginTop: "1.25rem", textAlign: "left" }}>
      <p style={{ fontSize: "0.8rem", color: "var(--fg-faint)", marginBottom: "0.5rem" }}>
        Did you mean?
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {suggestions.map((s) => (
          <Link
            key={s.discogs_id}
            href={`/artist/${s.discogs_id}`}
            style={{ fontSize: "0.95rem", color: "var(--fg)", textDecoration: "underline", textUnderlineOffset: "3px" }}
          >
            {s.name || s.title || `Artist ${s.discogs_id}`}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const resolved = await searchParams;
  const hasQuery =
    typeof resolved.q === "string" && resolved.q.trim().length > 0;

  return (
    <>
      {!hasQuery && (
        <h1
          style={{
            fontSize: "clamp(3.5rem, 10vw, 7rem)",
            fontWeight: 400,
            color: "var(--fg)",
            textAlign: "center",
            margin: "0 auto",
            padding: "2rem 0 1.5rem",
            lineHeight: 1,
          }}
        >
          Dig.
        </h1>
      )}
      <Suspense>
        <IncrementalSearchWrapper>
          <SearchContent searchParams={resolved} />
        </IncrementalSearchWrapper>
      </Suspense>
    </>
  );
}
