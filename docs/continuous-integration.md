# Continuous integration

GitHub Actions runs the asset-free build and test suite for pushes and pull
requests. The workflow checks out the source, installs the exact Node.js
release and lockfile dependencies, then runs `npm run build` and `npm test`.
It grants the job read-only repository contents access and does not use
secrets, publish artifacts, or install the original game data.

The workflow explicitly fails if `carma2_orig/` is present. Tests that need an
original installation are expected to skip when it is absent; the check keeps
CI from accidentally depending on ignored or privately supplied assets. The
local equivalent is:

```sh
npm ci
npm run build
npm test
```

Action dependencies use full commit hashes rather than movable version tags.
When updating a pin, check the action's official release page and use the full
SHA for the corresponding signed release commit:

- [actions/checkout releases](https://github.com/actions/checkout/releases)
- [actions/setup-node releases](https://github.com/actions/setup-node/releases)

The workflow currently uses Node.js 22.23.4, an exact LTS patch release. Check
the [official Node.js v22 archive](https://nodejs.org/en/download/archive/v22)
when updating it. Hosted execution is reported by GitHub Actions after the
workflow is pushed; a local workflow review does not claim a hosted run.
