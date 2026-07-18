import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { Toaster } from "@tan-studio/ui/components/sonner"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@tan-studio/ui/globals.css"

import { queryClient } from "@/lib/query-client"
import { router } from "@/router"

const root = document.getElementById("root")

if (!root) throw new Error("Tan Studio root element is missing")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>
)
