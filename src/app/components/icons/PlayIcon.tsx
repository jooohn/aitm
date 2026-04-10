interface Props {
  size?: number;
}

export default function PlayIcon({ size = 16 }: Props) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.5 2.5a.75.75 0 0 1 1.15-.634l7.5 4.75a.75.75 0 0 1 0 1.268l-7.5 4.75A.75.75 0 0 1 4.5 12V2.5Z" />
    </svg>
  );
}
