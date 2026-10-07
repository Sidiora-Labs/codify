<div align="center">

# Codify

<img src="../../codify.png">

**एजेंट वर्कफ़्लो टूल — छोटे, सरल प्रोजेक्ट से लेकर बड़े, जटिल कोडबेस तक।**

शुद्ध C11। एक बाइनरी। एक SQLite डेटाबेस। कुछ भी आपकी मशीन से बाहर नहीं जाता।

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](../../.github/workflows/ci.yml)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [हिन्दी](README.hi.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (BR)](README.pt-BR.md)

</div>

---

## परिचय

Codify (कमांड `cg`) एक ही बाइनरी में समाया हुआ एजेंट वर्कफ़्लो इंजन है। यह कोड से आगे की उन चार चीज़ों को सँभालता है जिनकी हर प्रोजेक्ट को ज़रूरत होती है — कोड **क्या है**, वह **यहाँ तक कैसे पहुँचा**, **आगे क्या होना है**, और रास्ते में **क्या सीखा गया** — और चारों को इंसानों और AI एजेंटों, दोनों के लिए उपलब्ध कराता है।

वर्ज़न 1.1.0 (v11) fleet को ऐसी चीज़ बना देता है जिसे आप एक spec सौंपकर चलता छोड़ सकते हैं: `cg fleet up` एक टिकाऊ, crash के बाद resume होने वाला supervisor शुरू करता है जो main एजेंट, हर फ़ीचर का एक manager और हर टास्क के worker एक साथ चलाता है, और हर Codex या Claude Code प्रोसेस को तब तक सँभालता है जब तक उसका काम qualified और merged न हो जाए। एजेंटों को briefing ग्राफ़ से मिलती है, branches के बीच drift merge से पहले पकड़ा जाता है, हर state बदलाव एक event log में दर्ज होता है, और `cg serve` यह सब एक ही connection पर एडिटर तक पहुँचाता है। यह fleet की नींव पर बना है: पचास की जगह एक coalescing इंडेक्सर, Main Gideon / feature manager / worker की hierarchy (branch, merge, PR और checkpoint flow के साथ), हर branch और worktree के लिए एक एकीकृत ग्राफ़, और Jev decisions — वरना पूरी तरह लोकल टूल की इकलौती remote कॉल।

**कोड क्या है।** Codify 19 भाषाओं को एक क्वेरी करने योग्य ग्राफ़ में इंडेक्स करता है: सिंबल, कॉल एज, फ्रेमवर्क-सचेत रूट और तुरंत फुल-टेक्स्ट सर्च — सब SQLite में लोकल। `cg context <query>` "इस हिस्से की पूरी तस्वीर दिखाओ" का जवाब एक ही कॉल में देता है। और parser जो देखता है उससे आगे, टिप्पणियाँ भी प्रथम-श्रेणी नोड के रूप में इंडेक्स होती हैं — intent layer: उद्देश्य, contract, ख़तरे, और वे couplings जो सिर्फ़ गद्य में रहती हैं।

**वह यहाँ तक कैसे पहुँचा।** बिल्ट-इन कंटेंट-एड्रेस्ड स्नैपशॉट सिस्टम कमिट, इतिहास, डिफ़ और रिस्टोर देता है — किसी बाहरी VCS के बिना। स्नैपशॉट और ग्राफ़ एक ही डेटाबेस साझा करते हैं, इसलिए `cg changes` बिना कमिट किए बदलावों का प्रभाव दायरा बताता है। `cg changelog` रिलीज़ नोट लिखता है: डिफ़ॉल्ट रूप से git इतिहास से — हर tag या version bump पर एक रिलीज़, commit-subject prefix से समूह, हर टास्क रेफ़रेंस साथ में, और key होने पर हर रिलीज़ के लिए मॉडल द्वारा लिखा एक छोटा Highlights पैराग्राफ़ — और `--snapshots` देने पर या git न होने पर स्नैपशॉट चेन से, सिंबल-स्तरीय डिफ़ के साथ।

**आगे क्या होना है।** एक spec इंजन सादे-टेक्स्ट kvx spec फ़ाइलों को कार्यशील योजना में बदलता है: निर्भरता की wave वाला टास्क बोर्ड, हर टास्क से जुड़े स्वीकृति मानदंड — और ऐसा `done` जो सत्यापित होता है, सिर्फ़ घोषित नहीं। `cg spec new` और `cg spec add` योजना बनाते हैं, `cg spec lint` साबित करता है कि वह चलने योग्य है, और चक्र उसे चलाता है। Prod मोड में `implemented` कोडिंग पूरी होने और source evidence को दर्ज करता है, qualification का दावा किए बिना; केवल `done` का मतलब है कि executable qualification और ग्राफ़ जाँचें पास हुईं। Parallel मोड में कई एजेंट एक साथ काम करते हैं, इस सीमा में कि हर टास्क के घोषित पाथ आपस में न टकराएँ।

**रास्ते में क्या सीखा गया।** एक एजेंट मेमोरी सोच-समझकर लिखे गए नोट — निर्णय, बाधाएँ, परिणाम, प्राथमिकताएँ, तथ्य — ग्राफ़ वाले उसी डेटाबेस में सहेजती है, हर नोट उस टास्क से जुड़ा जिसके दौरान वह बना। `cg remember` काम के बीच एक नोट सहेजता है, हर `cg spec done` अपने आप एक ईमानदार परिणाम दर्ज करता है (इनकार सहित), और `cg recall` यह सब प्रासंगिकता और नवीनता के क्रम में वापस लाता है। ये परतें एक-दूसरे को मज़बूत करती हैं: कमिट अपने आप अपने टास्क से टैग होते हैं, मेमोरी उसी टास्क पर सामने आती हैं जिससे वे जुड़ी हैं, `cg why` किसी सिंबल को उसके पीछे के निर्णयों तक ले जाता है, और `cg spec trace` किसी भी टास्क से उसके सिंबल, कमिट और मेमोरी तक।

**और यह कदमों के बीच भी मौजूद रहता है, सिर्फ़ उन पर नहीं।** `cg work open` एक संक्षिप्त टास्क पैकेट से शुरू करता है, `cg work update` केवल नए state/evidence/workspace बदलाव लौटाता है, `cg event progress` गतिविधि को प्रगति समझे बिना loops पहचानता है, और `cg guard` बताता है जब कोई edit घोषित दायरे से बाहर जाता है। बिल्ट-इन MCP सर्वर हर MCP-सक्षम एजेंट को 60 टूल, resources और prompts देता है, और `cg integrate` हर host के नेटिव कॉन्फ़िगरेशन की योजना बनाता, लागू करता और जाँचता है।

**और यह एजेंटों को चलाता भी है, सिर्फ़ सेवा नहीं करता।** `cg handoff` और `cg resume` किसी टास्क को state खोए बिना एक सेशन से दूसरे तक ले जाते हैं, `cg spec claim-next` खाली बैठे एजेंट को अगला टकराव-रहित टास्क atomically सौंपता है, और `cg spec run` पूरी wave को Codex CLI या Claude Code सेशनों में बाँट देता है — हर claimed टास्क के लिए एक sandboxed child प्रोसेस, लॉग और prompt डिस्क पर, विफलता पर lease मुक्त।

**और यह पूरे fleet को झेल लेता है।** इंडेक्सिंग एक साझा संसाधन है: पहला `cg` पास चलाता है, बाकी एक नोट छोड़कर उसी में मिल जाते हैं, freshness window होने पर walk छोड़ दिया जाता है, और मशीन-व्यापी parse slots एक साथ चल रहे प्रोजेक्टों को कोर बजट में रखते हैं ([docs/sync.md](../../docs/sync.md))। उसके ऊपर `spec/workflow.kvx` एक hierarchy घोषित कर सकता है — टास्क सूची का मालिक main एजेंट, हर फ़ीचर का feature manager, उसके नीचे wave workers — और `cg fleet` branch flow चलाता है: worktree, merge-up, test और lint gates के पीछे land, pull request, checkpoint। `cg fleet up` यह पूरा पेड़ एक detached supervisor के नीचे खुद चलाता है — अटके एजेंटों को nudge करता है, विफल को ग़लती की जानकारी के साथ दोबारा चलाता है, न बचने लायक को escalate करता है, आपके चुने approval gates पर रुकता है, और complete तब कहता है जब काम **merged** हो, न कि जब प्रोसेस बंद हो ([docs/hierarchy.md](../../docs/hierarchy.md))। Supervisor मर जाए तो `cg fleet up --resume` ज़िंदा एजेंटों को अपना लेता है। spec से drift, टकराते टास्क और दूसरी branches जिन interface पर निर्भर हैं उनके बदलाव merge से पहले चिह्नित होते हैं ([docs/drift.md](../../docs/drift.md)), और हर बदलाव एक event है जिसे `cg events --follow` और `cg serve` लाइव stream करते हैं ([docs/events.md](../../docs/events.md))। सब एक ग्राफ़ और एक मेमोरी साझा करते हैं: रिपॉज़िटरी की हर branch और linked worktree उसी `.codegraph/` में, branch के दायरे में, इंडेक्स होती है ([docs/branches.md](../../docs/branches.md))।

**और ज़रूरत पड़ने पर यह निर्णय माँगता है।** `cg jev` typed फ़ैसलों के लिए TypeSafe के System One मॉडल तक पहुँचता है — true/false, one-of, ranked। `cg memory classify` इससे बताता है कि कौन से नोट पुन: प्रयोग योग्य skills हैं, और `cg skills promote` उन्हें पोर्टेबल `.agents/skills/<slug>/SKILL.md` में रेंडर करता है; विफल `verify_cmd` को एक triage लाइन, `cg guard` के findings को रैंकिंग, और pull request को readiness स्कोर मिलता है। यह Codify की इकलौती remote कॉल है: इस पर बने फ़ीचरों के लिए अनिवार्य, मूल चक्र के लिए कभी नहीं, और कभी प्रामाणिक नहीं — Jev के किसी जवाब ने कभी exit code नहीं बदला ([docs/jev.md](../../docs/jev.md))।

**और documentation आख़िरी सत्यापित टास्क है।** नए फ़ीचर spec में `@docs` closure stage डिफ़ॉल्ट रूप से चालू रहता है। सारे सामान्य टास्क qualify होने के बाद Codify spec, टास्क-attributed स्नैपशॉट, कोड ग्राफ़, रूट, मेमोरी, जाँचों और मौजूदा docs से एक सीमित evidence पैकेट बनाता है। वही कॉन्फ़िगर किया गया एजेंट user और developer documentation अपडेट करता है, `cg docs check` घोषित claim रेफ़रेंस, लोकल links, ज़रूरी ग्राफ़-सतह कवरेज और target दायरा जाँचता है, और `cg docs close` एक अलग `[spec:<feature>/@docs]` स्नैपशॉट और अगले spec flow के लिए incremental baseline दर्ज करता है। ये संरचनात्मक जाँचें समीक्षा में मदद करती हैं; हर वाक्य के अर्थ को प्रमाणित नहीं करतीं।

कोई बैकग्राउंड सर्विस नहीं जो आपने शुरू न की हो, और कोई टेलीमेट्री नहीं — fleet supervisor केवल `cg fleet up` के बाद चलता है और `cg fleet down` से रुकता है। ग्राफ़, मेमोरी, स्नैपशॉट और पूरा टास्क चक्र आपकी मशीन पर चलता है और वहीं रहता है। दो अपवाद हैं, नामित और opt-in: Jev decisions को `OPENROUTER_API_KEY` चाहिए, और केवल उन पर बनी कमांड ही वह कॉल करती हैं; और `cg changelog` रिलीज़ highlights के लिए मॉडल से तभी पूछता है जब `CENTRA_API_KEY` (या `CG_CHANGELOG_KEY`) सेट हो।

## Codify क्यों

**यह योजना से प्रमाण तक का चक्र पूरा करता है।** ज़्यादातर टूल या तो काम की योजना बनाते हैं या कोड का वर्णन करते हैं। Codify दोनों एक ही डेटाबेस पर करता है, इसलिए योजना हक़ीक़त से परखी जा सकती है: जब कोई टास्क घोषित करता है कि वह `checkMode` जोड़ता है और `src/*.ts` को छूता है, तो `cg spec done` तब तक उसे पूरा नहीं मानता जब तक ग्राफ़ और इतिहास सहमत न हों।

**एजेंट इंजीनियर की तरह काम करते हैं, सैलानी की तरह नहीं।** एजेंट `cg spec next` से पूछता है कि क्या करना है, `cg context` से उस हिस्से की पूरी जानकारी लेता है, और `cg impact` से जानता है कि कौन टूटेगा — फिर स्वचालित टास्क एट्रिब्यूशन के साथ कमिट करता है। पूरा चक्र MCP पर उपलब्ध है। और प्रोजेक्ट वह याद रखता है जो सेशन भूल जाते हैं: `cg remember` से एक बार लिखा निर्णय अगले सेशन को `cg spec next`, `cg spec start` और `cg recall` में अपने आप मिल जाता है, और इनकार की गई पूर्णताएँ भी दर्ज होती हैं।

**कॉन्टेक्स्ट एक कॉल में, और एक बजट के भीतर।** `cg context <query>` एक अनुरोध में प्रासंगिक मेमोरी, एंट्री पॉइंट, मैच, कॉलर, कैली और रूट लौटाता है — रैंक करके (असली परिभाषाएँ test fixtures से ऊपर) और token बजट में फ़िट करके (`--budget`, डिफ़ॉल्ट 4000), कटी चीज़ों की स्पष्ट omitted गिनती के साथ। `cg impact <name> -d 3` ट्रांज़िटिव रूप से बताता है कि कौन टूटेगा और यह किस पर निर्भर है, और सिंबल नामों पर FTS5 ट्राइग्राम इंडेक्स बिना वॉर्म-अप के सबस्ट्रिंग मैच देता है।

**इंडेक्स कभी बासी नहीं होता — और कभी तूफ़ान नहीं बनता।** `cg watch` नेटिव OS इवेंट (inotify, FSEvents, ReadDirectoryChangesW) सुनकर डिबाउंसिंग के साथ सिंक करता है, और MCP टूल कॉल पढ़ने से पहले सिंक करते हैं। पचास एजेंट का मतलब पचास इंडेक्सर नहीं: एक प्रोसेस gate पकड़कर walk करता है, बाकी dirty नोट छोड़कर उसी में मिल जाते हैं, और मशीन-व्यापी slots parse threads सीमित रखते हैं। `cg` वर्कर पूल और SQLite कैश का आकार कंटेनर-सचेत कोर काउंट और वास्तविक उपलब्ध RAM से तय करता है (`cg info` दिखाता है कैसे)। और सब कुछ लोकल रहता है: ग्राफ़ और स्नैपशॉट `.codegraph/` के नीचे हैं — डायरेक्टरी हटाइए, और हर निशान मिट जाता है।

## Intent layer

Parser सिंबल, कॉल और रूट देखता है, पर यह नहीं कि कोई फ़ंक्शन *क्यों* है, उसके कॉलर को क्या सच रखना है, या कि `save_tasks` को `load_tasks` के बाद चलना ज़रूरी है — कोडबेस का यह आधा हिस्सा सिर्फ़ टिप्पणियों में रहता है। Codify उसे इंडेक्स करता है (पूरी convention: [docs/ANCHORS.md](../../docs/ANCHORS.md)):

- **Anchors** वे टिप्पणियाँ हैं जो derivability test पास करती हैं — *अगर एजेंट कोड पढ़कर उसे लिख सकता था, तो वह anchor नहीं।* चार प्रकार काम के हैं: **purpose**, **contract**, **danger**, **pointer**।
- **Doc-first retrieval**: जहाँ anchor है, `cg context` body की जगह doc + signature देता है — उसी बजट में कई गुना ज़्यादा सिंबल; और **`cg survey`** एक body की कीमत में सौ फ़ाइलें पढ़ता है (purpose लाइनें और signatures सहित docs, body कभी नहीं)।
- **Soft edges**: anchors के भीतर के नाम `(soft)` रेफ़रेंस बनते हैं — cross-language और dynamic couplings, parsed कॉल से अलग लेबल किए हुए।
- **Drift की ईमानदारी**: कोड आगे बढ़ जाए तो doc `cg check`, `cg guard` और retrieval में stale दिखता है — चेतावनी, रोक नहीं। **`cg anchors`** बिना anchor वाले सिंबल को coordination स्कोर (fan-out × extent × referencing files) से रैंक करता है।

इनमें से कुछ भी अनिवार्य नहीं: convention न अपनाने वाली रिपॉज़िटरी को भी मौजूदा टिप्पणियों से capture, survey और soft edges मिलते हैं।

## Codify के साथ एक सेशन

```sh
cg brief                      # root, चालू टास्क + ACs, बिना कमिट काम, पिछले निर्णय
cg spec next                  # अगला योग्य टास्क, ACs + प्रासंगिक मेमोरी
cg spec start 16.7            # उसे अपनाइए — एक समय में एक ही टास्क चालू
cg context "password auth"    # मेमोरी, एंट्री पॉइंट, सिंबल, कॉलर, रूट — एक ही कॉल में
cg why verifyLogin            # किसने बदला, किस टास्क में, और क्या तय हुआ
cg impact verifyLogin -d 2    # इसे बदलने पर कौन टूटेगा
# ...इम्प्लीमेंट करें...
cg guard                      # टास्क 16.7 के घोषित दायरे से बाहर कुछ?
cg test-impact                # अभी बदले कोड को कौन से टेस्ट कवर करते हैं
cg remember "sessions rotate on login" --type decision   # टास्क 16.7 से जुड़ जाता है
cg review                     # बदलाव, उन ACs के साथ जिन्हें पूरा करने का दावा है
cg commit -m "add password auth"   # स्नैपशॉट, अपने आप टैग होकर [spec:ion_spec/16.7]
cg spec done 16.7             # qualification: verify_cmd + ग्राफ़ जाँचें; परिणाम दर्ज
cg spec trace 16.7            # प्रमाण: टास्क -> सिंबल -> कमिट -> मेमोरी
```

और जब सेशन को टास्क पूरा होने से पहले रुकना पड़े, तो काम भाप नहीं बनता:

```sh
# सेशन A, जल्दी रुकते हुए
cg handoff --done "schema migration; token rotation" \
           --next "wire the login route; extend 03_auth test" \
           --blocked "flaky fixture on CI" -m "rotate on login, not refresh"

# सेशन B, घंटों बाद, नया कॉन्टेक्स्ट विंडो
cg resume --prompt            # paste करने लायक ब्लॉक: टास्क, पूरे कदम, रुकावटें,
                              # अगले कदम, बिना कमिट फ़ाइलें, lease की स्थिति
```

Handoff टास्क से जुड़ी एक structured मेमोरी है; हर नया handoff पिछले को supersede करता है, इसलिए `cg resume` हमेशा ताज़ा state देखता है। उस चक्र की हर कमांड एक MCP टूल भी है, `cg check` CI में पूरा gate एक कदम में चलाता है, और `cg hook install` सिंक और scope जाँच को जोड़ देता है ताकि ज़्यादातर काम बिना बुलाए हो।

## समर्थित भाषाएँ और फ्रेमवर्क

**भाषाएँ:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro।

**फ्रेमवर्क-सचेत रूटिंग:** `cg` इन फ्रेमवर्क में URL पैटर्न को उनके हैंडलर से जोड़ता है: Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix और Axum।

## इंस्टॉलेशन

Linux x86_64 — एक ही कमांड checksum-सत्यापित स्टैटिक बाइनरी इंस्टॉल (या अपडेट) कर देता है:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

अनइंस्टॉल भी उसी तरह: `curl -fsSL https://codify.centra.ag/uninstall | bash`। हर प्रोजेक्ट का `.codegraph/` डेटा कभी नहीं छुआ जाता।

मौजूदा प्रोजेक्टों पर अपग्रेड सुरक्षित है: डेटाबेस में schema वर्ज़न रहता है, और अपग्रेड के बाद पहली बार खुलने पर `cg` केवल derived इंडेक्स टेबल (files, symbols, refs, routes, imports और सर्च इंडेक्स) फिर से बनाता है — अगला सिंक उन्हें भर देता है। मेमोरी, git इतिहास और leases किसी migration में कभी नहीं हटते।

अन्य प्लेटफ़ॉर्म पर सोर्स से बिल्ड करें (निर्भरताएँ: C कंपाइलर और `libsqlite3-dev`):

```sh
make && sudo make install
```

फिर किसी भी प्रोजेक्ट में:

```sh
cd your-project
cg init
```

टर्मिनल पर `cg init`, `cg index` और `cg sync` stderr पर एक लाइव progress लाइन दिखाते हैं — चरण, कुल में से कितनी फ़ाइलें हो चुकीं, workers, बीता समय, और जिस lock का इंतज़ार है वह — जो सारांश से पहले मिट जाती है। पाइप किया गया आउटपुट नहीं बदलता; `CG_PROGRESS=plain` इसकी जगह सादी लाइनें छापता है और `CG_PROGRESS=0` इसे बंद कर देता है। देखें [docs/sync.md](../../docs/sync.md#progress)।

## कमांड संदर्भ

`cg help` पूरा नक्शा छापता है: हर कमांड अपने समूह में, एक-एक लाइन में, टर्मिनल की चौड़ाई के हिसाब से। `cg help <command>` (या `cg <command> --help`, `-h`) एक कमांड का usage, subcommands, फ़्लैग, उदाहरण और संबंधित कमांड दिखाता है; `cg help --all` सबको छापता है, और `cg help --json` एडिटरों और एजेंटों को वही टेबल देता है ताकि वे उससे मेनू बना सकें। नीचे की टेबल और `cg help` कमांडों की एक ही सूची से बनते हैं; `tests/integration/43_help.sh` दोनों को मेल में रखता है।

| कमांड | विवरण |
|---|---|
| `cg help [<command>] [--all] [--json]` | समूहों वाला overview, एक कमांड का विवरण, सारे विवरण, या पूरी टेबल JSON में। अनजाना नाम सबसे क़रीबी नाम सुझाता है और 1 पर exit करता है। Bold और dim केवल टर्मिनल पर (`NO_COLOR`, `TERM=dumb` और `CG_COLOR=0\|1` तय करते हैं); `COLUMNS` चौड़ाई तय करता है, जो कभी 60 से कम नहीं होती |

### ग्राफ़

| कमांड | विवरण |
|---|---|
| `cg init [--nested]` | `.codegraph/` बनाकर पहला इंडेक्स; initialized रिपॉज़िटरी के linked worktree में साझा ग्राफ़ से इस branch के रूप में जुड़ता है |
| `cg sync [paths] [--max-age MS] [--background] [--wait MS] [--workers N]` | इंक्रीमेंटल इंडेक्स: चल रहे पास में मिल जाता है, ताज़ा होने पर छोड़ देता है। `cg index [--full] [--workers N]` हमेशा walk करने वाला blocking रूप है। `--workers N` (दोनों पर) `CG_INDEX_WORKERS` और `codify.kvx` के `[index] workers` से ऊपर रहता है |
| `cg branches` | साझा ग्राफ़ में इंडेक्स हर branch, उसके worktree, head, base और फ़ाइल गिनती के साथ |
| `cg search <q> [-n N]` / `cg symbol <name>` / `cg show <symbol\|path:line>` | सिंबल और फुल-टेक्स्ट सर्च; परिभाषा और रेफ़रेंस गिनती; केवल उस सिंबल की body |
| `cg context <q> [--budget N] [-n K]` / `cg impact <name> [-d N]` | एक-कॉल कॉन्टेक्स्ट बंडल (डिफ़ॉल्ट 8 सिंबल, बजट 4000); ट्रांज़िटिव कॉलर और कैली (बजट 8000) |
| `cg survey [path\|query]` / `cg anchors [--stale] [--uncovered]` | ~100 फ़ाइलों की purpose लाइनें और docs, body कभी नहीं; anchor की सेहत और backfill सूची |
| `cg routes` / `cg why <symbol>` / `cg test-impact [symbol]` | URL से हैंडलर; उत्पत्ति (कमिट, टास्क, निर्णय); संबंधित टेस्ट |
| `cg watch` / `cg root` / `cg info` | ऑटो-सिंक; हल किया गया प्रोजेक्ट root; मशीन प्रोफ़ाइल, पाइपलाइन आकार और branch |

### वर्ज़न कंट्रोल

स्नैपशॉट SHA-256 से कंटेंट-एड्रेस्ड हैं और ब्लॉब डीडुप्लिकेट होते हैं।

| कमांड | विवरण |
|---|---|
| `cg commit -m <msg>` | वर्किंग ट्री का स्नैपशॉट; `--git` उसी spec टैग के साथ असली git कमिट भी करता है |
| `cg log` / `cg status` / `cg diff [A] [B]` / `cg checkout <id>` | इतिहास, HEAD की तुलना में वर्कट्री, LCS लाइन डिफ़, स्नैपशॉट बहाली |
| `cg changes [--limit N]` | बिना कमिट बदलावों का प्रभाव दायरा: छुए सिंबल और उनके बाहरी कॉलर (डिफ़ॉल्ट सीमा 40 सिंबल, 8 कॉलर) |
| `cg git-sync [-n N]` | git इतिहास ingest करता है — कमिट, लेखक, प्रति-फ़ाइल churn |
| `cg events [--since N] [--kind K,..] [-n N] [--follow [--for S]] [--head]` | Event log: हर task, claim, attempt, agent, fleet, supervisor, drift और approval बदलाव sequence नंबर के साथ। `--kind` में अंत का `.` prefix है (`fleet.`); `--follow` stream करता है। देखें [docs/events.md](../../docs/events.md) |

Codify के स्नैपशॉट git की जगह नहीं लेते: `.gitignore` और `.cgignore` दोनों माने जाते हैं, और `cg commit --git` दोनों में लिखता है।

### Changelog

`cg changelog` git इतिहास से रिलीज़ नोट बनाता है। रिलीज़ किसी tag **या** उस कमिट से शुरू होती है जिसने प्रोजेक्ट का वर्ज़न बदला — `src/cg.h` में `CG_VERSION`, `VERSION` फ़ाइल, या `package.json` — इसलिए tag न करने वाले प्रोजेक्ट को भी हर वर्ज़न का एक सेक्शन मिलता है। आख़िरी रिलीज़ के बाद का हिस्सा वर्किंग ट्री के नए वर्ज़न से, या `--tag NAME` से नामित होता है, और केवल वरना `[Unreleased]`। समूह commit-subject prefix से बनते हैं, और `[spec:<feature>/<task>]` bullet पर टास्क रेफ़रेंस बनता है।

**Highlights।** environment या प्रोजेक्ट की `.env` में `CENTRA_API_KEY` (या `CG_CHANGELOG_KEY`) हो, तो हर रिलीज़ को एक `### Highlights` ब्लॉक मिलता है: दो से पाँच वाक्य, बड़ी रिलीज़ में कुछ bullets, मॉडल द्वारा उसी रिलीज़ के कमिट से लिखे हुए। derived bullets कभी नहीं बदलते। `CG_CHANGELOG_ENDPOINT` और `CG_CHANGELOG_MODEL` इसे किसी भी OpenAI-compatible endpoint पर ले जाते हैं। जवाब `.codegraph/changelog-cache/` में कैश होते हैं, इसलिए दोबारा बनाने पर केवल बदली रिलीज़ के बारे में पूछा जाता है। `--summarize` ज़ोर देता है, `--no-summarize` मॉडल को बाहर रखता है, और विफल कॉल stderr पर `highlights for <release> skipped — <why>` छापकर बिना गद्य के नोट लिख देती है।

मुख्य फ़्लैग: `-o FILE` (रिपॉज़िटरी root के सापेक्ष लिखता है), `-n N` (रिलीज़ सेक्शन की सीमा), `--unreleased` (केवल सबसे नया सेक्शन), `--tag NAME`। `--snapshots` — और `.git` रहित कोई भी प्रोजेक्ट — स्नैपशॉट रेंडरर पर लौटता है, जो हर स्नैपशॉट का सिंबल-स्तरीय डिफ़ देता है। रूट पर `cliff.toml` मेल खाता [git-cliff](https://git-cliff.org) कॉन्फ़िगरेशन है।

### मेमोरी

टिकाऊ एजेंट नोट, ग्राफ़ वाले उसी SQLite डेटाबेस में। spec टास्क चालू रहते लिखी मेमोरी अपने आप उससे जुड़ जाती है, और `cg spec done` परिणाम अपने आप दर्ज करता है। इनमें कभी सीक्रेट न रखें।

| कमांड | विवरण |
|---|---|
| `cg remember <text>` | मेमोरी सहेजता है — `--type decision\|constraint\|outcome\|preference\|fact` (डिफ़ॉल्ट `fact`), `--task <feature/id>`, वैकल्पिक `--symbols` / `--files`, पलटे गए निर्णय के लिए `--supersedes <id>` |
| `cg recall [query]` | फुल-टेक्स्ट खोज, प्रासंगिकता फिर नवीनता; `--task`, `--type`, `-n N`, `--near <file>` |
| `cg forget <id>` / `cg memory compact` | मेमोरी हटाता है; डुप्लिकेट समेटता है (`--dry-run`) |
| `cg memory classify [<id>\|--all\|--unclassified]` | Jev से पूछता है कि हर नोट क्या है — `skill`, `decision`, `constraint`, `fact`, `noise` — confidence के साथ |
| `cg skills list\|promote <id>\|render` | `skill` वर्ग की मेमोरी, `.agents/skills/<slug>/SKILL.md` में promote और अद्यतन; बिना ownership marker वाली फ़ाइल कभी overwrite नहीं होती ([docs/jev.md](../../docs/jev.md#memory-classification-and-skills)) |

### एजेंटिक

| कमांड | विवरण |
|---|---|
| `cg mcp` | MCP stdio सर्वर: 60 टूल, साथ में resources और prompts |
| `cg lsp` | Language Server (stdio) के रूप में — हर एडिटर के लिए |
| `cg serve` | एडिटर के लिए एक JSON-RPC connection (stdio): हर MCP टूल, कोई भी `cg` कमांड (`exec`), `cancel`, और sequence नंबर से pushed event subscriptions। निष्क्रिय होने पर न lock, न इंडेक्स पास। देखें [docs/events.md](../../docs/events.md#cg-serve) |
| `cg tool list \| call <name> [json]` | MCP client के बिना shell से एक MCP टूल चलाता है |
| `cg integrate detect\|plan\|apply\|doctor` | Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline और Continue के लिए सेटअप; plan केवल पढ़ता है, apply idempotent और बैकअप सहित (`cg mcp-install` इसका alias है) |
| `cg hook install` / `cg hook post-edit` | एजेंट और git hooks जोड़ता है; हर edit पर एक लक्षित बैकग्राउंड सिंक और guard |
| `cg changelog [-n N] [-o FILE] [--unreleased] [--tag NAME] [--snapshots] [--summarize\|--no-summarize]` | git इतिहास से रिलीज़ नोट — हर tag या version bump पर रिलीज़, `CENTRA_API_KEY` होने पर Highlights (देखें [Changelog](#changelog)) |
| `cg agentmd [--write]` | `.codify/agent-context.md` पर ग्राफ़ orientation; रूट के `AGENTS.md` और `CLAUDE.md` का मालिक `cg spec render` है |

### गवर्नेंस

ये सब डिफ़ॉल्ट रूप से सलाह देते हैं; केवल `--strict` इन्हें विफल करता है। **Agent control plane:** Codify चार स्वतंत्र authorities — Git state, स्नैपशॉट state, घोषित spec state और लाइव fenced attempts — को अलग रखता है; `cg state` इन्हें एक-दूसरे का प्रमाण माने बिना साथ दिखाता है, और `cg spec reconcile` केवल `--repair` पर बदलाव करता है। `cg event progress` बार-बार की विफलता, A-B patch oscillation और बिना-evidence वाली अवधि पहचानता है (सलाहकारी, जब तक `CG_PROGRESS_ENFORCE=1` न हो)।

| कमांड | विवरण |
|---|---|
| `cg brief` | एक कॉल में सेशन state: root, चालू टास्क और मानदंड, बिना कमिट पाथ, हाल के निर्णय |
| `cg review` | बदलाव और उसका दावा: बदले सिंबल, जोखिम वाले कॉलर, टास्क के स्वीकृति मानदंड |
| `cg guard [paths] [--strict]` | चालू टास्क के `touches` से बाहर के edits |
| `cg drift check <id> [--base REF] \| collisions \| coverage \| summary [-f F]` | घोषित touches और symbols के मुक़ाबले टास्क का बदलाव; साथ चलने पर टकराने वाले टास्क; बिना qualified टास्क वाले मानदंड; फ़ीचर की drift गिनती। चेतावनी देता है; देखें [docs/drift.md](../../docs/drift.md) |
| `cg check [--strict]` | एकल CI gate: render staleness, spec lint, टास्क evidence, claim consistency, worktree state |
| `cg state` / `cg event ingest\|history\|progress` / `cg work open\|update\|close` | ऊपर वर्णित control plane; संक्षिप्त work पैकेट, revision deltas, और evidence के मुक़ाबले मानदंड बंद करना |
| `cg handoff` / `cg resume [--task <id>] [--prompt]` | रुकने से पहले सेशन state (`--done`, `--next`, `--blocked`, `-m`); नए सेशन के लिए टास्क पैकेट, ताज़ा handoff, मेमोरी और lease state |
| `cg journal [list\|apply\|drop <id>\|--failed\|--all]` | डेटाबेस व्यस्त रहते समय कतार में रखे गए लंबित writes: सूची देखें, लागू करें, हटाएँ। जो lifecycle writes डेटाबेस को locked पाते हैं वे `.codegraph/journal/` में रखे जाते हैं, और write lock पाने वाली अगली प्रक्रिया उन्हें क्रम से replay करती है |

सभी क्वेरी कमांड `--json` स्वीकार करते हैं। यह फ़्लैग, MCP सर्वर और language server एजेंट-नेटिव इंटरफ़ेस हैं।

## Spec वर्कफ़्लो

spec सादे-टेक्स्ट kvx फ़ाइलों के रूप में रहते हैं — पठनीय, डिफ़ करने योग्य और आपकी रिपॉज़िटरी के स्वामित्व में — और Codify उन्हें IDE रूल फ़ाइलों और markdown मिरर में रेंडर करते हुए टास्क चक्र चलाता है। यह `spec/workflow.kvx` वाली किसी भी रिपॉज़िटरी में काम करता है, `.codegraph/` से स्वतंत्र है, और Ion के `spec/specgen` का बाइट-दर-बाइट समान C विकल्प है।

| कमांड | विवरण |
|---|---|
| `cg spec new <feature>` / `cg spec add <id> --title T` | `spec/<feature>/spec.kvx` बनाता है; बाकी हर बाइट बचाते हुए टास्क जोड़ता है |
| `cg spec lint` / `cg spec render [--check]` | योजना जाँचता है (cycles, अज्ञात टास्क, बिना मानदंड वाले टास्क, मृत globs); IDE पॉइंटर फ़ाइलें और markdown मिरर — त्रुटि या बासीपन पर exit 2 |
| `cg spec status` / `cg spec mode <prod\|standard\|parallel>` | टास्क बोर्ड: मोड, `done`, `implemented`, `in_progress`, `pending` गिनती और लाइव claims; निर्भरता और concurrency semantics |
| `cg spec ready` / `cg spec wave` | सभी waves का पूरा frontier, लाइव claims से टकराव चिह्नित; वर्तमान wave के सभी योग्य टास्क |
| `cg spec claim <id>` / `release <id>` / `cg spec claim-next` | मालिक और expiry वाला lease; पहला टकराव-रहित टास्क atomically claim करता है (frontier खाली होने पर exit 3) |
| `cg spec run` | parallel या Prod wave का orchestration — देखें [एजेंटों को चलाना](#एजेंटों-को-चलाना) |
| `cg spec next` / `cg spec start <id>` | सबसे कम wave वाला योग्य टास्क; उसे `in_progress` करना |
| `cg spec implemented <id>` / `cg spec done <id>` | Prod में source जाँच के बाद `implemented`; `verify_cmd` और ग्राफ़ जाँचें पास होने पर ही `done` |
| `cg spec trace [<id>]` | टास्क → सिंबल → पाथ → कमिट → मेमोरी |
| `cg spec docs <status\|auto\|manual\|off\|start\|block\|reset>` | आरक्षित `@docs` closure stage देखना या कॉन्फ़िगर करना |

`mode`, `start`, `implemented` और `done` kvx फ़ाइल की केवल एक लाइन फिर से लिखते हैं; बाकी हर बाइट, टिप्पणी और खाली लाइन जस की तस रहती है। `cg commit` संदेश में चल रहे टास्क का टैग जोड़ता है (`... [spec:ion_spec/16.7]`), और spec कमांड MCP टूल के रूप में भी उपलब्ध हैं। टास्क के घोषित `symbols` ग्राफ़ में खोजे जाते हैं और `touches` वर्कट्री बदलावों और टास्क से टैग हुए कमिट — Codify स्नैपशॉट और `[spec:<feature>/<id>]` वाले सादे **git** कमिट दोनों — से मिलाए जाते हैं, इसलिए हर worker अपनी branch पर कमिट कर सकता है। हर पूर्णता (इनकार सहित) एक परिणाम मेमोरी लिखती है।

### Documentation closure

पूरी जानकारी के लिए [Generate and maintain project documentation](../../docs/DOCUMENTATION.md) पढ़ें। `@docs` फ़ीचर-स्तरीय काम है: `auto` मोड में आख़िरी टास्क qualify होने के बाद `cg spec next` और `cg spec claim-next` उसे लौटाते हैं, और `cg spec run` उसे उसी driver से चलाता है। `cg docs status|plan|packet|check|trace|close` योजना, evidence पैकेट, जाँच और closure सँभालते हैं। ये जाँचें संरचनात्मक आधार देती हैं, हर वाक्य की सच्चाई नहीं।

### Parallel मोड

`cg spec mode parallel` Prod मोड की semantics रखते हुए केवल यह ढील देता है कि एक साथ कितने टास्क चलें, क्योंकि हर टास्क के `touches` पहले से घोषित हैं। `claim-next` में चुनना और claim करना एक file lock और एक transaction में होता है, इसलिए बीस एजेंट एक साथ बुलाएँ तो बीस अलग, टकराव-रहित टास्क पाते हैं। Leases expire होते हैं, इसलिए मरा हुआ एजेंट wave को अटका नहीं सकता।

### Fleet मोड: एजेंटों की hierarchy

Fleet मोड एजेंटों को एक ढाँचा देता है: `spec/workflow.kvx` में एक **main** एजेंट (टास्क सूची का मालिक, PR merge करता है), हर फ़ीचर का एक **feature manager** (अपनी branch का मालिक), और **wave workers** जो feature branch से कटी branch पर काम करते हैं — काम सत्यापित merges से ऊपर बहता है।

```ini
[hierarchy]
enabled    = true
main       = "main"
remote     = "origin"
worktrees  = ".codegraph/worktrees"
test_gate  = "make test"
lint_gate  = "make cg CFLAGS='-O2 -Werror'"
pr         = "auto"          # auto | manual
checkpoint = "manual"

[role.worker]                # [role.main] और [role.feature] भी इसी तरह;
branch  = "task/{feature}/{task}"  # हर key का एक डिफ़ॉल्ट है;
base    = "feature/{feature}"      # {task} हर टास्क को अपनी branch देता है
driver  = "codex"            # इसके एजेंट कैसे चलें, और कितना ख़र्च करें
wall    = "3h"
stall   = "10m"
retries = 2
approve = ["land"]           # opt-in: `cg fleet approve` का इंतज़ार
```

| कमांड | विवरण |
|---|---|
| `cg fleet roles` | कॉन्फ़िगर की गई hierarchy: branch templates, base, remote, gates, PR नीति |
| `cg fleet status` | कौन किस role में, किस टास्क पर, किस parent के नीचे ज़िंदा है |
| `cg fleet plan [-f F]` | कौन सा manager फ़ीचर का मालिक है और हर wave का worker कौन, लाइव एजेंटों के साथ |
| `cg fleet tree [-f F]` | लाइव पेड़ — main, managers, workers — हर branch की प्रगति, merge state, attempt और heartbeat |
| `cg fleet begin <id>` | wave branch और worktree बनाता या दोबारा उपयोग करता है और worker के लिए टास्क claim करता है |
| `cg fleet merge-up <id>` | **qualified** wave branch को feature branch में merge करता है; टकराव पाथ सहित बताकर abort |
| `cg fleet land <feature>` | feature branch को लोकल main में merge करके test और lint gates चलाता है; लाल होने पर main वापस, हरा होने पर `auto` नीति में PR |
| `cg fleet pr <feature>` | `gh` से push और PR; `gh` न हो तो सटीक कमांड छापता है |
| `cg fleet checkpoint` | खुले `feature/*` PR सबसे छोटे नंबर से merge करता है, पहले न होने वाले पर रुकता है |
| `cg fleet up [-f F \| --all] [-n N] [--foreground] [--resume [RUN]] [--dry-run]` | detached supervisor के नीचे टिकाऊ run: main, managers और workers एक साथ, हर टास्क qualified और merged होने तक। `--resume` ज़िंदा एजेंटों को अपनाकर अधूरा run जारी रखता है |
| `cg fleet down [--drain] \| pause \| resume [RUN]` | रोकना (claims मुक्त, branches बनी रहती हैं), लाइव काम पूरा होने देना, spawning रोकना, या जारी रखना |
| `cg fleet runs` | runs, उनकी state, और supervisor ज़िंदा है या नहीं |
| `cg fleet approvals [--all] \| approve <id> [--reject] [-m note]` | opt-in gate (`land`, `pr`, `drift`, `coverage`) पर क्या रुका है, और उसे छोड़ने वाला फ़ैसला |
| `cg fleet steer <agent> <message>` | चलते एजेंट के लिए संदेश: उसका अगला edit (Claude Code, post-edit hook से) या अगला prompt |
| `cg fleet brief <feature>` | feature manager की briefing: subtree state, लाइव workers, विफल attempts, टकराव, approvals |

पेड़ में एजेंट की जगह उसके environment (`CG_AGENT`, `CG_ROLE`, `CG_PARENT`, `CG_FEATURE`, `CG_WAVE`) में रहती है; बिना `CG_ROLE` के अकेला सेशन अपरिवर्तित रहता है। `cg fleet up` पूरा पेड़ खुद चलाता है — हर नामित फ़ीचर (`--all`: काम बाकी वाला हर फ़ीचर), manager और उसके workers साथ, हर worker अपने worktree में:

```
$ cg fleet up --foreground --all -n 3
[fleet] alpha — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.2 → 2.2 (wave 1) on task/alpha/2.2, log .codegraph/agents/alpha-2.2.log
[fleet] worker w-alpha-2.1 task 2.1 exit 1 → INCOMPLETE
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.2 on 2.2: no progress for 2s — nudged
[fleet] worker w-alpha-2.2 on 2.2: stalled — no progress for 2s after a nudge — stopping it
[fleet] beta — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] alpha complete — 4/4 task(s) qualified, feature/alpha merged into main, 2 failure(s)
[fleet] beta complete — 2/2 task(s) qualified, feature/beta merged into main, 0 failure(s)
```

- **Runs टिकाऊ हैं।** run और हर नोड — role, parent, task, branch, worktree, pid, attempt, fence, retries, spend — डेटाबेस में रहते हैं। Supervisor मर जाए तो `cg fleet up --resume` ज़िंदा एजेंटों को (pid और start time से जाँचकर) अपनाता है और retry गिनती बनाए रखता है।
- **निगरानी।** प्रगति का मतलब काम है — events, लॉग आउटपुट, worktree में बदलाव — heartbeat नहीं। एक stall window में प्रगति न हो तो nudge, दूसरी में attempt handoff के साथ रुकता है। `wall` और `spend` बजट attempt रोकते हैं; विफल टास्क ग़लती की जानकारी के साथ दोबारा चलता है; retries ख़त्म होने पर manager, फिर main तक escalate, फिर blocked — बाकी run चलता रहता है।
- **तीनों स्तर एक साथ।** feature merge lock बारी-बारी की जगह लेता है, इसलिए managers और workers साथ चलते हैं; `{task}` branch template से एक wave के टास्क अपनी branches पर समानांतर चलते हैं, सिवाय टकराव वाले जोड़ों के। `[hierarchy] main_agent = true` Main Gideon को भी प्रोसेस के रूप में चलाता है।
- **ग्राफ़ से briefing।** worker के prompt में उसके मानदंड, घोषित सिंबल की मौजूदा परिभाषाएँ (कॉलर और कैली सहित), prerequisites ने feature branch पर असल में क्या बनाया, और siblings क्या छू रहे हैं — token बजट में। `cg work update` attempt शुरू होने के बाद ऊपर merge हुए सिंबल बताता है।
- **रोकना opt-in है।** role के `approve` में सूचीबद्ध gates `land`, `pr`, drift वाला `merge-up`, या बिना कवर मानदंडों वाला land `cg fleet approve` तक रोकते हैं। इनके बिना कुछ भी इंसान का इंतज़ार नहीं करता।

subtree इसलिए complete है क्योंकि वह **merged** हुआ, न कि प्रोसेस बंद हुआ। पूरा flow और उदाहरण [docs/hierarchy.md](../../docs/hierarchy.md) में; drift [docs/drift.md](../../docs/drift.md) में; event log, `cg serve` और steering [docs/events.md](../../docs/events.md) में।

### हर branch के लिए एक ग्राफ़

Fleet कई worktrees में कई branches पर काम करता है, और Codify सबको एक `.codegraph/` में इंडेक्स करता है। linked worktree में `cg init` दूसरा डेटाबेस माँगने के बजाय साझा प्रोजेक्ट से **जुड़ता** है। फ़ाइल पंक्तियाँ branch के दायरे में हैं, क्वेरी आपकी मौजूदा branch के लिए जवाब देती हैं, और `--branch <name>` या `--all-branches` बाकी से पूछते हैं। parsed सामग्री hash से branches के बीच दोबारा उपयोग होती है, इसलिए नया worktree पूरा parse नहीं माँगता। `cg fleet merge-up` मेमोरी को भी कोड के साथ base तक promote करता है। विवरण: [docs/branches.md](../../docs/branches.md)।

### Jev decisions

कुछ सवाल deterministic नहीं होते — *यह विफलता flaky है या असली, यह मेमोरी skill है या noise।* `cg jev` TypeSafe के System One मॉडल (`typesafe/jev-1.13`, OpenRouter पर) से typed जवाब माँगता है: `noul` (true की संभावना), 255 तक विकल्पों में से `choice`, या ordinal `score`। यह कभी टेक्स्ट नहीं बनाता।

| कमांड | विवरण |
|---|---|
| `cg jev doctor [--probe]` / `cg jev log [-n N]` | key, curl, endpoint, मॉडल और लॉग की सेहत (`--probe` एक छोटा फ़ैसला भेजता है); `.codegraph/jev.log` से आख़िरी N कॉल |
| `cg jev ask [<request.json>\|-]` | सीधे पूछना: `--state S`, `--noul N I`, `--choice N I --option K=D …`, `--score N I --level L …` |

`cg spec done` (जब `verify_cmd` विफल हो) को triage लाइन, `cg guard` को findings की रैंकिंग, और `cg fleet pr` को PR body में readiness स्कोर मिलता है। key न हो तो stderr पर एक बार संदेश आता है और कमांड का अपना फ़ैसला और exit code अछूता रहता है। key कभी command line पर नहीं आती, और हर कॉल लॉग होती है। देखें [docs/jev.md](../../docs/jev.md)।

## एजेंटों को चलाना

### Orchestrator: `cg spec run`

`cg spec run` parallel spec को चलते एजेंट सेशनों में बदलता है: `claim-next` टकराव-रहित टास्क चुनता है, `resume --prompt` उसकी briefing लिखता है, फिर हर slot के लिए एक driver प्रोसेस चलता है, prompt stdin पर और आउटपुट प्रति-टास्क लॉग में। कॉन्फ़िगरेशन `spec/workflow.kvx` में:

```ini
[agents]
driver      = "codex"        # codex | claude | custom
max         = 3              # डिफ़ॉल्ट slot गिनती (-n ओवरराइड करता है)
ttl         = 3600           # lease TTL, सेकंड
codex_args  = ""             # codex driver के लिए अतिरिक्त arguments
claude_args = ""             # claude driver के लिए अतिरिक्त arguments
cmd         = ""             # custom driver: shell template जिसमें
                             # ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
```

`codex` driver `codex exec --sandbox workspace-write` से और `claude` driver `claude -p --permission-mode acceptEdits` से चलता है। पूर्णता spec तय करता है, प्रोसेस नहीं: child बंद होने पर टास्क status दोबारा पढ़ा जाता है; `done` या `implemented` सफलता है, बाकी में lease मुक्त होकर एक परिणाम मेमोरी दर्ज होती है। Ctrl-C children को रोककर leases मुक्त करता है और 130 के साथ बाहर निकलता है; `--dry-run` पूरी योजना दिखाता है और कुछ claim नहीं करता। इसके लिए `.codegraph/` इंडेक्स और `cg spec mode parallel` (या `prod`) ज़रूरी है।

### Agent view (VS Code)

Codify sidebar में एक स्थायी **Agent** chat view है: एक्सटेंशन [Agent Client Protocol](https://agentclientprotocol.com) client है जो Claude Code या Codex को उनके ACP adapter (`claude-code-acp` / `codex-acp`, या `codify.acp.customCommand`) से पहले संदेश पर शुरू करता है। हर सेशन में **Codify का MCP सर्वर अपने आप जुड़ता है** (`cg mcp`)। `/` टाइप करने पर Codify की अपनी क्रियाएँ (`/brief`, `/next`, `/context`, `/impact`, `/review` …) खुलती हैं, और **`cg` का हर टूल एक slash कमांड है** — palette टूल सूची से बनती है, argument hints हर टूल के schema से (`/get_context auth flow`, `/spec_claim id=2.1 ttl=20`)। Fleet तक भी पहुँच है: `/fleet` पेड़ और runs दिखाता है, `/attach <agent>` किसी fleet एजेंट का लाइव transcript फ़ॉलो करता है ताकि आपका अगला संदेश उसे steer करे, `/steer <agent> <message>` एक संदेश भेजता है, और approval requests व escalations Approve और Reject वाले cards के रूप में आते हैं। हर view एक `cg serve` connection पर pushed events से अपडेट होता है, इसलिए polling नहीं। देखें [editors/vscode/README.md](../../editors/vscode/README.md)।

## एडिटर

### Language server

`cg lsp` उसी ग्राफ़ पर एक Language Server है, इसलिए हर एडिटर को Codify मिलता है — बिना कंपाइलर, टूलचेन या प्रोजेक्ट कॉन्फ़िगरेशन के। Go to definition, find references, hover (**दर्ज निर्णयों सहित**), workspace symbols, code lens, और diagnostics — kvx parse त्रुटियाँ और चालू टास्क के `touches` से बाहर edit की गई फ़ाइलें, यानी scope drift edit के क्षण ही squiggle बनकर दिखता है। किसी भी LSP client को stdio पर `cg lsp` की ओर इंगित करें।

### VS Code एक्सटेंशन

`editors/vscode/` में Codify एक्सटेंशन है — पूरा वर्कफ़्लो एडिटर में:

- **ग्राफ़ से कोड नेविगेशन** `cg lsp` के ज़रिए, और **scope drift एक squiggle के रूप में** — सलाह, कभी त्रुटि नहीं।
- **लाइव टास्क पेड़**: feature → section → wave, हर पंक्ति पर status, lease धारक एजेंट और उसका role, branch और अधूरे requires; फ़िल्टर, सर्च, और हर टास्क का detail पैनल।
- **टास्क बोर्ड से एजेंट सेशन** (ACP agent पैनल, terminal या headless; handoff, resume, पूरी wave), और **मेमोरी ब्राउज़र** — type, Jev class, टास्क, branch और तारीख़ के फ़िल्टर; supersede, forget, classify-with-Jev और promote-to-skill।
- **Fleet शुरू करें, और लाइव देखें।** **Start fleet** — फ़ीचर के `spec.kvx` पर CodeLens, fleet view का शीर्षक, या command palette — योजना का preview दिखाता है और पुष्टि पर `cg fleet up` चलाता है; Stop, Pause और Resume view पर हैं। Fleet पेड़ Main Gideon, managers और workers को branch, worktree, attempt, heartbeat, merge state, tokens, लागत और stall/retry/escalation badges के साथ दिखाता है; pending approvals ऐसी पंक्तियाँ हैं जिनसे आप फ़ैसला करते हैं।
- **एक connection पर लाइव।** `serve` वाले `cg` के साथ एक्सटेंशन हर कॉल और event के लिए एक `cg serve` child रखता है और polling बंद कर देता है; `codify.serve: false` या पुरानी बाइनरी पर polling पर लौटता है।
- **एक Actions मेनू**, **kvx editing** (`requires` पर go-to-definition, completion, outline), और **एक refresh scheduler** जो हर trigger को debounce करके `cg` कॉल की एक ही चेन में भेजता है।

एक्सटेंशन की कोई निर्भरता और कोई बिल्ड स्टेप नहीं:

```sh
cd editors/vscode
npx @vscode/vsce package        # codify-workflow-1.4.0.vsix बनाता है
code --install-extension codify-workflow-1.4.0.vsix --force
```

Marketplace पहचान `SidioraLabs.codify-workflow` है। देखें [editors/vscode/README.md](../../editors/vscode/README.md)।

## डेवलपमेंट

```sh
make             # ./cg बनाता है            (निर्भरता: C कंपाइलर, libsqlite3-dev)
make unit        # C यूनिट टेस्ट             (tests/unit/*.c बनाम build/libcg.a)
make integration # एंड-टू-एंड CLI टेस्ट       (sandbox में tests/integration/*.sh)
make test        # दोनों
make release     # स्टैटिक रिलीज़ बाइनरी -> टेस्ट -> web root पर प्रकाशित
```

रिपॉज़िटरी संरचना:

```
src/                 प्रति मॉड्यूल एक .c फ़ाइल; src/cg.h एकमात्र हेडर है
src/govern.c         brief, review, guard, check, handoff, resume — गवर्नेंस परत
src/orchestrate.c    cg spec run और fleet supervisor (cg fleet up): टिकाऊ runs, तीनों स्तर साथ, stalls, बजट, retries, escalation
src/syncgate.c       single-writer इंडेक्स gate और मशीन-व्यापी parse slots
src/fleet.c          roles और क्षमताएँ, branch lifecycle, merge lock, approval gates, fleet पेड़
src/events.c         append-only event log और cg events
src/serve.c          cg serve — pushed events वाला एक JSON-RPC connection
src/drivers.c        एजेंट launch argv, structured आउटपुट से events, steering
src/drift.c          spec drift, collision prediction, interface drift, coverage
src/changelog.c      git इतिहास से रिलीज़ नोट, वैकल्पिक मॉडल highlights
src/jev.c            curl पर typed फ़ैसले
src/skills.c         skill वर्ग की मेमोरी, .agents/skills के रूप में रेंडर
src/lsp.c            ग्राफ़ पर language server
src/gitint.c         git इतिहास ingestion, churn, branch पहचान, commit mirroring
tests/unit/          kvx व्याकरण, SHA-256 वेक्टर, JSON स्कैनर, StrBuf/IO
tests/integration/   ग्राफ़, vcs, एजेंटिक, MCP प्रोटोकॉल, spec इंजन, watcher, sync gate, fleet,
                     branches, jev, changelog, events, serve, supervisor, drift, briefings, fleet एंड-टू-एंड
tests/fixtures/      नमूना बहुभाषी प्रोजेक्ट, golden आउटपुट वाला spec रिपो, curl, gh और
                     OpenAI endpoint के stand-ins, और एक scripted fleet driver
editors/vscode/      VS Code एक्सटेंशन (सादा JS): kvx भाषा, टास्क पेड़, agent पैनल,
                     मेमोरी ब्राउज़र, लाइव fleet view, serve client
scripts/             codify.centra.ag पर परोसी install/uninstall स्क्रिप्ट + release publisher
docs/ARCHITECTURE.md सारे हिस्से कैसे जुड़ते हैं
docs/sync.md         sync gate, freshness, slots, incremental resolution
docs/hierarchy.md    roles, branch flow, supervisor, निगरानी, approvals, briefings
docs/drift.md        spec, collision, interface और coverage drift
docs/events.md       event log, cg serve, drivers, steering
docs/branches.md     एकीकृत multi-branch ग्राफ़ और schema v16
docs/jev.md          typed फ़ैसले: प्रकार, transport, कॉन्फ़िगरेशन, सीमाएँ
```

spec रेंडर के golden आउटपुट मूल Go specgen से बने हैं, इसलिए रेंडरिंग की समानता `make test` से पक्की रहती है। हर push पर CI पूरी टेस्ट सूट `.github/workflows/ci.yml` के ज़रिए चलाता है।

## एडिटर और एजेंटों के बीच ग्राफ़ साझा करना

ग्राफ़ WAL मोड में एक SQLite फ़ाइल है और checkout का हर `cg` प्रोसेस उसमें लिखता है। Writers lock छोटे-छोटे हिस्सों में लेते हैं, और CLI कमांड अपनी बारी के लिए `CG_BUSY_TIMEOUT_MS` (डिफ़ॉल्ट 30000) तक इंतज़ार करता है; lock फिर भी न छूटे तो कमांड 75 के साथ बाहर निकलता है — कुछ लागू नहीं हुआ, वही कमांड दोबारा चलाना सुरक्षित है। कौन *walk* करेगा, यह `.codegraph/index.lock` तय करता है; बाकी अपने पाथ `.codegraph/index.dirty` में छोड़ते हैं। मशीन-व्यापी parse threads `/tmp/codify-<uid>` के slot files से बँटते हैं (`CG_INDEX_SLOTS`, `CG_INDEX_WORKERS`, `CG_SLOT_DIR`)। पूरा contract: [docs/sync.md](../../docs/sync.md)।

## नोट और सीमाएँ

- इग्नोर नियम समझदार डिफ़ॉल्ट (VCS डायरेक्टरी, `node_modules`, बिल्ड आउटपुट, बाइनरी) और `.cgignore` फ़ाइल (प्रति लाइन एक glob) को मिलाकर बनते हैं।
- सिंबल निकालना ह्यूरिस्टिक है। हर भाषा के लिए टिप्पणी और स्ट्रिंग को समझने वाला पैटर्न इंजन परिभाषाओं और कॉल साइट पर recall के लिए ट्यून किया गया है। यह पूर्ण टाइप-चेक्ड रिज़ॉल्वर नहीं है।
- स्नैपशॉट हर गैर-इग्नोर की गई फ़ाइल को 32 MB तक स्टोर करते हैं, बाइनरी सहित। ग्राफ़ 8 MB तक की टेक्स्ट फ़ाइलें इंडेक्स करता है।
- coalesced सिंक ताज़ा ग्राफ़ के बिना लौटता है: वह अपना बदलाव gate धारक प्रोसेस के लिए कतार में डालता है और आख़िरी पूरे इंडेक्स से जवाब देता है।
- क्वेरी आपकी मौजूदा branch के लिए जवाब देती हैं। `--branch <name>` दूसरी से और `--all-branches` सबसे पूछता है; hit पर `@branch` लेबल केवल तब लगता है जब एक से ज़्यादा branch दायरे में हों, इसलिए single-branch आउटपुट नहीं बदलता।
- `cg fleet` `git` और `gh` को subprocess के रूप में चलाता है। `gh` के बिना `pr` और `checkpoint` कमांड चलाने के बजाय छापते हैं, और `checkpoint` केवल `feature/*` head branches को Codify की अपनी मानता है।
- Jev को नेटवर्क और `OPENROUTER_API_KEY` चाहिए। मूल चक्र में कुछ भी इस पर निर्भर नहीं, और Jev का कोई जवाब exit code नहीं बदलता।
- fleet supervisor प्रति प्रोजेक्ट एक है और एजेंटों को उनके CLI से चलाता है; उन्हें authenticate नहीं करता। `spend` बजट driver द्वारा बताई लागत पर निर्भर है, केवल Claude Code को turn के बीच steer किया जा सकता है, और `retry` approval gate स्वीकार होता है पर अभी लागू नहीं। बाकी [docs/hierarchy.md](../../docs/hierarchy.md#limitations) में।
- Drift detection लाइन- और ग्राफ़-स्तरीय है: अपरिवर्तित लाइनों के भीतर व्यवहार बदलाव, किसी तीसरे फ़ंक्शन से होकर कॉल, और इंडेक्सर को न दिखने वाले रेफ़रेंस छूट जाते हैं ([docs/drift.md](../../docs/drift.md#limitations))।
- Changelog highlights को नेटवर्क और key चाहिए; बिना key के नोट सादा derived रिकॉर्ड होते हैं।

## समुदाय

- [Codify क्यों बना](../../WHY.md)
- [योगदान गाइड](../../CONTRIBUTING.md)
- [सुरक्षा नीति](../../SECURITY.md)
- [आचार संहिता](../../CODE_OF_CONDUCT.md)
- [मेंटेनर](../../MAINTAINERS.md)
- [उद्धरण कैसे दें](../../CITATION.cff)

## लाइसेंस

MIT © [Sidiora Labs](https://sidiora.com)
