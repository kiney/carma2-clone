# C2 authored abstract shrapnel

Installed HW `DoShrapnel` at `0x4eb660` dispatches the abstract branch at
`0x4eb6ba`. At `0x4eb6ef–0x4eb717`, force is
Float32(sqrt(Float32(effect magnitude)) \* Float32(10)). Materials are the
authored alternatives at spec+0x38/+0x3c. The normal points to zero-filled
global `0x6aa088`. A missing incoming starting-velocity pointer selects the
installed vector `0x660148=(0,1,0)`, not a stationary vector.

Wrapper `0x4f88e0` passes null car pointers and the explicit material array to
the ordinary `0x4f8590` allocator. Consequently abstract pieces share the
30-slot FRAG4/FRAG5 pool, initialized axes/shears, insertion order and CRT
stream with collision fragments. They use the explicit-material .7 lift and
one material-choice draw, rather than the car-colour/M14 alternative branch.
The ordinary force<10 gate means an authored effect magnitude below1 emits
no fragments. Count is min(20,12*trunc(force*Float32(.1))).

The browser binds abstract specs at their ordered WAM/world connotation
outlet, after room/powerup enqueue and before awards/variables. Materials are
borrowed from the original scene material table; missing alternatives produce
a diagnostic instead of fabricated colours. Numerical tests cover the square
root/threshold/count, null owners, shared overwrite and material branch.
Original visibility/fog adaptation and other connotation debris classes remain
separate work. This is verified binary evidence and an independent port;
no proprietary fixtures or reference source are included.
