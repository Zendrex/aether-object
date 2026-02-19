import type {
	ContextAppendType,
	LifeCycleType,
	ModuleDefinition,
	ProvideOptions,
	ProviderEntry,
	ProviderKind,
} from "./types";

const RESERVED_KEYS: Record<ProviderKind, string> = { decorator: "decorator", store: "store" };

const VALID_SCOPES = new Set<string>(["global", "local"]);
const VALID_KINDS = new Set<string>(["decorator", "store"]);
const VALID_MODES = new Set<string>(["append", "override"]);

/** Resolved provider configuration after argument parsing. */
export type ResolvedConfig = {
	kind: ProviderKind;
	scope: LifeCycleType;
	mode: ContextAppendType;
};

/** Parsed provider registration arguments. */
export type ParsedArgs = {
	entries: [string, unknown][];
	config: ResolvedConfig;
	isObjectForm: boolean;
};

/** Creates an empty module definition. */
export function emptyDef(): ModuleDefinition {
	return { providers: [], loadCallbacks: [], unloadCallbacks: [], uses: [] };
}

/** Creates a shallow copy of a module definition. */
export function copyDef(d: ModuleDefinition): ModuleDefinition {
	return {
		providers: [...d.providers],
		loadCallbacks: [...d.loadCallbacks],
		unloadCallbacks: [...d.unloadCallbacks],
		uses: [...d.uses],
	};
}

/**
 * Type guard that checks if an argument is a {@link ProvideOptions} object.
 * Uses explicit value checking against known valid values.
 */
export function isProvideOptions(arg: unknown): arg is ProvideOptions {
	if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
		return false;
	}
	// Type assertion safe: checked arg is a non-null, non-array object above
	const o = arg as Record<string, unknown>;
	return (
		(typeof o.scope === "string" && VALID_SCOPES.has(o.scope)) ||
		(typeof o.kind === "string" && VALID_KINDS.has(o.kind)) ||
		(typeof o.mode === "string" && VALID_MODES.has(o.mode))
	);
}

/** Parses provider registration arguments into a normalized form. */
export function parseArgs(args: unknown[], defaultKind: "provide" | ProviderKind): ParsedArgs {
	const last = args.at(-1);
	const hasOpts = isProvideOptions(last);

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

/**
 * Creates and pushes a provider entry onto a module definition.
 *
 * @param currentProviders - The existing providers array for duplicate checking
 * @param def - The target module definition to push onto
 * @param key - The provider key
 * @param value - The provider value (or factory function)
 * @param cfg - Resolved provider config (kind, scope, mode)
 * @param forceStatic - If true, never treat values as factory functions
 */
export function pushEntry(
	currentProviders: ProviderEntry[],
	def: ModuleDefinition,
	key: string,
	value: unknown,
	cfg: ResolvedConfig,
	forceStatic: boolean,
): void {
	if (key === RESERVED_KEYS[cfg.kind]) {
		throw new Error(`Cannot use reserved key "${key}" as ${cfg.kind} name`);
	}

	if (cfg.mode === "append" && currentProviders.some((p) => p.kind === cfg.kind && p.key === key)) {
		throw new Error(`${cfg.kind} "${key}" already defined. Use { mode: 'override' } to replace.`);
	}

	def.providers.push({
		kind: cfg.kind,
		key,
		value,
		scope: cfg.scope,
		isFactory: forceStatic ? false : typeof value === "function",
		mode: cfg.mode,
	});
}
