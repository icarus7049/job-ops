#let source = json(__RESUME_DATA_PATH__)

#let ink = rgb("#17191c")
#let ink-soft = rgb("#3d4349")
#let ink-mute = rgb("#5b6169")
#let accent = rgb("#22466a")
#let rule = rgb("#c3c9d0")
#let sans = "DejaVu Sans"
#let serif = "Libertinus Serif"

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
    #v(7pt)
    #text(font: sans, size: 9.5pt, weight: "bold", tracking: 1.05pt, fill: accent)[#upper(title)]
    #v(1.6pt)
    #line(length: 100%, stroke: 0.75pt + rule)
    #v(4pt)
  ]
]

#let bullets-of(entry) = {
  let bullets = list-of(entry.at("bullets", default: ()))
    .filter(item => text-of(item) != "")
  for item in bullets {
    let clean = item.trim()
    if clean.starts-with("•") or clean.starts-with("-") {
      clean = clean.slice(1).trim()
    }
    if clean.starts-with("#strong[") {
      block(breakable: false, above: 1pt, below: 1.5pt)[
        #text(font: sans, size: 9.25pt, weight: "bold", fill: accent)[#markup-text(clean)]
      ]
    } else {
      block(breakable: false, above: 0pt, below: 1.5pt)[
        #grid(
          columns: (10pt, 1fr),
          column-gutter: 2.5pt,
          align: (left + top, left + top),
          [#text(fill: accent)[–]],
          [#markup-text(clean)],
        )
      ]
    }
  }
}

#let entry-block(entry, project: false) = {
  let title = text-of-item(entry, "title")
  let url = text-of-item(entry, "url")
  let subtitle = text-of-item(entry, "subtitle")
  let secondary-title = text-of-item(entry, "secondaryTitle")
  let secondary-subtitle = text-of-item(entry, "secondarySubtitle")
  let date = text-of-item(entry, "date")
  let subline = (subtitle, secondary-title, secondary-subtitle)
    .filter(value => value != "")
    .join(" · ")

  block(breakable: not project, below: if project { 4.5pt } else { 6pt })[
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
        )[#link-or-text(title, url)]],
        [#text(font: sans, size: 8.8pt, weight: if project { "regular" } else { "bold" }, fill: ink-soft)[#date]],
      )
      #if subline != "" [
        #v(1.2pt)
        #text(font: sans, size: 9.25pt, weight: "bold", fill: accent)[#subline]
        #v(2.2pt)
      ]
    ]
    #bullets-of(entry)
  ]
}

#let entries-section(key, fallback, entries, project: false) = {
  if entries.len() > 0 [
    #section-heading(title-of(key, fallback))
    #for entry in entries [#entry-block(entry, project: project)]
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
  margin: (top: 0.48in, right: 0.62in, bottom: 0.48in, left: 0.62in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(font: sans, size: 7.5pt, fill: ink-mute, tracking: 0.45pt)
      #grid(
        columns: (1fr, auto),
        [#upper(text-of(source.at("name", default: "")))],
        [EXECUTIVE RESUME — CONTINUED],
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
#set par(leading: 0.27em, justify: false)
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
  #for (index, keyword) in list-of(core-groups.at(0).at("keywords", default: ())).enumerate() [
    #if index > 0 [#h(2pt)#text(font: sans, weight: "bold", fill: accent)[|]#h(2pt)]
    #keyword
  ]
]

#entries-section("experience", "Professional Experience", list-of(source.at("experience", default: ())))
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
