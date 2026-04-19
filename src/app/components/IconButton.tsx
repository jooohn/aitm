import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./IconButton.module.css";

export type IconButtonVariant = "default" | "destructive" | "primary";
export type IconButtonSize = "sm" | "md";

type CommonProps = {
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  className?: string;
  children: ReactNode;
  "aria-label": string;
  title?: string;
};

type AsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    href?: undefined;
  };

type AsLinkProps = CommonProps & {
  href: string;
  prefetch?: boolean;
};

export type IconButtonProps = AsButtonProps | AsLinkProps;

function classes(
  variant: IconButtonVariant,
  size: IconButtonSize,
  className?: string,
): string {
  return [
    styles.root,
    styles[`variant-${variant}`],
    styles[`size-${size}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function IconButton(props: IconButtonProps) {
  const { variant = "default", size = "md", className, children } = props;
  const cls = classes(variant, size, className);

  if ("href" in props && props.href !== undefined) {
    const { href, prefetch, "aria-label": ariaLabel, title } = props;
    return (
      <Link
        href={href}
        prefetch={prefetch}
        className={cls}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </Link>
    );
  }

  const {
    type = "button",
    variant: _v,
    size: _s,
    className: _c,
    children: _ch,
    ...rest
  } = props;
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
