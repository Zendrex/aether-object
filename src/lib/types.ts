import type { Aether } from "./aether";
import type { EmptyObject, Prettify } from "./util-types";

// ---------------------------------------------------------------------------
// Extension Types
// ---------------------------------------------------------------------------

/**
 * Base type for extension method signatures.
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for extension function variance
export type ExtensionBase = Record<string, (...args: any[]) => any>;

/**
 * Maps extension signatures to bound methods that return `TSelf`.
 * Enables fluent chaining while preserving the current instance type.
 */
export type BoundExtensions<TSelf, TExt extends ExtensionBase> = {
	[K in keyof TExt]: TExt[K] extends (...args: infer A) => unknown ? (...args: A) => TSelf : never;
};

// ---------------------------------------------------------------------------
// Scope Types
// ---------------------------------------------------------------------------

/**
 * Defines visibility scope for module dependencies.
 */
export type Scope = "global" | "local" | string | symbol;

/**
 * Options for configuring plugin composition behavior.
 */
export type UseOptions = {
	/** Scope identifier for the plugin instance. */
	scope?: Scope;
	/** How to merge plugin providers: "global" (transitive) or "scoped" (direct parent only). */
	as?: "global" | "scoped";
};

// ---------------------------------------------------------------------------
// Provider Kinds
// ---------------------------------------------------------------------------

/**
 * Type of provider: "decorator" for methods/utilities or "store" for state.
 */
export type ProviderKind = "decorator" | "store";

// ---------------------------------------------------------------------------
// Provider Scope Layers
// ---------------------------------------------------------------------------

/**
 * Provider visibility: "global" (all ancestors) or "local" (current only).
 */
export type LifeCycleType = "global" | "local";

/**
 * How to handle provider key conflicts: "append" (error on collision) or "override" (replace existing).
 */
export type ContextAppendType = "append" | "override";

/**
 * Base type for a provider scope layer containing decorator and store providers.
 */
export type ProviderLayer = { decorator: EmptyObject; store: EmptyObject };

/**
 * Combined context object passed to lifecycle callbacks, containing all providers.
 */
export type CallbackContext<Global extends ProviderLayer, Local extends ProviderLayer> = Prettify<
	Global["decorator"] &
		Local["decorator"] & {
			decorator: Prettify<Global["decorator"] & Local["decorator"]>;
			store: Prettify<Global["store"] & Local["store"]>;
		}
>;

/**
 * Function signature for onLoad/onUnload lifecycle hooks.
 */
export type LifecycleCallback<Global extends ProviderLayer, Local extends ProviderLayer> = (
	context: CallbackContext<Global, Local>,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Provider Options
// ---------------------------------------------------------------------------

/**
 * Options for provider registration.
 */
export type ProvideOptions<K extends ProviderKind = ProviderKind> = {
	kind?: K;
	scope?: LifeCycleType;
	mode?: ContextAppendType;
};

// ---------------------------------------------------------------------------
// Provider Composition Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts all providers of a specific kind from all scope layers.
 */
export type ProvidersOfKind<
	Global extends ProviderLayer,
	Local extends ProviderLayer,
	K extends ProviderKind,
> = Prettify<Global[K] & Local[K]>;

// ---------------------------------------------------------------------------
// use() typing
// ---------------------------------------------------------------------------

/**
 * Generic Aether type accepting any configuration (for plugin compatibility).
 */
// biome-ignore lint/suspicious/noExplicitAny: AnyAether uses `any` for Extensions to allow variance
export type AnyAether = Aether<string, ProviderLayer, ProviderLayer, any>;

// ---------------------------------------------------------------------------
// Module Definition (Runtime)
// ---------------------------------------------------------------------------

/**
 * Internal representation of a registered provider.
 */
export type ProviderEntry = {
	kind: ProviderKind;
	key: string;
	value: unknown;
	scope: LifeCycleType;
	isFactory?: boolean;
	mode?: ContextAppendType;
};

/**
 * Internal representation of a module dependency edge.
 */
export type UseEdge = {
	name: string;
	def: ModuleDefinition;
	scopeId?: string | symbol;
	transitive?: boolean;
};

/**
 * Internal immutable module definition containing providers and callbacks.
 */
export type ModuleDefinition = {
	providers: ProviderEntry[];
	loadCallbacks: ((context: unknown) => void | Promise<void>)[];
	unloadCallbacks: ((context: unknown) => void | Promise<void>)[];
	uses: UseEdge[];
};

/**
 * Tracks which module originally provided a given key.
 */
export type ProviderOrigin = {
	kind: ProviderKind;
	key: string;
	moduleName: string;
	isExported: boolean;
};

/**
 * Runtime state for a module instance during execution.
 */
export type ModuleRuntimeContext = {
	name: string;
	def: ModuleDefinition;
	initialized: boolean;
	providers: Record<ProviderKind, Record<string, unknown>>;
	exportedProviders: Record<ProviderKind, Record<string, unknown>>;
	propagatedProviders: Record<ProviderKind, Record<string, unknown>>;
	providerOrigins: Map<string, ProviderOrigin>;
	callbackCtx: unknown;
	children: ModuleRuntimeContext[];
};
