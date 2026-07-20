import { Link, Outlet } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@tan-studio/ui/components/tooltip"
import {
  BeanIcon,
  BookOpenTextIcon,
  CableIcon,
  ChartNoAxesCombinedIcon,
  CoffeeIcon,
  CupSodaIcon,
  FlameIcon,
} from "lucide-react"
import type { ComponentType } from "react"

const navigation = [
  { label: "Roast", to: "/roast", icon: FlameIcon },
  { label: "Roasts", to: "/roasts", icon: BookOpenTextIcon },
  { label: "Profiles", to: "/profiles", icon: ChartNoAxesCombinedIcon },
  { label: "Coffees", to: "/coffees", icon: CoffeeIcon },
  { label: "Brews", to: "/brews", icon: CupSodaIcon },
  { label: "Devices", to: "/devices", icon: CableIcon },
] as const

function NavLink({
  label,
  to,
  icon: Icon,
  compact = false,
}: {
  label: string
  to: (typeof navigation)[number]["to"]
  icon: ComponentType<{ "data-icon"?: string; className?: string }>
  compact?: boolean
}) {
  const link = (
    <Link
      to={to}
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
              view: undefined,
            }}
            className="mt-4 flex flex-col items-center gap-2"
            aria-label="Tan Studio home"
          >
            <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-full shadow-sm">
              <BeanIcon className="size-5" />
            </span>
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
          {navigation.slice(0, 5).map((item) => (
            <NavLink key={item.to} {...item} compact />
          ))}
        </nav>
      </div>
    </TooltipProvider>
  )
}
