import { useEffect, useRef, useState } from "react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { CableIcon, RefreshCwIcon, UnplugIcon, WifiIcon } from "lucide-react"

import { browserSerial, TanBridgeSetupClient } from "@/lib/tan-bridge-setup"
import type {
  TanBridgeSetupStatus,
  TanBridgeVisibleWifiNetwork,
} from "@tan-studio/api-contract"

type SetupActivity = "idle" | "connecting" | "scanning"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Tan Bridge setup failed."
}

function signalLabel(rssi: number) {
  if (rssi >= -55) return "Excellent"
  if (rssi >= -67) return "Good"
  if (rssi >= -75) return "Fair"
  return "Weak"
}

function NetworkRow({ network }: { network: TanBridgeVisibleWifiNetwork }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {network.ssid || "Hidden network"}
        </p>
        <p className="text-muted-foreground text-xs">
          Channel {network.channel} · {network.authMode.replaceAll("-", " ")}
        </p>
      </div>
      <Badge variant="secondary">
        {signalLabel(network.rssi)} · {network.rssi} dBm
      </Badge>
    </li>
  )
}

export function TanBridgeSetupPanel() {
  const clientRef = useRef<TanBridgeSetupClient | null>(null)
  const [status, setStatus] = useState<TanBridgeSetupStatus | null>(null)
  const [networks, setNetworks] = useState<
    readonly TanBridgeVisibleWifiNetwork[] | null
  >(null)
  const [activity, setActivity] = useState<SetupActivity>("idle")
  const [error, setError] = useState<string | null>(null)
  const supported = browserSerial() !== undefined

  useEffect(
    () => () => {
      const client = clientRef.current
      clientRef.current = null
      if (client) void client.close()
    },
    []
  )

  const connect = async () => {
    const serial = browserSerial()
    if (!serial) return
    let openedClient: TanBridgeSetupClient | null = null
    setActivity("connecting")
    setError(null)
    try {
      if (clientRef.current) await clientRef.current.close()
      openedClient = await TanBridgeSetupClient.connect(serial)
      const nextStatus = await openedClient.getStatus()
      clientRef.current = openedClient
      openedClient = null
      setStatus(nextStatus)
      setNetworks(null)
    } catch (nextError) {
      if (openedClient) await openedClient.close()
      setError(errorMessage(nextError))
      clientRef.current = null
      setStatus(null)
      setNetworks(null)
    } finally {
      setActivity("idle")
    }
  }

  const scan = async () => {
    const client = clientRef.current
    if (!client) return
    setActivity("scanning")
    setError(null)
    try {
      const result = await client.scanWifi()
      setNetworks(result.networks)
      setStatus(await client.getStatus())
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setActivity("idle")
    }
  }

  const disconnect = async () => {
    const client = clientRef.current
    clientRef.current = null
    if (client) await client.close()
    setStatus(null)
    setNetworks(null)
    setError(null)
  }

  return (
    <section className="bg-card rounded-xl border p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Tan Bridge setup</h2>
            <Badge variant="secondary">Development</Badge>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Connect the Atom directly to this computer. Wi-Fi names travel only
            over USB and are not sent to the Tan Studio service.
          </p>
        </div>
        <div className="flex gap-2">
          {status ? (
            <>
              <Button
                variant="outline"
                onClick={() => void disconnect()}
                disabled={activity !== "idle"}
              >
                <UnplugIcon data-icon="inline-start" />
                Disconnect
              </Button>
              <Button
                onClick={() => void scan()}
                disabled={activity !== "idle"}
              >
                <RefreshCwIcon data-icon="inline-start" />
                {activity === "scanning" ? "Scanning…" : "Scan Wi-Fi"}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => void connect()}
              disabled={!supported || activity !== "idle"}
            >
              <CableIcon data-icon="inline-start" />
              {activity === "connecting" ? "Connecting…" : "Connect Atom"}
            </Button>
          )}
        </div>
      </div>

      {!supported ? (
        <Alert className="bg-warning mt-5">
          <CableIcon />
          <AlertTitle>Web Serial is unavailable</AlertTitle>
          <AlertDescription>
            Open Tan Studio in desktop Chrome or Edge to configure the bridge
            over USB.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>Setup connection failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <CableIcon className="size-4" />
              <h3 className="text-sm font-medium">Atom connected</h3>
            </div>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Bridge</dt>
              <dd className="truncate font-mono text-xs">{status.bridgeId}</dd>
              <dt className="text-muted-foreground">Firmware</dt>
              <dd>{status.firmware.version}</dd>
              <dt className="text-muted-foreground">Lifecycle</dt>
              <dd>{status.lifecycle}</dd>
              <dt className="text-muted-foreground">Backend</dt>
              <dd>{status.backend.state}</dd>
            </dl>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <WifiIcon className="size-4" />
                <h3 className="text-sm font-medium">
                  Visible 2.4 GHz networks
                </h3>
              </div>
              {networks ? (
                <Badge variant="secondary">{networks.length} found</Badge>
              ) : null}
            </div>
            {networks === null ? (
              <p className="text-muted-foreground mt-4 text-sm">
                Run a scan to prove the browser-to-Atom setup handshake.
              </p>
            ) : networks.length === 0 ? (
              <p className="text-muted-foreground mt-4 text-sm">
                No visible 2.4 GHz networks were found.
              </p>
            ) : (
              <ul className="mt-2">
                {networks.map((network) => (
                  <NetworkRow key={network.networkId} network={network} />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <p className="text-muted-foreground mt-4 text-xs">
        This verified slice stops before credentials and cloud claiming. The
        fixed backend will be {"bridge.tanstudio.xroma.dev"} once DNS and the
        claim service exist.
      </p>
    </section>
  )
}
