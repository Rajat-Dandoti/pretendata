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
| **Chaos** | yellow | Deliberately malformed / hostile values | Should NOT fire — stresses parsers, CSV escaping and the engine itself |

---

## Expectation

What a detector should do with a column. It is what the scorecard grades against, and it is written
to the answer key for every column.

| Expectation | Meaning | Scored as |
|---|---|---|
| `detect` (should fire) | Sensitive; a detector should flag it | Correct, flagged generically, or missed |
| `ignore` (should not fire) | Benign, or shaped like an identifier but deliberately not one | Quiet, soft flag, or false positive |
| `context` (depends on context) | Sensitive only in combination or by policy | Reported, never scored |

It follows from the category: PII, PHI, PCI, Secrets and Biometric are `detect`; Network and
Quasi-Identifier are `context`; the rest are `ignore`. A few columns are overridden in
`EXPECTATION_OVERRIDES` in `schema.ts`:

- `detect`: `gstin`, `vin`, `imei`, `vehicleRegIndia` (registered identifiers filed under
  Quasi-Identifier), `ipv6Address`, `sessionCookie`.
- `context`: `employeeId`, `studentId`, `crmId` (assigned to one person, meaningless elsewhere), `age`,
  `cardExpiry` (an expiry date alone identifies no card).

---

## Validation contract (`ValidationKind`)

Emitted into the **answer key** so a test harness knows what guarantee each value holds.

| Kind | Meaning |
|---|---|
| `free-form` | No shape contract (names, lorem, job titles). Default when unset. |
| `pattern-only` | Regex-shaped, **no checksum** (email, IP, PAN format, API keys). |
| `luhn` | Luhn mod-10 (credit card, IMEI, Iqama, SIN, South Africa ID, Emirates ID). |
| `verhoeff` | Verhoeff (Aadhaar). |
| `mod-97` | Mod-97 (IBAN, France NIR). |
| `mod-36` | GSTIN base-36 weighted. |
| `mod-11` | Weighted mod-11: NHS number, CPF, CNPJ, BSN, NRIC, TFN, China resident ID. |
| `mod-23` | Check letter from the number mod 23: Spain DNI and NIE. |
| `mod-10` | EAN-13, ISIN (Luhn variant). |
| `vin-checksum` | VIN transliteration mod-11. |
| `npi-luhn` | Luhn over an `80840`-prefixed body. |
| `near-miss-of:<id>` | Regex-shaped sibling of `<id>` whose checksum is broken. |
| `chaos` | Intentionally malformed / hostile; no shape contract by design. |

---

## PII

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| First / Last Name | `firstName` `lastName` | locale | free-form | Faker person, locale-aware; first name comes from the list for the row's Gender |
| Email | `email` | — | pattern-only | Faker, derived from first/last name |
| Phone (mobile) | `phone` | locale | pattern-only | Real mobile prefixes per locale, random local format. IN: 10 digits starting 6–9 as `+91 98765 43210` / `+91…` / `91…` / `098765 43210` / bare. US: NANPA `(NXX) NXX-XXXX`. DE 015x/016x/017x · ES 6xx/7xx · FR 06/07 · JP 070/080/090 |
| SSN | `ssn` | US | pattern-only | `AAA-GG-SSSS`; area ≠ 000/666/900-999, group ≠ 00, serial ≠ 0000 |
| Aadhaar | `aadhaar` | IN | **verhoeff** | 12 digits, first 2–9, Verhoeff check digit |
| PAN | `pan` | IN | pattern-only | `AAAAA9999A`; 4th char = entity type, 5th = surname initial |
| EIN | `ein` | US | pattern-only | `NN-NNNNNNN`; prefix from valid IRS campus list |
| UPI ID | `upiId` | IN | pattern-only | `local@handle`; local = 10-digit mobile or a username, handle from real PSP list (`ybl`, `oksbi`, `paytm`, …) |
| Voter ID (EPIC) | `voterId` | IN | pattern-only | 3 letters + 7 digits |
| Iqama | `iqama` | SA | **luhn** | 10 digits, prefix `2` (resident), Luhn check digit |
| Driver's Licence (IN) | `dlIndia` | IN | pattern-only | `SS## YYYYNNNNNNN` (state + RTO + year + serial) |
| Driver's Licence (US) | `dlUS` | US | pattern-only | `A#######` (CA format) |
| Driver's Licence (UK) | `dlUK` | UK | pattern-only | 16 chars: `AAAAA NNNNNN AA N AA` (DVLA shape) |
| Driver's Licence (DE) | `dlGermany` | DE | pattern-only | 11 alphanumeric |
| Passport Number | `passportNumber` | — | pattern-only | 9 alphanumeric, upper |
| Driver's License (generic) | `driversLicense` | — | pattern-only | 8 alphanumeric, upper |
| IP Address | `ipAddress` | — | pattern-only | Faker IPv4 |
| MAC Address | `macAddress` | — | pattern-only | Faker MAC |

### National identifiers by region

Each checksum below has a validator in `VALIDATORS` and a published example value in the self-check.
Where the number encodes a birth date or sex, it is the row's own, so it agrees with the Date of Birth
and Gender columns.

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| ITIN | `usItin` | US | pattern-only | `9NN-GG-NNNN`; group from the IRS ranges 50–65, 70–88, 90–92, 94–99 |
| SIN | `canadaSin` | CA | **luhn** | 9 digits written `NNN NNN NNN`, Luhn; first digit never 0 or 8 |
| CPF | `brazilCpf` | BR | **mod-11** | `NNN.NNN.NNN-DD`; two mod-11 check digits |
| CNPJ | `brazilCnpj` | BR | **mod-11** | `NN.NNN.NNN/0001-DD`; two mod-11 check digits over weights 6…2, 9…2 |
| National Insurance No | `ukNino` | UK | pattern-only | Two letters, six digits, suffix A–D, under HMRC's prefix exclusions; no check digit |
| DNI | `spainDni` | ES | **mod-23** | 8 digits + letter `TRWAGMYFPDXBNJZSQVHLCKE`[number mod 23] |
| NIE | `spainNie` | ES | **mod-23** | `X`/`Y`/`Z` (standing for 0/1/2) + 7 digits + the same check letter |
| BSN | `netherlandsBsn` | NL | **mod-11** | 9 digits passing the "11-proef" (weights 9…2, −1) |
| NIR | `franceNir` | FR | **mod-97** | Sex, birth year and month, department, commune, order, then key = 97 − (number mod 97). Corsica (2A/2B) not generated |
| NRIC | `singaporeNric` | SG | **mod-11** | `S` (born before 2000) or `T` + 7 digits + check letter from weights 2,7,6,5,4,3,2 |
| TFN | `australiaTfn` | AU | **mod-11** | 9 digits; weighted sum (1,4,3,7,5,8,6,9,10) divisible by 11 |
| Resident ID | `chinaResidentId` | CN | **mod-11** | 6-digit region, birth date, 3-digit order (odd = male), ISO 7064 MOD 11-2 check (may be `X`) |
| ID Number | `southAfricaId` | ZA | **luhn** | Birth date `YYMMDD`, 4-digit sequence (5000+ = male), citizenship digit, `8`, Luhn check |
| Emirates ID | `uaeEmiratesId` | AE | **luhn** | `784-YYYY-NNNNNNN-C`; Luhn over all fifteen digits |
| Passport | `indiaPassport` | IN | pattern-only | One letter + 7 digits |
| UAN | `uan` | IN | pattern-only | 12 digits starting `10` (provident-fund account number) |

## PHI

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| MRN | `mrn` | — | pattern-only | `MRN-#######` |
| Health Insurance ID | `healthInsuranceId` | — | pattern-only | 3 alpha + 8 digits |
| Blood Type | `bloodType` | — | free-form | Enum (A+, AB-, O+, …) |
| ICD-10 Code | `diagnosisCode` | — | pattern-only | One of 30 real ICD-10-CM codes (`E11.9`, `I10`, `J45.909` …) |
| Medical Notes | `medicalNotes` | — | free-form | One of 20 clinical sentences (conditions, results, medication); health content, no identifiers |
| NPI | `npi` | US | **npi-luhn** | 10 digits; Luhn valid over `80840`+body; body starts 1/2 |
| DEA Number | `dea` | US | pattern-only | 2 letters + 7 digits; check = `(d1+d3+d5) + 2·(d2+d4+d6)` mod 10 |
| NHS Number | `nhsNumber` | UK | **mod-11** | 9 digits + mod-11 check (weights 10..2), written `NNN NNN NNNN`; regenerate if check == 10 |
| ABHA Health ID | `abha` | IN | pattern-only | 14 digits (checksum unconfirmed, so none claimed) |
| Medication | `medication` | — | free-form | A common drug with its dose, e.g. `metformin 500 mg` |
| Lab Result | `labResult` | — | free-form | A test with a value in range, e.g. `HbA1c 7.2%`, `eGFR 48 mL/min` |

## PCI

| Column | ID | Region | Validation | Shape / Algorithm |
|---|---|---|---|---|
| Credit Card | `creditCard` | — | luhn | Faker (Luhn-valid); 13 bare digits or dashed `4-4-4-4` / `4-6-4` / `4-6-5` groups |
| CVV | `cvv` | — | pattern-only | Faker 3-digit |
| Routing Number | `routingNumber` | US | pattern-only | Faker ABA |
| Account Number | `accountNumber` | — | pattern-only | Faker 10-digit |
| IBAN | `iban` | INTL | **mod-97** | Country + 2 check digits + BBAN; `98 − mod97(bban+country+00)`. Registry length and layout per country: DE 22, FR 27, ES 24 (digits); GB 22 and NL 18 (4-letter bank code + digits); IT 27 (CIN letter + digits). National check digits inside the BBAN are not computed |
| IFSC Code | `ifsc` | IN | pattern-only | A real bank code (`SBIN`, `HDFC`, `ICIC` …) + `0` + 6 digits |
| Card Expiry | `cardExpiry` | — | pattern-only | `MM/YY`, within five years of the reference date |

## Secrets / Credentials

What secret scanners (Gitleaks, TruffleHog, GitHub scanning) hunt. All `pattern-only` — vendor
prefix/shape is the signature; none carry a checksum we validate.

| Column | ID | Validation | Shape |
|---|---|---|---|
| AWS Access Key ID | `awsAccessKey` | pattern-only | `AKIA` + 16 base32 chars (`A–Z`, `2–7`) |
| AWS Secret Access Key | `awsSecretKey` | pattern-only | 40 alphanumeric |
| GitHub Token | `githubPAT` | pattern-only | `ghp_` + 36 alphanumeric |
| Stripe Secret Key | `stripeKey` | pattern-only | `sk_live_` + 24 alphanumeric |
| Google API Key | `googleApiKey` | pattern-only | `AIza` + 35 alphanumeric |
| JWT | `jwt` | pattern-only | base64url JSON header (`HS256`) `.` base64url JSON payload (`sub`, `iat`, `exp`) `.` 43-char random signature — decodes, never verifies |
| Bcrypt Password Hash | `bcryptHash` | pattern-only | `$2b$10$` + 53 alphanumeric |
| PEM Private Key | `privateKeyPem` | pattern-only | `-----BEGIN RSA PRIVATE KEY-----` block, 2 body lines |
| Basic-Auth URL | `basicAuthUrl` | pattern-only | `https://user:pass@host` |
| Slack Bot Token | `slackBotToken` | pattern-only | `xoxb-` + 12 digits `-` 13 digits `-` 24 alphanumeric |
| OpenAI API Key | `openaiKey` | pattern-only | `sk-proj-` + 74 chars + `T3BlbkFJ` + 74 chars |
| Anthropic API Key | `anthropicKey` | pattern-only | `sk-ant-api03-` + 93 chars + `AA` |
| npm Access Token | `npmToken` | pattern-only | `npm_` + 36 alphanumeric |
| SendGrid API Key | `sendgridKey` | pattern-only | `SG.` + 22 chars `.` 43 chars |
| Twilio API Key SID | `twilioKey` | pattern-only | `SK` + 32 lowercase hex |
| Azure Storage Key | `azureStorageKey` | pattern-only | 86 base64 chars + `==` |
| Database Connection String | `dbConnectionString` | pattern-only | `postgres://user:password@host:5432/db` |
| OpenSSH Private Key | `sshPrivateKey` | pattern-only | `-----BEGIN OPENSSH PRIVATE KEY-----` block, 3 body lines |
| GCP Service Account Key | `gcpServiceAccount` | pattern-only | The JSON key file as one string: `type`, `project_id`, `private_key`, `client_email` |

The ten from Slack down follow each vendor's prefix and length as commonly documented in 2025. They
have not been run against a live scanner here, and vendors change formats.

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
| Session Cookie | `sessionCookie` | pattern-only | `sid=` + 40-char lowercase hex |
| Internal Hostname | `internalHostname` | free-form | `word-NN.internal.corp` |
| CIDR Block | `cidrBlock` | pattern-only | `IPv4/8–30` |
| Geo Coordinates | `geoCoordinates` | free-form | `lat, lng` |

## Quasi-Identifier

Individually low-risk; re-identify in combination.

| Column | ID | Region | Validation | Notes |
|---|---|---|---|---|
| Zip Code | `zipCode` | locale | free-form | Faker |
| Date of Birth | `dob` | — | free-form | ISO date; **row-consistent** with Age |
| Gender / Ethnicity | `gender` `ethnicity` | — | free-form | Enum; Gender is **row-consistent** with First Name and labelled in the row's locale |
| Religion / Political Opinion / Trade Union Membership | `religion` `politicalOpinion` `unionMembership` | — | free-form | Enums. GDPR Art.9 special categories that are plain words: sensitive by meaning, not shape |
| City | `city` | locale | free-form | Faker |
| Job Title / Dept | `jobTitle` `department` | — | free-form | Faker |
| Major / University | `major` `university` | — | free-form | Faker job-area / `University of <state>` |
| GSTIN | `gstin` | IN | **mod-36** | State + PAN + entity + `Z` + base-36 check |
| VIN | `vin` | — | **vin-checksum** | Faker shape; position-9 check digit computed (transliterate, weight, mod 11, 10 → `X`) |
| IMEI | `imei` | — | **luhn** | 14 digits + Luhn check |
| Vehicle Reg | `vehicleRegIndia` | IN | pattern-only | State + 2-digit RTO + 1–2 letters + 4 digits, e.g. `MH12AB1234` |

## Statistical

Gaussian-distributed realistic values via `generateGaussianInt/Float(min, max, skew)` — not identifiers, should not trip DLP.

| Column | ID | Range (skew) |
|---|---|---|
| Salary | `salary` | 30k–200k (1.5) |
| Age | `age` | 18–80, completed years as of the reference date (today, or 2026-01-01 UTC under a seed); row-consistent with DOB |
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
| Masked Aadhaar | `maskedAadhaar` | `XXXX XXXX ####`, as UIDAI prints it |

## Non-Sensitive

Neutral business identifiers.

| Column | ID | Validation | Shape |
|---|---|---|---|
| Transaction ID | `transactionId` | free-form | 10 upper alphanumeric |
| Created At / Last Login | `createdAt` `lastLogin` | free-form | ISO timestamp within the last 30 / 5 days of the reference date |
| Hire Date / Graduation Year | `hireDate` `graduationYear` | free-form | ISO date in the past 10 years / year in the next 4 |
| Device Type / Subscription Tier | `deviceType` `subscriptionTier` | free-form | Enum |
| Store Location | `storeLocation` | free-form | Faker US state |
| Employee / Student / CRM ID | `employeeId` `studentId` `crmId` | free-form | `EMP-#####` / digits / `CUST-######` |
| EAN-13 Barcode | `ean13` | **mod-10** | 12 digits + weighted mod-10 check |
| ISIN | `isin` | **mod-10** | Country + 9 alnum + Luhn on digit-expanded form |
| SWIFT / BIC | `swiftBic` | pattern-only | 4-letter bank + country + 2 alphanumeric + optional 3-character branch; identifies a bank, not a person |

## DLP-Negative (Near-Miss)

Regex-shaped but the **check digit is deliberately broken** by `breakChecksum()` — a well-behaved
detector must NOT fire. These measure false-positive rates. Validation = `near-miss-of:<originId>`.

`breakChecksum()` mutates the last alphanumeric char (`+1 mod 10` for digits, `X→0` for VIN,
`+1 mod 26` for letters). Every checksum here weights the last char, so one bump always invalidates it.
Each near-miss starts from a **valid** value of its origin (the credit card from a Luhn-valid Faker
card, in the same dashed/plain shapes) — bumping a random number would leave ~10% valid by chance.

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
| Iqama (near-miss) | `iqama_invalid` | `iqama` |
| Routing Number (near-miss) | `routingNumber_invalid` | `routingNumber` |
| DEA Number (near-miss) | `dea_invalid` | `dea` |
| SIN (near-miss) | `canadaSin_invalid` | `canadaSin` |
| CPF (near-miss) | `brazilCpf_invalid` | `brazilCpf` |
| DNI (near-miss) | `spainDni_invalid` | `spainDni` |
| BSN (near-miss) | `netherlandsBsn_invalid` | `netherlandsBsn` |
| NIR (near-miss) | `franceNir_invalid` | `franceNir` |
| NRIC (near-miss) | `singaporeNric_invalid` | `singaporeNric` |
| TFN (near-miss) | `australiaTfn_invalid` | `australiaTfn` |
| Resident ID (near-miss) | `chinaResidentId_invalid` | `chinaResidentId` |
| ZA ID (near-miss) | `southAfricaId_invalid` | `southAfricaId` |
| Emirates ID (near-miss) | `uaeEmiratesId_invalid` | `uaeEmiratesId` |

Three more are wrong in a different way than a bumped check digit:

| Column | ID | Origin | How it is wrong |
|---|---|---|---|
| SSN (never issued) | `ssn_invalid` | `ssn` | Area `000`, `666` or `900`–`999`, which are never assigned |
| Aadhaar (wrong prefix) | `aadhaar_prefix` | `aadhaar` | Correct Verhoeff digit, but starts with `0` or `1` |
| Credit Card (transposed) | `creditCard_transposed` | `creditCard` | Two neighbouring digits swapped — the typing error Luhn exists to catch |

**Negative for every detector.** Every DLP-Negative value is redrawn until it passes *no* validator,
not just its origin's. Without that, about one broken EAN-13 in ten passes the card check, and one
broken NPI in eleven is a valid NHS number. `npm test` checks it.

### Hard negatives

Ordinary business values that merely look like identifiers. A detector that fires on these is
matching digits, not meaning.

| Column | ID | Shape | Looks like |
|---|---|---|---|
| Epoch Timestamp (s) | `epochSeconds` | 10 digits | NPI, NHS number, phone |
| Epoch Timestamp (ms) | `epochMillis` | 13 digits | EAN-13, 13-digit card |
| Order Number | `orderNumber` | 12 digits, first 2–9 | Aadhaar |
| Tracking Number | `trackingNumber` | `1Z` + 16 upper alphanumeric | A licence or account ID |
| SKU Code | `skuCode` | `SKU-AA00-0000` | A reference number |

## Chaos (Malformed)

Intentionally hostile values picked from fixed pools (so they reproduce under a seed). They test the
pipeline — CSV escaping, encodings, parsers — and that a detector neither crashes nor fires on them.

| Column | ID | What it emits |
|---|---|---|
| Empty / Blank | `chaosEmpty` | Empty string, spaces, tab, newline |
| Unicode Stress | `chaosUnicode` | Emoji, RTL scripts, combining marks, zero-width chars, ZWJ sequences |
| SQL Injection | `chaosSqli` | Classic injection strings (`' OR '1'='1`, `'; DROP TABLE users;--`, …) |
| XSS / HTML Payload | `chaosXss` | Script/markup payloads, template and JNDI probes |
| Homoglyph | `chaosHomoglyph` | Brand-like words with Cyrillic look-alike letters |
| Oversized String | `chaosLong` | 512 × `A` |
| CSV Breaker | `chaosCsvBreak` | Embedded commas, quotes, newlines, tabs |
| Numeric Edge | `chaosNumeric` | `007`, `1e309`, `-0`, 30 nines, `0x1F`, `NaN`, … |

---

## Formatting variants

The *Identifier formatting* setting rewrites valid values without changing what they are, for the
columns that have a validator: `ssn`, `aadhaar`, `creditCard`, `iban`, `npi`, `nhsNumber`, `gstin`,
`vin`, `imei`, `iqama`, `dea`, `routingNumber`. The expectation stays "should fire".

| Level | Forms, drawn per row |
|---|---|
| Canonical | The one form documented above |
| Mixed | As is · regrouped with spaces · regrouped with dashes · bare · labelled (`SSN: …`, `Card=…`) |
| Evasive | The mixed forms half the time; otherwise full-width digits (`８３１-…`), a zero-width space every three characters, dots as separators, or base64 |

`canonicalForms()` in `src/lib/variants.ts` undoes every form, and `npm test` checks that each written
value still stands for a valid identifier.

---

## Text documents

The *Text* panel (and `POST /api/text`) writes prose instead of rows. Templates live in
[`src/data/templates.ts`](src/data/templates.ts); a `{{columnId}}` slot is filled with that column's
value, so every guarantee above carries over, including formatting variants.

| Pack | What it imitates |
|---|---|
| `email` | Business email bodies with personal and payment details |
| `ticket` | Support tickets where people paste card numbers, Aadhaar, session cookies |
| `chat` | Workplace chat with pasted credentials |
| `clinical` | Clinical notes mixing patient identifiers with health information |
| `log` | Application log lines leaking personal data and secrets |
| `prompt` | Prompts typed into AI assistants, with a few injection attempts; written as chat messages |

Output is NDJSON: `{ "pack", "text", "entities": [{ "start", "end", "type", "value", "expectation" }] }`.
Offsets count Unicode code points with the end exclusive, so `text[start:end]` in Python is the value.
In JavaScript use `[...text].slice(start, end).join('')`.

---

## Secrets fixture repository

*Text* panel → *Download zip*. Built by [`src/lib/fixtures.ts`](src/lib/fixtures.ts): three services
under `services/svc-NN/`, each with the same files and its own secrets.

| File | Planted secrets | Decoys that must not fire |
|---|---|---|
| `.env` | AWS key pair, Stripe key, basic-auth URL | `${GITHUB_TOKEN}`, `your-api-key-here`, `changeme` |
| `config/settings.yaml` | GitHub token, Google API key | `<REDACTED>`, a run of `x` |
| `src/client.js` | JWT | `process.env.API_KEY`, the AWS documentation example key |
| `deploy/id_rsa.pem` | PEM private key | — |
| `db/seed.sql` | bcrypt hash | `!` (a disabled password) |

`answer-key.json` lists every planted value with `file`, `line`, `type` and `expectation`. Every file
says in its first line that the secrets are fake; they are still shaped like real ones, so pushing the
fixture to a public repository can trigger a provider's secret-scanning alerts.

---

## Presets

Named column bundles in `PRESETS` (schema.ts). Two families:

**Scenario** — Common Users, HR / Employees, CRM / Customers, Bank / Fintech, Healthcare / Patients,
Education / Students, Technical / IT.

**DLP-focused** —
- `DLP Detection Test` — one of every checksum-valid identifier; everything should fire.
- `DLP False-Positive Test` — every near-miss and hard negative next to a name and an email; none of the controls should fire.
- `Secrets Leak Test` — all Secrets columns.
- `App Telemetry` — Network + device/login fields.
- `Biometric / Special-Category` — the four biometric templates + basic PII.
- `Chaos / Malformed` — every Chaos column next to a name and an email.

**Region-focused** — India PII, India Fintech, US Healthcare, EU GDPR Sweep (each also sets the locale), and
National IDs (World): one national identifier from each of thirteen countries.

---

## Adding a column (the whole checklist)

1. Add one `ColumnDef` to `AVAILABLE_COLUMNS` in `schema.ts` (`id`, `name`, `category`, `generate`, `defaultSelected`).
2. If it's region-specific or checksum-bearing, add a `COLUMN_DLP_META[id]` entry (`region`, `validation`).
3. New checksum? Add the generator to `validators.ts` and its validity function to `VALIDATORS`, with a
   known-good value from an official source in `KNOWN_GOOD`. A near-miss or other negative control goes
   through `negative()` so it is valid as nothing.
4. New category? Add it to the `PrivacyCategory` union, `CATEGORY_COLORS` **and**
   `CATEGORY_EXPECTATION` — the UI, exports and answer key all read generically, so nothing else changes.
   If the category's default expectation is wrong for the new column, add it to `EXPECTATION_OVERRIDES`.
5. Run `npm run pin-seed` to record the new column's seeded output. It refuses if an existing column's
   output changed; that is a break of the seed contract and needs a `GENERATOR_VERSION` bump.
6. Document it in this file — `npm test` fails if a column id or preset name is missing here, or if a
   Column Reference pattern does not match what its column emits.
7. `npm run lint && npm test`.
