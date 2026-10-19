import { Link, useSearch } from "@tanstack/react-router"
import { AgentCredentialSettings } from "@/components/agent-credential-settings"
import { ApiTokenSettings } from "@/components/api-token-settings"
import { BrewDefaultsSettings } from "@/components/brew-defaults-settings"
import { CodexPluginSettings } from "@/components/codex-plugin-settings"
import { NotebookSettings } from "@/components/notebook-settings"
import { PageHeader } from "@/components/page-header"
import { NotebookBreadcrumbs } from "@/components/notebook"
import { SessionControls } from "@/components/session-controls"
import { DeviceSettings } from "@/screens/device-screen"

export function SettingsScreen() {
  const { section } = useSearch({ from: "/settings" }),
    title =
      section === "notebook"
        ? "Notebook"
        : section === "devices"
          ? "Devices"
          : section === "access"
            ? "Access"
            : section === "agents"
              ? "Agents"
              : "Brewing defaults"
  return (
    <div>
      <NotebookBreadcrumbs
        items={[
          <Link to="/settings" search={{ section: undefined }}>
            Settings
          </Link>,
          title,
        ]}
      />
      <PageHeader title={title} />
      {section === "notebook" ? (
        <NotebookSettings />
      ) : section === "devices" ? (
        <DeviceSettings />
      ) : section === "access" ? (
        <>
          <div className="flex items-center gap-3 pb-6">
            <SessionControls />
          </div>
          <ApiTokenSettings />
          <p className="mt-6 text-sm">
            Agent connections and the Codex plugin are in{" "}
            <Link
              to="/settings"
              search={{ section: "agents" }}
              className="notebook-link"
            >
              Settings → Agents
            </Link>
            .
          </p>
        </>
      ) : section === "agents" ? (
        <>
          <CodexPluginSettings />
          <AgentCredentialSettings />
        </>
      ) : (
        <BrewDefaultsSettings />
      )}
    </div>
  )
}
