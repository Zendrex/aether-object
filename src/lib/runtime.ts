import type {
	ModuleDefinition,
	ModuleRuntimeContext,
	ProviderEntry,
	ProviderKind,
	ProviderOrigin,
	Scope,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Global scope symbol shared by all plugins using default scope. */
export const GLOBAL_SCOPE: symbol = Symbol.for("aether:use:global");

/** Local copy of provider kinds to avoid importing a runtime value from types. */
const KINDS: readonly ProviderKind[] = ["decorator", "store"] as const;

// ---------------------------------------------------------------------------
// Scope Resolution
// ---------------------------------------------------------------------------

/** Resolves a use() scope option to a scope ID for the module tree cache. */
export function useScopeId(pluginName: string, scope?: Scope): string | symbol {
	if (!scope || scope === "global") {
		return GLOBAL_SCOPE;
	}
	if (scope === "local") {
		return Symbol(`local:${pluginName}`);
	}
	return scope;
}

// ---------------------------------------------------------------------------
// Tree Building
// ---------------------------------------------------------------------------

/** Recursively builds the module runtime tree with WeakMap caching. */
export function buildTree(
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
		children: def.uses.map((u) => buildTree(u.name, u.def, cache, u.scopeId ?? GLOBAL_SCOPE)),
	};

	byScope.set(scopeId, ctx);
	return ctx;
}

// ---------------------------------------------------------------------------
// Module Initialization
// ---------------------------------------------------------------------------

/** Applies a single provider entry to the module's provider maps. */
function applyEntry(
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

	// "global" scope providers are exported and propagated
	const isExported = entry.scope === "global";
	if (isExported) {
		exported[kind][key] = resolved;
		propagated[kind][key] = resolved;
	}
	origins.set(originKey, { kind, key, moduleName, isExported });
}

/** Initializes a module runtime context by importing child providers and resolving own providers. */
export function initModule(ctx: ModuleRuntimeContext): void {
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
		for (const kind of KINDS) {
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

		// Propagate transitive providers from child
		if (edge.transitive !== false) {
			for (const kind of KINDS) {
				Object.assign(exportedProviders[kind], child.propagatedProviders[kind]);
				Object.assign(propagatedProviders[kind], child.propagatedProviders[kind]);
			}
		}
	}

	// Apply own providers
	for (const entry of def.providers) {
		applyEntry(entry, name, providers, exportedProviders, propagatedProviders, providerOrigins);
	}

	ctx.callbackCtx = { ...providers.decorator, decorator: providers.decorator, store: providers.store };
	ctx.initialized = true;
}

// ---------------------------------------------------------------------------
// Lifecycle Ordering
// ---------------------------------------------------------------------------

/** Returns modules in post-order DFS (children before parent). */
export function lifecycleOrder(root: ModuleRuntimeContext): ModuleRuntimeContext[] {
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
