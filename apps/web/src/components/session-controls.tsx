import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { useEffect, useState } from "react"

import {
  fetchOperatorSignedIn,
  usesOperatorSession,
} from "@/lib/companion-client"

type OperatorSessionState = "checking" | "signed-in" | "signed-out"

/**
 * The session cookie is HttpOnly, so the notebook itself is the only source of truth.
 * One probe per page load is enough: signing in and out are full navigations.
 */
function useOperatorSessionState(): OperatorSessionState {
  const [state, setState] = useState<OperatorSessionState>("checking")

  useEffect(() => {
    if (!usesOperatorSession) return
    let current = true
    fetchOperatorSignedIn()
      .then((signedIn) => {
        if (current) setState(signedIn ? "signed-in" : "signed-out")
      })
      .catch(() => {
        if (current) setState("signed-out")
      })
    return () => {
      current = false
    }
  }, [])

  return state
}

/**
 * Hosted mode shows the operator session; every other placement is the local notebook.
 */
export function SessionControls() {
  const session = useOperatorSessionState()

  if (!usesOperatorSession) {
    return (
      <>
        <Badge variant="info">Local</Badge>
      </>
    )
  }

  if (session === "checking") {
    return <Badge variant="secondary">Checking</Badge>
  }

  if (session === "signed-in") {
    return (
      <>
        <Badge variant="success">Signed in</Badge>
        {/* A form, not a link: sign-out is a POST so no other site can fire it. */}
        <form method="post" action="/auth/logout">
          <Button
            variant="link"
            type="submit"
            className="text-muted-foreground hover:text-foreground text-[0.625rem] leading-tight font-medium"
          >
            Sign out
          </Button>
        </form>
      </>
    )
  }

  return (
    <>
      <Badge variant="warning">Signed out</Badge>
      <Button
        nativeButton={false}
        role="link"
        variant="link"
        render={<a href="/auth/google" />}
      >
        Sign in with Google
      </Button>
    </>
  )
}
