import { Button } from "@tan-studio/ui/components/button"
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  parseSearchWith,
  redirect,
  stringifySearchWith,
} from "@tanstack/react-router"

import { AppErrorScreen, AppPendingScreen } from "@/components/app-error-screen"
import { AppShell } from "@/components/app-shell"
import { pantryListSearch } from "@/lib/notebook"

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
        <Button
          type="button"
          onClick={() => window.history.back()}
          variant={"outline"}
        >
          Go back
        </Button>
        <Button
          nativeButton={false}
          role="link"
          render={<Link to="/pantry" search={pantryListSearch} />}
        >
          Pantry
        </Button>
      </div>
    </div>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // Studio opens on the pantry: the usual session starts there, before brewing.
  beforeLoad: () => {
    throw redirect({ to: "/pantry", search: pantryListSearch })
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
    archived:
      search.archived === true || search.archived === "true" ? true : undefined,
    sort:
      typeof search.sort === "string" &&
      /^(id|roastedAt|coffee|profile|level|load|status)\.(asc|desc)$/u.test(
        search.sort
      )
        ? search.sort
        : undefined,
    hidden:
      typeof search.hidden === "string" &&
      /^(roastedAt|coffee|profile|level|load|activity|status|notes|tasting)(,(roastedAt|coffee|profile|level|load|activity|status|notes|tasting))*$/u.test(
        search.hidden
      )
        ? search.hidden
        : undefined,
    density:
      search.density === "compact"
        ? ("compact" as const)
        : search.density === "expanded"
          ? ("expanded" as const)
          : undefined,
    rest:
      typeof search.rest === "string" &&
      /^(resting|peak|pastPeak|unknown)$/u.test(search.rest)
        ? search.rest
        : undefined,
    view: search.view === "pantry" ? ("pantry" as const) : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.view === "pantry") {
      throw redirect({
        to: "/pantry",
        search: {
          q: search.q,
          rest: search.rest,
          sort: search.sort,
          hidden: search.hidden,
          density: search.density,
        },
      })
    }
  },
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

const roastEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/roasts/$roastId/edit",
  component: lazyRouteComponent(
    () => import("@/screens/roast-editor-screen"),
    "RoastEditorScreen"
  ),
})

const pantryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pantry",
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : undefined,
    rest:
      typeof search.rest === "string" &&
      /^(resting|peak|pastPeak|unknown)$/u.test(search.rest)
        ? search.rest
        : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    hidden: typeof search.hidden === "string" ? search.hidden : undefined,
    density:
      search.density === "compact"
        ? ("compact" as const)
        : search.density === "expanded"
          ? ("expanded" as const)
          : undefined,
  }),
  component: lazyRouteComponent(
    () => import("@/screens/pantry-screen"),
    "PantryScreen"
  ),
})

const profilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles",
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: integer(search.profileId),
    compare:
      integer(search.compare) ??
      (typeof search.compare === "string" &&
      /^([1-9]\d*)(,[1-9]\d*){1,2}$/u.test(search.compare)
        ? search.compare
        : undefined),
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
    green:
      search.green === "all" || search.green === "empty"
        ? (search.green as "all" | "empty")
        : undefined,
    provider: typeof search.provider === "string" ? search.provider : undefined,
    country: typeof search.country === "string" ? search.country : undefined,
    process: typeof search.process === "string" ? search.process : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    hidden: typeof search.hidden === "string" ? search.hidden : undefined,
    density:
      search.density === "compact"
        ? ("compact" as const)
        : search.density === "expanded"
          ? ("expanded" as const)
          : undefined,
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
    () => import("@/screens/coffee-detail-screen"),
    "CoffeeDetailScreen"
  ),
})

const coffeeEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coffees/$coffeeId/edit",
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
    density:
      search.density === "compact"
        ? ("compact" as const)
        : search.density === "expanded"
          ? ("expanded" as const)
          : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (search.tab === "defaults") {
      throw redirect({
        to: "/settings",
        search: { section: undefined },
      })
    }
    // Older links selected a brew in the list to manage its files.
    if (search.brewId) {
      throw redirect({
        to: "/brews/$brewId",
        params: { brewId: String(search.brewId) },
      })
    }
  },
  component: lazyRouteComponent(
    () => import("@/screens/brews-screen"),
    "BrewsScreen"
  ),
})

const brewCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/brews/new",
  validateSearch: (search: Record<string, unknown>) => ({
    roastId: integer(search.roastId),
  }),
  component: lazyRouteComponent(
    () => import("@/screens/brew-editor-screen"),
    "BrewEditorScreen"
  ),
})

const brewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/brews/$brewId",
  component: lazyRouteComponent(
    () => import("@/screens/brew-detail-screen"),
    "BrewDetailScreen"
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
    section:
      search.section === "devices"
        ? ("devices" as const)
        : search.section === "notebook"
          ? ("notebook" as const)
          : search.section === "access"
            ? ("access" as const)
            : search.section === "agents"
              ? ("agents" as const)
              : undefined,
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
  roastEditRoute,
  pantryRoute,
  profilesRoute,
  coffeesRoute,
  coffeeCreateRoute,
  coffeeDetailRoute,
  coffeeEditRoute,
  brewsRoute,
  brewCreateRoute,
  brewDetailRoute,
  labelsRoute,
  settingsRoute,
  devicesRoute,
])

export const router = createRouter({
  routeTree,
  parseSearch: parseSearchWith((value) => value),
  stringifySearch: stringifySearchWith(JSON.stringify),
  defaultPendingMs: 120,
  defaultPendingMinMs: 240,
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
