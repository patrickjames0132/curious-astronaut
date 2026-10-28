"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The reviewer's words and knobs: the agent ids it borrows, its system
prompts (the judge, the grouper, and the placer that pins a criticism to the
paper for the Reader's margin notes), and its batch sizes.

**No agent id of its own.** The judge runs on the summarizer's model (the
crew's cheapest: it reads a few hundred sentences per paper) and the grouping
on the researcher's (the crew's strongest writer of grounded prose), the same
way the summarizer's titler shares its id: a seventh entry in Agent Settings
would be one more model to choose for a job two existing entries already
describe.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

#: The agent whose model judges each sentence.
JUDGE_AGENT_ID = "summarizer"

#: The agent whose model groups the critiques into themes.
GROUP_AGENT_ID = "researcher"

#: The agent whose model pins criticisms to the paper (v8.54.0): the
#: grouper's, since it reads the whole paper and must judge what a
#: criticism is about.
PLACE_AGENT_ID = "researcher"

#: The paper's characters the placer reads, shared among its sections; a
#: section gets at least ``PLACE_MIN_CHARS``. The tutor's placer's budget.
PLACE_CHARS = 60000
PLACE_MIN_CHARS = 600

#: The most pins one criticism gets: the passage it is most about, and at
#: most one more where the paper makes the same choice again.
PLACE_MAX_PINS = 2

#: Sentences per judge call. The prototype's (2026-10-24): small enough that
#: a model returns a verdict for every id, large enough that a landmark's
#: ~300 sentences take a handful of calls.
JUDGE_BATCH = 40

#: Judge calls in flight at once, per paper.
JUDGE_CONCURRENCY = 8

#: The most themes a card shows.
MAX_THEMES = 8

JUDGE_SYSTEM_PROMPT = (
    "You sort sentences from later papers that cite a target paper. Every "
    "sentence cites the target somewhere, often alongside other works. For "
    "each sentence id, return a verdict:\n"
    "- critique: the sentence attributes a weakness, limitation, failure, "
    "cost or error to the TARGET's method, results or claims. That includes "
    "'the standard X has problem Y' when X is what the target introduced, and "
    "a later paper reporting that the target's results don't hold up.\n"
    "- not_critique: anything else. A sentence that uses, describes, extends "
    "or praises the target; one whose weakness belongs to another cited work; "
    "and one that criticises a whole family the target is only part of: "
    "'autoregressive models are slow (Vaswani et al.; Brown et al.)' is about "
    "autoregression, not about the Transformer paper.\n\n"
    "For a critique, also return point: the weakness claimed, in at most 12 "
    "words, in your own words. When unsure, answer not_critique. Return a "
    "verdict for every id you are given and no others."
)

GROUP_SYSTEM_PROMPT = (
    "You group criticisms of a target paper, each taken from a sentence in a "
    "later paper that cites it, into the themes a reader should know about. "
    "Merge sentences that make the same point. Use only what the sentences "
    "say; never add a criticism of your own, and never soften or sharpen "
    "one. For each theme return:\n"
    "- name: a short headline for the concern, at most 8 words, plain and "
    "specific ('Cost grows quadratically with sequence length', not "
    "'Efficiency').\n"
    "- summary: one or two sentences stating the concern, grounded only in "
    "the theme's sentences.\n"
    "- sentence_ids: the ids of every sentence that supports it.\n\n"
    f"At most {MAX_THEMES} themes, the ones raised by the most distinct papers "
    "first. Leave out a sentence rather than force it into a theme, and leave "
    "out a theme that is barely a criticism (an implementation note, a "
    "neutral comparison)."
)

PLACE_SYSTEM_PROMPT = (
    "You help a reader of a research paper see where the field's criticisms "
    "of it apply. You are given the paper's sections (an id, a heading and "
    "their text) and its criticisms, each numbered, with a summary of what "
    "later papers objected to. For a criticism that is about something the "
    "paper itself says or does (a design choice, an assumption, a claim, a "
    "reported result), find the passage it applies to and return a pin:\n"
    "- criticism: the criticism's number, as given.\n"
    "- section: the id of the section holding the passage, exactly as given.\n"
    "- quote: the passage, copied word for word from that section's text: "
    "one sentence or clause, 6 to 30 words, prose only (never an equation "
    "or a table), long enough to be found and short enough to point at one "
    "thing.\n\n"
    "Pin only where a reader would see the connection: the sentence that "
    "makes the choice the criticism is about, or the claim it disputes. Not "
    "every criticism has such a passage; one about what the paper never "
    "tried, or about the field after it, gets no pin. A wrong pin is worse "
    f"than none. At most {PLACE_MAX_PINS} pins per criticism, the most "
    "telling first, and never invent text that isn't in the section."
)
