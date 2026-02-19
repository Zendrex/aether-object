import type { Aether } from "./aether";
import type {
	AnyAether,
	ContextAppendType,
	ExtensionBase,
	LifeCycleType,
	ProviderKind,
	ProviderLayer,
	UseOptions,
} from "./types";
import type { TypeError as AetherTypeError, MergeStrict, Prettify } from "./util-types";

type ReservedKeys = { decorator: "decorator"; store: "store" };

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

type UpdateLayer<
	TLayer extends ProviderLayer,
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

export type ApplyProvide<
	TName extends string,
	Global extends ProviderLayer,
	Local extends ProviderLayer,
	TScope extends LifeCycleType | undefined,
	TMode extends ContextAppendType | undefined,
	TKind extends ProviderKind,
	TAdd extends Record<string, unknown>,
	Extensions extends ExtensionBase = ExtensionBase,
> = (TScope extends "global" ? "global" : "local") extends "global"
	? Aether<
			TName,
			UpdateLayer<Global, TKind, TMode extends ContextAppendType ? TMode : "append", TAdd>,
			Local,
			Extensions
		>
	: Aether<
			TName,
			Global,
			UpdateLayer<Local, TKind, TMode extends ContextAppendType ? TMode : "append", TAdd>,
			Extensions
		>;

export type ApplyDecorate<
	TName extends string,
	Global extends ProviderLayer,
	Local extends ProviderLayer,
	TScope extends LifeCycleType | undefined,
	TMode extends ContextAppendType | undefined,
	TAdd extends Record<string, unknown>,
	Extensions extends ExtensionBase = ExtensionBase,
> = ApplyProvide<TName, Global, Local, TScope, TMode, "decorator", TAdd, Extensions>;

export type NormalizeUseAs<TOptions extends UseOptions | undefined> = TOptions extends { as: "scoped" }
	? "scoped"
	: "global";

/** Merge extensions without Prettify to reduce TS instantiation pressure. */
type MergedExtensions<Current extends ExtensionBase, Plugin extends AnyAether> = Current & Plugin["~Extensions"];

/**
 * Type application for composing a single plugin.
 *
 * - `as: "global"` (default): plugin's Global merges into caller's Global (transitive)
 * - `as: "scoped"`: plugin's Global merges into caller's Local (non-transitive)
 *
 * Plugin's Local providers are never visible to the caller.
 */
export type ApplyUse<
	TName extends string,
	Global extends ProviderLayer,
	Local extends ProviderLayer,
	Extensions extends ExtensionBase,
	TPlugin extends AnyAether,
	TAs extends "global" | "scoped",
> = TAs extends "scoped"
	? Aether<
			TName,
			Global,
			Prettify<{
				decorator: Prettify<MergeStrict<Local["decorator"], TPlugin["~Global"]["decorator"]>>;
				store: Prettify<MergeStrict<Local["store"], TPlugin["~Global"]["store"]>>;
			}>,
			MergedExtensions<Extensions, TPlugin>
		>
	: Aether<
			TName,
			Prettify<{
				decorator: Prettify<MergeStrict<Global["decorator"], TPlugin["~Global"]["decorator"]>>;
				store: Prettify<MergeStrict<Global["store"], TPlugin["~Global"]["store"]>>;
			}>,
			Local,
			MergedExtensions<Extensions, TPlugin>
		>;

/**
 * Recursive type application for composing an array of plugins.
 */
export type ApplyUseMany<
	TName extends string,
	Global extends ProviderLayer,
	Local extends ProviderLayer,
	Extensions extends ExtensionBase,
	TPlugins extends readonly AnyAether[],
	TAs extends "global" | "scoped",
> = TPlugins extends readonly [infer Head, ...infer Tail]
	? Head extends AnyAether
		? Tail extends readonly AnyAether[]
			? TAs extends "scoped"
				? ApplyUseMany<
						TName,
						Global,
						Prettify<{
							decorator: Prettify<MergeStrict<Local["decorator"], Head["~Global"]["decorator"]>>;
							store: Prettify<MergeStrict<Local["store"], Head["~Global"]["store"]>>;
						}>,
						MergedExtensions<Extensions, Head>,
						Tail,
						TAs
					>
				: ApplyUseMany<
						TName,
						Prettify<{
							decorator: Prettify<MergeStrict<Global["decorator"], Head["~Global"]["decorator"]>>;
							store: Prettify<MergeStrict<Global["store"], Head["~Global"]["store"]>>;
						}>,
						Local,
						MergedExtensions<Extensions, Head>,
						Tail,
						TAs
					>
			: never
		: never
	: Aether<TName, Global, Local, Extensions>;
