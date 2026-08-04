# Coffee Extractor

A lightweight, photo-first archive of specialty coffees. The goal is to make adding a coffee easy while preserving enough structured information to explore preferences across producers, origins, varieties, processes, and roaster-provided tasting notes over time.

## Adding a coffee

1. Photograph the front and back of the bag or box, plus any side panel or roast-date stamp that contains useful information.
2. Extract the package information into a YAML file under `data/coffees/`.
3. If an essential field cannot be read, request a closer image or a manual answer before marking the record as reviewed.
4. Add personal ratings when ready. Ratings may remain blank while the coffee rests or until there has been enough time to form an opinion.
5. Update the inventory status as the coffee moves from resting to active, frozen, or finished.

See [AGENTS.md](AGENTS.md) for detailed extraction and prompting rules.

## Data model

Each coffee has one editable YAML record. The record preserves the roaster's exact tasting-note wording and stores analytically useful attributes as structured fields.

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

