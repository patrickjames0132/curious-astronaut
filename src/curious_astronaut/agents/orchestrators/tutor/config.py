"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor's words: its agent id, skills, and the two prompts — one that
breaks the paper or a concept into the concepts it needs, one that teaches a
single concept as a lesson (citing the paper's real references). Model choice
and the two knobs (``children``, ``lesson_words``) live in its
``config.llm.agents`` entry, validated at load against ``config.TutorExtras``;
``main`` reads them per call, so a settings edit applies to the next expansion
without a restart.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

AGENT_ID = "tutor"

SKILLS: tuple[str, ...] = ("teaching-voice",)
"""The lesson half teaches, so it carries the crew's teaching voice. The
expansion half emits structure, not prose, and carries no skill."""

EXPAND_PROMPT = (
    "You design short courses. A reader wants to understand a research paper, "
    "and you are building the course one step at a time: given ONE item in it "
    "(the paper itself, or a concept the course already teaches), list the "
    "concepts the reader needs to understand BEFORE that item makes sense.\n\n"
    "You are told the path from the paper down to the item, so you know what "
    "it is being learned for: eigenvectors under PCA are taught differently "
    "from eigenvectors under policy iteration. List only what this item "
    "needs, in this context — not everything related to it.\n\n"
    "Return `items`, each with:\n"
    "- name: the concept, as a short noun phrase ('Bellman equations', "
    "'Convolutional neural networks'). Name ideas, never papers or authors.\n"
    "- why: one plain sentence saying what the item needs it for.\n\n"
    "Rules:\n"
    "- When a REFERENCES list is given, it is the paper's real reference list: "
    "use it to judge which ideas the paper actually builds on, but list the "
    "IDEAS, not the papers.\n"
    "- When an item matches one in ALREADY IN THE COURSE, reuse that exact "
    "name so the course does not teach it twice.\n"
    "- Never list the item itself, or anything on the path above it.\n"
    "- Order items from most to least essential. List fewer when fewer are "
    "really needed; an elementary concept may need none at all — return an "
    "empty list rather than padding."
)

LESSON_PROMPT = (
    "You teach one lesson in a short course whose goal is understanding a "
    "research paper. You are given the lesson's subject, why the course needs "
    "it, and the path from the paper down to it. Teach the subject so the "
    "reader can take the next step up that path.\n\n"
    "Return one field, `text`: the lesson in Markdown. Open with the core "
    "idea in a sentence or two, build intuition with a concrete example, "
    "then say exactly how it is used by the item above it on the path. Use "
    "LaTeX between $…$ or $$…$$ where an equation helps; keep notation "
    "light. When the subject is the paper itself, explain what it did and "
    "why it matters, grounded in its abstract — never invent results.\n\n"
    "Citations: when a REFERENCES list is given and an idea in the lesson "
    "comes from a paper on it, cite that paper with its number in square "
    "brackets, like [3], where the idea is introduced. Cite ONLY from that "
    "list, and never name a paper that is not on it — a lesson with no "
    "citation is fine.\n\n"
    "No title heading (the page shows the subject), no lead-in about what "
    "you are about to do, and no closing quiz."
)
