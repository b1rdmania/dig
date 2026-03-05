import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

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
