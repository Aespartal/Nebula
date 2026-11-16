import type { ButtonHTMLAttributes, RefAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-5 py-2 font-bold " +
  "disabled:opacity-60 disabled:cursor-not-allowed";
const variants = {
  primary: "bg-accent text-on-accent hover:brightness-110",
  secondary: "border-2 border-line text-text hover:bg-surface",
} as const;

type Variant = keyof typeof variants;

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}

export function LinkButton({ variant = "primary", className = "", ...rest }: LinkProps & RefAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...rest} />;
}
