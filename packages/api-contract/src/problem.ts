import { z } from "zod"
import { RevisionSchema, SafeIntegerSchema, UuidSchema } from "./primitives"

function isJsonPointer(value: string): boolean {
  if (value === "") return true
  return (
    value.startsWith("/") &&
    value
      .split("/")
      .slice(1)
      .every((segment) => !/(?:~(?![01]))/.test(segment))
  )
}

export const ApiFieldErrorSchema = z
  .object({
    path: z
      .string()
      .max(2_048)
      .refine(isJsonPointer, "Expected an RFC 6901 JSON Pointer"),
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    message: z.string().min(1).max(1_000),
  })
  .strict()

export const ApiProblemSchema = z
  .object({
    type: z
      .string()
      .regex(/^https:\/\/tan\.studio\/problems\/[a-z][a-z0-9-]{0,127}$/),
    title: z.string().min(1).max(200),
    status: SafeIntegerSchema.min(400).max(599),
    detail: z.string().min(1).max(2_000),
    instance: z.string().startsWith("/").max(2_048),
    code: z.string().regex(/^[a-z][a-z0-9_]{0,127}$/),
    correlationId: UuidSchema,
    retryable: z.boolean(),
    retryAfterMs: SafeIntegerSchema.min(0).optional(),
    fieldErrors: z.array(ApiFieldErrorSchema).max(100).optional(),
    currentRevision: RevisionSchema.optional(),
  })
  .strict()
  .superRefine((problem, context) => {
    if (problem.retryAfterMs !== undefined && !problem.retryable) {
      context.addIssue({
        code: "custom",
        message: "retryAfterMs requires retryable=true",
        path: ["retryAfterMs"],
      })
    }
  })

export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>
export type ApiProblem = z.infer<typeof ApiProblemSchema>
