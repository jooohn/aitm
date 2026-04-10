import type { ReactNode } from "react";
import styles from "./NotFoundMessage.module.css";
import SorryCat from "./SorryCat";

interface Props {
  children: ReactNode;
}

export default function NotFoundMessage({ children }: Props) {
  return (
    <div role="alert" className={styles.container}>
      <SorryCat className={styles.cat} />
      <p className={styles.message}>{children}</p>
    </div>
  );
}
