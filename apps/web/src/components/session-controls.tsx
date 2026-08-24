import { Badge } from "@tan-studio/ui/components/badge"
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
        <span
          className="bg-secondary flex size-8 items-center justify-center rounded-full border text-xs font-semibold"
          aria-label="User profile"
        >
          XR
        </span>
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
        <a
          href="/auth/logout"
          className="text-muted-foreground hover:text-foreground text-[0.625rem] leading-tight font-medium"
        >
          Sign out
        </a>
      </>
    )
  }

  return (
    <>
      <Badge variant="warning">Signed out</Badge>
      <a
        href="/auth/google"
        className="text-muted-foreground hover:text-foreground text-center text-[0.625rem] leading-tight font-medium"
      >
        Sign in with Google
      </a>
    </>
  )
}
