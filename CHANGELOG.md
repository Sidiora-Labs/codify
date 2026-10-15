# Changelog

All notable changes to this project are recorded here, generated from git history.
A release is a tag or a version bump; a group is the commit-subject prefix; a task
reference is the `[spec:<feature>/<task>]` a snapshot or fleet worker tagged the commit with.

## [1.6.0] - 2026-10-15

### Features
- **index:** Capture literal native registration facts ([dcb3b3f](https://github.com/Sidiora-Labs/codify/commit/dcb3b3fb9b375242523f0b896dec6e93f8acb7e3), task codify-v16/2.4)
- **index:** Preserve systems declaration metadata ([763f79a](https://github.com/Sidiora-Labs/codify/commit/763f79ad7815f409a4d68bf5e1d5c74ece0bbfa9), task codify-v16/2.4)
- **index:** Add systems syntax adapters ([6210295](https://github.com/Sidiora-Labs/codify/commit/6210295747be8503e614c74d5a885a9280d29d2e), task codify-v16/2.4)
- **index:** Project syntax facts into existing index records ([8d46612](https://github.com/Sidiora-Labs/codify/commit/8d46612c916962f5b61a9710bbfa73cd0a9e0451), task codify-v16/2.2)
- **index:** Add extended language syntax adapters ([2ad5668](https://github.com/Sidiora-Labs/codify/commit/2ad56689f7f317f9f38c5f3c50b30d5ff09ff08c), task codify-v16/2.7)
- **index:** Embed native syntax runtime and adapter registry ([cfce3ea](https://github.com/Sidiora-Labs/codify/commit/cfce3ead0da421ae9233631fdb1b810fb1189af5), task codify-v16/2.2)

### Bug fixes
- **index:** Preserve literal declarative reference addresses ([fa130e5](https://github.com/Sidiora-Labs/codify/commit/fa130e5c0d62267619841a85f9b478e23027e981), task codify-v16/2.7)
- **index:** Preserve systems parser compatibility and linear traversal ([d7d0853](https://github.com/Sidiora-Labs/codify/commit/d7d085358d041771f3a3c37b668132cb3b6fc4de), task codify-v16/2.4)
- **index:** Bound extended syntax ownership and child scans ([2d30de9](https://github.com/Sidiora-Labs/codify/commit/2d30de97ab6f0674a928ff93f8afb1bfb2174d88), task codify-v16/2.7)
- **index:** Record explicit C++ method overrides ([6b9d2e4](https://github.com/Sidiora-Labs/codify/commit/6b9d2e404adf66f4a07c5fb20c889937881c14e4), task codify-v16/2.4)
- **index:** Run unit tests against native adapters ([78c938c](https://github.com/Sidiora-Labs/codify/commit/78c938cbda4d33e23c04a7187105d1d2f75183c9), task codify-v16/2.2)
- **index:** Handle file-only fallback and verify index lifecycle ([069393b](https://github.com/Sidiora-Labs/codify/commit/069393b113f583d975c0ade648687bc0445f2da7), task codify-v16/2.2)
- **index:** Propagate parser coverage and complete syntax integration ([6f5deb2](https://github.com/Sidiora-Labs/codify/commit/6f5deb2cb46f75b9e4bc6c1b52adadcf5760ba10), task codify-v16/2.2)
- **index:** Bound systems signatures ([74cae77](https://github.com/Sidiora-Labs/codify/commit/74cae773929e130c8c1227820a01e088ec9d29c3), task codify-v16/2.4)

### Documentation
- **index:** Record literal resource address coverage ([5d1bed4](https://github.com/Sidiora-Labs/codify/commit/5d1bed408b2f47482a2c9e09435b39b26bb4a1bd), task codify-v16/2.7)
- Codify-v15 closed — architecture covers the files table and the index workers, the Claude Code and Codex plugin, the projection with its live triggers and surfaces, and the per-wave fleet shape with parallel waves, --ahead, the strict done gate, forward merges and the sequential-wave gate; README and config carry the fleet shape, the projection, waves and [projection] auto and min_interval; source and test references regenerated from the graph; the six translations carry the 1.5.0 README changes; agent context regenerated ([7088b68](https://github.com/Sidiora-Labs/codify/commit/7088b6832e8ab59d83deda6e6df32ab2f04125bd), task codify-v15/@docs)

### Tests
- Publish reproducible v16 index resource runs ([cfa8a35](https://github.com/Sidiora-Labs/codify/commit/cfa8a359c4c9b25e91af8fc65da83763398cfea5), task codify-v16/5.2)
- Bound benchmark subprocess runtime ([cb691e4](https://github.com/Sidiora-Labs/codify/commit/cb691e445edac1a6f071268774fd38e777f47eca), task codify-v16/5.2)
- Gate wide and deep parser resource shapes ([0a9c532](https://github.com/Sidiora-Labs/codify/commit/0a9c532ee2f58595eb69772046d9cb02f7126c15), task codify-v16/5.2)
- Measure linked branch fact reuse ([8e5804c](https://github.com/Sidiora-Labs/codify/commit/8e5804c6603c3684376768940db445968a4131ce), task codify-v16/5.2)
- Require benchmark runtime provenance ([3bed4cd](https://github.com/Sidiora-Labs/codify/commit/3bed4cd6c681324478ac273e2ecded87425f656a), task codify-v16/5.2)
- Record benchmark runtime and constrain build workers ([1efe4b4](https://github.com/Sidiora-Labs/codify/commit/1efe4b46ce81ef1d725174fb93b3fe5fe071df68), task codify-v16/5.2)
- Gate replay freshness and measured resource caps ([1a02e52](https://github.com/Sidiora-Labs/codify/commit/1a02e52ba0ef0312003194c6299d573fb3358a7e), task codify-v16/5.2)
- Measure indexing resources and latency ([375908c](https://github.com/Sidiora-Labs/codify/commit/375908c52a709725029a0f0b314ccdbd744e59a9), task codify-v16/5.2)
- **index:** Verify vendored parser provenance offline ([1f8bf5d](https://github.com/Sidiora-Labs/codify/commit/1f8bf5df3f6f11e110f00d67d53207512effe1e2), task codify-v16/2.2)
- **index:** Reject C type-use definitions ([30cc143](https://github.com/Sidiora-Labs/codify/commit/30cc14395aaab66e04e322053420446db57f0a6b), task codify-v16/2.4)
- Every direct sqlite3 read of a graph.db in the integration suite waits on a lock (busy timeout 5s) instead of failing on it — cg forks detached projection builds after discovery and the post-edit hook, and under suite load 50_discover opened the graph while one was committing and got 'database is locked' on an empty result (2 runs in 20 reproduced it; 30 of 30 clean with the wait) ([7b9468a](https://github.com/Sidiora-Labs/codify/commit/7b9468acd8cfe4a0a5c586fb9e0820d6aaf11f6f))
- 25_syncgate runs cg hook install under an empty HOME, like 10_lifecycle, so the settings.json it inspects is written whether or not the Codify plugin is installed for the user running the suite ([0e87a0d](https://github.com/Sidiora-Labs/codify/commit/0e87a0d702b50b048c177b4e46ae06e1358d6be3))
- 10_lifecycle runs cg hook install under an empty HOME, so the settings.json it checks for is written whether or not the Codify plugin is installed for the user running the suite (48_plugin covers the plugin case) ([58deac6](https://github.com/Sidiora-Labs/codify/commit/58deac612ad38754f90b0e1cf98124b273427384))

### Spec workflow
- Qualify index resource regression gate ([8f10bef](https://github.com/Sidiora-Labs/codify/commit/8f10befaf7ccd82a72bba33c53e51c1d61cd690b), task codify-v16/5.2)
- Qualify systems syntax extraction ([6ca36f2](https://github.com/Sidiora-Labs/codify/commit/6ca36f22327dc5fafb9f43e21eb1e505f0cdbff1), task codify-v16/2.4)
- Qualify native syntax runtime ([b2c4437](https://github.com/Sidiora-Labs/codify/commit/b2c44375849288ff90e844ef087f7f45c1fe046c), task codify-v16/2.2)
- Qualify extraction health task ([ff8be35](https://github.com/Sidiora-Labs/codify/commit/ff8be3568cb494bb65ac4db5087194b031540f12), task codify-v16/1.3)
- Map indexing tasks to precise acceptance clauses ([21b183a](https://github.com/Sidiora-Labs/codify/commit/21b183a0d41aa6f17db52377b459ce37ede04faa))
- Define Codify 1.6 structured indexing and qualification ([c45d9d0](https://github.com/Sidiora-Labs/codify/commit/c45d9d04f1db5697b482f97b450b73ba1d02f7ea))
- Task 3.3 done ([82ddee0](https://github.com/Sidiora-Labs/codify/commit/82ddee09e098afbb3caaba804377f4e8fcda5bca))

### Fleet
- The sequential-wave gate re-asks git whether main is in the wave branch at the moment it decides — the freshness mark is taken at the top of the supervisor tick and the frontier is read later in it, so a land that reached main between the two left a mark that said fresh beside a spec that said landed, and 3.1 was cut from a wave branch without main and refused at its own done (32_supervisor, 1 release run in 3); a stale not-fresh only costs a tick; architecture doc carries the re-check ([e8fcc20](https://github.com/Sidiora-Labs/codify/commit/e8fcc207ba1dd92a930ba892a451bd1dbf1fc804))
- One pull request body and one land log per branch — pr-<feature>-<wave>.md and land-<feature>-<wave>-<gate>.log for a wave, so two waves of one feature opening their pull requests at the same moment cannot hand each other their bodies, and a wave's land no longer overwrites the record of the wave landed before it ([5eeeb14](https://github.com/Sidiora-Labs/codify/commit/5eeeb141d0216ad9e13aec4662d2b4b93e23eea2))
- A sequential wave's task waits until main is merged forward into its wave branch — a land merges into main before its gates and emits its event after them, so the main tree's spec said done before the land was known and the next wave's task could be cut from a stale wave branch and refused at done; 29_changelog follows the changelog model default ([4725578](https://github.com/Sidiora-Labs/codify/commit/47255789433fe8a8532dea441feef373564dfa27), task codify-v15/4.2)

### Index
- Record extraction coverage and semantic freshness ([0c4303a](https://github.com/Sidiora-Labs/codify/commit/0c4303aec1654e9250abe69bc10f5a19f84754ac))

### Integrate
- The Claude Code plugin and the Codex hooks installed through the 1.5.0 binary at /usr/local/bin/cg; the workflow skill and the agent context regenerated by it ([59be404](https://github.com/Sidiora-Labs/codify/commit/59be404c976afba9fb21ec8d2ba214857b27623d))

### Other
- Preserve direct context matches within small response budgets ([d5dec25](https://github.com/Sidiora-Labs/codify/commit/d5dec250a435ea5839ead1fe7bf87ca34b02dfbc))
- Keep direct context hit under small budgets ([9e191b6](https://github.com/Sidiora-Labs/codify/commit/9e191b6f05d36eab33349185fc10b4383a3eb382), task codify-v16/4.2)
- Merge verified indexing resource and latency gates ([36de8c0](https://github.com/Sidiora-Labs/codify/commit/36de8c0a209b73a9854afd01bfcdd87b721e1096))
- Merge verified hierarchy and conservative unused-code inspection ([394be8c](https://github.com/Sidiora-Labs/codify/commit/394be8c4c4cd058b9bb6479dc97ec3b1c2105eb0))
- Qualify hierarchy and conservative inspection ([58dd9ce](https://github.com/Sidiora-Labs/codify/commit/58dd9ce5ffb0909f7883fe5ec407f871d74e7504), task codify-v16/4.4)
- Merge verified bounded semantic retrieval ranking ([79a0427](https://github.com/Sidiora-Labs/codify/commit/79a0427bb0ac42a810fb98eb95b4b359872b140a))
- Merge verified bounded semantic flow queries ([6e3b751](https://github.com/Sidiora-Labs/codify/commit/6e3b7517cd6216895d21d469f2b5d01133c5401b))
- Merge verified Codify 1.6 indexing conformance corpus ([01eddb5](https://github.com/Sidiora-Labs/codify/commit/01eddb597a1008107a7a9a33d9b501fbcbd4aec5))
- Qualify structured retrieval ([652a88c](https://github.com/Sidiora-Labs/codify/commit/652a88c0617d1a3687c31b0291eb6ba7e01c96a8), task codify-v16/4.2)
- Qualify bounded flow traversal ([7a944f9](https://github.com/Sidiora-Labs/codify/commit/7a944f962fec1c7e294e2049b6167745df787568), task codify-v16/4.3)
- Qualify labelled semantic conformance corpus ([fd68b93](https://github.com/Sidiora-Labs/codify/commit/fd68b9377ec7aa589f6931e67878dc2ba1db02d6), task codify-v16/5.1)
- Merge resolver lookup index for final resource profile ([2c7cc23](https://github.com/Sidiora-Labs/codify/commit/2c7cc237ff5bf148a6230910d6b405eb12687820))
- Preserve compact documented context ([d51f8e8](https://github.com/Sidiora-Labs/codify/commit/d51f8e86f0f0330a791670a10864b3d8aa4bdcf0), task codify-v16/4.2)
- Merge deterministic semantic evidence and indexed reference-edge updates ([3240fc7](https://github.com/Sidiora-Labs/codify/commit/3240fc724a981acf0e9527e26eb570077e3507d8))
- Stabilize resolver evidence and index reference edges ([6dcce06](https://github.com/Sidiora-Labs/codify/commit/6dcce06e29ddd36c39fd486dad81fd8fa005cee0), task codify-v16/3.2)
- Merge exact-site semantic edge deduplication ([ed7cfeb](https://github.com/Sidiora-Labs/codify/commit/ed7cfeb020ab43b75c056076f123a0fb4c3b30e2))
- Keep proven syntax edges unique at each reference site ([a52afde](https://github.com/Sidiora-Labs/codify/commit/a52afde0dfddca9b2a59f63c28bc261f8943e7d8), task codify-v16/3.2)
- Merge qualified incremental semantic indexing for resource gates ([b603727](https://github.com/Sidiora-Labs/codify/commit/b60372709015b699bf2e60f73d32aa081c26282f))
- Merge verified incremental semantic invalidation for Codify 1.6 ([d9cea79](https://github.com/Sidiora-Labs/codify/commit/d9cea79ede5af326edeefb211069161475a3b092))
- Verify explicit form event dispatch evidence ([71d5282](https://github.com/Sidiora-Labs/codify/commit/71d5282c16a0e1e08fc64d9ecb774d596d8e90c1), task codify-v16/5.1)
- Qualify incremental semantic invalidation ([e68244b](https://github.com/Sidiora-Labs/codify/commit/e68244b32f5caaa3b819ad0630d62e52952c7be5), task codify-v16/3.7)
- Merge compact health output for very small response budgets ([bb057cc](https://github.com/Sidiora-Labs/codify/commit/bb057ccad4002f10e9a9c978227ef68222c160de))
- Keep tiny-budget answers within cap on long branches ([6dff589](https://github.com/Sidiora-Labs/codify/commit/6dff589124a6475e7d9adae5057b481b1a34dc79), task codify-v16/4.1)
- Merge qualified dispatch pass into task 3.7 ([4040fc8](https://github.com/Sidiora-Labs/codify/commit/4040fc8c5eb5014c012ef43a02237b89c099e970))
- Merge verified callback and runtime dispatch relations for Codify 1.6 ([b8110c4](https://github.com/Sidiora-Labs/codify/commit/b8110c4033fe5330f30c0516daafa23b1a15f2fa))
- Merge qualified channel and route lifecycle work into task 3.7 ([8ae7aba](https://github.com/Sidiora-Labs/codify/commit/8ae7aba9b46b41d625679663cc789ac8c383b7a0))
- Document verified declarative reference coverage ([7966ceb](https://github.com/Sidiora-Labs/codify/commit/7966ceb3982ca8a43233fbf17f83d5cc2ad7bebd))
- Merge verified local HTTP and message channel relations for Codify 1.6 ([f7098cc](https://github.com/Sidiora-Labs/codify/commit/f7098cc4885348b9ccb60a93f1f6d97ff8d012fc))
- Qualify channel synthesis task ([09a94a6](https://github.com/Sidiora-Labs/codify/commit/09a94a667378181026e41c5be0edc8b0b1ff3733), task codify-v16/3.6)
- Merge total response budget enforcement with health metadata ([0aa009a](https://github.com/Sidiora-Labs/codify/commit/0aa009a01d146091816acc5cfff54471e064a7c3))
- Bound plain flow output ([76d5ca3](https://github.com/Sidiora-Labs/codify/commit/76d5ca36ccb6ac9261bcdd77dc5a72c56ef79ff7), task codify-v16/4.3)
- Merge mixed-format reference precision and bounded extraction ([6efb92c](https://github.com/Sidiora-Labs/codify/commit/6efb92cf8c795dcc62e93639b75c6108f33b4d4e))
- Honor total retrieval budgets with compact health evidence ([819f7f9](https://github.com/Sidiora-Labs/codify/commit/819f7f90de97c4091f686d3096aaed2a35ecf255), task codify-v16/4.1)
- Skip semantic retry for unchanged skipped files ([d038fae](https://github.com/Sidiora-Labs/codify/commit/d038fae7519d5e08815105d2f5497aeba545e94a), task codify-v16/3.7)
- Bound mixed format references and indexing cost ([776736c](https://github.com/Sidiora-Labs/codify/commit/776736c5bc35e8ea9b8bb48bcf8a6fb1029c286e), task codify-v16/2.8)
- Merge transactional route identity and framework provenance repairs ([1a2d75e](https://github.com/Sidiora-Labs/codify/commit/1a2d75ec9dda6131dc13b1e721e20096d0e7f99c))
- Merge precise lexical references and import-bound call resolution ([31b7505](https://github.com/Sidiora-Labs/codify/commit/31b7505020b5bbde6900cca4ad76666b2b08256a))
- Record qualified form dispatch task ([c074614](https://github.com/Sidiora-Labs/codify/commit/c074614e5bb403ddef3f44b2c0b7938a744f10bd), task codify-v16/3.5)
- Purge route nodes before source symbol reuse ([6d7438a](https://github.com/Sidiora-Labs/codify/commit/6d7438ace0bfd7a4c49dbd471e59dce08a772c38), task codify-v16/3.4)
- Preserve grounded calls and resolve exact reference targets ([022f559](https://github.com/Sidiora-Labs/codify/commit/022f55935d18c043e4ace73462d7d71a69a48c59), task codify-v16/3.2)
- Count wrong and duplicate route facts ([dfd7401](https://github.com/Sidiora-Labs/codify/commit/dfd74010015d8dc2cc9a14b908fedafa47bfa320), task codify-v16/5.1)
- Align flow command documentation scope ([83c316b](https://github.com/Sidiora-Labs/codify/commit/83c316ba533faf6a2452e678d1aa25b9b77f6ef9), task codify-v16/4.3)
- Merge precise declarative reference extraction ([225d96c](https://github.com/Sidiora-Labs/codify/commit/225d96c17a0bf443eeaca60a577392f8b6db0a7b))
- Merge complete Python declaration signatures ([7c63628](https://github.com/Sidiora-Labs/codify/commit/7c6362829b14076c18b3422a7ac20f416ec21a4f))
- Link literal form events to owned handlers ([fa8aee9](https://github.com/Sidiora-Labs/codify/commit/fa8aee9e08835b0466cbc530d9ef7a643ca8d902), task codify-v16/3.5)
- Merge linear web traversal and exported signature compatibility ([ce94a87](https://github.com/Sidiora-Labs/codify/commit/ce94a871899f71c3de14421b281e127d498a687f))
- Preserve Python declaration headers in survey ([17b4c99](https://github.com/Sidiora-Labs/codify/commit/17b4c99ac74de31532d5303487ba6578442fcdbd), task codify-v16/2.5)
- Keep web extraction linear and preserve export signatures ([5fb167d](https://github.com/Sidiora-Labs/codify/commit/5fb167d0d8500f98cbf16b3cc72f19ce62b159df), task codify-v16/2.3)
- Exercise alias invalidation and route rewiring ([82cf609](https://github.com/Sidiora-Labs/codify/commit/82cf60948e4fa5b7375900f38c2542a59be42cc1), task codify-v16/5.1)
- Report framework extraction coverage ([d7ef3ea](https://github.com/Sidiora-Labs/codify/commit/d7ef3ea8305e46881db0f3d6e1a045dd5a039e01), task codify-v16/5.1)
- Merge safe one-argument HTTP call extraction ([d2637d1](https://github.com/Sidiora-Labs/codify/commit/d2637d1cfdd08d3b154352cf566a9e3c1e2165ad))
- Merge bounded native syntax traversal for resource gates ([2457e73](https://github.com/Sidiora-Labs/codify/commit/2457e7332c05b008fc142fce9898235cd7b7aa1e))
- Guard optional HTTP call options ([f5f9344](https://github.com/Sidiora-Labs/codify/commit/f5f9344208f74efe49284e28116e1178ff0d591b), task codify-v16/2.3)
- Use explicit calls in dynamic language relation probes ([217e192](https://github.com/Sidiora-Labs/codify/commit/217e192bb85f0936ec25576cc50f8bbc40ce3f0d), task codify-v16/5.1)
- Skip intact channel synthesis on full semantic passes ([5be2218](https://github.com/Sidiora-Labs/codify/commit/5be2218372a9652b2a4bdc9f7435c986068ef35b), task codify-v16/3.6)
- Validate flow MCP tool contract ([51d4d20](https://github.com/Sidiora-Labs/codify/commit/51d4d206f61d10d02dcf30b207f4dce91d76a8fc), task codify-v16/4.3)
- Merge native systems compatibility and bounded wide-file traversal ([55c28e8](https://github.com/Sidiora-Labs/codify/commit/55c28e89056493eb046b659322a07262e618ea75))
- Report truncated ambiguous flow roots ([e8514ca](https://github.com/Sidiora-Labs/codify/commit/e8514ca1c45a98911745400a4f33aed7aacf62cf), task codify-v16/4.3)
- Merge linear parser traversal for resource gates ([efa975e](https://github.com/Sidiora-Labs/codify/commit/efa975eeeee024fc8b1c6744b7235a1a9e5011db))
- Merge Python compatibility and linear dynamic syntax traversal ([47fd10f](https://github.com/Sidiora-Labs/codify/commit/47fd10f65463746c9cde05e4fcab83b7eff10347))
- Merge qualified semantic dependencies into task 3.7 ([99d0bd2](https://github.com/Sidiora-Labs/codify/commit/99d0bd2c20b9daf9d44a1bb535294724327b17b4))
- Merge linear managed-language syntax traversal ([9c8b943](https://github.com/Sidiora-Labs/codify/commit/9c8b94315da95f616614e573cfd47692db340858))
- Traverse dynamic syntax siblings linearly ([088da91](https://github.com/Sidiora-Labs/codify/commit/088da9102de1ad1d8fbda2321b86c26778f2c8c8), task codify-v16/2.5)
- Merge verified import binding and configuration resolution for Codify 1.6 ([e7bc44c](https://github.com/Sidiora-Labs/codify/commit/e7bc44c32f2dca15036d3fa73f6860db1d750050))
- Bound wide managed syntax traversal ([d865053](https://github.com/Sidiora-Labs/codify/commit/d86505365d6fa92007fd757467f3ad079740323d), task codify-v16/2.6)
- Verify scoped edits and prior retry debt ([bad32f6](https://github.com/Sidiora-Labs/codify/commit/bad32f60158caf50f4c2184bc042b50e02e9407c), task codify-v16/3.7)
- Qualify import bindings and alias resolution ([234254f](https://github.com/Sidiora-Labs/codify/commit/234254f7d4d7df4ca78a03739cd4d2cf79e8a30a), task codify-v16/3.1)
- Merge current main into task 3.7 ([36de04d](https://github.com/Sidiora-Labs/codify/commit/36de04d731a831528352c8d9b683e9a2beef2f6a))
- Merge bounded ownership and linear extended syntax traversal ([5f58980](https://github.com/Sidiora-Labs/codify/commit/5f58980f11d5d9c1da8542cb41d4e4374920186d))
- Verify framework identity in route corpus ([6d3cabe](https://github.com/Sidiora-Labs/codify/commit/6d3cabed3c5ec456c29ed9cdd93ec8b3894993d7), task codify-v16/5.1)
- Reserve answer health within query budgets ([3e2ee4a](https://github.com/Sidiora-Labs/codify/commit/3e2ee4a2f8354a35e8953d3b295cdebeb6fa56db), task codify-v16/4.1)
- Verify parsed import bindings and config edits ([ec0c69b](https://github.com/Sidiora-Labs/codify/commit/ec0c69b372353a90a02452acad204fa50477610c), task codify-v16/3.1)
- Merge linear syntax runtime for web resource audit ([e55f83a](https://github.com/Sidiora-Labs/codify/commit/e55f83a6fbef37ba4fc7240355a287b6cefcd640))
- Merge indexed traversal resource fixes into task 2.7 ([08ff1e1](https://github.com/Sidiora-Labs/codify/commit/08ff1e169f3725d590cd4690430525629a8321f5))
- Merge verified receiver and overload resolution for Codify 1.6 ([db4a1a2](https://github.com/Sidiora-Labs/codify/commit/db4a1a26e87ec450607877c08f31c9181a9b678a))
- Merge linear syntax traversal and native unit coverage ([c9b2a9b](https://github.com/Sidiora-Labs/codify/commit/c9b2a9b3acfd7596481477579ff03cd633a304cf))
- Merge native unit linkage and traversal fixes for task 2.6 validation ([892fa1d](https://github.com/Sidiora-Labs/codify/commit/892fa1d531e9e1f47911526a3a8cae59ba4d3502))
- Qualify receiver and overload resolution ([ef56fa1](https://github.com/Sidiora-Labs/codify/commit/ef56fa154e60ad714aca83c62e7df25ad647b543), task codify-v16/3.2)
- Exercise flow over parsed hierarchy relations ([0c4e389](https://github.com/Sidiora-Labs/codify/commit/0c4e389c055618ccf7d2298db1f7772ca3c96932), task codify-v16/4.3)
- Bound wide native syntax traversal and preserve comment metadata ([874de92](https://github.com/Sidiora-Labs/codify/commit/874de9217c3de5b3913114802619be53f159a22d), task codify-v16/2.2)
- Merge verified framework route and handler indexing for Codify 1.6 ([14f8a4c](https://github.com/Sidiora-Labs/codify/commit/14f8a4c658935bfdcfb1c2094d58cd1a3cfb1ac8))
- Preserve Python module import and docstring contracts ([74a9ee3](https://github.com/Sidiora-Labs/codify/commit/74a9ee31150d224aed6e4a51b554151a3df482e8), task codify-v16/2.5)
- Qualify route graph and migrate registration column ([eba3c23](https://github.com/Sidiora-Labs/codify/commit/eba3c233730edc9b45bf0a5dff34086e26e382fa), task codify-v16/3.4)
- Explain evidence by dispatch channel ([51ba440](https://github.com/Sidiora-Labs/codify/commit/51ba440d94fe8be9884046c3175966dba91006b1), task codify-v16/3.5)
- Merge import module and wildcard precision corrections ([29e71ab](https://github.com/Sidiora-Labs/codify/commit/29e71ab5f235573de500a983b12cf861b6164245))
- Merge native call arity and compatibility corrections ([113a7c5](https://github.com/Sidiora-Labs/codify/commit/113a7c5517daf0a2ec0133e8c9e88c2034cc3fbf))
- Label graph endpoints and make replay assertions nonvacuous ([fb8a885](https://github.com/Sidiora-Labs/codify/commit/fb8a8850fcf145f9aa49552e7f7711ceee21674b), task codify-v16/5.1)
- Preserve import module and wildcard boundaries ([716b1e5](https://github.com/Sidiora-Labs/codify/commit/716b1e58299eb5d130cf45ebeb46d23f62ceff3c), task codify-v16/2.6)
- Record syntax-proven web call arity ([f53d94b](https://github.com/Sidiora-Labs/codify/commit/f53d94b37c785d6193d9d911127495760be456c2), task codify-v16/2.3)
- Complete framework route handler extraction ([8afbb80](https://github.com/Sidiora-Labs/codify/commit/8afbb80644ec8ef5c791ad80f68e051b8121033e), task codify-v16/3.4)
- Merge verified type hierarchy and semantic relations for Codify 1.6 ([dd24214](https://github.com/Sidiora-Labs/codify/commit/dd242147c5b8206630d0ab5082cc2731464d155b))
- Record qualified type hierarchy task ([b0bbbe6](https://github.com/Sidiora-Labs/codify/commit/b0bbbe64dfde7ef4139138a6de61f4cf98f4a79e), task codify-v16/3.3)
- Merge current indexing integration for native adapter compatibility ([c5d55f8](https://github.com/Sidiora-Labs/codify/commit/c5d55f897ad966d7d281a212fd38024018ad7042))
- Qualify real-source hierarchy override and decorator relations ([654b5fd](https://github.com/Sidiora-Labs/codify/commit/654b5fd6e227dddeb8b005ec160c609aabc250d7), task codify-v16/3.3)
- Reject shadowed observer receivers ([0180594](https://github.com/Sidiora-Labs/codify/commit/0180594579c09d39e3213704506084e0b34040c3), task codify-v16/3.5)
- Merge explicit C++ override syntax facts ([d485452](https://github.com/Sidiora-Labs/codify/commit/d4854527b29c0711febb9354326c3c4d36522074))
- Verify live interface dispatch and ambiguity ([88e4bdb](https://github.com/Sidiora-Labs/codify/commit/88e4bdbf775bc2efbc96bf3dc16bd90db08562c6), task codify-v16/3.5)
- Verify extracted overload calls end to end ([a5d6e46](https://github.com/Sidiora-Labs/codify/commit/a5d6e462302d6a4771da59163631032b52d96bd0), task codify-v16/3.2)
- Keep complete source paths in flow evidence ([26670f7](https://github.com/Sidiora-Labs/codify/commit/26670f7ad2c2c152eb9e7a8ab436900e75a7660b), task codify-v16/4.3)
- Merge native unit compatibility fixes into task 2.3 ([0c95c08](https://github.com/Sidiora-Labs/codify/commit/0c95c08e02568ba9b1640ea1f42642c17996abd3))
- Classify bounded reachability from explicit roots ([eb80267](https://github.com/Sidiora-Labs/codify/commit/eb80267666ee359d738f2d39dead885db095d056), task codify-v16/4.4)
- Merge current indexing adapters for resource qualification ([dd5bf91](https://github.com/Sidiora-Labs/codify/commit/dd5bf910bb3b84b5b1e416eb15a995c855cf2f78))
- Verify pointer and native dispatch from source ([05689cc](https://github.com/Sidiora-Labs/codify/commit/05689ccd0a4f8e9b40fb0b8ffd0eb6670de932aa), task codify-v16/3.5)
- Align adapter labels with extraction contracts ([c09edc5](https://github.com/Sidiora-Labs/codify/commit/c09edc58cb2b3d08a381c16e009a12fed78a68d6), task codify-v16/5.1)
- Expose evidence-backed flow path edges ([3067f53](https://github.com/Sidiora-Labs/codify/commit/3067f531693e4adb6d7b6992c3e4a69dd1148a4e), task codify-v16/4.3)
- Use monotonic flow time budget ([9d3a1e6](https://github.com/Sidiora-Labs/codify/commit/9d3a1e6f129a4decace29957c28ecd9ba31f1a8d), task codify-v16/4.3)
- Merge Delphi event-handler reference coverage ([50ecf5d](https://github.com/Sidiora-Labs/codify/commit/50ecf5ddcd0d87423fc7491a075e05d7b46574fa))
- Merge precise decorator extraction for Codify 1.6 ([ab43eff](https://github.com/Sidiora-Labs/codify/commit/ab43eff1a69fc45ad1b44651a236e0a6d1dc1214))
- Verify source dispatch and conservative observer identity ([0267ddf](https://github.com/Sidiora-Labs/codify/commit/0267ddfe49c3d4de6592c5c971bbd801fce9b83e), task codify-v16/3.5)
- Link Delphi form events to handler names ([279c7fb](https://github.com/Sidiora-Labs/codify/commit/279c7fb52e2e72d8d54e532db54953d4fd413435), task codify-v16/2.8)
- Preserve individual decorator targets and sites ([ed3e018](https://github.com/Sidiora-Labs/codify/commit/ed3e018fae7301a6d02cf7137118c2a833a0f485), task codify-v16/2.3)
- Use relation endpoint indexes for bounded traversal ([e7898d2](https://github.com/Sidiora-Labs/codify/commit/e7898d2cb85b3b41e791e577a748cbcc25abab16), task codify-v16/4.3)
- Preserve flow evidence and traversal limits ([ff910f7](https://github.com/Sidiora-Labs/codify/commit/ff910f773c91eda979e9ab185e8f2fe2215e757e), task codify-v16/4.3)
- Bound multiline route scanning and preserve coverage diagnostics ([8f31042](https://github.com/Sidiora-Labs/codify/commit/8f310426793249f62fcdc2eb19369cdfca686021), task codify-v16/3.4)
- Expose bounded hierarchy and cautious unreferenced inspection codify-v16/4.4 ([08f1c6a](https://github.com/Sidiora-Labs/codify/commit/08f1c6ae5528992d814752c3944d26e834d41409))
- Make form event fixture structurally valid ([41a6a27](https://github.com/Sidiora-Labs/codify/commit/41a6a275fea16f196067e711b82fcad6dbbca132), task codify-v16/5.1)
- Verify decorator links and ambiguity ([6982c16](https://github.com/Sidiora-Labs/codify/commit/6982c168a0d2a16cfe8d3d54077030e64542e396), task codify-v16/3.3)
- Merge verified configuration and scripting syntax indexing for Codify 1.6 ([1ac3706](https://github.com/Sidiora-Labs/codify/commit/1ac37069c91288a789d75f6aa9a38231f35b5df7))
- Merge verified managed-language syntax indexing for Codify 1.6 ([6371b33](https://github.com/Sidiora-Labs/codify/commit/6371b33402d58046ad0522b4d424c4cd2d482a69))
- Scope import rebinding to affected files ([5d15bcf](https://github.com/Sidiora-Labs/codify/commit/5d15bcf26ac30c02c6d2f5ff90eab90e38429204), task codify-v16/3.1)
- Qualify extended syntax extraction ([2765872](https://github.com/Sidiora-Labs/codify/commit/2765872570bafdbbe13bd11df5c816d5bbbbd3e6), task codify-v16/2.7)
- Merge verified dynamic-language syntax indexing for Codify 1.6 ([1823674](https://github.com/Sidiora-Labs/codify/commit/1823674f119fb01e83d087039eb5e8e2d9e8c8d5))
- Qualify managed syntax indexing ([16d2138](https://github.com/Sidiora-Labs/codify/commit/16d2138ea72c34ad7b8d3c85646f72e7ab7d0e33), task codify-v16/2.6)
- Merge verified mixed-format syntax indexing for Codify 1.6 ([86bce17](https://github.com/Sidiora-Labs/codify/commit/86bce17471cd4d6642e48658747b618e4dcd2d25))
- Qualify dynamic language syntax extraction ([a22d399](https://github.com/Sidiora-Labs/codify/commit/a22d399f4d3aa316d2e83108e6954614dc031db5), task codify-v16/2.5)
- Merge verified systems-language syntax indexing for Codify 1.6 ([f4624b5](https://github.com/Sidiora-Labs/codify/commit/f4624b55df0a503aae98433fe9544f523f7dc4bd))
- Merge answer-health syntax recovery regression coverage ([8237601](https://github.com/Sidiora-Labs/codify/commit/82376018b7e14175b9c165f0622dc61c0df09a82))
- Check route provenance and semantic refresh convergence ([c3b8190](https://github.com/Sidiora-Labs/codify/commit/c3b819009e859476ad7a126d8fe643805159375f), task codify-v16/5.1)
- Build evidence-backed framework route graph ([23d85c6](https://github.com/Sidiora-Labs/codify/commit/23d85c6b3daf7d847d3b993fb17dee48ab249ea5), task codify-v16/3.4)
- Verify partial syntax recovery in answer health ([55556f1](https://github.com/Sidiora-Labs/codify/commit/55556f1abb5793473cf0947acbbfa3e505d93046), task codify-v16/4.1)
- Merge main before decorator follow-up ([f5bb26c](https://github.com/Sidiora-Labs/codify/commit/f5bb26c6e16f553b6930032bd978a21f1954715c))
- Supply exact type targets for resolution ([a5433c9](https://github.com/Sidiora-Labs/codify/commit/a5433c92f00d7a6a0651414d422678e684dbcffd), task codify-v16/2.6)
- Merge native parser prerequisites for indexing resource gates ([6b0d62d](https://github.com/Sidiora-Labs/codify/commit/6b0d62d59f56093c143dc130af02e51954988fd0))
- Qualify legacy and mixed-format indexing ([b2092da](https://github.com/Sidiora-Labs/codify/commit/b2092da8c2ae09371d3250d8786c931461d1699d), task codify-v16/2.8)
- Resolve decorator and additional type forms conservatively ([4ded213](https://github.com/Sidiora-Labs/codify/commit/4ded21310ff3829bd5e49da24961b74051254dcf), task codify-v16/3.3)
- Gate dispatch on registration identity and callable targets ([51d11e2](https://github.com/Sidiora-Labs/codify/commit/51d11e233eb5ca808dbce216b54e4837becffaf9), task codify-v16/3.5)
- Record corpus task progress and fix rename replay fixture ([85b5ddb](https://github.com/Sidiora-Labs/codify/commit/85b5ddbd469fede332927470d055155dad19f373), task codify-v16/5.1)
- Add labelled semantic corpus and graph differential gate ([bc41e6a](https://github.com/Sidiora-Labs/codify/commit/bc41e6ae41c4fe892f25adf91ec71ef8c5a5f9ec), task codify-v16/5.1)
- Merge main before task 2.6 qualification ([69460c3](https://github.com/Sidiora-Labs/codify/commit/69460c3ccf2248868c9338fa99f357700431a38c))
- Add bounded evidence-backed flow traversal codify-v16/4.3 ([cc72664](https://github.com/Sidiora-Labs/codify/commit/cc72664698f12e8ae5ee4f9b5319a19f31969691))
- Merge qualified parser runtime and shared indexing fixes for task 2.6 ([c082d0e](https://github.com/Sidiora-Labs/codify/commit/c082d0e615f39ca208aea493297a13a8bcb186d9))
- Merge qualified indexing foundation into task 2.7 ([07b9040](https://github.com/Sidiora-Labs/codify/commit/07b90409ca2de67c823aad124b6d2aaa6a1c45f9))
- Merge verified web syntax indexing for Codify 1.6 ([4924a07](https://github.com/Sidiora-Labs/codify/commit/4924a07a925bb0c7da836e5432ee07301a4d0134))
- Merge qualified runtime into systems adapter branch ([e8788e9](https://github.com/Sidiora-Labs/codify/commit/e8788e95eaed5a8fe9cee1d8eae444e38aed45de))
- Merge verified native syntax runtime for Codify 1.6 ([f13786e](https://github.com/Sidiora-Labs/codify/commit/f13786e3251678972b95ac3ea46895469df397f7))
- Qualify web-language syntax extraction ([2bbae42](https://github.com/Sidiora-Labs/codify/commit/2bbae4204811a9e9c8d1d3cd9dcfd6128f830e52), task codify-v16/2.3)
- Preserve syntax-derived type references ([e357188](https://github.com/Sidiora-Labs/codify/commit/e35718818ac0d98c7e17e8896a44cb84b8d02cfb), task codify-v16/2.6)
- Merge verified indexing prerequisites for resource gates ([9a6126e](https://github.com/Sidiora-Labs/codify/commit/9a6126e65595d177cb68e8b53a747c4e170c291d))
- Report exact parser identity per language ([74ce434](https://github.com/Sidiora-Labs/codify/commit/74ce4346e1f67460c66892bdb1c60cc6eedf1f7d), task codify-v16/2.6)
- Merge verified answer health for Codify 1.6 ([c00f096](https://github.com/Sidiora-Labs/codify/commit/c00f096a2b8a47c72311e2138fc6a3d2d6c95f3a))
- Merge qualified parser runtime into task 2.3 ([d88f332](https://github.com/Sidiora-Labs/codify/commit/d88f3325c3f922fd340160138c64ae89b544ad7f))
- Qualify answer health task ([975eda9](https://github.com/Sidiora-Labs/codify/commit/975eda94e69ae3fba329d119777db40f3951186e), task codify-v16/4.1)
- Prove imported event receivers and error coverage ([0aff43c](https://github.com/Sidiora-Labs/codify/commit/0aff43cadae390c4f7c383e0ecd94af2d49f8912), task codify-v16/2.3)
- Limit CLI wrapping to registered commands ([696230c](https://github.com/Sidiora-Labs/codify/commit/696230c6a61bbea9ebc64d4e617df442a5fc5c26), task codify-v16/4.1)
- Implement bounded channel synthesis ([a3a1a98](https://github.com/Sidiora-Labs/codify/commit/a3a1a983ca0cfbf0030d6afa114675b9dd38769d), task codify-v16/3.6)
- Merge qualified parser runtime for task 2.6 ([e3a7b31](https://github.com/Sidiora-Labs/codify/commit/e3a7b315ad5ee3d102815495131f0c33fc552b3c))
- Preserve syntax evidence on managed type facts ([28e0ece](https://github.com/Sidiora-Labs/codify/commit/28e0ece543828d6e572661d39262ee7d6da155a5), task codify-v16/2.6)
- Persist and replay semantic dependency changes ([4fcfe53](https://github.com/Sidiora-Labs/codify/commit/4fcfe535ca83dc53a9c6ede8ef94492764764d29), task codify-v16/3.7)
- Record scoped identifier reads ([858ff53](https://github.com/Sidiora-Labs/codify/commit/858ff531d27add07bd0d1bdf866a7833aaf87428), task codify-v16/2.5)
- Gate mapping extraction on mapper element ([beefa28](https://github.com/Sidiora-Labs/codify/commit/beefa28845c8759d469e098ad0586ddeec498488), task codify-v16/2.8)
- Merge semantic retry-debt correction for Codify 1.6 ([8b9e3ce](https://github.com/Sidiora-Labs/codify/commit/8b9e3ce872864a2f2a862bb731be2db19014d974))
- Record mixed adapter implementation evidence ([a82b44a](https://github.com/Sidiora-Labs/codify/commit/a82b44a6edc1aa840c279d281c770edacaab653a), task codify-v16/2.8)
- Merge parser coverage prerequisite into task 2.3 ([6b02334](https://github.com/Sidiora-Labs/codify/commit/6b023345aeef12057a578f3536263b1c8e4606c4))
- Qualify mixed extraction and original-coordinate fixtures ([ff3c47a](https://github.com/Sidiora-Labs/codify/commit/ff3c47a5e57643cb826bb63bb44f3270913ec214), task codify-v16/2.8)
- Merge verified extraction health for Codify 1.6 ([5d1f914](https://github.com/Sidiora-Labs/codify/commit/5d1f914d6e0bf3811780ca69b77a48a623d03a1c))
- Add structured search and evidence-rich context ([5786583](https://github.com/Sidiora-Labs/codify/commit/578658332d53f85f68b0ea8d26842d8857bded02), task codify-v16/4.2)
- Verify managed graph facts and source recovery ([1f36ecc](https://github.com/Sidiora-Labs/codify/commit/1f36ecce191b4f715f9b18416b52f4e58555e451), task codify-v16/2.6)
- Claim bounded flow traversal ([7670b0d](https://github.com/Sidiora-Labs/codify/commit/7670b0d37d7a49ee9482319e3067d46b0231834d), task codify-v16/4.3)
- Capture Ruby documentation through body wrappers ([387f04c](https://github.com/Sidiora-Labs/codify/commit/387f04c142cea34594c503bf80a71f6806c983ee), task codify-v16/2.5)
- Cover flow and inspection answers and partial extraction ([ef2d674](https://github.com/Sidiora-Labs/codify/commit/ef2d67404cb8c23c56fbfe381741dac4ce1a0bea), task codify-v16/4.1)
- Scope type resolution and track target dependencies ([42095e7](https://github.com/Sidiora-Labs/codify/commit/42095e7c4a1d9fd6ead6c209e88372a1dc052d07), task codify-v16/3.3)
- Bound receiver retries to affected files ([2e0866e](https://github.com/Sidiora-Labs/codify/commit/2e0866e665683bab14286b6cd60473874849b466), task codify-v16/3.2)
- Emit precise decorator and export facts ([37945af](https://github.com/Sidiora-Labs/codify/commit/37945affdba5684b9e76c9ae80e440eaf92cdac8), task codify-v16/2.5)
- Merge extraction health prerequisite into task 2.3 ([7a6bc8c](https://github.com/Sidiora-Labs/codify/commit/7a6bc8ca83682161aa1d6124be326da98c78c828))
- Add native web-language syntax extraction ([8b08fed](https://github.com/Sidiora-Labs/codify/commit/8b08fedb6c82f7c01b7767b679ef75728a0a4d47), task codify-v16/2.3)
- Verify native extraction and recover nullable syntax nodes ([fc65ab7](https://github.com/Sidiora-Labs/codify/commit/fc65ab718bedc1c17414be4d340a0a48741cbbae), task codify-v16/2.5)
- Resolve semantic imports and export chains ([b4d5096](https://github.com/Sidiora-Labs/codify/commit/b4d5096854cc7ca39e42de9280aed508a619a2d2), task codify-v16/3.1)
- Verify CLI answer freshness ([316a88d](https://github.com/Sidiora-Labs/codify/commit/316a88d1a375201bf85c3d4d91ad88bee6813f3f), task codify-v16/4.1)
- Skip semantic retry debt on unchanged files ([e7b406c](https://github.com/Sidiora-Labs/codify/commit/e7b406c88960f9e374aa4135ab42d091280f48cc), task codify-v16/2.1)
- Merge verified semantic storage for Codify 1.6 ([cb25d20](https://github.com/Sidiora-Labs/codify/commit/cb25d2046a2d07ea4a5c9b043a4357d9c8036ee6))
- Merge syntax runtime and semantic storage for systems adapter validation ([986ef6a](https://github.com/Sidiora-Labs/codify/commit/986ef6ad9311d0af28b5b341eab810c4a22e39b8))
- Attach health to CLI code answers ([cca7b70](https://github.com/Sidiora-Labs/codify/commit/cca7b70e5e81d0cb40abc2ae32956b29501b07d8), task codify-v16/4.1)
- Merge syntax projection for task 2.6 validation ([fa71062](https://github.com/Sidiora-Labs/codify/commit/fa710627fc60afcce4b7439fc7c3a9e77625a8a4))
- Roll back failed semantic writes and retain retry debt ([acdaf72](https://github.com/Sidiora-Labs/codify/commit/acdaf7245d5e4001c13aef28418185d3a5fa18ad), task codify-v16/2.1)
- Include grammar scanner helper headers ([e4dfbac](https://github.com/Sidiora-Labs/codify/commit/e4dfbaca1ea90376736dab421032516d6e6f2f6d), task codify-v16/2.6)
- Merge verified precise indexing freshness for Codify 1.6 ([4b19a3d](https://github.com/Sidiora-Labs/codify/commit/4b19a3d1f08da43cac9a0ed4ceb72c0c28dbf917))
- Merge semantic projection prerequisite into task 2.3 ([a157ab4](https://github.com/Sidiora-Labs/codify/commit/a157ab4a408a64b616f0a55d32a9c3e19956d268))
- Index legacy timestamp verification ([583f1ed](https://github.com/Sidiora-Labs/codify/commit/583f1ed04cfdc22ef8e72455633107b744039d49), task codify-v16/1.1)
- Abstain on interface method overloads ([6314125](https://github.com/Sidiora-Labs/codify/commit/63141250db44b2388cd27f6607301ef787888144), task codify-v16/3.5)
- Merge verified watcher recovery for Codify 1.6 ([4a95b87](https://github.com/Sidiora-Labs/codify/commit/4a95b8784a1c7236878e1a2637dc1d69f798070e))
- Refine dynamic ownership and type evidence ([9351de7](https://github.com/Sidiora-Labs/codify/commit/9351de7960f3a2b671580c13373d0525836a15a0), task codify-v16/2.5)
- Expose bounded index health in CLI and MCP ([75bbf0b](https://github.com/Sidiora-Labs/codify/commit/75bbf0bed9f404591dad4576594a1faee9b7aec8), task codify-v16/4.1)
- Synthesize bounded explicit dispatch relations ([009b65a](https://github.com/Sidiora-Labs/codify/commit/009b65acf3f5ce741941c46f161f6a15d7f6a32d), task codify-v16/3.5)
- Rearm child watches and force filesystem reconciliation ([d17a57c](https://github.com/Sidiora-Labs/codify/commit/d17a57ccebcd7acffb234df4d79dc9664c891737), task codify-v16/1.2)
- Merge syntax runtime for task 2.6 development ([a842a88](https://github.com/Sidiora-Labs/codify/commit/a842a88e58323dc80b4a91151f468f5c39e4594b))
- Merge native syntax and semantic prerequisites into task 2.3 ([cef0094](https://github.com/Sidiora-Labs/codify/commit/cef009463255d5b0de58098c007d4c85a832cb28))
- Merge semantic foundation for task 2.6 development ([45b035e](https://github.com/Sidiora-Labs/codify/commit/45b035e0fe25c985392544dd8dc70b78b955ca8f))
- Add managed language syntax adapters ([894bdb3](https://github.com/Sidiora-Labs/codify/commit/894bdb3cad9a2beab3ec9bcd1d2de12e5f21f7da), task codify-v16/2.6)
- Implement mixed language extraction adapters ([38d6f35](https://github.com/Sidiora-Labs/codify/commit/38d6f352e48b9690d46262477cec4b2fa957fe5f), task codify-v16/2.8)
- Add native Python Ruby PHP syntax adapters and fixtures ([de27c7e](https://github.com/Sidiora-Labs/codify/commit/de27c7eff957d5a659dd84608e5b1d56d5118d53), task codify-v16/2.5)
- Resolve receivers and overloads from semantic evidence ([c1f5ee5](https://github.com/Sidiora-Labs/codify/commit/c1f5ee53320b222c269a326b165c22a17c723400), task codify-v16/3.2)
- Record qualified semantic storage task ([8ab05aa](https://github.com/Sidiora-Labs/codify/commit/8ab05aaa636659eed3c6ea3a78b156835b12b72a), task codify-v16/2.1)
- Store branch-scoped semantic records and typed relations ([b93623c](https://github.com/Sidiora-Labs/codify/commit/b93623c65682bc345a2c4a284741329045b70013), task codify-v16/2.1)
- Resolve typed hierarchy relations and expose bounded traversal ([0cdc956](https://github.com/Sidiora-Labs/codify/commit/0cdc9567654be03ebaa0644dfdd7873668d9e44c), task codify-v16/3.3)
- Keep watcher test independent of storage directory spelling ([750121c](https://github.com/Sidiora-Labs/codify/commit/750121c45feb204ef7deef0f4c5f72d0897304bb), task codify-v16/1.2)
- Qualify watcher reconciliation task ([500ca60](https://github.com/Sidiora-Labs/codify/commit/500ca608a2a8907281374e2e9b30a0dc4841d309), task codify-v16/1.2)
- Persist watcher reconciliation debt and recover coverage codify-v16/1.2 ([284e0a0](https://github.com/Sidiora-Labs/codify/commit/284e0a0c051c7c950e5f80f00eb7515ff9ccbf60))
- Qualify precise indexing freshness ([dfcbaa0](https://github.com/Sidiora-Labs/codify/commit/dfcbaa08f8e0eec0dd62b0b01310a7b81458c7c6), task codify-v16/1.1)
- Preserve precise file freshness and hash dirty paths codify-v16/1.1 ([38ad381](https://github.com/Sidiora-Labs/codify/commit/38ad3811eff5d897ba90148482ff215829446f35))

## [1.5.0] - 2026-10-13

### Documentation
- The six translated READMEs carry the root README's header image, Trendshift badge and badge style ([7a91055](https://github.com/Sidiora-Labs/codify/commit/7a9105535d7d6c022908ce5b8a2792d32babc152))
- Codify-v14 closed — architecture covers the write journal, progress, [index] workers and the help table; source and test references regenerated from the graph; the six translations carry the v1.4 README changes; code map and agent context regenerated ([3be3ced](https://github.com/Sidiora-Labs/codify/commit/3be3ced6b958ab5ff616c20f42158d8fb9629fa3), task codify-v14/@docs)

### Spec workflow
- Task 4.2 done ([7d61600](https://github.com/Sidiora-Labs/codify/commit/7d616002641e856653af22c49f2839a1c02a9695))
- Task 1.3 done ([671147e](https://github.com/Sidiora-Labs/codify/commit/671147ed42b5f14a7c237ad84a561c998b01f9a2))
- Task 4.1 done ([a43c732](https://github.com/Sidiora-Labs/codify/commit/a43c7328a6552cf66f92d805fd67ba80068cef4f))
- Tasks 3.2 and 1.4 done ([66c5978](https://github.com/Sidiora-Labs/codify/commit/66c597820469506596de951ba166860b8d595adc))
- Task 4.1 symbols name the supervisor's manager array ([55040ca](https://github.com/Sidiora-Labs/codify/commit/55040ca28e4b5e5275db76dd6786b1a70a08fd6d))
- Tasks 2.4 and 4.1 done ([76dccf5](https://github.com/Sidiora-Labs/codify/commit/76dccf52def968a00bff190b3bfbdbde31cf8c45))
- Task 1.5 done ([95cb81e](https://github.com/Sidiora-Labs/codify/commit/95cb81e9c51a71961133ab60d6b662ef3ea9636d))
- Task 2.3 done ([7877845](https://github.com/Sidiora-Labs/codify/commit/7877845936f107f7c91c85e7c8040bd43aabbe91))
- Task 1.5 — grep hardening: the body_tri completeness guard and the shared QueryFilter on grep ([e5e4458](https://github.com/Sidiora-Labs/codify/commit/e5e445881977f88b6ad8fef1c791a161b649feaa))
- Tasks 1.1 and 2.2 done; 1.1 symbols named as implemented ([9754e41](https://github.com/Sidiora-Labs/codify/commit/9754e4166e09dd91fa8320061f6c547be031ec12))
- Task 1.1 done ([a3bc701](https://github.com/Sidiora-Labs/codify/commit/a3bc7013266e9ac84fb2c770739832a631342db5))
- Task 1.2 done ([4ccbda9](https://github.com/Sidiora-Labs/codify/commit/4ccbda948c2e1e5264840a70801b4dd01bffc5aa))
- Tasks 2.1 and 3.1 done; 2.1 no longer declares 21_grounding.sh, which the implementation did not need ([a0daa0c](https://github.com/Sidiora-Labs/codify/commit/a0daa0c860cf427938b90a745da72849f3c9c87e))
- Codify-v15 rendered requirements, design, and tasks ([941e092](https://github.com/Sidiora-Labs/codify/commit/941e09264a3d5d14aef88d31a9e96b3fa20344c9))
- Codify-v15 — grep and files over the graph, the index at scale, the Claude Code plugin and native agent tracking, the projection branch with conflicts before the merge, and the fleet shape of a manager per wave and a worker per task; active feature codify-v15 ([52d30fb](https://github.com/Sidiora-Labs/codify/commit/52d30fb0b91d1d4f2365ebee0a0bd0d487f30742))

### Fleet
- Waves side by side — [hierarchy] waves = parallel|sequential (parallel on git >= 2.38), cg spec start/fleet begin --ahead recording ahead on the lease, a strict done gate --force cannot pass in a fleet run, main merged forward into live wave branches after a land with conflicts escalated naming the projection finding, cg fleet sync, a projection build after land and sync; supervisor git status runs with --no-optional-locks so it no longer races a worker's index.lock ([2f1adba](https://github.com/Sidiora-Labs/codify/commit/2f1adba6193b782918d9c568fd383c0ed5192a0c), task codify-v15/4.2)
- A wave manager per wave and a task worker per task — wm-{feature}-{wave} on wave/{feature}/{wave} from main, w-{feature}-{task} on task/{feature}/{task} from its wave branch; [role.manager] aliases [role.feature]; templates without {wave}/{task} keep the older shape; plan and tree --json carry a manager per wave; begin cuts task/ from wave/, merge-up goes into the wave branch, land <wave|task-id> refuses naming the open tasks; the supervisor keeps a manager array per wave bounded by the manager max; workflow, help, docs/hierarchy.md and the VS Code fleet view follow ([88b92b7](https://github.com/Sidiora-Labs/codify/commit/88b92b743e5bc8d9490773a57cb1f458d0678a02), task codify-v15/4.1)

### Db
- A files table stamped v18 before files.base gains the column on open, filled from path ([c631374](https://github.com/Sidiora-Labs/codify/commit/c631374afa29fbf898d0e0ee765630e1c51c9d94), task codify-v15/1.3)

### Editor
- Native sessions and their subagents under a Sessions root in the fleet view, patched live from agent.native.* through the serve reducer, with commands to open a native agent's worktree and transcript; cg serve snapshot carries the native rows after a weak discovery hook task 2.4 replaces ([d307dd8](https://github.com/Sidiora-Labs/codify/commit/d307dd8a8d7387d88cb615b6e535dbf2289939d4), task codify-v15/2.3)

### Files
- Cg files answers globs, path words and directories from the files table and a trigram file_fts (schema 18); --dirs maps the tree with counts and dominant language; --path, --lang and --no-tests narrow search, context and survey inside the SQL; a large directory's context outline leads with its subdirectories; find_files over MCP and the filters on search_code and get_context ([74f063f](https://github.com/Sidiora-Labs/codify/commit/74f063f09ee848f0d612c560c4f5aab4e73f61b0), task codify-v15/1.2)

### Grep
- A body_tri short of the files that carry a body makes grep scan the whole scope and say so (full scan — body_tri incomplete, full_scan:"body_tri incomplete" in --json) instead of missing files silently; the next whole index pass re-inserts the missing rows and reports N trigram rows repaired; --path, --lang and --no-tests go through the shared QueryFilter so grep narrows exactly as search, context, survey and files do ([9ad126d](https://github.com/Sidiora-Labs/codify/commit/9ad126d7d002d69f29060782aa3b1941bfc6f744), task codify-v15/1.5)
- Cg grep searches lines through a trigram index (body_tri, contentless on SQLite 3.43+), scans candidates with literal or POSIX regex matching across worker threads, places each hit in its enclosing symbol, ranks and budgets the output, supports -C, --files, --count, --symbol, --kind, --path, --lang and --json, and answers grep_code over MCP; schema 18 ([615e28a](https://github.com/Sidiora-Labs/codify/commit/615e28aec16976a0f2a4dad323aca1926c459f76), task codify-v15/1.1)

### Index
- The index at scale — parallel walk, git-assisted candidates ([index] walk), contentless body_fts on SQLite >= 3.43 (fts_mode, cg info), files.base lookups replace LIKE '%/name', one FTS purge per chunk, walk/phase_ms/peak_rss_kb in --json; schema 18; tests/scale generator, 46_scale, scripts/bench.sh, measured table in docs/sync.md ([a2b88ff](https://github.com/Sidiora-Labs/codify/commit/a2b88ff5a4d21ffe72caee109e29bfec2d044446), task codify-v15/1.3)

### Integrate
- Cg integrate apply renders the Claude Code plugin marketplace under ~/.codify/plugins/claude-code (manifests, hooks.json calling cg by absolute path, .mcp.json, the workflow skill, brief/fleet/projection commands) with version-stamped codify-owned markers, installs it through the claude CLI or prints the two commands, and writes .codex/hooks.json; --no-plugin skips both; detect and doctor report the plugin's install and version state and the Codex /hooks trust step; cg hook install leaves settings.json to an installed plugin; every hook exits 0 outside a project or for an unknown subcommand; docs/integrate.md; 48_plugin.sh ([e6c5f95](https://github.com/Sidiora-Labs/codify/commit/e6c5f95c013ca97ff85dcbeec4390fd6bca58066), task codify-v15/2.1)

### Plugin
- No WorktreeCreate or WorktreeRemove hooks — a WorktreeCreate hook replaces git's worktree creation and a silent one makes it fail; hooks.json keeps only the documented hooks key with the ownership marker riding in each command; spec, test and doc follow ([e64f296](https://github.com/Sidiora-Labs/codify/commit/e64f29632085b0f8455c7672b9d2d03ce1aaff62))

### Projection
- A background build carries no agent, run or task identity from whoever triggered it, so its events are nobody's work ([664fb73](https://github.com/Sidiora-Labs/codify/commit/664fb739611cf61fc17ba4fa717449898c661125), task codify-v15/3.3)
- Symbol, interface, near, and textual findings from every build (src/conflicts.c), kept in projection_findings with projection.conflict once, projection.resolved when a fix lands, and projection.built per build; cg projection findings lists the live ones with ages; the agents on the branches involved are steered once per finding unless [projection] steer = false; 52_conflicts.sh ([0074aef](https://github.com/Sidiora-Labs/codify/commit/0074aef29021a347a80b2ba5738c9132c45211f3), task codify-v15/3.2)
- Cg projection build folds every active branch onto the base with merge-tree, uncommitted work through shadow commits from a copied index, conflicts folded with markers and attributed to the earlier branches, written to refs/codify/projection and the projections table; fingerprint no-op, --force, --strict, --branch, the build lock with --wait, status, diff, show, and --index checking the projection out under .codegraph/worktrees/projection indexed as branch codify/projection; [projection] base, stale, exclude, index in codify.kvx; schema 18 ([6435620](https://github.com/Sidiora-Labs/codify/commit/64356205512df955106ce4dd8c596a7ad122b524), task codify-v15/3.1)

### Other
- Improve logging for fleet e2e test run B beta ([43312da](https://github.com/Sidiora-Labs/codify/commit/43312dada4b871315bf4bb1f9cbd4c9d69c1c71e))
- Merge task 3.3: the projection follows the work — cg hook post-edit and the work events of cg hook event mark the projection dirty and start one detached cg projection build --quiet under the projection lock, at most once per [projection] min_interval (15s) unless [projection] auto = false; cg watch and watch --fleet build when edits settle, cg serve and the fleet supervisor after merge, land, begin and spawn events; fleet merge-up and land print the branch's known findings before merging; projection status groups the live findings by branch with ages, brief and state name the first two, fleet tree --json carries projection{}, the projection_status MCP tool, a Projection node in the editor's fleet view; a background build drops the triggering agent's identity so its events are nobody's work; 53_projection_live.sh and a 14_vscode fleet section ([4097ab8](https://github.com/Sidiora-Labs/codify/commit/4097ab8a4ee72e4a7162b65c8cc1afa7f7982760), task codify-v15/3.3)
- Fleet, sync doc: the merge-up header names the task branch and its base; the git walk's full-walk trigger describes the dirty set that collapsed past 256 KiB ([7759c7a](https://github.com/Sidiora-Labs/codify/commit/7759c7a841e4dc30937098f580579f04d2291efa))
- Merge task 4.2: waves side by side — [hierarchy] waves = parallel|sequential, cg spec start and cg fleet begin --ahead (--force no longer bypasses requires), the strict done gate, forward merges of main into live wave branches after a land (sup_forward_merge, fleet.forward), cg fleet sync (fleet.sync), a projection rebuild after every land and sync; the fleet-test flake fixed at its root: the supervisor's tree fingerprint and tree_clean run git --no-optional-locks status, so they no longer take index.lock under a worker's commit ([0392b62](https://github.com/Sidiora-Labs/codify/commit/0392b6218ccd349927dfaa46b130d1d62eee62e5), task codify-v15/4.2)
- Projection follows the work: cg hook post-edit and work events from cg hook event mark the projection dirty and start one detached cg projection build --quiet under the projection lock, once per [projection] min_interval (15s) unless [projection] auto = false; cg watch and watch --fleet build when edits settle, cg serve and the fleet supervisor after merge, land, begin and spawn events; fleet merge-up and land print the branch's known findings before merging; projection status groups the live findings by branch with ages, brief and state name the first two, fleet tree --json carries projection{} with per-branch counts, the projection_status MCP tool, and the editor fleet view gains a Projection node whose branch rows open the file in that worktree and badges on involved branches; 53_projection_live.sh and a 14_vscode fleet section ([38c7eb8](https://github.com/Sidiora-Labs/codify/commit/38c7eb8821cd9c8d39e93d8da6ec8fa03a0d1d39), task codify-v15/3.3)
- Merge task 1.3: the index at scale — parallel walk (src/walk.c), git-assisted change detection under [index] walk, a contentless body index on SQLite 3.43+, files.base with idx_file_base and idx_import_target, one FTS purge per chunk (body_tri included), phase timings and peak RSS in sync --json, the scale fixture, 46_scale.sh and scripts/bench.sh; body_fts follows its own DDL when it already exists ([ea31d22](https://github.com/Sidiora-Labs/codify/commit/ea31d22190e2c43d5630694b92e74761fafe449d), task codify-v15/1.3)
- Merge task 1.4: cg hook pre-bash — shell grep, find, rg, fd and ls -R advice toward cg grep and cg files, once per command per session, under [hooks] shell_advice; the skill, agent context, MCP descriptions and prompts say the same ([c70bd74](https://github.com/Sidiora-Labs/codify/commit/c70bd7453b1e7d382e593ba8f43f76c3c35ae0bb), task codify-v15/1.4)
- Merge task 3.2: projection conflicts — symbol, interface, near, content, delete and add-add findings over the fold, stored in projection_findings, projection.conflict and projection.resolved events, cg projection findings, and one steer per agent per new finding under [projection] steer; an unknown hook subcommand drains only the stdin that arrives ([b1350c6](https://github.com/Sidiora-Labs/codify/commit/b1350c630bd185f1fd995937ee62a4744787a91f), task codify-v15/3.2)
- Merge task 2.4: fleet discover — native sessions and subagents from the transcripts Claude Code and Codex already write; serve's snapshot and push loop run discovery first; the v18 agents columns are widened on every open so a graph stamped v18 before 2.2 gains them ([e99474d](https://github.com/Sidiora-Labs/codify/commit/e99474d968464f8c57f41ae0471a75c3713da188), task codify-v15/2.4)
- Hook pre-bash: a shell grep, rg, ag, ack, find, fd, or ls -R over the tree is answered with its cg grep or cg files equivalent as PreToolUse additionalContext, once per session per command, never a permission decision, silent under CG_SHELL_ADVICE=0, [hooks] shell_advice = false, a path outside the tree, or a non-Bash payload; cg hook install registers it; the skill, agent context, MCP tool descriptions, and the start-work and orient prompts say to use grep_code, find_files, search_code, and get_context before any shell search ([08fa148](https://github.com/Sidiora-Labs/codify/commit/08fa148d5f9a43bb32128a588fabc7feaaf6646f), task codify-v15/1.4)
- Merge task 4.1: wave managers and task workers — the default hierarchy, plan, begin, merge-up, land, and the supervisor's manager array ([026a34e](https://github.com/Sidiora-Labs/codify/commit/026a34e06f54b985ba88fee0cc482114194513d8), task codify-v15/4.1)
- Fleet discover: native sessions and subagents from the transcripts Claude Code and Codex already write, for hosts whose hooks never fired. Rows are created or completed column by column only where empty, so a hook's field is never overwritten; the discovered column records which columns came from transcripts. Worktrees named in meta.json are registered, pending spawns are claimed by toolUseId, and a transcript untouched for 15 minutes marks its agent stale. fleet status, fleet tree, serve's refresh and watch --fleet run discovery first under [fleet] discover (default true), once per 10 s per process, skipped by --no-discover. The transcript directory lookup is one helper, transcript_dirs, shared with recap. ([96497d3](https://github.com/Sidiora-Labs/codify/commit/96497d36078b8ee12219bdf18ca0742c5e2bfb04), task codify-v15/2.4)
- Merge task 1.5: grep hardening — the body_tri completeness guard and the shared QueryFilter on grep ([657ba24](https://github.com/Sidiora-Labs/codify/commit/657ba244be69ffcefe1c1ed49f15b13d6b268d3e), task codify-v15/1.5)
- Merge task 2.3: native agents in the editor and the serve stream ([018ad1f](https://github.com/Sidiora-Labs/codify/commit/018ad1f240c8973c233937ce6545af7d91356e80), task codify-v15/2.3)
- Merge task 2.2: cg hook event — native sessions and subagents in the agents registry, their worktrees, tasks, and events ([ce78643](https://github.com/Sidiora-Labs/codify/commit/ce7864376b0a7947ff229036356fc02778401d47), task codify-v15/2.2)
- Native agents: cg hook event records Claude Code and Codex sessions and the subagents their Agent tool spawns in the agents registry (schema 18 columns added in place), with pending spawns matched by type or meta.json tool_use_id, linked-worktree branches registered against the session's branch, task attribution with its source, agent.native.* events, the native tree in fleet status and fleet tree --json, and the one-line summary in brief and state ([306c055](https://github.com/Sidiora-Labs/codify/commit/306c0554a5ad7e34052f7523d8fbec5a382f905f), task codify-v15/2.2)
- Merge task 1.1: cg grep — trigram candidates, regex and literal scan, hits placed in their symbols, grep_code over MCP ([a383ce7](https://github.com/Sidiora-Labs/codify/commit/a383ce787e3db244bc7ee1434380421b330c92ca), task codify-v15/1.1)
- Merge task 1.2: cg files and the shared --path, --lang, --no-tests filters ([5b93c78](https://github.com/Sidiora-Labs/codify/commit/5b93c78c3e6d5eb50d9fdaecff7571c9a30b5751), task codify-v15/1.2)
- Merge task 3.1: cg projection build — active branches, shadow commits, the merge-tree fold, the ref, the worktree index ([17e8bba](https://github.com/Sidiora-Labs/codify/commit/17e8bbada8ea5fcc9b23fb8cf70a3dbb7a850d08), task codify-v15/3.1)
- Merge task 2.1: the Claude Code plugin and the Codex hooks installed by cg integrate ([2e43799](https://github.com/Sidiora-Labs/codify/commit/2e43799c3ba3e324b5917d4123b6c821faa13b46), task codify-v15/2.1)

## [1.4.0] - 2026-10-07

### Spec workflow
- Codify-v14 — progress for init, sync and index; a write journal for the busy database; [index] workers in codify.kvx; cg help as a grouped map ([2010aeb](https://github.com/Sidiora-Labs/codify/commit/2010aebd328357f5297ec408a20bbe8c017b720b))

### Changelog
- V1.4.0 section regenerated; scripts/format_changelog.py; ignore scripts/index.html; codify-v14 documentation in progress ([4614459](https://github.com/Sidiora-Labs/codify/commit/46144594c076028fd01b273fc496757c36225a94))

### Help
- An unknown command is answered before the graph opens, so cg serch gets its suggestion outside a project instead of 'not inside a Codify project'; version 1.4.0 ([41492bb](https://github.com/Sidiora-Labs/codify/commit/41492bb907a786e3b12a66ef2805370fa48b5012), task codify-v14/4.1)
- Cg help as a grouped map from one command table — overview, per-command detail, --all, --json, and main's usage lines; 43_help.sh checks dispatch, width, color, and the README ([4c1ad82](https://github.com/Sidiora-Labs/codify/commit/4c1ad823f79677e1a06ca7fca67ce82e2dca49cb), task codify-v14/4.1)

### Index
- [index] workers in codify.kvx — a configured parse worker count with --workers, CG_INDEX_WORKERS, config, machine precedence; the pipeline cap rises to 64; cg info prints the origin; spec: 3.1 done ([b269d56](https://github.com/Sidiora-Labs/codify/commit/b269d5620fee7c17c75cb799d73f2debd94a8d70), task codify-v14/3.1)

### Journal
- Lifecycle writes that find the database busy are queued in .codegraph/journal/ and replayed by the next process that holds the lock; claims still exit 75 and say why they are not journaled; cg journal list|apply|drop; pending counts in brief, state and check; queued memories in recall ([0ba580f](https://github.com/Sidiora-Labs/codify/commit/0ba580fe13e1e97c5fb2c02d977b9d18b9a376e6), task codify-v14/2.1)

### Progress
- A live status line for init, index and sync — phases, counts, workers, waits; CG_PROGRESS=plain|0; implicit and --json passes silent ([13b7ad2](https://github.com/Sidiora-Labs/codify/commit/13b7ad222047d97b73de003979d194c542f3cd4c), task codify-v14/1.1)

### Other
- Change image source in README to a URL ([9ece15e](https://github.com/Sidiora-Labs/codify/commit/9ece15e0c72c72594ce3193766c579f98ee3d40c))

## [1.3.0] - 2026-10-06

### Documentation
- Codify-v13 closed — architecture covers configuration, the code map and memory transport; reference tables, changelog and tool counts regenerated ([c455a26](https://github.com/Sidiora-Labs/codify/commit/c455a263dda6214893ccb0b767f15bf89ff0c2d9), task codify-v13/@docs)

### Build and tooling
- Update changelog for v1.3.0 release; add project configuration and codemap details ([72d51fa](https://github.com/Sidiora-Labs/codify/commit/72d51fad0a11327c6ac56388017aa32305f2f085))

### Spec workflow
- 2.1 done ([6a80082](https://github.com/Sidiora-Labs/codify/commit/6a8008296e02461da674ee2d584b0c0e9a35a760), task codify-v13/2.1)
- 3.1 done ([be19a89](https://github.com/Sidiora-Labs/codify/commit/be19a8986208b704d63c1cd6d78b74831b8cc1b1), task codify-v13/3.1)
- 4.1 done — touches and criteria aligned with the delivered change ([b9fba53](https://github.com/Sidiora-Labs/codify/commit/b9fba5356870a6469fb831fce1753b7e200e9025), task codify-v13/4.1)
- Merge codify-v13 onto main ([fd0b987](https://github.com/Sidiora-Labs/codify/commit/fd0b987e485c99b811dcb1ecaba4211def497113))
- Codify-v13 — explore, map, carry, configure ([1e0d021](https://github.com/Sidiora-Labs/codify/commit/1e0d0213ed1fc9e7dca2f9379c79a20f5613dc65))
- 1.1 done ([c24d737](https://github.com/Sidiora-Labs/codify/commit/c24d737276834d3947728070189bb4771c57df1a), task codify-v12/1.1)

### Memory
- Export and import — JSONL by content id, graph-to-graph, MCP tools ([47cac03](https://github.com/Sidiora-Labs/codify/commit/47cac035c6258bf6db068eb4cd1ee6afc73e25ae), task codify-v13/3.1)

### Codemap
- The default path, spec pointers, agent context and skills follow codify.kvx; a configured directory is created on write; codemap joins the MCP tool-list test; README counts 60 tools ([136280f](https://github.com/Sidiora-Labs/codify/commit/136280fd4b2ca20aec087ee12bd088baa2259dec), task codify-v13/2.1)
- Cg codemap writes CODEMAP.md from the graph — overview with build and test commands, layout, entry points, modules with their most-referenced symbols, directory dependencies, tests, workflow pointers; byte-stable, budget-fitted with per-section omission counts, marker-owned with --force and --check; MCP codemap tool; brief names the map and whether it is stale ([7b2bed0](https://github.com/Sidiora-Labs/codify/commit/7b2bed09a920b328f903bb6236dc9fbd0389b4f7), task codify-v13/2.1)

### Config
- Unit and integration tests, docs/config.md and README section ([b3f37f7](https://github.com/Sidiora-Labs/codify/commit/b3f37f74be5783a011829088307e8437db2b016d), task codify-v13/4.1)
- Codify.kvx project configuration — [paths] spec/context/skills/codemap relocate every spec, context and skill site through one per-root cache; [sync] auto=false gates every implicit sync; cg config list/init/get/set/check ([6b72a5a](https://github.com/Sidiora-Labs/codify/commit/6b72a5af1282bfcdeb5ed717b305a0af0fbe6185), task codify-v13/4.1)

### Index
- The spec graph check, editor hover and go-to-definition, and the agent context lead with the definition; spec: 1.1 done ([7415bfe](https://github.com/Sidiora-Labs/codify/commit/7415bfeed12e9a7e61803ecf85d9a45088761c0d), task codify-v13/1.1)
- Prototypes are declarations that end at their own ';', calls through a prototype resolve to its definition, symbol_fts carries name words, refs.target_id indexed; schema v17 ([94b0348](https://github.com/Sidiora-Labs/codify/commit/94b03485c7d75beeb6e99644ae40b6054bd4833d), task codify-v13/1.1)

### Recap
- Resume brief from Claude Code and Codex transcripts — Solar Decide (System One via the Centra gateway) judges every statement's kind, still-true and needed-to-resume in small parallel cached chunks, the picked statements form a decided log, the changelog's gateway model writes the brief; jev_ask_at and chat_model_ask exposed ([80127c3](https://github.com/Sidiora-Labs/codify/commit/80127c310196ecdeddbc013c38f0c0dbd05ddc2d), task codify-v12/1.1)

### Retrieval
- Outlines label prototypes; the code map counts definitions, not their prototypes ([29a4f34](https://github.com/Sidiora-Labs/codify/commit/29a4f3423c2755c6b68a7c866bdb59ec480f1384), task codify-v13/1.1)
- Definitions answer before prototypes, phrase ranking over names, docs and bodies, path outlines for files and directories, context filled to its budget with tokens_used ([4a32a6d](https://github.com/Sidiora-Labs/codify/commit/4a32a6dba303ec96155ee8674bd4262181abf0e0), task codify-v13/1.1)

### Other
- Update README.md ([c20c06b](https://github.com/Sidiora-Labs/codify/commit/c20c06b9ad09117652eb2a6f89f323a522f9f31d))

## [1.1.0] - 2026-09-28

### Changelog
- Add .env to .gitignore; update changelog generation message for clarity; enhance documentation on changelog and contribution processes ([a0f120e](https://github.com/Sidiora-Labs/codify/commit/a0f120eca214ab53afd52d1b457475e92415b8f0))

## [1.0.0] - 2026-09-28

### Documentation
- Merge branch-scoped required surface and the v10 reference tables ([c845585](https://github.com/Sidiora-Labs/codify/commit/c8455850668cddbf1a2ac806de8f71922277b695))
- V10 source and test references from the required surface ([23e084f](https://github.com/Sidiora-Labs/codify/commit/23e084f080d31a827fbc4a2dba46ba2db0d9d82b))
- Derive the required surface from the open branch only ([51623a9](https://github.com/Sidiora-Labs/codify/commit/51623a9c1b546eda732bdc32d41cf9edc5d9fe6e))
- Merge cg changelog test, README and contributor notes ([c567b0d](https://github.com/Sidiora-Labs/codify/commit/c567b0dd58af3e4b429d12b769054df5bf445e48))
- Cg changelog from git — test, README, contributor notes ([a6add23](https://github.com/Sidiora-Labs/codify/commit/a6add234255f282f066c9d29df3db1c182916908))
- Re-anchor the fleet view's docs on the tree-first join ([0d86d5c](https://github.com/Sidiora-Labs/codify/commit/0d86d5c8de1ab7feb479c0227b046b6329ca803b), task codify-v10/5.3)
- V10 ships — orchestrator, skills, Jev advisories, branch-scoped reads, extension 1.3.0 ([eb11fe3](https://github.com/Sidiora-Labs/codify/commit/eb11fe325832dd8411e0cf81a265ca8a01ae72c6), task codify-v10/6.1)
- Changelog in task order, git-tagged commits as touched-path evidence ([63a116b](https://github.com/Sidiora-Labs/codify/commit/63a116b79a3f6372f932771cb671946442aeea7d), task codify-v10/6.1)
- Merge v10 documentation ([de78f2a](https://github.com/Sidiora-Labs/codify/commit/de78f2a1ebba93f2e491a0209ad68c5d7b66117d), task codify-v10/6.1)
- Correct the branch-scoping limitation — writes are scoped, reads are not ([f7c309f](https://github.com/Sidiora-Labs/codify/commit/f7c309f252588d6ba26b588e9ac7064fe1adc30a), task codify-v10/6.1)
- V10 — sync gate, fleet hierarchy, unified branch graph, Jev, extension surfaces ([3861b23](https://github.com/Sidiora-Labs/codify/commit/3861b23a6aab64994cd2bdd970d04ccae9597542), task codify-v10/6.1)
- Enable auto closure, add workflow guide, source/test references, align contributor instructions ([efd71fd](https://github.com/Sidiora-Labs/codify/commit/efd71fd6e2c1fbc28983443c18343f4990a1a52d))

### Tests
- Make 28_jev.sh executable so verify_cmd can run it ([993b673](https://github.com/Sidiora-Labs/codify/commit/993b673623d8a2a3b8f8a3f9ee8279503f3d8dbf), task codify-v10/4.1)

### Extension
- Start the fleet from the spec or the view with a plan preview, Stop/Pause/Resume, live agent steps and cost, stall/retry/escalation badges, approvals as rows, transcripts on click ([f66abcd](https://github.com/Sidiora-Labs/codify/commit/f66abcde1d41213e1244139b6c2d3055e5629740), task codify-v11/6.1)
- One cg serve connection for every call and event, rows patched from pushed events, polls off while connected, fallback for an older cg ([45591b3](https://github.com/Sidiora-Labs/codify/commit/45591b3e287a72e6ddeda72b69f7c70fd1872833), task codify-v11/5.2)
- Fleet view reads cg fleet tree ([cbda36a](https://github.com/Sidiora-Labs/codify/commit/cbda36a5c53ad9abc1b45097440980df77080602), task codify-v10/5.3)
- Fleet view reads cg fleet tree — cg's own hierarchy wins, the composed join fills the gaps and still carries an older binary ([5f521c6](https://github.com/Sidiora-Labs/codify/commit/5f521c602715d6d66e862b5c20af40594ad0b35e), task codify-v10/5.3)
- Merge memory browser follow-up against real cg shapes ([df79e9f](https://github.com/Sidiora-Labs/codify/commit/df79e9fc4c3f4207e17fd4875d9ed661d5074090), task codify-v10/5.2)
- Memory browser actions match the real cg shapes — skills keyed by memory id, promote --json, classify notices, Jev key hint ([a06f411](https://github.com/Sidiora-Labs/codify/commit/a06f411819447fb50feef0c417436212766fe8fb), task codify-v10/5.2)
- Merge agent chat polish ([0c2a3d8](https://github.com/Sidiora-Labs/codify/commit/0c2a3d89704c77b0c3c06b67d4790179b423d914), task codify-v10/5.3)
- Merge fleet view ([9936162](https://github.com/Sidiora-Labs/codify/commit/9936162ee958745409ae00ac4f9af7c2292308b0), task codify-v10/5.3)
- Agent chat — real diffs, terminal output, inline permissions that cannot hang, cancel/retry, session switch, cost ledger ([89b3b37](https://github.com/Sidiora-Labs/codify/commit/89b3b37d0360b7b9951bb617d398f314c7a00f97), task codify-v10/5.3)
- Merge task tree, filters, detail webview, actions ([65a4389](https://github.com/Sidiora-Labs/codify/commit/65a4389f7ddc2debe4240185437c04f96aa6b329), task codify-v10/5.1)
- Fleet view — Main Gideon, feature managers, wave workers, branch/heartbeat/merge state, and begin/merge-up/land/pr/checkpoint actions ([8203cd0](https://github.com/Sidiora-Labs/codify/commit/8203cd091d7adcd6199e13ab1285d63ebd04c9f5), task codify-v10/5.3)
- Task tree grouped by feature/section/wave with owner, branch and blockers, status/wave/owner filters and search in the view title, a CSP-strict task detail panel, and start/done/claim/release/branch/verify/prompt actions ([a78ee54](https://github.com/Sidiora-Labs/codify/commit/a78ee54dd4cb2aad78386b73e3b7703b8536c453), task codify-v10/5.1)
- Memory browser — CSP-strict panel with full-text search, type/class/task/branch/date filters, linked symbols and files, and supersede/forget/classify/promote actions ([a71d042](https://github.com/Sidiora-Labs/codify/commit/a71d0428f432c6d3d26b0ef306faa5dfb632ad17), task codify-v10/5.2)
- One refresh scheduler, no graph.db watcher, slow polls, trace --no-sync, codify-workflow identity ([735ded3](https://github.com/Sidiora-Labs/codify/commit/735ded33e83fc9db81b6d315d749e31b7b0c6657), task codify-v10/1.4)

### Spec workflow
- 7.1 done ([dfc7f08](https://github.com/Sidiora-Labs/codify/commit/dfc7f0879ed1c45e8d26aa47833e775e4e767d38), task codify-v11/7.1)
- 6.2 done ([2c28296](https://github.com/Sidiora-Labs/codify/commit/2c28296008292e2c2efb0654ce9ed487ef6e1ff4), task codify-v11/6.2)
- 6.1 done ([893edae](https://github.com/Sidiora-Labs/codify/commit/893edaeee63f14733e8ea646f1c7292509f30864), task codify-v11/6.1)
- 5.2 done ([10b21c3](https://github.com/Sidiora-Labs/codify/commit/10b21c39ce3152a6399c559ffd6343a41a5917b6), task codify-v11/5.2)
- 5.1 done ([c6c68c9](https://github.com/Sidiora-Labs/codify/commit/c6c68c9bb40ee72b9e7b9c9f7a261bbdd758eef2), task codify-v11/5.1)
- 4.1 done ([bc98274](https://github.com/Sidiora-Labs/codify/commit/bc982743e007e8ee8954a90f4bfa43be97f32397), task codify-v11/4.1)
- 4.3 done ([344c6e7](https://github.com/Sidiora-Labs/codify/commit/344c6e7ec81d3092cbeae67e862caffa7aa04d41), task codify-v11/4.3)
- 4.2 done ([1fde14d](https://github.com/Sidiora-Labs/codify/commit/1fde14d051f76ddf8b71394bde7ee06e30ebfa5d), task codify-v11/4.2)
- 3.2 done ([3088807](https://github.com/Sidiora-Labs/codify/commit/3088807a5361692b42ee5dda1c4e59149492a418), task codify-v11/3.2)
- 3.1 done ([d63d2ed](https://github.com/Sidiora-Labs/codify/commit/d63d2ed8990f4d9652f4021ae2c5c64b96b0569e), task codify-v11/3.1)
- 2.2 done ([08d80cc](https://github.com/Sidiora-Labs/codify/commit/08d80ccfd8b8158c797707a9e174ae2b3698eb96), task codify-v11/2.2)
- 2.1 done ([62b4bf2](https://github.com/Sidiora-Labs/codify/commit/62b4bf27fb8276ad44b0e115c8cb77605c76fc22), task codify-v11/2.1)
- 1.2 done ([62d083d](https://github.com/Sidiora-Labs/codify/commit/62d083dcbc53652ab63f6aa00d63129f64e9db6a), task codify-v11/1.2)
- 1.1 done ([7961415](https://github.com/Sidiora-Labs/codify/commit/796141579d12361074c79838a6b3370834f7c5bd), task codify-v11/1.1)
- Drop the unused clock read in spec_claim_cmd, lint-clean under -Wall -Wextra ([cf13a39](https://github.com/Sidiora-Labs/codify/commit/cf13a3937a487a27685d0fac8a07bc6c97e37986), task codify-v10/6.1)
- 5.3 done ([d290c7d](https://github.com/Sidiora-Labs/codify/commit/d290c7d44ed9f7376f19db40dc8940a2fa1b2ff1), task codify-v10/5.3)
- Git commits tagged with a task count as touched-path evidence, git log ingested before the check ([b4ea395](https://github.com/Sidiora-Labs/codify/commit/b4ea39525eb6e0e335e1d91a5dcc7bcd1ffcb388), task codify-v10/6.1)
- 2.3 done ([7482b7b](https://github.com/Sidiora-Labs/codify/commit/7482b7bdbe7c1ef4fdb879b03fc6ae697da8a1cf), task codify-v10/2.3)
- 5.1 in progress ([961269a](https://github.com/Sidiora-Labs/codify/commit/961269ab86e4c32e65e5cb96d11d6eafc7475c04), task codify-v10/5.1)

### Guard
- Fewer false unknowns — shorthand methods, expression receivers, parameters and locals, definer prefixes, attribute lists, nested manifests, Go keywords ([5e63500](https://github.com/Sidiora-Labs/codify/commit/5e6350015420d3bce62212265243d4d30411e6e5), task codify-v10/6.1)
- Ground C calls through the headers a repo include reaches, and Node core modules ([8496337](https://github.com/Sidiora-Labs/codify/commit/849633700e3f2ec9ca6ef79452a2bed09e9e2634), task codify-v10/6.1)

### Anchors
- Re-attach the doc comments v10 moved ([1c1f1f8](https://github.com/Sidiora-Labs/codify/commit/1c1f1f88631c471ad53d83006aec15a1b43d24f5), task codify-v10/6.1)

### Graph
- Merge branch-scoped indexing, queries, memory promotion, brief, watch --fleet ([d7e4e71](https://github.com/Sidiora-Labs/codify/commit/d7e4e7184bcbd676fd20e5e59b26060fec28705e), task codify-v10/3.2)
- Schema v15 with a branch registry and branch-scoped file rows, linked worktrees join the shared .codegraph, per-branch freshness and gates, cg branches, refuse to downgrade a newer database ([2253701](https://github.com/Sidiora-Labs/codify/commit/2253701856179f82cb2c98d3125b750efc657a3a), task codify-v10/3.1)

### Sync
- One post-edit hook, targeted LSP and watcher passes, freshness windows for review, agentmd, and MCP ([5702699](https://github.com/Sidiora-Labs/codify/commit/57026996a170b1c8ee36040a9cd3792782628cb2), task codify-v10/1.3)
- Single-writer index gate with coalescing, freshness, machine slots, and incremental post-scan resolution  [spec:codify-v10/1.2] ([8f6e754](https://github.com/Sidiora-Labs/codify/commit/8f6e754994c052afae812020c807a395403feee8), task codify-v10/1.1)

### Fleet
- Three-level concurrent tree — per-task branches, a merge lock instead of turn-taking, the main agent (opt-in), several features under one supervisor ([5f49b41](https://github.com/Sidiora-Labs/codify/commit/5f49b4172517b54cd816d0ba100ca6724eca4d24), task codify-v11/4.1)
- Fleet_run_open and fleet_run_resume as planned ([6c8bc03](https://github.com/Sidiora-Labs/codify/commit/6c8bc03afb4822de15a9cf04cfd2500c46d48be3), task codify-v11/3.1)
- Durable supervisor — fleet up/down/pause/resume/runs, crash resume adopting live agents, opt-in approval gates ([e638d7f](https://github.com/Sidiora-Labs/codify/commit/e638d7f8f1232357d2278c94f99c0f930c549b04), task codify-v11/3.1)
- Per-role capabilities — driver, model, args, max, wall, spend, retries, stall, approve ([ade87e1](https://github.com/Sidiora-Labs/codify/commit/ade87e1dc533b0affac8b7304f8b37153de35e1d), task codify-v11/1.2)
- Branch lifecycle — cg fleet begin/merge-up/land/pr/checkpoint, schema v16 (attempts branch/worktree/parent, memories branch/class/confidence), spec_claim shared with the fleet, git_run/worktree helpers, fake gh fixture ([83d3e2e](https://github.com/Sidiora-Labs/codify/commit/83d3e2ed4608390063326778654bc0bf084c43da), task codify-v10/2.2)
- Hierarchy config, agent roles and parents, fleet roles/status/plan ([cea966a](https://github.com/Sidiora-Labs/codify/commit/cea966a563dec24f58c82db1ef3d962bb8e3dcfe), task codify-v10/2.1)

### Orchestrate
- Merge two-level fleet run and cg fleet tree ([c4f588a](https://github.com/Sidiora-Labs/codify/commit/c4f588a6ab84854dca298df32f98f8c6e777a2e1), task codify-v10/2.3)
- Two-level fleet run — cg spec run --fleet spawns a feature manager and wave workers in their own worktrees, cg fleet tree, resume prompts that hand work upward ([b94cd35](https://github.com/Sidiora-Labs/codify/commit/b94cd35598a7d4d764ac9856a5548826b1173c03), task codify-v10/2.3)

### Jev
- Merge advisory triage, guard ranking, PR readiness ([32bc7d9](https://github.com/Sidiora-Labs/codify/commit/32bc7d96c9ddfd1d076753c6f33c9ef88020a898), task codify-v10/4.3)
- Advisory triage, guard ranking, and PR readiness — one shared key gate, verify_cmd tail through popen, one ranking call per guard run, fake-curl answer overrides ([43c9009](https://github.com/Sidiora-Labs/codify/commit/43c90095267145364c708edef027947804368488), task codify-v10/4.3)
- Client over curl with a private config file, canonical request bodies, 429/529 backoff, jev.log, cg jev doctor/ask/log, local-first principle ([2231dd5](https://github.com/Sidiora-Labs/codify/commit/2231dd533bccf5aa8dea4180a685ed4d894e6d29), task codify-v10/4.1)

### Skills
- Merge Jev memory classification, cg skills, MCP tools ([9feec06](https://github.com/Sidiora-Labs/codify/commit/9feec060a9cd16f31807a800c50855bdb894ed24), task codify-v10/4.2)
- Cg memory classify asks Jev which kind of note a memory is, cg skills list/promote/render turns the skills into owned .agents/skills/<slug>/SKILL.md, class exposed in recall/brief and the three tools over MCP ([2c4e326](https://github.com/Sidiora-Labs/codify/commit/2c4e3261c250b2dbc5c1594585b98bda8206093f), task codify-v10/4.2)

### Changelog
- Update version to 1.0.0 and modify changelog generation message; update spec status to in_progress ([7c2dda5](https://github.com/Sidiora-Labs/codify/commit/7c2dda57dedf982aa9be5d5c7112b838b5c76597))
- Git-cliff reference configuration — releases per tag, groups per subject prefix, task references ([b58fac9](https://github.com/Sidiora-Labs/codify/commit/b58fac9f95353a799fe4ac39d2bd73c8f7612560))

### Drift
- Interface drift across live branches after a merge (event + steering), requirement coverage before land with an opt-in gate, drift in brief and fleet tree ([1aeed75](https://github.com/Sidiora-Labs/codify/commit/1aeed75f11811624ff1a012d39e73f257c417b3e), task codify-v11/5.1)
- Spec drift at done and merge-up (opt-in approval), collision prediction and serialization in the supervisor, cg drift ([5aac1ae](https://github.com/Sidiora-Labs/codify/commit/5aac1aede9092e63047f95188ebb2904f0dc9341), task codify-v11/4.3)

### Drivers
- Structured Claude/Codex output read into agent.* events, role capabilities at spawn, steering by hook and prompt ([b20e14f](https://github.com/Sidiora-Labs/codify/commit/b20e14f5c12a3c9bed9cbfe283bbda45ea7fe102), task codify-v11/2.2)

### Events
- Append-only event log — triggers on durable tables, kvx status hook, fleet and orchestrator emits, cg events [--follow] ([e268cf0](https://github.com/Sidiora-Labs/codify/commit/e268cf078a2a8ebe7f7e1844492d87a56203b884), task codify-v11/1.1)

### Lang
- Index C typedef'd anonymous aggregates; stop the one-line typedef pattern naming a member ([bfc554c](https://github.com/Sidiora-Labs/codify/commit/bfc554ccfe7e80416824712bd80c0c721abbd335), task codify-v11/1.2)

### Packets
- Graph-grounded worker and manager briefings within a budget, upstream deltas in work update, cg fleet brief ([6c0e2af](https://github.com/Sidiora-Labs/codify/commit/6c0e2af8ea2729cca9285a1f10acc11e2ee238e9), task codify-v11/3.2)

### Serve
- Name the dispatcher and pusher as planned ([078a87d](https://github.com/Sidiora-Labs/codify/commit/078a87db1759d73eb5d81a38c5ddf54feee53869), task codify-v11/2.1)
- Cg serve — JSON-RPC over stdio with every tool, exec, cancel, and pushed event subscriptions; cg tool list|call ([7075df0](https://github.com/Sidiora-Labs/codify/commit/7075df01aae4e5fffd02f101402cdc9c0962b804), task codify-v11/2.1)

### Supervisor
- Budget, stall, retry, and escalate as named checks ([e050756](https://github.com/Sidiora-Labs/codify/commit/e050756ccd1840df2dd5ea0e2545e67f3842b434), task codify-v11/4.2)
- Stall nudges and restarts with handoffs, wall and spend budgets, retries carrying what failed, escalation to manager then main, blocked runs ([9a034d4](https://github.com/Sidiora-Labs/codify/commit/9a034d45ebf41c12586f4b97fb94355325adcfe0), task codify-v11/4.2)

### Work
- Upstream appears in deltas only when something merged — keep unchanged deltas compact ([719c239](https://github.com/Sidiora-Labs/codify/commit/719c2399c6d2c00eef562dfd86ea6000c07bbac5), task codify-v11/3.2)

### Other
- Fleet e2e: two features under failure, straight and killed-and-resumed; tags name their feature for packets and memories; a running task is never re-slotted; --all names the first run ([3eda32e](https://github.com/Sidiora-Labs/codify/commit/3eda32e84510f25dd5eafd019985b2f7e4ea5e27), task codify-v11/7.1)
- Vscode chat: every served tool as a slash command with typed arguments, attach to a fleet agent and steer it, approvals and escalations as cards, windowed transcript ([2fd81af](https://github.com/Sidiora-Labs/codify/commit/2fd81af6f7e94b3c9e5c758d95f4852acaa4c187), task codify-v11/6.2)
- Branch-scoped graph: reads default to the open branch, indexing reuses parsed content by hash, memories carry a branch, watch --fleet follows every worktree ([0a68e39](https://github.com/Sidiora-Labs/codify/commit/0a68e39bee5468a60accabb97c01854bca4fd5cf), task codify-v10/3.2)
- Merge main (schema v16) into 5.1 branch ([f325ef8](https://github.com/Sidiora-Labs/codify/commit/f325ef8b3f2aeea2f9c7694df31e1a57d9dece72))

## [0.9.0] - 2026-09-05

### Bug fixes
- Agent panel replay notes, cleaned session titles, single-row timeline ([4f6a02b](https://github.com/Sidiora-Labs/codify/commit/4f6a02b8ce5396162e729581a76fa620c3484a65))

### Style
- Taller agent panel composer ([17ad627](https://github.com/Sidiora-Labs/codify/commit/17ad627f6dc0de0295cefa1564b6b95f620b0775))

### Releases
- Qualify Codify 0.9.0 evidence-grounded documentation closure ([bc9ee64](https://github.com/Sidiora-Labs/codify/commit/bc9ee6450895ffe92eec37aae77d8408b82f96e0))
- Qualify Codify 1.2.5 extension ([58f5641](https://github.com/Sidiora-Labs/codify/commit/58f56418c3b124a1845c40831c310b756e29ce9a))
- Qualify Codify 0.8.5 control plane ([f825283](https://github.com/Sidiora-Labs/codify/commit/f8252837103943698f54df4b616801b8a0aa9ecc))

## [0.8.5] - 2026-09-04

### Features
- Agent panel with provider picker, Codify toolbar, sub-agent and timeline views ([0c05bf6](https://github.com/Sidiora-Labs/codify/commit/0c05bf6e1f15da6fb0a6c77cd9384e7186dcebdd))
- Redirect legacy Codex ACP adapter to maintained 1.7.0 release ([b280b70](https://github.com/Sidiora-Labs/codify/commit/b280b70c7e9d9a74577be8beaadf9c190710915a))

### Bug fixes
- Keep the graph database writable while the LSP indexes ([5771e87](https://github.com/Sidiora-Labs/codify/commit/5771e87d04c93ac5fdae76ce2655cb9b9e5d71aa))

### Spec workflow
- Qualify task 5.2 agent panel ([21b2378](https://github.com/Sidiora-Labs/codify/commit/21b23788e55319014cf941f53c898b912b65fd31))

## [0.8.0] - 2026-08-31

### Features
- Modernize MCP and generated agent ownership ([8459574](https://github.com/Sidiora-Labs/codify/commit/84595747d19b8e8709a4b8ced59a6366fe50afe0))
- Add bounded agent recovery and work packets ([81511af](https://github.com/Sidiora-Labs/codify/commit/81511af870a084ffeb30c9c072026429b33e3478))
- Normalize agent lifecycle events ([482ba54](https://github.com/Sidiora-Labs/codify/commit/482ba54e2f48516d452e1fe143a5d72d90719077))
- Add universal agent integration registry ([c0b10df](https://github.com/Sidiora-Labs/codify/commit/c0b10dff3c7b0c6e458de5d1b9659a1f3a9c475c))
- Add truthful state and fenced orchestration ([fa61fe7](https://github.com/Sidiora-Labs/codify/commit/fa61fe7bac502dd11f89298c76639788a18e338f))
- Add fenced task attempts and reconciliation ([6d21c9e](https://github.com/Sidiora-Labs/codify/commit/6d21c9e15c0b6fe4dd4e70f4b6cae48a46ea1c7d))

### Releases
- Qualify Codify 0.8.0 control plane ([ee8665c](https://github.com/Sidiora-Labs/codify/commit/ee8665c3a86b5505fa6f346e57f9be83f9a35254))

### Other
- Make the VS Code agent chat responsive and transparent ([35ea32f](https://github.com/Sidiora-Labs/codify/commit/35ea32f20a9e8536a6aa4c20a4e1fa59428a68a4))

## [0.7.0] - 2026-08-29

### Releases
- Codify 0.7.0: the resolution layer ([cd097e1](https://github.com/Sidiora-Labs/codify/commit/cd097e123141361c6d694cbf7503e4dc0e737113))

### Other
- Bump VS Code extension to 0.8.0; refine kvx syntax highlighting ([38bf3be](https://github.com/Sidiora-Labs/codify/commit/38bf3bedc66fc66f57c7c10a1f91d2716952bc3c))
- Add kvx format subproject; bump VS Code extension to 0.7.0 ([a3b05c2](https://github.com/Sidiora-Labs/codify/commit/a3b05c24fd73ef64e67d9e9e255c0ba8d7245c3e))

## [0.6.0] - 2026-08-27

### Releases
- Codify 0.6.0: the intent layer ([c415829](https://github.com/Sidiora-Labs/codify/commit/c415829c0ab0f420cec7b03ff0509788b3f733c7))

### Other
- Promote agent panel to persistent sidebar chat view with command palette and concurrent task sessions ([af69fb0](https://github.com/Sidiora-Labs/codify/commit/af69fb061bf235cc20d6af96568ee482d075d808))
- Add ACP agent panel to VS Code extension ([9a1d644](https://github.com/Sidiora-Labs/codify/commit/9a1d644af90ca79e6fb6392e26f362574da43498))

## [0.4.0] - 2026-08-27

### Releases
- Codify 0.4.0: agent orchestration, session continuity, and indexing accuracy ([7712760](https://github.com/Sidiora-Labs/codify/commit/7712760555ffcab0ec2667000dbfc11d15ff32c7))

### Other
- Update VS Code extension docs for 0.3.0 LSP and memory features ([31e16e7](https://github.com/Sidiora-Labs/codify/commit/31e16e742ba90550b8d7770306009e6cf7f47c05))

## [0.3.0] - 2026-08-22

### Other
- Update README and architecture docs for 0.3.0 release ([1c639cb](https://github.com/Sidiora-Labs/codify/commit/1c639cb6c244c69a2696e9d605c61a3dc146edfa))
- Finish Prod mode lifecycle and documentation ([d0b0c74](https://github.com/Sidiora-Labs/codify/commit/d0b0c74b9d2d06fbb1458d2cc923333791a59a84))
- Expose Prod mode through CLI and MCP ([14f76e1](https://github.com/Sidiora-Labs/codify/commit/14f76e18f9fe6a0a9f05fb9dd6109b5b8ee4a131))
- Add implemented lifecycle state for Prod mode ([9f06201](https://github.com/Sidiora-Labs/codify/commit/9f062015b8b3ef13db533b6e501c8fc7eb83441f))
- Specify Prod mode behavior with failing tests ([46746d1](https://github.com/Sidiora-Labs/codify/commit/46746d162ef82494b97875336e921ebc39e2396e))
- Plan Codify Prod mode implementation ([6eb0023](https://github.com/Sidiora-Labs/codify/commit/6eb00234ad4cdea56cb49c3a51d14920539eef31))
- Document Codify Prod mode lifecycle ([e53ba31](https://github.com/Sidiora-Labs/codify/commit/e53ba31edfabe4834ff5b59843c1b5af18aabe5e))
- Support parallel spec tasks and explicit snapshot tags ([3747b23](https://github.com/Sidiora-Labs/codify/commit/3747b236a7f80d59e2820100511b864ae7787d91))

## [0.2.0] - 2026-08-16

### Other
- Add agent memory layer with task-linked notes and auto-recorded outcomes ([3697f17](https://github.com/Sidiora-Labs/codify/commit/3697f1705b1c1d557ccad6f8012806e184f4ef3a))
- Match directory touches to changed descendants ([e651cef](https://github.com/Sidiora-Labs/codify/commit/e651cef0a00d0f84bd923efacd600738ff5c7d24))
- Match directory touches in spec verification ([f6b7dc3](https://github.com/Sidiora-Labs/codify/commit/f6b7dc375e7092fb50230d94c183d65628d18958))
- Index valid Rust keyword-like symbols ([d7a869c](https://github.com/Sidiora-Labs/codify/commit/d7a869c363fcfe3d20bd8094bb5880cb0e9f82bf))
- Trace qualified Rust symbols and GitHub workflows ([9c62b87](https://github.com/Sidiora-Labs/codify/commit/9c62b879482b5dc8e57cd82b73da446bea679269))
- Patch ([7b6b3a9](https://github.com/Sidiora-Labs/codify/commit/7b6b3a96606e2cc59869d152cd8a240293daa617))
- Add installation and uninstallation scripts, update README, and implement version command ([67d51ab](https://github.com/Sidiora-Labs/codify/commit/67d51abc8c3e8a88536bdce38c42e5b1e6a196cb))

## [0.1.0] - 2026-08-13

### Other
- First commit ([2b6dede](https://github.com/Sidiora-Labs/codify/commit/2b6dede7c99e5856ef5464fc5d1c422b5ab77808))

[1.6.0]: https://github.com/Sidiora-Labs/codify/compare/1.5.0...1.6.0
[1.5.0]: https://github.com/Sidiora-Labs/codify/compare/1.4.0...1.5.0
[1.4.0]: https://github.com/Sidiora-Labs/codify/compare/1.3.0...1.4.0
[1.3.0]: https://github.com/Sidiora-Labs/codify/compare/1.1.0...1.3.0
[1.1.0]: https://github.com/Sidiora-Labs/codify/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/Sidiora-Labs/codify/compare/0.9.0...1.0.0
[0.9.0]: https://github.com/Sidiora-Labs/codify/compare/0.8.5...0.9.0
[0.8.5]: https://github.com/Sidiora-Labs/codify/compare/0.8.0...0.8.5
[0.8.0]: https://github.com/Sidiora-Labs/codify/compare/0.7.0...0.8.0
[0.7.0]: https://github.com/Sidiora-Labs/codify/compare/0.6.0...0.7.0
[0.6.0]: https://github.com/Sidiora-Labs/codify/compare/0.4.0...0.6.0
[0.4.0]: https://github.com/Sidiora-Labs/codify/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/Sidiora-Labs/codify/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Sidiora-Labs/codify/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/Sidiora-Labs/codify/releases/tag/0.1.0
