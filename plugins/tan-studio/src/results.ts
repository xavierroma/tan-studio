import type { CallToolResult } from "@modelcontextprotocol/server"

import { TanStudioGatewayError } from "./gateway"

export function success(summary: string, data: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${summary}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
    structuredContent: { data },
  }
}

/** Keep hosted output bounded before duplicating it as text and structured data. */
export function hostedSuccess(
  summary: string,
  data: unknown,
  mutation = false
): CallToolResult {
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength <= 128 * 1024)
    return success(summary, data)
  if (mutation) {
    const record =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {}
    return success(summary, {
      committed: true,
      resultTruncated: true,
      ...(typeof record.id === "number" ? { id: record.id } : {}),
      ...(typeof record.revision === "number"
        ? { revision: record.revision }
        : {}),
      message:
        "The write succeeded. Fetch the resource to inspect its current state; do not repeat the write.",
    })
  }
  return failure(
    new TanStudioGatewayError({
      code: "result_too_large",
      message:
        "The result is too large. Narrow the query or request a smaller resource.",
      status: 413,
      retryable: false,
    })
  )
}

export function failure(error: unknown): CallToolResult {
  if (error instanceof TanStudioGatewayError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error.code,
              message: error.message,
              status: error.status,
              retryable: error.retryable,
              ...(error.correlationId
                ? { correlationId: error.correlationId }
                : {}),
              ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
              ...(error.currentRevision !== undefined
                ? {
                    currentRevision: error.currentRevision,
                    // Never retry blindly: the record changed since it was read.
                    recovery:
                      error.code === "revision_header_invalid"
                        ? `Send If-Match "revision:${error.currentRevision}" if that is the revision you read; otherwise fetch the record again first.`
                        : `Fetch the record again and confirm the change still applies, then retry with If-Match "revision:${error.currentRevision}".`,
                  }
                : {}),
            },
            null,
            2
          ),
        },
      ],
    }
  }

  const message =
    "Tan Studio request failed. Check the service logs using the request correlation ID."
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}

export async function protect(
  operation: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await operation()
  } catch (error) {
    return failure(error)
  }
}
