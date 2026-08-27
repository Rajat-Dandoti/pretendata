# Column Reference — Rules, Algorithms & Patterns

The generator is **schema-driven**: [`src/data/schema.ts`](src/data/schema.ts) is the single
source of truth. Every column declares a `category`, a `generate()` function, and (via
`COLUMN_DLP_META`) an optional `region` and `validation` contract. Checksum logic lives in
[`src/lib/validators.ts`](src/lib/validators.ts) and is exercised by `npm test`.

This document mirrors that schema. If code and doc disagree, **the code wins** — update this file.

---

## Categories

Category = DLP sensitivity class. It drives the chip colour and how a detector *should* treat
the value. Ordered loudest → quietest.

| Category | Chip | What it means | Detector expectation |
|---|---|---|---|
| **Secrets** | fuchsia | Leaked credentials / keys | Highest-severity hit; secret scanners must fire |
| **PII** | red | Directly identifies a person | Must detect |
| **PHI** | rose | Health data (HIPAA) | Must detect |
| **PCI** | amber | Payment-card / bank data | Must detect |
| **Biometric** | indigo | GDPR Art.9 / CCPA special category | Must detect |
| **Network** | cyan | Log/telemetry identifiers | Context-dependent; log-DLP territory |
| **Quasi-Identifier** | orange | Re-identifies in combination (zip+dob+gender) | Flag in aggregate |
| **Statistical** | blue | Realistic distributions, not identifiers | Should NOT fire |
| **Masked** | purple | Already redacted/tokenized | Should NOT fire (verify masking held) |
| **Non-Sensitive** | green | Neutral business IDs | Should NOT fire |
| **DLP-Negative** | slate | Regex-shaped but checksum **deliberately broken** | Should NOT fire — measures false positives |

---

## Validation contract (`ValidationKind`)

Emitted into the export **manifest sidecar** so a test harness knows what guarantee each value holds.

| Kind | Meaning |
|---|---|
| `free-form` | No shape contract (names, lorem, job titles). Default when unset. |
| `pattern-only` | Regex-shaped, **no checksum** (email, IP, PAN format, API keys). |
| `luhn` | Luhn mod-10 (credit card, IMEI). |
| `verhoeff` | Verhoeff (Aadhaar). |
| `mod-97` | ISO 7064 mod-97-10 (IBAN). |
| `mod-36` | GSTIN base-36 weighted. |
| `mod-11` | NHS number. |
| `mod-10` | EAN-13, ISIN (Luhn variant). |
| `vin-checksum` | VIN transliteration mod-11. |
| `npi-luhn` | Luhn over an `80840`-prefixed body. |
| `near-miss-of:<id>` | Regex-shaped sibling of `<id>` whose checksum is broken. |

---

## PII

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| First / Last Name | `firstName` `lastName` | locale | free-form | Faker person, locale-aware |
| Email | `email` | — | pattern-only | Faker, derived from first/last name |
| Phone (mobile) | `phone` | locale | pattern-only | Real mobile prefixes per locale, random local format. IN: 10 digits starting 6–9 as `+91 98765 43210` / `+91…` / `91…` / `098765 43210` / bare. US: NANPA `(NXX) NXX-XXXX`. DE 015x/016x/017x · ES 6xx/7xx · FR 06/07 · JP 070/080/090 |
| SSN | `ssn` | US | pattern-only | `AAA-GG-SSSS`; area ≠ 000/666/900-999, group ≠ 00, serial ≠ 0000 |
| Aadhaar | `aadhaar` | IN | **verhoeff** | 12 digits, first 2–9, Verhoeff check digit |
| PAN | `pan` | IN | pattern-only | `AAAAA9999A`; 4th char = entity type, 5th = surname initial |
| EIN | `ein` | US | pattern-only | `NN-NNNNNNN`; prefix from valid IRS campus list |
| Driver's Licence (IN) | `dlIndia` | IN | pattern-only | `SS## YYYYNNNNNNN` (state + RTO + year + serial) |
| Driver's Licence (US) | `dlUS` | US | pattern-only | `A#######` (CA format) |
| Driver's Licence (UK) | `dlUK` | UK | pattern-only | 16 chars: `AAAAA NNNNNN AA N AA` (DVLA shape) |
| Driver's Licence (DE) | `dlGermany` | DE | pattern-only | 11 alphanumeric |
| Passport Number | `passportNumber` | — | pattern-only | 9 alphanumeric, upper |
| Driver's License (generic) | `driversLicense` | — | pattern-only | 8 alphanumeric, upper |
| IP Address | `ipAddress` | — | pattern-only | Faker IPv4 |
| MAC Address | `macAddress` | — | pattern-only | Faker MAC |

## PHI

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| MRN | `mrn` | — | pattern-only | `MRN-#######` |
| Health Insurance ID | `healthInsuranceId` | — | pattern-only | 3 alpha + 8 digits |
| Blood Type | `bloodType` | — | free-form | Enum (A+, AB-, O+, …) |
| ICD-10 Code | `diagnosisCode` | — | pattern-only | `A##.#` |
| Medical Notes | `medicalNotes` | — | free-form | Faker sentence |
| NPI | `npi` | US | **npi-luhn** | 10 digits; Luhn valid over `80840`+body; body starts 1/2 |
| DEA Number | `dea` | US | pattern-only | 2 letters + 7 digits; check = `(d1+d3+d5) + 2·(d2+d4+d6)` mod 10 |
| NHS Number | `nhsNumber` | UK | **mod-11** | 9 digits + mod-11 check (weights 10..2); regenerate if check == 10 |

## PCI

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| Credit Card | `creditCard` | — | luhn | Faker (Luhn-valid) |
| CVV | `cvv` | — | pattern-only | Faker 3-digit |
| Routing Number | `routingNumber` | US | pattern-only | Faker ABA |
| Account Number | `accountNumber` | — | pattern-only | Faker 10-digit |
| IBAN | `iban` | INTL | **mod-97** | Country + 2 check digits + BBAN; `98 − mod97(bban+country+00)` |

## Secrets / Credentials

What secret scanners (Gitleaks, TruffleHog, GitHub scanning) hunt. All `pattern-only` — vendor
prefix/shape is the signature; none carry a checksum we validate.

| Column | ID | Validation | Shape |
|---|---|---|---|
| AWS Access Key ID | `awsAccessKey` | pattern-only | `AKIA` + 16 upper alphanumeric |
| AWS Secret Access Key | `awsSecretKey` | pattern-only | 40 alphanumeric |
| GitHub Token | `githubPAT` | pattern-only | `ghp_` + 36 alphanumeric |
| Stripe Secret Key | `stripeKey` | pattern-only | `sk_live_` + 24 alphanumeric |
| Google API Key | `googleApiKey` | pattern-only | `AIza` + 35 alphanumeric |
| JWT | `jwt` | pattern-only | `eyJ…` three base64ish segments joined by `.` |
| Bcrypt Password Hash | `bcryptHash` | pattern-only | `$2b$10$` + 53 alphanumeric |
| PEM Private Key | `privateKeyPem` | pattern-only | `-----BEGIN RSA PRIVATE KEY-----` block, 2 body lines |
| Basic-Auth URL | `basicAuthUrl` | pattern-only | `https://user:pass@host` |

## Biometric

GDPR Art.9 / CCPA special category. Real systems store **opaque templates/vectors**, never raw scans.

| Column | ID | Validation | Shape |
|---|---|---|---|
| Fingerprint Template | `fingerprintHash` | pattern-only | 64-char lowercase hex |
| Face Embedding ID | `faceEmbeddingId` | pattern-only | `FACE-` + UUID |
| Voiceprint ID | `voiceprintId` | pattern-only | `VOICE-` + UUID |
| Iris Scan ID | `irisScanId` | pattern-only | `IRIS-` + 24 upper alphanumeric |

## Network / Telemetry

Log-DLP territory beyond the endpoint. Extends the PII IPv4/MAC coverage.

| Column | ID | Validation | Shape |
|---|---|---|---|
| IPv6 Address | `ipv6Address` | pattern-only | Faker IPv6 |
| User Agent | `userAgent` | free-form | Faker UA string |
| Session Cookie | `sessionCookie` | pattern-only | `sid=` + 40-char hex |
| Internal Hostname | `internalHostname` | free-form | `word-NN.internal.corp` |
| CIDR Block | `cidrBlock` | pattern-only | `IPv4/8–30` |
| Geo Coordinates | `geoCoordinates` | free-form | `lat, lng` |

## Quasi-Identifier

Individually low-risk; re-identify in combination.

| Column | ID | Region | Validation | Notes |
|---|---|---|---|---|
| Zip Code | `zipCode` | locale | free-form | Faker |
| Date of Birth | `dob` | — | free-form | ISO date; **row-consistent** with Age |
| Gender / Ethnicity | `gender` `ethnicity` | — | free-form | Enum |
| City | `city` | locale | free-form | Faker |
| Job Title / Dept | `jobTitle` `department` | — | free-form | Faker |
| Major / University | `major` `university` | — | free-form | Faker job-area / `University of <state>` |
| GSTIN | `gstin` | IN | **mod-36** | State + PAN + entity + `Z` + base-36 check |
| VIN | `vin` | — | **vin-checksum** | Faker (checksum-valid) |
| IMEI | `imei` | — | **luhn** | 14 digits + Luhn check |

## Statistical

Gaussian-distributed realistic values via `generateGaussianInt/Float(min, max, skew)` — not identifiers, should not trip DLP.

| Column | ID | Range (skew) |
|---|---|---|
| Salary | `salary` | 30k–200k (1.5) |
| Age | `age` | row-consistent with DOB |
| Purchase Count | `purchaseCount` | 0–500 (1.2) |
| Account Balance | `accountBalance` | 0–50k (1.3) |
| Credit Score | `creditScore` | 300–850 (0.9) |
| GPA | `gpa` | 2.0–4.0 (1.1) |
| Performance Score | `performanceScore` | 1.0–5.0 |
| Loan Amount | `loanAmount` | 1k–500k (1.4) |

## Masked

Already-redacted values — verify masking survives the pipeline (should NOT fire).

| Column | ID | Shape |
|---|---|---|
| Masked Email | `maskedEmail` | `f***@domain` |
| Hashed User ID | `hashedId` | UUID |
| Last 4 SSN | `last4SSN` | 4 digits |
| Tokenized Card | `tokenizedCard` | `****-****-****-####` |
| Masked Account | `maskedAccount` | `******####` |

## Non-Sensitive

Neutral business identifiers.

| Column | ID | Validation | Shape |
|---|---|---|---|
| Order / Device / State / dates | various | free-form | Faker |
| Employee / Student / CRM ID | `employeeId` `studentId` `crmId` | free-form | `EMP-#####` / digits / `CUST-######` |
| EAN-13 Barcode | `ean13` | **mod-10** | 12 digits + weighted mod-10 check |
| ISIN | `isin` | **mod-10** | Country + 9 alnum + Luhn on digit-expanded form |

## DLP-Negative (Near-Miss)

Regex-shaped but the **check digit is deliberately broken** by `breakChecksum()` — a well-behaved
detector must NOT fire. These measure false-positive rates. Validation = `near-miss-of:<originId>`.

`breakChecksum()` mutates the last alphanumeric char (`+1 mod 10` for digits, `X→0` for VIN,
`+1 mod 26` for letters). Every checksum here weights the last char, so one bump always invalidates it.

| Column | ID | Origin |
|---|---|---|
| Aadhaar (near-miss) | `aadhaar_invalid` | `aadhaar` |
| Credit Card (near-miss) | `creditCard_invalid` | `creditCard` |
| IBAN (near-miss) | `iban_invalid` | `iban` |
| NPI (near-miss) | `npi_invalid` | `npi` |
| NHS (near-miss) | `nhsNumber_invalid` | `nhsNumber` |
| GSTIN (near-miss) | `gstin_invalid` | `gstin` |
| VIN (near-miss) | `vin_invalid` | `vin` |
| IMEI (near-miss) | `imei_invalid` | `imei` |
| EAN-13 (near-miss) | `ean13_invalid` | `ean13` |
| ISIN (near-miss) | `isin_invalid` | `isin` |

---

## Presets

Named column bundles in `PRESETS` (schema.ts). Two families:

**Scenario** — HR / Employees, CRM / Customers, Healthcare / Patients, Education / Students,
Technical / IT.

**DLP-focused** —
- `DLP Detection Test` — one of every checksum-valid identifier; everything should fire.
- `DLP False-Positive Test` — the near-miss siblings; nothing should fire.
- `Secrets Leak Test` — all Secrets columns.
- `App Telemetry` — Network + device/login fields.
- `Biometric / Special-Category` — the four biometric templates + basic PII.

**Region-focused** — India PII, US Healthcare, EU GDPR.

---

## Adding a column (the whole checklist)

1. Add one `ColumnDef` to `AVAILABLE_COLUMNS` in `schema.ts` (`id`, `name`, `category`, `generate`, `defaultSelected`).
2. If it's region-specific or checksum-bearing, add a `COLUMN_DLP_META[id]` entry (`region`, `validation`).
3. New checksum? Add the generator + validator to `validators.ts` and an assert to its `_selfCheck()`.
4. New category? Add it to the `PrivacyCategory` union **and** `CATEGORY_COLORS` — the UI, exports,
   and manifest all read generically, so nothing else changes.
5. `npm run lint && npm test`.
