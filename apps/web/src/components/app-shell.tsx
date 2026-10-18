import { SessionControls } from "@/components/session-controls"
import { getBrew, listCoffees, listRoasts, queryKeys } from "@/lib/api"
import {
  brewListSearch,
  coffeeListSearch,
  massText,
  roastListSearch,
} from "@/lib/notebook"
import { Button } from "@tan-studio/ui/components/button"
import { Label } from "@tan-studio/ui/components/label"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@tan-studio/ui/components/navigation-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@tan-studio/ui/components/sidebar"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { TooltipProvider } from "@tan-studio/ui/components/tooltip"
import { useQuery } from "@tanstack/react-query"
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { useState, type CSSProperties } from "react"

function CoffeeRail({ pathname }: { pathname: string }) {
  const [search, setSearch] = useState("")
  const match = pathname.match(/^\/(coffees|roasts|brews)\/(\d+)/),
    type = match?.[1],
    id = Number(match?.[2] ?? 0)
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
  })
  const brew = useQuery({
    queryKey: queryKeys.brew(type === "brews" ? id : 0),
    queryFn: ({ signal }) => getBrew(id, signal),
    enabled: type === "brews",
  })
  const roastId = type === "roasts" ? id : brew.data?.roastId
  // Active and archived lists together hold every roast's coffee reference,
  // so the rail does not need a per-roast request to highlight its coffee.
  const activeRoasts = useQuery({
    queryKey: queryKeys.roasts(),
    queryFn: ({ signal }) => listRoasts({}, signal),
    enabled: roastId != null,
  })
  const archivedRoasts = useQuery({
    queryKey: queryKeys.roasts({ archived: true }),
    queryFn: ({ signal }) => listRoasts({ archived: true }, signal),
    enabled: roastId != null,
  })
  const roast = [
    ...(activeRoasts.data ?? []),
    ...(archivedRoasts.data ?? []),
  ].find((r) => r.id === roastId)
  const selectedId = type === "coffees" ? id : roast?.coffee?.id
  return (
    <Sidebar
      collapsible="none"
      className="notebook-rail"
      aria-label="Coffee notebook"
    >
      <SidebarHeader>
        <div className="notebook-rail-heading">
          <span>Coffees</span>
          <Button
            nativeButton={false}
            role="link"
            variant="link"
            size="sm"
            render={<Link to="/coffees" search={coffeeListSearch} />}
          >
            Table
          </Button>
        </div>
        <Label className="sr-only" htmlFor="notebook-coffee-search">
          Find a coffee
        </Label>
        <SidebarInput
          id="notebook-coffee-search"
          type="search"
          placeholder="Find a coffee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu aria-label="Coffees">
          {coffees.data
            ?.filter((c) =>
              [c.name, c.country, c.process, c.provider]
                .join(" ")
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase())
            )
            .map((c) => (
              <SidebarMenuItem key={c.id}>
                <SidebarMenuButton
                  isActive={selectedId === c.id}
                  className="notebook-rail-coffee"
                  render={
                    <Link
                      to="/coffees/$coffeeId"
                      params={{ coffeeId: String(c.id) }}
                      aria-current={selectedId === c.id ? "page" : undefined}
                    />
                  }
                >
                  <div>
                    <strong>{c.name}</strong>
                    <span>
                      {[c.country, c.process].filter(Boolean).join(" · ") ||
                        "Origin not recorded"}
                    </span>
                    <small>
                      <span>{c.roastCount} roasts</span>
                      <span>{massText(c.remainingMassMg)} green</span>
                    </small>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
        </SidebarMenu>
        {coffees.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}
        {coffees.error ? (
          <p role="alert" className="text-muted-foreground px-2 text-sm">
            Coffees could not be loaded.
          </p>
        ) : null}
        {coffees.data?.length === 0 ? (
          <p className="text-muted-foreground px-2 text-sm">No coffees yet.</p>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <Button
          nativeButton={false}
          role="link"
          variant="link"
          render={<Link to="/coffees" search={coffeeListSearch} />}
        >
          All coffees →
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
function SettingsRail() {
  const section = useRouterState({ select: (s) => s.location.search.section })
  return (
    <Sidebar collapsible="none" className="notebook-rail" aria-label="Settings">
      <SidebarHeader>
        <div className="notebook-rail-heading">Settings</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {[
            { value: undefined, label: "Brewing defaults" },
            { value: "notebook" as const, label: "Labels & tables" },
            { value: "devices" as const, label: "Devices" },
            { value: "access" as const, label: "Access" },
          ].map((item) => (
            <SidebarMenuItem key={item.value ?? "brewing"}>
              <SidebarMenuButton
                className="notebook-settings-link"
                isActive={section === item.value}
                render={
                  <Link to="/settings" search={{ section: item.value }} />
                }
              >
                {item.label}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}
export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const record =
    /^\/(coffees|roasts|brews)\/\d+/.test(pathname) ||
    pathname === "/roast" ||
    pathname === "/profiles" ||
    pathname === "/settings"
  return (
    <TooltipProvider>
      <div className="notebook-app">
        <a href="#main" className="notebook-skip">
          Skip to content
        </a>
        <header className="notebook-header">
          <Link
            to="/coffees"
            search={coffeeListSearch}
            className="notebook-brand"
            aria-label="Tan Studio home"
          >
            <img src="/tan-logo.webp" width="56" height="46" alt="" />
            <span>Tan Studio</span>
          </Link>
          <NavigationMenu
            className="notebook-primary"
            aria-label="Primary navigation"
          >
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuLink
                  active={pathname.startsWith("/coffees")}
                  render={<Link to="/coffees" search={coffeeListSearch} />}
                >
                  Coffees
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  active={pathname.startsWith("/roasts")}
                  render={<Link to="/roasts" search={roastListSearch} />}
                >
                  Roasts
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  active={pathname.startsWith("/brews")}
                  render={<Link to="/brews" search={brewListSearch} />}
                >
                  Brews
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  active={pathname === "/profiles"}
                  render={
                    <Link
                      to="/profiles"
                      search={{ profileId: undefined, compare: undefined }}
                    />
                  }
                >
                  Profiles
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  active={pathname === "/settings"}
                  render={
                    <Link to="/settings" search={{ section: undefined }} />
                  }
                >
                  Settings
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuTrigger>More</NavigationMenuTrigger>
                <NavigationMenuContent className="min-w-44">
                  <NavigationMenuLink
                    render={
                      <Link
                        to="/roast"
                        search={{ profileId: undefined, coffeeId: undefined }}
                      />
                    }
                  >
                    Prepare a roast
                  </NavigationMenuLink>
                  <NavigationMenuLink
                    render={
                      <Link
                        to="/pantry"
                        search={{
                          q: undefined,
                          rest: undefined,
                          sort: undefined,
                          hidden: undefined,
                          density: undefined,
                        }}
                      />
                    }
                  >
                    Pantry
                  </NavigationMenuLink>
                  <NavigationMenuLink
                    render={
                      <Link to="/labels" search={{ roastId: undefined }} />
                    }
                  >
                    Jar labels
                  </NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <div className="notebook-session">
            <SessionControls />
          </div>
        </header>
        <SidebarProvider
          className={record ? "notebook-layout with-rail" : "notebook-layout"}
          style={{ "--sidebar-width": "246px" } as CSSProperties}
        >
          {record ? (
            pathname === "/settings" ? (
              <SettingsRail />
            ) : (
              <CoffeeRail pathname={pathname} />
            )
          ) : null}
          <main id="main" className="notebook-page" tabIndex={-1}>
            <Outlet />
          </main>
        </SidebarProvider>
      </div>
    </TooltipProvider>
  )
}
