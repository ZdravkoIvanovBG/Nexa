//! Input checks at the command boundary.
//!
//! The frontend sends only an endpoint name and an Apicalypse body. Both are
//! checked here, independently of the TypeScript query builder, so a
//! compromised or buggy page still can't:
//! - reach a host other than api.igdb.com (the URL is built from a fixed base
//!   and an allowlisted endpoint, both `'static`);
//! - call an endpoint Nexa doesn't use;
//! - send oversized bodies, control characters, escapes, unknown statements,
//!   unbalanced brackets or nested multiqueries.
//!
//! The accepted grammar is the subset `src/lib/providers/igdb/query.ts` emits.

/// Endpoints Nexa may call. Must match `IGDB_ENDPOINTS` in
/// `src/lib/providers/igdb/query.ts` (a test compares the two).
pub const IGDB_ENDPOINTS: &[&str] = &[
    "games",
    "games/count",
    "covers",
    "artworks",
    "screenshots",
    "game_videos",
    "genres",
    "themes",
    "platforms",
    "platform_families",
    "game_types",
    "game_statuses",
    "collections",
    "collection_memberships",
    "collection_membership_types",
    "collection_types",
    "franchises",
    "popularity_primitives",
    "popularity_types",
    "age_ratings",
    "age_rating_organizations",
    "age_rating_categories",
    "involved_companies",
    "companies",
    "search",
    "multiquery",
];

pub const MAX_BODY_BYTES: usize = 16_384;
pub const MAX_LIMIT: u64 = 500;
pub const MAX_OFFSET: u64 = 50_000;
pub const MAX_MULTIQUERY: usize = 10;
pub const MAX_FIELDS: usize = 200;
const MAX_STRING_CHARS: usize = 200;
const MAX_SEARCH_CHARS: usize = 100;
const MAX_DEPTH: usize = 16;

/// The allowlisted `'static` name, or None.
pub fn endpoint(name: &str) -> Option<&'static str> {
    IGDB_ENDPOINTS.iter().copied().find(|e| *e == name)
}

/// Twitch Client IDs and secrets are lowercase alphanumeric (30 characters
/// today). Allow some room for format changes, but nothing that could break
/// out of a header or form field.
fn credential_text(value: &str) -> bool {
    (8..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn client_id(value: &str) -> bool {
    credential_text(value)
}

pub fn client_secret(value: &str) -> bool {
    credential_text(value)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalid;

#[derive(Debug, Clone, PartialEq)]
enum Tok<'a> {
    Word(&'a str),
    Num(&'a str),
    Str(&'a str),
    Op(&'a str),
    Semi,
    Open,
    Close,
}

fn is_word_start(c: u8) -> bool {
    c.is_ascii_lowercase() || c == b'_'
}

fn is_word_char(c: u8) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'.'
}

fn tokenize(body: &str) -> Result<Vec<Tok<'_>>, Invalid> {
    let bytes = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        match c {
            b' ' => i += 1,
            b';' => {
                out.push(Tok::Semi);
                i += 1;
            }
            b'{' => {
                out.push(Tok::Open);
                i += 1;
            }
            b'}' => {
                out.push(Tok::Close);
                i += 1;
            }
            b'"' => {
                let start = i + 1;
                let len = body[start..].find('"').ok_or(Invalid)?;
                let text = &body[start..start + len];
                if text.chars().count() > MAX_STRING_CHARS {
                    return Err(Invalid);
                }
                out.push(Tok::Str(text));
                i = start + len + 1;
            }
            b'!' | b'<' | b'>' if bytes.get(i + 1) == Some(&b'=') => {
                out.push(Tok::Op(&body[i..i + 2]));
                i += 2;
            }
            b'=' | b'<' | b'>' | b'~' | b'&' | b'|' | b'(' | b')' | b',' | b'*' => {
                out.push(Tok::Op(&body[i..i + 1]));
                i += 1;
            }
            b'-' | b'0'..=b'9' => {
                let start = i;
                if c == b'-' {
                    i += 1;
                }
                let digits = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i == digits {
                    return Err(Invalid);
                }
                if bytes.get(i) == Some(&b'.') {
                    i += 1;
                    let frac = i;
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i == frac {
                        return Err(Invalid);
                    }
                }
                if bytes.get(i) == Some(&b'e') {
                    i += 1;
                    if matches!(bytes.get(i), Some(b'+') | Some(b'-')) {
                        i += 1;
                    }
                    let exp = i;
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i == exp {
                        return Err(Invalid);
                    }
                }
                if i < bytes.len() && is_word_char(bytes[i]) {
                    return Err(Invalid);
                }
                out.push(Tok::Num(&body[start..i]));
            }
            c if is_word_start(c) => {
                let start = i;
                while i < bytes.len() && is_word_char(bytes[i]) {
                    i += 1;
                }
                // `artworks.*`
                if bytes[i - 1] == b'.' && bytes.get(i) == Some(&b'*') {
                    i += 1;
                }
                out.push(Tok::Word(&body[start..i]));
            }
            _ => return Err(Invalid),
        }
    }
    Ok(out)
}

/// `name`, `a.b.c`, `a.*` or `*`. Lowercase snake case segments.
fn field_name(word: &str) -> bool {
    if word == "*" {
        return true;
    }
    let word = word.strip_suffix(".*").unwrap_or(word);
    !word.is_empty()
        && word.split('.').all(|seg| {
            let b = seg.as_bytes();
            !b.is_empty()
                && is_word_start(b[0])
                && b.iter()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
        })
}

fn query_name(text: &str) -> bool {
    (1..=32).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn uint(tok: Option<&Tok>, min: u64, max: u64) -> Result<(), Invalid> {
    match tok {
        Some(Tok::Num(n)) => {
            let value: u64 = n.parse().map_err(|_| Invalid)?;
            if (min..=max).contains(&value) {
                Ok(())
            } else {
                Err(Invalid)
            }
        }
        _ => Err(Invalid),
    }
}

/// Field list: `a, b.c, d.*` (or a bare `*` token).
fn field_list(toks: &[Tok]) -> Result<(), Invalid> {
    if toks.is_empty() {
        return Err(Invalid);
    }
    let mut count = 0;
    let mut expect_field = true;
    for tok in toks {
        match (expect_field, tok) {
            (true, Tok::Word(w)) if field_name(w) => {}
            (true, Tok::Op("*")) => {}
            (false, Tok::Op(",")) => {
                expect_field = true;
                continue;
            }
            _ => return Err(Invalid),
        }
        count += 1;
        expect_field = false;
    }
    if expect_field || count > MAX_FIELDS {
        return Err(Invalid);
    }
    Ok(())
}

/// A filter expression: fields, literals and operators with balanced parentheses.
fn where_clause(toks: &[Tok]) -> Result<(), Invalid> {
    if toks.is_empty() {
        return Err(Invalid);
    }
    let mut depth = 0usize;
    for tok in toks {
        match tok {
            Tok::Word(w) if field_name(w) => {}
            Tok::Num(_) | Tok::Str(_) => {}
            Tok::Op("(") => {
                depth += 1;
                if depth > MAX_DEPTH {
                    return Err(Invalid);
                }
            }
            Tok::Op(")") => depth = depth.checked_sub(1).ok_or(Invalid)?,
            Tok::Op(_) => {}
            _ => return Err(Invalid),
        }
    }
    if depth != 0 {
        return Err(Invalid);
    }
    Ok(())
}

/// One query: `keyword ...;` statements, each keyword at most once.
fn statements(toks: &[Tok]) -> Result<(), Invalid> {
    if toks.is_empty() {
        return Err(Invalid);
    }
    let mut seen: Vec<&str> = Vec::new();
    let mut rest = toks;
    while !rest.is_empty() {
        let end = rest.iter().position(|t| *t == Tok::Semi).ok_or(Invalid)?;
        let (stmt, tail) = (&rest[..end], &rest[end + 1..]);
        rest = tail;
        let Some(Tok::Word(keyword)) = stmt.first() else {
            return Err(Invalid);
        };
        if seen.contains(keyword) {
            return Err(Invalid);
        }
        let args = &stmt[1..];
        match *keyword {
            "fields" | "exclude" => field_list(args)?,
            "where" => where_clause(args)?,
            "sort" => match args {
                [Tok::Word(f), Tok::Word("asc" | "desc")] if field_name(f) => {}
                _ => return Err(Invalid),
            },
            "limit" if args.len() == 1 => uint(args.first(), 1, MAX_LIMIT)?,
            "offset" if args.len() == 1 => uint(args.first(), 0, MAX_OFFSET)?,
            "search" => match args {
                [Tok::Str(text)]
                    if !text.trim().is_empty() && text.chars().count() <= MAX_SEARCH_CHARS => {}
                _ => return Err(Invalid),
            },
            _ => return Err(Invalid),
        }
        seen.push(keyword);
    }
    // IGDB refuses sort with search; so does the TypeScript builder.
    if seen.contains(&"search") && seen.contains(&"sort") {
        return Err(Invalid);
    }
    Ok(())
}

/// `query <endpoint> "<name>" { ... };` repeated 1 to 10 times.
fn multiquery(toks: &[Tok]) -> Result<(), Invalid> {
    let mut names: Vec<&str> = Vec::new();
    let mut rest = toks;
    while !rest.is_empty() {
        let [Tok::Word("query"), Tok::Word(ep), Tok::Str(name), Tok::Open, tail @ ..] = rest else {
            return Err(Invalid);
        };
        match endpoint(ep) {
            Some("multiquery") | Some("search") | None => return Err(Invalid),
            Some(_) => {}
        }
        if !query_name(name) || names.contains(name) {
            return Err(Invalid);
        }
        names.push(name);
        let close = tail.iter().position(|t| *t == Tok::Close).ok_or(Invalid)?;
        let inner = &tail[..close];
        if inner.contains(&Tok::Open) {
            return Err(Invalid);
        }
        statements(inner)?;
        match tail.get(close + 1) {
            Some(Tok::Semi) => rest = &tail[close + 2..],
            _ => return Err(Invalid),
        }
    }
    if names.is_empty() || names.len() > MAX_MULTIQUERY {
        return Err(Invalid);
    }
    Ok(())
}

/// Validate a body for an allowlisted endpoint.
pub fn body(endpoint: &'static str, body: &str) -> Result<(), Invalid> {
    if body.is_empty() || body.len() > MAX_BODY_BYTES {
        return Err(Invalid);
    }
    // Plain printable text only: no control characters (including newlines
    // and Unicode line separators) and no escapes. The TypeScript builder
    // strips all of these from user text before building a query.
    if body
        .chars()
        .any(|c| c.is_control() || c == '\\' || c == '\u{2028}' || c == '\u{2029}')
    {
        return Err(Invalid);
    }
    let toks = tokenize(body)?;
    if endpoint == "multiquery" {
        multiquery(&toks)
    } else {
        if toks.iter().any(|t| matches!(t, Tok::Open | Tok::Close)) {
            return Err(Invalid);
        }
        statements(&toks)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_allowlist_is_exact() {
        assert_eq!(endpoint("games"), Some("games"));
        assert_eq!(endpoint("games/count"), Some("games/count"));
        for bad in [
            "",
            "Games",
            "games ",
            " games",
            "games/",
            "games/../covers",
            "../games",
            "games?fields=*",
            "games#x",
            "https://evil.example/games",
            "//evil.example/games",
            "api.igdb.com/v4/games",
            "characters",
            "webhooks",
            "games\n",
            "games%2F..",
        ] {
            assert_eq!(endpoint(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn rust_allowlist_matches_the_typescript_one() {
        let ts = include_str!("../../../src/lib/providers/igdb/query.ts");
        let start = ts.find("export const IGDB_ENDPOINTS = [").unwrap();
        let end = start + ts[start..].find("] as const").unwrap();
        let listed: Vec<&str> = ts[start..end]
            .lines()
            .skip(1)
            .map(|l| l.trim().trim_end_matches(',').trim_matches('"'))
            .filter(|l| !l.is_empty())
            .collect();
        assert_eq!(listed, IGDB_ENDPOINTS);
    }

    #[test]
    fn accepts_every_body_the_typescript_builder_emits() {
        let fixture = include_str!("../../../tests/fixtures/igdb-query-bodies.json");
        let cases: Vec<(String, String)> = serde_json::from_str::<serde_json::Value>(fixture)
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                (
                    c["endpoint"].as_str().unwrap().to_string(),
                    c["body"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert!(cases.len() >= 10);
        for (ep, b) in cases {
            let ep = endpoint(&ep).expect("fixture endpoint is allowlisted");
            assert_eq!(body(ep, &b), Ok(()), "{ep}: {b}");
        }
    }

    #[test]
    fn rejects_malformed_and_malicious_bodies() {
        let bad: &[(&str, &str)] = &[
            ("games", ""),
            ("games", " "),
            ("games", "fields name"),
            ("games", "fields name;;"),
            ("games", "fields name; fields slug;"),
            ("games", "fields Name;"),
            ("games", "fields name,;"),
            ("games", "fields ,name;"),
            ("games", "fields name slug;"),
            ("games", "fields name; drop games;"),
            ("games", "fields name;\nwhere id = 1;"),
            ("games", "fields name; where name = \"a\\\"; fields *;"),
            ("games", "fields name; where name = \"unterminated;"),
            ("games", "fields name; where (id = 1;"),
            ("games", "fields name; where id = 1);"),
            ("games", "fields name; where ;"),
            ("games", "fields name; where id = 1 # 2;"),
            ("games", "fields name; where id = 0x10;"),
            ("games", "fields name; where id = 1abc;"),
            ("games", "fields name; limit 0;"),
            ("games", "fields name; limit 501;"),
            ("games", "fields name; limit -1;"),
            ("games", "fields name; limit 1.5;"),
            ("games", "fields name; limit 1 2;"),
            ("games", "fields name; offset 50001;"),
            ("games", "fields name; sort name up;"),
            ("games", "fields name; sort name;"),
            ("games", "fields name; search \"\";"),
            ("games", "fields name; search \"zelda\"; sort name asc;"),
            ("games", "fields name; search zelda;"),
            ("games", "query games \"a\" { fields name; };"),
            ("games", "fields name; { };"),
            ("games", "fields name\u{0000};"),
            ("games", "fields name\u{2028};"),
            ("games", "fields name; where name ~ *\"\u{001b}[2J\"*;"),
            ("multiquery", "fields name;"),
            ("multiquery", "query games \"a\" { fields name; }"),
            (
                "multiquery",
                "query games \"a\" { fields name; }; query games \"a\" { fields name; };",
            ),
            ("multiquery", "query multiquery \"a\" { fields name; };"),
            ("multiquery", "query search \"a\" { fields name; };"),
            ("multiquery", "query characters \"a\" { fields name; };"),
            ("multiquery", "query games \"a b\" { fields name; };"),
            (
                "multiquery",
                "query games \"a\" { query games \"b\" { fields name; }; };",
            ),
            (
                "multiquery",
                "query games \"a\" { fields name; limit 900; };",
            ),
        ];
        for (ep, b) in bad {
            assert_eq!(body(endpoint(ep).unwrap(), b), Err(Invalid), "{ep}: {b:?}");
        }
    }

    #[test]
    fn multiquery_is_capped_at_ten() {
        let sub = |i: usize| format!("query games \"q{i}\" {{ fields name; limit 1; }};");
        let ten: String = (0..10).map(sub).collect::<Vec<_>>().join(" ");
        assert_eq!(body("multiquery", &ten), Ok(()));
        let eleven: String = (0..11).map(sub).collect::<Vec<_>>().join(" ");
        assert_eq!(body("multiquery", &eleven), Err(Invalid));
    }

    #[test]
    fn oversized_bodies_are_rejected() {
        let fields = "a,".repeat(MAX_BODY_BYTES / 2);
        let huge = format!("fields {fields}name;");
        assert!(huge.len() > MAX_BODY_BYTES);
        assert_eq!(body("games", &huge), Err(Invalid));
        let too_many = format!("fields {}name;", "a,".repeat(MAX_FIELDS));
        assert!(too_many.len() <= MAX_BODY_BYTES);
        assert_eq!(body("games", &too_many), Err(Invalid));
    }

    #[test]
    fn credential_format() {
        assert!(client_id("abcdefghij0123456789klmnopqrst"));
        assert!(client_secret("ABCdef0123456789_-xyz"));
        for bad in [
            "",
            "short",
            "has space inside",
            "new\nline00000",
            "quote\"000000",
            "colon:000000",
            "ünïcode00000",
        ] {
            assert!(!client_id(bad), "{bad:?}");
            assert!(!client_secret(bad), "{bad:?}");
        }
        assert!(!client_id(&"a".repeat(129)));
    }
}
