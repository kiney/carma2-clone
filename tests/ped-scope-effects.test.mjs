import test from "node:test";
import assert from "node:assert/strict";
import {
  planNativePedScopeExit,
  nativePedFallingHeight,
} from "../src/ped-scope-effects.ts";
const input = (overrides) => ({
  rendered: true,
  replay: false,
  active: false,
  flags: 1,
  hitPoints: 100,
  burningValue: 0,
  ...overrides,
});
test("ordinary offscope active fall counts after real release then scores with actual height", () => {
  assert.deepEqual(planNativePedScopeExit(input({ active: true })), {
    beforeRelease: ["vanish"],
    afterRelease: ["count", "score-fall"],
  });
  assert.deepEqual(
    planNativePedScopeExit(input({ active: true, hitPoints: 0 })),
    { beforeRelease: ["vanish"], afterRelease: ["count"] },
  );
  assert.equal(nativePedFallingHeight(5.25, 1.5), 3.75);
  assert.equal(
    nativePedFallingHeight(5, null),
    Math.fround(3.4028234663852886e38),
  );
});
test("inactive positive burning scores without FullKill before vanish/count; source scoreHP0 avoids double score", () => {
  assert.deepEqual(planNativePedScopeExit(input({ burningValue: 1234 })), {
    beforeRelease: [],
    afterRelease: ["score-burn", "stop-burning", "vanish", "count"],
  });
  assert.deepEqual(
    planNativePedScopeExit(input({ active: true, burningValue: 1234 })),
    {
      beforeRelease: ["vanish"],
      afterRelease: ["count", "score-fall", "stop-burning"],
    },
  );
  assert.deepEqual(
    planNativePedScopeExit(input({ hitPoints: 0, burningValue: 1234 })),
    { beforeRelease: [], afterRelease: ["stop-burning", "vanish", "count"] },
  );
});
test("passive ordinary release is not death and negative pending napalm only stops its actual resource", () => {
  assert.deepEqual(planNativePedScopeExit(input()), {
    beforeRelease: [],
    afterRelease: [],
  });
  assert.deepEqual(planNativePedScopeExit(input({ burningValue: -2 })), {
    beforeRelease: [],
    afterRelease: ["stop-burning"],
  });
  assert.deepEqual(
    planNativePedScopeExit(input({ flags: 0x181, burningValue: 1234 })),
    { beforeRelease: [], afterRelease: ["score-burn", "stop-burning"] },
  );
  assert.deepEqual(
    planNativePedScopeExit(input({ active: true, replay: true })),
    { beforeRelease: [], afterRelease: [] },
  );
});
