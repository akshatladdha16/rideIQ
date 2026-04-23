type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

const configuredLevel = parseLogLevel(process.env.RIDEIQ_LOG_LEVEL);

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}

function formatPayload(
  level: LogLevel,
  scope: string,
  message: string,
  metadata?: Record<string, unknown>
): string {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
  };

  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  return JSON.stringify(payload);
}

function emit(level: LogLevel, text: string): void {
  if (level === "error") {
    console.error(text);
    return;
  }
  if (level === "warn") {
    console.warn(text);
    return;
  }
  console.log(text);
}

export function log(
  level: LogLevel,
  scope: string,
  message: string,
  metadata?: Record<string, unknown>
): void {
  if (!shouldLog(level)) {
    return;
  }

  emit(level, formatPayload(level, scope, message, metadata));
}

export const logger = {
  debug: (scope: string, message: string, metadata?: Record<string, unknown>) =>
    log("debug", scope, message, metadata),
  info: (scope: string, message: string, metadata?: Record<string, unknown>) =>
    log("info", scope, message, metadata),
  warn: (scope: string, message: string, metadata?: Record<string, unknown>) =>
    log("warn", scope, message, metadata),
  error: (scope: string, message: string, metadata?: Record<string, unknown>) =>
    log("error", scope, message, metadata),
};
