[![AI Coauthored](https://img.shields.io/badge/AI_Coauthored-↗_see_details-58a6ff?style=flat)](https://coauthored.dev/#v:1;o:~Y29hdXRob3JlZC5kZXY;created:2026-01-01;scope:project;intent:spike,prod;traj:stable;ai:code,debug,refactor,test,doc,arch;tools:~Q2xhdWRlIENvZGU;review:spot,ran,aitests,iter;strengths:backend,domain;confident:security,perf;limits:bugs,debt;env:external;data:medium;valid:unit,integ,e2e,perf;focus:arch,security,edge;notes:~SW4gZ2VuZXJhbCB0aGlzIGlzIGEgd29ya2luZyBidXQgdW5yZWZpbmVkIGNvZGViYXNlLiBUaGVyZSBpcyBjb25maWRlbmNlIGluIHRoZSBnZW5lcmFsIGFwcHJvYWNoLCBzZWN1cml0eSwgaW50ZWdyYXRpb24gd2l0aCBIb21lIEFzc2lzdGFudCBldGMuIEhvd2V2ZXIgdGhlcmUgaXMgdGVjaG5pY2FsIGRlYnQgaW4gdGVybXMgb2YgY29tbWl0IGhpc3RvcnksIGFyY2hpdGVjdHVyZSBwYXR0ZXJucywgYW5kIGluIGEgbGluZS1ieS1saW5lIGNvZGUgcmV2aWV3IG9mIHRoZSBpbnRlcm5hbHMu)

# TRMNL HA

![TRMNL Logo](trmnl-ha/logo.png)

Send Home Assistant dashboard screenshots to your TRMNL e-ink display with advanced dithering optimized for e-paper screens.

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fusetrmnl%2Ftrmnl-home-assistant)

## Features

- **E-ink optimized dithering** - Floyd-Steinberg and Ordered algorithms for crisp e-paper rendering
- **TRMNL webhook integration** - Automatic dashboard uploads to TRMNL devices
- **Scheduled captures** - Cron-based automation with Web UI management
- **Device presets** - Pre-configured settings for 24+ popular e-ink displays
- **Crash recovery** - Automatic browser recovery and process supervision
- **High performance** - Powered by Bun runtime for fast startup and low memory

## Installation

1. Add this repository to Home Assistant:
   - Go to **Settings** → **Add-ons** → **Add-on Store** → **⋮** → **Repositories**
   - Add: `https://github.com/usetrmnl/trmnl-home-assistant`

2. Install the **TRMNL HA** add-on

3. Configure your access token:
   - In Home Assistant: **Profile** → **Long-Lived Access Tokens** → **Create Token**
   - Add to the add-on configuration

4. Start the add-on and open the Web UI

### Proxmox Users

If running Home Assistant OS in Proxmox, set the VM host type to `host` for Chromium to work properly.

## Security

**Important:** This add-on is designed for trusted home networks.

- The Web UI (port 10000) has **no built-in authentication**
- **Always use Ingress** (sidebar integration) instead of direct port access
- **Never expose port 10000** directly to the internet
- Access tokens are stored securely in Home Assistant's add-on configuration

## Documentation

| Topic | Description |
|-------|-------------|
| [Configuration](trmnl-ha/DOCS.md#configuration) | Required and optional settings |
| [Web UI](trmnl-ha/DOCS.md#web-ui) | Using the web interface |
| [API Reference](trmnl-ha/DOCS.md#api-reference) | Screenshot endpoint parameters |
| [Device Presets](trmnl-ha/DOCS.md#device-presets) | Supported e-ink displays |
| [Scheduled Captures](trmnl-ha/DOCS.md#scheduled-captures) | Cron-based automation |
| [Troubleshooting](trmnl-ha/DOCS.md#troubleshooting) | Common issues and fixes |
| [Local Development](trmnl-ha/DOCS.md#local-development) | Development setup |

## Attribution

This project is based on the [puppet](https://github.com/balloob/home-assistant-addons/tree/main/puppet) Home Assistant add-on by [Paulus Schoutsen](https://github.com/balloob).

See the [NOTICE](trmnl-ha/NOTICE) file for complete attribution and modification details.

## License

Copyright (c) Paulus Schoutsen (original work)
Copyright (c) 2024-2025 TRMNL (enhancements and modifications)

Licensed under the [Apache License 2.0](trmnl-ha/LICENSE)

## Links

- [TRMNL](https://usetrmnl.com)
- [Documentation](trmnl-ha/DOCS.md)
- [Changelog](trmnl-ha/CHANGELOG.md)
- [Upstream Project (puppet)](https://github.com/balloob/home-assistant-addons)
