# Current LarePass Integration Analysis

This document provides a detailed audit of every place the Olares codebase couples itself to LarePass. Understanding the current state is the prerequisite for any decoupling effort.

---

## 1. What Is LarePass?

LarePass is a cross-platform application (iOS, Android, macOS, Windows) that acts as:

| Role | Mechanism |
|------|-----------|
| **Identity wallet** | Stores the user's Olares ID (a Decentralized Identifier / DID) and the private key that proves ownership |
| **Activation agent** | Scans the Wizard QR code and sends a signed challenge to the Olares backend to complete first-time setup |
| **Two-factor authenticator** | Pushes a login confirmation notification or generates TOTP codes |
| **Vault client** | Encrypts and decrypts the vault mnemonic using the device-held key |
| **Device / network manager** | Manages VPN (Tailscale), DNS, and remote access |

---

## 2. Authentication Types Defined in the SDK

**File:** `apps/packages/sdk/src/core/auth.ts`

```typescript
export enum AuthType {
    DID = 'did',
    WebAuthnPlatform = 'webauthn_platform',
    WebAuthnPortable = 'webauthn_portable',
    Totp = 'totp',
    PublicKey = 'public_key',
    OpenID = 'openid',
    OsToken = 'os_token',
    OsPassword = 'os_password',
    SSI = 'ssi'          // ← Self-Sovereign Identity — the only one in active use
}
```

Although the SDK defines eight additional auth types, only `AuthType.SSI` is wired up through the activation and vault-login flows. All other types are currently dead code in practice.

---

## 3. Hardcoded SSI Calls in the Activation Layer

**File:** `apps/packages/app/src/utils/BindTerminusBusiness.ts`

This single file contains **three call sites** where LarePass / SSI authentication is unconditionally required.

### 3.1 Initial User Activation (Signup)

```typescript
// ~line 78
async function userBindTerminus(user: UserItem) {
    const authRes = await _authenticate({
        did: user.local_name,
        type: AuthType.SSI,   // ← no alternative offered
        purpose: AuthPurpose.Signup,
        caller: 'E001'
    });
    // ...
}
```

**What happens here:** The Wizard page shows a QR code. The user must open LarePass on their phone, scan the QR, sign the server's cryptographic challenge with the private key stored on the phone, and send the signed response back. Without a LarePass client the flow cannot continue.

### 3.2 User Import via Olares Token

```typescript
// ~line 216
async function importUserByTerminusToken(terminusName: string, token: string) {
    const authRes = await _authenticate({
        did: terminusName,
        type: AuthType.SSI,   // ← no alternative offered
        purpose: AuthPurpose.Login,
        caller: 'E002'
    });
    // ...
}
```

**What happens here:** When a second user (non-admin) is imported onto the same Olares node, their mobile app is required to confirm the binding.

### 3.3 Vault Login

```typescript
// ~line 455
async function loginVault(user: UserItem) {
    const authRes = await _authenticate({
        did: user.local_name,
        type: AuthType.SSI,   // ← no alternative offered
        purpose: AuthPurpose.Login,
        caller: 'E003'
    });
    // ...
}
```

**What happens here:** Every time the Vault (encrypted key/secret store) needs to be unlocked after login, LarePass is required to provide the decryption material.

---

## 4. Two-Factor Authentication

**File:** `apps/packages/app/src/components/settings/QRCodeLogin.vue`

The second authentication factor supports two modes, both tied to LarePass:

| Mode | How it works | LarePass dependency |
|------|-------------|---------------------|
| **Push notification** | Olares calls `/v2/user/activeLogin` every 3 seconds; user taps **Confirm** in the LarePass app notification | LarePass must be installed and running on a registered device |
| **TOTP code** | User opens LarePass → Settings → My Olares, reads the 6-digit OTP | TOTP seed is only stored inside LarePass; no way to use a standard authenticator app today |

There is currently no supported second factor that does not require LarePass.

---

## 5. Wizard / Onboarding UI

**Directory:** `apps/packages/app/src/pages/Mobile/connect/activate/`

| Component | LarePass requirement |
|-----------|---------------------|
| `ScanPage.vue` | User must have LarePass installed to scan the QR code displayed here |
| `ScanLocalPage.vue` | Manual URL entry; still requires SSI signing afterwards |
| `DiscoverLocalMachinesPage.vue` | mDNS discovery list rendered inside LarePass app |
| `BluetoothConnectNetworkPage.vue` | Uses LarePass Bluetooth stack to join Wi-Fi |
| `ActivateWizard.vue` | Status poller that depends on LarePass completing each phase |

The entire wizard was designed to run **inside** the LarePass mobile app. There is no independent browser-based activation UI.

---

## 6. Real-time Communication Stores

| Store file | Purpose | LarePass dependency |
|-----------|---------|---------------------|
| `stores/termipass.ts` | Tracks VPN / network state, token refresh | Reads connection state set by LarePass |
| `stores/larepassVaultWebsocket.ts` | Encrypted WebSocket to the mobile app's vault | Direct coupling — messages are signed by LarePass |
| `stores/larepassWebsocketManager.ts` | Manages WebSocket lifecycle | Wrapper for above |
| `stores/larepassWiseSocket.ts` | File-transfer (Wise) channel | LarePass-specific protocol |

The WebSocket stores are only used when LarePass is connected. If the app is not present the stores remain idle — so these are **optional dependencies** that do not block core operation once the vault is already open.

---

## 7. Documentation

Every activation and login guide in `docs/manual/larepass/` assumes LarePass is available:

- `activate-olares.md` — "Open LarePass app. Tap **Scan QR code**…"
- `two-factor-verification.md` — Both methods require LarePass
- `create-account.md` — Olares ID creation requires the mobile app
- `index.md` — LarePass described as mandatory bridge

No documentation exists for a LarePass-free path.

---

## 8. Backend / Infrastructure References

The Backend For Learning (BFL) layer exposes activation endpoints:

```
POST /bfl/settings/v1alpha1/activate
POST /bfl/settings/v1alpha1/binding-zone
GET  /bfl/info/v1/olares-info
```

These endpoints accept the signed payload produced by LarePass after the SSI challenge. Making them accept an alternative credential (e.g., a password hash or FIDO2 passkey) would require backend changes as well.

---

## 9. Dependency Graph

```
User wants to activate Olares
        │
        ▼
  Wizard page shows QR
        │
        ▼
  LarePass scans QR ──────────────── REQUIRED ──► No LarePass = stuck here
        │
        ▼
  LarePass signs SSI challenge
        │
        ▼
  BFL validates JWS signature
        │
        ▼
  Olares bound to Olares ID
        │
        ▼
  User logs in (browser)
        │
        ▼
  Second factor prompt ──────────── REQUIRED ──► No LarePass = stuck here
        │ (push notification or LarePass TOTP)
        ▼
  Vault unlock via LarePass WebSocket ─ REQUIRED ──► No LarePass = vault locked
```

---

## 10. Coupling Severity Matrix

| Feature | Current state | Blocking if LarePass absent |
|---------|--------------|----------------------------|
| Initial activation | Hardcoded SSI | **YES** |
| Member user activation | Hardcoded SSI | **YES** |
| Two-factor login | LarePass push or TOTP only | **YES** |
| Vault unlock | LarePass WebSocket | **YES** |
| Network / VPN management | LarePass Tailscale integration | For remote access only |
| File sync (Wise) | LarePass WebSocket channel | **NO** — works without it |
| Desktop app | Electron + LarePass optional | **NO** — subset of features |

---

## 11. Summary

LarePass is currently a **hard dependency** for all security-critical operations: activation, login second factor, and vault access. The coupling is implemented in a handful of specific locations, which means a targeted decoupling effort is feasible without a full rewrite.

The next document, [02-decoupling-roadmap.md](./02-decoupling-roadmap.md), proposes a phased plan to address each blocking dependency.
