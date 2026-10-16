# Publication boundaries

This specification is intended to be reviewable in a public repository. It contains functional requirements, proposed architecture, public vendor references, source-relative implementation pointers and qualification targets. A target is not a statement about a customer's infrastructure or account agreement.

## Private working material

Raw discussions, session provenance, internal audit correspondence, account entitlements, actual host inventory, credential material, private workloads and unsanitised validation output belong in an ignored local companion or an approved private store. They are not prerequisites for reading, building or validating the public specification.

The repository ignores `spec/hyperfide/private/`, local temporary inputs, runtime context and credential-state paths, and environment-specific dotenv files. Template dotenv files may be committed only with non-secret example values. Ignore rules do not remove files already tracked and do not prevent deliberate forced addition; publication review must inspect Git's tracked and candidate file lists.

Actual deployment settings are supplied by private manifests and secret references. Do not embed account IDs, tokens, private endpoints, native session state, machine paths, negotiated limits or operational inventory in examples. Public scale figures describe qualification profiles. Public model names describe documented integrations; private deployment aliases are configuration.

## Validation and publication

Run the public authoring validator and native spec lint without requiring private transcripts or local session files. Inspect the resulting public file list for sensitive content. The [publication check](evidence/publication-check.json) records the latest targeted scan and ignore/tracking probes, including their limits. Preserve private audit evidence separately when required for internal review; never copy raw private evidence into a public validation report.

Implementation approval is recorded in the native specification. Neither sanitisation nor structural validation grants provider/model permissions or production qualification. Raw execution artifacts remain private; public summaries contain reviewed source and outcome identities only.
