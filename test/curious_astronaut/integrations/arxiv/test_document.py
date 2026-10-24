"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
document: the Reader's structured parse of an ar5iv render, and the cached
get_document() reader.

The HTML below is cut down from real ar5iv markup (1706.03762, "Attention Is
All You Need") so the LaTeXML classes are the ones the parser actually meets.
client.fetch_render is faked directly — no network.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from curious_astronaut.integrations.arxiv import client, document

_PAGE = """
<html><head><script>detectColorScheme()</script></head><body>
<nav class="ltx_page_navbar">Contents</nav>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Attention Is All You Need</h1>
<div class="ltx_authors"><span class="ltx_personname">Ashish Vaswani</span></div>
<div id="abstract1" class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">The dominant   sequence transduction models.</p></div>
<section id="S1" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>
<div id="S1.p1" class="ltx_para ltx_noindent">
<p class="ltx_p">Long short-term memory <cite class="ltx_cite ltx_citemacro_citep">[<a href="#bib.bib13" class="ltx_ref">13</a>, <a href="#bib.bib2" class="ltx_ref">2</a>]</cite> is
<span class="ltx_text ltx_font_italic">recurrent</span>, see Figure <a href="#S3.F1" class="ltx_ref"><span class="ltx_text ltx_ref_tag">1</span></a>
and <a href="https://github.com/tensorflow/tensor2tensor">the code</a>.</p>
</div>
</section>
<section id="S3" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">3 </span>Model <math alttext="\\mathcal{M}" display="inline"><mi>M</mi></math></h2>
<figure id="S3.F1" class="ltx_figure"><img src="/html/1706.03762/assets/Figures/ModalNet-21.png" width="912" height="1344" alt="Refer to caption">
<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1: </span>The Transformer - model architecture.</figcaption>
</figure>
<section id="S3.SS2" class="ltx_subsection">
<h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">3.2 </span>Attention</h3>
<div class="ltx_para">
<p class="ltx_p">We scale by <math alttext="\\frac{1}{\\sqrt{d_{k}}}" display="inline"><mi>d</mi></math>.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">4</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">4</sup><span class="ltx_tag ltx_tag_note">4</span>Dot products get large.</span></span></span></p>
<table id="S3.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row">
<td class="ltx_eqn_cell"><math alttext="\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^{T})V" display="block"><mi>A</mi></math></td>
<td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr></tbody></table>
<table id="S3.EGx1" class="ltx_equationgroup ltx_eqn_align ltx_eqn_table">
<tbody id="S3.Ex1"><tr class="ltx_equation ltx_eqn_row">
<td class="ltx_eqn_cell"><math alttext="\\mathrm{MultiHead}(Q,K,V)" display="inline"><mi>M</mi></math></td>
<td class="ltx_eqn_cell"><math alttext="=\\mathrm{Concat}(h_1)W^{O}" display="inline"><mi>C</mi></math></td></tr></tbody>
</table>
</div>
<div class="ltx_para">
<ul class="ltx_itemize">
<li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">In encoder-decoder attention.</p></div></li>
</ul>
</div>
<section id="S3.SS2.SSS0.Px1" class="ltx_paragraph">
<h5 class="ltx_title ltx_title_paragraph">Encoder:</h5>
<div class="ltx_para"><p class="ltx_p">Six layers.</p></div>
</section>
</section>
</section>
<section id="S4" class="ltx_section">
<h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">4 </span>Why</h2>
<figure id="S4.T1" class="ltx_table">
<figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Path lengths.</figcaption>
<table class="ltx_tabular"><thead><tr><th class="ltx_td" colspan="2">Layer Type</th></tr></thead>
<tbody><tr><td class="ltx_td">Self-Attention</td><td class="ltx_td"><math alttext="O(n^{2}\\cdot d)" display="inline"><mi>O</mi></math></td></tr></tbody></table>
</figure>
<figure id="S4.F3" class="ltx_figure"><div class="ltx_flex_figure">
<div class="ltx_flex_cell"><object type="image/svg+xml" data="/html/1706.03762/assets/heads.svg" width="476" height="226"></object></div>
</div><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 3: </span>Heads.</figcaption></figure>
</section>
<section id="bib" class="ltx_bibliography">
<h2 class="ltx_title ltx_title_bibliography">References</h2>
<ul class="ltx_biblist">
<li id="bib.bib2" class="ltx_bibitem"><span class="ltx_tag ltx_role_refnum ltx_tag_bibitem">[2]</span>
<span class="ltx_bibblock">Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio.</span>
<span class="ltx_bibblock">Neural machine translation by jointly learning to align and translate.</span>
<span class="ltx_bibblock"><span class="ltx_text ltx_font_italic">CoRR</span>, abs/1409.0473, 2014.</span></li>
</ul>
</section>
</article>
<footer class="ltx_page_footer">Generated by LaTeXML</footer>
</body></html>
"""


def _parsed() -> dict:
    return document.parse_document(_PAGE)


def _section(parsed: dict, section_id: str) -> dict:
    return next(section for section in parsed["sections"] if section["id"] == section_id)


def test_title_and_abstract_skip_front_matter():
    parsed = _parsed()
    assert parsed["available"] is True
    assert parsed["title"] == [{"kind": "text", "text": "Attention Is All You Need"}]
    assert parsed["abstract"] == [
        {"kind": "paragraph", "inlines": [{"kind": "text", "text": "The dominant sequence transduction models."}]}
    ]
    # The author block, the navbar and the footer are page chrome, not body.
    text = str(parsed)
    assert "Vaswani" not in text and "LaTeXML" not in text and "Contents" not in text


def test_sections_flatten_in_document_order_with_levels_and_numbers():
    parsed = _parsed()
    outline = [(section["id"], section["level"], section["number"]) for section in parsed["sections"]]
    assert outline == [
        ("S1", 1, "1"),
        ("S3", 1, "3"),
        ("S3.SS2", 2, "3.2"),
        ("S3.SS2.SSS0.Px1", 4, ""),
        ("S4", 1, "4"),
    ]
    # A title keeps its math; the number is split out of it.
    assert _section(parsed, "S3")["title"] == [
        {"kind": "text", "text": "Model "},
        {"kind": "math", "latex": "\\mathcal{M}", "display": False},
    ]
    # A section's blocks are its own: the subsection's paragraph isn't in S3.
    assert [block["kind"] for block in _section(parsed, "S3")["blocks"]] == ["figure"]


def test_citations_stay_tied_to_their_bibliography_entries():
    inlines = _section(_parsed(), "S1")["blocks"][0]["inlines"]
    assert inlines[:5] == [
        {"kind": "text", "text": "Long short-term memory ["},
        {"kind": "cite", "bib": "bib.bib13", "text": "13"},
        {"kind": "text", "text": ", "},
        {"kind": "cite", "bib": "bib.bib2", "text": "2"},
        {"kind": "text", "text": "] is "},
    ]
    assert {"kind": "text", "text": "recurrent", "style": "italic"} in inlines
    assert {"kind": "ref", "target": "S3.F1", "text": "1"} in inlines
    assert {"kind": "link", "href": "https://github.com/tensorflow/tensor2tensor", "text": "the code"} in inlines


def test_footnotes_keep_their_content_without_the_repeated_mark():
    paragraph = _section(_parsed(), "S3.SS2")["blocks"][0]
    note = paragraph["inlines"][-1]
    assert note == {
        "kind": "note",
        "mark": "4",
        "inlines": [{"kind": "text", "text": "Dot products get large."}],
    }


def test_equations_carry_latex_and_their_number_one_block_per_row():
    blocks = _section(_parsed(), "S3.SS2")["blocks"]
    equations = [block for block in blocks if block["kind"] == "equation"]
    assert equations == [
        {
            "kind": "equation",
            "id": "S3.E1",
            "latex": "\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(QK^{T})V",
            "tag": "(1)",
        },
        {
            "kind": "equation",
            "id": "S3.Ex1",
            "latex": "\\mathrm{MultiHead}(Q,K,V) =\\mathrm{Concat}(h_1)W^{O}",
            "tag": "",
        },
    ]


def test_lists_drop_the_bullet_tag():
    blocks = _section(_parsed(), "S3.SS2")["blocks"]
    assert blocks[-1] == {
        "kind": "list",
        "ordered": False,
        "items": [[{"kind": "paragraph", "inlines": [{"kind": "text", "text": "In encoder-decoder attention."}]}]],
    }


def test_figures_carry_absolute_images_tag_and_caption():
    figure = _section(_parsed(), "S3")["blocks"][0]
    assert figure == {
        "kind": "figure",
        "id": "S3.F1",
        "tag": "Figure 1",
        "caption": [{"kind": "text", "text": "The Transformer - model architecture."}],
        "images": [
            {
                "src": f"{client.BASE_URL}/html/1706.03762/assets/Figures/ModalNet-21.png",
                "alt": "Refer to caption",
                "width": 912,
                "height": 1344,
            }
        ],
    }


def test_svg_panels_count_as_images():
    figure = _section(_parsed(), "S4")["blocks"][1]
    assert figure["tag"] == "Figure 3"
    assert [image["src"] for image in figure["images"]] == [f"{client.BASE_URL}/html/1706.03762/assets/heads.svg"]


def test_table_floats_carry_rows():
    table = _section(_parsed(), "S4")["blocks"][0]
    assert table["tag"] == "Table 1"
    assert table["images"] == []
    assert table["rows"] == [
        [{"inlines": [{"kind": "text", "text": "Layer Type"}], "header": True, "colspan": 2}],
        [
            {"inlines": [{"kind": "text", "text": "Self-Attention"}], "header": False},
            {"inlines": [{"kind": "math", "latex": "O(n^{2}\\cdot d)", "display": False}], "header": False},
        ],
    ]


def test_bibliography_entries_have_label_and_text():
    assert _parsed()["bibliography"] == [
        {
            "id": "bib.bib2",
            "label": "2",
            "text": [
                {
                    "kind": "text",
                    "text": "Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine "
                    "translation by jointly learning to align and translate. ",
                },
                {"kind": "text", "text": "CoRR", "style": "italic"},
                {"kind": "text", "text": ", abs/1409.0473, 2014."},
            ],
        }
    ]
    # The bibliography is its own list, not a section of the body.
    assert all(section["id"] != "bib" for section in _parsed()["sections"])


def test_a_page_with_no_body_is_unavailable():
    # ar5iv answers some failed conversions (1412.6980) with a 200 stub.
    stub = "<html><head><title>[1412.6980] Untitled Document</title></head><body><nav>x</nav></body></html>"
    assert document.parse_document(stub)["available"] is False


def test_get_document_parses_and_caches(monkeypatch):
    calls = []

    def fake_fetch(arxiv_id):
        calls.append(arxiv_id)
        return client.Render(html=_PAGE, url=f"{client.ARXIV_HTML_URL}/{arxiv_id}", source="arXiv")

    monkeypatch.setattr(client, "fetch_render", fake_fetch)
    first = document.get_document("1706.03762v7")
    second = document.get_document("1706.03762")
    assert first["available"] is True
    assert second == first
    # Credited to whoever rendered it, and its images resolved against that page.
    assert first["source"] == {"name": "arXiv", "url": "https://arxiv.org/html/1706.03762"}
    figure = first["sections"][1]["blocks"][0]
    assert figure["images"][0]["src"] == "https://arxiv.org/html/1706.03762/assets/Figures/ModalNet-21.png"
    assert calls == ["1706.03762"]  # version stripped, second read from cache


def test_get_document_caches_misses(monkeypatch):
    calls = []

    def fake_fetch(arxiv_id):
        calls.append(arxiv_id)

    monkeypatch.setattr(client, "fetch_render", fake_fetch)
    assert document.get_document("2401.00001")["available"] is False
    assert document.get_document("2401.00001")["available"] is False
    assert calls == ["2401.00001"]
    assert document.get_document("")["available"] is False


def _math(alttext: str) -> str:
    page = f'<section id="S1" class="ltx_section"><p><math alttext="{alttext}"></math></p></section>'
    return document.parse_document(page)["sections"][0]["blocks"][0]["inlines"][0]["latex"]


def test_box_wrappers_are_unwrapped_for_katex():
    # 1801.01290 (SAC): LaTeXML keeps the author's \resizebox in alttext.
    assert _math("\\displaystyle\\resizebox{22609920}{}{$\\hat{J}=\\frac{a}{b}$},") == (
        "\\displaystyle{\\hat{J}=\\frac{a}{b}},"
    )
    assert _math("\\scalebox{0.8}[1]{$x^2$}+y") == "{x^2}+y"
    # Unbalanced braces leave the formula as it was rather than guess.
    assert _math("\\resizebox{a}{b}{x") == "\\resizebox{a}{b}{x"


def test_macros_katex_lacks_are_swapped():
    assert _math("\\nicefrac{da}{du}") == "\\tfrac{da}{du}"
    assert _math("\\nicefracs") == "\\nicefracs"  # a longer name isn't the macro


def test_algorithm_lines_keep_their_number_and_indent():
    # Cut down from 2402.03300's GRPO algorithm: depth is em/en spaces.
    page = (
        '<section id="S1" class="ltx_section"><figure id="alg1" class="ltx_float">'
        '<div id="alg1.7" class="ltx_listing ltx_listing">'
        '<div class="ltx_listingline">\n  <span class="ltx_tag ltx_tag_listingline">2:</span>\n'
        '  <span class="ltx_text ltx_font_bold">for</span><span class="ltx_text"> each step </span>'
        '<span class="ltx_text ltx_font_bold">do</span>\n</div>'
        '<div class="ltx_listingline">\n  <span class="ltx_tag ltx_tag_listingline">3:</span>\n'
        '  <span class="ltx_text">\u2003\u2002reference model </span>'
        '<math alttext="\\pi_{ref}"></math>\n</div>'
        "</div><figcaption><span class=\"ltx_tag\">Algorithm 1: </span>GRPO</figcaption></figure></section>"
    )
    figure = document.parse_document(page)["sections"][0]["blocks"][0]
    assert figure["tag"] == "Algorithm 1"
    assert figure["blocks"] == [
        {
            "kind": "listing",
            "id": "alg1.7",
            "lines": [
                {
                    "number": "2",
                    "indent": 0.0,
                    "inlines": [
                        {"kind": "text", "text": "for", "style": "bold"},
                        {"kind": "text", "text": " each step "},
                        {"kind": "text", "text": "do", "style": "bold"},
                    ],
                },
                {
                    "number": "3",
                    "indent": 1.5,
                    "inlines": [
                        {"kind": "text", "text": "reference model "},
                        {"kind": "math", "latex": "\\pi_{ref}", "display": False},
                    ],
                },
            ],
        }
    ]
