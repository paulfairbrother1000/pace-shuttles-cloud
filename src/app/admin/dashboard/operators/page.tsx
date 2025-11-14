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

type OperatorRow = {
  operator: string;
  territory: string;
  revenue: number;
  revenuePerJourney: number;
  journeys: number;
  avgSeatsSold: number;
  revenuePerSeat: number;
  avgOccupancy: number; // 0–1
  csat: number; // 0–1
  reliability: number; // 0–1
  commission: number;
  commissionPerJourney: number;
};

const OPERATOR_ROWS: OperatorRow[] = [
  {
    operator: "Barefoot",
    territory: "Antigua & Barbuda",
    revenue: 100_000,
    revenuePerJourney: 1_000,
    journeys: 100,
    avgSeatsSold: 8,
    revenuePerSeat: 125,
    avgOccupancy: 0.92,
    csat: 0.9,
    reliability: 1,
    commission: 10_000,
    commissionPerJourney: 100,
  },
  {
    operator: "Antigua Boats",
    territory: "Antigua & Barbuda",
    revenue: 80_000,
    revenuePerJourney: 1_000,
    journeys: 80,
    avgSeatsSold: 7,
    revenuePerSeat: 142.86,
    avgOccupancy: 0.93,
    csat: 0.95,
    reliability: 1,
    commission: 8_000,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 3",
    territory: "Antigua & Barbuda",
    revenue: 63_000,
    revenuePerJourney: 1_000,
    journeys: 63,
    avgSeatsSold: 8,
    revenuePerSeat: 125,
    avgOccupancy: 0.92,
    csat: 0.75,
    reliability: 0.85,
    commission: 6_300,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 4",
    territory: "Barbados",
    revenue: 90_000,
    revenuePerJourney: 1_000,
    journeys: 90,
    avgSeatsSold: 6,
    revenuePerSeat: 166.67,
    avgOccupancy: 0.94,
    csat: 0.9,
    reliability: 1,
    commission: 9_000,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 5",
    territory: "Barbados",
    revenue: 61_000,
    revenuePerJourney: 1_000,
    journeys: 61,
    avgSeatsSold: 7,
    revenuePerSeat: 142.86,
    avgOccupancy: 0.93,
    csat: 0.8,
    reliability: 1,
    commission: 6_100,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 6",
    territory: "Barbados",
    revenue: 65_000,
    revenuePerJourney: 1_000,
    journeys: 65,
    avgSeatsSold: 8,
    revenuePerSeat: 125,
    avgOccupancy: 0.92,
    csat: 0.9,
    reliability: 1,
    commission: 6_500,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 7",
    territory: "BVI",
    revenue: 41_500,
    revenuePerJourney: 1_000,
    journeys: 42,
    avgSeatsSold: 6,
    revenuePerSeat: 166.67,
    avgOccupancy: 0.94,
    csat: 0.7,
    reliability: 0.8,
    commission: 4_150,
    commissionPerJourney: 100,
  },
  {
    operator: "Operator 8",
    territory: "BVI",
    revenue: 40_000,
    revenuePerJourney: 1_000,
    journeys: 40,
    avgSeatsSold: 5,
    revenuePerSeat: 200,
    avgOccupancy: 0.95,
    csat: 0.9,
    reliability: 1,
    commission: 4_000,
    commissionPerJourney: 100,
  },
];

// Monthly revenue test data from your operator/month sheet (simplified)
const MONTH_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const OPERATOR_MONTHLY_REVENUE = [
  {
    month: "1",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 0,
    "Operator 5": 0,
    "Operator 6": 0,
    "Operator 7": 0,
    "Operator 8": 0,
  },
  {
    month: "2",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 0,
    "Operator 5": 0,
    "Operator 6": 0,
    "Operator 7": 0,
    "Operator 8": 0,
  },
  {
    month: "3",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 0,
    "Operator 8": 0,
  },
  {
    month: "4",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 0,
    "Operator 8": 0,
  },
  {
    month: "5",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 4_500,
    "Operator 8": 5_000,
  },
  {
    month: "6",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 5_000,
    "Operator 8": 5_000,
  },
  {
    month: "7",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 4_500,
    "Operator 8": 5_000,
  },
  {
    month: "8",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 5_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 4_500,
    "Operator 8": 5_000,
  },
  {
    month: "9",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 7_500,
    "Operator 4": 0,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 4_000,
    "Operator 8": 5_000,
  },
  {
    month: "10",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 7_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 5_000,
    "Operator 8": 5_000,
  },
  {
    month: "11",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 7_500,
    "Operator 4": 10_000,
    "Operator 5": 6_000,
    "Operator 6": 6_500,
    "Operator 7": 7_000,
    "Operator 8": 5_000,
  },
  {
    month: "12",
    Barefoot: 10_000,
    "Antigua Boats": 8_000,
    "Operator 3": 7_500,
    "Operator 4": 10_000,
    "Operator 5": 7_000,
    "Operator 6": 6_500,
    "Operator 7": 7_000,
    "Operator 8": 5_000,
  },
];

type SortKey = keyof OperatorRow;
type SortDirection = "asc" | "desc";

export default function OperatorsDrilldownPage() {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedOperators, setSelectedOperators] = useState<string[]>(
    OPERATOR_ROWS.map((o) => o.operator)
  );
  const [territoryFilter, setTerritoryFilter] = useState<string>("All");
  const [dateRange, setDateRange] = useState("Last 12 months");

  const territoryOptions = Array.from(
    new Set(OPERATOR_ROWS.map((o) => o.territory))
  );

  const filteredRows = useMemo(() => {
    return OPERATOR_ROWS.filter((row) =>
      territoryFilter === "All" ? true : row.territory === territoryFilter
    );
  }, [territoryFilter]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
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
  }, [filteredRows, sortKey, sortDirection]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const toggleOperator = (op: string) => {
    setSelectedOperators((prev) =>
      prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op]
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
          <h1 className="text-3xl font-bold">Operators – Drilldown</h1>
          <p className="text-neutral-600 text-sm mt-1">
            Click a column header to sort. Use the checkboxes to add or remove operators from the chart.
          </p>
        </div>
        <div className="flex gap-3">
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white"
            value={territoryFilter}
            onChange={(e) => setTerritoryFilter(e.target.value)}
          >
            <option value="All">All territories</option>
            {territoryOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="border rounded-lg px-3 py-2 text-sm bg-white"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option>Last 12 months</option>
            <option>This year</option>
            <option>Last year</option>
          </select>
        </div>
      </header>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th
                className="px-3 py-3 text-left cursor-pointer"
                onClick={() => toggleSort("operator")}
              >
                Operator{sortIndicator("operator")}
              </th>
              <th
                className="px-3 py-3 text-left cursor-pointer"
                onClick={() => toggleSort("territory")}
              >
                Territory{sortIndicator("territory")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("revenue")}
              >
                Revenue{sortIndicator("revenue")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("revenuePerJourney")}
              >
                Rev / Journey{sortIndicator("revenuePerJourney")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("journeys")}
              >
                Journeys{sortIndicator("journeys")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("avgSeatsSold")}
              >
                Ave. Seats Sold{sortIndicator("avgSeatsSold")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("revenuePerSeat")}
              >
                Rev / Seat{sortIndicator("revenuePerSeat")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("avgOccupancy")}
              >
                Ave. Occupancy{sortIndicator("avgOccupancy")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("csat")}
              >
                CSAT{sortIndicator("csat")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("reliability")}
              >
                Reliability{sortIndicator("reliability")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("commission")}
              >
                Commission{sortIndicator("commission")}
              </th>
              <th
                className="px-3 py-3 text-right cursor-pointer"
                onClick={() => toggleSort("commissionPerJourney")}
              >
                Comm / Journey{sortIndicator("commissionPerJourney")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.operator} className="border-t">
                <td className="px-3 py-2">{row.operator}</td>
                <td className="px-3 py-2">{row.territory}</td>
                <td className="px-3 py-2 text-right">
                  £{row.revenue.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  £{row.revenuePerJourney.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">{row.journeys}</td>
                <td className="px-3 py-2 text-right">{row.avgSeatsSold}</td>
                <td className="px-3 py-2 text-right">
                  ${row.revenuePerSeat.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  {(row.avgOccupancy * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right">
                  {(row.csat * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right">
                  {(row.reliability * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-2 text-right">
                  ${row.commission.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  ${row.commissionPerJourney.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Series selector */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-medium">Show on chart:</span>
        {OPERATOR_ROWS.map((o) => (
          <label key={o.operator} className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              className="rounded border-neutral-400"
              checked={selectedOperators.includes(o.operator)}
              onChange={() => toggleOperator(o.operator)}
            />
            {o.operator}
          </label>
        ))}
      </div>

      {/* Line chart */}
      <div className="h-80 w-full border rounded-xl bg-white shadow-sm p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={OPERATOR_MONTHLY_REVENUE}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            {selectedOperators.map((op) => (
              <Line
                key={op}
                type="monotone"
                dataKey={op}
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
