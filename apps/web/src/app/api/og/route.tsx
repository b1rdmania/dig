import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { digFetch } from "@/lib/api";
import type { SceneDetailResponse } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  artist: "Artist",
  release: "Release",
  version: "Version",
  label: "Label",
};

const AXIS_LABEL: Record<string, string> = {
  geography: "Geography",
  cluster: "Cluster",
  sound: "Sound",
  era: "Era",
  bridge: "Bridge",
  micro: "Micro-scene",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const kind = searchParams.get("kind") || "default";

  if (kind === "scene") {
    return renderScene(searchParams.get("slug") || "");
  }
  if (kind === "wall") {
    return renderWall();
  }
  if (kind === "home") {
    return renderHome();
  }
  return renderDefault(searchParams);
}

// ---------------------------------------------------------------------------
// scene cards — palette-tinted, name + city + era as the hero text
// ---------------------------------------------------------------------------

async function renderScene(slug: string): Promise<ImageResponse> {
  if (!slug) return renderDefault(new URLSearchParams());

  let scene: SceneDetailResponse["scene"] | null = null;
  try {
    const res = await digFetch<SceneDetailResponse>(`/v1/scenes/${slug}`, { revalidate: 600 });
    scene = res.scene;
  } catch {
    // Fall through to default-card if the API is down.
  }
  if (!scene) return renderDefault(new URLSearchParams({ title: slug }));

  const accent = scene.palette?.accent ?? "#1a1a1a";
  const era = formatEra(scene.era_start, scene.era_end);
  const labelCount = scene.label_count ?? scene.labels?.length ?? 0;
  const masterCount = (scene.labels ?? []).reduce((sum, l) => sum + (l.master_count ?? 0), 0);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f4f1e8",
          padding: "60px 70px",
          position: "relative",
          fontFamily: "serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "12px",
            backgroundColor: accent,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            color: "#666666",
            fontSize: "20px",
            textTransform: "uppercase",
            letterSpacing: "3px",
            marginBottom: "24px",
          }}
        >
          <span>Scene</span>
          <span style={{ color: "#bbb" }}>·</span>
          <span>{AXIS_LABEL[scene.axis] ?? scene.axis}</span>
          {scene.city && (
            <>
              <span style={{ color: "#bbb" }}>·</span>
              <span>{scene.city}</span>
            </>
          )}
          {era && (
            <>
              <span style={{ color: "#bbb" }}>·</span>
              <span>{era}</span>
            </>
          )}
        </div>
        <div
          style={{
            color: "#0e0e0e",
            fontSize: scene.name.length > 22 ? "84px" : "108px",
            lineHeight: 1.0,
            letterSpacing: "-0.025em",
            fontWeight: 600,
            maxWidth: "1000px",
          }}
        >
          {scene.name}
        </div>
        {scene.blurb && (
          <div
            style={{
              display: "flex",
              marginTop: "32px",
              color: "#444444",
              fontSize: "26px",
              fontStyle: "italic",
              lineHeight: 1.32,
              maxWidth: "920px",
              overflow: "hidden",
            }}
          >
            {`\u201C${scene.blurb}\u201D`}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            left: "70px",
            right: "70px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              color: "#444",
              fontSize: "22px",
              fontFamily: "monospace",
              letterSpacing: "0.04em",
            }}
          >
            {labelCount > 0 && <span>{`${labelCount} labels`}</span>}
            {masterCount > 0 && (
              <>
                <span style={{ color: "#bbb" }}>·</span>
                <span>{`${masterCount.toLocaleString()} masters`}</span>
              </>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                backgroundColor: accent,
                borderRadius: "2px",
              }}
            />
            <div
              style={{
                color: "#0e0e0e",
                fontSize: "26px",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              dig.baby
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

function formatEra(start: number | null, end: number | null): string | null {
  if (start && end) return `${start}–${String(end).slice(-2)}`;
  if (start) return `${start}–`;
  if (end) return `?–${end}`;
  return null;
}

// ---------------------------------------------------------------------------
// wall card — for /wall
// ---------------------------------------------------------------------------

function renderWall(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f4f1e8",
          padding: "60px 70px",
          fontFamily: "serif",
          position: "relative",
        }}
      >
        <div
          style={{
            color: "#666666",
            fontSize: "20px",
            textTransform: "uppercase",
            letterSpacing: "3px",
            marginBottom: "24px",
          }}
        >
          [ wall ] · catalog · v0.1
        </div>
        <div
          style={{
            color: "#0e0e0e",
            fontSize: "108px",
            lineHeight: 1.0,
            letterSpacing: "-0.025em",
            fontWeight: 600,
            maxWidth: "1000px",
          }}
        >
          The catalog,
        </div>
        <div
          style={{
            color: "#0e0e0e",
            fontSize: "108px",
            lineHeight: 1.0,
            letterSpacing: "-0.025em",
            fontWeight: 600,
            fontStyle: "italic",
            maxWidth: "1000px",
          }}
        >
          as a wall.
        </div>
        <div
          style={{
            marginTop: "36px",
            color: "#444444",
            fontSize: "26px",
            fontStyle: "italic",
            maxWidth: "920px",
            lineHeight: 1.32,
          }}
        >
          Every scene, every label, every release in scope. House and techno, 1988–2003.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            right: "70px",
            color: "#0e0e0e",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          dig.baby
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

// ---------------------------------------------------------------------------
// home card — for /
// ---------------------------------------------------------------------------

function renderHome(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#f4f1e8",
          padding: "60px 80px",
          fontFamily: "serif",
          position: "relative",
        }}
      >
        <div
          style={{
            color: "#666666",
            fontSize: "22px",
            textTransform: "uppercase",
            letterSpacing: "3px",
            marginBottom: "32px",
          }}
        >
          [ v2 ] · house &amp; techno · 1988–2003
        </div>
        <div
          style={{
            color: "#0e0e0e",
            fontSize: "240px",
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            fontWeight: 700,
          }}
        >
          Dig.
        </div>
        <div
          style={{
            marginTop: "36px",
            color: "#444444",
            fontSize: "30px",
            fontStyle: "italic",
            maxWidth: "920px",
            lineHeight: 1.3,
          }}
        >
          The labels, the records, the scenes that built the form — mapped.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            right: "80px",
            color: "#0e0e0e",
            fontSize: "26px",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          dig.baby
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

// ---------------------------------------------------------------------------
// default — entity cards for artist/label/release/version (back-compat)
// ---------------------------------------------------------------------------

function renderDefault(searchParams: URLSearchParams): ImageResponse {
  const title = searchParams.get("title") || "Dig";
  const type = searchParams.get("type") || "";
  const badge = TYPE_LABELS[type] || "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#ffffff",
          padding: "60px 80px",
          position: "relative",
        }}
      >
        {badge && (
          <div
            style={{
              position: "absolute",
              top: "40px",
              left: "60px",
              color: "#666666",
              fontSize: "18px",
              fontFamily: "serif",
              textTransform: "uppercase",
              letterSpacing: "2px",
            }}
          >
            {badge}
          </div>
        )}

        <div
          style={{
            color: "#000000",
            fontSize: title.length > 40 ? "48px" : "64px",
            fontFamily: "serif",
            textAlign: "center",
            lineHeight: 1.3,
            maxWidth: "900px",
          }}
        >
          {title}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "40px",
            right: "60px",
            color: "#999999",
            fontSize: "20px",
            fontFamily: "serif",
          }}
        >
          dig.baby
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
