const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export async function readJsonBody(req, options = {}) {
  const limitBytes = options.limitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  const raw = await readRequestBody(req, limitBytes);

  try {
    return JSON.parse(raw || "{}");
  } catch {
    const error = new Error("Invalid JSON request body.");
    error.code = "invalid_json";
    error.status = 400;
    throw error;
  }
}

async function readRequestBody(req, limitBytes) {
  let size = 0;
  let body = "";

  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    size += Buffer.byteLength(value);

    if (size > limitBytes) {
      const error = new Error("Request body is too large.");
      error.code = "request_body_too_large";
      error.status = 413;
      throw error;
    }

    body += value;
  }

  return body;
}
