import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const TYPE_LABELS: Record<string, string> = {
  artist: "Artist",
  release: "Release",
  version: "Version",
  label: "Label",
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get("title") || "Dig";
  const type = searchParams.get("type") || "";
  const badge = TYPE_LABELS[type] || "";

  // Load Playfair Display for the title
  const fontData = await fetch(
    "https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtM.ttf",
  ).then((r) => r.arrayBuffer());

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
          backgroundColor: "#0d0a07",
          padding: "60px 80px",
          position: "relative",
        }}
      >
        {/* Accent line at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            backgroundColor: "#8b5e3c",
          }}
        />

        {/* Type badge */}
        {badge && (
          <div
            style={{
              position: "absolute",
              top: "40px",
              left: "60px",
              color: "#8b5e3c",
              fontSize: "18px",
              fontFamily: "sans-serif",
              letterSpacing: "3px",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </div>
        )}

        {/* Title */}
        <div
          style={{
            color: "#f2ece0",
            fontSize: title.length > 40 ? "48px" : "64px",
            fontFamily: "Playfair Display",
            textAlign: "center",
            lineHeight: 1.2,
            maxWidth: "900px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>

        {/* Site name */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            right: "60px",
            color: "#a89070",
            fontSize: "20px",
            fontFamily: "sans-serif",
            letterSpacing: "2px",
          }}
        >
          dig.baby
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Playfair Display",
          data: fontData,
          style: "normal",
          weight: 400,
        },
      ],
    },
  );
}
