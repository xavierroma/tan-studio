import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tan-studio/ui/components/tabs"
import { CableIcon, CupSodaIcon } from "lucide-react"

import { BrewDefaultsSettings } from "@/components/brew-defaults-settings"
import { PageHeader } from "@/components/page-header"
import { DeviceSettings } from "@/screens/device-screen"

export function SettingsScreen() {
  const search = useSearch({ from: "/settings" })
  const navigate = useNavigate({ from: "/settings" })
  const section = search.section === "devices" ? "devices" : "brewing"

  return (
    <div className="min-h-screen">
      <PageHeader title="Settings" />
      <div className="px-3 py-4 sm:px-7 sm:py-6">
        <Tabs
          value={section}
          onValueChange={(value) =>
            void navigate({
              search: {
                section: value === "devices" ? "devices" : undefined,
              },
            })
          }
        >
          <TabsList variant="line">
            <TabsTrigger value="brewing">
              <CupSodaIcon />
              Brewing
            </TabsTrigger>
            <TabsTrigger value="devices">
              <CableIcon />
              Devices
            </TabsTrigger>
          </TabsList>
          <TabsContent value="brewing" className="pt-6">
            <BrewDefaultsSettings />
          </TabsContent>
          <TabsContent value="devices" className="pt-6">
            <DeviceSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
