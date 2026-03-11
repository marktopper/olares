# Decoupling Roadmap: Making LarePass Optional

This document proposes a phased approach for making LarePass an **optional enhancement** rather than a hard requirement, while preserving all existing functionality and keeping full backwards compatibility.

---

## Guiding Principles

1. **No breaking changes.** Current LarePass users must not be affected. All new paths are additive.
2. **Security parity where possible.** Any alternative path must meet a clearly stated and documented security level.
3. **Incremental delivery.** Each phase delivers independently shippable value.
4. **Documentation first.** Every new capability gets first-class docs alongside code.

---

## Phase Overview

| Phase | Goal | Effort | Risk |
|-------|------|--------|------|
| **Phase 1** | Alternative 2FA (TOTP via any authenticator app) | Low | Low |
| **Phase 2** | Browser-based activation without mobile app | High | Medium |
| **Phase 3** | Passkey / FIDO2 as primary auth factor | Medium | Low |
| **Phase 4** | CLI-based headless activation | Medium | Low |
| **Phase 5** | Vault key management without mobile app | High | High |

---

## Phase 1 — Alternative Two-Factor Authentication (Quick Win)

**Goal:** Allow users to complete the second login factor using any TOTP-compatible authenticator app (Google Authenticator, Authy, 1Password, etc.) instead of LarePass.

### Background

Today the TOTP seed is stored exclusively inside LarePass. The six-digit code shown in LarePass is generated from that seed. If the same seed were exposed as a standard TOTP URI (`otpauth://totp/...`) during setup, it could be imported into any standard authenticator app.

### Steps

1. **Backend (BFL):** When generating a TOTP authenticator, return the seed and `otpauth://` URI alongside the existing QR code that LarePass scans. Store the seed hashed server-side.
2. **Settings UI:** Add a **"Set up alternative authenticator"** screen in `Settings → Account Security`. Display the `otpauth://` QR code and a manual entry key so users can register any TOTP app.
3. **Login flow (`QRCodeLogin.vue`):** Accept the TOTP code regardless of which app generated it — the server only validates the HMAC, not the source.
4. **Fallback UI:** On the 2FA prompt, add a second tab **"Use authenticator app"** next to the existing **"Use LarePass"** tab.
5. **Documentation:** Add a section to `docs/manual/larepass/two-factor-verification.md` (or a new page) explaining the alternative authenticator setup.

### What does NOT change

- LarePass TOTP continues to work exactly as before.
- The push-notification confirmation path is unchanged.
- Vault unlock still requires LarePass in this phase.

### Acceptance Criteria

- [ ] User can complete login with no LarePass installed, using Google Authenticator (or any TOTP app).
- [ ] Existing LarePass 2FA users are not prompted to change anything.
- [ ] Setup screen shows both QR code and manual key.

---

## Phase 2 — Browser-Based Activation Without Mobile App

**Goal:** Provide a fully browser-based activation flow for admin users who do not want to install a mobile app.

### Background

The Wizard page currently **only** displays a QR code and waits for LarePass to scan it. The signed payload LarePass sends can instead be produced by:
- A desktop-browser Web Crypto API signing flow (using a passkey or generated key pair stored in the browser).
- A temporary password set during OS installation that bootstraps the first login without a DID.

### Steps

1. **New activation mode toggle:** Add a setting to the Wizard (or installer configuration) to select between **"Mobile app (LarePass)"** and **"Browser-based setup"**. Default remains LarePass for backwards compatibility.

2. **Browser-based key generation (`BindTerminusBusiness.ts`):**
   - When `AuthType.SSI` is selected, proceed as today (LarePass required).
   - Add a new `AuthType.OsPassword` path:
     ```typescript
     if (activationMethod === 'browser') {
       authRes = await _authenticate({
         did: user.local_name,
         type: AuthType.OsPassword,
         purpose: AuthPurpose.Signup,
         caller: 'E001-browser'
       });
     }
     ```
   - Generate a secp256k1 key pair in the browser using Web Crypto, sign the challenge, derive a DID from the public key, and send the signed payload to BFL.

3. **Installer / Wizard UI changes (`ActivateTerminus.vue`):**
   - Add a **"Don't have LarePass?"** link on the QR code page.
   - Link to a new `BrowserActivatePage.vue` that walks the user through:
     a. Setting a strong admin password.
     b. Generating and displaying a backup mnemonic (BIP-39 compatible, 24 words).
     c. Confirming the mnemonic was written down.
     d. Completing activation.

4. **BFL backend:**
   - Accept `OsPassword` credential type on the `/activate` endpoint.
   - Store the DID derived from the browser-generated key alongside the password hash.
   - Issue a session token that allows the vault to be seeded from the provided mnemonic.

5. **Documentation:** New guide `docs/manual/get-started/activate-without-larepass.md`.

### Security Trade-off

| | LarePass path | Browser path |
|--|---------------|--------------|
| Private key storage | Hardware-backed secure enclave (mobile) | Browser local storage / password-encrypted IndexedDB |
| Phishing resistance | High — mobile app has domain pinning | Medium — browser is susceptible to XSS if app has vulnerabilities |
| Recovery | LarePass + Olares ID | Mnemonic backup phrase |
| Convenience | Requires phone | Works on any device with a browser |

This trade-off **must** be clearly communicated to users in the UI and documentation.

### Acceptance Criteria

- [ ] Admin can activate Olares from a desktop browser with no phone.
- [ ] Mnemonic is generated, displayed, and required to be confirmed before activation completes.
- [ ] Existing LarePass users see no change to their flow.
- [ ] Security notice is shown to browser-activation users explaining the key storage difference.

---

## Phase 3 — Passkey / FIDO2 as Primary Authentication

**Goal:** Allow users to register a hardware security key (YubiKey, etc.) or platform passkey (Touch ID, Windows Hello) as their primary authentication factor.

### Background

The SDK already defines `AuthType.WebAuthnPlatform` and `AuthType.WebAuthnPortable`. These are dead code today. Wiring them up would provide strong, phishing-resistant authentication without a mobile app.

### Steps

1. **Backend:** Implement WebAuthn registration and assertion endpoints in BFL.
   - `POST /bfl/auth/v1/webauthn/register-begin`
   - `POST /bfl/auth/v1/webauthn/register-finish`
   - `POST /bfl/auth/v1/webauthn/authenticate-begin`
   - `POST /bfl/auth/v1/webauthn/authenticate-finish`

2. **SDK (`auth.ts`):** Implement `WebAuthnPlatform` and `WebAuthnPortable` in `_authenticate()`.

3. **Settings UI:** Add a **"Security Keys"** section to account settings where users can register / remove FIDO2 keys or passkeys.

4. **Login flow:** When user registered a passkey, show a **"Use passkey"** button on the login page as an alternative to 2FA.

5. **Activation flow:** Allow passkey to fulfill the second-factor requirement after first-factor password login.

### Acceptance Criteria

- [ ] User can register a YubiKey as a 2FA method.
- [ ] User can register a platform passkey (Touch ID / Windows Hello) as a 2FA method.
- [ ] Login page shows passkey option when one is registered.
- [ ] LarePass 2FA still works for users who registered via LarePass.

---

## Phase 4 — Headless / CLI Activation

**Goal:** Support activating an Olares instance from the command line without any GUI or mobile app. This enables server-room deployments and CI/CD test environments.

### Background

The `cli/` directory already contains tooling for Olares management. Extending it with an activation subcommand is a natural fit.

### Steps

1. **New CLI subcommand:** `olares activate --method=password --username=admin --password=<secret> --mnemonic-file=<path>`

2. **Implementation:**
   - Read the mnemonic from a file or stdin (never a CLI argument, to avoid shell history exposure).
   - Generate a DID from the mnemonic seed.
   - POST the activation payload to the BFL endpoint directly.
   - Print the resulting session token or write it to a designated file.

3. **Security hardening:**
   - Require `--mnemonic-file` to point to a file with mode `0600`.
   - Warn if the file is world-readable.
   - Zero the mnemonic buffer after use.

4. **CI/CD example:** Provide a sample GitHub Actions workflow snippet in the documentation showing how to activate an Olares test instance in a pipeline.

5. **Documentation:** `docs/manual/get-started/headless-activation.md`

### Acceptance Criteria

- [ ] `olares activate` command activates a fresh Olares instance with no interactive UI.
- [ ] Command exits non-zero and prints an error message on failure.
- [ ] Mnemonic is never written to disk by the tool itself and never echoed to stdout.
- [ ] Works in a Docker/container environment.

---

## Phase 5 — Vault Key Management Without Mobile App

**Goal:** Allow the encrypted vault (secret / credential store) to be unlocked using something other than a LarePass-connected mobile device.

### Background

The vault is encrypted with the user's mnemonic-derived key. LarePass holds this key in the device's secure enclave and sends it over an encrypted WebSocket when the vault needs to be opened. This is the deepest and most security-sensitive coupling point.

### Steps

1. **Key derivation from mnemonic + password:**
   - Implement PBKDF2 (or Argon2id) derivation: `vault_key = KDF(mnemonic, user_password, salt)`.
   - Allow vault unlock by the browser submitting the mnemonic + password directly over a secure channel.
   - This does not change the ciphertext format — the vault stays encrypted with the same key.

2. **Recovery code path:**
   - When LarePass is not present, show a **"Unlock vault with recovery phrase"** option.
   - Prompt for the 24-word mnemonic + login password.
   - Derive the key in-browser using Web Crypto, submit to BFL to open the vault.
   - Session-cache the derived key (in memory only, never persisted).

3. **Hardware key alternative:**
   - Allow a FIDO2 hardware key to provide a PRF (Pseudo-Random Function) output that replaces the mnemonic for vault decryption.
   - This is the strongest non-mobile option.

4. **Security notice:** Users relying on mnemonic-based vault unlock must be warned that:
   - The mnemonic gives full access to the vault.
   - It should never be entered on an untrusted device.
   - The FIDO2 PRF path is strongly preferred for daily use.

5. **LarePass vault path unchanged:** All existing WebSocket-based vault operations are preserved.

### Acceptance Criteria

- [ ] Vault can be unlocked by entering the 24-word mnemonic in the browser (with explicit security warning).
- [ ] Vault can be unlocked using a FIDO2 key with PRF support.
- [ ] Vault cannot be unlocked by password alone (mnemonic or hardware key always required).
- [ ] LarePass vault flow is unchanged.

---

## Cross-Phase Work

### Configuration Flag

Add an operator-level configuration option in the Olares installation settings to declare the supported authentication methods:

```yaml
# /etc/olares/auth-config.yaml
auth:
  larepass:
    enabled: true          # default: true
    required: false        # set true to enforce LarePass for all users
  browser_activation:
    enabled: false         # opt-in
  passkeys:
    enabled: false         # opt-in
  headless_cli:
    enabled: false         # opt-in for server deployments
```

This allows administrators to choose their security posture while the defaults maintain the current LarePass-first experience.

### Shared Security Documentation

Create `docs/manual/security/authentication-methods.md` that:

- Compares all supported authentication methods side-by-side.
- Explains the trust model and attack surface of each method.
- Provides recommendations for common deployment scenarios (home lab, small team, enterprise, CI/CD).

---

## Timeline Estimate

| Phase | Complexity | Suggested Priority |
|-------|-----------|-------------------|
| Phase 1 (alternative TOTP) | 1–2 weeks | **High** — widest user impact, lowest risk |
| Phase 4 (CLI activation) | 2–3 weeks | **High** — unblocks server / CI/CD use cases |
| Phase 3 (passkeys) | 3–4 weeks | **Medium** — strong UX improvement |
| Phase 2 (browser activation) | 4–6 weeks | **Medium** — complex crypto in the browser |
| Phase 5 (vault without mobile) | 6–8 weeks | **Low initially** — highest complexity and risk |

---

## Open Questions

1. **Olares ID (DID) creation without LarePass:** Currently, creating an Olares ID requires the LarePass app. Should browser-based activation create a temporary local-only identity, or should the DID registry also offer a browser-based enrollment flow?

2. **Key escrow / recovery:** If the private key lives only in the browser, what is the recovery path if the user loses access to their device? Should Olares offer an optional encrypted key backup to a trusted server?

3. **Multi-device synchronization:** LarePass handles cross-device key sync today. A non-mobile path would need a separate synchronization story.

4. **Regulatory / compliance requirements:** Some enterprise deployments may require HSM (Hardware Security Module) key storage. Phase 5 should consider HSM integration as a premium path.

---

The next document, [03-alternative-auth-implementation.md](./03-alternative-auth-implementation.md), provides concrete code-level guidance for implementing each phase.
