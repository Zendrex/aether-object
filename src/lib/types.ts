import type { Aether } from "./aether";
import type { TypeError as AetherTypeError, EmptyObject, MergeStrict, Prettify } from "./util-types";

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
 * This enables fluent chaining while preserving the current instance type.
 *
 * @example
 * // If Extensions = { command: (name: string, handler: () => void) => unknown }
 * // Then BoundExtensions<App, Extensions> = { command: (name: string, handler: () => void) => App }
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

type ReservedKeys = { decorator: "decorator"; store: "store" };

// ---------------------------------------------------------------------------
// Type Foundation (Singleton/Ephemeral/Volatile)
// ---------------------------------------------------------------------------

/**
 * Provider visibility: "global" (all ancestors), "scoped" (direct parent), or "local" (current only).
 */
export type LifeCycleType = "global" | "scoped" | "local";

/**
 * How to handle provider key conflicts: "append" (error on collision) or "override" (replace existing).
 */
export type ContextAppendType = "append" | "override";

/**
 * Base type for global providers (transitive to all ancestors).
 */
export type SingletonBase = { decorator: EmptyObject; store: EmptyObject };

/**
 * Base type for scoped providers (exported to direct parent only).
 */
export type EphemeralType = { decorator: EmptyObject; store: EmptyObject };

/**
 * Base type for local providers (visible only in current module).
 */
export type VolatileType = { decorator: EmptyObject; store: EmptyObject };

/**
 * Combined context object passed to lifecycle callbacks, containing all providers.
 */
export type CallbackContext<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
> = Prettify<
	Singleton["decorator"] &
		Ephemeral["decorator"] &
		Volatile["decorator"] & {
			decorator: Prettify<Singleton["decorator"] & Ephemeral["decorator"] & Volatile["decorator"]>;
			store: Prettify<Singleton["store"] & Ephemeral["store"] & Volatile["store"]>;
		}
>;

/**
 * Function signature for onLoad/onUnload lifecycle hooks.
 */
export type LifecycleCallback<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
> = (context: CallbackContext<Singleton, Ephemeral, Volatile>) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Provider Options
// ---------------------------------------------------------------------------

/**
 * Options for provider registration.
 *
 * @example
 * // Local (default) - visible only to current module
 * .decorate("key", value)
 * .decorate("key", value, { scope: "local" })
 *
 * // Scoped - exported to direct parent only
 * .decorate("key", value, { scope: "scoped" })
 *
 * // Global - exported transitively to all ancestors
 * .decorate("key", value, { scope: "global" })
 *
 * // Override existing
 * .decorate("key", newValue, { scope: "global", mode: "override" })
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
 * Extracts all providers of a specific kind from all lifecycle layers.
 */
export type ProvidersOfKind<
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
	K extends ProviderKind,
> = Prettify<Singleton[K] & Ephemeral[K] & Volatile[K]>;

type RejectReservedKey<
	K extends ProviderKind,
	TAdd extends Record<string, unknown>,
> = ReservedKeys[K] extends keyof TAdd
	? AetherTypeError<`Cannot use reserved key '${ReservedKeys[K]}' as ${K} name`>
	: TAdd;

type AddToProviders<TBase extends object, TAdd extends Record<string, unknown>> = Prettify<TBase & TAdd>;
type OverrideProviders<TBase extends object, TAdd extends Record<string, unknown>> = Prettify<
	Omit<TBase, keyof TAdd> & TAdd
>;

// ---------------------------------------------------------------------------
// Type Application Helpers
// ---------------------------------------------------------------------------

type UpdateLayer<
	TLayer extends SingletonBase | EphemeralType | VolatileType,
	TKind extends ProviderKind,
	TMode extends ContextAppendType,
	TAdd extends Record<string, unknown>,
> = Prettify<{
	[K in ProviderKind]: K extends TKind
		? TMode extends "override"
			? Prettify<OverrideProviders<TLayer[K], RejectReservedKey<K, TAdd>>>
			: Prettify<AddToProviders<TLayer[K], RejectReservedKey<K, TAdd>>>
		: TLayer[K];
}>;

// ---------------------------------------------------------------------------
// ApplyProvide - Generic type application for any provider kind
// ---------------------------------------------------------------------------

export type ApplyProvide<
	TName extends string,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
	TScope extends LifeCycleType | undefined,
	TMode extends ContextAppendType | undefined,
	TKind extends ProviderKind,
	TAdd extends Record<string, unknown>,
	Extensions extends ExtensionBase = ExtensionBase,
> = (TScope extends "global" ? TScope : TScope extends "scoped" ? TScope : "local") extends "global"
	? Aether<
			TName,
			UpdateLayer<Singleton, TKind, TMode extends ContextAppendType ? TMode : "append", TAdd>,
			Ephemeral,
			Volatile,
			Extensions
		>
	: (TScope extends "global" ? TScope : TScope extends "scoped" ? TScope : "local") extends "scoped"
		? Aether<
				TName,
				Singleton,
				UpdateLayer<Ephemeral, TKind, TMode extends ContextAppendType ? TMode : "append", TAdd>,
				Volatile,
				Extensions
			>
		: Aether<
				TName,
				Singleton,
				Ephemeral,
				UpdateLayer<Volatile, TKind, TMode extends ContextAppendType ? TMode : "append", TAdd>,
				Extensions
			>;

export type ApplyDecorate<
	TName extends string,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
	TScope extends LifeCycleType | undefined,
	TMode extends ContextAppendType | undefined,
	TAdd extends Record<string, unknown>,
	Extensions extends ExtensionBase = ExtensionBase,
> = ApplyProvide<TName, Singleton, Ephemeral, Volatile, TScope, TMode, "decorator", TAdd, Extensions>;

// ---------------------------------------------------------------------------
// use() typing
// ---------------------------------------------------------------------------

/**
 * Generic Aether type accepting any configuration (for plugin compatibility).
 */
// biome-ignore lint/suspicious/noExplicitAny: AnyAether uses `any` for Extensions to allow variance
export type AnyAether = Aether<string, SingletonBase, EphemeralType, VolatileType, any>;

export type NormalizeUseAs<TOptions extends UseOptions | undefined> = TOptions extends { as: "scoped" }
	? "scoped"
	: "global";

// Merge extensions without Prettify to reduce TS instantiation pressure
type MergedExtensions<Current extends ExtensionBase, Plugin extends AnyAether> = Current & Plugin["~Extensions"];

export type ApplyUse<
	TName extends string,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
	Extensions extends ExtensionBase,
	TPlugin extends AnyAether,
	TAs extends "global" | "scoped",
> = TAs extends "scoped"
	? Aether<
			TName,
			Singleton,
			Ephemeral,
			Prettify<{
				decorator: Prettify<
					MergeStrict<
						MergeStrict<Volatile["decorator"], TPlugin["~Ephemeral"]["decorator"]>,
						TPlugin["~Singleton"]["decorator"]
					>
				>;
				store: Prettify<
					MergeStrict<MergeStrict<Volatile["store"], TPlugin["~Ephemeral"]["store"]>, TPlugin["~Singleton"]["store"]>
				>;
			}>,
			MergedExtensions<Extensions, TPlugin>
		>
	: Aether<
			TName,
			Prettify<{
				decorator: Prettify<MergeStrict<Singleton["decorator"], TPlugin["~Singleton"]["decorator"]>>;
				store: Prettify<MergeStrict<Singleton["store"], TPlugin["~Singleton"]["store"]>>;
			}>,
			Ephemeral,
			Prettify<{
				decorator: Prettify<MergeStrict<Volatile["decorator"], TPlugin["~Ephemeral"]["decorator"]>>;
				store: Prettify<MergeStrict<Volatile["store"], TPlugin["~Ephemeral"]["store"]>>;
			}>,
			MergedExtensions<Extensions, TPlugin>
		>;

export type ApplyUseMany<
	TName extends string,
	Singleton extends SingletonBase,
	Ephemeral extends EphemeralType,
	Volatile extends VolatileType,
	Extensions extends ExtensionBase,
	TPlugins extends readonly AnyAether[],
	TAs extends "global" | "scoped",
> = TPlugins extends readonly [infer Head, ...infer Tail]
	? Head extends AnyAether
		? Tail extends readonly AnyAether[]
			? TAs extends "scoped"
				? ApplyUseMany<
						TName,
						Singleton,
						Ephemeral,
						Prettify<{
							decorator: Prettify<
								MergeStrict<
									MergeStrict<Volatile["decorator"], Head["~Ephemeral"]["decorator"]>,
									Head["~Singleton"]["decorator"]
								>
							>;
							store: Prettify<
								MergeStrict<MergeStrict<Volatile["store"], Head["~Ephemeral"]["store"]>, Head["~Singleton"]["store"]>
							>;
						}>,
						MergedExtensions<Extensions, Head>,
						Tail,
						TAs
					>
				: ApplyUseMany<
						TName,
						Prettify<{
							decorator: Prettify<MergeStrict<Singleton["decorator"], Head["~Singleton"]["decorator"]>>;
							store: Prettify<MergeStrict<Singleton["store"], Head["~Singleton"]["store"]>>;
						}>,
						Ephemeral,
						Prettify<{
							decorator: Prettify<MergeStrict<Volatile["decorator"], Head["~Ephemeral"]["decorator"]>>;
							store: Prettify<MergeStrict<Volatile["store"], Head["~Ephemeral"]["store"]>>;
						}>,
						MergedExtensions<Extensions, Head>,
						Tail,
						TAs
					>
			: never
		: never
	: Aether<TName, Singleton, Ephemeral, Volatile, Extensions>;

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
	export: boolean;
	transitive?: boolean;
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
