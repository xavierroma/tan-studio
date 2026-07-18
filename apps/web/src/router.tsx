import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"

import { AppShell } from "@/components/app-shell"

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-muted-foreground text-sm font-semibold uppercase">
        404
      </p>
      <h1 className="text-2xl font-semibold">
        This workspace view does not exist
      </h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Return to the roast notebook from the navigation.
      </p>
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({
      to: "/roasts",
      search: { q: undefined, process: undefined, status: undefined },
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
    process: typeof search.process === "string" ? search.process : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
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
    roastId: typeof search.roastId === "string" ? search.roastId : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/label-composer-screen"),
    "LabelComposerScreen"
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
  devicesRoute,
  compareRoute,
  preflightRoute,
])

export const router = createRouter({ routeTree, defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
