import { ImageResponse } from "next/og"

export const alt = "Astreex"
export const size = {
  width: 1200,
  height: 630,
}

export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#FAF9F7",
          color: "#1C1C1C",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: "#E16259",
            marginBottom: 48,
          }}
        />
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: 0 }}>
          Astreex
        </div>
        <div style={{ marginTop: 24, fontSize: 34, color: "#6B6560" }}>
          Reddit growth on autopilot for B2B founders
        </div>
      </div>
    ),
    size,
  )
}
