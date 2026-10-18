import { NotebookSection } from "@/components/notebook"
import { usesOperatorSession } from "@/lib/companion-client"
import { Button } from "@tan-studio/ui/components/button"
import { DownloadIcon } from "lucide-react"

const plugin = __TAN_CODEX_PLUGIN__
const hostedSettings = "https://studio.tan.coffee/settings?section=agents"

/** Download and setup steps for the hosted Tan Studio Codex plugin. */
export function CodexPluginSettings() {
  return (
    <NotebookSection title="Codex plugin" id="codex-plugin">
      <div className="flex max-w-3xl flex-col gap-4 py-3">
        <p className="text-sm">
          Tan Studio Hosted connects Codex to{" "}
          <code className="text-[13px]">{plugin.endpoint}</code>. The package
          holds no credential.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            nativeButton={false}
            role="link"
            render={
              <a href={plugin.href} download="tan-studio-codex-plugin.zip" />
            }
          >
            <DownloadIcon data-icon="inline-start" />
            Download plugin
          </Button>
          <span className="text-muted-foreground font-[family-name:var(--tan-font-brand)] text-[13px]">
            ZIP · v{plugin.version} · {Math.ceil(plugin.bytes / 1024)} KB
          </span>
        </div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
          <li>Extract the ZIP into a folder you keep.</li>
          <li>
            Register it:{" "}
            <code className="bg-muted rounded-[3px] px-1.5 py-0.5 text-[13px] break-all select-all">
              codex plugin marketplace add /path/to/extracted-folder
            </code>
          </li>
          <li>
            In Codex, open Plugins and install{" "}
            <strong className="font-medium">Tan Studio Hosted</strong>, or run{" "}
            <code className="bg-muted rounded-[3px] px-1.5 py-0.5 text-[13px] break-all select-all">
              codex plugin add tan-studio-hosted@tan-studio
            </code>
            .
          </li>
          <li>
            {usesOperatorSession ? (
              <>
                Create a credential in{" "}
                <a href="#agent-connections" className="notebook-link">
                  Agent connections
                </a>
                . Choose its access and lifetime.
              </>
            ) : (
              <>
                Signed in to the hosted notebook, create a credential in{" "}
                <a
                  href={hostedSettings}
                  className="notebook-link"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Settings → Agents
                </a>
                . Choose its access and lifetime.
              </>
            )}
          </li>
          <li>
            Enter it in Codex's API key field for Tan Studio Hosted. Never paste
            it into a chat.
          </li>
          <li>Start a new conversation and ask for Tan Studio's status.</li>
        </ol>
      </div>
    </NotebookSection>
  )
}
