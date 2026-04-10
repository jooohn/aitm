export default function SorryCat({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="A sad cat apologizing"
    >
      <title>Sorry cat</title>
      <defs>
        <radialGradient id="sorryCatFill" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M55 100 Q55 72 68 58 Q76 50 84 62 L92 76 Q100 72 108 76 L116 62 Q124 50 132 58 Q145 72 145 100 Q145 148 100 152 Q55 148 55 100 Z"
          fill="url(#sorryCatFill)"
        />
        <path d="M74 60 L84 74 L90 68" />
        <path d="M126 60 L116 74 L110 68" />
        <path d="M78 110 L85 104 L92 110" />
        <path d="M108 110 L115 104 L122 110" />
        <path d="M97 122 L103 122 L100 127 Z" fill="currentColor" />
        <path d="M92 136 Q100 130 108 136" />
        <path d="M72 122 L54 118" />
        <path d="M72 127 L54 131" />
        <path d="M128 122 L146 118" />
        <path d="M128 127 L146 131" />
      </g>
    </svg>
  );
}
