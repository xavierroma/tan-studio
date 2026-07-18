import type { ProviderId } from "../shared/ids"
import type { InstantMs, Revision } from "../shared/units"
import { nextRevision, revision } from "../shared/units"
import { invariant } from "../shared/errors"
import {
  normalizedLookup,
  normalizedStringSet,
  optionalText,
  requiredText,
} from "../shared/text"

export type ProviderContact = Readonly<{
  websiteUrl: string | null
  email: string | null
  phone: string | null
}>

export type ProviderContactInput = Readonly<{
  websiteUrl?: string | null
  email?: string | null
  phone?: string | null
}>

export type Provider = Readonly<{
  id: ProviderId
  displayName: string
  normalizedName: string
  aliases: readonly string[]
  contact: ProviderContact
  referenceNotes: string | null
  defaultCurrencyCode: string | null
  notes: string | null
  archivedAt: InstantMs | null
  revision: Revision
  createdAt: InstantMs
  updatedAt: InstantMs
}>

export type CreateProviderInput = Readonly<{
  id: ProviderId
  displayName: string
  aliases?: readonly string[]
  contact?: ProviderContactInput
  referenceNotes?: string | null
  defaultCurrencyCode?: string | null
  notes?: string | null
  now: InstantMs
}>

function providerContact(
  input: ProviderContactInput | undefined
): ProviderContact {
  const websiteUrl = optionalText(
    input?.websiteUrl,
    "contact.websiteUrl",
    2_048
  )
  if (websiteUrl !== null) {
    try {
      const parsed = new URL(websiteUrl)
      invariant(
        parsed.protocol === "https:" || parsed.protocol === "http:",
        "invalid_provider_url",
        "Provider URL must use HTTP or HTTPS",
        "contact.websiteUrl"
      )
    } catch {
      invariant(
        false,
        "invalid_provider_url",
        "Provider URL must be an absolute HTTP(S) URL",
        "contact.websiteUrl"
      )
    }
  }
  const email = optionalText(input?.email, "contact.email", 320)
  invariant(
    email === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "invalid_provider_email",
    "Provider email is invalid",
    "contact.email"
  )
  return Object.freeze({
    websiteUrl,
    email,
    phone: optionalText(input?.phone, "contact.phone", 100),
  })
}

function currencyCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null
  const code = value.trim().toUpperCase()
  invariant(
    /^[A-Z]{3}$/.test(code),
    "invalid_currency_code",
    "Default currency must use ISO 4217 format",
    "defaultCurrencyCode"
  )
  return code
}

export function createProvider(input: CreateProviderInput): Provider {
  const displayName = requiredText(input.displayName, "displayName")
  return Object.freeze({
    id: input.id,
    displayName,
    normalizedName: normalizedLookup(displayName),
    aliases: normalizedStringSet(input.aliases ?? [], "aliases", 100),
    contact: providerContact(input.contact),
    referenceNotes: optionalText(input.referenceNotes, "referenceNotes", 2_000),
    defaultCurrencyCode: currencyCode(input.defaultCurrencyCode),
    notes: optionalText(input.notes, "notes", 10_000),
    archivedAt: null,
    revision: revision(1),
    createdAt: input.now,
    updatedAt: input.now,
  })
}

export type UpdateProviderInput = Readonly<{
  displayName?: string
  aliases?: readonly string[]
  contact?: ProviderContactInput
  referenceNotes?: string | null
  defaultCurrencyCode?: string | null
  notes?: string | null
}>

export function updateProvider(
  provider: Provider,
  patch: UpdateProviderInput,
  now: InstantMs
): Provider {
  const displayName =
    patch.displayName === undefined
      ? provider.displayName
      : requiredText(patch.displayName, "displayName")

  return Object.freeze({
    ...provider,
    displayName,
    normalizedName: normalizedLookup(displayName),
    aliases:
      patch.aliases === undefined
        ? provider.aliases
        : normalizedStringSet(patch.aliases, "aliases", 100),
    contact:
      patch.contact === undefined
        ? provider.contact
        : providerContact(patch.contact),
    referenceNotes:
      patch.referenceNotes === undefined
        ? provider.referenceNotes
        : optionalText(patch.referenceNotes, "referenceNotes", 2_000),
    defaultCurrencyCode:
      patch.defaultCurrencyCode === undefined
        ? provider.defaultCurrencyCode
        : currencyCode(patch.defaultCurrencyCode),
    notes:
      patch.notes === undefined
        ? provider.notes
        : optionalText(patch.notes, "notes", 10_000),
    revision: nextRevision(provider.revision),
    updatedAt: now,
  })
}

export function archiveProvider(provider: Provider, now: InstantMs): Provider {
  if (provider.archivedAt !== null) return provider
  return Object.freeze({
    ...provider,
    archivedAt: now,
    revision: nextRevision(provider.revision),
    updatedAt: now,
  })
}
