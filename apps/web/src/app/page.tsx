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

function HomeHero() {
  return (
    <section
      style={{
        maxWidth: "var(--container-max)",
        margin: "0 auto var(--sp-5)",
        padding: "var(--sp-7) 0 var(--sp-5)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--ink-muted)",
          fontWeight: 600,
          marginBottom: "var(--sp-3)",
        }}
      >
        [ v2 ] · house &amp; techno · 1988–2003
      </div>
      <h1
        style={{
          fontFamily: "var(--font-sans)",
          fontWeight: 600,
          fontSize: "clamp(2.4rem, 7vw, 4.4rem)",
          lineHeight: 1.02,
          letterSpacing: "-0.02em",
          margin: 0,
          color: "var(--ink)",
        }}
      >
        Dig.
      </h1>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--fs-lg)",
          color: "var(--ink-soft)",
          marginTop: "var(--sp-3)",
          maxWidth: "52ch",
        }}
      >
        House and techno, 1988 to 2003. The labels, the records, the scenes — mapped.
      </p>
    </section>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  const resolved = await searchParams;
  const hasQuery = typeof resolved.q === "string" && resolved.q.trim().length > 0;

  return (
    <>
      {!hasQuery && <HomeHero />}
      <Suspense>
        <IncrementalSearchWrapper>
          <SearchContent searchParams={resolved} />
        </IncrementalSearchWrapper>
      </Suspense>
    </>
  );
}
