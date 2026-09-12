# Publishing the coffee collection

The website lives on Cloudflare Workers. Everyone can browse the collection at `/`; the owner signs in at `/owner` to change ratings, inventory status, and append brewing notes. The YAML files in `johnbarton/coffee-extractor` remain the source of truth. Phone saves create commits on `main`, and Cloudflare rebuilds the public collection from those commits.

Start with the included `coffee-collection` Worker name and its free `workers.dev` address. A purchased domain is optional. Deploying the assets and Worker together is supported by [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/get-started/).

## 1. Check and publish the first version

Use Node.js 24 and the pnpm version declared in `package.json`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm run deploy
```

Complete the browser sign-in with the intended Cloudflare account. Check the account shown by `whoami` before deployment. Save the `https://coffee-collection.<account-subdomain>.workers.dev` address returned by deployment. The owner routes deny access until their authentication settings are supplied. See [Wrangler authentication commands](https://developers.cloudflare.com/workers/wrangler/commands/general/).

## 2. Protect the owner area

In Cloudflare One / Zero Trust, create a Free organization if there is not one already. Cloudflare currently asks for payment details during this onboarding even for the Free plan; the [setup documentation](https://developers.cloudflare.com/cloudflare-one/setup/) states that the Free plan is not charged.

Enable **One-time PIN** in the identity provider settings. New organizations do not automatically include it. Then create a **self-hosted Access application** named “Coffee collection owner” with:

| Setting | Value |
| --- | --- |
| Public hostname | The exact production `coffee-collection.<account-subdomain>.workers.dev` hostname |
| Path | `/owner` |
| Login method | One-time PIN |
| Policy action | Allow |
| Include rule | Emails → the owner's exact email address |

Use the same email later for `OWNER_EMAIL`. An exact email Include rule limits who can obtain an authorized login. Do not use “Everyone,” an entire email domain, or “One-time PIN” alone as the Include rule. [OTP setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) and [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) explain these distinctions.

The `/owner` path also covers its descendants, including the API. A rule for `/owner/*` alone misses the bare `/owner` address. Keep `/` public. The Worker's whole-application “Protect this Worker” setting would require sign-in for visitors as well, so use this path-specific application. See [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).

Copy the application's **Application Audience (AUD) Tag** and the organization's team domain, such as `https://your-team.cloudflareaccess.com`. They are the `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` values below. Keep Worker preview URLs disabled (`preview_urls: false` in the Wrangler configuration). If adding another hostname later, protect its `/owner` path before enabling editing there.

The Worker also verifies the Access JWT signature, issuer, audience, expiration, and owner email itself. This explicit verification is necessary: Workers using Static Assets do not receive `ctx.access` through the internal assets router. [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## 3. Give the Worker permission to save records

In GitHub, create a **fine-grained personal access token**:

- Resource owner: `johnbarton`.
- Repository access: **Only select repositories** → `coffee-extractor`.
- Repository permission: **Contents → Read and write**. Metadata read access is included automatically. No Actions, Workflows, administration, or account permissions are needed.
- Choose an expiration date, for example 90 days, and keep a reminder to replace it before it expires.

The token allows repository contents access; the Worker narrows writes to existing coffee records and the approved editable fields. The token must be allowed to commit directly to `main`; branch rules that require pull requests will prevent phone saves. Do not weaken existing branch rules silently—change the save workflow if such rules are required. See [GitHub token creation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) and the [contents API permissions](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).

Enter each value directly into the following interactive secret prompt. Keep tokens out of chat, source files, build variables, and shell command arguments:

```sh
pnpm exec wrangler secret put OWNER_EMAIL
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN
pnpm exec wrangler secret put ACCESS_AUD
pnpm exec wrangler secret put GITHUB_TOKEN
```

Alternatively, use the Worker's **Settings → Variables & Secrets**, choosing **Secret** for each of these four values. These are runtime secrets; the similarly named settings under **Build** are for a different purpose. Secret changes deploy a new Worker version. [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

The non-secret repository settings are already tracked in the Wrangler configuration:

| Name | Value |
| --- | --- |
| `GITHUB_OWNER` | `johnbarton` |
| `GITHUB_REPO` | `coffee-extractor` |
| `GITHUB_BRANCH` | `main` |

## 4. Publish automatically after a save

Push the website source and lockfile to `main`, then connect the existing Worker to GitHub in **Workers & Pages → coffee-collection → Settings → Build**. Limit the Cloudflare GitHub installation to this repository when selecting its access. Use:

| Setting | Value |
| --- | --- |
| Repository | `johnbarton/coffee-extractor` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `pnpm install --frozen-lockfile && pnpm test && pnpm build` |
| Deploy command | `pnpm run deploy` |
| Builds for non-production branches | Disabled |

The dashboard Worker name must match the name in the Wrangler configuration. Cloudflare's Git integration handles deployment credentials; the separate GitHub token above is only for runtime record editing. [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Under **Build Variables and Secrets**, set `NODE_VERSION` to `24`, `PNPM_VERSION` to the version from `package.json`, and `SKIP_DEPENDENCY_INSTALL` to `1`. The explicit build command handles installation. These are plain build variables, with no credentials. [Build image settings](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

The GitHub `Check coffee collection` workflow validates pushes and pull requests. Cloudflare runs the checks in its build command too, so publication does not depend on the timing of a separate GitHub check. Leave non-production builds disabled until previews have their own authentication and data policy. [Branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

## 5. Check the live site

- In a private browser window, `/` opens without signing in and has no editing controls. `/owner` asks for a login. Direct unauthenticated owner API requests cannot save anything.
- Sign in with the permitted email. On a phone, check each tab, filters, long notes, the rating chart, and the expanded editor with the keyboard visible.
- Make one intended change to a real record. Confirm it creates a GitHub commit, preserves existing notes, and appears after reloading the owner record. Avoid adding made-up test ratings or notes to the archive.
- Confirm the resulting Cloudflare build succeeds and a fresh public page shows the change. Public pages update after deployment, so a successful save can precede public visibility.
- Open the same record in two owner sessions. After saving a change in one, a stale save from the other must report a conflict instead of overwriting it.

Bookmark `/owner` on your phone for morning use. Share `/` for public viewing. Notes and ratings displayed in the public collection are visible to anyone with the link.

## Keeping local imports in sync

Phone edits are committed to GitHub. Dropbox syncing a checkout does not fetch those commits. Before importing another bag or changing local records, check the working tree, preserve any unfinished work, then pull the latest branch:

```sh
git status
git pull --ff-only origin main
```

Resolve divergent history or overlapping edits before continuing. After importing, validate and build with `pnpm test` and `pnpm build`, review the YAML changes, then commit and push normally. Keep generated site data separate from the source YAML. Do not copy an old local record over a newer phone edit.

If a public change has not appeared, first check the Cloudflare build for the saved commit. If saving stops working, check token expiration and repository permissions, then the Access team domain, audience, and exact owner email. Replace an expired token using the same `wrangler secret put GITHUB_TOKEN` command. Reverting a mistaken GitHub commit also triggers publication; inspect subsequent edits before reverting overlapping record changes.
