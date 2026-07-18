# Kaffelogic Studio and Nano 7 product discovery

Status: discovery baseline
Research date: 18 July 2026
Installed Studio inspected: 7.4.3 on macOS
Roaster firmware found in logs: 7.20.6

## 1. Executive summary

Kaffelogic Studio is not only a graph editor. It is a desktop device companion that combines five systems:

1. A profile and fan-curve editor.
2. A live roast monitor and event logger.
3. A native-file viewer, comparator, converter, and report exporter.
4. A two-way roaster file synchronizer and device manager.
5. A firmware, preferences, calibration, and connectivity utility.

The replacement must preserve this full scope while making the everyday loop much clearer:

> choose a coffee and profile -> roast and mark events -> review telemetry -> taste and annotate -> print a label -> revise or derive a profile -> repeat.

The largest modernization opportunities are a durable roast database, rich chart annotations, structured coffee and tasting records, label printing, profile version history, LLM-assisted analysis and profile drafting, and read-only remote monitoring.

Two findings materially change the roadmap:

- The native plaintext files are sufficiently understood to prototype lossless offline parsers, and static analysis provides a strong starting point for a SASSI codec. Direct-device compatibility must still be treated as unverified until a controlled handshake, file-transfer, and supervised live-roast capture pass the conformance plan.
- Kaffelogic already sells a same-LAN Wireless Connect module. The future hardware opportunity is therefore secure browser-native and internet-remote monitoring with resilient buffering, not merely replacing a USB cable with Wi-Fi.

## 2. Evidence and confidence

| Marker | Meaning |
| --- | --- |
| O | Observed directly in the installed Studio 7.4.3 interface. |
| F | Confirmed from local native files or static interoperability analysis. |
| D | Confirmed in current official documentation. |
| H | Confirmed in an older official release/manual and rechecked in the current UI where possible. |
| P | Proposed replacement behavior, not an existing feature. |

The installed application and user data were inspected read-only. No device action, file deletion, firmware installation, formatting, or live control command was sent. The USB endpoint was unavailable during the initial inspection. After the user powered on the Nano, a follow-up confirmed the expected RP2040 CDC ACM control/data interfaces and full-speed USB node. Studio initially owned the serial port and was not interrupted. After Studio exited, a read-only type-2 request was captured; a complete host handshake, file transfer, and live-roast capture remain pending.

## 3. Current product baseline

### 3.1 Hardware and roast model

- Nano 7 is a fluid-bed roaster with variable heat and airspeed, rapid PID control, and automated cooldown. [D: current product page](https://www.kaffelogic.com/products/nano-7e)
- Standard load is 120 g. The Boost feature supports approximately 50-200 g depending on coffee, selected in 10 g increments. [D: current product page](https://www.kaffelogic.com/products/nano-7e)
- A roast profile is a time/temperature target curve plus fan behavior, level mapping, predicted events, controller settings, and metadata. [D: Studio page](https://www.kaffelogic.com/pages/studio)
- Roast level changes both roast end time and end temperature. Development Percentage and Development Lock provide another end-point mode. [D: User Manual v3.12](https://cdn.shopify.com/s/files/1/0278/9169/5713/files/KL_User_Manual_V3.12_web.pdf?v=1750663013)

### 3.2 Current software and firmware

- Current official Studio download resolved to version 7.4.3 during research. [D: downloads](https://www.kaffelogic.com/pages/downloads)
- The inspected app is Studio 7.4.3, an x86_64 Python 2.7/wxPython desktop application running through Rosetta on Apple Silicon. [F]
- The official latest firmware and the newest inspected local logs were both 7.20.6. The current firmware release adds roaster preferences in Studio and requires Studio 7.3.27 or later. [D: firmware release notes](https://webservices.kaffelogic.com/scripts/read_release_notes.php?project=firmware&section=kaffelogic)
- Studio supports Basic, Advanced, Expert, and Engineer settings exposure. [O, D: Studio page](https://www.kaffelogic.com/pages/studio)

## 4. Complete current capability inventory

### 4.1 Connection, discovery, and synchronization

| Capability | Evidence | Notes |
| --- | --- | --- |
| USB-C connection to current Nano 7 | O/D/F | RP2040 composite CDC ACM control/data interfaces, VID/PID, full-speed link, and macOS node were verified live; the device type-2 request and seeded CRC are live-verified, while bidirectional SASSI behavior remains capture-dependent. |
| Legacy removable memory-stick workflow | D/O | FAT/FAT32 media and `kaffelogic/roast-logs`, `kaffelogic/roast-profiles`. |
| Automatic local mirror per roaster | F | Studio keeps logs, profiles, firmware, operational status, and a three-way sync base. |
| Bidirectional profile/log synchronization | O/F | File conflicts and device-busy state are part of the sync model. |
| Same-LAN Wi-Fi connection | D/F | Official module uses a bridge implementation of the same protocol family. |
| Reconnect/resynchronize | O | `Tools > Connection tools`. |
| Connection log and Wi-Fi scan | O | Diagnostic UI exists. |
| Local sync-folder and memory-stick backup access | O/F | Dedicated open/browse actions and backup folders. |
| Storage status and oldest-log pressure | D/F | Warnings escalate as the device approaches capacity. |

### 4.2 Live roast monitoring

The observed live/log surface can display:

- Target roast profile.
- Spot temperature, temperature, and mean temperature.
- Profile, actual, and desired Rate of Rise.
- Heater power in kW.
- Requested fan speed and actual fan RPM.
- Zones, phases, event markers, grid, legend, and standard axes.
- Elapsed time, live temperature, and live RoR.
- Expected Colour Change and First Crack time/temperature.
- Recommended roast-end time/temperature.
- Development duration, percentage, and temperature increase.
- The selected level and descriptive roast degree.

Live actions and event editing include:

- Mark Colour Change.
- Mark First Crack.
- Mark First Crack End.
- Mark Second Crack.
- Mark Second Crack End.
- End the roast and begin cooldown.
- Enter an exact time for an event.
- Delete an event override.
- Zoom in/out/reset and expand the Y axis.
- Optionally show a live data tooltip.

Evidence: O/F, plus the [official Studio page](https://www.kaffelogic.com/pages/studio) and [official event guide](https://kaffelogicjp.com/pages/usermanual-005).

Important boundary: starting a roast is documented as a physical-roaster action. Remote unattended start is not established as a supported Studio workflow.

### 4.3 Profile editor

The temperature profile editor supports:

- Create, open, save, and save as.
- Point insertion and deletion.
- Direct numeric time/temperature editing.
- Bezier control handles and smooth-point/smooth-all operations.
- Curve linking where schema/settings permit it.
- Recommended-end and predicted-event overlays.
- Editable recommended level and expected First Crack/Colour Change.
- Computed end time, development duration, percentage, and temperature increase.
- RoR, fan, zones, phases, grid, and legend overlays.
- Undo/redo.
- Whole-curve affine transform: time multiply/add and temperature multiply/add.
- Merge from another profile.
- Compare against default, legacy, log, profile, or multiple files.
- Extract a profile from a roast log.

The dedicated fan-profile editor supports:

- Bezier fan curve editing in time/RPM space.
- Direct RPM editing.
- Roast-profile overlay.
- Insert/delete/smooth controls.
- Whole-curve affine transform for time and RPM.

Profile settings are progressively revealed by difficulty and include these families:

- Preheat.
- Roasting behavior.
- Zones and boost/multipliers.
- Fan steps.
- Control system/PID and specific-heat adjustments.
- Corners.
- Cooling.
- Reference load size and Boost scaling.

The current file-properties dialog shows schema compatibility milestones:

| Profile schema | Minimum firmware | Capability milestone shown by Studio |
| --- | --- | --- |
| 1.4 | 7.2+ | Baseline current legacy profile. |
| 1.5 | 7.3.5+ | Short name may be blank. |
| 1.6 | 7.4.5+ | Zones 1 and 2 can use power profiling; zone 3 is boost-only. |
| 1.7 | 7.4.6+ | Zone 3 supports multipliers and power profiling. |
| 1.8 | 7.10+ | Non-default reference load size. |

Studio's schema dialog shows 7.10+, while Kaffelogic's separate reference-load guidance states 7.11.1+. Use 7.11.1 as the conservative deployment floor until hardware testing resolves the discrepancy.

Evidence: O/F. Official overview: [Studio](https://www.kaffelogic.com/pages/studio).

### 4.4 Profile metadata and families

Profile metadata includes:

- Display/short name.
- Designer.
- Free-form description.
- Modified timestamp.
- Schema version.
- Recommendations, batch-size guidance, change history, and cupping notes stored in the description.

Official profile families currently include KL Explorer, KL Washed, KL Natural, RTD, Rest, Cupping, KL Classic, Decaf, Robusta, Super Dark, and altitude-oriented sets. [D: official profiles](https://www.kaffelogic.com/pages/profiles)

### 4.5 Roast logs and post-roast analysis

| Capability | Evidence | Notes |
| --- | --- | --- |
| View native `.klog` | O/F | Profile and actual telemetry are overlaid. |
| Toggle telemetry series | O | Spot/temp/mean/profile/RoR/power/fan/zones. |
| View event and phase markers | O/F | Includes standard milestones and overrides. |
| Edit standard event timestamps | O/F | Saved as native `!event` overrides. |
| Tasting notes | O/F | Existing free-form field, not structured cupping. |
| Roast/environment/device metadata | O/F | Load, level, date, power, ambient, voltage, calibration, hours, firmware, and more. |
| Compare files | O/H | Selected telemetry and events are configurable. |
| Area under curve | O | Base/end time and base temperature. |
| Time calculator | O | Arithmetic understands `min:sec` values. |
| Capture chart image | O | Current Tools menu. |
| Export PDF | O | Current File menu. |
| Extract profile from log | O/D | Carries forward selected events/level and can retain log as reference. |
| Import/export production formats | O/D | Artisan, Cropster, Sonofresco; Ikawa import only. |

The existing application does **not** provide a first-class searchable coffee/lot database, structured cupping form, arbitrary chart-anchored annotations, saved analysis workspaces, or profile lineage.

### 4.6 Roaster storage and library manager

Observed `View roaster` tabs:

1. Logs - filename, roast date, profile, designer, profile modified time, level, length, notes; move/copy/rename/compare/delete/undo-delete/browse.
2. Profiles - add, move, copy, rename, compare, delete, undo-delete, browse; display name, description, designer, modified date.
3. Core profiles - master pack versus installed mapping, individual copy/delete, download again, replace all.
4. Roaster preferences - available when a direct connection is active.
5. Firmware - current/latest status and update path.

The device manager also supports profile packs, language resources, firmware compatibility, backups, and recent-trash behavior. [O/F]

### 4.7 Preferences, reports, and interoperability

General Studio options include:

- Celsius/Fahrenheit.
- Sync/USB save-button location.
- Phase-panel location.
- RoR axis multiplier and log smoothing window.
- Optional second derivative.
- Live tooltip.
- Line width and legend font size.
- Startup tips, wheel zoom, automatic updates, and Wi-Fi discovery.
- Local sync-root location.

Compare options choose which telemetry, events, and zones appear. Language packs are downloaded separately. [O/F]

Studio imports/exports Artisan, Cropster, Sonofresco, and Ikawa formats as described above. It also historically supports transformation envelopes for transferring profiles to production roasters. [D: Studio](https://www.kaffelogic.com/pages/studio)

### 4.8 Firmware, device preferences, diagnostics, and recovery

Current or documented capabilities include:

- Firmware check, install, reinstall/reflash, and compatibility warning.
- Restart/reset/install/rescue/BOOTSEL modes at the protocol layer.
- Roaster preferences: dial by Level or Dev%, Dev% Lock, retention of entered First Crack/end data, roast logging, display contrast, and temperature unit.
- Fan Preview without heat.
- Fan/bean-circulation and altitude calibration.
- Advanced voltage/element resistance calibration.
- Motor and heater hours, model, firmware, accessory information, and calibration state.
- Reformat onboard storage and set log counter.

Destructive device operations are present but should not share the everyday monitoring path. [O/F/D: User Manual](https://cdn.shopify.com/s/files/1/0278/9169/5713/files/KL_User_Manual_V3.12_web.pdf?v=1750663013)

### 4.9 Boost

Boost is both a commercial activation and a run-time load-size model. It scales heater and fan behavior relative to a profile reference load. Studio activates the feature through `Help > Activate features`; the roaster then supports selectable batch sizes. [D: Boost](https://www.kaffelogic.com/pages/boost)

Do not confuse Boost load scaling with profile-zone `boost`, which adjusts desired controller behavior inside a time zone.

### 4.10 Existing Wireless Connect module

The official module:

- Plugs into the Nano 7 USB connection.
- Joins a local Wi-Fi network after access-point provisioning.
- Gives Studio access to live monitoring, profiles, logs, and firmware over the LAN; preference writes over this path were not independently verified.
- Is not documented as an authenticated internet/cloud service.

Compatibility excludes early A/B serial families and requires checking some C35 units. [D: Wireless Connect](https://www.kaffelogic.com/products/wireless-connect-module)

Static analysis shows that it is a bridge endpoint using SASSI-family packets over TCP 9056 with bridge-specific message IDs. It should not be treated as a proven byte-for-byte transparent serial tunnel. [F]

## 5. Existing information architecture

```text
Studio
├── Document
│   ├── Log
│   ├── Roast Profile Curve
│   ├── Fan Profile Curve
│   ├── About this file
│   └── Profile settings
├── File
│   ├── New / Open / Save / Properties
│   ├── Extract profile from log
│   ├── Import / Export
│   └── New app window
├── Draw
│   └── Point and curve operations
├── Tools
│   ├── Compare / Transform / Merge / AUC / Time calculator
│   ├── Image capture
│   ├── View roaster / storage folders
│   └── Connection and recovery tools
├── Options
│   ├── Difficulty
│   ├── General / Compare
│   └── Language
└── View roaster
    ├── Logs
    ├── Profiles
    ├── Core profiles
    ├── Roaster preferences
    └── Firmware
```

The replacement should reorganize this around jobs instead of desktop menus: **Roast**, **Logs**, **Profiles**, **Coffees**, **Labels**, and **Devices**.

## 6. Modernization gap analysis

| Area | Existing state | Required modern direction |
| --- | --- | --- |
| Data model | Loose native files and mirror folders | Lossless native-file store plus indexed local database. |
| Coffee context | Mostly free text | Coffee, lot, origin, process, altitude, density, moisture, supplier, and inventory entities. |
| Notes | One free-form tasting field | Time/temperature-anchored notes, structured cupping, photos, follow-ups. |
| Labels | None | Template editor, print preview, QR link, system print/PDF, later direct printer drivers. |
| Profile history | Save-as and comparison | Immutable revisions, lineage, diff, rollback, source-log link. |
| Analysis | Manual overlays | Saved comparisons, automatic metrics, anomaly explanations, recommendations. |
| AI | None | Constrained drafts and diagnosis with evidence, validation, and explicit user approval. |
| Remote | Same-LAN desktop client | Read-only mobile web session, alerts, buffering, encrypted relay, reconnect. |
| UX | Menu-heavy document editor | Workflow-oriented app shell and progressive disclosure. |
| Safety | Desktop actions mixed together | Strict read/write/destructive capability boundaries and audit trail. |

## 7. Safety constraints

The current manual says the operator must remain nearby and that the appliance is not intended to be operated by a separate remote-control system. Therefore:

- Remote monitoring and alerts are in scope.
- Remote unattended start is out of scope.
- Remote control must not be implied by the normal monitoring UI.
- Stop/end actions remain local-only until separately safety-reviewed.
- Device format, firmware, restart, file delete, and recovery actions require explicit confirmation and are never available to anonymous/shared viewers.
- Live connectivity loss must never change roaster behavior; the roaster remains authoritative and autonomous.

Source: [Nano 7 User Manual v3.12](https://cdn.shopify.com/s/files/1/0278/9169/5713/files/KL_User_Manual_V3.12_web.pdf?v=1750663013).

## 8. Principal sources

- [Kaffelogic Studio](https://www.kaffelogic.com/pages/studio)
- [Downloads and release links](https://www.kaffelogic.com/pages/downloads)
- [Nano 7 User Manual v3.12](https://cdn.shopify.com/s/files/1/0278/9169/5713/files/KL_User_Manual_V3.12_web.pdf?v=1750663013)
- [Official profile guide](https://www.kaffelogic.com/pages/profiles)
- [Wireless Connect module](https://www.kaffelogic.com/products/wireless-connect-module)
- [Official Studio tutorials](https://www.youtube.com/playlist?list=PL-39UZNm2mlEOFPyZKBzMt7kLvDLqCY0A)
- [Roaster not syncing](https://kaffelogic.atlassian.net/wiki/spaces/RWK/pages/9535498/Roaster%2Bnot%2Bsyncing)
- [Extract profile from log](https://kaffelogic.atlassian.net/wiki/spaces/RWK/pages/14090253/Extract%2Bprofile%2Bfrom%2Blog)
- [Dial by Dev% / Dev Lock](https://kaffelogic.atlassian.net/wiki/spaces/RWK/pages/205881346/Dial%2Bin%2Bby%2BDev%2BDev%2BLock)

Local evidence is intentionally summarized without publishing the inspected unit's serial number, saved Wi-Fi credentials, application UUIDs, firmware binary, or proprietary encrypted-format key.
