import { Suspense } from "react";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isSearchResponse, type SearchResponse } from "@/lib/types";
import { SearchBar } from "@/components/SearchBar";
import { SearchResults } from "@/components/SearchResults";
import { Empty } from "@/components/Empty";
import { ErrorMessage } from "@/components/ErrorMessage";

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

  try {
    const data = await digFetch<SearchResponse>(
      `/v1/search?${params.toString()}`,
      { cache: "no-store" },
    );

    if (!isSearchResponse(data)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    if (data.results.length === 0) {
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

export default async function SearchPage({ searchParams }: Props) {
  const resolved = await searchParams;

  return (
    <>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <Suspense>
          <SearchBar />
        </Suspense>
      </div>
      <div style={{ marginTop: "2rem" }}>
        <SearchContent searchParams={resolved} />
      </div>
    </>
  );
}
