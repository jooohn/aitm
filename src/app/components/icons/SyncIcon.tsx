interface Props {
  size?: number;
  className?: string;
}

export default function SyncIcon({ size = 20, className }: Props) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <path
        d="M16.25 10a6.25 6.25 0 0 0-10.813-4.24M3.75 10a6.25 6.25 0 0 0 10.813 4.24M5 3.75v2.917h2.917M15 16.25v-2.917h-2.917"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
