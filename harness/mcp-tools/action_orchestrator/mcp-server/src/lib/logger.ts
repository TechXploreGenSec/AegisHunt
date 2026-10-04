import pino from "pino";

const isStdio = process.env["MCP_TRANSPORT"] !== "http";

// In stdio mode, MCP protocol uses stdout — logs MUST go to stderr only.
// In HTTP mode, use pino-pretty for development.
export const logger = isStdio
  ? pino({ level: process.env["LOG_LEVEL"] ?? "info" }, pino.destination(2))
  : pino({
      level: process.env["LOG_LEVEL"] ?? "info",
      transport:
        process.env["NODE_ENV"] === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    });
