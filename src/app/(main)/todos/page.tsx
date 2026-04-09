import styles from "./page.module.css";

export default function TodosPage() {
  return (
    <div className={styles.emptyDetail}>
      <p>Select an item to inspect its details.</p>
    </div>
  );
}
