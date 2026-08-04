# Agent guidance

These instructions apply when extracting coffee information from photographs or maintaining records in this repository.

## Core behavior

- Prefer faithful transcription over inference.
- Preserve the roaster's tasting notes as written, with only conservative capitalization cleanup.
- Use ISO dates (`YYYY-MM-DD`) in records.
- Use metric units for structured numeric fields. Convert a clearly printed imperial value when necessary, while retaining only the normalized value unless the original wording is important.
- Leave unavailable optional fields blank or empty. Do not invent values.
- Explain uncertainty conversationally; do not silently choose among plausible readings.
- Keep one record per purchased coffee, even if the same coffee and roast date have appeared before.

## Name selection

Coffee names are not standardized. Use the most prominent lot, farm, producer, or product name chosen by the roaster. It is acceptable for the same text to appear as both `coffee.name` and `origin.producer` when the producer's name is also the product name.

## Prompting rules

### Essential: resolve before review

- `coffee.name`
- `coffee.roaster`
- `coffee.roast_date`

When an essential field is unavailable:

- **Not photographed:** ask for the likely missing side or panel.
- **Visible but unreadable:** ask for a closer, well-lit photograph.
- **Apparently absent:** ask whether the user knows it manually.
- **Ambiguous:** present the plausible readings and request confirmation.

An incomplete record may use `record.review_status: needs_review`. Do not set `reviewed` while an essential field is blank.

### Useful: mention but do not block

- Country
- Producer or farm
- Variety
- Process
- Tasting notes

Briefly identify useful missing information. The record may still be reviewed.

### Optional: store when present

- Region and subregion
- Elevation
- Roast level
- Weight
- Roaster location
- Coffee form

Do not request another photograph solely to obtain an optional field.

## Structured fields

- Use lists for varieties and tasting notes, even when only one value appears.
- Keep geographical levels separate when the package supports doing so.
- Record elevation as `elevation_m` or `elevation_m_range`; do not collapse a printed range to its midpoint.
- Store process and roast level using the roaster's terminology.
- Do not add inferred tasting-note categories to the source record. Future analyses may derive categories from the preserved raw notes.

## Ratings and notes

- Ratings are whole numbers from 1 to 5 or blank.
- Never infer ratings from the roaster's tasting notes or package language.
- Maintain one editable rating set per coffee rather than individual brew entries.
- Preserve personal brewing observations in `personal_notes` without trying to structure every recipe detail.

## Inventory

- Allowed statuses are `resting`, `active`, `frozen`, and `finished`.
- Use `frozen` when the remaining coffee is primarily stored frozen. A few frozen doses do not require changing an otherwise active coffee.
- Record `status_date` when the status is set or changed.
- Calculate days post-roast when displaying data; never store a periodically changing age in the record.

## Images and provenance

- Store source images under `images/coffees/<coffee-id>/` with descriptive names such as `front.jpg`, `back.jpg`, or `roast-date.jpg`.
- List the relative image paths in `source_images`.
- Resize unusually large images when useful, but retain enough resolution to read all package text.
- Before replacing a reviewed transcription, consult the source image and preserve legitimate user corrections.

## Repository hygiene

- Validate new and changed YAML records against `schema/coffee.schema.json` before publishing when tooling is available.
- Keep derived tables, normalized tasting-note categories, and visualizations separate from the source YAML records.
- Do not rewrite stable coffee IDs merely because display text changes.
- Do not add individual brew logs unless the repository owner explicitly changes the project scope.

