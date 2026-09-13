# Coffee Extractor

A lightweight, photo-first archive of specialty coffees. The goal is to make adding a coffee easy while preserving enough structured information to explore preferences across producers, origins, varieties, processes, and roaster-provided tasting notes over time.

## Coffee collection website

[Open the coffee collection](https://coffee-collection.coffee-collection.workers.dev).

The mobile website shows open bags and days since roast, frozen coffees with their recorded dates, and the complete collection grouped by roaster, variety, origin, process, or year. Ratings use the display labels Overall, Floral, Fruit, and Bright; the YAML field names stay unchanged.

Public visitors can browse. The owner area at `/owner` uses Cloudflare Access sign-in and can save ratings, change status, and append brewing notes. Each save updates the existing YAML record in GitHub and checks its version to avoid overwriting another device's edit. New notes preserve earlier observations. Public pages update when Cloudflare finishes publishing the saved commit.

Use Node.js 24 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dev
```

The local preview supports public browsing; the production owner routes require real Access authentication and repository credentials. Tests use isolated mocks and do not change live records. Build output is generated in `dist/`; it is not part of the source archive. No frontend framework, external font, or chart library is loaded in the browser.

Follow [the Cloudflare setup guide](docs/cloudflare.md) for publishing, owner access, and automatic updates. Account setup and a real sign-in/save check must be completed before owner editing is ready for use.

## Adding a coffee

1. Pull the latest GitHub records before editing locally, preserving any unfinished work first. Phone edits are saved to GitHub; Dropbox alone does not bring those commits into a local checkout.
2. Photograph the front and back of the bag or box, plus any side panel or roast-date stamp that contains useful information.
3. Extract the package information into a YAML file under `data/coffees/`.
4. If an essential field cannot be read, request a closer image or a manual answer before marking the record as reviewed.
5. Add personal ratings when ready. Ratings may remain blank while the coffee rests or until there has been enough time to form an opinion.
6. Update the inventory status as the coffee moves from resting to active, frozen, or finished.
7. Validate with `pnpm test` and `pnpm build`, review the changes, then commit and push. Cloudflare publishes the updated collection when its GitHub connection is configured.

See [AGENTS.md](AGENTS.md) for detailed extraction and prompting rules.

## Data model

Each coffee has one editable YAML record. The record preserves the roaster's exact tasting-note wording and stores analytically useful attributes as structured fields.

Archive-based additions have a source and review log under `data/provenance/`. These companion files record the supporting URLs, before/after values, matching evidence, and user-approved exceptions. They are kept separate from personal brewing notes and package photographs.

### Essential fields

- Coffee name
- Roaster
- Roast date

If one is missing, illegible, or ambiguous, ask for clarification. A draft may temporarily contain a blank essential field, but it must not be marked `reviewed` until the field is resolved.

### Useful fields

- Country
- Producer or farm
- Variety
- Process
- Roaster-provided tasting notes

Mention missing useful fields, but do not block an otherwise usable record.

### Optional fields

- Region or subregion
- Elevation
- Roast level
- Package weight
- Roaster location
- Whole-bean or ground form

Store these when available without prompting solely because they are absent.

## Ratings

Ratings are whole numbers from 1 through 5:

- `florality`
- `fruitiness`
- `brightness`
- `overall`

There is one evolving set of ratings per coffee, not a log of individual brews. `personal_notes` can hold dialing-in observations, brewing methods, frozen-dose dates, or anything the four scores do not capture.

## Inventory status

`status` is one of:

- `resting`: on hand but not yet being brewed
- `active`: currently being brewed
- `frozen`: the remaining coffee is primarily frozen
- `finished`: no coffee remains

If only a few doses are frozen while the bag remains in use, keep the coffee `active` and note the frozen doses in `personal_notes` if desired.

The displayed age of a coffee should be calculated from `roast_date`; derived ages are not stored in the data file.

## Repository layout

```text
data/coffees/       One YAML record per coffee
images/coffees/     Source package photographs, grouped by coffee ID
schema/             Machine-readable record schema
web/                Mobile interface and static assets
server/             Owner authentication and GitHub saving
shared/             Display normalization
scripts/            Validation and website build
tests/              Authentication, saving, and interface checks
docs/               Cloudflare setup and maintenance
AGENTS.md           Extraction and repository guidance
```

## File naming

Use a stable ID based on the roast date, roaster, and coffee name:

```text
YYYY-MM-DD-roaster-coffee-name
```

Use the same ID for the YAML filename and image directory. Keep the ID unchanged if display names are corrected later.

## Validation

[`schema/coffee.schema.json`](schema/coffee.schema.json) is a JSON Schema for the YAML records. YAML values left blank are interpreted as `null`. A reviewed record must contain nonblank values for coffee name, roaster, and roast date.
