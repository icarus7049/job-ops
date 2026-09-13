#let source = json(__RESUME_DATA_PATH__)

#let ink = rgb("#17191c")
#let ink-soft = rgb("#3d4349")
#let ink-mute = rgb("#5b6169")
#let accent = rgb("#22466a")
#let rule = rgb("#c3c9d0")
#let sans = "DejaVu Sans"
#let serif = "Libertinus Serif"

// Tracks the employer whose entries are currently being laid out, so a page
// that continues mid-employer can name it in the running header instead of
// starting with orphaned role titles.
#let cur-employer = state("cur-employer", "")

#let text-of(value) = if value == none { "" } else { value }
#let list-of(value) = if value == none { () } else { value }
#let text-of-item(item, key) = text-of(item.at(key, default: ""))
#let title-of(key, fallback) = {
  let titles = source.at("sectionTitles", default: (:))
  text-of(titles.at(key, default: fallback))
}

#let markup-text(value) = {
  if type(value) == str { eval(value, mode: "markup") } else { value }
}

#let link-or-text(label, url) = {
  if url == "" { label } else { link(url)[#label] }
}

#let joined-content(items, separator) = {
  for (index, item) in items.enumerate() {
    if index > 0 { separator }
    item
  }
}

#let section-heading(title) = [
  #block(breakable: false)[
    #v(8pt)
    #text(font: sans, size: 9.5pt, weight: "bold", tracking: 1.05pt, fill: accent)[#upper(title)]
    #v(2.5pt)
    #line(length: 100%, stroke: 0.75pt + rule)
    #v(5pt)
  ]
]

#let is-role-heading(value) = value.trim().starts-with("#strong[")

#let role-heading(value) = {
  let clean = value.trim()
  let inner = clean.slice(8, clean.len() - 1)
  let parts = inner.split(" | ")
  let role-title = parts.first()
  let role-date = if parts.len() > 1 { parts.last() } else { "" }

  block(breakable: false, above: 5pt, below: 3pt)[
    #grid(
      columns: (1fr, auto),
      column-gutter: 12pt,
      align: (left + horizon, right + horizon),
      [#text(font: sans, size: 10pt, weight: "bold", fill: accent)[#markup-text(role-title)]],
      [#if role-date != "" [#text(font: sans, size: 9pt, fill: ink-soft)[#markup-text(role-date)]]],
    )
  ]
}

#let bullets-of(entry) = {
  let bullets = list-of(entry.at("bullets", default: ()))
    .filter(item => text-of(item) != "")
  let has-role-headings = false
  for item in bullets {
    if is-role-heading(item) { has-role-headings = true }
  }

  for (index, item) in bullets.enumerate() {
    let clean = item.trim()
    if clean.starts-with("•") or clean.starts-with("-") {
      clean = clean.slice(1).trim()
    }
    if is-role-heading(clean) {
      role-heading(clean)
    } else if has-role-headings and index == 0 {
      block(breakable: false, above: 1pt, below: 5pt)[
        #set text(size: 9.5pt, fill: ink-soft)
        #set par(leading: 3pt)
        #emph[#markup-text(clean)]
      ]
    } else {
      block(breakable: false, above: 0pt, below: 2.5pt)[
        #grid(
          columns: (9.5pt, 1fr),
          column-gutter: 3pt,
          align: (left + top, left + top),
          [#text(fill: accent)[–]],
          [#block[#markup-text(clean)]],
        )
      ]
    }
  }
}

#let entry-block(entry, project: false, track: false) = {
  let title = text-of-item(entry, "title")
  let url = text-of-item(entry, "url")
  let subtitle = text-of-item(entry, "subtitle")
  let secondary-title = text-of-item(entry, "secondaryTitle")
  let secondary-subtitle = text-of-item(entry, "secondarySubtitle")
  let date = text-of-item(entry, "date")
  // join() on an empty array yields `none`, not "" — which both defeats an
  // `!= ""` guard and renders as nothing, leaving an orphaned separator.
  let subline-parts = (subtitle, secondary-title, secondary-subtitle)
    .filter(value => value != "")
  let subline = if subline-parts.len() == 0 { "" } else { subline-parts.join(" · ") }

  // Group separation must exceed the internal title→subline gap, or the
  // subline reads as a heading for the NEXT entry rather than as attribution
  // for its own.
  block(breakable: not project, below: if project { 9pt } else { 8pt })[
    #if track [#cur-employer.update(title)]
    #block(breakable: false)[
      #grid(
        columns: (1fr, auto),
        column-gutter: 12pt,
        align: (left + horizon, right + horizon),
        [#text(
          font: sans,
          size: if project { 9.5pt } else { 10.5pt },
          weight: "bold",
          tracking: if project { 0pt } else { 0.25pt },
          fill: ink,
        )[#link-or-text(title, url)]#if project and subline.trim() != "" [
          // Inline attribution. Stacked, the issuer sits equidistant between
          // its own credential and the next one, so proximity cannot say which
          // it belongs to. On the same line the association is unambiguous.
          #text(font: sans, size: 8.6pt, weight: "regular", fill: ink-mute)[ · #subline]
        ]],
        [#text(font: sans, size: 8.8pt, weight: if project { "regular" } else { "bold" }, fill: ink-soft)[#date]],
      )
      // Non-project entries keep the stacked accent subline (a role under an
      // employer). Project entries render it inline above instead.
      #if subline.trim() != "" and not project [
        #v(2pt)
        #text(font: sans, size: 10pt, weight: "bold", fill: accent)[#subline]
        #v(3pt)
      ]
    ]
    #bullets-of(entry)
  ]
}

#let entries-section(key, fallback, entries, project: false, track: false) = {
  if entries.len() > 0 [
    #section-heading(title-of(key, fallback))
    #for entry in entries [#entry-block(entry, project: project, track: track)]
  ]
}

#let line-section(key, fallback, entries, renderer) = {
  if entries.len() > 0 [
    #section-heading(title-of(key, fallback))
    #for entry in entries [
      #block(breakable: false, below: 3.5pt)[#renderer(entry)]
    ]
  ]
}

#let contact-items = list-of(source.at("contactItems", default: ()))
#let profile-items = list-of(source.at("profileItems", default: ()))
#let contact-content = ()
#let location = text-of(source.at("location", default: ""))
#if location != "" {
  contact-content.push(location)
}
#for item in contact-items {
  let label = text-of-item(item, "text")
  if label != "" {
    contact-content.push(link-or-text(label, text-of-item(item, "url")))
  }
}
#for item in profile-items {
  let network = text-of-item(item, "network")
  let username = text-of-item(item, "username")
  let url = text-of-item(item, "url")
  let label = if username != "" { username } else if network != "" { network } else { url }
  if label != "" {
    contact-content.push(link-or-text(label, url))
  }
}

#set page(
  paper: "us-letter",
  margin: (top: 0.48in, right: 0.62in, bottom: 0.58in, left: 0.62in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(font: sans, size: 7.5pt, fill: ink-mute, tracking: 0.45pt)
      #grid(
        columns: (1fr, auto),
        [#upper(text-of(source.at("name", default: "")))],
        // Name the employer still in progress. Page 2 otherwise opens on bare
        // role titles with no clue whose roles they are.
        [#{
          let emp = cur-employer.at(here())
          if emp != "" [#upper(emp) — CONTINUED] else [EXECUTIVE RESUME — CONTINUED]
        }],
      )
      #v(3pt)
      #line(length: 100%, stroke: 0.5pt + rule)
    ]
  },
  footer: context [
    #set text(font: sans, size: 7.5pt, fill: ink-mute, tracking: 0.45pt)
    #line(length: 100%, stroke: 0.5pt + rule)
    #v(3pt)
    #grid(
      columns: (1fr, auto),
      [#upper(text-of(source.at("name", default: ""))) — EXECUTIVE RESUME],
      [PAGE #counter(page).display("1") OF #counter(page).final().first()],
    )
  ],
)
#set text(font: serif, size: 10pt, fill: ink, lang: "en")
#set par(leading: 3.2pt, justify: false)
#show link: set text(fill: accent)

#block(breakable: false)[
  #text(font: sans, size: 22pt, weight: "bold", tracking: 1.15pt, fill: ink)[
    #upper(text-of(source.at("name", default: "")))
  ]
  #v(4pt)
  #let headline = text-of(source.at("headline", default: ""))
  #if headline != "" [
    #text(font: sans, size: 9.5pt, weight: "bold", tracking: 1.05pt, fill: accent)[#upper(headline)]
    #v(5pt)
  ]
  #if contact-content.len() > 0 [
    #text(font: sans, size: 8.8pt, fill: ink-soft)[
      #joined-content(contact-content, [#h(4pt)#text(fill: rule)[|]#h(4pt)])
    ]
    #v(6pt)
  ]
  #line(length: 100%, stroke: 1.5pt + accent)
  #v(2pt)
]

#let summary = text-of(source.at("summary", default: ""))
#if summary != "" [
  #section-heading(title-of("summary", "Executive Profile"))
  #markup-text(summary)
]

#let custom-fields = list-of(source.at("customFieldItems", default: ()))
#line-section("customFields", "Core Competencies", custom-fields, entry => {
  let title = text-of-item(entry, "title")
  let value = text-of-item(entry, "text")
  if title == "" { value } else [
    #text(font: sans, size: 9pt, weight: "bold", fill: accent)[#title:] #value
  ]
})

#let skill-groups = list-of(source.at("skillGroups", default: ()))
#let core-groups = skill-groups.filter(group => text-of-item(group, "name").contains("Leadership"))
#let technology-groups = skill-groups.filter(group => not text-of-item(group, "name").contains("Leadership"))

#if core-groups.len() > 0 [
  #section-heading("Core Competencies")
  #let core-keywords = list-of(core-groups.at(0).at("keywords", default: ()))
  // The separator is glued to the keyword it follows inside a box, so a wrap
  // can never start a line with an orphaned "|".
  #for (index, keyword) in core-keywords.enumerate() [
    #box[#keyword#if index < core-keywords.len() - 1 [#h(3pt)#text(font: sans, weight: "bold", fill: accent)[|]]]
    #if index < core-keywords.len() - 1 [ ]
  ]
]

#entries-section("experience", "Professional Experience", list-of(source.at("experience", default: ())), track: true)
#entries-section("projects", "Selected Projects", list-of(source.at("projects", default: ())), project: true)

#line-section("skills", "Technology", technology-groups, group => [
  #text(font: sans, size: 9pt, weight: "bold", fill: accent)[#text-of-item(group, "name"):] #list-of(group.at("keywords", default: ())).join(", ")
])

#entries-section("education", "Education", list-of(source.at("education", default: ())))
#entries-section("certifications", "Certifications", list-of(source.at("certifications", default: ())), project: true)
#entries-section("awards", "Awards", list-of(source.at("awards", default: ())), project: true)
#entries-section("publications", "Publications", list-of(source.at("publications", default: ())), project: true)
#entries-section("volunteer", "Volunteer", list-of(source.at("volunteer", default: ())), project: true)
#entries-section("references", "References", list-of(source.at("references", default: ())), project: true)

#let languages = list-of(source.at("languages", default: ()))
#line-section("languages", "Languages", languages, item => [
  #text(font: sans, size: 9pt, weight: "bold", fill: accent)[#text-of-item(item, "language"):] #text-of-item(item, "fluency")
])

#let interests = list-of(source.at("interests", default: ()))
#line-section("interests", "Interests", interests, item => [
  #text(font: sans, size: 9pt, weight: "bold", fill: accent)[#text-of-item(item, "name"):] #list-of(item.at("keywords", default: ())).join(", ")
])
