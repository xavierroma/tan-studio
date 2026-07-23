import { fireEvent, render, screen, within } from "@testing-library/react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell"

describe("AppShell primary navigation", () => {
  it("opens Coffees from a filtered Roasts URL without carrying roast state", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
    const root = createRootRoute({ component: AppShell })
    const routes = [
      ["/roast", "Roast view"],
      ["/roasts", "Roasts view"],
      ["/pantry", "Pantry view"],
      ["/profiles", "Profiles view"],
      ["/coffees", "Coffees view"],
      ["/brews", "Brews view"],
      ["/settings", "Settings view"],
    ].map(([path, label]) =>
      createRoute({
        getParentRoute: () => root,
        path: path!,
        component: () => (
          <>
            <span>{label}</span>
            <Outlet />
          </>
        ),
      })
    )
    const history = createMemoryHistory({
      initialEntries: ["/roasts?q=washed&profileId=8&coffeeId=4"],
    })
    const router = createRouter({
      routeTree: root.addChildren(routes),
      history,
    })

    render(<RouterProvider router={router} />)

    expect(await screen.findByText("Roasts view")).toBeVisible()
    const primaryNavigation = screen.getAllByRole("navigation", {
      name: "Primary navigation",
    })
    expect(primaryNavigation).toHaveLength(2)
    fireEvent.click(
      within(primaryNavigation[1]!).getByRole("link", { name: "Coffees" })
    )

    expect(await screen.findByText("Coffees view")).toBeVisible()
    expect(router.state.location.pathname).toBe("/coffees")
    expect(router.state.location.search).toEqual({})
    expect(
      within(primaryNavigation[1]!).getByRole("link", { name: "Pantry" })
    ).toBeVisible()
  })
})
