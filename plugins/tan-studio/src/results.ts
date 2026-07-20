import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

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
            },
            null,
            2
          ),
        },
      ],
    }
  }

  const message =
    error instanceof Error ? error.message : "Unknown Tan Studio error"
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
