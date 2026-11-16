import type { ButtonHTMLAttributes, RefAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

const base =
  "inline-flex min-h-[var(--control-h)] items-center justify-center gap-2 rounded-ctl px-4 text-meta font-bold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants = {
  primary: "bg-accent text-on-accent hover:bg-white",
  secondary: "border border-line bg-surface text-text hover:border-muted hover:bg-raised",
} as const;

type Variant = keyof typeof variants;

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}

export function LinkButton({ variant = "primary", className = "", ...rest }: LinkProps & RefAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
