# Deploying Shortlyst

Shortlyst runs on **any Linux server with Docker**: AWS EC2, Google Cloud, DigitalOcean, Azure,
an office machine, and so on. You fill in a few settings, run one script, and it builds
everything, sets up the database, gets an HTTPS certificate and starts.

**Time needed:** about 30 minutes the first time, most of it the Google Cloud setup (step 3).

**What ends up running on the server:**

| Part | What it is |
|---|---|
| Shortlyst backend | The API and the email background job |
| Postgres | The database. Its data stays on the server's disk across restarts and updates |
| Caddy | Gives you HTTPS with a free Let's Encrypt certificate, renewed automatically |
| Langfuse *(optional)* | A dashboard showing every Jev call, with its answers and cost |

---

## 1. Get a server and a domain

**Server**
- Ubuntu 22.04 or 24.04 (any Linux with Docker works).
- **2 GB RAM** is enough without Langfuse; use **4 GB** with Langfuse. 1–2 CPUs, 20 GB disk.
- Open ports **80** and **443** in the firewall or security group.

**Install Docker** (Ubuntu / Debian):
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # then log out and back in
```

**Domain:** create a DNS **A record** pointing to the server's public IP address, e.g.
`shortlyst.yourcompany.com`. If you want Langfuse, add a second one, e.g.
`langfuse.yourcompany.com`, pointing to the same IP.

---

## 2. Get an OpenRouter key (for Jev)

1. Sign up at https://openrouter.ai and add some credit. Jev costs about **$0.0002 per
   candidate**, so $5 lasts a long time.
2. Go to **Keys → Create key** and copy it. This is `OPENROUTER_API_KEY`.

---

## 3. Set up your Google Cloud project

Shortlyst signs in to Google in two places:
- the **backend** reads the HR mailbox (Gmail);
- the **Chrome extension** imports roles from, and exports candidates to, Google Sheets.

Both use OAuth clients in **your own** Google Cloud project, so your company's data only goes
through your project. Go to https://console.cloud.google.com, signed in with your company
Google account.

### 3.1 Create the project
1. Click the project picker at the top → **New project**.
2. Name it `Shortlyst`, pick your organisation, then **Create**. Make sure it's selected in the
   project picker.

### 3.2 Turn on the APIs
**APIs & Services → Library**. Search for each of these and click **Enable**:
- **Gmail API**
- **Google Sheets API**
- **Google Drive API**

### 3.3 Set up the consent screen
1. Go to **Google Auth Platform** (or *APIs & Services → OAuth consent screen*) → **Get started**.
2. **App information:** app name `Shortlyst`, user support email = your email.
3. **Audience:**
   - **Internal** if your company uses Google Workspace *(recommended)*. Only people in your
     organisation can sign in, Google doesn't need to review the app, and sign-ins don't expire.
   - **External** is the only choice for personal Gmail accounts. You must then add every user
     under **Audience → Test users**, and **sign-ins expire after 7 days**: the mailbox shows
     *Disconnected* weekly and needs **Reconnect**.
4. **Contact information:** your email → **Create**.
5. **Data access → Add or remove scopes.** Paste these three in *Manually add scopes*, click
   **Add to table → Update → Save**:
   ```
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/drive.metadata.readonly
   ```

### 3.4 Create the client for Gmail (backend)
1. **Google Auth Platform → Clients → Create client.**
2. **Application type:** *Web application*. **Name:** `Shortlyst backend`.
3. **Authorized redirect URIs → Add URI**, using your domain:
   ```
   https://shortlyst.yourcompany.com/mail/oauth/gmail/callback
   ```
4. **Create.** Copy the **Client ID** into `GMAIL_CLIENT_ID` and the **Client secret** into
   `GMAIL_CLIENT_SECRET`.

   Keep the secret only in the server's `.env`. Don't send it by chat or email, and don't commit
   it.

### 3.5 Create the client for the Chrome extension (Google Sheets)
1. **Clients → Create client** again.
2. **Application type:** *Chrome extension*. **Name:** `Shortlyst extension`.
3. **Item ID:**
   ```
   hiphdcggiohiilfbklaijaeeepepoffc
   ```
   This is the Shortlyst extension's fixed ID. It's the same for everyone because of the `key`
   in `extension/manifest.json`, so don't remove that key.
4. **Create.** Copy the **Client ID** into `GOOGLE_SHEETS_CLIENT_ID`. This client type has no
   secret.

---

## 4. Deploy

On the server:

```bash
git clone https://github.com/prateek685/shortlyst.git
cd shortlyst
cp .env.production.example .env
nano .env        # or any editor
```

Fill in:

| Setting | Value |
|---|---|
| `DOMAIN` | `shortlyst.yourcompany.com` (no `https://`) |
| `OPENROUTER_API_KEY` | from step 2 |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | from step 3.4 |
| `GOOGLE_SHEETS_CLIENT_ID` | from step 3.5 |
| `ENABLE_LANGFUSE` | `true` to include the Langfuse dashboard, otherwise leave `false` |
| `LANGFUSE_DOMAIN`, `LANGFUSE_ADMIN_EMAIL` | only if Langfuse is on, e.g. `langfuse.yourcompany.com` and your email |

Leave the **GENERATED** section empty. The script fills it in.

Then:

```bash
./deploy.sh
```

The first run takes a few minutes. At the end it prints:

```
==> Shortlyst is running

  Server URL        https://shortlyst.yourcompany.com
  API key           3f9c…                     ← users paste this into the extension
  Gmail redirect    https://shortlyst.yourcompany.com/mail/oauth/gmail/callback
  Langfuse          https://langfuse.yourcompany.com
                    login you@yourcompany.com / 8a2e…
```

Check it from your browser: `https://shortlyst.yourcompany.com/health` should show
`{"status":"ok"}`.

> **Back up the `.env` file** (e.g. in your password manager). It holds the generated secrets.
> Never change `MAIL_CREDENTIALS_KEY` or `POSTGRES_PASSWORD` after the first deploy: the first
> disconnects every mailbox, and the second locks the app out of its database.

---

## 5. Build the Chrome extension for your server

```bash
./scripts/package-extension.sh
```

This builds `build/shortlyst-extension.zip`, with your server address and your Google client
already filled in. Only Docker is needed. Copy the zip to your computer, e.g.
`scp user@server:shortlyst/build/shortlyst-extension.zip .`, and share it with the users.

**Each user installs it once:**
1. Unzip it.
2. Open `chrome://extensions`, switch on **Developer mode** (top right), click **Load unpacked**
   and pick the `shortlyst-extension` folder.
3. Right-click the Shortlyst icon → **Options** → the settings button in the header → paste the
   **API key** from step 4 → **Save**. The server URL is already filled in.

---

## 6. First use

1. **Roles:** create a Google Sheet with the tabs `Dimensions`, `MustHaves` and `Thresholds`
   (the column layout is in [SETUP.md, section 10](SETUP.md#10-add-your-roles-google-sheet)).
   Then in Options → **Roles & Criteria**, sign in to Google, pick the sheet and click **Import**.
2. **Mailbox:** Options → **Mailboxes** → **Connect Gmail** → sign in with the HR mailbox.
   From then on it's checked every 5 minutes. Applications get Gmail labels under
   **Shortlyst/** (Contact, Maybe, Reject, Needs review), and other mail is left alone.
   Shortlyst never deletes, moves, marks as read or replies to anything.
3. **LinkedIn:** open a profile, open the Shortlyst side panel, pick a role.

---

## 7. Day-to-day operations

All commands are run in the `shortlyst` folder on the server.

| Task | Command |
|---|---|
| Update to the latest version | `git pull && ./deploy.sh` |
| Watch the logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Stop everything | `docker compose -f docker-compose.prod.yml --profile langfuse down` |
| Start again | `./deploy.sh` |
| Back up the database | `docker compose -f docker-compose.prod.yml exec -T db pg_dump -U shortlyst shortlyst > shortlyst-$(date +%F).sql` |
| Restore a backup | `docker compose -f docker-compose.prod.yml exec -T db psql -U shortlyst shortlyst < shortlyst-2026-01-01.sql` |

- Database changes in a new version are applied automatically when the app starts.
- `deploy.sh` is safe to run again: it never replaces secrets that are already set.
- Data lives in Docker volumes and survives restarts and updates. Don't run `down -v`: the `-v`
  deletes the data.

**Langfuse Cloud instead of running Langfuse on the server:** keep `ENABLE_LANGFUSE=false` and
set `LANGFUSE_HOST=https://cloud.langfuse.com` plus that project's `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` in `.env`, then run `./deploy.sh`.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Browser shows a certificate error, or the site doesn't load | DNS isn't pointing at the server yet, or ports 80/443 are blocked. Check with `dig +short shortlyst.yourcompany.com`, then look at `docker compose -f docker-compose.prod.yml logs caddy`. |
| `deploy.sh` says the backend did not become healthy | Read the log lines it prints. Usually a value in `.env` is wrong. |
| Extension: *Invalid or missing x-api-key* | The API key in the extension settings doesn't match `SHORTLYST_API_KEY` in `.env`. |
| Extension: *Failed to fetch* | Wrong Server URL in the extension settings, or the server is down (check `/health`). |
| Google: *redirect_uri_mismatch* | The redirect URI in step 3.4 must be exactly `https://<DOMAIN>/mail/oauth/gmail/callback`. |
| Google: *Access blocked / app not verified* | The consent screen is External and the user isn't in **Test users** (step 3.3). |
| Google Sheets sign-in fails in the extension | `GOOGLE_SHEETS_CLIENT_ID` is wrong, or the Item ID in step 3.5 isn't `hiphdcggiohiilfbklaijaeeepepoffc`. Rebuild the extension with `./scripts/package-extension.sh` after fixing it. |
| No *Connect Gmail* button | `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` are empty. Set them and run `./deploy.sh`. |
| Mailbox shows **Disconnected** | Its Google sign-in expired or was revoked. Click **Reconnect**. |
| Emails stuck in **Failed** | Usually OpenRouter (out of credit or a wrong key). Fix it, then click **Retry failed** on the Mailboxes page. |
