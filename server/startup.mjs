export function parsePort(value) {
  if (value === undefined) return 5173;
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Invalid PORT value "${value}". Set PORT to an integer from 1 to 65535.`,
    );
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT value "${value}". Set PORT to an integer from 1 to 65535.`,
    );
  }
  return port;
}

export function formatStartupError(error, port) {
  if (error?.code === "EADDRINUSE") {
    return `Port ${port} is already in use. Stop the other process or set PORT to an available port.`;
  }
  if (error?.code === "EACCES" || error?.code === "EADDRNOTAVAIL") {
    return `Cannot listen on 127.0.0.1:${port} (${error.code}). Choose an available port above 1024 with PORT.`;
  }
  return `Could not listen on 127.0.0.1:${port}: ${error?.message ?? String(error)}`;
}
