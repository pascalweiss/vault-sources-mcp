---
name: store-source
description: Store a new input source (transcript, article, excerpt, or pasted text) in the provenance database. Use when the user provides raw source material that should be tracked for provenance.
---

# Store a New Input Source

Persist raw input material in the provenance database so it can later be linked to notes.

## Steps

1. Identify the input content the user has provided (transcript, article, excerpt, pasted text, etc.).
2. Call `store_input` with the content. Optionally include metadata such as:
   - `source_type`: e.g. "youtube_transcript", "article", "book_excerpt", "pasted_text"
   - `source_url`: URL if applicable
   - `title`: a descriptive title for the input
3. If the tool returns `duplicate: true`, inform the user that this content was already stored and provide the existing `input_id`.
4. If newly stored, report the `input_id` and `content_sha256` back to the user.
5. Ask the user if they want to immediately create a note from this input (suggest using `/new-note`).

## Important

- The database must be initialized first. If you get a "DB not initialized" error, suggest running `/vault-init`.
- Inputs are immutable once stored. They can only be redacted, not edited.
- SHA-256 deduplication prevents storing the same content twice.

## Examples

**User provides a YouTube transcript:**
> "Here's the transcript from the video about composting..."

**User pastes an article:**
> "Store this article about soil health: ..."
