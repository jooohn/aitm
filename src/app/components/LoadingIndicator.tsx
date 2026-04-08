import styles from "./LoadingIndicator.module.css";

interface Props {
  className?: string;
  label?: string;
  testId?: string;
}

export default function LoadingIndicator({
  className,
  label = "Loading",
  testId,
}: Props) {
  return (
    <span
      role="status"
      aria-label={label}
      data-testid={testId}
      className={[styles.indicator, className].filter(Boolean).join(" ")}
    />
  );
}
