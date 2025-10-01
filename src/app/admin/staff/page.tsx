"use client";

// Re-export the existing Operator Admin page so both URLs work:
// - /operator/admin/staff  (operator menu)
// - /admin/staff           (admin menu)

export { default } from "../../operator/admin/staff/page";
