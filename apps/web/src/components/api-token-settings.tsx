import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import { Field, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { KeyRoundIcon } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import {
  listApiTokens,
  mintApiToken,
  queryKeys,
  revokeApiToken,
  type ApiToken,
} from "@/lib/api"
import { usesOperatorSession } from "@/lib/companion-client"

function when(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "never"
}

/**
 * API tokens are how the MCP plugin and other HTTP clients reach the hosted
 * notebook, which they cannot sign into with Google. Only the operator's own
 * session may mint or revoke one, and the secret is shown here exactly once.
 */
export function ApiTokenSettings() {
  const queryClient = useQueryClient()
  const [secret, setSecret] = useState<string | null>(null)
  const tokens = useQuery({
    queryKey: queryKeys.apiTokens(),
    queryFn: ({ signal }) => listApiTokens(signal),
    enabled: usesOperatorSession,
  })
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens() })
  const mint = useMutation({
    mutationFn: mintApiToken,
    onSuccess: (minted) => {
      setSecret(minted.secret)
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: (token) => {
      toast.success(`Revoked ${token.label}`)
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  if (!usesOperatorSession) {
    return (
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>
            <h2>API tokens</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          This notebook runs locally, where clients use the launch token. API
          tokens exist on the hosted notebook.
        </CardContent>
      </Card>
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const label = String(form.get("label") ?? "").trim()
    if (!label) {
      toast.error("Name the client that will hold this token")
      return
    }
    event.currentTarget.reset()
    mint.mutate(label)
  }

  if (tokens.error) throw tokens.error

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle>
          <div className="flex items-center gap-3">
            <span className="bg-muted flex size-10 items-center justify-center rounded-full">
              <KeyRoundIcon />
            </span>
            <h2>API tokens</h2>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          A token lets one client — the Codex plugin, a script — use this
          notebook without your Google session. Revoke it and it stops working
          at once.
        </p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <Field className="min-w-56 flex-1">
            <FieldLabel htmlFor="api-token-label">Client</FieldLabel>
            <Input
              id="api-token-label"
              name="label"
              maxLength={64}
              placeholder="Codex plugin"
            />
          </Field>
          <Button type="submit" disabled={mint.isPending}>
            Mint token
          </Button>
        </form>
        {secret ? (
          <div className="border-primary/40 bg-muted flex flex-col gap-2 rounded-lg border p-4">
            <p className="text-sm font-medium">
              Copy this now. It is not shown again.
            </p>
            <code className="text-xs break-all">{secret}</code>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSecret(null)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(tokens.data ?? []).map((token: ApiToken) => (
            <li
              key={token.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{token.label}</span>
                  {token.revokedAt ? (
                    <Badge variant="warning">Revoked</Badge>
                  ) : (
                    <Badge variant="success">Active</Badge>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  Created {when(token.createdAt)} · Last used{" "}
                  {when(token.lastUsedAt)}
                </p>
              </div>
              {token.revokedAt ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(token.id)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
          {tokens.data?.length === 0 ? (
            <li className="text-muted-foreground text-sm">
              No tokens yet. Mint one for the client that needs it.
            </li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  )
}
