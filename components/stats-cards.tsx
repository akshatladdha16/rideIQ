import { CarTaxiFront, IndianRupee, Receipt, WalletCards } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { DashboardStats } from "@/lib/types";

interface StatsCardsProps {
  stats: DashboardStats;
}

export function StatsCards({ stats }: StatsCardsProps): JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
          <IndianRupee className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="text-2xl font-semibold">
          {formatCurrency(stats.totalSpend)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Rides</CardTitle>
          <CarTaxiFront className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="text-2xl font-semibold">{stats.totalRides}</CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Fare</CardTitle>
          <WalletCards className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="text-2xl font-semibold">
          {formatCurrency(stats.avgFare)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total GST Paid</CardTitle>
          <Receipt className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="text-2xl font-semibold">
          {formatCurrency(stats.totalGstPaid)}
        </CardContent>
      </Card>
    </div>
  );
}
