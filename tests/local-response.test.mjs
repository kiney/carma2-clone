import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { runLocalResponses } from "../src/physics/local-response.ts";
import {
  buildJointConstraints,
  createBallJoint,
} from "../src/physics/joint.ts";

function body(name, x = 0, immovable = false) {
  return {
    name,
    state: {
      position: new Vector3(x, 0, 0),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      immovable,
    },
  };
}
function row(a, b, label = `${a.name}/${b?.name ?? "world"}`) {
  return {
    a,
    b,
    label,
    point: new Vector3(),
    normal: new Vector3(0, 1, 0),
    sourceType: b ? 5 : 1,
  };
}
function impacts(rows, lambda = 0) {
  return rows.map((contact) => ({
    ...contact,
    normalImpulse: lambda,
    closingSpeed: lambda,
    tangentImpulse: new Vector3(),
    solverAccepted: true,
  }));
}
function result(rows, lambda = 0, extras = {}) {
  return {
    impacts: impacts(rows, lambda),
    rejected: false,
    positiveJointImpulse: false,
    ...extras,
  };
}
function fixture(bodies) {
  const tokens = new WeakMap();
  const f = {
    bodies: [...bodies],
    joints: [],
    version: {},
    phase: 0,
    worlds: [],
    pairs: [],
    predictions: [],
    solves: [],
    world: (item) => [row(item)],
    pairsFor: () => [],
    preparation: (rows) => rows,
    response: (rows) => result(rows),
    change(item) {
      tokens.set(item, {});
    },
  };
  f.host = {
    roster: () => [...f.bodies],
    joints: () => [...f.joints],
    input: (item) => {
      if (!tokens.has(item)) tokens.set(item, {});
      return tokens.get(item);
    },
    worldVersion: () => f.version,
    predict: (roster, changed) =>
      f.predictions.push({ roster: [...roster], changed }),
    worldRows: (item) => {
      f.worlds.push(item);
      return f.world(item);
    },
    pairRows: (roster, incident) => {
      f.pairs.push({ roster: [...roster], incident: new Set(incident) });
      return f.pairsFor(roster, incident);
    },
    prepare: (rows) => f.preparation(rows),
    solve: (rows, joints) => {
      f.solves.push({ rows: [...rows], joints: [...joints] });
      return f.response(rows, joints);
    },
    diagnostics: {},
  };
  f.run = () => runLocalResponses(f.host);
  return f;
}
const incidentRows = (rows, roster, incident) =>
  rows.filter(
    (contact) =>
      roster.includes(contact.a) &&
      roster.includes(contact.b) &&
      (incident.has(contact.a) || incident.has(contact.b)),
  );
const labels = (solve) => solve.rows.map((contact) => contact.label);
const joint = (parent, child) =>
  createBallJoint(
    child,
    parent,
    parent.state.position
      .clone()
      .sub(child.state.position)
      .applyQuaternion(child.state.orientation.clone().invert()),
    new Vector3(),
  );

test("post-response incident discovery sees the full roster and a newly reached third neighbor's supports", () => {
  const [a, b, c, remote] = [
    body("a"),
    body("b", 1),
    body("c", 2),
    body("remote", 100),
  ];
  const f = fixture([a, b, c, remote]);
  f.pairsFor = (roster, incident) =>
    incidentRows(
      [row(a, b), ...(f.phase ? [row(a, c)] : [])],
      roster,
      incident,
    );
  f.response = (rows) => {
    if (!f.phase && rows.some((contact) => contact.b === b)) {
      f.phase++;
      a.state.velocity.x = 1;
      f.change(a);
      return result(rows, 1);
    }
    return result(rows);
  };
  f.run();
  assert.ok(f.pairs.every((query) => query.roster.length === 4));
  const reached = f.solves.find((solve) => labels(solve).includes("a/c"));
  assert.ok(reached, "redirected motion must rediscover the third body");
  assert.ok(
    labels(reached).includes("c/world"),
    "new neighbor support must enter the full matrix",
  );
  assert.equal(f.worlds.filter((item) => item === remote).length, 1);
});

test("geometry joins membership before lambda evaluation and retains distinct feature rows", () => {
  const a = body("a"),
    b = body("b", 1);
  const f = fixture([a, b]);
  f.pairsFor = (roster, incident) =>
    incidentRows(
      [row(a, b, "feature0"), row(a, b, "feature1")],
      roster,
      incident,
    );
  f.run();
  assert.equal(f.solves.length, 1);
  assert.ok(labels(f.solves[0]).includes("a/world"));
  assert.ok(labels(f.solves[0]).includes("b/world"));
  assert.deepEqual(
    labels(f.solves[0]).filter((label) => label.startsWith("feature")),
    ["feature0", "feature1"],
  );
  assert.equal(f.host.diagnostics.responseSolves, 1);
});

test("input mutation in preparation recollects old supports and rediscovers neighbors before solving", () => {
  const a = body("a"),
    b = body("b", 1),
    c = body("c", 2);
  const f = fixture([a, b, c]);
  f.world = (item) => [
    row(item, undefined, `${f.phase ? "fresh" : "stale"}-${item.name}`),
  ];
  f.pairsFor = (roster, incident) =>
    incidentRows(
      f.phase ? [row(a, c, "fresh-pair")] : [row(a, b, "stale-pair")],
      roster,
      incident,
    );
  f.preparation = (rows) => {
    if (!f.phase && rows.some((contact) => contact.label === "stale-pair")) {
      f.phase = 1;
      a.properties.mass = 2;
      f.change(a);
    }
    return rows;
  };
  f.run();
  assert.ok(f.solves.length > 0);
  assert.ok(
    f.solves.every((solve) =>
      labels(solve).every((label) => !label.startsWith("stale")),
    ),
    "preparation invalidated all prior collected geometry",
  );
  assert.ok(
    labels(f.solves[0]).includes("fresh-pair"),
    "rediscovery must precede the invalidated solve",
  );
  assert.ok(labels(f.solves[0]).includes("fresh-a"));
});

test("preparation registration rediscovers the new body and collects its support before solving", () => {
  const a = body("a"),
    b = body("b", 1),
    added = body("added", 2);
  const f = fixture([a, b]);
  f.pairsFor = (roster, incident) =>
    incidentRows(
      [row(a, b), ...(f.phase ? [row(a, added)] : [])],
      roster,
      incident,
    );
  f.preparation = (rows) => {
    if (!f.phase && rows.some((contact) => contact.b === b)) {
      f.phase = 1;
      f.bodies.push(added);
    }
    return rows;
  };
  f.run();
  assert.ok(
    f.pairs.some(
      (query) => query.roster.includes(added) && query.incident.has(a),
    ),
    "new admission must refresh incident discovery",
  );
  assert.ok(labels(f.solves[0]).includes("a/added"));
  assert.ok(labels(f.solves[0]).includes("added/world"));
});

test("preparation removal discards removed-body rows rather than treating them as external anchors", () => {
  const a = body("a"),
    removed = body("removed", 1),
    c = body("c", 2);
  const f = fixture([a, removed, c]);
  f.pairsFor = (roster, incident) =>
    incidentRows(f.phase ? [row(a, c)] : [row(a, removed)], roster, incident);
  f.preparation = (rows) => {
    if (!f.phase && rows.some((contact) => contact.b === removed)) {
      f.phase = 1;
      f.bodies = f.bodies.filter((item) => item !== removed);
    }
    return rows;
  };
  f.run();
  assert.ok(
    f.solves.every((solve) =>
      solve.rows.every(
        (contact) => contact.a !== removed && contact.b !== removed,
      ),
    ),
  );
  assert.ok(labels(f.solves[0]).includes("a/c"));
});

test("an authored angular-limit response retries its hierarchy and discovers contact after angular response", () => {
  const a = body("a"),
    b = body("b", 1),
    c = body("c", 2);
  const f = fixture([a, b, c]);
  const link = joint(a, b);
  // The OLD child-X/parent-plane dot is sin(.02)>0. Its predicted -0.04rad
  // rotation crosses that plane to sin(-.02)<0, with closing speed1rad/s.
  link.planeLimits.push({
    childDirection: new Vector3(1, 0, 0),
    parentNormal: new Vector3(Math.sin(0.02), Math.cos(0.02), 0),
  });
  b.state.angularVelocity.z = -1;
  b.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    -0.04,
  );
  b.state.predictedPosition = new Vector3(1, 0, 0).applyQuaternion(
    b.state.predictedOrientation,
  );
  assert.ok(
    buildJointConstraints([link]).some(
      (constraint) => constraint.unilateral && constraint.closingSpeed > 0,
    ),
  );
  f.joints.push(link);
  f.world = () => [];
  f.pairsFor = (roster, incident) =>
    incidentRows(f.phase ? [row(b, c)] : [], roster, incident);
  f.response = (rows, joints) => {
    if (!f.phase) {
      assert.equal(rows.length, 0);
      assert.deepEqual(joints, [link]);
      f.phase = 1;
      a.state.angularVelocity.z = b.state.angularVelocity.z = -0.5;
      a.state.predictedOrientation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        -0.02,
      );
      b.state.predictedOrientation.copy(a.state.predictedOrientation);
      b.state.predictedPosition
        .set(1, 0, 0)
        .applyQuaternion(b.state.predictedOrientation);
      f.change(a);
      f.change(b);
      assert.ok(
        buildJointConstraints([link]).every(
          (constraint) => !constraint.unilateral,
        ),
      );
      return result(rows, 0, { positiveJointImpulse: true });
    }
    return result(rows);
  };
  f.run();
  assert.equal(f.solves.length, 2);
  assert.ok(labels(f.solves[1]).includes("b/c"));
  assert.deepEqual(f.solves[1].joints, [link]);
});

test("a bilateral joint residual without geometry or an active authored limit never enters the normal solve", () => {
  const parent = body("parent"),
    child = body("child", 1);
  const f = fixture([parent, child]);
  f.joints = [joint(parent, child)];
  child.state.velocity.x = 2;
  f.world = () => [];
  const constraints = buildJointConstraints(f.joints);
  assert.equal(constraints.length, 3);
  assert.ok(constraints.every((constraint) => !constraint.unilateral));
  assert.ok(
    constraints.some((constraint) => Math.abs(constraint.rhs) > 0),
    "the bilateral residual is nonzero",
  );
  assert.deepEqual(f.run(), []);
  assert.equal(f.solves.length, 0);
  assert.equal(f.host.diagnostics.responseSolves ?? 0, 0);
  assert.equal(f.host.diagnostics.retryRounds ?? 0, 0);
  assert.equal(f.host.diagnostics.retryExhaustions ?? 0, 0);
});

test("successful local impulses do not use the three-failure cap or recollect an unrelated component", () => {
  const a = body("a"),
    b = body("b", 1),
    remote = body("remote", 100);
  const f = fixture([a, b, remote]);
  f.pairsFor = (roster, incident) =>
    incidentRows([row(a, b)], roster, incident);
  let activeSolves = 0;
  f.response = (rows) =>
    rows.some((contact) => contact.b === b)
      ? result(rows, ++activeSolves <= 4 ? 1 : 0)
      : result(rows);
  f.run();
  assert.equal(activeSolves, 5);
  assert.equal(f.worlds.filter((item) => item === remote).length, 1);
  assert.equal(
    f.solves.filter((solve) => labels(solve).includes("remote/world")).length,
    1,
  );
  assert.equal(f.host.diagnostics.retryExhaustions ?? 0, 0);
});

test("stable zero response terminates once while repeated positive stress retains thirty local attempts", () => {
  const zero = fixture([body("zero")]);
  zero.run();
  assert.equal(zero.solves.length, 1);
  assert.equal(zero.host.diagnostics.retryRounds ?? 0, 0);
  assert.equal(zero.host.diagnostics.retryExhaustions ?? 0, 0);
  const positive = fixture([body("positive")]);
  positive.response = (rows) => result(rows, 1);
  assert.equal(positive.run().length, 30);
  assert.equal(positive.solves.length, 30);
  assert.equal(positive.host.diagnostics.retryRounds, 29);
  assert.equal(positive.host.diagnostics.retryExhaustions, 1);
});

test("only explicit reported failure consumes the three-failure budget", () => {
  const f = fixture([body("failure")]);
  f.response = (rows) =>
    result(rows, 0, { rejected: true, reportedFailure: true });
  f.run();
  assert.equal(f.solves.length, 3);
  assert.equal(f.host.diagnostics.retryExhaustions, 1);
});

test("a world epoch change revisits an earlier completed component", () => {
  const a = body("a"),
    b = body("b", 1);
  const f = fixture([a, b]);
  f.world = (item) => [row(item, undefined, `${f.phase}-${item.name}`)];
  f.response = (rows) => {
    if (!f.phase && rows[0].a === b) {
      f.phase = 1;
      f.version = {};
    }
    return result(rows);
  };
  f.run();
  assert.ok(f.solves.some((solve) => labels(solve).includes("0-a")));
  assert.ok(f.solves.some((solve) => labels(solve).includes("1-a")));
  assert.equal(f.host.diagnostics.traversalRestarts, 1);
});

test("an input-only fixed-collider change rediscovers its affected moving neighbor", () => {
  const a = body("a"),
    fixed = body("fixed", 100, true);
  const f = fixture([a, fixed]);
  f.pairsFor = (roster, incident) =>
    incidentRows(f.phase ? [row(a, fixed)] : [], roster, incident);
  f.response = (rows) => {
    if (!f.phase) {
      f.phase = 1;
      fixed.state.position.x = 0;
      f.change(fixed);
    }
    return result(rows);
  };
  f.run();
  assert.ok(
    f.solves.some((solve) => labels(solve).includes("a/fixed")),
    "a fixed-body input change must rediscover neighbors without requiring a world epoch or positive impulse",
  );
});

test("shared rigid state aliases join one response component", () => {
  const a = body("a"),
    alias = body("alias", 10);
  alias.state = a.state;
  const f = fixture([a, alias]);
  f.run();
  assert.equal(f.solves.length, 1);
  assert.deepEqual(labels(f.solves[0]), ["a/world", "alias/world"]);
});

test("children share their actual external anchor without joining distinct world identities", () => {
  const anchor = body("anchor", 0, true),
    otherAnchor = body("otherAnchor", 0, true);
  const a = body("a"),
    b = body("b", 1),
    c = body("c", 2);
  const f = fixture([a, b, c]);
  f.joints = [joint(anchor, a), joint(anchor, b), joint(otherAnchor, c)];
  f.run();
  assert.equal(f.solves.length, 2);
  assert.deepEqual(labels(f.solves[0]), ["a/world", "b/world"]);
  assert.deepEqual(labels(f.solves[1]), ["c/world"]);
  assert.equal(f.solves[0].joints.length, 2);
  assert.equal(f.solves[1].joints.length, 1);
});

test("certified unchanged world collection and pure empty preparation avoid redundant input scans", () => {
  const make = (certified) => {
    const f = fixture([body("a"), body("b", 1), body("c", 2)]);
    f.world = () => [];
    if (certified) {
      const epoch = {};
      f.host.worldCollectionVersion = () => epoch;
      f.host.emptyPreparationIsPure = true;
    }
    f.run();
    return f;
  };
  const ordinary = make(false),
    certified = make(true);
  assert.equal(
    certified.host.diagnostics.inputScans,
    1,
    "only the initial roster scan is needed for certified empty work",
  );
  assert.ok(
    ordinary.host.diagnostics.inputScans >
      certified.host.diagnostics.inputScans,
  );
  assert.equal(certified.worlds.length, ordinary.worlds.length);
  assert.equal(certified.pairs.length, ordinary.pairs.length);
  assert.equal(certified.solves.length, 0);
  assert.equal(ordinary.solves.length, 0);
});

for (const certified of [true, false])
  test(`${certified ? "changed world-collection epoch" : "unknown world producer fallback"} discards stale rows and rediscovers mutated/admitted bodies in the same collection`, () => {
    const a = body("a"),
      b = body("b", 1),
      admitted = body("admitted", 2);
    const f = fixture([a, b]);
    let collectionEpoch = {};
    if (certified) {
      f.host.worldCollectionVersion = () => collectionEpoch;
      f.host.emptyPreparationIsPure = true;
    }
    f.world = (item) => {
      if (item === a && !f.phase) {
        f.phase = 1;
        a.state.position.x = 0.25;
        f.change(a);
        f.bodies.push(admitted);
        collectionEpoch = {};
        return [row(a, undefined, "stale-world")];
      }
      return [row(item, undefined, `fresh-${item.name}`)];
    };
    f.pairsFor = (roster, incident) =>
      incidentRows(
        f.phase ? [row(a, admitted, "fresh-pair")] : [],
        roster,
        incident,
      );
    f.run();
    assert.ok(f.solves.length > 0);
    assert.ok(
      f.solves.every((solve) => !labels(solve).includes("stale-world")),
    );
    assert.ok(labels(f.solves[0]).includes("fresh-pair"));
    assert.ok(labels(f.solves[0]).includes("fresh-admitted"));
    assert.ok(
      f.pairs.some(
        (query) => query.incident.has(a) && query.roster.includes(admitted),
      ),
    );
    assert.ok(
      f.predictions.some(
        (prediction) =>
          prediction.changed && prediction.roster.includes(admitted),
      ),
    );
    assert.ok(
      f.host.diagnostics.inputScans > 1,
      "mutation requires input inspection despite otherwise certified collection",
    );
  });

test("pure empty-input preparation does not certify a nonempty batch filtered to empty after mutation", () => {
  const a = body("a");
  const f = fixture([a]);
  const collectionEpoch = {};
  f.host.worldCollectionVersion = () => collectionEpoch;
  f.host.emptyPreparationIsPure = true;
  f.world = () => [row(a, undefined, f.phase ? "fresh-world" : "stale-world")];
  f.preparation = (rows) => {
    if (!f.phase && rows.length) {
      f.phase = 1;
      a.properties.mass = 2;
      f.change(a);
      return [];
    }
    return rows;
  };
  f.run();
  assert.equal(
    f.solves.length,
    1,
    "nonempty preparation must inspect mutation even if its output is empty",
  );
  assert.deepEqual(labels(f.solves[0]), ["fresh-world"]);
});

test("hierarchy traversal uses OLD root X when a child lies left of its parent", () => {
  const child = body("child", -10),
    parent = body("parent", 10),
    middle = body("middle", 0);
  const f = fixture([child, parent, middle]);
  f.joints = [joint(parent, child)];
  f.run();
  assert.equal(f.solves.length, 2);
  assert.deepEqual(labels(f.solves[0]), ["middle/world"]);
  assert.deepEqual(
    new Set(labels(f.solves[1])),
    new Set(["parent/world", "child/world"]),
  );
});
