import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { Textarea } from "@tan-studio/ui/components/textarea"
import {
  CableIcon,
  FlameIcon,
  RefreshCwIcon,
  SaveIcon,
  ShieldCheckIcon,
} from "lucide-react"
import type { FormEvent } from "react"
import { useEffect } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import {
  createNote,
  createRoast,
  getDevice,
  listCoffees,
  listProfiles,
  listRoasts,
  queryKeys,
  synchronizeDevice,
  updateRoast,
} from "@/lib/api"

export function LiveRoastScreen() {
  const search = useSearch({ from: "/roast" })
  const navigate = useNavigate({ from: "/roast" })
  const queryClient = useQueryClient()
  const device = useQuery({
    queryKey: queryKeys.device(),
    queryFn: ({ signal }) => getDevice(signal),
    refetchInterval: 5_000,
  })
  const profiles = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: ({ signal }) => listProfiles(undefined, signal),
  })
  const coffees = useQuery({
    queryKey: queryKeys.coffees(),
    queryFn: ({ signal }) => listCoffees(undefined, signal),
  })
  const planned = useQuery({
    queryKey: queryKeys.roasts({ status: "planned" }),
    queryFn: ({ signal }) => listRoasts({ status: "planned" }, signal),
  })
  const activeRoast = planned.data?.[0]
  const selectedProfile =
    profiles.data?.find((profile) => profile.id === search.profileId) ??
    profiles.data?.[0]
  useEffect(() => {
    if (selectedProfile && search.profileId !== selectedProfile.id) {
      void navigate({
        search: { profileId: selectedProfile.id, coffeeId: search.coffeeId },
        replace: true,
      })
    }
  }, [navigate, search.coffeeId, search.profileId, selectedProfile])
  const prepare = useMutation({
    mutationFn: async (input: {
      level: number
      load: number
      note: string
    }) => {
      const roast = await createRoast({
        profileId: selectedProfile!.id,
        coffeeId: search.coffeeId ?? null,
        levelThousandths: Math.round(input.level * 1_000),
        greenInputMassMg: Math.round(input.load * 1_000),
        adjustments: { levelThousandths: Math.round(input.level * 1_000) },
        roasterParameters: {},
      })
      if (input.note.trim())
        await createNote({
          kind: "recommendation",
          body: input.note.trim(),
          source: "user",
          attributes: { phase: "preRoast" },
          links: [
            { resourceType: "roast", resourceId: roast.id },
            { resourceType: "profile", resourceId: selectedProfile!.id },
          ],
        })
      return roast
    },
    onSuccess: (roast) => {
      toast.success(`Roast #${roast.id} prepared`)
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      void navigate({
        to: "/roasts/$roastId",
        params: { roastId: String(roast.id) },
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const sync = useMutation({
    mutationFn: synchronizeDevice,
    onSuccess: () => {
      toast.success("Nano synchronization started")
      void queryClient.invalidateQueries({ queryKey: queryKeys.device() })
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
    },
    onError: (error) => toast.error(error.message),
  })
  const discard = useMutation({
    mutationFn: () =>
      updateRoast(activeRoast!.id, activeRoast!.revision, {
        status: "interrupted",
        result: "aborted",
      }),
    onSuccess: () => {
      toast.success("Prepared roast discarded")
      void queryClient.invalidateQueries({ queryKey: ["roasts"] })
    },
    onError: (error) => toast.error(error.message),
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    prepare.mutate({
      level: Number(form.get("level")),
      load: Number(form.get("load")),
      note: String(form.get("note") ?? ""),
    })
  }
  const connected = device.data?.connection === "connected"
  const profileItems =
    profiles.data?.map((profile) => ({
      value: String(profile.id),
      label: `#${profile.id} · ${profile.name}`,
    })) ?? []
  const coffeeItems = [
    { value: "none", label: "Assign later" },
    ...(coffees.data?.map((coffee) => ({
      value: String(coffee.id),
      label: `#${coffee.id} · ${coffee.name}`,
    })) ?? []),
  ]

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Prepare a roast"
        description="Choose the profile and coffee now. Tan Studio creates the roast record before the Nano starts, then attaches the device log after synchronization."
        actions={
          <Badge variant={connected ? "success" : "warning"}>
            <CableIcon data-icon="inline-start" />
            {connected
              ? `${device.data?.model ?? "Nano"} connected`
              : "Nano disconnected"}
          </Badge>
        }
      />
      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(0,44rem)_minmax(18rem,1fr)]">
        <div className="flex flex-col gap-5">
          {activeRoast ? (
            <Alert className="bg-info">
              <FlameIcon />
              <AlertTitle>
                Roast #{activeRoast.id} is already prepared
              </AlertTitle>
              <AlertDescription>
                <p>
                  Its profile, coffee, load, and adjustments are durable in the
                  backend.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to="/roasts/$roastId"
                    params={{ roastId: String(activeRoast.id) }}
                    className={buttonVariants({ size: "sm" })}
                  >
                    Resume roast
                  </Link>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={discard.isPending}
                    onClick={() => discard.mutate()}
                  >
                    Discard plan
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
          <form onSubmit={submit} className="bg-card rounded-xl border p-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="roast-profile">Profile</FieldLabel>
                <Select
                  items={profileItems}
                  value={
                    selectedProfile ? String(selectedProfile.id) : undefined
                  }
                  onValueChange={(value) =>
                    value &&
                    void navigate({
                      search: {
                        profileId: Number(value),
                        coffeeId: search.coffeeId,
                      },
                      replace: true,
                    })
                  }
                >
                  <SelectTrigger id="roast-profile" className="w-full">
                    <SelectValue placeholder="Choose a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {profileItems.map((profile) => (
                        <SelectItem key={profile.value} value={profile.value}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  The exact profile document is snapshotted onto this roast.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="roast-coffee">Green coffee</FieldLabel>
                <Select
                  items={coffeeItems}
                  value={search.coffeeId ? String(search.coffeeId) : "none"}
                  onValueChange={(value) =>
                    void navigate({
                      search: {
                        profileId: selectedProfile?.id,
                        coffeeId: value === "none" ? undefined : Number(value),
                      },
                      replace: true,
                    })
                  }
                >
                  <SelectTrigger id="roast-coffee" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {coffeeItems.map((coffee) => (
                        <SelectItem key={coffee.value} value={coffee.value}>
                          {coffee.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="roast-level">Level</FieldLabel>
                  <Input
                    key={`level-${selectedProfile?.id}`}
                    id="roast-level"
                    name="level"
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    required
                    defaultValue={
                      (selectedProfile?.recommendedLevelThousandths ?? 2_500) /
                      1_000
                    }
                  />
                  <FieldDescription>
                    Per-roast adjustment; the profile is not changed.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="roast-load">Green load · g</FieldLabel>
                  <Input
                    key={`load-${selectedProfile?.id}`}
                    id="roast-load"
                    name="load"
                    type="number"
                    min="1"
                    step="1"
                    required
                    defaultValue={
                      (selectedProfile?.referenceLoadMg ?? 120_000) / 1_000
                    }
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="roast-plan-note">
                  Adjustment or intention
                </FieldLabel>
                <Textarea
                  id="roast-plan-note"
                  name="note"
                  placeholder="Reduce the finish slightly; last cup tasted dry and roasty."
                />
                <FieldDescription>
                  This becomes a note linked to both the roast and its profile,
                  so an agent can use it later.
                </FieldDescription>
              </Field>
              <Button
                type="submit"
                disabled={
                  !selectedProfile || prepare.isPending || activeRoast != null
                }
              >
                <SaveIcon data-icon="inline-start" />
                Create roast record
              </Button>
            </FieldGroup>
          </form>
        </div>

        <aside className="flex flex-col gap-5">
          <Alert className="bg-info">
            <ShieldCheckIcon />
            <AlertTitle>The Nano remains in control</AlertTitle>
            <AlertDescription>
              Start and stop the roast on the physical machine. Tan Studio
              records intent, synchronizes the finished KLOG, and visualizes the
              result.
            </AlertDescription>
          </Alert>
          <section className="bg-card rounded-xl border p-5">
            <h2 className="font-semibold">After the roast</h2>
            <ol className="text-muted-foreground mt-4 flex list-decimal flex-col gap-3 pl-5 text-sm">
              <li>Finish the roast on the Nano.</li>
              <li>Synchronize its logs and profiles.</li>
              <li>
                Review the curve, add an observation, and create the jar label.
              </li>
            </ol>
            <Button
              className="mt-5 w-full"
              variant="outline"
              disabled={!connected || sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Synchronize Nano
            </Button>
          </section>
          {!connected ? (
            <Alert className="bg-warning">
              <FlameIcon />
              <AlertTitle>You can still prepare offline</AlertTitle>
              <AlertDescription>
                The planned roast is durable in the backend. Connect the Nano
                before synchronizing the finished log.
              </AlertDescription>
            </Alert>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
