import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { CableIcon, ChevronDownIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { TanBridgeSetupPanel } from "@/components/tan-bridge-setup-panel"
import {
  getDevice,
  queryKeys,
  refreshDevice,
  synchronizeDevice,
} from "@/lib/api"

export function DeviceScreen() {
  const queryClient = useQueryClient()
  const device = useQuery({
    queryKey: queryKeys.device(),
    queryFn: ({ signal }) => getDevice(signal),
    refetchInterval: 5_000,
  })
  const refresh = useMutation({
    mutationFn: refreshDevice,
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.device() }),
    onError: (error) => toast.error(error.message),
  })
  const sync = useMutation({
    mutationFn: synchronizeDevice,
    onSuccess: () => {
      toast.success("Synchronization started")
      void queryClient.invalidateQueries({ queryKey: queryKeys.device() })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
    },
    onError: (error) => toast.error(error.message),
  })
  if (device.error) throw device.error
  const item = device.data
  const connected = item?.connection === "connected"
  return (
    <div className="min-h-screen">
      <PageHeader
        title="Nano"
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              onClick={() => sync.mutate()}
              disabled={!connected || sync.isPending}
            >
              Synchronize
            </Button>
          </>
        }
      />
      <div className="flex max-w-4xl flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-muted flex size-10 items-center justify-center rounded-full">
              <CableIcon />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">
                  {item?.model ?? "Kaffelogic Nano"}
                </h2>
                <Badge variant={connected ? "success" : "warning"}>
                  {item?.connection ?? "checking"}
                </Badge>
              </div>
              {!connected && item?.reason ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {item.reason}
                </p>
              ) : null}
            </div>
          </div>
          {item ? (
            <details className="mt-4 border-t pt-4">
              <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
                <ChevronDownIcon className="size-4" />
                Device details
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Firmware" value={item.firmware ?? "—"} />
                <Metric label="Protocol" value={item.protocol ?? "—"} />
                <Metric
                  label="Profiles"
                  value={
                    item.profileCount == null ? "—" : String(item.profileCount)
                  }
                />
                <Metric
                  label="Logs"
                  value={item.logCount == null ? "—" : String(item.logCount)}
                />
              </div>
            </details>
          ) : null}
        </section>
        {connected ? (
          <details>
            <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <ChevronDownIcon className="size-4" />
              Set up another bridge
            </summary>
            <div className="mt-3">
              <TanBridgeSetupPanel />
            </div>
          </details>
        ) : (
          <TanBridgeSetupPanel />
        )}
        {item ? (
          <section className="bg-card rounded-xl border p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Last synchronization</h2>
              <Badge
                variant={item.syncState === "failed" ? "warning" : "secondary"}
              >
                {item.syncState}
              </Badge>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <Metric
                label="Imported logs"
                value={String(item.importedLogCount)}
              />
              <Metric
                label="Updated logs"
                value={String(item.updatedLogCount)}
              />
              <Metric
                label="Imported profiles"
                value={String(item.importedProfileCount)}
              />
            </div>
            {item.lastSyncedAt ? (
              <p className="text-muted-foreground mt-4 text-sm">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                }).format(new Date(item.lastSyncedAt))}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
