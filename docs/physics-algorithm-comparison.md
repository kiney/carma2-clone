# Physics algorithm comparison

Rows have stable numbers for discussion. Analysis date: 2026-10-16.
This is a source review and literature comparison; no engine behavior changed
and no additional load tests were run for this comparison.

The implementation combines established algorithms with C2-specific orchestration.
The first candidates to investigate are adaptive continuous collision detection
and incrementally maintained collision data. Replacing the impulse solver has
greater implications for crash behavior.

Complexities below are derived from the current implementation's loops, not
measured speedups. Unless stated otherwise, geometry costs concern one hull pair
and solver costs concern one coupled constraint group. Composite bodies and
repeated queries multiply this work.

Notation: **N** bodies; **V/E/F** vertices/edges/faces of similarly sized hulls;
**C** contact and joint constraint rows; **I** iterations;
**A ≈ F + E²** candidate separating axes.

| No.   | Problem                                    | Current algorithm and origin                                                                                                                                                     | Complexity and relevant properties                                                                                                                                                                                                                                         | Established alternatives                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Prevent penetration during movement        | **Custom hybrid:** sampled trajectories, feature CCD and SAT, followed by bisection.                                                                                             | Up to **128 motion intervals** per pair, followed by **18 refinement steps** when blocked. These multiply repeated geometry tests. Qualified existing overlaps can take an early exit.                                                                                     | **Conservative Advancement**, often using **GJK** distance queries: separation and conservative motion bounds determine safe progress adaptively. Iteration count depends on motion, geometry and tolerance. Rotation and existing-overlap semantics need appropriate handling. [Research](https://wwwx.cs.unc.edu/~geom/papers/documents/articles/2009/tang09.pdf)                                                                                           |
| **2** | Convex-hull overlap and penetration depth  | Established **Separating Axis Theorem (SAT)** with custom axis deduplication and early exits.                                                                                    | Worst case **O(A·V + A²)**. The quadratic term comes from linearly comparing proposed axes against previously accepted axes. An early separating axis can avoid most work.                                                                                                 | Test a **cached separating axis** first; alternatively **GJK**, with **EPA** for penetration depth. With a linear support-point search, GJK costs approximately **O(I·V)**. Iteration count and EPA work are geometry-dependent; these are not guaranteed faster for small hulls or equivalent to every existing depth query. [GJK research](https://ora.ox.ac.uk/objects/uuid%3A69c743d9-73de-4aff-8e6f-b4dd7c010907)                                        |
| **3** | Generate actual collision contacts         | **Native-informed feature CCD:** vertex/plane clipping and moving edge/edge intersection tests. Established geometric operations with C2-specific eligibility and ordering.      | Basic work **O(V·F + E²)**; extra face checks on edge hits give an upper bound **O(V·F + E²·F)** for solid hulls, plus contact reduction/sorting. Recollection repeats this work.                                                                                          | **Persistent contact/feature caches** and feature-level bounding hierarchies can avoid complete rediscovery in coherent states. Crush, repair and detachment must invalidate affected entries. Cached results must preserve native contact selection and callbacks. [Bullet contact cache](https://pybullet.org/Bullet/BulletFull/classbtPersistentManifold.html)                                                                                             |
| **4** | Discover potential body collision pairs    | Established **median-split AABB BVH**. Static data is reused; the moving tree is rebuilt per discovery phase. The world-face index already uses a related BVH within grid cells. | Moving-tree construction is **O(N·log²N)** when N denotes its entries; each call also validates the full supplied roster in **O(N)**. Output ordering adds **O(P·log P)** for P returned pairs. Dense overlap can still produce **O(N²)** candidates.                      | **Dynamic AABB trees**, incremental updates or BVH refitting. Individual updates are typically logarithmic in a favorable tree; query cost depends on visited nodes and output. Dense real overlaps remain expensive. [Dynamic tree documentation](https://box2d.org/documentation/group__tree.html)                                                                                                                                                          |
| **5** | Manage contact groups and response retries | **Custom native-informed local response orchestration:** repeated seed sorting, input comparisons and explicit set merging.                                                      | Sort comparisons may repeat joint-parent searches and roster-index lookups. Unweighted merging can move **O(N²)** memberships across a sequence of merges. These are bookkeeping costs; collision collection and solving must be added for each retry.                     | **Persistent simulation islands**, Union-Find, cached parent/index mappings and dirty worklists. Weighted Union-Find with path compression has amortized **O(α(N))** cost per operation. This improves bookkeeping without eliminating physically necessary retries; collection order and invalidation still matter. [Simulation islands](https://box2d.org/posts/2023/10/simulation-islands/), [Union-Find complexity](https://algs4.cs.princeton.edu/15uf/) |
| **6** | Compute contact and joint impulses         | Established **active-set complementarity solving** with dense partial-pivot Gaussian elimination; independently implemented, with projected coordinate-descent fallback.         | One dense solve is **O(C³)** with **O(C²)** storage. Repeated active-set passes cost **O(I·C³)**; the current iteration bound permits a theoretical **O(C⁵)** upper bound. The fallback permits up to 2000 **O(C²)** passes. These are bounds, not measured typical costs. | **Matrix-free Projected Gauss–Seidel / Sequential Impulses:** **O(C)** per iteration for fixed-size body constraints, often with warm starting. Alternatively reuse/update direct-solver factorizations. Iterative convergence and warm starting can change impulses and damage outcomes; factor reuse also needs numerical validation. [Solver comparison](https://box2d.org/posts/2024/02/solver2d/)                                                        |

## Priority suggested by current evidence

Investigate **rows 1 and 3**, together with incremental discovery in **row 4**,
before selecting a solver replacement in **row 6**. Row 5 offers bookkeeping
improvements but its orchestration function's exclusive self time was only
0.69% in the sampled profile; expensive descendants must be distinguished from
the loop itself.

In the [PERF-13 integration profile](perf13-integration-check.md), final pair
trajectory guards account for **14.39%** of sampled time. Local responses account
for **38.60%**, including world collection **13.03%**, pair collection **10.45%**
and solving **6.27%**. Those descendants are already included in 38.60% and must
not be added again. Geometry kernels are shared by collection and guarding.
The profile does not establish which theoretical worst case actually dominates.

## Code references

- Rows 1–2: `src/physics/pair-guard.ts`, `src/physics/geometry.ts`.
- Row 3: `sweepHullFeatures`, `sweepMovingEdges` and `sweepHullTriangle` in `src/physics/geometry.ts`.
- Row 4: `src/physics/body-broadphase.ts`, `src/world-face-index.ts`.
- Row 5: `src/physics/local-response.ts`.
- Row 6: `src/physics/contact.ts`, `src/physics/joint.ts`.
