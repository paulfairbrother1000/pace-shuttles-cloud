"use client";

import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type TerritoryRow = {
  territory: string;
  startMonth: string;
  activeMonths: number;
  operators: number;
  destinations: number;
  vehicleTypes: number;
  routes: number;
  revenue: number;
  commission: number;
};

const TERRITORY_ROWS: TerritoryRow[] = [
  {
    territory: "Antigua & Barbuda",
    startMonth: "Nov-24",
    activeMonths: 12,
    operators: 3,
    destinations: 10,
    vehicleTypes: 4,
    routes: 25,
    revenue: 243_000,
    commission: 24_300,
  },
  {
    territory: "Barbados",
    startMonth: "Jan-25",
    activeMonths: 10,
    operators: 3,
    destinations: 8,
    vehicleTypes: 4,
    routes: 20,
    revenue: 216_000,
    commission: 23_760,
  },
  {
    territory: "BVI",
    startMonth: "Mar-25",
    activeMonths: 8,
    operators: 5,
    destinations: 6,
    vehicleTypes: 3,
    routes: 15,
    revenue: 81_500,
    commission: 9_780,
  },
  {
    territory: "St Kitts & Nevis",
    startMonth: "May-25",
    activeMonths: 6,
    operators: 2,
    destinations: 6,
    vehicleTypes: 2,
    routes: 10,
    revenue: 62_500,
    commission: 8_125,
  },
];

// Simple mock: spread total revenue across 12 months for demo
const MONTH_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const TERRITORY_REVENUE_SERIES = MONTH_LABELS.map((monthIndex, i) => {
  const month = i + 1;
  const data: any = { month: monthIndex };

  TERRITORY_ROWS.forEach((row) => {
    // naive even spread for demo purposes
    const perMonth = row.revenue / 12;
    data[row.territory] = perMonth;
  });

  return data;
});

type SortKey = keyof TerritoryRow;
type SortDirection = "asc" | "desc";

export default function TerritoriesDrilldownPage() {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedTerritories, setSelectedTerritories] = useState<string[]>(
    TERRITORY_ROWS.map((t) => t.territory)
  );

  const [dateRange, setDateRange] = useState("Last 12 months");

  const sortedRows = useMemo(() => {
    const rows = [...TERRITORY_ROWS];
    rows.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      const direction = sortDirection === "asc" ? 1 : -1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return aVal > bVal ? direction : -direction;
      }
      return String(aVal) > String(bVal) ? direction : -direction;
    });
    return rows;
  }, [sortKey, sortDirection]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const toggleTerritory = (territory: string) => {
    setSelectedTerritories((prev) =>
      prev.includes(territory)
        ? prev.filter((t) => t !== territory)
        : [...prev, territory]
    );
  };

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  return (
    <div className="px-8 py-10 bg-white min-h-screen space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Territories – Drilldown</h1>
          <p className="text-neutral-600 text-sm mt-1">
            Click a column header to sort. Use the checkboxes to add or remove territories from the chart.
          </p>
        </div>
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
        >
          <option>Last 12 months</option>
          <option>This year</option>
          <option>Last year</option>
        </select>
      </header>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th
                className="px-4 py-3 text-left cursor-pointer"
                onClick={() => toggleSort("territory")}
              >
                Territory{sortIndicator("territory")}
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer"
                onClick={() => toggleSort("startMonth")}
              >
                Start Month{sortIndicator("startMonth")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("activeMonths")}
              >
                Active Months{sortIndicator("activeMonths")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("operators")}
              >
                Operators{sortIndicator("operators")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("destinations")}
              >
                Destinations{sortIndicator("destinations")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("vehicleTypes")}
              >
                Vehicle Types{sortIndicator("vehicleTypes")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("routes")}
              >
                Routes{sortIndicator("routes")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("revenue")}
              >
                Revenue{sortIndicator("revenue")}
              </th>
              <th
                className="px-4 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("commission")}
              >
                Commission{sortIndicator("commission")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.territory} className="border-t">
                <td className="px-4 py-2">{row.territory}</td>
                <td className="px-4 py-2">{row.startMonth}</td>
                <td className="px-4 py-2 text-right">{row.activeMonths}</td>
                <td className="px-4 py-2 text-right">{row.operators}</td>
                <td className="px-4 py-2 text-right">{row.destinations}</td>
                <td className="px-4 py-2 text-right">{row.vehicleTypes}</td>
                <td className="px-4 py-2 text-right">{row.routes}</td>
                <td className="px-4 py-2 text-right">
                  ${row.revenue.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  ${row.commission.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Series selector */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-medium">Show on chart:</span>
        {TERRITORY_ROWS.map((t) => (
          <label key={t.territory} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              className="rounded border-neutral-400"
              checked={selectedTerritories.includes(t.territory)}
              onChange={() => toggleTerritory(t.territory)}
            />
            {t.territory}
          </label>
        ))}
      </div>

      {/* Line chart */}
      <div className="h-80 w-full border rounded-xl bg-white shadow-sm p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={TERRITORY_REVENUE_SERIES}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            {selectedTerritories.map((t) => (
              <Line
                key={t}
                type="monotone"
                dataKey={t}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
