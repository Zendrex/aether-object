# aether-object

A TypeScript library for building composable runtime module systems with plugin composition, typed context management, and lifecycle control.

**Core features:**
- **Plugin composition** via `.use()` with scope control and transitive exports
- **Typed context building** through `.decorate()` (computed/factory) and `.state()` (stateful)
- **Lifecycle management** with `.onLoad()` / `.onUnload()` hooks and `start()/stop()` semantics
- **Extension API** via `.extend()` for adding chainable methods under `app.ext.*`

The module system operates as a startable/stoppable runtime with a fully typed context that's only accessible when running. All composition is immutable, making module definitions reusable across different runtime contexts.

**Note:** This is a prototype exploring these architectural patterns. The type system is *decent* and the patterns are interesting for building plugin-based architectures, but it's not battle-tested or production-ready. Inspired by ElysiaJS's composition mechanics.

**NOTE:** This package is currently **not** available on any registry.
## Example

Here's the basic pattern:

```ts
import { Aether } from "@zendrex/aether-object";

const logger = new Aether("logger")
	.decorate("logLevel", "info")
	.decorate(
		"log",
		(ctx) => ({
			info: (message: string) => console.log(`[${ctx.logLevel.toUpperCase()}] ${message}`),
			error: (message: string) => console.error(`[ERROR] ${message}`),
		}),
		{ scope: "scoped" },
	)
	.onLoad(({ log }) => log.info("Logger initialized"));

const app = new Aether("app")
	.use(logger)
	.decorate("port", 3000, { scope: "global" })
	.onLoad(({ log, port }) => log.info(`App starting on :${port}`))
	.onUnload(({ log }) => log.info("App stopping"));

await app.start();
app.context.log.info(`Running? ${app.isRunning}`);
await app.stop();
```

## How it works

### Immutable builder pattern

All builder methods return new `Aether` instances rather than mutating. This keeps composition predictable and makes the module definitions reusable across different runtime contexts.

### Provider system

The context is built from two provider types:

**Decorators** (`.decorate()`) are for computed values, services, or anything that might need access to other context. They support factory functions:

```ts
app.decorate("port", 3000);
app.decorate("server", (ctx) => ({ 
  start: () => ctx.log.info("start") 
}), { scope: "global" });
```

**Store** (`.state()`) is for stateful primitives—Maps, caches, config objects, etc. These are typically static values:

```ts
app.state("commands", new Map());
app.state("config", { debug: true });
```

### Scope system

Providers use scopes to control visibility and propagation through the module tree:

- **`local`** (default) — visible only within the declaring module
- **`scoped`** — exported to the direct parent, non-transitive
- **`global`** — exported transitively up the entire ancestry chain

The `mode` option controls collision behavior:
- **`append`** (default) — throws on key collisions
- **`override`** — replaces existing providers

### Plugin composition

Compose modules using `.use()` with support for multiple patterns:

```ts
app.use(pluginAether)                  // Aether instance
app.use([plugin1, plugin2])            // array of plugins
app.use((app) => app.decorate(...))    // plugin function
```

The `scope` option controls runtime instantiation—whether plugins share a definition instance or get scoped copies. The `as: "scoped"` option prevents transitive propagation, limiting exports to the direct parent only.

### Lifecycle

Lifecycle hooks execute in dependency order:
- **`.onLoad()`** runs during `start()`, bottom-up through the module tree (dependencies first)
- **`.onUnload()`** runs during `stop()`, in reverse topological order

The `app.context` property is only accessible between `start()` and `stop()` calls—it throws otherwise.

### Extension API

Extensions let you build domain-specific fluent APIs:

```ts
const plugin = new Aether("plugin").extend("register", function (name: string) {
	return this.onLoad(() => console.log(`Registered ${name}`));
});

const app = new Aether("app").use(plugin).ext.register("ping");
```

Extension methods are bound to `app.ext.*` and automatically merge when composing plugins. Collisions throw.

## API overview

- `new Aether(name)` — create a module
- `app.use(...)` — compose plugins
- `app.decorate(...)` — add computed values/services
- `app.state(...)` — add stateful things
- `app.provide(...)` — generic provider (needs explicit `{ kind, scope }`)
- `app.extend(...)` — add methods to `app.ext.*`
- `app.onLoad(cb)` / `app.onUnload(cb)` — lifecycle hooks
- `await app.start()` / `await app.stop()` — lifecycle control
- `app.context` — typed context (only works while running)
- `app.isRunning` — boolean

## Running the example

```bash
bun install
bun run examples/example.ts
```

## License

MIT
