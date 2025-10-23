"use client";
import React from "react";

export default class HeaderBoundary extends React.Component<
  { fallback?: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props:any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err:any) {
    if (process.env.NODE_ENV !== "production") console.error("Header crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null; // render nothing or a tiny bar
    }
    return this.props.children;
  }
}
