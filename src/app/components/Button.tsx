import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type AsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    href?: undefined;
  };

type AsLinkProps = CommonProps & {
  href: string;
  prefetch?: boolean;
  "aria-label"?: string;
  title?: string;
};

export type ButtonProps = AsButtonProps | AsLinkProps;

function classes(
  variant: ButtonVariant,
  size: ButtonSize,
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

export default function Button(props: ButtonProps) {
  const { variant = "secondary", size = "md", className, children } = props;
  const cls = classes(variant, size, className);

  if ("href" in props && props.href !== undefined) {
    const { href, prefetch, ...rest } = props;
    const {
      variant: _v,
      size: _s,
      className: _c,
      children: _ch,
      ...linkRest
    } = rest;
    return (
      <Link href={href} prefetch={prefetch} className={cls} {...linkRest}>
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
