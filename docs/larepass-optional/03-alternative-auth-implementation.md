# Alternative Authentication Implementation Guide

This document provides concrete, code-level guidance for each decoupling phase described in [02-decoupling-roadmap.md](./02-decoupling-roadmap.md). It is intended for engineers who will implement the changes.

---

## Table of Contents

1. [Phase 1 — Standard TOTP 2FA](#phase-1--standard-totp-2fa)
2. [Phase 2 — Browser-Based Activation](#phase-2--browser-based-activation)
3. [Phase 3 — Passkey / FIDO2 Authentication](#phase-3--passkey--fido2-authentication)
4. [Phase 4 — Headless CLI Activation](#phase-4--headless-cli-activation)
5. [Phase 5 — Vault Key Management Without Mobile App](#phase-5--vault-key-management-without-mobile-app)
6. [Shared: Auth Method Configuration Flag](#shared-auth-method-configuration-flag)
7. [Testing Strategy](#testing-strategy)

---

## Phase 1 — Standard TOTP 2FA

### Objective

Allow any RFC 6238-compliant TOTP app to serve as the second factor — not just LarePass.

### Files to Change

| File | Change |
|------|--------|
| `apps/packages/app/src/components/settings/QRCodeLogin.vue` | Add "Use authenticator app" tab |
| `apps/packages/app/src/pages/Mobile/connect/activate/ActivateWizard.vue` | Link to alternative 2FA setup during activation |
| Backend BFL (Go): authenticator endpoint | Return `otpauth://` URI in the registration response |
| `docs/manual/larepass/two-factor-verification.md` | Document the new option |

### Implementation Notes

#### 1.1 Backend: expose `otpauth://` URI

When the backend creates a new TOTP authenticator for a user, it already generates a secret seed. The only required change is to include an `otpauthUri` field in the API response:

```json
{
  "status": 200,
  "data": {
    "authenticator_id": "abc123",
    "secret": "JBSWY3DPEHPK3PXP",
    "otpauth_uri": "otpauth://totp/user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Olares&algorithm=SHA1&digits=6&period=30"
  }
}
```

#### 1.2 Frontend: display QR code for standard authenticators

In the settings UI, when showing the authenticator setup screen, render the `otpauth_uri` as a QR code using an existing library (e.g. `qrcode` npm package already in the project) and also display the raw secret for manual entry:

```vue
<!-- apps/packages/app/src/components/settings/AuthenticatorSetup.vue (new or extended) -->
<template>
  <div class="authenticator-setup">
    <p>Scan this QR code with any authenticator app (LarePass, Google Authenticator, Authy, etc.):</p>
    <QRCode :value="otpauthUri" />
    <p>Or enter this key manually: <code>{{ secret }}</code></p>
  </div>
</template>
```

#### 1.3 Login flow: accept TOTP regardless of source

The server-side TOTP validation is already source-agnostic — it verifies the 6-digit code against the stored seed using HMAC-SHA1. No backend change is needed here beyond 1.1 above.

The frontend `QRCodeLogin.vue` should present two equal-weight options:

```vue
<TabGroup>
  <TabList>
    <Tab>Confirm in LarePass</Tab>
    <Tab>Enter code from authenticator app</Tab>
  </TabList>
  <TabPanels>
    <TabPanel>
      <!-- existing push-notification UI -->
    </TabPanel>
    <TabPanel>
      <!-- existing OTP entry field — no code change needed -->
    </TabPanel>
  </TabPanels>
</TabGroup>
```

### Security Notes

- TOTP provides the same cryptographic assurance regardless of which app generates the code, as long as the seed is kept secret.
- The seed is only as secure as the device where the authenticator app stores it. LarePass stores the seed in a hardware-backed secure enclave; other apps may store it in software only. Document this trade-off.

---

## Phase 2 — Browser-Based Activation

### Objective

Enable a user to activate Olares entirely from a desktop browser, with the browser generating the key pair instead of LarePass.

### Files to Change

| File | Change |
|------|--------|
| `apps/packages/app/src/utils/BindTerminusBusiness.ts` | Add `OsPassword` branch alongside existing `SSI` branch |
| `apps/packages/app/src/pages/Mobile/connect/activate/ActivateTerminus.vue` | Add "Activate without LarePass" option |
| `apps/packages/app/src/pages/Mobile/connect/activate/` | Add new `BrowserActivatePage.vue` |
| Backend BFL (Go): `/activate` endpoint | Accept `OsPassword` credential type |
| `apps/packages/sdk/src/core/auth.ts` | Ensure `OsPassword` auth type is handled in `_authenticate()` |

### Implementation Notes

#### 2.1 Key generation in the browser

Use the browser's native `SubtleCrypto` API to generate a secp256k1 (or P-256) key pair. Derive a DID from the public key following the `did:key` specification.

```typescript
// apps/packages/app/src/utils/browserKeyGen.ts (new file)

export async function generateActivationKeyPair(): Promise<{
  did: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  // Derive a did:key identifier from the public key
  const did = await publicKeyToDid(publicKeyJwk);

  return { did, privateKeyJwk, publicKeyJwk };
}

export async function signChallenge(
  challenge: string,
  privateKeyJwk: JsonWebKey
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const data = new TextEncoder().encode(challenge);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  );

  // Use TextDecoder-safe base64 encoding for binary data
  return btoa(Array.from(new Uint8Array(signature), (b) => String.fromCodePoint(b)).join(''));
}
```

#### 2.2 Mnemonic generation and confirmation

Generate a BIP-39 mnemonic during activation and require the user to confirm it before proceeding. This mnemonic serves as the vault recovery key.

```typescript
// apps/packages/app/src/utils/browserKeyGen.ts (continued)
import { generateMnemonic, validateMnemonic } from 'bip39';

export function createMnemonic(): string {
  return generateMnemonic(256); // 24 words
}

export function verifyMnemonicConfirmation(
  original: string,
  userInput: string
): boolean {
  // Normalize whitespace before comparing
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalize(original) === normalize(userInput);
}
```

#### 2.3 `BindTerminusBusiness.ts` changes

Add a conditional branch in `userBindTerminus()` that checks an activation method setting:

```typescript
// apps/packages/app/src/utils/BindTerminusBusiness.ts

async function userBindTerminus(user: UserItem, method: 'ssi' | 'browser' = 'ssi') {
  let authRes;

  if (method === 'browser') {
    // Browser-based path: generate key pair, sign challenge
    const { did, privateKeyJwk } = await generateActivationKeyPair();
    const challenge = await fetchActivationChallenge(did);
    const signature = await signChallenge(challenge, privateKeyJwk);

    authRes = await _authenticate({
      did,
      type: AuthType.OsPassword,
      purpose: AuthPurpose.Signup,
      caller: 'E001-browser',
      extra: { signature }
    });
  } else {
    // Existing LarePass / SSI path — unchanged
    authRes = await _authenticate({
      did: user.local_name,
      type: AuthType.SSI,
      purpose: AuthPurpose.Signup,
      caller: 'E001'
    });
  }

  // ... rest of function unchanged
}
```

Apply the same pattern to `importUserByTerminusToken()` (caller `E002`) and `loginVault()` (caller `E003`).

#### 2.4 New `BrowserActivatePage.vue`

```vue
<!-- apps/packages/app/src/pages/Mobile/connect/activate/BrowserActivatePage.vue -->
<template>
  <div class="browser-activate">
    <Step v-if="step === 'password'" title="Set admin password">
      <PasswordInput v-model="password" :rules="passwordRules" />
      <PasswordInput v-model="passwordConfirm" label="Confirm password" />
      <Button @click="nextStep">Continue</Button>
    </Step>

    <Step v-if="step === 'mnemonic'" title="Save your recovery phrase">
      <SecurityNotice>
        Write down these 24 words and keep them safe. You will need them to recover your vault if you lose access.
      </SecurityNotice>
      <MnemonicDisplay :words="mnemonic" />
      <Button @click="step = 'confirm'">I have written it down</Button>
    </Step>

    <Step v-if="step === 'confirm'" title="Confirm recovery phrase">
      <MnemonicInput @complete="onMnemonicConfirmed" />
    </Step>

    <Step v-if="step === 'activating'" title="Activating Olares...">
      <Spinner />
    </Step>
  </div>
</template>
```

### Security Notes

- Private key lives in browser memory only during activation. It is **not** persisted.
- The mnemonic is the long-term recovery secret. Treat it like a master password.
- Recommend using a password manager to store the mnemonic if the user does not want paper backup.
- Add a prominent warning that browser-based key generation is not hardware-backed.

---

## Phase 3 — Passkey / FIDO2 Authentication

### Objective

Wire up the already-defined `AuthType.WebAuthnPlatform` and `AuthType.WebAuthnPortable` to real WebAuthn registration and assertion flows.

### Files to Change

| File | Change |
|------|--------|
| `apps/packages/sdk/src/core/auth.ts` | Implement WebAuthn in `_authenticate()` |
| `apps/packages/app/src/components/settings/` | Add security key / passkey management screen |
| Backend BFL (Go) | Add WebAuthn registration and authentication endpoints |
| `docs/manual/larepass/two-factor-verification.md` | Document passkey option |

### Implementation Notes

#### 3.1 SDK: implement WebAuthn in `_authenticate()`

```typescript
// apps/packages/sdk/src/core/auth.ts

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

async function _authenticate(params: AuthParams): Promise<AuthResult> {
  switch (params.type) {
    case AuthType.SSI:
      return _authenticateSSI(params);

    case AuthType.WebAuthnPlatform:
    case AuthType.WebAuthnPortable: {
      if (params.purpose === AuthPurpose.Signup) {
        // Registration
        const options = await fetchWebAuthnRegistrationOptions(params.did);
        const credential = await startRegistration(options);
        return submitWebAuthnRegistration(params.did, credential);
      } else {
        // Authentication
        const options = await fetchWebAuthnAuthenticationOptions(params.did);
        const assertion = await startAuthentication(options);
        return submitWebAuthnAuthentication(params.did, assertion);
      }
    }

    // ... other types
  }
}
```

Use the [`@simplewebauthn/browser`](https://simplewebauthn.dev/) library for the client side and [`@simplewebauthn/server`](https://simplewebauthn.dev/) (or Go equivalent) for the backend. These are well-audited, widely-used libraries.

#### 3.2 Backend WebAuthn endpoints (Go / BFL)

```
POST /bfl/auth/v1/webauthn/register/begin
  Request:  { "did": "user@example.com" }
  Response: PublicKeyCredentialCreationOptions

POST /bfl/auth/v1/webauthn/register/finish
  Request:  RegistrationResponseJSON
  Response: { "status": "ok", "authenticator_id": "..." }

POST /bfl/auth/v1/webauthn/authenticate/begin
  Request:  { "did": "user@example.com" }
  Response: PublicKeyCredentialRequestOptions

POST /bfl/auth/v1/webauthn/authenticate/finish
  Request:  AuthenticationResponseJSON
  Response: { "status": "ok", "token": "..." }
```

Store the credential public key and credential ID in the BFL database associated with the user's DID.

#### 3.3 Settings UI

Add a **Security Keys** card to the account settings page listing registered passkeys / hardware keys with the ability to add and remove them.

### Security Notes

- Platform passkeys (Touch ID, Face ID, Windows Hello) are phishing-resistant and hardware-backed — stronger than TOTP.
- Portable keys (YubiKey) are the strongest option for server administrators.
- Passkeys are not portable across browsers/devices unless synced via the platform (e.g., Apple Keychain, Google Password Manager).

---

## Phase 4 — Headless CLI Activation

### Objective

Add a new `activate` subcommand to the Olares CLI that can activate a fresh Olares instance without any GUI or mobile app.

### Files to Change

| File | Change |
|------|--------|
| `cli/` directory | Add `cmd/activate.go` (or similar) |
| Backend BFL (Go) | Ensure `/activate` endpoint is reachable via CLI credential |

### Implementation Notes

#### 4.1 CLI command interface

```
Usage:
  olares activate [flags]

Flags:
  --username      string   Admin Olares ID (e.g. admin@example.com)
  --password      string   Admin password (prefer --password-file or stdin)
  --password-file string   Path to file containing the admin password
  --mnemonic-file string   Path to file containing the 24-word mnemonic (mode 0600 required)
  --olares-url    string   URL of the Olares wizard (e.g. https://wizard.example.com)
  --output        string   Write session token to this file instead of stdout
  --no-verify-tls          Disable TLS verification (NOT recommended)
```

**Never accept mnemonic or password as a plain CLI argument** to avoid leaking secrets into shell history and `/proc/<pid>/cmdline`.

#### 4.2 Password / mnemonic reading

```go
// cli/cmd/activate.go

func readSecret(flagValue, filePath string, prompt string) (string, error) {
    if filePath != "" {
        info, err := os.Stat(filePath)
        if err != nil {
            return "", fmt.Errorf("cannot stat %s: %w", filePath, err)
        }
        if info.Mode().Perm()&0o077 != 0 {
            return "", fmt.Errorf("%s has group or other permissions set; run: chmod 600 %s", filePath, filePath)
        }
        data, err := os.ReadFile(filePath)
        if err != nil {
            return "", err
        }
        return strings.TrimRight(string(data), "\n"), nil
    }

    if flagValue != "" {
        fmt.Fprintln(os.Stderr, "WARNING: passing secrets via --flag is insecure; prefer --flag-file or stdin")
        return flagValue, nil
    }

    // Fall back to interactive prompt (hidden input)
    return readPasswordFromStdin(prompt)
}
```

#### 4.3 Activation request

```go
func runActivate(cmd *cobra.Command, args []string) error {
    password, err := readSecret(passwordFlag, passwordFileFlag, "Admin password: ")
    if err != nil {
        return err
    }
    defer zeroString(&password)

    mnemonic, err := readSecret("", mnemonicFileFlag, "Recovery mnemonic: ")
    if err != nil {
        return err
    }
    defer zeroString(&mnemonic)

    // Derive DID from mnemonic
    did, signingKey, err := didFromMnemonic(mnemonic)
    if err != nil {
        return fmt.Errorf("invalid mnemonic: %w", err)
    }

    // Fetch challenge from Wizard
    challenge, err := fetchChallenge(olaresURL, did)
    if err != nil {
        return err
    }

    // Sign challenge
    signature, err := signChallenge(challenge, signingKey)
    if err != nil {
        return err
    }

    // POST activation
    token, err := postActivation(olaresURL, did, password, signature)
    if err != nil {
        return fmt.Errorf("activation failed: %w", err)
    }

    // Output session token
    fmt.Println(token)
    return nil
}

// Zero out a string in memory after use
func zeroString(s *string) {
    b := []byte(*s)
    for i := range b {
        b[i] = 0
    }
    *s = ""
}
```

#### 4.4 CI/CD example (GitHub Actions)

```yaml
# .github/workflows/integration-test.yml
- name: Activate Olares for testing
  env:
    OLARES_MNEMONIC: ${{ secrets.OLARES_TEST_MNEMONIC }}
  run: |
    echo "$OLARES_MNEMONIC" > /tmp/mnemonic.txt
    chmod 600 /tmp/mnemonic.txt
    olares activate \
      --username=testadmin@example.com \
      --password-file=/run/secrets/olares_password \
      --mnemonic-file=/tmp/mnemonic.txt \
      --olares-url=https://wizard.local:30180 \
      --output=/tmp/session_token.txt
    rm /tmp/mnemonic.txt
```

### Security Notes

- Always use `chmod 600` on mnemonic/password files.
- Use GitHub Actions secrets (or Vault, etc.) to store the mnemonic in CI.
- The session token written by `--output` should also be treated as a secret.

---

## Phase 5 — Vault Key Management Without Mobile App

### Objective

Allow the encrypted vault to be unlocked by providing the mnemonic phrase in the browser, or via a FIDO2 hardware key that supports the `prf` extension.

### Files to Change

| File | Change |
|------|--------|
| `apps/packages/app/src/stores/larepassVaultWebsocket.ts` | Add non-WebSocket vault unlock path |
| `apps/packages/sdk/src/auth/ssi-server.ts` | Support KDF-based vault key derivation |
| `apps/packages/app/src/components/` | Add "Unlock with recovery phrase" UI |
| Backend BFL (Go): vault endpoint | Accept KDF-derived key instead of WebSocket payload |

### Implementation Notes

#### 5.1 Key derivation from mnemonic

The vault key is currently derived inside LarePass using the mnemonic. Replicating this derivation in the browser:

```typescript
// apps/packages/app/src/utils/vaultKeyDerivation.ts (new file)

export async function deriveVaultKey(
  mnemonic: string,
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Import password material
  const passwordMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(mnemonic + ':' + password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES-256 key using PBKDF2
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000, // NIST recommendation for PBKDF2-SHA256
      hash: 'SHA-256'
    },
    passwordMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // not exportable
    ['decrypt', 'encrypt']
  );
}
```

> **Important:** The exact KDF parameters (algorithm, iterations, salt derivation) must match what LarePass uses. This requires inspecting LarePass's own implementation or coordinating with the LarePass team to ensure compatibility with existing vaults.

#### 5.2 FIDO2 PRF extension for vault key

FIDO2 authenticators that support the `prf` extension can produce a deterministic pseudo-random output from a static input. This output can replace the mnemonic as the vault key material:

```typescript
// apps/packages/app/src/utils/fido2VaultKey.ts (new file)

export async function deriveVaultKeyFromFido2(
  credentialId: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      allowCredentials: [{ type: 'public-key', id: hexToBuffer(credentialId) }],
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      extensions: {
        prf: {
          eval: {
            first: salt  // deterministic PRF input
          }
        }
      }
    }
  });

  // @ts-expect-error — prf extension is not yet in the TypeScript WebAuthn types (as of 2024);
  // remove this comment once @types/webauthn-browser includes PRF support
  const prfOutput = assertion.getClientExtensionResults().prf?.results?.first;
  if (!prfOutput) {
    throw new Error('FIDO2 authenticator does not support PRF extension');
  }

  return crypto.subtle.importKey('raw', prfOutput, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
}
```

#### 5.3 Vault unlock UI

Add a secondary "Unlock vault with recovery phrase" button on the vault-locked state screen. Only show it when LarePass is not connected:

```vue
<!-- Conditional rendering in the vault lock screen -->
<template>
  <div v-if="!larepassConnected" class="vault-fallback">
    <p>LarePass is not connected.</p>
    <Button variant="secondary" @click="showMnemonicUnlock = true">
      Unlock with recovery phrase
    </Button>
    <MnemonicVaultUnlockDialog v-if="showMnemonicUnlock" @unlock="onMnemonicUnlock" />
  </div>
</template>
```

### Security Notes

- The mnemonic fallback bypasses the hardware-backed key protection that LarePass provides. Always show a security warning when this path is used.
- Never store the mnemonic in `localStorage`, `sessionStorage`, or any persistent browser store.
- Zeroize the mnemonic string in JavaScript after the vault key is derived (note: JS garbage collection makes this best-effort, not guaranteed).
- The FIDO2 PRF path is preferred over the mnemonic path for regular use. Document this clearly.

---

## Shared: Auth Method Configuration Flag

Add a server-side configuration that controls which authentication methods are enabled. This allows deployment-specific security policies.

### Configuration Schema

```yaml
# /etc/olares/auth-config.yaml
auth:
  methods:
    larepass_ssi:
      enabled: true
      required: false  # If true, LarePass is enforced for all users
    totp_external:
      enabled: false   # Allow non-LarePass TOTP apps (Phase 1)
    browser_activation:
      enabled: false   # Browser-based initial setup (Phase 2)
    webauthn:
      enabled: false   # Passkeys and security keys (Phase 3)
    cli_activation:
      enabled: false   # Headless CLI activation (Phase 4)
    mnemonic_vault_unlock:
      enabled: false   # Vault unlock with recovery phrase (Phase 5)
```

### Reading the Config

```go
// framework/bfl/config/auth.go (new file)

type AuthConfig struct {
    Methods AuthMethods `yaml:"methods"`
}

type AuthMethods struct {
    LarepassSSI          AuthMethod `yaml:"larepass_ssi"`
    TOTPExternal         AuthMethod `yaml:"totp_external"`
    BrowserActivation    AuthMethod `yaml:"browser_activation"`
    WebAuthn             AuthMethod `yaml:"webauthn"`
    CLIActivation        AuthMethod `yaml:"cli_activation"`
    MnemonicVaultUnlock  AuthMethod `yaml:"mnemonic_vault_unlock"`
}

type AuthMethod struct {
    Enabled  bool `yaml:"enabled"`
    Required bool `yaml:"required"`
}

func (a *AuthMethods) IsMethodAllowed(method string) bool {
    switch method {
    case "larepass_ssi":
        return a.LarepassSSI.Enabled
    case "totp_external":
        return a.TOTPExternal.Enabled
    // ...
    default:
        return false
    }
}
```

---

## Testing Strategy

### Unit Tests

For each new auth path, add unit tests covering:

- Happy path: valid credentials produce a valid session token.
- Invalid credentials: error message is clear and does not leak secrets.
- Expired credentials: correct error and re-authentication prompt.
- Configuration flag off: method returns `ErrMethodNotEnabled`.

### Integration Tests

The `apps/packages/mockbfl/` mock backend is ideal for integration testing. Extend it to simulate each new endpoint:

```typescript
// apps/packages/mockbfl/src/controllers/auth-controllers.ts

router.post('/bfl/auth/v1/webauthn/register/begin', (req, res) => {
  res.json(mockWebAuthnRegistrationOptions(req.body.did));
});

router.post('/bfl/auth/v1/webauthn/register/finish', (req, res) => {
  res.json({ status: 'ok', authenticator_id: 'mock-webauthn-id' });
});
```

### End-to-End Tests

For each phase, add an E2E test scenario that simulates a user activating and logging in without LarePass. Use a headless browser (Playwright or Cypress) and the mock BFL backend.

---

## Summary of Code Change Locations

| Phase | Key file(s) | Change type |
|-------|------------|-------------|
| 1 | `QRCodeLogin.vue`, BFL authenticator endpoint | Small UI + small backend |
| 2 | `BindTerminusBusiness.ts` (×3 call sites), `BrowserActivatePage.vue` (new), BFL `/activate` | Medium frontend + medium backend |
| 3 | `auth.ts`, Settings UI, BFL WebAuthn endpoints | Medium frontend + medium backend |
| 4 | `cli/cmd/activate.go` (new), BFL `/activate` | New CLI module |
| 5 | `larepassVaultWebsocket.ts`, `vaultKeyDerivation.ts` (new), BFL vault endpoint | Complex frontend + small backend |
