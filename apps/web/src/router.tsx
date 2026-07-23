import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router"
import { Link } from "@tanstack/react-router"
import { buttonVariants } from "@tan-studio/ui/components/button"

import { AppErrorScreen, AppPendingScreen } from "@/components/app-error-screen"
import { AppShell } from "@/components/app-shell"

function integer(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  return typeof value === "string" && /^[1-9]\d*$/u.test(value)
    ? Number(value)
    : undefined
}

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: ({ error, reset }) => (
    <AppErrorScreen error={error} reset={reset} />
  ),
  pendingComponent: AppPendingScreen,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted-foreground text-sm">
        This Tan Studio view does not exist.
      </p>
      <div className="flex gap-2">
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
            status: undefined,
            profileId: undefined,
            coffeeId: undefined,
            sort: undefined,
            hidden: undefined,
            density: undefined,
            rest: undefined,
            view: undefined,
          }}
          className={buttonVariants()}
        >
          Roasts
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
        status: undefined,
        profileId: undefined,
        coffeeId: undefined,
        sort: undefined,
        hidden: undefined,
        density: undefined,
        rest: undefined,
        view: undefined,
      },
    })
  },
})

const roastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roast",
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: integer(search.profileId),
    coffeeId: integer(search.coffeeId),
  }),
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
    status: typeof search.status === "string" ? search.status : undefined,
    profileId: integer(search.profileId),
    coffeeId: integer(search.coffeeId),
    sort:
      typeof search.sort === "string" &&
      /^(id|roastedAt|coffee|profile|level|load|status)\.(asc|desc)$/u.test(
        search.sort
      )
        ? search.sort
        : undefined,
    hidden:
      typeof search.hidden === "string" &&
      /^(roastedAt|coffee|profile|level|load|activity|status)(,(roastedAt|coffee|profile|level|load|activity|status))*$/u.test(
        search.hidden
      )
        ? search.hidden
        : undefined,
    density: search.density === "expanded" ? ("expanded" as const) : undefined,
    rest:
      typeof search.rest === "string" &&
      /^(resting|peak|pastPeak|unknown)$/u.test(search.rest)
        ? search.rest
        : undefined,
    view: search.view === "pantry" ? ("pantry" as const) : undefined,
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
    profileId: integer(search.profileId),
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
    coffeeId: integer(search.coffeeId),
    provider: typeof search.provider === "string" ? search.provider : undefined,
    country: typeof search.country === "string" ? search.country : undefined,
    process: typeof search.process === "string" ? search.process : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    hidden: typeof search.hidden === "string" ? search.hidden : undefined,
    density: search.density === "expanded" ? ("expanded" as const) : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/coffee-catalog-screen"),
    "CoffeeCatalogScreen"
  ),
})

const coffeeCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coffees/new",
  component: lazyRouteComponent(
    () => import("@/screens/coffee-editor-screen"),
    "CoffeeEditorScreen"
  ),
})

const coffeeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coffees/$coffeeId",
  component: lazyRouteComponent(
    () => import("@/screens/coffee-editor-screen"),
    "CoffeeEditorScreen"
  ),
})

const brewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/brews",
  validateSearch: (search: Record<string, unknown>) => ({
    roastId: integer(search.roastId),
    brewId: integer(search.brewId),
    tab: search.tab === "defaults" ? ("defaults" as const) : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    method: typeof search.method === "string" ? search.method : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    hidden: typeof search.hidden === "string" ? search.hidden : undefined,
    density: search.density === "expanded" ? ("expanded" as const) : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.tab === "defaults") {
      throw redirect({
        to: "/settings",
        search: { section: undefined },
      })
    }
  },
  component: lazyRouteComponent(
    () => import("@/screens/brews-screen"),
    "BrewsScreen"
  ),
})

const labelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/labels",
  validateSearch: (search: Record<string, unknown>) => ({
    roastId: integer(search.roastId),
  }),
  component: lazyRouteComponent(
    () => import("@/screens/label-composer-screen"),
    "LabelComposerScreen"
  ),
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search: Record<string, unknown>) => ({
    section: search.section === "devices" ? ("devices" as const) : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/settings-screen"),
    "SettingsScreen"
  ),
})

const devicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/devices",
  beforeLoad: () => {
    throw redirect({
      to: "/settings",
      search: { section: "devices" },
    })
  },
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  roastRoute,
  roastLibraryRoute,
  roastDetailRoute,
  profilesRoute,
  coffeesRoute,
  coffeeCreateRoute,
  coffeeDetailRoute,
  brewsRoute,
  labelsRoute,
  settingsRoute,
  devicesRoute,
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
