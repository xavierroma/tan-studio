import { Link, Outlet } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tan-studio/ui/components/tooltip"
import {
  BookOpenTextIcon,
  ChartNoAxesCombinedIcon,
  CoffeeIcon,
  CupSodaIcon,
  FlameIcon,
  SettingsIcon,
} from "lucide-react"
import type { ComponentType } from "react"

const navigation = [
  {
    label: "Roast",
    to: "/roast",
    icon: FlameIcon,
    search: { profileId: undefined, coffeeId: undefined },
  },
  {
    label: "Roasts",
    to: "/roasts",
    icon: BookOpenTextIcon,
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
  },
  {
    label: "Profiles",
    to: "/profiles",
    icon: ChartNoAxesCombinedIcon,
    search: { profileId: undefined },
  },
  {
    label: "Coffees",
    to: "/coffees",
    icon: CoffeeIcon,
    search: {
      q: undefined,
      coffeeId: undefined,
      provider: undefined,
      country: undefined,
      process: undefined,
      sort: undefined,
      hidden: undefined,
      density: undefined,
    },
  },
  {
    label: "Brews",
    to: "/brews",
    icon: CupSodaIcon,
    search: {
      roastId: undefined,
      brewId: undefined,
      tab: undefined,
      q: undefined,
      method: undefined,
      sort: undefined,
      hidden: undefined,
      density: undefined,
    },
  },
  {
    label: "Settings",
    to: "/settings",
    icon: SettingsIcon,
    search: { section: undefined },
  },
] as const

function NavLink({
  label,
  to,
  icon: Icon,
  search,
  compact = false,
}: (typeof navigation)[number] & {
  icon: ComponentType<{ "data-icon"?: string; className?: string }>
  compact?: boolean
}) {
  const link = (
    <Link
      to={to}
      search={search}
      activeOptions={{ exact: to !== "/roasts" }}
      className={
        compact
          ? "text-muted-foreground flex min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[0.6875rem] font-medium transition-colors"
          : "text-muted-foreground flex h-[3.625rem] w-[4.375rem] flex-col items-center justify-center gap-1 rounded-xl text-[0.6875rem] font-medium transition-colors"
      }
      activeProps={{ className: "bg-accent text-foreground" }}
      inactiveProps={{
        className: "hover:bg-sidebar-accent/60 hover:text-foreground",
      }}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </Link>
  )

  if (compact) return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppShell() {
  return (
    <TooltipProvider>
      <div className="bg-background min-h-screen">
        <aside className="border-sidebar-border bg-sidebar fixed inset-y-0 left-0 z-30 hidden w-[5.5rem] flex-col items-center border-r md:flex">
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
            className="mt-4 flex flex-col items-center gap-2"
            aria-label="Tan Studio home"
          >
            <img
              src="/tan-studio-logo.png"
              alt=""
              width={48}
              height={48}
              className="border-border size-12 rounded-2xl border object-cover shadow-sm"
            />
            <span className="text-center text-[0.5625rem] leading-tight font-bold tracking-[0.12em] uppercase">
              Tan
              <br />
              Studio
            </span>
          </Link>

          <nav
            className="mt-10 flex flex-col gap-5"
            aria-label="Primary navigation"
          >
            {navigation.map((item) => (
              <NavLink key={item.to} {...item} />
            ))}
          </nav>

          <div className="mt-auto mb-5 flex flex-col items-center gap-3">
            <Badge variant="info">Local</Badge>
            <span
              className="bg-secondary flex size-8 items-center justify-center rounded-full border text-xs font-semibold"
              aria-label="User profile"
            >
              XR
            </span>
          </div>
        </aside>

        <main className="min-h-screen pb-20 md:ml-[5.5rem] md:pb-0">
          <Outlet />
        </main>

        <nav
          className="bg-sidebar/95 fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t px-2 py-1 backdrop-blur md:hidden"
          aria-label="Primary navigation"
        >
          {navigation.map((item) => (
            <NavLink key={item.to} {...item} compact />
          ))}
        </nav>
      </div>
    </TooltipProvider>
  )
}
