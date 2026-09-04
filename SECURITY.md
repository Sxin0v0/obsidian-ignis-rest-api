# Security Policy

## Supported versions

Security fixes are provided for the latest published major/minor release of
this community port. Older development artifacts are not supported.

## Reporting a vulnerability

Please do not disclose API keys, access tokens, cookies, vault contents, or
other secrets in a public issue.

When available, use GitHub's **Private vulnerability reporting** feature for
this repository. If private reporting is unavailable, open a public issue that
contains only a non-sensitive description and ask the maintainers for a private
channel before sharing exploit details.

Include, when safe to do so:

- affected version;
- Ignis version;
- reproduction steps using placeholder credentials and example data;
- impact assessment;
- any proposed mitigation.

## Credential handling

`IGNIS_LOCAL_REST_API_KEY` grants remote access to the configured Vault API.
Use a long random value, keep it out of source control, and rotate it after any
suspected exposure. `.env` files are ignored by Git; `.env.example` contains
placeholders only.
