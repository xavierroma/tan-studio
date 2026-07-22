import { Link, useRouter } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { buttonVariants } from "@tan-studio/ui/components/button"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  HouseIcon,
  RefreshCwIcon,
} from "lucide-react"

export function AppPendingScreen() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-8 sm:px-7">
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-[32rem] max-w-full" />
      </div>
      <Skeleton className="h-[28rem] w-full rounded-xl" />
    </div>
  )
}

export function AppErrorScreen({
  error,
  reset,
}: {
  error: Error
  reset?: () => void
}) {
  const router = useRouter()
  const retry = () => {
    reset?.()
    void router.invalidate()
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-5 py-10 sm:px-7">
      <Alert variant="destructive" className="p-5">
        <AlertTriangleIcon />
        <AlertTitle>This view could not be opened</AlertTitle>
        <AlertDescription>
          <p>{error.message || "Tan Studio hit an unexpected local error."}</p>
          <p>
            Your roast database is unchanged. Retry the request, go back, or
            return to the roast notebook.
          </p>
          {import.meta.env.DEV && error.stack ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Development stack trace
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonVariants()} onClick={retry}>
              <RefreshCwIcon data-icon="inline-start" />
              Retry
            </button>
            <button
              type="button"
              className={buttonVariants({ variant: "outline" })}
              onClick={() => window.history.back()}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Go back
            </button>
            <Link
              to="/roasts"
              search={{
                q: undefined,
                status: undefined,
                profileId: undefined,
                coffeeId: undefined,
                sort: undefined,
                hidden: undefined,
                density: undefined,
                rest: undefined,
                view: undefined,
              }}
              className={buttonVariants({ variant: "outline" })}
            >
              <HouseIcon data-icon="inline-start" />
              Roast notebook
            </Link>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  )
}
