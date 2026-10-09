---
name: Source broken / Selector changed
about: Report a scan source failure (Naukri, Internshala, Ashby, Greenhouse, Lever)
title: '[SOURCE BROKEN] '
labels: source-health, bug
assignees: ''
---

**Broken Source**
- [ ] Naukri
- [ ] Internshala
- [ ] Ashby
- [ ] Greenhouse
- [ ] Lever
- [ ] Careers Page

**Health Status Reported**
- State: [e.g. `SELECTOR_BROKEN`, `BLOCKED`, `THROTTLED_TIMEOUT`, `DEGRADED`, `ERROR`]
- Raw card count: [e.g. 0]
- Job anchor count: [e.g. 24]

**Console / Health Log Output**
Paste the relevant line from `data/health-log.jsonl` or terminal output:
```json
{"ts":"...","source":"...","state":"...","raw":0,"filtered":0}
```

**Additional Context**
Did the page load a splash screen, Cloudflare captcha, login wall, or modified DOM selectors?
