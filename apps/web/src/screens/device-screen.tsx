import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { CableIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
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
        description="The Rust service owns the USB serial session and imports KLOG and KPRO files without changing the roaster."
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
      <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
        <TanBridgeSetupPanel />
        <section className="bg-card grid gap-5 rounded-xl border p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Connection" value={item?.connection ?? "checking"} />
          <Metric label="Model" value={item?.model ?? "—"} />
          <Metric label="Firmware" value={item?.firmware ?? "—"} />
          <Metric
            label="Profiles on Nano"
            value={item?.profileCount == null ? "—" : String(item.profileCount)}
          />
          <Metric
            label="Logs on Nano"
            value={item?.logCount == null ? "—" : String(item.logCount)}
          />
        </section>
        <Alert className={connected ? "bg-info" : "bg-warning"}>
          <CableIcon />
          <AlertTitle>
            {connected ? "Nano connected" : "Nano not connected"}
          </AlertTitle>
          <AlertDescription>
            {connected
              ? `SASSI ${item?.protocol ?? "session"} · packet limit ${item?.packetLimitBytes ?? "—"} bytes. Synchronization is read-only.`
              : (item?.reason ??
                "Connect the Nano by USB and leave Kaffelogic Studio closed.")}
          </AlertDescription>
        </Alert>
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
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>Writes remain disabled</AlertTitle>
          <AlertDescription>
            Tan Studio has verified reading and synchronization. Profile
            deployment or other write commands will remain unavailable until
            captured Studio traffic proves the write protocol safely.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
