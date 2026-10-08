import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parseSmashableEnvironment,
  parseTrackSmashables,
  removalSmashTriggered,
  smashContactAllowed,
  selectSmashLevel,
  SMASH_BODY_IMPULSE_GATE,
  numericSmashTriggerEligible,
} from "../src/world-smash.ts";

// Entirely authored fixtures; original data stays in the external asset store.
const empty = "0\n0\n0\nnone\n0\n0\n0\n0\nnone\n0";
const reserved = "9\n8\n7\n6";
function plain(
  mode = "remove",
  trigger = "TEST.MAT",
  flags = 0,
  threshold = 2,
) {
  return `${flags}\n${trigger}\n${mode}\n${threshold}\n${empty}\n${mode === "replacemodel" ? "NEXT.DAT\n0\n" : ""}${reserved}`;
}
function level(threshold, mode = "solid") {
  return `${threshold}\n4\n${mode}\n${empty}\n1\nBROKEN.PIX`;
}
function texture() {
  return `0\nWINDOW.MAT\ntexturechange\nINTACT.PIX\n2\n${level(1)}\n${level(3, "passthrough")}\n${reserved}`;
}

test("smash modes retain numeric, actor, model and material trigger fields", () => {
  const result = parseSmashableEnvironment(
    `4\n${plain()}\n${plain("replacemodel", "THING.ACT")}\n${plain("nochange", "&12\n5")}\n${plain("crush", "&long")}`,
  );
  assert.equal(result[0].trigger.kind, "material");
  assert.deepEqual(result[1].replacement, {
    model: "NEXT.DAT",
    fire: { chance: 0 },
  });
  assert.deepEqual(result[2].trigger, {
    kind: "number",
    name: "&12",
    index: 12,
    argument: 5,
  });
  assert.equal(result[3].trigger.kind, "model");
  assert.deepEqual(result[0].reserved, [9, 8, 7, 6]);
});

test("texture and decal records retain authored thresholds, flags and collision modes", () => {
  const spec = parseSmashableEnvironment(`1\n${texture()}`)[0];
  assert.equal(spec.intactPixelmap, "INTACT.PIX");
  assert.deepEqual(
    spec.levels.map((l) => [l.threshold, l.flags, l.collisionMode]),
    [
      [1, 4, "solid"],
      [3, 4, "passthrough"],
    ],
  );
  const decal = parseSmashableEnvironment(
    `1\n0\nSTAMP\ndecal\nORIGINAL\n1\n2\n0\n${empty}\n1\nMARK\n${reserved}`,
  )[0];
  assert.equal(decal.levels[0].collisionMode, undefined);
  assert.deepEqual(decal.levels[0].pixelmaps, ["MARK"]);
});

test("connotations preserve all nested metadata and native slick branch alignment", () => {
  const velocity = "0,2\n0.5\n1\n2\n3\n4";
  const debris = `2\nabstract\n2\nBITS1.MAT\nBITS2.MAT\nnoncars\n${velocity}\nboxclumped\n1,2,3\n-1,-1\n50\n2\n0,3\nPARTS.ACT\n1\nBIT\n01BIT.TXT`;
  const animation =
    "1\n1,2\n0,0.5\n0,1,0\n1,2\n1,2\n1,2\n10,20\n0.5,1\nrandomrotate\n1\n0.75\nFIRE.PIX";
  // A zero vector.z and nonzero pair[1] must still consume the secondary slick.
  const slick = "OIL.MAT\n1,2,3\n4,5,0\n6,7\n8,9\nMUD.MAT";
  const activation = `1\n1,2\nrelative\n7\n-1,-2,-3\n1,2,3\n${velocity}`;
  const effect = "1\n0,1\nOTHER.MAT\nabsolute\n-1,0,-1\n1,2,1\naway\n12";
  const connotations = `2\n100\n101\n${debris}\n${animation}\n${slick}\n${activation}\n${effect}\n1\n99\n7\nrepeated\n1.5\n2.5\n3\n4\n1\n8,9`;
  const c = parseSmashableEnvironment(
    `1\n0\nTEST\nremove\n1\n${connotations}\n${reserved}`,
  )[0].connotations;
  assert.deepEqual(c.sounds, [100, 101]);
  assert.deepEqual(c.shrapnel[0].materials, ["BITS1.MAT", "BITS2.MAT"]);
  assert.equal(c.shrapnel[1].speed.randomSpinRateMax, 4);
  assert.deepEqual(c.shrapnel[1].position, {
    kind: "boxclumped",
    size: [1, 2, 3],
  });
  assert.deepEqual(c.shrapnel[1].nonCars, [
    { actor: "BIT", mechanics: "01BIT.TXT" },
  ]);
  assert.equal(c.explosions[0].frames[0].opacity, 0.75);
  assert.equal(c.slick.secondMaterial, "MUD.MAT");
  assert.equal(c.activations[0].nonCarType, 7);
  assert.deepEqual(c.activations[0].delaySeconds, [1, 2]);
  assert.throws(
    () =>
      parseSmashableEnvironment(
        `1\n0\nTEST\nremove\n1\n${connotations.replace(activation, activation.replace("1,2", "0.1,0.2"))}\n${reserved}`,
      ),
    /integer activation delay/,
  );
  assert.equal(c.sideEffects[0].strength, 12);
  assert.equal(c.extensionArgument, 99);
  assert.equal(c.award.frequency, "repeated");
  assert.deepEqual(c.variableChanges, [[8, 9]]);
});

test("single authored ghost amount retains its omitted second field", () => {
  const c = `0\n1\nghostparts\n0,0\n0\n0\n0\n0\n0\nactorbased\n1,2\n-1\n-1\nPARTS.ACT\n0\nnone\n0\n0\n0\n0\nnone\n0`;
  const spec = parseSmashableEnvironment(
    `1\n0\nGHOST\nremove\n1\n${c}\n${reserved}`,
  )[0];
  assert.deepEqual(spec.connotations.shrapnel[0].amount, [-1]);
  assert.equal(spec.connotations.shrapnel[0].actorCountSource, -1);
});

test("native threshold helpers require supplied solver impulses and preserve equality", () => {
  const spec = parseSmashableEnvironment(`1\n${plain()}`)[0];
  assert.equal(removalSmashTriggered(spec, 1.999, "body"), false);
  assert.equal(removalSmashTriggered(spec, 2, "body"), true);
  assert.equal(smashContactAllowed(1, "wheel"), false);
  assert.equal(smashContactAllowed(1, "body"), true);
  assert.equal(smashContactAllowed(2, "body"), false);
  assert.equal(
    numericSmashTriggerEligible(
      { kind: "number", name: "&12", index: 12, argument: 1 },
      "&12?0001.ACT",
    ),
    true,
  );
  assert.equal(
    numericSmashTriggerEligible(
      { kind: "number", name: "&12", index: 12, argument: 1 },
      "&12!0001.ACT",
    ),
    false,
  );
  assert.equal(
    numericSmashTriggerEligible(
      { kind: "number", name: "&12", index: 12, argument: 4 },
      "&12!0001.ACT",
    ),
    true,
  );
  assert.equal(SMASH_BODY_IMPULSE_GATE, Math.fround(0.02));
  const material = parseSmashableEnvironment(`1\n${texture()}`)[0];
  assert.equal(selectSmashLevel(material, 0.09), 0);
  assert.equal(selectSmashLevel(material, 1), 1);
  assert.equal(selectSmashLevel(material, 3), 2);
  assert.equal(selectSmashLevel(material, 2.9, 1), 1);
  assert.equal(selectSmashLevel(material, 1, 2), 2);
  assert.throws(() => selectSmashLevel(material, NaN), /impulse/);
});

test("track block alignment ignores subsequent sections and bounds malformed data", () => {
  assert.deepEqual(parseTrackSmashables("no smash section"), []);
  assert.equal(
    parseTrackSmashables(
      `header\n// Smashable environment specs\n1\n${plain()}\nANOTHER SECTION`,
    ).length,
    1,
  );
  assert.throws(
    () => parseSmashableEnvironment("999999", "bad.txt"),
    /bad.txt:1.*count/,
  );
  assert.throws(
    () => parseSmashableEnvironment("1\n0\nTEST\nunknown", "bad.txt"),
    /bad.txt:4.*unknown smash mode/,
  );
  assert.throws(
    () => parseSmashableEnvironment("1\n0\nTEST\nremove\nNaN"),
    /removal threshold/,
  );
  assert.throws(
    () => parseSmashableEnvironment(`1\n${plain()}\nextra`),
    /unexpected data/,
  );
  assert.throws(
    () => parseSmashableEnvironment(`1\n${plain().slice(0, -2)}`),
    /incomplete/,
  );
});

let available = true;
try {
  await access(new URL("../carma2_orig/data.twt", import.meta.url));
} catch {
  available = false;
}
test(
  "every stock track smash section is consumed read-only",
  { skip: !available },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const tracks = assets.manifest.filter((e) =>
      /^data\/RACES\/[^/]+\/[^/]+\.txt$/i.test(e.path),
    );
    let count = 0;
    const modes = new Set(),
      triggerKinds = new Set();
    for (const entry of tracks) {
      const text = decodeText(await assets.read(entry.path));
      const specs = parseTrackSmashables(text, entry.path);
      count += specs.length;
      for (const spec of specs) {
        modes.add(spec.mode);
        triggerKinds.add(spec.trigger.kind);
      }
    }
    assert.equal(tracks.length, 51);
    assert.equal(count, 448);
    assert.ok(modes.has("texturechange"));
    assert.ok(modes.has("remove"));
    assert.ok(modes.has("replacemodel"));
    assert.ok(triggerKinds.has("number"));
  },
);
