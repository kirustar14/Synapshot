"""Turning a pile of clinical documents into a patient record, with its receipts.

Three pieces: `read` gets text (or an image) out of each file, `extract` asks Gemini for a
strict schema and falls back to a regex extractor when there is no key, and `run` drives
the five visible steps the Add patient screen shows while it happens.

Every field carries where it came from. A number on this screen that cannot name the file
and the sentence it was read out of is a number nobody should act on, so the schema has no
way to express a value without that, and the UI shows it on hover.
"""
