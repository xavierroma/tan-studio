import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import { CableIcon, ChevronDownIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Metric } from "@/components/metric"
import { TanBridgeSetupPanel } from "@/components/tan-bridge-setup-panel"
import {
  getDevice,
  listDeviceSyncRuns,
  queryKeys,
  refreshDevice,
  synchronizeDevice,
} from "@/lib/api"

export function DeviceSettings() {
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
  const syncRuns = useQuery({
    queryKey: queryKeys.deviceSyncRuns(),
    queryFn: ({ signal }) => listDeviceSyncRuns(signal),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.state === "running") ? 1_000 : 5_000,
  })
  const sync = useMutation({
    mutationFn: synchronizeDevice,
    onMutate: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deviceSyncRuns(),
      }),
    onSuccess: () => {
      toast.success("Synchronization complete")
      void queryClient.invalidateQueries({ queryKey: queryKeys.device() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deviceSyncRuns(),
      })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      void queryClient.invalidateQueries({ queryKey: ["profiles"] })
    },
    onError: (error) => toast.error(error.message),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.deviceSyncRuns(),
      }),
  })
  if (device.error) throw device.error
  const item = device.data
  const connected = item?.connection === "connected"
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <span className="bg-muted flex size-10 items-center justify-center rounded-full">
                <CableIcon />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2>{item?.model ?? "Kaffelogic Nano"}</h2>
                  <Badge variant={connected ? "success" : "warning"}>
                    {item?.connection ?? "checking"}
                  </Badge>
                </div>
                {!connected && item?.reason ? (
                  <p className="text-muted-foreground mt-1 text-sm font-normal">
                    {item.reason}
                  </p>
                ) : null}
              </div>
            </div>
          </CardTitle>
          <CardAction className="flex flex-wrap gap-2">
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
                {sync.isPending ? "Synchronizing…" : "Synchronize"}
              </Button>
            </>
          </CardAction>
        </CardHeader>
        <CardContent>
          {item ? (
            <details>
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
        </CardContent>
      </Card>
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
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Last synchronization</h2>
            </CardTitle>
            <CardAction>
              <Badge
                variant={item.syncState === "failed" ? "warning" : "secondary"}
              >
                {item.syncState}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Synchronization history</h2>
          </CardTitle>
          <CardAction>
            <Badge
              variant={
                syncRuns.data?.some((run) => run.state === "running")
                  ? "info"
                  : "secondary"
              }
            >
              {syncRuns.data?.some((run) => run.state === "running")
                ? "Syncing"
                : `${syncRuns.data?.length ?? 0} runs`}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {syncRuns.data?.length ? (
            <div className="divide-y">
              {syncRuns.data.slice(0, 20).map((run) => (
                <div
                  key={run.id}
                  className="grid gap-2 py-3 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center"
                >
                  <div>
                    <Badge
                      variant={
                        run.state === "completed"
                          ? "success"
                          : run.state === "running"
                            ? "info"
                            : "warning"
                      }
                    >
                      {run.state}
                    </Badge>
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {run.trigger} sync · {run.transport || "Nano"}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                        timeStyle: "medium",
                      }).format(new Date(run.startedAt))}
                      {run.errorCode ? ` · ${run.errorCode}` : ""}
                    </p>
                  </div>
                  <p className="text-muted-foreground whitespace-nowrap">
                    {run.importedLogCount} logs · {run.importedProfileCount}{" "}
                    profiles
                    {run.importWarningCount + run.profileWarningCount
                      ? ` · ${run.importWarningCount + run.profileWarningCount} warnings`
                      : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No synchronization attempts recorded yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
