import { notFound } from "next/navigation";
import { digFetch, ApiRequestError } from "@/lib/api";
import { isReleaseResponse, type ReleaseResponse } from "@/lib/types";
import { ReleaseHero } from "@/components/ReleaseHero";
import { Tracklist } from "@/components/Tracklist";
import { Credits } from "@/components/Credits";
import { Provenance } from "@/components/Provenance";
import { ErrorMessage } from "@/components/ErrorMessage";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  try {
    const data = await digFetch<ReleaseResponse>(`/v1/releases/${id}`, {
      revalidate: 300,
    });
    if (!isReleaseResponse(data)) return { title: "Version — Dig" };
    const r = data.release;
    const artist = r.artists[0]?.name || "Unknown";
    return {
      title: `${r.title} — ${artist} — Dig`,
      description: `${r.title} by ${artist}. ${r.genres.join(", ")}. ${r.release_year || ""}`.trim(),
    };
  } catch {
    return { title: "Version — Dig" };
  }
}

export default async function VersionPage({ params }: Props) {
  const { id } = await params;

  try {
    const [data, coverData] = await Promise.all([
      digFetch<ReleaseResponse>(`/v1/releases/${id}`, { revalidate: 300 }),
      digFetch<{ cover: { url: string | null } | null }>(`/v1/releases/${id}/cover`, { revalidate: 3600 }).catch(() => null),
    ]);

    if (!isReleaseResponse(data)) {
      return <ErrorMessage message="Unexpected API response format" />;
    }

    const release = data.release;
    const coverUrl = coverData?.cover?.url ?? null;

    return (
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <ReleaseHero release={release} coverUrl={coverUrl} />
        <Tracklist tracks={release.tracks} />
        <Credits credits={release.credits} />
        {release.notes && (
          <section style={{ padding: "1.25rem 0", borderBottom: "1px solid var(--line)" }}>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.65rem",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--warm-mid)",
                marginBottom: "0.5rem",
              }}
            >
              Notes
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--cream)", whiteSpace: "pre-wrap" }}>
              {release.notes}
            </p>
          </section>
        )}
        <Provenance provenance={release.provenance} />
      </div>
    );
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === "NOT_FOUND") {
      notFound();
    }
    if (err instanceof ApiRequestError) {
      return <ErrorMessage code={err.code} message={err.message} />;
    }
    return <ErrorMessage message="Failed to load version" />;
  }
}
