import { copyDef, emptyDef, parseArgs, pushEntry } from "./builder";
import { buildTree, initModule, lifecycleOrder, useScopeId } from "./runtime";
import type { ApplyDecorate, ApplyProvide, ApplyUse, ApplyUseMany, NormalizeUseAs } from "./type-apply";
import type {
	AnyAether,
	BoundExtensions,
	CallbackContext,
	ContextAppendType,
	ExtensionBase,
	LifeCycleType,
	LifecycleCallback,
	ModuleDefinition,
	ModuleRuntimeContext,
	ProvideOptions,
	ProviderKind,
	ProviderLayer,
	ProvidersOfKind,
	UseOptions,
} from "./types";
import type { EmptyObject } from "./util-types";

// ============================================================================
// Aether Class
// ============================================================================

/**
 * Immutable module builder with type-safe dependency injection and lifecycle management.
 * Each method returns a new instance, preserving functional composition patterns.
 *
 * @typeParam TName - The literal string name of this module
 * @typeParam Global - Provider layer for globally-scoped (transitive) providers
 * @typeParam Local - Provider layer for locally-scoped (current module only) providers
 * @typeParam Extensions - Extension method signatures available via `ext`
 */
export class Aether<
	TName extends string = string,
	Global extends ProviderLayer = { decorator: EmptyObject; store: EmptyObject },
	Local extends ProviderLayer = { decorator: EmptyObject; store: EmptyObject },
	Extensions extends ExtensionBase = EmptyObject,
> {
	declare readonly "~Name": TName;
	declare readonly "~Global": Global;
	declare readonly "~Local": Local;
	declare readonly "~Extensions": Extensions;

	readonly name: TName;
	readonly #def: ModuleDefinition;
	readonly #extensionImpls: Map<string, (...args: unknown[]) => unknown> = new Map();
	#runtimeTree: ModuleRuntimeContext | null = null;
	#running = false;

	/** Bound extension methods for fluent API patterns. */
	readonly ext: BoundExtensions<this, Extensions>;

	constructor(name: TName, def?: ModuleDefinition, extensions?: Map<string, (...args: unknown[]) => unknown>) {
		this.name = name;
		this.#def = def ?? emptyDef();
		if (extensions) {
			this.#extensionImpls = new Map(extensions);
		}
		// Build bound wrappers for the ext namespace
		this.ext = this.#buildExtNamespace();
	}

	/**
	 * Builds the `ext` namespace object with bound wrappers for each extension.
	 */
	#buildExtNamespace(): BoundExtensions<this, Extensions> {
		const ext = {} as Record<string, (...args: unknown[]) => unknown>;
		for (const [name, impl] of this.#extensionImpls) {
			ext[name] = (...args: unknown[]) => impl.call(this, ...args);
		}
		return ext as BoundExtensions<this, Extensions>;
	}

	// ========================================================================
	// Getters
	// ========================================================================

	/**
	 * Whether the module has been started and is currently running.
	 */
	get isRunning(): boolean {
		return this.#running;
	}

	/**
	 * Access all providers (decorators and store). Only available after `start()`.
	 * @throws Error if module is not running.
	 */
	get context(): CallbackContext<Global, Local> {
		if (!(this.#running && this.#runtimeTree)) {
			throw new Error(`Module "${this.name}" not started`);
		}
		return this.#runtimeTree.callbackCtx as CallbackContext<Global, Local>;
	}

	// ========================================================================
	// Lifecycle Hooks
	// ========================================================================

	/**
	 * Register a callback to run when the module starts. Receives full context with all providers.
	 */
	onLoad(callback: LifecycleCallback<Global, Local>): Aether<TName, Global, Local, Extensions> {
		return this.#next((d) => d.loadCallbacks.push(callback as (ctx: unknown) => void | Promise<void>));
	}

	/**
	 * Register a callback to run when the module stops. Useful for cleanup tasks.
	 */
	onUnload(callback: LifecycleCallback<Global, Local>): Aether<TName, Global, Local, Extensions> {
		return this.#next((d) => d.unloadCallbacks.push(callback as (ctx: unknown) => void | Promise<void>));
	}

	// ========================================================================
	// Extensions
	// ========================================================================

	/**
	 * Add a single extension method accessible via `ext.<name>(...)`.
	 * Extensions enable fluent API patterns and custom DSL building.
	 */
	extend<K extends string, TArgs extends unknown[]>(
		name: K,
		fn: (this: Aether<TName, Global, Local, Extensions>, ...args: TArgs) => AnyAether,
	): Aether<TName, Global, Local, Extensions & Record<K, (...args: TArgs) => unknown>>;

	/**
	 * Add multiple extension methods at once via an object.
	 */
	extend<TExtensions extends Record<string, (this: AnyAether, ...args: never[]) => AnyAether>>(
		extensions: TExtensions,
	): Aether<
		TName,
		Global,
		Local,
		Extensions & { [K in keyof TExtensions]: (...args: Parameters<TExtensions[K]>) => unknown }
	>;

	extend(
		nameOrExtensions: string | Record<string, (...args: unknown[]) => unknown>,
		fn?: (...args: unknown[]) => unknown,
	): unknown {
		const next = new Map(this.#extensionImpls);

		if (typeof nameOrExtensions === "string") {
			if (!fn) {
				throw new Error("extend(name, fn) requires a function as second argument");
			}
			next.set(nameOrExtensions, fn);
		} else {
			for (const [name, impl] of Object.entries(nameOrExtensions)) {
				next.set(name, impl);
			}
		}

		return new Aether(this.name, this.#def, next);
	}

	// ========================================================================
	// Plugin Composition
	// ========================================================================

	/**
	 * Compose with a plugin function that transforms the current instance.
	 */
	use<TNext extends AnyAether>(plugin: (app: Aether<TName, Global, Local, Extensions>) => TNext): TNext;

	/**
	 * Compose with multiple plugins or module instances.
	 * Use `{ as: "scoped" }` to limit provider visibility to direct parent only.
	 */
	use<const TPlugins extends readonly AnyAether[], const TOptions extends UseOptions | undefined = undefined>(
		plugins: TPlugins,
		options?: TOptions,
	): ApplyUseMany<TName, Global, Local, Extensions, TPlugins, NormalizeUseAs<TOptions>>;

	/**
	 * Compose with another Aether module, merging its providers and extensions.
	 */
	use<TPlugin extends AnyAether, const TOptions extends UseOptions | undefined = undefined>(
		plugin: TPlugin,
		options?: TOptions,
	): ApplyUse<TName, Global, Local, Extensions, TPlugin, NormalizeUseAs<TOptions>>;
	use(plugin: unknown, options?: UseOptions): unknown {
		if (!plugin) {
			return this;
		}

		if (Array.isArray(plugin)) {
			let app: AnyAether = this as unknown as AnyAether;
			for (const p of plugin) {
				app = app.use(p as never, options);
			}
			return app;
		}

		if (typeof plugin === "function") {
			const result = (plugin as (app: AnyAether) => AnyAether)(this as unknown as AnyAether);
			if (!(result instanceof Aether)) {
				throw new Error("Plugin function must return Aether instance");
			}
			return result;
		}

		if (plugin instanceof Aether) {
			const pluginDef = plugin.#def;
			const scopeId = useScopeId(plugin.name, options?.scope);

			if (this.#def.uses.some((u) => u.def === pluginDef && u.scopeId === scopeId)) {
				return this as unknown as AnyAether;
			}

			const nextDef = copyDef(this.#def);
			nextDef.uses.push({
				name: plugin.name,
				def: pluginDef,
				scopeId,
				transitive: options?.as !== "scoped",
			});

			// Merge extensions with collision detection
			const merged = new Map(this.#extensionImpls);
			for (const [name, impl] of plugin.#extensionImpls) {
				if (merged.has(name)) {
					throw new Error(
						`Extension "${name}" collision: already defined by current module "${this.name}", ` +
							`cannot merge from plugin "${plugin.name}". Rename one of the extensions to avoid conflicts.`,
					);
				}
				merged.set(name, impl);
			}
			return new Aether(this.name, nextDef, merged);
		}

		throw new Error("Invalid plugin type");
	}

	// ========================================================================
	// Provider Registration
	// ========================================================================

	/**
	 * Register a provider with explicit kind and scope options.
	 * Prefer `decorate()` or `state()` for better ergonomics.
	 */
	provide<K extends string, V, TKind extends ProviderKind, const TOpts extends ProvideOptions<TKind>>(
		key: K,
		value: V | ((ctx: ProvidersOfKind<Global, Local, TKind>) => V),
		options: TOpts & { kind: TKind },
	): ApplyProvide<TName, Global, Local, TOpts["scope"], TOpts["mode"], TKind, Record<K, V>, Extensions>;

	/**
	 * Register multiple providers at once with explicit kind and scope.
	 */
	provide<
		TProviders extends Record<string, unknown>,
		TKind extends ProviderKind,
		const TOpts extends ProvideOptions<TKind>,
	>(
		providers: TProviders,
		options: TOpts & { kind: TKind },
	): ApplyProvide<TName, Global, Local, TOpts["scope"], TOpts["mode"], TKind, TProviders, Extensions>;
	provide(...args: unknown[]): unknown {
		return this.#addProviders(parseArgs(args, "provide"));
	}

	/**
	 * Register a decorator (utility/method/service) accessible in context.
	 * Supports factory functions for lazy initialization.
	 */
	decorate<K extends string, V>(
		key: K,
		value: V | ((ctx: CallbackContext<Global, Local>) => V),
	): ApplyDecorate<TName, Global, Local, "local", "append", Record<K, V>, Extensions>;

	/**
	 * Register a decorator with custom scope/mode options.
	 */
	decorate<K extends string, V, const TOpts extends ProvideOptions<"decorator">>(
		key: K,
		value: V | ((ctx: CallbackContext<Global, Local>) => V),
		options: TOpts,
	): ApplyDecorate<TName, Global, Local, TOpts["scope"], TOpts["mode"], Record<K, V>, Extensions>;

	/**
	 * Register multiple decorators at once.
	 */
	decorate<TDecorators extends Record<string, unknown>>(
		decorators: TDecorators,
	): ApplyDecorate<TName, Global, Local, "local", "append", TDecorators, Extensions>;

	/**
	 * Register multiple decorators with custom scope/mode options.
	 */
	decorate<TDecorators extends Record<string, unknown>, const TOpts extends ProvideOptions<"decorator">>(
		decorators: TDecorators,
		options: TOpts,
	): ApplyDecorate<TName, Global, Local, TOpts["scope"], TOpts["mode"], TDecorators, Extensions>;
	decorate(...args: unknown[]): unknown {
		return this.#addProviders(parseArgs(args, "decorator"));
	}

	/**
	 * Register state/data accessible via `context.store.<key>`.
	 * Object-form values are stored as-is; key-value form detects factory functions.
	 */
	state<K extends string, V>(
		key: K,
		value: V,
	): ApplyProvide<TName, Global, Local, "local", "append", "store", Record<K, V>, Extensions>;

	/**
	 * Register state with custom scope/mode options.
	 */
	state<K extends string, V, const TOpts extends ProvideOptions<"store">>(
		key: K,
		value: V,
		options: TOpts,
	): ApplyProvide<TName, Global, Local, TOpts["scope"], TOpts["mode"], "store", Record<K, V>, Extensions>;

	/**
	 * Register multiple state values at once.
	 */
	state<TStore extends Record<string, unknown>>(
		store: TStore,
	): ApplyProvide<TName, Global, Local, "local", "append", "store", TStore, Extensions>;

	/**
	 * Register multiple state values with custom scope/mode options.
	 */
	state<TStore extends Record<string, unknown>, const TOpts extends ProvideOptions<"store">>(
		store: TStore,
		options: TOpts,
	): ApplyProvide<TName, Global, Local, TOpts["scope"], TOpts["mode"], "store", TStore, Extensions>;
	state(...args: unknown[]): unknown {
		return this.#addProviders(parseArgs(args, "store"));
	}

	// ========================================================================
	// Lifecycle Management
	// ========================================================================

	/**
	 * Initialize the module and all dependencies, then run onLoad callbacks.
	 * Builds the dependency tree, resolves providers, and makes `context` accessible.
	 *
	 * @returns The same instance for chaining.
	 */
	async start(): Promise<this> {
		if (this.#running) {
			return this;
		}

		const cache: WeakMap<ModuleDefinition, Map<string | symbol, ModuleRuntimeContext>> = new WeakMap();
		const tree = buildTree(this.name, this.#def, cache, Symbol(`root:${this.name}`));
		const order = lifecycleOrder(tree);

		this.#runtimeTree = tree;
		this.#running = true;

		try {
			for (const ctx of order) {
				initModule(ctx);
				for (const cb of ctx.def.loadCallbacks) {
					await cb(ctx.callbackCtx);
				}
			}
		} catch (e) {
			this.#runtimeTree = null;
			this.#running = false;
			throw e;
		}
		return this;
	}

	/**
	 * Shutdown the module by running onUnload callbacks in reverse order.
	 * Cleans up resources and makes `context` inaccessible.
	 */
	async stop(): Promise<void> {
		if (!(this.#running && this.#runtimeTree)) {
			return;
		}

		try {
			const order = lifecycleOrder(this.#runtimeTree).reverse();
			for (const ctx of order) {
				for (const cb of ctx.def.unloadCallbacks) {
					await cb(ctx.callbackCtx);
				}
			}
		} finally {
			this.#running = false;
			this.#runtimeTree = null;
		}
	}

	// ========================================================================
	// Private - Provider Management
	// ========================================================================

	#addProviders(parsed: {
		entries: [string, unknown][];
		config: { kind: ProviderKind; scope: LifeCycleType; mode: ContextAppendType };
		isObjectForm: boolean;
	}): Aether<TName, Global, Local, Extensions> {
		return this.#next((d) => {
			for (const [key, value] of parsed.entries) {
				pushEntry(this.#def.providers, d, key, value, parsed.config, parsed.isObjectForm);
			}
		});
	}

	// ========================================================================
	// Private - Helpers
	// ========================================================================

	#next(mutate: (d: ModuleDefinition) => void): Aether<TName, Global, Local, Extensions> {
		const nextDef = copyDef(this.#def);
		mutate(nextDef);
		return new Aether(this.name, nextDef, this.#extensionImpls);
	}
}
