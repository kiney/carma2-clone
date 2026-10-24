/* Independent, optional Linux/i386 probe. Run through the hash-checking .mjs
 * driver. No original instructions or assets are embedded in this source.
 * The executable is opened O_RDONLY and copied into anonymous process memory.
 * Only that private copy receives clock/output stubs. See the award RE notes.
 * No libc/multilib runtime is required; gcc -m32 and Linux IA32 support suffice.
 */
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned char u8;

static int syscall3(int number, int a, int b, int c) {
    int result;
    __asm__ volatile("int $0x80" : "=a"(result)
                     : "a"(number), "b"(a), "c"(b), "d"(c) : "memory");
    return result;
}
static void text(const char *value, int length) {
    if (syscall3(4, 1, (int)value, length) != length)
        syscall3(1, 2, 0, 0);
}
static void number(int value) {
    char buffer[16];
    int length = 0;
    u32 magnitude = (u32)value;
    if (value < 0) { text("-", 1); magnitude = 0u - magnitude; }
    do { buffer[length++] = (char)('0' + magnitude % 10); magnitude /= 10; }
    while (magnitude);
    while (length) text(buffer + --length, 1);
}
static void zero(u8 *value, int length) {
    for (int i = 0; i < length; i++) value[i] = 0;
}
static int read_exact(int fd, void *destination, u32 length) {
    u32 done = 0;
    while (done < length) {
        int count = syscall3(3, fd, (int)destination + done, length - done);
        if (count <= 0) return 0;
        done += (u32)count;
    }
    return 1;
}

static u8 header[4096], car[0x1900];
static int load_private_image(const char *path) {
    int fd = syscall3(5, (int)path, 0, 0); /* O_RDONLY */
    if (fd < 0 || !read_exact(fd, header, sizeof(header))) return 0;
    int file_size = syscall3(19, fd, 0, 2);
    u32 pe = *(u32 *)(header + 0x3c);
    if (*(u16 *)header != 0x5a4d || pe > 3500 ||
        *(u32 *)(header + pe) != 0x4550 ||
        *(u16 *)(header + pe + 4) != 0x14c ||
        *(u16 *)(header + pe + 6) != 3 ||
        *(u16 *)(header + pe + 20) != 224) return 0;
    u32 optional = pe + 24;
    u32 base = *(u32 *)(header + optional + 28);
    u32 size = *(u32 *)(header + optional + 56);
    if (*(u16 *)(header + optional) != 0x10b || base != 0x400000 ||
        size != 0x39f000 || file_size <= 0) return 0;
    /* MAP_PRIVATE|MAP_FIXED|MAP_ANONYMOUS, PROT_READ|WRITE|EXEC.
     * Our freestanding ELF lives at 0x08048000, outside this fixed PE image.
     * The Node driver verifies the complete original-file SHA256 first.
     */
    u32 arguments[] = {base, size, 7, 0x32, 0xffffffff, 0};
    if ((u32)syscall3(90, (int)arguments, 0, 0) != base) return 0;
    u32 section = optional + 224;
    for (u32 i = 0; i < 3; i++) {
        u8 *entry = header + section + 40 * i;
        u32 va = *(u32 *)(entry + 12), length = *(u32 *)(entry + 16);
        u32 offset = *(u32 *)(entry + 20);
        if (va < 0x1000 || va > size || length > size - va ||
            offset > (u32)file_size || length > (u32)file_size - offset ||
            syscall3(19, fd, offset, 0) < 0 ||
            !read_exact(fd, (void *)(base + va), length)) return 0;
    }
    syscall3(6, fd, 0, 0);
    return 1;
}

/* These are scalar fixtures, not copied car records or executable bytes.
 * First18 cover every authored softness in the inspected installation.
 * Last12 exercise storage, conversion, signed wrap, zero and infinity.
 */
static float softness[] = {
    .05f, .1f, .125f, .13f, .2f, .25f, .3f, .35f, .4f, .46f,
    .5f, .6f, .7f, .8f, .999f, 1.f, 1.4f, 1.5f,
    1.8073922282301278f, 1.1832159566199232f, .9438798074485389f,
    .8082903768654761f, .7181848464596079f,
    .001f, .0001f, 1e-8f, 1e-12f, 0x1p-149f, 0.f, __builtin_inff()
};
static int waste_award(float value, int base) {
    int result;
    *(float *)(car + 0x18d0) = value;
    *(int *)0x7590c0 = 0;
    *(int *)0x74b550 = base;
    void *function = (void *)0x440e99;
    __asm__ volatile("call *%2" : "=c"(result)
                     : "D"(car), "r"(function)
                     : "eax", "edx", "memory", "cc", "st", "st(1)");
    return result;
}

static u8 ped[0x100], cache[0x100], physics[0x200], actor[0x100];
static u8 form[0x100], instance[0x100], state[0x100], slots[0x20], simple[0x200];
static int captured_credits, captured_seconds, captured_fancy;
static void capture(u32 address, int *output) {
    /* Self-authored MOV [absolute output],ECX; RET capture stub. */
    u8 *code = (u8 *)address;
    code[0] = 0x89; code[1] = 0x0d;
    *(int *)(code + 2) = (int)output;
    code[6] = 0xc3;
}
static void pedestrian_case(int which) {
    zero(car, sizeof(car)); zero(ped, sizeof(ped)); zero(cache, sizeof(cache));
    zero(physics, sizeof(physics)); zero(actor, sizeof(actor));
    zero(form, sizeof(form)); zero(instance, sizeof(instance));
    zero(state, sizeof(state)); zero(slots, sizeof(slots)); zero(simple, sizeof(simple));
    /* Synthetic native pointer chain and identity physics actor. */
    *(int *)ped = (int)instance; *(int *)instance = (int)form;
    *(int *)(form + 0x28) = (int)state; *(int *)(state + 0x38) = (int)slots;
    *(int *)(slots + 4) = (int)simple;
    *(int *)(ped + 0xc) = (int)cache; *(int *)(ped + 0x10) = 6;
    *(int *)(cache + 0xc0) = (int)car; *(int *)(car + 0xc) = 8;
    *(int *)(car + 8) = (int)physics; *(int *)physics = (int)actor;
    *(float *)(actor + 0x2c) = 1; *(float *)(actor + 0x3c) = 1;
    *(float *)(actor + 0x4c) = 1; *(float *)(ped + 0x24) = -1;
    *(float *)(physics + 0x1b0) = -1;
    float height = 0;
    switch (which) {
    case 0: height = 1.00000001f; break;
    case 1: height = 1.0000001192092896f; break;
    case 2: *(float *)(physics + 0x74) = 5.00000001f; break;
    case 3: *(float *)(physics + 0x74) = -5.000000476837158f; break;
    case 4: *(float *)(physics + 0x7c) = -5.00000001f; break;
    case 5: *(float *)(physics + 0x7c) = 5.000000476837158f; break;
    case 6: *(float *)(actor + 0x3c) = .10000000139011612f; break;
    case 7: *(float *)(actor + 0x3c) = .09999999403953552f; break;
    case 8: *(float *)(actor + 0x54) = .05000000084505806f; break;
    case 9: *(float *)(actor + 0x54) = .05000000447034836f; break;
    case 10: *(float *)(simple + 0x68) = 1; *(float *)(simple + 0x6c) = .9999999999f; break;
    case 11: *(float *)(simple + 0x1b4) = 1; *(float *)(simple + 0x1b8) = .9999999999f; break;
    case 12: *(float *)(simple + 0x68) = 1; *(float *)(simple + 0x6c) = .9999999403953552f; break;
    case 13: *(float *)(ped + 0x1c) = .4999999999f; *(float *)(physics + 0x1a8) = 2; break;
    case 14: *(float *)(ped + 0x1c) = .5f; *(float *)(physics + 0x1a8) = 1.0000000001f; break;
    case 15: *(float *)(ped + 0x1c) = .5f; *(float *)(physics + 0x1a8) = 1.0000001192092896f; break;
    case 16: *(float *)(ped + 0x1c) = .5f; *(float *)(physics + 0x78) = 600.0000001f; break;
    case 17: *(float *)(ped + 0x1c) = .5f; *(float *)(physics + 0x78) = 600.0000610351562f; break;
    case 18: *(float *)(ped + 0x24) = 0; *(float *)(physics + 0x1b0) = 1; break;
    case 19: *(float *)(ped + 0x24) = 0x1p-149f; *(float *)(physics + 0x1b0) = 1; break;
    case 20: *(float *)(physics + 0x74) = 6; break;
    case 21: *(float *)(actor + 0x54) = .0625f; *(float *)(ped + 0x20) = .012499998323619366f; break;
    }
    *(int *)0x69eaa8 = 0; *(int *)0x69a374 = 0; *(int *)0x69a388 = 300;
    *(int *)0x6928f8 = 15; *(int *)0x7590c0 = 0;
    captured_credits = -999; captured_seconds = -999; captured_fancy = -1;
    void *function = (void *)0x4cd010;
    __asm__ volatile("push %2; call *%1" :
                     : "c"(ped), "r"(function), "m"(height)
                     : "eax", "edx", "memory", "cc", "st", "st(1)");
    text("PED ", 4); number(which); text(" ", 1); number(captured_credits);
    text(" ", 1); number(captured_fancy); text(" ", 1); number(captured_seconds);
    text("\n", 1);
}

static u8 race[0x200];
/* state, now, start, credits, timerMs, display, rate, lastRattle,
 * snapshot, completion. Unsigned timestamps occupy the native DWORD fields.
 */
static int payouts[][10] = {
    {1, 499, 0, 1000, 2999, 0, 15, 0, 1000, 120},
    {1, 500, 0, 0x7fffffff, 2999, 0, 15, 0, 0x7fffffff, 120},
    {1, 1032, 2000, -500, 2999, 0, 15, 0, -500, 120},
    {2, 1999, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {2, 2000, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {2, 1984, -16, 1120, 2999, 0, 15, 0, 1000, 120},
    {3, 15, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {3, 16, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {3, 31, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {3, -1, 0, 1120, 2999, 0, 15, 0, 1000, 120},
    {3, 16, 0, 1120, 2000, 0x7fffffff, 15, 0, 1000, 120},
    {3, 16, 0, 1120, 0, 30, 15, 0, 1000, 120},
    {4, 999, 0, 1120, 0, 30, 15, 0, 1000, 120},
    {4, 1000, 0, 1120, 0, 30, 15, 0, 1000, 120},
    {5, 15, 0, 0x7fffffff, 0, 30, 15, 0, 0x7fffffff, 120},
    {5, 16, 0, 0x7fffffff, 0, 30, 15, 0, 0x7fffffff, 120},
    {5, 16, 0, 1000, 0, 30, 0x10000000, 0, 1000, 120},
    {5, -1, 0, 0x7fffffff, 0, 1000000000, 15, 0, 0x7fffffff, 120},
    {5, 16, 0, 1120, 0, 0, 15, 0, 1000, 120},
    {6, 1999, 0, 1150, 0, 0, 15, 0, -500, 120},
    {6, 2000, 0, 1150, 0, 0, 15, 0, -500, 120},
    {6, 2000, 0, 1150, 0x7fffffff, 0, 0x7fffffff, 0, 0x7fffffff, 120}
};
static void payout_case(int index) {
    int *fixture = payouts[index];
    zero(race, sizeof(race));
    *(int *)0x75f958 = (int)race;
    *(int *)0x7590c0 = 0;
    *(int *)0x7590a0 = fixture[8];
    *(int *)0x75f408 = fixture[4];
    *(int *)0x75f410 = fixture[6];
    *(int *)0x75f8d8 = fixture[9];
    void *calculation = (void *)0x493aca;
    int reason = 0;
    __asm__ volatile("call *%1" : "+c"(reason) : "r"(calculation)
                     : "eax", "edx", "esi", "memory", "cc");
    int total = *(int *)0x68ae04;
    *(int *)0x7590a0 = fixture[3];
    *(int *)0x75f408 = fixture[4];
    *(int *)0x68ae10 = fixture[5];
    *(int *)0x68aea8 = fixture[7];
    *(int *)0x68ae14 = fixture[0];
    *(int *)0x68ae18 = fixture[2];
    *(int *)0x74b7cc = 10000;
    *(int *)0x68adec = fixture[9];
    *(int *)0x514611 = fixture[1];
    void *presentation = (void *)0x49348c;
    __asm__ volatile("mov $1,%%esi; call *%0" : : "m"(presentation), "b"(0)
                     : "eax", "ecx", "edx", "esi", "edi", "ebp", "memory", "cc");
    if (*(int *)0x74b7cc == 1) {
        void *settlement = (void *)0x493c4d;
        int snapshot = fixture[8];
        __asm__ volatile("call *%1" : "+a"(snapshot) : "r"(settlement)
                         : "ecx", "memory", "cc");
    }
    text("PAYOUT ", 7); number(index); text(" ", 1); number(total);
    u32 outputs[] = {0x7590a0, 0x68ae14, 0x75f408, 0x68ae10,
                     0x68aea8, 0x68ae18, 0x74b7cc};
    for (u32 i = 0; i < sizeof(outputs) / sizeof(outputs[0]); i++) {
        text(" ", 1); number(*(int *)outputs[i]);
    }
    text("\n", 1);
}

/* Preserve the kernel's argv stack before entering ordinary compiled C. */
__asm__(".global _start\n_start:\nmov %esp,%eax\npush %eax\ncall probe_main\n");
void probe_main(u32 *stack) {
    if (stack[0] != 2 || !load_private_image((const char *)stack[2])) {
        text("Invalid or unreadable installed PE image\n", 41);
        syscall3(1, 1, 0, 0);
        __builtin_unreachable();
    }
    /* Isolate the waste arithmetic before its first external output. */
    *(u8 *)0x440ed7 = 0xc3;
    __asm__ volatile("fninit");
    ((void (*)(void))0x5798e0)();
    u16 control;
    __asm__ volatile("fnstcw %0" : "=m"(control));
    text("CW ", 3); number(control); text("\n", 1);
    capture(0x44baa0, &captured_credits);
    capture(0x44baf0, &captured_seconds);
    capture(0x44ac60, &captured_fancy);
    /* Self-authored deterministic clock: MOV EAX,2000; RET. */
    u8 *clock = (u8 *)0x514610;
    clock[0] = 0xb8; *(int *)(clock + 1) = 2000; clock[5] = 0xc3;
    for (int i = 0; i < 22; i++) pedestrian_case(i);
    for (int i = 0; i < 30; i++) {
        for (int skill = 0; skill < 3; skill++) {
            int base = 3000 - skill * 1000;
            text("WASTE ", 6); number(i); text(" ", 1); number(base);
            text(" ", 1); number(waste_award(softness[i], base)); text("\n", 1);
        }
    }
    text("MAX ", 4); number(waste_award(.7f, 0x7fffffff)); text("\n", 1);
    /* Return before external finalization calls. Bypass only the state1
     * formatting/audio prefix; retain all gates, arithmetic and state writes.
     */
    *(u8 *)0x493b2a = 0xc3;
    *(u8 *)0x493c5b = 0xc3;
    *(u8 *)0x493736 = 0xc3;
    *(u8 *)0x4935d4 = 0xc3;
    *(u8 *)0x4936c8 = 0xc3;
    *(u8 *)0x4934ba = 0xe9;
    *(int *)0x4934bb = 0x4934fc - 0x4934bf;
    for (u32 i = 0; i < sizeof(payouts) / sizeof(payouts[0]); i++) payout_case(i);
    syscall3(1, 0, 0, 0);
    __builtin_unreachable();
}
