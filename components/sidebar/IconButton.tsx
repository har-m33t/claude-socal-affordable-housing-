"use client";
// A compact 28px icon button with a CSS tooltip (data-tip) and an accessible name.

export function IconButton({
  label,
  onClick,
  disabled,
  primary,
  pressed,
  tipSide = "bottom",
  children,
  className = "",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  pressed?: boolean;
  tipSide?: "bottom" | "left";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`sb-icon-btn ${primary ? "sb-icon-btn-primary" : ""} ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      data-tip={label}
      data-tip-side={tipSide}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
