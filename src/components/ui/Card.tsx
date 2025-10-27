import React from "react";

type Props = { children: React.ReactNode; className?: string };

export function Card({ children, className = "" }: Props) {
  return (
    <div className={`rounded-2xl shadow-sm border border-gray-200 bg-white ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: Props) {
  return <div className={`px-4 py-3 border-b border-gray-100 ${className}`}>{children}</div>;
}

export function CardContent({ children, className = "" }: Props) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
