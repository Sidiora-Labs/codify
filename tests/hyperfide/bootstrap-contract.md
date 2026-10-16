# Qualification bootstrap contract

Task 27.1 supplies an executable task-component of V-056. Its PASS establishes the registered harness checks below; it does not establish full V-056, provider support, production qualification, or programme completion.

## Running the bootstrap

Run these commands in the authorised remote checkout:

    python3 tests/hyperfide/selftest_harness.py
    python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/27.1.json

The first command executes standard-library subprocess fixtures without cloud, model, or database prerequisites. The registered task probe runs the same checks and emits their exact assertion inventory as JSON Lines. It uses temporary roots and executable probes rather than source-text matches. Required runner/checker files must exist. Failed setup, failed assertions, missing outcomes, or incomplete cleanup fail nonzero.

Default campaign directories are fingerprinted by the actual Git HEAD, dirty and untracked worktree content, reviewed source-root inventories and explicit input/source pins. Distinct relevant inputs produce a separate default campaign; an explicit --output-dir remains an immutable campaign and refuses changed snapshots. The manifest pins the runner, canonical checker, task probe, self-test and manifest-schema file bytes. The registration explicitly declares source_files and source_roots. The runner inventories all files within those reviewed roots, including untracked implementation helpers, while excluding generated output and Python bytecode. The checker verifies the selected receipt against current source identity. Dependencies outside the reviewed roots require explicit input/source pins; this bootstrap does not claim arbitrary import discovery outside its declared inventory. Relevant source edits require updated reviewed input pins and a new immutable campaign output directory; existing results remain historical. The registration fixes the case, scope, argument vector, timeout and assertion inventory. A selector cannot silently narrow that inventory. Fixture probes use an explicitly unversioned task-component root and make no product revision or full-case claim.

## Registered checks

The 49 assertion IDs in registrations/27.1.json correspond, in order, to these actual subprocess experiments:

1. Reject absent selector.
2. Reject unknown case.
3. Reject empty case selector.
4. Reject duplicate case selection.
5. Reject a suite resolving to zero cases.
6. An absent runner executable cannot pass.
7. Reject an absent child executable/script.
8. Reject an absent canonical independent checker using a copied runner with no sibling checker file.
9. Reject an absent required fixture.
10. Reject a changed fixture whose digest no longer matches its pin.
11. Reject an absent required credential variable.
12. Propagate a failed child exit even after successful assertion events.
13. Terminate a timed-out process group, independently observing termination of a SIGTERM-resistant descendant.
14. Reject zero executed assertions.
15. Reject a duplicate assertion ID.
16. Reject an unexecuted registered assertion.
17. Reject an assertion with an unexpected actual value.
18. Reject malformed assertion output.
19. Reject missing cleanup evidence.
20. Reject a failed cleanup subprocess and its incomplete cleanup event.
21. Reject a missing recorded artifact.
22. Reject changed artifact bytes.
23. Reject a changed unsealed receipt.
24. Reject a component-to-full-case scope forgery even after the attacker recomputes its seal.
25. Reject a removed assertion inventory entry even after its seal is recomputed.
26. Reject changed immutable registry snapshot bytes.
27. Append a distinct receipt/check for a second valid run while preserving every earlier evidence byte.
28. Reject reusing the same campaign after a manifest policy change, preserving previous receipts.
29. Execute the registered task selector successfully with explicit component scope.
30. Execute the registered suite selector successfully with explicit component scope.
31. Preserve a failed first-attempt receipt and accept a subsequently valid selected retry without counting failed history as coverage.
32. Reject substitution of a fake successful checker, including the exact attack that reverses the registered assertion order.
33. Reject a probe that exits successfully after leaving a detached-stdio descendant; independently confirm the descendant no longer executes.
34. Reject stale evidence after an explicitly declared and pinned imported helper changes.
35. Reject stale evidence after an undeclared, untracked imported helper within a reviewed source root changes.
36. Accept explicitly approved retention of a real local fixture file with owner and UTC expiry; independently confirm that file remains, then remove it as self-test teardown.
37. Reject retaining that resource without approval.
38. Reject retained resource evidence missing its owner.
39. Reject retained resource evidence missing its expiry.
40. Reject a boolean registry schema version masquerading as integer 1.
41. Reject a boolean registration schema version.
42. Reject a boolean manifest schema version.
43. Reject boolean input size even when its numeric value equals the actual one-byte file length.
44. Reject unknown manifest fields.
45. Reject unknown approval fields.
46. Reject using the workspace itself as the output directory, which would exclude all source from inventory.
47. Reject an output directory containing registered implementation source, which would hide that source under an output exclusion.
48. Reject timeout with a detached-session descendant retaining stdout/stderr pipes, and independently confirm that descendant no longer executes.
49. In a real temporary Git repository, accept generated untracked Python bytecode while rejecting a subsequent tracked imported-helper change; runner/checker source-inventory exclusions must agree.
50. Run two selected cases in one campaign with genuinely different required-artifact bytes; retain both receipts and independently verify both immutable snapshots.
51. Reject tampering with an older required-artifact snapshot after a later receipt succeeds.
52. Reject logical artifact aliases that do not bind to their exact receipt snapshot path.
53. Preserve actual disposable-resource absence evidence through a receipt snapshot after mutable scratch output changes.

## Evidence and independent checking

A run directory contains immutable manifest.json, registry.json and registration.json snapshots, receipts/<id>.json, artifacts/<id>/ logs and event trace, and a separate checks/<id>.json independent-check result. Required probe artifacts are copied into artifacts/<id>/required/<logical-name>; strict logical aliases preserve registered artifact and cleanup-evidence references without pointing historical receipts at mutable scratch files. Receipts form a sequence and previous-seal chain. The checker reconstructs assertions from raw child output, validates exact inventories and input/artifact hashes, and checks scope against the registration and manifest. Recomputing a receipt seal does not authorise an altered assertion or scope.

The runner accepts only its canonical sibling independent checker; an arbitrary successful executable cannot replace it. Any descendant left by a normally exiting probe is terminated and reported as a failure of cleanup, even if the probe emitted a successful cleanup event.

Probe receipts are explicitly CANDIDATE results. The independent check binds the candidate receipt bytes, checker bytes and checker outputs; only successful independent checking makes the runner summary PASS. Candidate outcome alone is insufficient qualification evidence. A failed checker yields a failing gate and retained diagnostic evidence.

The checker validates the entire receipt chain, then applies the selected receipt (or latest receipt) outcome. Historical failures remain visible and cannot count as coverage, but do not permanently invalidate a coherent successful retry. Editing historical evidence fails integrity even when a later receipt passes. Failed or blocked attempts never become implicit success or skipped required coverage.

For an independent verification of a result directory:

    python3 tests/hyperfide/check-evidence.py --campaign <result-directory>

The optional --receipt ID selects an exact attempt while retaining whole-chain integrity checking.

## Limits and operational handling

Bootstrap fixtures deliberately simulate only controlled child behavior. No paid model calls, provider creation, production database writes or real fleet-load claims are part of these tests. Provisioning and remote workspace identity belong to the supervisory bootstrap ledger; this public contract contains no credentials, private account inventory or raw operational logs. Raw execution artifacts remain in the ignored evidence store. Publish reviewed summaries and exact revisions separately.

Process cleanup observation uses Linux process-state evidence and treats a zombie as no longer executing; resource reaping remains an operating-system responsibility. The subprocess timeout is bounded, and the test independently kills any surviving injected descendant on failure. This test does not claim provider resource cleanup, which requires the provider-specific campaigns.

Explicit local retention uses approval.allow_retained_resources, matching resource IDs in registration/manifest and cleanup evidence with status retained, owner and valid UTC expiry. This is a local-file contract fixture only. It establishes no provider deletion, provider inventory reconciliation or cloud teardown claim. The supervisory bootstrap resource has its separate private lifecycle ledger.

Receipt seals provide canonical content and chain-integrity checks against the retained inventory; they are not authenticated authorship and do not resist an attacker rewriting an entire unanchored evidence store. External trusted anchoring, signed publication and durable artifact authority require their later implementation and qualification. A component receipt and its independent check must be consumed together with the command exit status.

Linux child-subreaper supervision kills and reaps surviving descendants after normal exit and timeout, including a detached-session child holding pipes open. A leak remains a failed cleanup outcome after termination. Source coverage is limited to reviewed roots, worktree inventory and explicit pins; ignored or outside-root dependencies require declared pins. Complete prepared-environment provenance is supplied by task11.1 and is not established by this bootstrap component.

The disposable Git fixture disables background auto-maintenance, automatic garbage collection, ambient hooks and commit signing so source-inventory tests do not launch unrelated daemon processes. This fixture policy does not relax the runner’s rejection of surviving probe descendants.
