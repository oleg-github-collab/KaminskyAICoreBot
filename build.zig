const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // --- SQLite C library ---
    const sqlite = b.addStaticLibrary(.{
        .name = "sqlite3",
        .target = target,
        .optimize = optimize,
    });
    sqlite.addCSourceFile(.{
        .file = b.path("libs/sqlite3.c"),
        .flags = &.{
            "-DSQLITE_DQS=0",
            "-DSQLITE_THREADSAFE=1",
            "-DSQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
            "-DSQLITE_ENABLE_FTS5",
            "-DSQLITE_ENABLE_JSON1",
        },
    });
    sqlite.linkLibC();

    // --- Main executable ---
    const exe = b.addExecutable(.{
        .name = "kaminsky-bot",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    // httpz dependency
    const httpz_dep = b.dependency("httpz", .{
        .target = target,
        .optimize = optimize,
    });
    exe.root_module.addImport("httpz", httpz_dep.module("httpz"));

    // SQLite C interop
    exe.addIncludePath(b.path("libs"));
    exe.linkLibrary(sqlite);
    exe.linkLibC();

    // Redis (hiredis) C library
    exe.linkSystemLibrary("hiredis");

    b.installArtifact(exe);

    // --- Run step ---
    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run the bot server");
    run_step.dependOn(&run_cmd.step);

    // --- Tests ---
    const unit_tests = b.addTest(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    unit_tests.root_module.addImport("httpz", httpz_dep.module("httpz"));
    unit_tests.addIncludePath(b.path("libs"));
    unit_tests.linkLibrary(sqlite);
    unit_tests.linkLibC();
    unit_tests.linkSystemLibrary("hiredis");

    const run_tests = b.addRunArtifact(unit_tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);
}
