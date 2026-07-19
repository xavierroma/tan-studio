import { useQuery } from "@tanstack/react-query"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { Progress } from "@tan-studio/ui/components/progress"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@tan-studio/ui/components/tabs"
import { toast } from "sonner"
import {
  CableIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileCheck2Icon,
  FolderSyncIcon,
  HardDriveIcon,
  LockKeyholeIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import {
  getDeviceState,
  isDemoResult,
  queryKeys,
  refreshDevice,
  synchronizeDevice,
} from "@/lib/api"

const files = [
  {
    name: "Washed floral · gentle finish",
    kind: "Profile",
    local: "r8",
    device: "r7",
    state: "Review",
  },
  {
    name: "Pink Bourbon clarity",
    kind: "Profile",
    local: "r4",
    device: "r4",
    state: "Matched",
  },
  {
    name: "2026-07-17_1642.klog",
    kind: "Roast log",
    local: "Imported",
    device: "Present",
    state: "Matched",
  },
  {
    name: "2026-07-13_1808.klog",
    kind: "Roast log",
    local: "Imported",
    device: "Present",
    state: "Matched",
  },
  {
    name: "2026-07-10_1526.klog",
    kind: "Roast log",
    local: "Missing",
    device: "Present",
    state: "Available",
  },
]

export function DeviceScreen() {
  const device = useQuery({
    queryKey: queryKeys.device(),
    queryFn: getDeviceState,
    refetchInterval: 1_500,
    refetchIntervalInBackground: true,
  })
  const state = device.data?.data
  const deviceAvailable = state?.available === true
  const adapterReady =
    state?.adapterState === "ready" || state?.adapterState === "degraded"
  const demoDevice = isDemoResult(device.data) && deviceAvailable

  if (device.error) throw device.error

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Device & sync"
        description="One owner for USB, protocol negotiation, device files and safe synchronization plans"
        actions={
          <>
            <Button
              variant="outline"
              disabled={device.isFetching}
              onClick={() =>
                void refreshDevice()
                  .catch(() => undefined)
                  .then(() => device.refetch())
              }
            >
              <RefreshCwIcon data-icon="inline-start" />
              Refresh
            </Button>
            <Button
              variant="outline"
              disabled
              title="Diagnostic export is not implemented yet"
            >
              <DownloadIcon data-icon="inline-start" />
              Diagnostics
            </Button>
          </>
        }
      />

      <div className="px-5 py-6 sm:px-7">
        <section
          className="grid gap-4 lg:grid-cols-[minmax(19rem,1.25fr)_repeat(3,minmax(0,0.7fr))]"
          aria-label="Connected roaster summary"
        >
          <div className="bg-card rounded-xl border p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="bg-info flex size-11 items-center justify-center rounded-full">
                <CableIcon className="size-5" />
              </span>
              <Badge variant={deviceAvailable ? "success" : "secondary"}>
                {device.isPending
                  ? "Checking"
                  : deviceAvailable
                    ? "Connected"
                    : state?.connection === "reconnecting"
                      ? "Negotiating"
                      : adapterReady
                        ? "Waiting"
                        : (state?.adapterState ?? "Unavailable")}
              </Badge>
            </div>
            <h2 className="mt-4 font-semibold">
              {state?.model ??
                (deviceAvailable
                  ? "Connected roaster"
                  : state?.connection === "reconnecting"
                    ? "Identifying Nano"
                    : "No roaster connected")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {deviceAvailable
                ? "USB CDC · identity redacted · exclusive local session"
                : adapterReady
                  ? "Connect and power the Nano; discovery runs automatically"
                  : "The local serial adapter is unavailable"}
            </p>
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Firmware"
              value={state?.firmware ?? "—"}
              detail={state?.protocol ?? "Negotiating"}
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Profiles"
              value={state?.profileCount ?? "—"}
              detail="Device inventory"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Roast logs"
              value={state?.logCount ?? "—"}
              detail="Device inventory"
            />
          </div>
        </section>

        <Alert className={deviceAvailable ? "bg-info mt-6" : "bg-warning mt-6"}>
          <ShieldCheckIcon />
          <AlertTitle>
            {demoDevice
              ? "Development-only sample device"
              : deviceAvailable
                ? state?.busy
                  ? "Nano connected · filesystem busy"
                  : "Nano connected in read-only mode"
                : state?.connection === "reconnecting"
                  ? "Negotiating SASSI session"
                  : adapterReady
                    ? "Waiting for Nano"
                    : "USB adapter unavailable"}
          </AlertTitle>
          <AlertDescription>
            {demoDevice
              ? "This is an explicitly enabled development simulation; no physical roaster state is being reported."
              : deviceAvailable
                ? state.busy
                  ? "The roaster reports its filesystem lock is active. Kaffelogic Studio also defers folder access in this state. Tan Studio will stay connected and import automatically when the Nano reports not busy."
                  : `${state.model ?? "Connected roaster"}${state.protocol ? ` · ${state.protocol}` : ""}${state.packetLimitBytes == null ? "" : ` · packet limit ${state.packetLimitBytes.toLocaleString()} bytes`}. The read-only log importer is ready.`
                : state?.connection === "reconnecting"
                  ? "The CDC port is open exclusively. Tan Studio is validating the Nano identity, seeded CRC and time-sync acknowledgement."
                  : adapterReady
                    ? `The serial reader is ready${state?.reason ? ` (${state.reason})` : ""}. Power the Nano and connect its USB data cable; Tan Studio will retry automatically.`
                    : `Tan Studio could not start the serial reader${state?.reason ? ` (${state.reason})` : ""}.`}
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="sync" className="mt-6">
          <TabsList variant="line">
            <TabsTrigger value="sync">
              <FolderSyncIcon data-icon="inline-start" />
              Files & sync
            </TabsTrigger>
            <TabsTrigger value="storage">
              <HardDriveIcon data-icon="inline-start" />
              Storage
            </TabsTrigger>
            <TabsTrigger value="protocol">
              <FileCheck2Icon data-icon="inline-start" />
              Protocol evidence
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sync" className="pt-4">
            <section
              className="bg-card overflow-hidden rounded-xl border"
              aria-labelledby="sync-plan-heading"
            >
              <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 id="sync-plan-heading" className="font-semibold">
                    Synchronization plan
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Changes are calculated before any device write. Existing
                    conflicts remain preserved.
                  </p>
                </div>
                <Badge
                  variant={
                    state?.syncState === "ready"
                      ? "success"
                      : state?.busy
                        ? "warning"
                        : "secondary"
                  }
                >
                  {demoDevice
                    ? "1 review · 1 import available"
                    : state?.busy
                      ? "Waiting for device"
                      : state?.syncState === "syncing"
                        ? "Importing logs"
                        : state?.syncState === "ready"
                          ? `${state.importedLogCount} logs · ${state.importedProfileCount} profiles indexed`
                          : "Inventory pending"}
                </Badge>
              </div>
              {demoDevice ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="bg-muted text-muted-foreground grid grid-cols-[minmax(260px,1fr)_110px_110px_110px_110px] gap-4 border-b px-5 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
                      <span>Name</span>
                      <span>Kind</span>
                      <span>Local</span>
                      <span>Roaster</span>
                      <span>State</span>
                    </div>
                    <div className="divide-y">
                      {files.map((file) => (
                        <div
                          key={file.name}
                          className="grid grid-cols-[minmax(260px,1fr)_110px_110px_110px_110px] items-center gap-4 px-5 py-4 text-sm"
                        >
                          <span className="truncate font-medium">
                            {file.name}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {file.kind}
                          </span>
                          <span className="font-mono text-xs">
                            {file.local}
                          </span>
                          <span className="font-mono text-xs">
                            {file.device}
                          </span>
                          <Badge
                            variant={
                              file.state === "Matched"
                                ? "success"
                                : file.state === "Review"
                                  ? "warning"
                                  : "info"
                            }
                          >
                            {file.state}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground p-8 text-center text-sm">
                  {state?.syncState === "ready"
                    ? `${state.logCount ?? 0} roast logs and ${state.profileCount ?? 0} profiles are present on the Nano. ${state.importedLogCount} logs and ${state.importedProfileCount} profiles were imported by this sync. ${state.quarantinedLogCount + state.quarantinedProfileCount > 0 ? `${state.quarantinedLogCount + state.quarantinedProfileCount} native file${state.quarantinedLogCount + state.quarantinedProfileCount === 1 ? " was" : "s were"} quarantined without creating partial records.` : state.importWarningCount + state.profileWarningCount === 0 ? "Every imported native file passed parsing without warnings." : `${state.importWarningCount + state.profileWarningCount} parser warnings need review.`}`
                    : state?.busy
                      ? "The Nano is connected, but its filesystem is locked. This normally clears when the roaster returns to its fully idle state."
                      : "Device files are shown after the verified read-only inventory completes."}
                </div>
              )}
              <div className="bg-secondary/40 flex flex-col gap-3 border-t p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <LockKeyholeIcon className="size-4" />
                  Device writes disabled; log and profile import is read-only.
                </div>
                <Button
                  disabled={
                    (!deviceAvailable && !demoDevice) ||
                    state?.busy === true ||
                    state?.syncState === "syncing"
                  }
                  onClick={() => {
                    if (demoDevice) {
                      toast.success(
                        "One new roast log imported; original bytes retained"
                      )
                      return
                    }
                    void synchronizeDevice()
                      .then(() => device.refetch())
                      .then(() => toast.success("Nano logs synchronized"))
                      .catch(() =>
                        toast.error(
                          "The Nano is still busy. Tan Studio will retry automatically."
                        )
                      )
                  }}
                >
                  {state?.syncState === "syncing"
                    ? "Importing…"
                    : state?.busy
                      ? "Waiting for Nano"
                      : "Synchronize files"}
                </Button>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="storage" className="pt-4">
            <section
              className="bg-card rounded-xl border p-5"
              aria-labelledby="storage-heading"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="storage-heading" className="font-semibold">
                  Device storage
                </h2>
                <span className="font-mono text-sm">
                  {demoDevice ? "62% free" : "—"}
                </span>
              </div>
              {demoDevice ? <Progress value={38} className="mt-4" /> : null}
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <Metric
                  label="Profiles"
                  value={state?.profileCount ?? "—"}
                  detail={demoDevice ? "168 KB" : "Inventory unavailable"}
                />
                <Metric
                  label="Roast logs"
                  value={state?.logCount ?? "—"}
                  detail={demoDevice ? "4.2 MB" : "Inventory unavailable"}
                />
                <Metric
                  label="Other"
                  value={demoDevice ? "3 files" : "—"}
                  detail={demoDevice ? "48 KB" : "Inventory unavailable"}
                />
              </div>
            </section>
          </TabsContent>

          <TabsContent value="protocol" className="pt-4">
            <section
              className="bg-card rounded-xl border p-5"
              aria-labelledby="protocol-heading"
            >
              <h2 id="protocol-heading" className="font-semibold">
                Protocol evidence
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Capabilities stay explicitly marked as verified, captured,
                inferred or unknown.
              </p>
              <ul className="mt-5 flex flex-col gap-3 text-sm">
                <li className="flex items-center gap-3">
                  <CheckCircle2Icon className="text-primary size-4" />
                  <span className="flex-1">
                    Spontaneous type-2 capability frame
                  </span>
                  <Badge variant="success">Verified</Badge>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2Icon className="text-primary size-4" />
                  <span className="flex-1">Seeded CRC-16/CCITT-XMODEM</span>
                  <Badge variant="success">Verified</Badge>
                </li>
                <li className="flex items-center gap-3">
                  <CheckCircle2Icon className="text-primary size-4" />
                  <span className="flex-1">
                    Type-3 time sync and type-4 acknowledgement
                  </span>
                  <Badge variant="success">Read-only</Badge>
                </li>
                <li className="flex items-center gap-3">
                  <LockKeyholeIcon className="text-muted-foreground size-4" />
                  <span className="flex-1">
                    Profile and filesystem write commands
                  </span>
                  <Badge variant="secondary">Capture required</Badge>
                </li>
              </ul>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
