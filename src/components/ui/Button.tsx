"use client";
import React from "react";

type ButtonProps = {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
};

export function Button({
  children,
  onClick,
  type = "button",
  className = "",
  disabled,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 border border-gray-300 bg-gray-50 hover:bg-gray-100 text-sm disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}
