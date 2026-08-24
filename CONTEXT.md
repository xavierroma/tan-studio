# Tan Studio

A calm notebook for one Kaffelogic Nano 7. The public model is Profile, Coffee, Roast, Brew, Note, Attachment, Label, and Settings. Native KLOG/KPRO files, telemetry, and device synchronization are internal evidence, not extra public resources.

## Language

**Notebook**:
The durable coffee records the operator cares about: profiles, coffees, roasts, brews, notes, attachments, labels, and settings.
_Avoid_: workspace, tenant, account, cloud

**Canonical backend**:
The single service that owns the notebook. There is not a second production backend. Desktop, the LAN appliance, and hosted infrastructure are placements of this backend, not additional backends.
_Avoid_: server, cloud, API (as a synonym for the backend)

**Operator**:
The one person who may use the hosted notebook. v1 has no accounts, roles, or tenants.
_Avoid_: user, customer, tenant, account

**LAN appliance**:
The Raspberry Pi or Mac LAN daemon that served the notebook on the home network with the Nano on USB. It is not a production topology after the hosted cutover.
_Avoid_: server, NAS, hub

**Tan Bridge**:
Our M5Stack AtomS3 Lite that plugs into the Nano USB-C port. It talks SASSI to the Nano over USB, and talks to the canonical backend over the internet. It does not own the notebook. It is not Kaffelogic's official Wireless Connect Module.
_Avoid_: wireless module, dongle, serial cable, second backend, Kaffelogic USB, official module

**Bridge session**:
The authenticated WebSocket conversation between Tan Bridge and the canonical backend. It is not the USB/SASSI conversation with the Nano.
_Avoid_: USB session, SASSI, LAN token

**Operator session**:
The browser login of the operator on the public UI. Sign in with Google. It is not the bridge session and not the old LAN token.
_Avoid_: LAN token, API key, user account

**API token**:
The credential a non-browser client — the MCP plugin, a script — presents to the hosted notebook, since it cannot sign in with Google. One per client, minted from behind the operator session, shown once, kept only as a digest, revocable on its own. It is not the operator session and not the LAN token.
_Avoid_: API key, launch token, LAN token, password

**Studio origin**:
`studio.tan.coffee` — the operator-facing UI, API, and Tan Bridge session of the canonical backend.
_Avoid_: tan.coffee (that is the public site), xroma.dev, bridge.studio.tan.coffee

**Public site**:
`tan.coffee` — landing and other public pages. It is not the notebook and is not this effort.
_Avoid_: studio, marketing site (as a synonym in tickets)
