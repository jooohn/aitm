import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import styles from "./Menu.module.css";

type MenuSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

export function MenuSurface({
  className,
  children,
  ref,
  ...rest
}: MenuSurfaceProps) {
  const cls = [styles.surface, className].filter(Boolean).join(" ");
  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  );
}

type MenuItemProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
};

export function MenuItem({
  className,
  type = "button",
  children,
  ...rest
}: MenuItemProps) {
  const cls = [styles.item, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
