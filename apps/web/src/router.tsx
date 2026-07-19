import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"
import { AppErrorScreen, AppPendingScreen } from "@/components/app-error-screen"
import { buttonVariants } from "@tan-studio/ui/components/button"
import { Link } from "@tanstack/react-router"

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: ({ error, reset }) => (
    <AppErrorScreen error={error} reset={reset} />
  ),
  pendingComponent: AppPendingScreen,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-muted-foreground text-sm font-semibold uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold">
        This workspace view does not exist
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        The link may be old or the roast may no longer exist.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          className={buttonVariants({ variant: "outline" })}
          onClick={() => window.history.back()}
        >
          Go back
        </button>
        <Link
          to="/roasts"
          search={{
            q: undefined,
            group: undefined,
            sort: undefined,
            date: undefined,
            provider: undefined,
            process: undefined,
            minScore: undefined,
            status: undefined,
          }}
          className={buttonVariants()}
        >
          Roast notebook
        </Link>
      </div>
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({
      to: "/roasts",
      search: {
        q: undefined,
        group: undefined,
        sort: undefined,
        date: undefined,
        provider: undefined,
        process: undefined,
        minScore: undefined,
        status: undefined,
      },
    })
  },
})

const liveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/live",
  component: lazyRouteComponent(
    () => import("@/screens/live-roast-screen"),
    "LiveRoastScreen"
  ),
})
const roastLibraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roasts",
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
    group:
      search.group === "lot" ||
      search.group === "coffee" ||
      search.group === "provider" ||
      search.group === "none"
        ? search.group
        : undefined,
    sort:
      search.sort === "newest" ||
      search.sort === "score" ||
      search.sort === "coffee"
        ? search.sort
        : undefined,
    date:
      search.date === "90-days" ||
      search.date === "year" ||
      search.date === "all"
        ? search.date
        : undefined,
    provider: typeof search.provider === "string" ? search.provider : undefined,
    process: typeof search.process === "string" ? search.process : undefined,
    minScore:
      search.minScore === 80 ||
      search.minScore === 85 ||
      search.minScore === "80" ||
      search.minScore === "85"
        ? Number(search.minScore)
        : undefined,
    status:
      search.status === "tasted" ||
      search.status === "needs-tasting" ||
      search.status === "ready" ||
      search.status === "interrupted"
        ? search.status
        : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/roast-library-screen"),
    "RoastLibraryScreen"
  ),
})
const roastDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roasts/$roastId",
  component: lazyRouteComponent(
    () => import("@/screens/roast-detail-screen"),
    "RoastDetailScreen"
  ),
})
const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles",
  validateSearch: (search: Record<string, unknown>) => ({
    profile: typeof search.profile === "string" ? search.profile : undefined,
    proposalFrom:
      typeof search.proposalFrom === "string" ? search.proposalFrom : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/profile-editor-screen"),
    "ProfileEditorScreen"
  ),
})
const coffeesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coffees",
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
    lotId: typeof search.lotId === "string" ? search.lotId : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/coffee-catalog-screen"),
    "CoffeeCatalogScreen"
  ),
})
const coffeeLotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coffees/$lotId",
  component: lazyRouteComponent(
    () => import("@/screens/coffee-lot-screen"),
    "CoffeeLotScreen"
  ),
})
const labelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/labels",
  validateSearch: (search: Record<string, unknown>) => ({
    roastId:
      typeof search.roastId === "number" && Number.isSafeInteger(search.roastId)
        ? search.roastId
        : typeof search.roastId === "string" && /^\d+$/u.test(search.roastId)
          ? Number(search.roastId)
          : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/label-composer-screen"),
    "LabelComposerScreen"
  ),
})
const brewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/brews",
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === "brew" || search.tab === "defaults"
        ? search.tab
        : undefined,
    roastNumber:
      typeof search.roastNumber === "number" &&
      Number.isSafeInteger(search.roastNumber)
        ? search.roastNumber
        : typeof search.roastNumber === "string" &&
            /^\d+$/u.test(search.roastNumber)
          ? Number(search.roastNumber)
          : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/brews-screen"),
    "BrewsScreen"
  ),
})
const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  component: lazyRouteComponent(
    () => import("@/screens/device-screen"),
    "DeviceScreen"
  ),
})
const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare",
  component: lazyRouteComponent(
    () => import("@/screens/compare-screen"),
    "CompareScreen"
  ),
})
const preflightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preflight",
  validateSearch: (search: Record<string, unknown>) => ({
    lotId: typeof search.lotId === "string" ? search.lotId : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/preflight-screen"),
    "PreflightScreen"
  ),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  liveRoute,
  roastLibraryRoute,
  roastDetailRoute,
  profilesRoute,
  coffeesRoute,
  coffeeLotRoute,
  labelsRoute,
  brewsRoute,
  devicesRoute,
  compareRoute,
  preflightRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingMs: 120,
  defaultPendingMinMs: 240,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
