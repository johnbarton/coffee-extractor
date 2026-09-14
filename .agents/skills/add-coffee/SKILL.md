---
name: add-coffee
description: "Add coffee purchases to this repository's collection from attached bag or box photos, including multiple bags and repeat purchases. Use for photo intake and completing its drafts, not general coffee advice or brew logging."
---

# Add coffee from photos

Turn the supplied photos into one source-backed YAML record per purchased coffee, retaining the roaster's wording and a readable copy of every relevant photograph. Finish each validated intake with a local Git commit.

## Repository and sources

Resolve this skill directory's real path: the repository root is three directories above it (`.agents/skills/add-coffee`). Read that repository's `AGENTS.md`, `schema/coffee.schema.json`, and the adding/validation guidance in `README.md`. Use the current schema and guidance; do not copy rules from historical exports or sibling workspaces. All paths below are relative to that repository root. Synced project material under `sources/` is read-only.

Before changing records, check local Git status and synchronize with the appropriate remote branch as directed by `AGENTS.md`, preserving unfinished work. Inspect branch tracking rather than assuming the current branch tracks `main`. If sync is blocked or the branch has diverged, continue extraction in a staging directory and report the issue; do not overwrite local or remote work. Saving an intake does not itself authorize pushing or publishing. Follow any existing user authorization for those actions.

## Read and group the photos

- Inspect every supplied photo. Group front, back, side, and date-stamp views by physical bag/purchase. Several photos of one bag produce one record. Several coffees in one photo can produce several records. Use visible branding, product names, packaging, and the user's explanation; attachment order alone is not evidence of a match.
- Give each proposed purchase a short label in the conversation. Resolve uncertain grouping before associating a date stamp or saving that purchase. Two similar bags may be separate purchases; never merge them merely because their labels match.
- Transcribe into the current schema. Preserve wording, accents, tasting-note phrases and order, process, and roast terminology, allowing the conservative cleanup specified in `AGENTS.md`. Keep compound tasting-note phrases together. Apply any explicitly required normalization from the current repository guidance; do not rewrite other source wording to match older records.
- Use photos and the user's answers as evidence. Do not silently borrow facts, ratings, or notes from an older purchase or a current product page. If the user requests online verification, distinguish it from the photographed label and preserve the source URL in a YAML comment next to the supplemented field.

## Resolve uncertainty without blocking the whole batch

Resolve `coffee.name`, `coffee.roaster`, and `coffee.roast_date` using the prompting rules in `AGENTS.md`: request the missing panel, a legible close-up, a manual answer, or confirmation of plausible readings as appropriate. Bundle questions by purchase, and keep working on independent bags.

Do not infer a roast date from the upload date, purchase date, best-before stamp, another bag, or an ambiguous numeric format. If the year or day/month order is unresolved, leave the field null. Preserve ambiguous printed text and the outstanding question in a nearby YAML comment.

After asking, if an essential remains unavailable, save an incomplete draft with that field null and `record.review_status: needs_review`. A pending question is not confirmation of a guessed value. A draft must still have an unambiguous purchase/photo grouping and pass the schema. Hold only purchases awaiting grouping or duplicate confirmation. Do not set `reviewed` until all essentials are resolved and the transcription has been checked against the photos and user corrections. Fully legible, resolved records can be saved as reviewed without another blanket approval step.

Mention missing useful information briefly; do not block on it. Do not request photos solely for absent optional fields. Keep all required schema keys, using null for missing scalars and `[]` for missing lists. Follow the repository's blend, elevation, unit, and rating rules. Keep uncertainty/provenance in YAML comments where needed; do not introduce unsupported record fields or put extraction diagnostics in `personal_notes`.

## Check repeat purchases and allocate IDs

Search existing records and the current batch by roaster, coffee name, and roast date before assigning a final ID. Compare case, spacing, punctuation, and evident roaster aliases without changing the recorded wording. Inspect close matches manually, including photos when that resolves the question.

- Same coffee/roaster and same roast date, or matching photos: show the likely matching record and ask whether this is a separate purchase **before saving that purchase**. If a missing date prevents distinguishing a close match, ask as well. A prior explicit statement that these are separate purchases settles the question; do not ask again.
- Same coffee with a different known roast date: save a new purchase record and mention the previous purchase briefly. Never merge purchases or copy personal ratings, inventory history, or brewing observations.
- If the user identifies an accidental re-import, skip it. If they are completing a known draft, update that draft and retain its ID instead of adding another purchase. Do not replace an existing reviewed record unless the user requested a correction.

For a known roast date, use `YYYY-MM-DD-roaster-coffee-name` as the base ID, with lowercase ASCII slug segments. For any draft with an unresolved name or roaster, use `unknown-coffee` or `unknown-roaster` only in the ID; keep the unresolved field null. Check both `data/coffees/` and `images/coffees/`, plus IDs reserved for this batch. For a confirmed repeat or slug collision, choose the first unused suffix `-2`, `-3`, etc. Never overwrite a record or image directory to accommodate a new purchase.

For a draft with no resolved roast date, use `<added-date>-undated-<roaster-slug>-<coffee-slug>`. The date prefix here is the addition date, **not** a roast-date estimate. Add a YAML comment explaining this. Leave `coffee.roast_date` null. Keep every draft's stable ID when it is completed, including IDs containing unknown-name/roaster placeholders.

## Save the purchase and its photos

Create `data/coffees/<id>.yaml` and `images/coffees/<id>/`. Use descriptive names such as `front.jpeg`, `back.jpeg`, `roast-date.jpeg`, or numbered variants, retaining the real file format/extension. Copy source files rather than moving them. Keep all useful views; a shared group photograph may be copied into each relevant purchase's folder with a name such as `group-front.jpeg`.

List the saved image paths, relative to the repository root, in `source_images`. Preserve readable source photos; resize unusually large images only if all label text remains legible. If an attachment is visible but its file bytes are inaccessible, report that and request a usable file; do not invent a path or claim the image was saved. Do not count that intake as complete until its photos are actually saved.

Default new purchases to `inventory.status: resting`. Use the user's stated status when provided. Set `inventory.status_date` to the stated effective date, or today's local date when setting the status now; set `record.added_date` to today's local date. Preserve the original added date when completing a draft. Ratings and personal notes stay blank unless supplied by the user.

## Validate, commit, and report

Parse each written YAML record with duplicate-key rejection and validate against `schema/coffee.schema.json` with date-format checking. Use the repository's existing validation commands (`pnpm test` and `pnpm build` per `README.md`); the build checks schema validity, unique IDs, and filename/ID agreement. Run from the repository root. If tooling is unavailable, state exactly what was and was not checked and do not claim validation passed.

Also verify each listed photo exists, opens successfully, and belongs to the intended purchase; all paths must stay within `images/coffees/<id>/`. Check that scalar/range elevations are not both populated, ranges are ordered, and blend fields follow `AGENTS.md`. Compare the final transcription against the photos, and ensure only the intended purchases/photos changed. These checks complement the schema; they are not all enforced by it.

After validation passes, commit the intake's records and photos together as one logical batch. This includes schema-valid `needs_review` drafts and completed drafts. Inspect the staged and unstaged changes, stage only the exact intake paths, and review the staged diff before committing. Preserve unrelated work, including changes already staged by the user, and keep it out of this commit. Use a descriptive message identifying the coffee or batch; an ordinary request to add coffees includes this local commit without another confirmation step.

Verify the resulting commit contains the intended records and photos, and check that no intended intake changes remain uncommitted. If validation or committing is blocked, retain the work and report the specific unfinished step; do not describe the intake as complete. Pushing and publishing remain separate actions governed by the user's authorization.

Finish with a short summary: number added, each coffee and roaster, roast date (or unknown), inventory/review status, photo count, validation result, commit hash, and links to the new records. Mention repeat purchases, useful missing fields, and outstanding draft questions compactly. For a batch, a small table works well. Distinguish committed records from purchases still waiting for clarification, and local commits from any separately authorized publication.
