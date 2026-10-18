import { z } from "zod"
import contract from "./generated/openapi.json"

type JsonSchema = Exclude<Parameters<typeof z.fromJSONSchema>[0], boolean>
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
interface Parameter {
  name: string
  in: "path" | "query" | "header"
  required?: boolean
  description?: string
  schema: JsonSchema
}
interface OperationContract {
  operationId: string
  summary?: string
  description?: string
  parameters?: Parameter[]
  requestBody?: {
    required?: boolean
    content: Record<string, { schema?: JsonSchema }>
  }
  responses: Record<
    string,
    { content?: Record<string, { schema?: JsonSchema }> }
  >
}
interface ApiDocument {
  paths: Record<
    string,
    Partial<Record<Lowercase<ApiMethod>, OperationContract>>
  >
  components: { schemas: Record<string, JsonSchema> }
}
export interface ApiOperation {
  name: string
  operationId: string
  method: ApiMethod
  path: string
  description: string
  inputSchema: Record<string, z.ZodType>
  binaryRequest: boolean
  binaryResponse: boolean
  parameters: Parameter[]
}
export interface ApiArguments {
  path?: Record<string, string | number>
  query?: Record<string, JsonValue>
  headers?: Record<string, string | number>
  body?: JsonValue
  contentBase64?: string
}

const isIfMatch = (name: string) => name.toLowerCase() === "if-match"

/**
 * The service accepts only the strong tag `"revision:N"`. Callers usually hold the
 * record's numeric `revision`, so unambiguous spellings of one revision number
 * (`3`, `"3"`, `revision:3`) become that tag. The service still compares the
 * exact revision; anything else passes through and is rejected with guidance.
 */
export function revisionTag(value: string | number): string {
  const match = /^\s*"?(?:revision:)?([1-9]\d*)"?\s*$/u.exec(String(value))
  return match ? `"revision:${match[1]}"` : String(value)
}

export function headerValue(name: string, value: string | number): string {
  return isIfMatch(name) ? revisionTag(value) : String(value)
}

// JSON imports widen OpenAPI literal types; conversion is checked against every operation in tests.
const document = contract as unknown as ApiDocument
const methods = ["get", "post", "put", "patch", "delete"] as const
const definitions = document.components.schemas

export function apiToolName(operationId: string): string {
  return `tan_api_${operationId.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`
}

function schema(input: JsonSchema): z.ZodType {
  // OpenAPI 3.1 uses JSON Schema. Move its local components into $defs for Zod.
  const json = JSON.stringify({ ...input, $defs: definitions }).replaceAll(
    "#/components/schemas/",
    "#/$defs/"
  )
  return z.fromJSONSchema(JSON.parse(json) as JsonSchema)
}

function operation(
  method: Lowercase<ApiMethod>,
  path: string,
  spec: OperationContract
): ApiOperation {
  const parameters = spec.parameters ?? []
  const inputSchema: Record<string, z.ZodType> = {}
  for (const location of ["path", "query", "header"] as const) {
    const fields: Record<string, z.ZodType> = {}
    const selected = parameters.filter((p) => p.in === location)
    for (const parameter of selected) {
      const base =
        location === "header" && isIfMatch(parameter.name)
          ? // Models see the record's numeric revision; accept it as-is too.
            z.union([z.string().min(1), z.number().int().positive()])
          : schema(parameter.schema)
      const field = parameter.description
        ? base.describe(parameter.description)
        : base
      fields[parameter.name] = parameter.required ? field : field.optional()
    }
    if (selected.length) {
      const group = z.strictObject(fields)
      inputSchema[location === "header" ? "headers" : location] = selected.some(
        (p) => p.required
      )
        ? group
        : group.optional()
    }
  }
  const content = spec.requestBody?.content
  const binaryRequest = content?.["application/octet-stream"] !== undefined
  if (binaryRequest) {
    inputSchema.contentBase64 = z
      .base64()
      .describe("Exact file bytes encoded as base64; not a local file path.")
  } else if (content) {
    const json = content["application/json"]
    if (!json)
      throw new Error(`Unsupported API request content: ${method} ${path}`)
    const body = schema(json.schema ?? {})
    inputSchema.body = spec.requestBody?.required ? body : body.optional()
  }
  const binaryResponse = Object.entries(spec.responses).some(
    ([status, response]) =>
      status.startsWith("2") &&
      response.content?.["application/octet-stream"] !== undefined
  )
  return {
    name: apiToolName(spec.operationId),
    operationId: spec.operationId,
    method: method.toUpperCase() as ApiMethod,
    path,
    description: `${spec.summary ?? spec.description ?? spec.operationId}. ${method.toUpperCase()} ${path}. Uses the exact REST fields and units; If-Match headers retain revision protection. API permissions still apply.`,
    inputSchema,
    binaryRequest,
    binaryResponse,
    parameters,
  }
}

/** Every versioned HTTP operation gets a schema-complete tool. No route strings from callers. */
export const apiOperations = Object.entries(document.paths).flatMap(
  ([path, item]) =>
    methods.flatMap((method) =>
      item[method] ? [operation(method, path, item[method])] : []
    )
)
if (new Set(apiOperations.map((op) => op.name)).size !== apiOperations.length)
  throw new Error("Duplicate MCP API operation name")
export const apiOperationsByName = new Map(
  apiOperations.map((op) => [op.name, op])
)

export function operationInput(op: ApiOperation, value: unknown): ApiArguments {
  return z.strictObject(op.inputSchema).parse(value) as ApiArguments
}

export function operationPath(op: ApiOperation, args: ApiArguments): string {
  return op.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = args.path?.[name]
    if (value === undefined || !/^[A-Za-z0-9_-]+$/.test(String(value)))
      throw new Error(`Invalid path parameter: ${name}`)
    return encodeURIComponent(String(value))
  })
}
