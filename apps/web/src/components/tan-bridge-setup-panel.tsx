import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import {
  CableIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
  UnplugIcon,
  WifiIcon,
} from "lucide-react"

import { createBridgeClaim, listBridges, queryKeys } from "@/lib/api"
import { browserSerial, TanBridgeSetupClient } from "@/lib/tan-bridge-setup"
import {
  TanBridgeBackendHost,
  TanBridgeBackendPort,
  type TanBridgeSetupStatus,
  type TanBridgeVisibleWifiNetwork,
} from "@tan-studio/api-contract"

type SetupActivity = "idle" | "connecting" | "scanning" | "configuring"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Tan Bridge setup failed."
}

function signalLabel(rssi: number) {
  if (rssi >= -55) return "Excellent"
  if (rssi >= -67) return "Good"
  if (rssi >= -75) return "Fair"
  return "Weak"
}

export function TanBridgeSetupPanel() {
  const queryClient = useQueryClient()
  const clientRef = useRef<TanBridgeSetupClient | null>(null)
  const [status, setStatus] = useState<TanBridgeSetupStatus | null>(null)
  const [networks, setNetworks] = useState<
    readonly TanBridgeVisibleWifiNetwork[] | null
  >(null)
  const [selectedNetworkId, setSelectedNetworkId] = useState<string | null>(
    null
  )
  const [credential, setCredential] = useState("")
  const [activity, setActivity] = useState<SetupActivity>("idle")
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(false)
  const supported = browserSerial() !== undefined
  const bridges = useQuery({
    queryKey: queryKeys.bridges(),
    queryFn: ({ signal }) => listBridges(signal),
    refetchInterval: 5_000,
  })
  const selectedNetwork = useMemo(
    () => networks?.find((network) => network.networkId === selectedNetworkId),
    [networks, selectedNetworkId]
  )
  const needsCredential =
    selectedNetwork !== undefined && selectedNetwork.authMode !== "open"

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
    setConfigured(false)
    try {
      if (clientRef.current) await clientRef.current.close()
      openedClient = await TanBridgeSetupClient.connect(serial)
      const nextStatus = await openedClient.getStatus()
      clientRef.current = openedClient
      openedClient = null
      setStatus(nextStatus)
      setNetworks(null)
      setSelectedNetworkId(null)
      setCredential("")
    } catch (nextError) {
      if (openedClient) await openedClient.close()
      setError(errorMessage(nextError))
      clientRef.current = null
      setStatus(null)
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
      setSelectedNetworkId(result.networks.at(0)?.networkId ?? null)
      setStatus(await client.getStatus())
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setActivity("idle")
    }
  }

  const configure = async () => {
    const client = clientRef.current
    if (!client || !selectedNetwork) return
    if (needsCredential && credential.length === 0) {
      setError("Enter the password for the selected Wi-Fi network.")
      return
    }
    setActivity("configuring")
    setError(null)
    try {
      const claim = await createBridgeClaim()
      if (
        claim.backendHost !== TanBridgeBackendHost ||
        claim.backendPort !== TanBridgeBackendPort
      ) {
        throw new Error("The backend and bridge firmware endpoints do not match.")
      }
      await client.configure({
        ssid: selectedNetwork.ssid,
        credential,
        claimToken: claim.claimToken,
      })
      setCredential("")
      setConfigured(true)
      await client.close().catch(() => undefined)
      clientRef.current = null
      setStatus(null)
      setNetworks(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.bridges() })
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
    setSelectedNetworkId(null)
    setCredential("")
    setError(null)
  }

  return (
    <section className="bg-card rounded-xl border p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Tan Bridge setup</h2>
            <Badge variant="secondary">Local LAN</Badge>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Connect the Atom to this computer once, choose Wi-Fi, then move its
            single USB-C connection to the Nano. It will connect outbound to
            {` ${TanBridgeBackendHost}:${TanBridgeBackendPort}`}.
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
              <Button onClick={() => void scan()} disabled={activity !== "idle"}>
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
            Open Tan Studio in desktop Chrome or Edge to configure the bridge.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mt-5">
          <AlertTitle>Setup failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {configured ? (
        <Alert className="bg-info mt-5">
          <CheckCircle2Icon />
          <AlertTitle>Bridge configured</AlertTitle>
          <AlertDescription>
            Unplug the Atom from this computer and connect that same USB-C port
            to the powered Nano. Its claim is waiting at xrc.local.
          </AlertDescription>
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
              <dt className="text-muted-foreground">Wi-Fi</dt>
              <dd>{status.wifi.state}</dd>
              <dt className="text-muted-foreground">Backend</dt>
              <dd>{status.backend.state}</dd>
            </dl>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <WifiIcon className="size-4" />
                <h3 className="text-sm font-medium">2.4 GHz Wi-Fi</h3>
              </div>
              {networks ? (
                <Badge variant="secondary">{networks.length} found</Badge>
              ) : null}
            </div>
            {networks === null ? (
              <p className="text-muted-foreground mt-4 text-sm">
                Scan, select the network, and enter its password.
              </p>
            ) : networks.length === 0 ? (
              <p className="text-muted-foreground mt-4 text-sm">
                No visible 2.4 GHz networks were found.
              </p>
            ) : (
              <FieldGroup className="mt-4">
                <Field>
                  <FieldLabel htmlFor="tan-bridge-network">Network</FieldLabel>
                  <Select
                    value={selectedNetworkId}
                    onValueChange={(value) => {
                      setSelectedNetworkId(value)
                      setCredential("")
                    }}
                  >
                    <SelectTrigger id="tan-bridge-network" className="w-full">
                      <SelectValue placeholder="Choose a network" />
                    </SelectTrigger>
                    <SelectContent>
                      {networks.map((network) => (
                        <SelectItem
                          key={network.networkId}
                          value={network.networkId}
                        >
                          {network.ssid || "Hidden network"} · {signalLabel(network.rssi)} ({network.rssi} dBm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedNetwork ? (
                    <FieldDescription>
                      {selectedNetwork.authMode.replaceAll("-", " ")} · channel {selectedNetwork.channel}
                    </FieldDescription>
                  ) : null}
                </Field>
                {needsCredential ? (
                  <Field>
                    <FieldLabel htmlFor="tan-bridge-password">Wi-Fi password</FieldLabel>
                    <Input
                      id="tan-bridge-password"
                      type="password"
                      autoComplete="current-password"
                      value={credential}
                      onChange={(event) => setCredential(event.target.value)}
                      maxLength={63}
                    />
                    <FieldDescription>
                      Sent directly to the Atom over USB; Tan Studio does not
                      send or store it in the backend.
                    </FieldDescription>
                  </Field>
                ) : null}
                <Button
                  onClick={() => void configure()}
                  disabled={
                    activity !== "idle" ||
                    !selectedNetwork ||
                    (needsCredential && credential.length === 0)
                  }
                >
                  <WifiIcon data-icon="inline-start" />
                  {activity === "configuring"
                    ? "Saving configuration…"
                    : "Connect bridge"}
                </Button>
              </FieldGroup>
            )}
          </div>
        </div>
      ) : null}

      {bridges.data?.length ? (
        <div className="mt-5 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Registered bridge</h3>
            <Badge
              variant={bridges.data[0]?.state === "connected" ? "secondary" : "outline"}
            >
              {bridges.data[0]?.state}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            {bridges.data[0]?.bridgeId}
          </p>
        </div>
      ) : null}
    </section>
  )
}
