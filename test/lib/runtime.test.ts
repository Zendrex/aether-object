import { describe, expect, it } from "bun:test";
import { buildTree, GLOBAL_SCOPE, initModule, lifecycleOrder, useScopeId } from "../../src/lib/runtime";
import type { ModuleDefinition } from "../../src/lib/types";

function makeDef(overrides?: Partial<ModuleDefinition>): ModuleDefinition {
	return {
		providers: [],
		loadCallbacks: [],
		unloadCallbacks: [],
		uses: [],
		...overrides,
	};
}

describe("runtime", () => {
	describe("useScopeId()", () => {
		it("returns GLOBAL_SCOPE for undefined scope", () => {
			expect(useScopeId("test")).toBe(GLOBAL_SCOPE);
		});

		it("returns GLOBAL_SCOPE for 'global' scope", () => {
			expect(useScopeId("test", "global")).toBe(GLOBAL_SCOPE);
		});

		it("returns a unique symbol for 'local' scope", () => {
			const a = useScopeId("test", "local");
			const b = useScopeId("test", "local");
			expect(typeof a).toBe("symbol");
			expect(a).not.toBe(b);
		});

		it("returns custom string scope as-is", () => {
			expect(useScopeId("test", "my-scope")).toBe("my-scope");
		});
	});

	describe("buildTree()", () => {
		it("builds a single-node tree", () => {
			const def = makeDef();
			const cache = new WeakMap();
			const tree = buildTree("root", def, cache, Symbol("root"));
			expect(tree.name).toBe("root");
			expect(tree.children).toEqual([]);
			expect(tree.initialized).toBe(false);
		});

		it("builds a tree with children", () => {
			const childDef = makeDef();
			const parentDef = makeDef({
				uses: [{ name: "child", def: childDef, scopeId: GLOBAL_SCOPE }],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			expect(tree.children).toHaveLength(1);
			expect(tree.children[0]?.name).toBe("child");
		});

		it("caches shared plugin instances by (def, scopeId)", () => {
			const sharedDef = makeDef();
			const parentDef = makeDef({
				uses: [
					{ name: "shared", def: sharedDef, scopeId: GLOBAL_SCOPE },
					{ name: "shared", def: sharedDef, scopeId: GLOBAL_SCOPE },
				],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			expect(tree.children[0]).toBe(tree.children[1]);
		});

		it("creates separate instances for different scopeIds", () => {
			const sharedDef = makeDef();
			const parentDef = makeDef({
				uses: [
					{ name: "a", def: sharedDef, scopeId: Symbol("a") },
					{ name: "b", def: sharedDef, scopeId: Symbol("b") },
				],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			expect(tree.children[0]).not.toBe(tree.children[1]);
		});
	});

	describe("initModule()", () => {
		it("initializes a module with local providers", () => {
			const def = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 42, scope: "local" }],
			});
			const cache = new WeakMap();
			const ctx = buildTree("test", def, cache, Symbol("root"));
			initModule(ctx);
			expect(ctx.initialized).toBe(true);
			expect(ctx.providers.decorator.x).toBe(42);
		});

		it("does not export local providers", () => {
			const def = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 42, scope: "local" }],
			});
			const cache = new WeakMap();
			const ctx = buildTree("test", def, cache, Symbol("root"));
			initModule(ctx);
			expect(ctx.exportedProviders.decorator.x).toBeUndefined();
		});

		it("exports global providers", () => {
			const def = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 42, scope: "global" }],
			});
			const cache = new WeakMap();
			const ctx = buildTree("test", def, cache, Symbol("root"));
			initModule(ctx);
			expect(ctx.exportedProviders.decorator.x).toBe(42);
			expect(ctx.propagatedProviders.decorator.x).toBe(42);
		});

		it("resolves factory functions for decorators", () => {
			const def = makeDef({
				providers: [
					{ kind: "decorator", key: "base", value: 10, scope: "local" },
					// biome-ignore lint/suspicious/noExplicitAny: test factory needs dynamic context access
					{ kind: "decorator", key: "doubled", value: (ctx: any) => ctx.base * 2, scope: "local", isFactory: true },
				],
			});
			const cache = new WeakMap();
			const ctx = buildTree("test", def, cache, Symbol("root"));
			initModule(ctx);
			expect(ctx.providers.decorator.doubled).toBe(20);
		});

		it("imports exported providers from children", () => {
			const childDef = makeDef({
				providers: [{ kind: "decorator", key: "fromChild", value: "hello", scope: "global" }],
			});
			const parentDef = makeDef({
				uses: [{ name: "child", def: childDef, transitive: true }],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			// Initialize children first (post-order)
			for (const child of tree.children) {
				initModule(child);
			}
			initModule(tree);
			expect(tree.providers.decorator.fromChild).toBe("hello");
		});

		it("throws on provider collision from children", () => {
			const child1 = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 1, scope: "global" }],
			});
			const child2 = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 2, scope: "global" }],
			});
			const parentDef = makeDef({
				uses: [
					{ name: "c1", def: child1, transitive: true },
					{ name: "c2", def: child2, transitive: true },
				],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			for (const child of tree.children) {
				initModule(child);
			}
			expect(() => initModule(tree)).toThrow(/collision/);
		});

		it("does not propagate when edge.transitive is false", () => {
			const childDef = makeDef({
				providers: [{ kind: "decorator", key: "x", value: 1, scope: "global" }],
			});
			const middleDef = makeDef({
				uses: [{ name: "child", def: childDef, transitive: false }],
			});
			const outerDef = makeDef({
				uses: [{ name: "middle", def: middleDef, transitive: true }],
			});
			const cache = new WeakMap();
			const tree = buildTree("outer", outerDef, cache, Symbol("root"));
			const order = lifecycleOrder(tree);
			for (const ctx of order) {
				initModule(ctx);
			}
			// x visible to middle (imported from child), but NOT propagated to outer
			expect(tree.providers.decorator.x).toBeUndefined();
		});

		it("builds callbackCtx with decorator top-level and namespaces", () => {
			const def = makeDef({
				providers: [
					{ kind: "decorator", key: "log", value: "logger", scope: "local" },
					{ kind: "store", key: "data", value: [1, 2], scope: "local" },
				],
			});
			const cache = new WeakMap();
			const ctx = buildTree("test", def, cache, Symbol("root"));
			initModule(ctx);
			// biome-ignore lint/suspicious/noExplicitAny: test assertion needs untyped access to callbackCtx
			const cbCtx = ctx.callbackCtx as any;
			expect(cbCtx.log).toBe("logger");
			expect(cbCtx.decorator.log).toBe("logger");
			expect(cbCtx.store.data).toEqual([1, 2]);
		});
	});

	describe("lifecycleOrder()", () => {
		it("returns single node for leaf module", () => {
			const def = makeDef();
			const cache = new WeakMap();
			const tree = buildTree("test", def, cache, Symbol("root"));
			const order = lifecycleOrder(tree);
			expect(order).toHaveLength(1);
			expect(order[0]?.name).toBe("test");
		});

		it("returns children before parent (post-order DFS)", () => {
			const childDef = makeDef();
			const parentDef = makeDef({
				uses: [{ name: "child", def: childDef }],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			const order = lifecycleOrder(tree);
			expect(order.map((n) => n.name)).toEqual(["child", "parent"]);
		});

		it("visits shared nodes only once", () => {
			const sharedDef = makeDef();
			const parentDef = makeDef({
				uses: [
					{ name: "shared", def: sharedDef, scopeId: GLOBAL_SCOPE },
					{ name: "shared", def: sharedDef, scopeId: GLOBAL_SCOPE },
				],
			});
			const cache = new WeakMap();
			const tree = buildTree("parent", parentDef, cache, Symbol("root"));
			const order = lifecycleOrder(tree);
			expect(order).toHaveLength(2); // shared + parent, not shared + shared + parent
		});

		it("handles deep trees correctly", () => {
			const leaf = makeDef();
			const mid = makeDef({ uses: [{ name: "leaf", def: leaf }] });
			const root = makeDef({ uses: [{ name: "mid", def: mid }] });
			const cache = new WeakMap();
			const tree = buildTree("root", root, cache, Symbol("root"));
			const order = lifecycleOrder(tree);
			expect(order.map((n) => n.name)).toEqual(["leaf", "mid", "root"]);
		});
	});
});
