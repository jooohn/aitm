interface Props {
  size?: number;
  className?: string;
}

export default function ListIcon({ size = 20, className }: Props) {
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
        d="M6 5.75h8M6 10h8M6 14.25h5M3.75 5.75h.5M3.75 10h.5M3.75 14.25h.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
