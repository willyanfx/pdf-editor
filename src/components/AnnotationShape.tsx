import type { CSSProperties } from "react";
import type { RectangleEdit, ShapeEdit, StampEdit } from "../store/useEditorStore";
import { arrowBarbs, arrowHeadLength, cloudSvgPath } from "../lib/annotations";

/**
 * On-page rendering of the vector annotation types (everything in EditBox that
 * isn't text, image, markup band or sticky note). The PDF writer draws the same
 * geometry from lib/annotations.ts, so what you see is what gets exported.
 */

const half = (n: number) => n / 2;

export function ShapeSvg({ edit }: { edit: ShapeEdit }) {
  const { width, height, color, strokeWidth: sw } = edit;
  const common = {
    fill: "none",
    stroke: color,
    strokeWidth: sw,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const points = edit.points ?? [];

  let body: React.ReactNode = null;
  switch (edit.type) {
    case "oval":
      body = (
        <ellipse
          cx={half(width)}
          cy={half(height)}
          rx={Math.max(0, half(width) - half(sw))}
          ry={Math.max(0, half(height) - half(sw))}
          {...common}
        />
      );
      break;
    case "cloud":
      body = <path d={cloudSvgPath(width, height)} {...common} />;
      break;
    case "polygon":
      body = <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} {...common} />;
      break;
    case "line":
    case "arrow": {
      if (points.length < 2) break;
      const [a, b] = points;
      const barbs = edit.type === "arrow" ? arrowBarbs(a, b, arrowHeadLength(sw)) : null;
      body = (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          {barbs && (
            <polyline
              points={`${barbs[0].x},${barbs[0].y} ${b.x},${b.y} ${barbs[1].x},${barbs[1].y}`}
              {...common}
            />
          )}
        </>
      );
      break;
    }
  }

  return (
    <svg
      className="shape-preview"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}

export function RectanglePreview({ edit }: { edit: RectangleEdit }) {
  const style: CSSProperties | undefined = edit.color
    ? { borderColor: edit.color, borderWidth: edit.strokeWidth ?? 2 }
    : undefined;
  return <div className="rectangle-preview" style={style} />;
}

export function StampPreview({ edit }: { edit: StampEdit }) {
  const style = {
    "--stamp": edit.color,
    // Scale the label with the box so a resized stamp stays proportionate.
    fontSize: Math.max(
      8,
      Math.min(edit.height * 0.5, (edit.width - 16) / (edit.label.length * 0.62)),
    ),
  } as CSSProperties;
  return (
    <div className="stamp-preview" style={style}>
      {edit.label}
    </div>
  );
}
