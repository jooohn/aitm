interface Props {
  size?: number;
}

export default function TrashIcon({ size = 16 }: Props) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.54l-.7 9.83a1.75 1.75 0 0 1-1.747 1.67H5.737a1.75 1.75 0 0 1-1.747-1.67L3.29 4.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.794 4.5l.692 9.72a.25.25 0 0 0 .249.239h4.53a.25.25 0 0 0 .25-.238l.692-9.721H4.794Z" />
    </svg>
  );
}
