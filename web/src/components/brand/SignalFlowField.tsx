import { useId } from 'react'
import { cn } from '@/lib/utils'

interface SignalFlowFieldProps {
  className?: string
}

const tracks = [
  {
    id: 'upper',
    path: 'M -80 84 C 116 84 210 250 468 332 S 920 390 1280 392',
    glowWidth: 26,
    blur: 30,
    duration: '12s',
    delay: '0s',
  },
  {
    id: 'mid',
    path: 'M -56 456 C 134 456 300 456 580 456 S 982 452 1280 448',
    glowWidth: 18,
    blur: 20,
    duration: '10s',
    delay: '0.8s',
  },
  {
    id: 'lower',
    path: 'M -84 828 C 124 828 224 650 506 566 S 936 512 1280 492',
    glowWidth: 22,
    blur: 26,
    duration: '14s',
    delay: '1.4s',
  },
]

export default function SignalFlowField({ className }: SignalFlowFieldProps) {
  const id = useId().replace(/:/g, '')

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1200 920"
      preserveAspectRatio="xMidYMid slice"
      className={cn('pointer-events-none h-full w-full', className)}
    >
      <defs>
        <radialGradient id={`${id}-node-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(127, 200, 255, 0.9)" />
          <stop offset="70%" stopColor="rgba(127, 200, 255, 0.26)" />
          <stop offset="100%" stopColor="rgba(127, 200, 255, 0)" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(164, 223, 255, 0.88)" />
          <stop offset="100%" stopColor="rgba(164, 223, 255, 0)" />
        </radialGradient>
        <linearGradient id={`${id}-grid-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(16, 36, 59, 0.04)" />
          <stop offset="50%" stopColor="rgba(16, 36, 59, 0.02)" />
          <stop offset="100%" stopColor="rgba(16, 36, 59, 0)" />
        </linearGradient>
        {tracks.map((track) => (
          <filter
            key={`${track.id}-filter`}
            id={`${id}-${track.id}-blur`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation={track.blur} />
          </filter>
        ))}
      </defs>

      <g opacity="0.85">
        {[192, 338, 614, 746].map((y) => (
          <line
            key={`guide-${y}`}
            x1="-40"
            y1={y}
            x2="1240"
            y2={y}
            stroke={`url(#${id}-grid-fade)`}
            strokeWidth="1"
          />
        ))}
      </g>

      <g opacity="0.82">
        {tracks.map((track, index) => (
          <g key={track.id}>
            <path
              d={track.path}
              fill="none"
              stroke="rgba(127, 200, 255, 0.18)"
              strokeWidth={track.glowWidth}
              filter={`url(#${id}-${track.id}-blur)`}
            />
            <path
              d={track.path}
              fill="none"
              stroke="rgba(127, 200, 255, 0.92)"
              strokeWidth="1.8"
              strokeDasharray="1"
              strokeDashoffset="1"
              pathLength="1"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="1"
                to="0"
                dur="2.8s"
                begin={`${index * 0.2}s`}
                fill="freeze"
                calcMode="spline"
                keySplines="0.25 0.1 0.25 1"
                keyTimes="0;1"
              />
            </path>

            <g opacity="0">
              <animateMotion
                begin={track.delay}
                dur={track.duration}
                repeatCount="indefinite"
                path={track.path}
                calcMode="spline"
                keySplines="0.42 0 0.58 1"
                keyTimes="0;1"
              />
              <animate
                attributeName="opacity"
                values="0;0.34;0.34;0"
                keyTimes="0;0.08;0.78;1"
                dur={track.duration}
                begin={track.delay}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0 0 0.58 1;0 0 1 1;0.42 0 1 1"
              />
              <circle r="78" fill={`url(#${id}-node-glow)`} />
            </g>

            <g opacity="0">
              <animateMotion
                begin={track.delay}
                dur={track.duration}
                repeatCount="indefinite"
                path={track.path}
                calcMode="spline"
                keySplines="0.42 0 0.58 1"
                keyTimes="0;1"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.08;0.78;1"
                dur={track.duration}
                begin={track.delay}
                repeatCount="indefinite"
                calcMode="spline"
                keySplines="0 0 0.58 1;0 0 1 1;0.42 0 1 1"
              />
              <circle r="6" fill="rgba(29, 115, 232, 0.95)" />
            </g>
          </g>
        ))}
      </g>

      <g opacity="0.65">
        <circle cx="214" cy="160" r="150" fill={`url(#${id}-halo)`} />
        <circle cx="312" cy="762" r="176" fill={`url(#${id}-halo)`} />
        <circle cx="1032" cy="456" r="180" fill={`url(#${id}-halo)`} />
      </g>
    </svg>
  )
}
