import type {
	AnyAether,
	ApplyDecorate,
	ApplyProvide,
	ApplyUse,
	ApplyUseMany,
	BoundExtensions,
	CallbackContext,
	ContextAppendType,
	EphemeralType,
	ExtensionBase,
	LifeCycleType,
	LifecycleCallback,
	ModuleDefinition,
	ModuleRuntimeContext,
	NormalizeUseAs,
	ProvideOptions,
	ProviderEntry,
	ProviderKind,
	ProviderOrigin,
	ProvidersOfKind,
	Scope,
	SingletonBase,
	UseOptions,
	VolatileType,
} from "./types";
import type { EmptyObject } from "./util-types";

// ============================================================================
// Internal Types
// ============================================================================
type ResolvedConfig = {
	kind: ProviderKind;
	scope: LifeCycleType;
	mode: ContextAppendType;
};

type ParsedArgs = {
	entries: [string, unknown][];
	config: ResolvedConfig;
	isObjectForm: boolean;
};

const PROVIDER_KINDS: readonly ProviderKind[] = ["decorator", "store"] as const;
const RESERVED_KEYS: Record<ProviderKind, string> = { decorator: "decorator", store: "store" };

// ============================================================================
// Aether Class
// ============================================================================

/**
 * Immutable module builder with type-safe dependency injection and lifecycle management.
 * Each method returns a new instance, preserving functional composition patterns.
 */
export class Aether<
	TName extends string = string,
	Singleton extends SingletonBase = { decorator: EmptyObject; store: EmptyObject },
	Ephemeral extends EphemeralType = { decorator: EmptyObject; store: EmptyObject },
	Volatile extends VolatileType = { decorator: EmptyObject; store: EmptyObject },
	Extensions extends ExtensionBase = EmptyObject,
> {
	static readonly #GLOBAL_SCOPE: symbol = Symbol.for("aether:use:global");

	declare readonly "~Name": TName;
	declare readonly "~Singleton": Singleton;
	declare readonly "~Ephemeral": Ephemeral;
	declare readonly "~Volatile": Volatile;
	declare readonly "~Extensions": Extensions;

	readonly name: TName;
	readonly #def: ModuleDefinition;
	readonly #extensionImpls: Map<string, (...args: unknown[]) => unknown> = new Map();
	#runtimeTree: ModuleRuntimeContext | null = null;
	#running = false;

	readonly ext: BoundExtensions<this, Extensions>;

	constructor(name: TName, def?: ModuleDefinition, extensions?: Map<string, (...args: unknown[]) => unknown>) {
		this.name = name;
		this.#def = def ?? Aether.#emptyDef();
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
	get context(): CallbackContext<Singleton, Ephemeral, Volatile> {
		if (!(this.#running && this.#runtimeTree)) {
			throw new Error(`Module "${this.name}" not started`);
		}
		return this.#runtimeTree.callbackCtx as CallbackContext<Singleton, Ephemeral, Volatile>;
	}

	// ========================================================================
	// Lifecycle Hooks
	// ========================================================================

	/**
	 * Register a callback to run when the module starts. Receives full context with all providers.
	 */
	onLoad(
		callback: LifecycleCallback<Singleton, Ephemeral, Volatile>,
	): Aether<TName, Singleton, Ephemeral, Volatile, Extensions> {
		return this.#next((d) => d.loadCallbacks.push(callback as (ctx: unknown) => void | Promise<void>));
	}

	/**
	 * Register a callback to run when the module stops. Useful for cleanup tasks.
	 */
	onUnload(
		callback: LifecycleCallback<Singleton, Ephemeral, Volatile>,
	): Aether<TName, Singleton, Ephemeral, Volatile, Extensions> {
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
		fn: (this: Aether<TName, Singleton, Ephemeral, Volatile, Extensions>, ...args: TArgs) => AnyAether,
	): Aether<TName, Singleton, Ephemeral, Volatile, Extensions & Record<K, (...args: TArgs) => unknown>>;

	/**
	 * Add multiple extension methods at once via an object.
	 */
	extend<TExtensions extends Record<string, (this: AnyAether, ...args: never[]) => AnyAether>>(
		extensions: TExtensions,
	): Aether<
		TName,
		Singleton,
		Ephemeral,
		Volatile,
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
	use<TNext extends AnyAether>(
		plugin: (app: Aether<TName, Singleton, Ephemeral, Volatile, Extensions>) => TNext,
	): TNext;

	/**
	 * Compose with multiple plugins or module instances.
	 * Use `{ as: "scoped" }` to limit provider visibility to direct parent only.
	 */
	use<const TPlugins extends readonly AnyAether[], const TOptions extends UseOptions | undefined = undefined>(
		plugins: TPlugins,
		options?: TOptions,
	): ApplyUseMany<TName, Singleton, Ephemeral, Volatile, Extensions, TPlugins, NormalizeUseAs<TOptions>>;

	/**
	 * Compose with another Aether module, merging its providers and extensions.
	 */
	use<TPlugin extends AnyAether, const TOptions extends UseOptions | undefined = undefined>(
		plugin: TPlugin,
		options?: TOptions,
	): ApplyUse<TName, Singleton, Ephemeral, Volatile, Extensions, TPlugin, NormalizeUseAs<TOptions>>;
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
			const scopeId = this.#useScopeId(plugin.name, options?.scope);

			if (this.#def.uses.some((u) => u.def === pluginDef && u.scopeId === scopeId)) {
				return this as unknown as AnyAether;
			}

			const nextDef = Aether.#copyDef(this.#def);
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
		value: V | ((ctx: ProvidersOfKind<Singleton, Ephemeral, Volatile, TKind>) => V),
		options: TOpts & { kind: TKind },
	): ApplyProvide<
		TName,
		Singleton,
		Ephemeral,
		Volatile,
		TOpts["scope"],
		TOpts["mode"],
		TKind,
		Record<K, V>,
		Extensions
	>;

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
	): ApplyProvide<TName, Singleton, Ephemeral, Volatile, TOpts["scope"], TOpts["mode"], TKind, TProviders, Extensions>;
	provide(...args: unknown[]): unknown {
		return this.#addProviders(this.#parseArgs(args, "provide"));
	}

	/**
	 * Register a decorator (utility/method/service) accessible in context.
	 * Supports factory functions for lazy initialization.
	 */
	decorate<K extends string, V>(
		key: K,
		value: V | ((ctx: CallbackContext<Singleton, Ephemeral, Volatile>) => V),
	): ApplyDecorate<TName, Singleton, Ephemeral, Volatile, "local", "append", Record<K, V>, Extensions>;

	/**
	 * Register a decorator with custom scope/mode options.
	 */
	decorate<K extends string, V, const TOpts extends ProvideOptions<"decorator">>(
		key: K,
		value: V | ((ctx: CallbackContext<Singleton, Ephemeral, Volatile>) => V),
		options: TOpts,
	): ApplyDecorate<TName, Singleton, Ephemeral, Volatile, TOpts["scope"], TOpts["mode"], Record<K, V>, Extensions>;

	/**
	 * Register multiple decorators at once.
	 */
	decorate<TDecorators extends Record<string, unknown>>(
		decorators: TDecorators,
	): ApplyDecorate<TName, Singleton, Ephemeral, Volatile, "local", "append", TDecorators, Extensions>;

	/**
	 * Register multiple decorators with custom scope/mode options.
	 */
	decorate<TDecorators extends Record<string, unknown>, const TOpts extends ProvideOptions<"decorator">>(
		decorators: TDecorators,
		options: TOpts,
	): ApplyDecorate<TName, Singleton, Ephemeral, Volatile, TOpts["scope"], TOpts["mode"], TDecorators, Extensions>;
	decorate(...args: unknown[]): unknown {
		return this.#addProviders(this.#parseArgs(args, "decorator"));
	}

	/**
	 * Register state/data accessible via `context.store.<key>`.
	 * Unlike decorators, state values are stored as-is (no factory functions).
	 */
	state<K extends string, V>(
		key: K,
		value: V,
	): ApplyProvide<TName, Singleton, Ephemeral, Volatile, "local", "append", "store", Record<K, V>, Extensions>;

	/**
	 * Register state with custom scope/mode options.
	 */
	state<K extends string, V, const TOpts extends ProvideOptions<"store">>(
		key: K,
		value: V,
		options: TOpts,
	): ApplyProvide<
		TName,
		Singleton,
		Ephemeral,
		Volatile,
		TOpts["scope"],
		TOpts["mode"],
		"store",
		Record<K, V>,
		Extensions
	>;

	/**
	 * Register multiple state values at once.
	 */
	state<TStore extends Record<string, unknown>>(
		store: TStore,
	): ApplyProvide<TName, Singleton, Ephemeral, Volatile, "local", "append", "store", TStore, Extensions>;

	/**
	 * Register multiple state values with custom scope/mode options.
	 */
	state<TStore extends Record<string, unknown>, const TOpts extends ProvideOptions<"store">>(
		store: TStore,
		options: TOpts,
	): ApplyProvide<TName, Singleton, Ephemeral, Volatile, TOpts["scope"], TOpts["mode"], "store", TStore, Extensions>;
	state(...args: unknown[]): unknown {
		return this.#addProviders(this.#parseArgs(args, "store"));
	}

	// ========================================================================
	// Lifecycle Management
	// ========================================================================

	/**
	 * Initialize the module and all dependencies, then run onLoad callbacks.
	 * Builds the dependency tree, resolves providers, and makes `context` accessible.
	 * @returns The same instance for chaining.
	 */
	async start(): Promise<this> {
		if (this.#running) {
			return this;
		}

		const cache: WeakMap<ModuleDefinition, Map<string | symbol, ModuleRuntimeContext>> = new WeakMap();
		const tree = this.#buildTree(this.name, this.#def, cache, Symbol(`root:${this.name}`));
		const order = this.#lifecycleOrder(tree);

		this.#runtimeTree = tree;
		this.#running = true;

		try {
			for (const ctx of order) {
				this.#initModule(ctx);
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
			const order = this.#lifecycleOrder(this.#runtimeTree).reverse();
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
	// Private - Argument Parsing (Unified)
	// ========================================================================

	#parseArgs(args: unknown[], defaultKind: "provide" | ProviderKind): ParsedArgs {
		const last = args.at(-1);
		const hasOpts = this.#isOpts(last);

		if (defaultKind === "provide" && !hasOpts) {
			throw new Error("provide() requires options with 'kind' and 'scope'");
		}

		const opts = hasOpts ? (last as ProvideOptions) : undefined;
		const kind: ProviderKind = opts?.kind ?? (defaultKind === "provide" ? "decorator" : defaultKind);
		const scope: LifeCycleType = opts?.scope ?? "local";
		const mode: ContextAppendType = opts?.mode ?? "append";

		const config: ResolvedConfig = { kind, scope, mode };
		const argsWithoutOpts = hasOpts ? args.slice(0, -1) : args;

		// (key, value) form
		if (typeof argsWithoutOpts[0] === "string") {
			return { entries: [[argsWithoutOpts[0], argsWithoutOpts[1]]], config, isObjectForm: false };
		}

		// (object) form
		if (argsWithoutOpts[0] && typeof argsWithoutOpts[0] === "object") {
			return {
				entries: Object.entries(argsWithoutOpts[0] as Record<string, unknown>),
				config,
				isObjectForm: true,
			};
		}

		throw new Error("Invalid arguments");
	}

	#isOpts(arg: unknown): arg is ProvideOptions {
		if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
			return false;
		}
		const o = arg as Record<string, unknown>;
		return typeof o.scope === "string" || typeof o.kind === "string";
	}

	// ========================================================================
	// Private - Provider Management
	// ========================================================================

	#addProviders(parsed: ParsedArgs): Aether<TName, Singleton, Ephemeral, Volatile, Extensions> {
		return this.#next((d) => {
			for (const [key, value] of parsed.entries) {
				this.#pushEntry(d, key, value, parsed.config, parsed.isObjectForm);
			}
		});
	}

	#pushEntry(def: ModuleDefinition, key: string, value: unknown, cfg: ResolvedConfig, forceStatic: boolean): void {
		if (key === RESERVED_KEYS[cfg.kind]) {
			throw new Error(`Cannot use reserved key "${key}" as ${cfg.kind} name`);
		}

		if (cfg.mode === "append" && this.#def.providers.some((p) => p.kind === cfg.kind && p.key === key)) {
			throw new Error(`${cfg.kind} "${key}" already defined. Use { mode: 'override' } to replace.`);
		}

		const isExport = cfg.scope !== "local";
		const isTransitive = cfg.scope === "global";

		def.providers.push({
			kind: cfg.kind,
			key,
			value,
			export: isExport,
			transitive: isTransitive,
			isFactory: forceStatic ? false : typeof value === "function",
			mode: cfg.mode,
		});
	}

	#applyEntry(
		entry: ProviderEntry,
		moduleName: string,
		local: Record<ProviderKind, Record<string, unknown>>,
		exported: Record<ProviderKind, Record<string, unknown>>,
		propagated: Record<ProviderKind, Record<string, unknown>>,
		origins: Map<string, ProviderOrigin>,
	): void {
		const { kind, key, mode = "append" } = entry;
		const originKey = `${kind}:${key}`;

		if (mode === "append" && key in local[kind]) {
			const o = origins.get(originKey);
			throw new Error(`${kind} "${key}" collision from "${o?.moduleName}". Use { mode: 'override' } to replace.`);
		}

		const factoryCtx =
			kind === "decorator" ? { ...local.decorator, decorator: local.decorator, store: local.store } : local[kind];

		const resolved = entry.isFactory ? (entry.value as (ctx: unknown) => unknown)(factoryCtx) : entry.value;

		if (mode === "override") {
			delete exported[kind][key];
			delete propagated[kind][key];
		}

		local[kind][key] = resolved;
		if (entry.export) {
			exported[kind][key] = resolved;
			if (entry.transitive) {
				propagated[kind][key] = resolved;
			}
		}
		origins.set(originKey, { kind, key, moduleName, isExported: entry.export });
	}

	// ========================================================================
	// Private - Runtime Tree
	// ========================================================================

	#buildTree(
		name: string,
		def: ModuleDefinition,
		cache: WeakMap<ModuleDefinition, Map<string | symbol, ModuleRuntimeContext>>,
		scopeId: string | symbol,
	): ModuleRuntimeContext {
		let byScope = cache.get(def);
		const existing = byScope?.get(scopeId);
		if (existing) {
			return existing;
		}

		if (!byScope) {
			byScope = new Map();
			cache.set(def, byScope);
		}

		const ctx: ModuleRuntimeContext = {
			name,
			def,
			initialized: false,
			providers: { decorator: {}, store: {} },
			exportedProviders: { decorator: {}, store: {} },
			propagatedProviders: { decorator: {}, store: {} },
			providerOrigins: new Map(),
			callbackCtx: null,
			children: def.uses.map((u) => this.#buildTree(u.name, u.def, cache, u.scopeId ?? Aether.#GLOBAL_SCOPE)),
		};

		byScope.set(scopeId, ctx);
		return ctx;
	}

	#initModule(ctx: ModuleRuntimeContext): void {
		if (ctx.initialized) {
			return;
		}

		const { name, def, providers, exportedProviders, propagatedProviders, providerOrigins } = ctx;

		// Import from children
		for (let i = 0; i < ctx.children.length; i++) {
			const child = ctx.children[i];
			const edge = def.uses[i];
			if (!(child && edge)) {
				continue;
			}

			// Import exported providers
			for (const kind of PROVIDER_KINDS) {
				for (const [k, v] of Object.entries(child.exportedProviders[kind])) {
					const originKey = `${kind}:${k}`;
					if (k in providers[kind]) {
						const o = providerOrigins.get(originKey);
						throw new Error(`${kind} "${k}" collision: already from "${o?.moduleName}"`);
					}
					providers[kind][k] = v;
					providerOrigins.set(originKey, { kind, key: k, moduleName: child.name, isExported: true });
				}
			}

			// Propagate transitive
			if (edge.transitive !== false) {
				for (const kind of PROVIDER_KINDS) {
					Object.assign(exportedProviders[kind], child.propagatedProviders[kind]);
					Object.assign(propagatedProviders[kind], child.propagatedProviders[kind]);
				}
			}
		}

		// Apply own providers
		for (const entry of def.providers) {
			this.#applyEntry(entry, name, providers, exportedProviders, propagatedProviders, providerOrigins);
		}

		ctx.callbackCtx = { ...providers.decorator, decorator: providers.decorator, store: providers.store };
		ctx.initialized = true;
	}

	#lifecycleOrder(root: ModuleRuntimeContext): ModuleRuntimeContext[] {
		const order: ModuleRuntimeContext[] = [];
		const visited = new Set<ModuleRuntimeContext>();

		const visit = (node: ModuleRuntimeContext) => {
			if (visited.has(node)) {
				return;
			}
			visited.add(node);
			for (const c of node.children) {
				visit(c);
			}
			order.push(node);
		};
		visit(root);
		return order;
	}

	// ========================================================================
	// Private - Helpers
	// ========================================================================

	#useScopeId(pluginName: string, scope?: Scope): string | symbol {
		if (!scope || scope === "global") {
			return Aether.#GLOBAL_SCOPE;
		}
		if (scope === "local") {
			return Symbol(`local:${pluginName}`);
		}
		return scope;
	}

	#next(mutate: (d: ModuleDefinition) => void): Aether<TName, Singleton, Ephemeral, Volatile, Extensions> {
		const nextDef = Aether.#copyDef(this.#def);
		mutate(nextDef);
		return new Aether(this.name, nextDef, this.#extensionImpls);
	}

	static #emptyDef(): ModuleDefinition {
		return { providers: [], loadCallbacks: [], unloadCallbacks: [], uses: [] };
	}

	static #copyDef(d: ModuleDefinition): ModuleDefinition {
		return {
			providers: [...d.providers],
			loadCallbacks: [...d.loadCallbacks],
			unloadCallbacks: [...d.unloadCallbacks],
			uses: [...d.uses],
		};
	}
}
