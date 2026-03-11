# Making LarePass Optional in Olares

This directory contains analysis, guidelines, and a roadmap for making the LarePass mobile app an **optional** dependency in Olares rather than a hard requirement.

## Overview

[LarePass](https://www.olares.com/larepass) is the official cross-platform client app for Olares. It currently serves as the **only** supported path for:

- Activating a new Olares instance
- Binding an Olares ID to a device
- Completing two-factor authentication during login
- Accessing the encrypted vault (mnemonic / key store)

While LarePass provides excellent UX and strong cryptographic guarantees, its mandatory nature creates friction for server-only deployments, CI/CD pipelines, and users who prefer not to use a mobile app.

## Documents in This Directory

| File | Description |
|------|-------------|
| [01-current-integration-analysis.md](./01-current-integration-analysis.md) | Deep dive into every place LarePass is required today, with code references |
| [02-decoupling-roadmap.md](./02-decoupling-roadmap.md) | Phased plan for making LarePass optional without breaking existing users |
| [03-alternative-auth-implementation.md](./03-alternative-auth-implementation.md) | Concrete implementation guide for adding alternative authentication flows |

## Goals

1. **Zero breaking changes** for users who already use LarePass.
2. Provide at least one fully-supported path that does not require a mobile device.
3. Keep the same security model where possible, document trade-offs where not.
4. Make the alternative paths a first-class experience, not a hidden escape hatch.

## Quick Summary of Coupling Points

```
Activation flow
  └─ BindTerminusBusiness.ts     AuthType.SSI (hardcoded ×3)
       ├─ userBindTerminus()     Signup
       ├─ importUserByTerminusToken()  User import
       └─ loginVault()           Vault login

Two-factor authentication
  └─ QRCodeLogin.vue             Mobile push notification or TOTP from LarePass

Wizard onboarding
  └─ ScanPage.vue / DiscoverLocalMachinesPage.vue   Requires LarePass to scan QR

Documentation
  └─ docs/manual/larepass/activate-olares.md   All activation paths require LarePass
```

## Recommended Next Steps

1. Read the [current integration analysis](./01-current-integration-analysis.md) to understand the full scope.
2. Review the [decoupling roadmap](./02-decoupling-roadmap.md) for a phased approach.
3. Use the [implementation guide](./03-alternative-auth-implementation.md) when coding each phase.
