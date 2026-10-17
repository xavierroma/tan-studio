import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import { Button } from "@tan-studio/ui/components/button"
import { Input } from "@tan-studio/ui/components/input"
import { Field, FieldLabel } from "@tan-studio/ui/components/field"
import {
  listAgentCredentials,
  mintAgentCredential,
  revokeAgentCredential,
} from "@/lib/api"
import { usesOperatorSession } from "@/lib/companion-client"

const key = ["agent-credentials"] as const
export function AgentCredentialSettings() {
  const cache = useQueryClient()
  const [term, setTerm] = useState("days")
  const [secret, setSecret] = useState<string | null>(null)
  const credentials = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listAgentCredentials(signal),
    enabled: usesOperatorSession,
  })
  const refresh = () => void cache.invalidateQueries({ queryKey: key })
  const mint = useMutation({
    mutationFn: mintAgentCredential,
    gcTime: 0,
    onSuccess: (data) => {
      setSecret(data.secret)
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const revoke = useMutation({
    mutationFn: revokeAgentCredential,
    onSuccess: () => {
      refresh()
      toast.success("Agent access revoked")
    },
    onError: (error) => toast.error(error.message),
  })
  if (!usesOperatorSession) return null
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    mint.mutate({
      label: String(form.get("label") ?? "").trim(),
      write: form.get("permission") === "write",
      ...(term === "five-years"
        ? { expiresInYears: 5 }
        : { expiresInDays: Number(form.get("days")) }),
    })
  }
  return (
    <Card className="mt-6 max-w-4xl">
      <CardHeader>
        <CardTitle>
          <h2>Agent connections</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          Give each remote agent its own expiring access to this notebook.
          Read-only access cannot change records. Revoking access stops new
          requests immediately.
        </p>
        {credentials.error ? (
          <p role="alert">Could not load agent connections. Try again.</p>
        ) : null}
        {credentials.data?.enabled ? (
          <>
            <p className="text-sm">
              MCP address: <code>{credentials.data.endpoint}</code>
            </p>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
              <Field>
                <FieldLabel htmlFor="agent-label">Agent name</FieldLabel>
                <Input
                  id="agent-label"
                  name="label"
                  required
                  maxLength={64}
                  placeholder="Research assistant"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-permission">Access</FieldLabel>
                <select
                  className="rounded-md border p-2 text-sm"
                  id="agent-permission"
                  name="permission"
                  defaultValue="read"
                >
                  <option value="read">Read only</option>
                  <option value="write">Read and write notebook records</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-term">
                  Credential lifetime
                </FieldLabel>
                <select
                  id="agent-term"
                  className="rounded-md border p-2 text-sm"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                >
                  <option value="days">1–90 days</option>
                  <option value="five-years">Five calendar years</option>
                </select>
              </Field>
              {term === "days" ? (
                <Field>
                  <FieldLabel htmlFor="agent-days">Expires in days</FieldLabel>
                  <Input
                    id="agent-days"
                    name="days"
                    type="number"
                    min={1}
                    max={90}
                    defaultValue={30}
                    required
                  />
                </Field>
              ) : (
                <p className="text-muted-foreground max-w-xs text-sm">
                  Expires five years after creation. Revoke it here at any time.
                </p>
              )}
              <Button type="submit" disabled={mint.isPending}>
                Create agent credential
              </Button>
            </form>
          </>
        ) : credentials.data ? (
          <p className="text-muted-foreground text-sm">
            Remote agent connections are not enabled on this notebook.
          </p>
        ) : null}
        {secret ? (
          <div className="bg-muted flex flex-col gap-2 rounded-lg border p-4">
            <p className="text-sm">
              Copy this credential to the agent's secret store now. It will not
              be shown again.
            </p>
            <code className="text-xs break-all">{secret}</code>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSecret(null)
                mint.reset()
              }}
            >
              Done
            </Button>
          </div>
        ) : null}
        <ul className="flex flex-col gap-2">
          {credentials.data?.items.map((agent) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              key={agent.id}
            >
              <div>
                <p className="text-sm font-medium">
                  {agent.label} · {agent.write ? "Read and write" : "Read only"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {agent.revokedAtMs
                    ? "Revoked"
                    : agent.expiresAtMs <= Date.now()
                      ? "Expired"
                      : "Active"}{" "}
                  · Expires {new Date(agent.expiresAtMs).toLocaleString()} ·
                  Last used{" "}
                  {agent.lastUsedAtMs
                    ? new Date(agent.lastUsedAtMs).toLocaleString()
                    : "never"}
                </p>
              </div>
              {!agent.revokedAtMs ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(agent.id)}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          To rotate access, create a replacement, update the agent, then revoke
          the old credential. These credentials work with clients that accept
          bearer tokens; Google sign-in is for the notebook operator.
        </p>
      </CardContent>
    </Card>
  )
}
