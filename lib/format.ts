export function formatCurrency(value: number | null | undefined): string {
  const numeric = value ?? 0;
  return `₹${numeric.toFixed(2)}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDistance(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value.toFixed(2)} km`;
}

export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value.toFixed(2)} mins`;
}
