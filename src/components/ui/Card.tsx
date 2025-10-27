"use client";
import React from "react";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl shadow-sm border border-gray-200 bg-white ${className}`}>{children}</div>;
}
export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-4 py-3 border-b border-gray-100 ${className}`}>{children}</div>;
}
export function CardContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
export function Button({
  children,
  onClick,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: any;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 border border-gray-300 bg-gray-50 hover:bg-gray-100 text-sm ${className}`}
    >
      {children}
    </button>
  );
}
