"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The reviewer's words and knobs: the two agent ids it borrows, its two system
prompts, and its batch sizes.

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
