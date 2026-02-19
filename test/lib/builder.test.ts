import { describe, it, expect } from "bun:test";
import { copyDef, emptyDef, isProvideOptions, parseArgs, pushEntry } from "../../src/lib/builder";

describe("builder", () => {
	describe("emptyDef()", () => {
		it("creates a definition with empty arrays", () => {
			const def = emptyDef();
			expect(def.providers).toEqual([]);
			expect(def.loadCallbacks).toEqual([]);
			expect(def.unloadCallbacks).toEqual([]);
			expect(def.uses).toEqual([]);
		});
	});

	describe("copyDef()", () => {
		it("creates a shallow copy with independent arrays", () => {
			const original = emptyDef();
			const copy = copyDef(original);
			copy.providers.push({ kind: "decorator", key: "x", value: 1, scope: "local" });
			expect(original.providers).toEqual([]);
			expect(copy.providers).toHaveLength(1);
		});
	});

	describe("isProvideOptions()", () => {
		it("returns true for { scope: 'global' }", () => {
			expect(isProvideOptions({ scope: "global" })).toBe(true);
		});

		it("returns true for { scope: 'local' }", () => {
			expect(isProvideOptions({ scope: "local" })).toBe(true);
		});

		it("returns true for { kind: 'decorator' }", () => {
			expect(isProvideOptions({ kind: "decorator" })).toBe(true);
		});

		it("returns true for { kind: 'store' }", () => {
			expect(isProvideOptions({ kind: "store" })).toBe(true);
		});

		it("returns true for { mode: 'override' }", () => {
			expect(isProvideOptions({ mode: "override" })).toBe(true);
		});

		it("returns false for null", () => {
			expect(isProvideOptions(null)).toBe(false);
		});

		it("returns false for a string", () => {
			expect(isProvideOptions("global")).toBe(false);
		});

		it("returns false for an array", () => {
			expect(isProvideOptions(["global"])).toBe(false);
		});

		it("returns false for { scope: 'invalid' }", () => {
			expect(isProvideOptions({ scope: "invalid" })).toBe(false);
		});

		it("returns false for { scope: 'scoped' } (removed scope)", () => {
			expect(isProvideOptions({ scope: "scoped" })).toBe(false);
		});

		it("returns false for an arbitrary object", () => {
			expect(isProvideOptions({ foo: "bar" })).toBe(false);
		});
	});

	describe("parseArgs()", () => {
		it("parses (key, value) form for decorator", () => {
			const result = parseArgs(["name", "value"], "decorator");
			expect(result.entries).toEqual([["name", "value"]]);
			expect(result.config.kind).toBe("decorator");
			expect(result.config.scope).toBe("local");
			expect(result.config.mode).toBe("append");
			expect(result.isObjectForm).toBe(false);
		});

		it("parses (object) form for store", () => {
			const result = parseArgs([{ a: 1, b: 2 }], "store");
			expect(result.entries).toEqual([["a", 1], ["b", 2]]);
			expect(result.config.kind).toBe("store");
			expect(result.isObjectForm).toBe(true);
		});

		it("parses (key, value, options) form", () => {
			const result = parseArgs(["x", 1, { scope: "global" }], "decorator");
			expect(result.config.scope).toBe("global");
		});

		it("throws for provide() without options", () => {
			expect(() => parseArgs(["x", 1], "provide")).toThrow(/requires options/);
		});
	});

	describe("pushEntry()", () => {
		it("pushes a provider entry onto the definition", () => {
			const def = emptyDef();
			pushEntry([], def, "x", 42, { kind: "decorator", scope: "local", mode: "append" }, false);
			expect(def.providers).toHaveLength(1);
			expect(def.providers[0]?.key).toBe("x");
			expect(def.providers[0]?.value).toBe(42);
		});

		it("throws on reserved key 'decorator' for decorator kind", () => {
			const def = emptyDef();
			expect(() =>
				pushEntry([], def, "decorator", 1, { kind: "decorator", scope: "local", mode: "append" }, false),
			).toThrow(/reserved key/);
		});

		it("throws on reserved key 'store' for store kind", () => {
			const def = emptyDef();
			expect(() =>
				pushEntry([], def, "store", 1, { kind: "store", scope: "local", mode: "append" }, false),
			).toThrow(/reserved key/);
		});

		it("throws on duplicate key in append mode", () => {
			const existing = [{ kind: "decorator" as const, key: "x", value: 1, scope: "local" as const }];
			const def = emptyDef();
			expect(() =>
				pushEntry(existing, def, "x", 2, { kind: "decorator", scope: "local", mode: "append" }, false),
			).toThrow(/already defined/);
		});

		it("detects factory functions when forceStatic is false", () => {
			const def = emptyDef();
			pushEntry([], def, "fn", () => 42, { kind: "decorator", scope: "local", mode: "append" }, false);
			expect(def.providers[0]?.isFactory).toBe(true);
		});

		it("treats functions as static when forceStatic is true", () => {
			const def = emptyDef();
			pushEntry([], def, "fn", () => 42, { kind: "decorator", scope: "local", mode: "append" }, true);
			expect(def.providers[0]?.isFactory).toBe(false);
		});

		it("sets scope on the entry", () => {
			const def = emptyDef();
			pushEntry([], def, "x", 1, { kind: "decorator", scope: "global", mode: "append" }, false);
			expect(def.providers[0]?.scope).toBe("global");
		});
	});
});
