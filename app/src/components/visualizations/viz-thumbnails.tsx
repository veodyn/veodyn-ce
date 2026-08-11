// Miniatures of what each visualization type produces, for pickers that ask
// "how should this look?". A lucide icon answers that with a symbol standing in
// for the chart; these are small drawings of the chart itself.
//
// Everything is stroked and filled with `currentColor` at varying opacity, so a
// thumbnail inherits its tile's text colour and needs no second palette for
// dark mode. Nothing here is loaded: no image requests, no chart library.
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type VizThumbnail = ComponentType<{ className?: string }>

// One viewBox for all of them, so a row of tiles draws at a consistent scale.
function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 32"
      className={cn('h-8 w-12', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** A filled shape: `fill` wins, so the frame's stroke is turned off per shape. */
const FILL = { fill: 'currentColor', stroke: 'none' } as const
/** The x axis most of the cartesian charts sit on. */
const Axis = () => <path d="M5 26h38" opacity={0.35} />

export function TableThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x={4} y={6} width={40} height={20} rx={2} />
      <rect x={4} y={6} width={40} height={6} rx={2} {...FILL} opacity={0.2} />
      <path d="M4 12h40M4 19h40" />
      <path d="M17.3 6v20M30.6 6v20" />
    </Frame>
  )
}

// A pivot is a table with a header column as well as a header row. Without that
// second band this drawing and the table's are the same picture.
export function PivotThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x={4} y={6} width={40} height={20} rx={2} />
      <rect x={4} y={6} width={40} height={6} rx={2} {...FILL} opacity={0.2} />
      <rect x={4} y={12} width={13.3} height={14} {...FILL} opacity={0.2} />
      <path d="M4 12h40M4 19h40" />
      <path d="M17.3 6v20M30.6 6v20" />
    </Frame>
  )
}

export function LineThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <Axis />
      <polyline points="6,21 15,13 23,17 31,8 42,12" />
    </Frame>
  )
}

// A trend read against a rule, which is the whole difference between this and
// the plain line above: the dashed target, the shaded on-track band over it,
// and a series that crosses into the band rather than only rising.
export function KpiHistoryThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x={5} y={6} width={38} height={8} {...FILL} opacity={0.15} />
      <Axis />
      <path d="M5 14h38" strokeDasharray="3 3" opacity={0.55} />
      <polyline points="6,22 15,19 23,21 31,15 42,10" />
    </Frame>
  )
}

export function BarThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <Axis />
      <rect x={8} y={16} width={6} height={10} rx={1} {...FILL} opacity={0.75} />
      <rect x={18} y={10} width={6} height={16} rx={1} {...FILL} opacity={0.75} />
      <rect x={28} y={19} width={6} height={7} rx={1} {...FILL} opacity={0.75} />
      <rect x={38} y={13} width={6} height={13} rx={1} {...FILL} opacity={0.75} />
    </Frame>
  )
}

export function AreaThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <Axis />
      <path d="M6 21 15 13 23 17 31 8 42 12V26H6Z" {...FILL} opacity={0.25} />
      <polyline points="6,21 15,13 23,17 31,8 42,12" />
    </Frame>
  )
}

export function PieThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <circle cx={24} cy={16} r={10} />
      <path d="M24 16V6a10 10 0 0 1 10 10Z" {...FILL} opacity={0.4} />
      <path d="M24 16 34 16" />
    </Frame>
  )
}

export function ScatterThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <Axis />
      <circle cx={10} cy={20} r={2} {...FILL} opacity={0.75} />
      <circle cx={17} cy={13} r={2} {...FILL} opacity={0.75} />
      <circle cx={23} cy={21} r={2} {...FILL} opacity={0.75} />
      <circle cx={30} cy={11} r={2} {...FILL} opacity={0.75} />
      <circle cx={36} cy={16} r={2} {...FILL} opacity={0.75} />
      <circle cx={42} cy={8} r={2} {...FILL} opacity={0.75} />
    </Frame>
  )
}

// A counter is one number, so the number is the drawing.
export function CounterThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <text
        x={24}
        y={19}
        textAnchor="middle"
        fontSize={15}
        fontWeight={600}
        letterSpacing={-0.5}
        {...FILL}
      >
        42
      </text>
      <rect x={17} y={23} width={14} height={2.5} rx={1.25} {...FILL} opacity={0.3} />
    </Frame>
  )
}

export function FunnelThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M7 7h34l-5 6H12Z" {...FILL} opacity={0.3} />
      <path d="M13 15h22l-4 6H17Z" {...FILL} opacity={0.5} />
      <path d="M18 23h12l-3 5h-6Z" {...FILL} opacity={0.7} />
    </Frame>
  )
}

// Label and value, three rows of it: what the Details renderer puts on screen.
export function DetailsThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <rect x={6} y={8} width={11} height={3} rx={1.5} {...FILL} opacity={0.35} />
      <rect x={21} y={8} width={21} height={3} rx={1.5} {...FILL} opacity={0.75} />
      <rect x={6} y={15} width={11} height={3} rx={1.5} {...FILL} opacity={0.35} />
      <rect x={21} y={15} width={15} height={3} rx={1.5} {...FILL} opacity={0.75} />
      <rect x={6} y={22} width={11} height={3} rx={1.5} {...FILL} opacity={0.35} />
      <rect x={21} y={22} width={18} height={3} rx={1.5} {...FILL} opacity={0.75} />
    </Frame>
  )
}

export function MapThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M24 28s7.5-8.2 7.5-13.2a7.5 7.5 0 0 0-15 0C16.5 19.8 24 28 24 28Z" />
      <circle cx={24} cy={14.5} r={2.5} {...FILL} />
      <circle cx={9} cy={11} r={1.5} {...FILL} opacity={0.4} />
      <circle cx={39} cy={20} r={1.5} {...FILL} opacity={0.4} />
    </Frame>
  )
}

export function HeatmapThumbnail({ className }: { className?: string }) {
  // Read row-major from the top left. Varying weight is the whole point of the
  // drawing, so these are literal rather than generated.
  const cells = [0.2, 0.55, 0.35, 0.8, 0.7, 0.25, 0.85, 0.4, 0.3, 0.75, 0.5, 0.65]
  return (
    <Frame className={className}>
      {cells.map((opacity, index) => (
        <rect
          key={index}
          x={7 + (index % 4) * 9}
          y={7 + Math.floor(index / 4) * 7}
          width={8}
          height={6}
          rx={1}
          {...FILL}
          opacity={opacity}
        />
      ))}
    </Frame>
  )
}

export function BoxPlotThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M16 5v4M16 23v4" opacity={0.6} />
      <rect x={9} y={9} width={14} height={14} rx={1.5} {...FILL} opacity={0.25} />
      <rect x={9} y={9} width={14} height={14} rx={1.5} />
      <path d="M9 16h14" />
      <path d="M35 8v3M35 21v4" opacity={0.6} />
      <rect x={28} y={11} width={14} height={10} rx={1.5} {...FILL} opacity={0.25} />
      <rect x={28} y={11} width={14} height={10} rx={1.5} />
      <path d="M28 17h14" />
    </Frame>
  )
}

export function SankeyThumbnail({ className }: { className?: string }) {
  return (
    <Frame className={className}>
      <path d="M11 10c11 0 15 2 26 3" strokeWidth={5} opacity={0.28} />
      <path d="M11 23c11 0 15-2 26-3" strokeWidth={5} opacity={0.28} />
      <rect x={5} y={5} width={4} height={10} rx={1} {...FILL} opacity={0.8} />
      <rect x={5} y={18} width={4} height={10} rx={1} {...FILL} opacity={0.8} />
      <rect x={39} y={8} width={4} height={16} rx={1} {...FILL} opacity={0.8} />
    </Frame>
  )
}
