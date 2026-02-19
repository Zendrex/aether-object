import { describe, it, expect, beforeEach } from "bun:test";
import { Aether } from "../../src/index.ts";

function createApp(name = "test") {
	return new Aether(name);
}

describe("Aether", () => {
	describe("constructor", () => {
		it("creates a named instance", () => {
			const app = createApp("myapp");
			expect(app.name).toBe("myapp");
		});

		it("starts as not running", () => {
			const app = createApp();
			expect(app.isRunning).toBe(false);
		});
	});

	describe("immutability", () => {
		it("decorate() returns a new instance", () => {
			const a = createApp();
			const b = a.decorate("x", 1);
			expect(a).not.toBe(b);
		});

		it("state() returns a new instance", () => {
			const a = createApp();
			const b = a.state("x", 1);
			expect(a).not.toBe(b);
		});

		it("onLoad() returns a new instance", () => {
			const a = createApp();
			const b = a.onLoad(() => {});
			expect(a).not.toBe(b);
		});

		it("use() returns a new instance", () => {
			const a = createApp();
			const plugin = new Aether("plugin");
			const b = a.use(plugin);
			expect(a).not.toBe(b);
		});
	});

	describe("decorate()", () => {
		it("registers a key-value decorator", async () => {
			const app = await createApp().decorate("greeting", "hello").start();
			expect(app.context.greeting).toBe("hello");
		});

		it("registers multiple decorators via object form", async () => {
			const app = await createApp().decorate({ a: 1, b: 2 }).start();
			expect(app.context.a).toBe(1);
			expect(app.context.b).toBe(2);
		});

		it("supports factory functions", async () => {
			const app = await createApp()
				.decorate("base", 10)
				.decorate("derived", (ctx) => ctx.base * 2)
				.start();
			expect(app.context.derived).toBe(20);
		});

		it("treats object-form values as static (not factories)", async () => {
			const fn = () => 42;
			const app = await createApp().decorate({ myFn: fn }).start();
			expect(app.context.myFn).toBe(fn);
		});

		it("throws on reserved key 'decorator'", () => {
			expect(() => createApp().decorate("decorator", 1)).toThrow(/reserved key/);
		});

		it("throws on duplicate key in append mode", () => {
			expect(() => createApp().decorate("x", 1).decorate("x", 2)).toThrow(/already defined/);
		});
	});

	describe("state()", () => {
		it("registers a key-value state", async () => {
			const app = await createApp().state("count", 0).start();
			expect(app.context.store.count).toBe(0);
		});

		it("registers multiple states via object form", async () => {
			const app = await createApp().state({ a: 1, b: 2 }).start();
			expect(app.context.store.a).toBe(1);
			expect(app.context.store.b).toBe(2);
		});

		it("throws on reserved key 'store'", () => {
			expect(() => createApp().state("store", 1)).toThrow(/reserved key/);
		});
	});

	describe("provide()", () => {
		it("requires options with kind", () => {
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid usage
			expect(() => (createApp() as any).provide("x", 1)).toThrow(/requires options/);
		});

		it("works with explicit kind and scope", async () => {
			const app = await createApp()
				.provide("x", 1, { kind: "store", scope: "local" })
				.start();
			expect(app.context.store.x).toBe(1);
		});
	});

	describe("context", () => {
		it("throws when not running", () => {
			expect(() => createApp().context).toThrow(/not started/);
		});

		it("has decorator namespace", async () => {
			const app = await createApp().decorate("x", 1).start();
			expect(app.context.decorator.x).toBe(1);
		});

		it("has store namespace", async () => {
			const app = await createApp().state("x", 1).start();
			expect(app.context.store.x).toBe(1);
		});

		it("decorators accessible at top level", async () => {
			const app = await createApp().decorate("x", 1).start();
			expect(app.context.x).toBe(1);
		});
	});

	describe("use()", () => {
		it("composes with a plugin function", async () => {
			const plugin = (app: InstanceType<typeof Aether>) => app.decorate("added", true);
			const app = await createApp().use(plugin).start();
			expect(app.context.added).toBe(true);
		});

		it("composes with an Aether instance", async () => {
			const plugin = new Aether("plugin").decorate("fromPlugin", 42, { scope: "global" });
			const app = await createApp().use(plugin).start();
			expect(app.context.fromPlugin).toBe(42);
		});

		it("composes with an array of plugins", async () => {
			const p1 = new Aether("p1").decorate("a", 1, { scope: "global" });
			const p2 = new Aether("p2").decorate("b", 2, { scope: "global" });
			const app = await createApp().use([p1, p2]).start();
			expect(app.context.a).toBe(1);
			expect(app.context.b).toBe(2);
		});

		it("returns same instance for null/undefined plugin", () => {
			const app = createApp();
			// biome-ignore lint/suspicious/noExplicitAny: testing null/undefined passthrough
			expect(app.use(null as any)).toBe(app);
			// biome-ignore lint/suspicious/noExplicitAny: testing null/undefined passthrough
			expect(app.use(undefined as any)).toBe(app);
		});

		it("deduplicates same plugin by definition reference", () => {
			const plugin = new Aether("plugin").decorate("x", 1, { scope: "global" });
			const app = createApp().use(plugin);
			const app2 = app.use(plugin);
			// Dedup returns same instance (no new Aether created)
			expect(app2).toBe(app);
		});

		it("throws for non-Aether return from plugin function", () => {
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid plugin return
			expect(() => createApp().use(() => "not aether" as any)).toThrow(/must return Aether/);
		});

		it("as: 'scoped' keeps providers non-transitive", async () => {
			const inner = new Aether("inner").decorate("x", 1, { scope: "global" });
			const middle = new Aether("middle").use(inner, { as: "scoped" });
			// x is visible to middle but NOT propagated further
			const outer = await new Aether("outer").use(middle).start();
			// x should not be in outer's context since middle used inner as scoped
			// biome-ignore lint/suspicious/noExplicitAny: checking absence of non-transitive provider
			expect((outer.context as any).x).toBeUndefined();
		});
	});

	describe("extend()", () => {
		it("adds a single extension", async () => {
			const app = createApp()
				.extend("greet", function (name: string) {
					return this.decorate("greeting", `hello ${name}`);
				})
				.ext.greet("world");
			const started = await app.start();
			expect(started.context.greeting).toBe("hello world");
		});

		it("adds multiple extensions via object form", () => {
			const app = createApp().extend({
				// biome-ignore lint/suspicious/noExplicitAny: extension this type is generic
				foo(this: any) {
					return this.decorate("x", 1);
				},
				// biome-ignore lint/suspicious/noExplicitAny: extension this type is generic
				bar(this: any) {
					return this.decorate("y", 2);
				},
			});
			expect(typeof app.ext.foo).toBe("function");
			expect(typeof app.ext.bar).toBe("function");
		});

		it("throws on extension collision during use()", () => {
			const p1 = new Aether("p1").extend("cmd", function () {
				return this;
			});
			const p2 = new Aether("p2").extend("cmd", function () {
				return this;
			});
			expect(() => createApp().use(p1).use(p2)).toThrow(/collision/);
		});

		it("throws when extend(name) called without function", () => {
			// biome-ignore lint/suspicious/noExplicitAny: testing invalid usage
			expect(() => (createApp() as any).extend("x")).toThrow(/requires a function/);
		});
	});

	describe("onLoad() / onUnload()", () => {
		it("runs onLoad callbacks in order (children before parent)", async () => {
			const order: string[] = [];
			const child = new Aether("child").onLoad(() => {
				order.push("child");
			});
			const parent = new Aether("parent").use(child).onLoad(() => {
				order.push("parent");
			});
			await parent.start();
			expect(order).toEqual(["child", "parent"]);
		});

		it("runs onUnload callbacks in reverse order (parent before children)", async () => {
			const order: string[] = [];
			const child = new Aether("child").onUnload(() => {
				order.push("child");
			});
			const parent = new Aether("parent").use(child).onUnload(() => {
				order.push("parent");
			});
			await parent.start();
			await parent.stop();
			expect(order).toEqual(["parent", "child"]);
		});

		it("supports async callbacks", async () => {
			let resolved = false;
			const app = new Aether("test").onLoad(async () => {
				await new Promise((r) => setTimeout(r, 10));
				resolved = true;
			});
			await app.start();
			expect(resolved).toBe(true);
		});
	});

	describe("start() / stop()", () => {
		it("sets isRunning to true after start", async () => {
			const app = await createApp().start();
			expect(app.isRunning).toBe(true);
		});

		it("sets isRunning to false after stop", async () => {
			const app = await createApp().start();
			await app.stop();
			expect(app.isRunning).toBe(false);
		});

		it("double start is idempotent", async () => {
			let count = 0;
			const app = new Aether("test").onLoad(() => {
				count++;
			});
			await app.start();
			await app.start();
			expect(count).toBe(1);
		});

		it("stop without start is a no-op", async () => {
			const app = createApp();
			await app.stop(); // should not throw
			expect(app.isRunning).toBe(false);
		});

		it("cleans up on startup error", async () => {
			const app = new Aether("test").onLoad(() => {
				throw new Error("boom");
			});
			await expect(app.start()).rejects.toThrow("boom");
			expect(app.isRunning).toBe(false);
			expect(() => app.context).toThrow(/not started/);
		});

		it("returns the same instance from start()", async () => {
			const app = createApp();
			const started = await app.start();
			expect(started).toBe(app);
		});
	});

	describe("scope: global", () => {
		it("propagates global decorators to parent", async () => {
			const plugin = new Aether("plugin").decorate("shared", "value", { scope: "global" });
			const app = await createApp().use(plugin).start();
			expect(app.context.shared).toBe("value");
		});

		it("propagates global state to parent", async () => {
			const plugin = new Aether("plugin").state("data", [1, 2, 3], { scope: "global" });
			const app = await createApp().use(plugin).start();
			expect(app.context.store.data).toEqual([1, 2, 3]);
		});

		it("local providers are not visible to parent", async () => {
			const plugin = new Aether("plugin").decorate("secret", "hidden");
			const app = await createApp().use(plugin).start();
			// biome-ignore lint/suspicious/noExplicitAny: checking absence of local provider
			expect((app.context as any).secret).toBeUndefined();
		});
	});

	describe("override mode", () => {
		it("allows overriding an existing decorator", async () => {
			const app = await createApp()
				.decorate("x", 1)
				.decorate("x", 2, { mode: "override" })
				.start();
			expect(app.context.x).toBe(2);
		});

		it("allows overriding an existing state", async () => {
			const app = await createApp()
				.state("x", 1)
				.state("x", 2, { mode: "override" })
				.start();
			expect(app.context.store.x).toBe(2);
		});
	});
});
