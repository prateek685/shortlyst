# Shortlyst — Local Setup Guide

This guide is for developers: running Shortlyst on your own machine from a fresh clone.
To host it on a server, see **[DEPLOY.md](DEPLOY.md)**.

---

## 1. What you are setting up

Shortlyst has three parts:

| Part | What it does | Where it runs |
|---|---|---|
| **Backend** (NestJS API) | Talks to Jev, applies the scoring rules, stores results, runs the email background job | Your machine (`localhost:3000`) or a server |
| **Chrome extension** | Scans LinkedIn profiles, Options page (Roles, Candidates, Mailboxes, Sheet export) | Each user's Chrome |
| **Postgres database** | Roles, candidates, results, email job queue | Docker locally, or a managed database |

Plus these outside services:

| Service | Used for | Required? |
|---|---|---|
| **OpenRouter** | Access to the Jev model (`typesafe/jev-1.13`) | Yes |
| **Google Cloud** | Gmail sign-in (email feature) and Google Sheets sign-in (roles import / export) | Yes, for those features |
| **Langfuse** | Tracing and cost tracking of every Jev call | Recommended |

---

## 2. What you need installed

- **Node.js 20** (that's what the project is developed on) and npm
- **Docker Desktop** (for the local Postgres and Langfuse)
- **Google Chrome**
- **Git**

---

## 3. Get the code and install

```bash
git clone https://github.com/prateek685/shortlyst.git
cd shortlyst

npm install                 # backend
cd extension && npm install && cd ..   # Chrome extension
```

---

## 4. Start the database (Postgres)

```bash
docker compose up -d
```

This starts Postgres 18 on **port 5433** (database, user and password all default to `shortlyst`).
To change them, set `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` in `.env`
(next step) before running the command.

---

## 5. Start Langfuse (recommended)

Langfuse records every Jev call with its input, answers, tokens and cost.
Two options:

- **Langfuse Cloud** — sign up at https://cloud.langfuse.com, create a project, copy its keys.
- **Self-hosted (what we use)** — Langfuse **v2** in its own Docker setup, outside this repo, on
  **port 3001**. A minimal `docker-compose.yml` in a separate folder:

  ```yaml
  services:
    langfuse-server:
      image: langfuse/langfuse:2
      depends_on:
        db:
          condition: service_healthy
      ports:
        - "3001:3000"
      environment:
        - DATABASE_URL=postgresql://postgres:<db-password>@db:5432/postgres
        - NEXTAUTH_SECRET=<random-string>
        - SALT=<random-string>
        - ENCRYPTION_KEY=<64-hex-chars>      # openssl rand -hex 32
        - NEXTAUTH_URL=http://localhost:3001
        - TELEMETRY_ENABLED=false
    db:
      image: postgres:17
      restart: always
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U postgres"]
        interval: 3s
        timeout: 3s
        retries: 10
      environment:
        - POSTGRES_USER=postgres
        - POSTGRES_PASSWORD=<db-password>
        - POSTGRES_DB=postgres
      volumes:
        - langfuse_db_data:/var/lib/postgresql/data
  volumes:
    langfuse_db_data:
  ```

  Run `docker compose up -d` in that folder, open http://localhost:3001, sign up, create a
  project and copy its **public** and **secret** keys.

---

## 6. Get your keys

### 6.1 OpenRouter (Jev)
1. Sign up at https://openrouter.ai and add credit (Jev is very cheap — about **$0.0002 per
   classification**).
2. Create an API key → this is `OPENROUTER_API_KEY`.

### 6.2 Google Cloud
You need **one Google Cloud project** with **two OAuth clients**: one for Gmail (used by the
backend) and one for Google Sheets (used by the extension).

**a) Project and APIs**
1. Go to https://console.cloud.google.com → create a project (e.g. `shortlyst`).
2. *APIs & Services → Library* → enable **Gmail API**, **Google Sheets API** and **Google Drive API**.

**b) OAuth consent screen** (*Google Auth Platform → Branding / Audience*)
- If your company uses **Google Workspace**, choose **Internal**. Only people in your
  organisation can sign in, Google doesn't need to verify the app, and sign-ins don't expire.
- With a personal Gmail account you can only choose **External**. While the app is in
  *Testing* mode you must add each user under *Test users*, and **sign-ins expire after 7 days**
  (you would need to reconnect the mailbox weekly). Publishing an External app that reads Gmail
  requires Google's verification.
- Under *Data access*, add the scopes:
  `https://www.googleapis.com/auth/gmail.modify`,
  `https://www.googleapis.com/auth/spreadsheets`,
  `https://www.googleapis.com/auth/drive.metadata.readonly`.

**c) OAuth client for Gmail** (backend)
1. *Clients → Create client → Application type: **Web application***.
2. *Authorized redirect URIs*: `http://localhost:3000/mail/oauth/gmail/callback`
   (for a server: `https://<your-backend-domain>/mail/oauth/gmail/callback`).
3. Copy the **Client ID** → `GMAIL_CLIENT_ID` and the **Client secret** → `GMAIL_CLIENT_SECRET`.
   Keep the secret in `.env` only — never in chat, Slack or the repo.

**d) OAuth client for Google Sheets** (extension) — do this after section 9, once you know the
extension's ID. See 9.2.

---

## 7. Create the `.env` file

```bash
cp .env.example .env
```

Fill it in (example values for local use):

```dotenv
# Server
PORT=3000
SHORTLYST_API_KEY=<random string>        # the extension sends this; generate with: openssl rand -hex 24

# Jev via OpenRouter
OPENROUTER_API_KEY=<from 6.1>
JEV_MODEL_ID=typesafe/jev-1.13

# Postgres (must match docker-compose.yml)
POSTGRES_USER=shortlyst
POSTGRES_PASSWORD=shortlyst
POSTGRES_DB=shortlyst
POSTGRES_PORT=5433
DATABASE_URL=postgres://shortlyst:shortlyst@localhost:5433/shortlyst

# Langfuse
LANGFUSE_PUBLIC_KEY=<from section 5>
LANGFUSE_SECRET_KEY=<from section 5>
LANGFUSE_HOST=http://localhost:3001      # or https://cloud.langfuse.com

# Email feature
MAIL_CREDENTIALS_KEY=<generate, see below>
MAIL_SYNC_CRON=*/5 * * * *               # check mailboxes every 5 minutes
MAIL_CONCURRENCY=3                       # email threads processed at the same time
MAIL_BACKFILL_DAYS=7                     # how far back to read on first connect
MAIL_TAG_NOT_CANDIDATE=false             # true = also label non-candidate mail
MAIL_OAUTH_REDIRECT_BASE=http://localhost:3000/mail/oauth

# Gmail
GMAIL_CLIENT_ID=<from 6.2 c>
GMAIL_CLIENT_SECRET=<from 6.2 c>
```

Generate `MAIL_CREDENTIALS_KEY` (32 random bytes):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Back up `.env` somewhere safe** (e.g. a password manager). `MAIL_CREDENTIALS_KEY` encrypts
> the stored mailbox sign-ins — if it is lost or changed, every mailbox has to be reconnected.

---

## 8. Set up the database tables and start the backend

```bash
npm run migrate      # creates / updates the tables
npm run start:dev    # starts the backend with auto-reload
```

You should see:

```
[MailQueueService] mail queue started (concurrency 3)
Nest application successfully started
Shortlyst listening on port 3000
```

Quick check (should return the list of mail providers):

```bash
curl -H "x-api-key: <your SHORTLYST_API_KEY>" http://localhost:3000/mail/providers
```

Run the unit tests any time with `npm test`.

---

## 9. Install the Chrome extension

### 9.1 Build and load it
```bash
cd extension
npm run build
```
1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension` folder.
3. Note the extension **ID** shown on its card. It stays the same on every machine because the
   `key` in `extension/manifest.json` fixes it.

After any code change: `npm run build`, then click the reload icon on the extension card.

### 9.2 Google Sheets sign-in for the extension
The extension signs in to Google Sheets with its own OAuth client.
1. In your Google Cloud project: *Clients → Create client → Application type: **Chrome extension***.
2. *Item ID*: the extension ID from 9.1.
3. Copy the new Client ID into `extension/manifest.json` → `oauth2.client_id`, rebuild, reload.

### 9.3 Connect the extension to the backend
1. Open the extension's **Options** page (right-click the Shortlyst icon → *Options*).
2. Click the **⚙ settings** button in the header and paste your `SHORTLYST_API_KEY`. Leave
   **Server URL** empty for local use (it defaults to `http://localhost:3000`), or enter your
   server's address. Save.

---

## 10. Add your roles (Google Sheet)

Roles and their scoring criteria live in a Google Sheet with **three tabs**. Row 1 of each tab is
the header, exactly as below.

**`Dimensions`** — the scored skills (one row per skill)

| role_id | dimension_id | instructions | weight | level_1 | level_2 | level_3 | level_4 | level_5 | level_6 |
|---|---|---|---|---|---|---|---|---|---|
| fullstack-developer | nodejs_proficiency | How proficient is this candidate in Node.js? | 0.15 | no relevant experience | basic exposure | solid working proficiency | deep expertise | | |

- `weight`s of one role must add up to **1.0**.
- Each skill needs **2 to 6 levels**, from worst to best.

**`MustHaves`** — hard requirements (a confident "no" rejects the candidate)

| role_id | must_have_id | instructions |
|---|---|---|
| fullstack-developer | min_experience | Does this candidate have at least 5 years of professional full-stack development experience? |

**`Thresholds`** — decision rules (one row per role)

| role_id | contact_threshold | reject_threshold | confidence_floor | description |
|---|---|---|---|---|
| fullstack-developer | 0.65 | 0.35 | 0.5 | Full-stack developer, React + Node, 5+ years |

- Score ≥ `contact_threshold` → **Contact**; ≤ `reject_threshold` → **Reject**; in between → **Maybe**.
- Below `confidence_floor` the result is also flagged **Needs review**.
- `description` is a one-line summary used to match emails to roles — fill it in for better matching.

**Import:** Options page → **Roles & Criteria** → sign in to Google → pick your sheet → **Import**.
Re-import whenever you change the sheet.

---

## 11. Use it

**LinkedIn:** open a LinkedIn profile, open the Shortlyst side panel, pick a role → the profile
is scanned and classified (Contact / Maybe / Reject).

**Email:** Options page → **Mailboxes** → **Connect Gmail** → sign in with the HR mailbox in the
new tab → "Connected". From then on:
- the mailbox is checked every 5 minutes (or click **Sync now**);
- applications are labelled in Gmail under **Shortlyst/** — Contact, Maybe, Reject, Needs review;
- other mail is left untouched. Shortlyst never deletes, moves, marks as read or replies.

**Results:** Options page → **Candidates** (LinkedIn and email candidates), and **Export** to a
Google Sheet.

---

## 12. Deploy to a server

Deployment is scripted with Docker: fill in a few settings in `.env`, then run `./deploy.sh`.
It builds the backend, starts Postgres, gets an HTTPS certificate, applies database updates and
can include Langfuse. It also builds a ready-to-install extension zip for your server.

**Follow [DEPLOY.md](DEPLOY.md)**, which includes the exact Google Cloud steps for your own project.

---

## 13. Troubleshooting

| Problem | Fix |
|---|---|
| Extension says *Invalid or missing x-api-key* | The API key in the extension settings doesn't match `SHORTLYST_API_KEY` in `.env`. |
| *Connect Gmail* button missing | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` not set — restart the backend after setting them. |
| Google shows *redirect_uri_mismatch* | The redirect URI in the Gmail OAuth client must exactly match `MAIL_OAUTH_REDIRECT_BASE` + `/gmail/callback`. |
| Mailbox shows **Disconnected** | Its sign-in expired or was revoked (always after 7 days on an External app in testing). Click **Reconnect**. |
| Emails stuck in **Failed** | Usually OpenRouter (no credit, wrong key) or a Gmail outage. Fix the cause, then **Retry failed**. |
| Backend won't start: `MAIL_CREDENTIALS_KEY ... 32 bytes` | Generate the key with the command in section 7. |
| Tables missing / column errors | Run `npm run migrate`. |
| Roles import error about weights / levels | Each role's weights must sum to 1.0 and each skill needs 2–6 levels. |
| Old applications not picked up | Only the last `MAIL_BACKFILL_DAYS` days are read on first connect. Raise it **before** connecting the mailbox. |

---

## 14. Security checklist

- `.env`, `secrets/` and PDFs are git-ignored — never commit keys, Client Secrets or real CVs.
- Mailbox sign-ins are stored **encrypted** in the database (AES-256-GCM with
  `MAIL_CREDENTIALS_KEY`).
- The Gmail permission used is `gmail.modify`, but the code only **reads** mail and **adds/removes
  Shortlyst labels**.
- Use different `SHORTLYST_API_KEY` and `MAIL_CREDENTIALS_KEY` values in production than locally.
- To fully remove access: **Disconnect** on the Mailboxes page (revokes the Google sign-in), or
  remove the app under Google Account → Security → Third-party connections.
