# Yelp — Authentication Perimeter Bypass (research archive)

Private archive of a security-research session against `https://www.yelp.com` (HackerOne program),
conducted 2026-11-18 → 2026-11-19 on production endpoints with researcher-owned test accounts only.

**Final severity reached: Critical 9.1** — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`

> ⚠️ **This repository contains sensitive material.**
> Proxy credentials, the Capsolver API key and account identifiers were redacted with `<REDACTED>` placeholders
> before committing. Even so, the material describes a working attack against a live production service — keep this
> repository **private** and do not republish it outside the disclosure process.

---

## What was found

| # | Weakness | Class | Contribution |
|---|---|---|---|
| 1 | DataDome rules match **literal paths** (`/login`), not normalized routes | Anti-bot bypass | Enables everything below |
| 2 | `/signup` is **entirely outside** DataDome; hCaptcha on signup is risk-scored per IP, not mandatory | Mass account creation | High |
| 3 | `/login/newajax` has **no rate limit**; invisible hCaptcha **auto-solves** in a real Chrome | Credential stuffing → ATO | Critical |

Net result: a fully automated, zero-interaction, zero-captcha-cost pipeline that
(a) creates unlimited authenticated accounts and
(b) performs unlimited credential validation against the login endpoint, reaching a full authenticated session when the password is correct.

## Verified numbers

| Metric | Result |
|---|---|
| Path-bypass probes | **3,250** requests, **0 × 403** on bypass routes |
| `GET /login` (literal) | **1,000 / 1,000 = 403** |
| `GET /login/` (bypass) | **1,000 / 1,000 = 200** |
| POST to auth endpoint | **120** — 0 × 429, 3 × 403 (2.5%), 117 × 200 |
| Credential validations | **113** (110/110 = 100% on the password path) |
| hCaptcha challenges shown | **0** |
| Captcha solving cost | **$0** |
| Full login with correct password | **1 / 1** — session issued, `/profile` = 200 |
| Signup without captcha | **5 / 5** from 5 distinct mobile IPs, session issued before email verification |

## Repository layout

| Path | Contents |
|---|---|
| `report/yelp-session-2026-11-19.md` | Full research report — timeline, evidence, retractions, CVSS reasoning, fix recommendations |
| `session/transcript-main-session.md` | Complete session transcript (243 messages, 201 tool calls) exported from the OpenCode store |
| `poc/` | The Node/CDP scripts used for the PoC (proxy credentials redacted) |
| `evidence/` | Per-request JSONL evidence captured via CDP `Network.getResponseBody` |

## PoC scripts

| File | Purpose |
|---|---|
| `poc/ajax_runner.js` | Main harness: launches Chrome through a local CONNECT relay → mobile proxy, hydrates `/login/`, submits credentials, binds each response body to its `requestId` |
| `poc/full_login.js` | Full end-to-end login with a correct password; asserts session issuance and/or `/profile` 200 |
| `poc/lockout.js` | 33 consecutive failed attempts then a valid login — used to disprove account-lockout DoS (A:H) |
| `poc/headful.js` | Retrieves a genuinely validated `datadome` cookie from a headful Chrome session |
| `poc/auto_login.js`, `poc/seq2.js` | Early single-shot / sequential probes that first reached credential validation |
| `poc/shot.js` | Single-shot runner with hydration retry |

Requirements: Node ≥ 18, Chrome, and a live residential/mobile proxy (see the redaction note above).

## Evidence files

| File | Contents |
|---|---|
| `evidence/ajax_0.jsonl` | 41 POSTs, 37 credential validations |
| `evidence/new1.jsonl`, `evidence/new2.jsonl` | 35 + 38 validations |
| `evidence/full.jsonl` | Full-login session evidence |
| `evidence/lock2.jsonl` | Lockout test (33 failures, no lock) |
| `evidence/cross.jsonl` | Cross-scope session replay (`business.yelp.com`, `terms.yelp.com`) |

## Honest limitations

1. 113 validations is a strong sample but not a controlled study: 3 of 120 POSTs hit DataDome (2.5%) and those sessions recovered without intervention.
2. 4 magic-link responses were client-side artifacts, not a bypass — documented, not hidden.
3. The hCaptcha token is single-use, so throughput is bounded by one page-load per attempt (~10–15 s); 100-browser figures are extrapolated.
4. **9.7 / 9.8 were explicitly tested and disproven** — no account lockout exists (A:N) and the consumer session is not accepted by `business.yelp.com` or `terms.yelp.com` (S:U). Do not claim them.
5. If the program argues "credential stuffing requires leaked credentials", the score can be argued down to 8.2–8.8.

## Test accounts created (for cleanup)

```
qa.probe1.8339@example.com   qa.probe2.8495@example.com
qa.probe3.9761@example.com   qa.probe4.1997@example.com
qa.probe7.5657@example.com   qa.probe8.3586@example.com
qa.probe9.7921@example.com   qa.probe10.4541@example.com
```

All `@example.com` (null MX, unverified). No reviews posted, no interaction with real users.

## Disclosure status

Not yet submitted. Intended target: `hackerone.com/yelp`.
Recommended submission: **one** combined Critical 9.1 report (signup + login share the same root cause).
