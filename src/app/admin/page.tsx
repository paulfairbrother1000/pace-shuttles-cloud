"use client";

import { useState } from "react";

type Trend = "up" | "down" | "none";

interface TileProps {
  title: string;
  value: string | number;
  trend?: Trend;
  filters?: { label: string; value: string }[];
}

function Tile({ title, value, trend = "none", filters = [] }: TileProps) {
  return (
    <div className="flex flex-col mb-10 w-full">
      {/* TITLE */}
      <h3 className="text-sm font-medium mb-1">{title}</h3>

      {/* FILTERS */}
      <div className="flex flex-wrap gap-2 mb-2">
        {filters.map((f, idx) => (
          <select
            key={idx}
            className="border rounded-md px-2 py-1 text-sm bg-white"
            defaultValue={f.value}
          >
            <option>{f.value}</option>
          </select>
        ))}
      </div>

      {/* TILE BOX */}
      <div className="border rounded-xl p-6 relative bg-white shadow-sm hover:shadow cursor-pointer transition">
        <div className="text-3xl font-semibold text-center">{value}</div>

        {trend === "up" && (
          <span className="absolute top-2 right-3 text-green-600 text-xl font-bold">
            ▲
          </span>
        )}
        {trend === "down" && (
          <span className="absolute bottom-2 right-3 text-red-600 text-xl font-bold">
            ▼
          </span>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="px-8 py-10 bg-white min-h-screen">
      <h1 className="text-3xl font-bold mb-10">Pace Shuttles Management Dashboard</h1>

      {/* ========================= OVERVIEW ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="Territories"
            value="4"
          />

          <Tile
            title="Operators"
            value="12"
            filters={[{ label: "Territory", value: "Territory: All" }]}
          />

          <Tile
            title="Destinations"
            value="22"
            trend="up"
            filters={[{ label: "Territory", value: "Territory: All" }]}
          />

          <Tile
            title="Transport Types"
            value="4"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
            ]}
          />
        </div>
      </section>

      {/* ========================= OPERATOR PERFORMANCE ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Operator Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="Completed Journeys"
            value="15"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
            ]}
          />

          <Tile
            title="Scheduled Journeys"
            value="46"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
            ]}
          />

          <Tile
            title="Refunded Cancellations"
            value="5%"
            trend="down"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

          <Tile
            title="CSAT"
            value="78%"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

        </div>
      </section>

      {/* ========================= FINANCIALS ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Financials</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="Revenue"
            value="$23,000"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

          <Tile
            title="Average Commission"
            value="11.5%"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

          <Tile
            title="Average Cost per Seat"
            value="$94.50"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

          <Tile
            title="Average Seats per Booking"
            value="1.7"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />
        </div>
      </section>

      {/* ========================= MARKETING ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Marketing</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="Social Media Mentions"
            value="104"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Platform", value: "Platform: All" },
            ]}
          />

          <Tile
            title="Available Influencer Journeys"
            value="23"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Transport Type", value: "Transport Type: All" },
            ]}
          />

          <Tile
            title="Available Influencer Destinations"
            value="40"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Destination", value: "Destination: All" },
              { label: "Route", value: "Route: All" },
            ]}
          />

          <Tile
            title="Customer Acquisition Cost"
            value="$11.45"
            trend="down"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Route", value: "Route: All" },
              { label: "Destination", value: "Destination: All" },
            ]}
          />
        </div>
      </section>

      {/* ========================= SUPPORT ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Support</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="All Contacts"
            value="104"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Operator", value: "Operator: All" },
              { label: "Type", value: "Type: All" },
              { label: "Category", value: "Category: All" },
            ]}
          />

          <Tile
            title="Average Ticket Age"
            value="11 hours"
            trend="up"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Type", value: "Type: All" },
            ]}
          />

          <Tile
            title="Agent Resolved"
            value="40%"
            trend="down"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Type", value: "Type: All" },
              { label: "Category", value: "Category: All" },
            ]}
          />

          <Tile
            title="Complaints"
            value="9"
            trend="down"
            filters={[
              { label: "Territory", value: "Territory: All" },
              { label: "Route", value: "Route: All" },
              { label: "Destination", value: "Destination: All" },
              { label: "Operator", value: "Operator: All" },
            ]}
          />
        </div>
      </section>

      {/* ========================= SERVICE DELIVERY ========================= */}
      <section className="mb-16">
        <h2 className="text-xl font-semibold mb-6">Service Delivery</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">

          <Tile
            title="New Releases"
            value="1"
            trend="up"
            filters={[{ label: "Module", value: "Module: All" }]}
          />

          <Tile
            title="Backlog"
            value="23"
            trend="down"
            filters={[
              { label: "Type", value: "Type: All" },
              { label: "Module", value: "Module: All" },
            ]}
          />

          <Tile
            title="Availability"
            value="99%"
            filters={[
              { label: "Territory", value: "Territory: All" },
            ]}
          />

          <Tile
            title="Major Incidents"
            value="0"
            filters={[
              { label: "Territory", value: "Territory: All" },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
