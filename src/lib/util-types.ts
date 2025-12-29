/** Strict empty object type with no properties. */
// biome-ignore lint/complexity/noBannedTypes: needed for type expansion
export type EmptyObject = {};

/** Flattens intersection types for better IntelliSense readability. */
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

/** Extracts keys that exist in both types. */
export type OverlapKeys<A, B> = keyof A & keyof B;

/** Returns true if types have no overlapping keys. */
export type HasNoOverlap<A, B> = OverlapKeys<A, B> extends never ? true : false;

/** Type-level error with a custom message. */
export type TypeError<Msg extends string> = { __error: Msg };

/** Merges two types, failing on key collisions. */
export type MergeStrict<A, B> =
	HasNoOverlap<A, B> extends true
		? Prettify<A & B>
		: TypeError<`Key collision: ${Extract<OverlapKeys<A, B>, string>} already exists. Use { as: 'override' } to replace.`>;

/** Merges two types, with B overwriting any conflicting keys from A. */
export type MergeLoose<A, B> = Prettify<Omit<A, keyof B> & B>;

// ---------------------------------------------------------------------------
// Elysia-style deep merge (Reconcile)
// ---------------------------------------------------------------------------

type IsNonFunctionObject<T> = T extends object ? (T extends (...args: unknown[]) => unknown ? false : true) : false;

/**
 * Deep merge two object types with optional override semantics.
 *
 * - **Override=false** (default): prefer A on collisions (structural merge)
 * - **Override=true**: prefer B on collisions (structural merge)
 *
 * This matches Elysia's `Reconcile` pattern and is capped at depth 16.
 */
export type Reconcile<A, B, Override extends boolean = false, Stack extends number[] = []> = Stack["length"] extends 16
	? Override extends true
		? B
		: A
	: A extends object
		? B extends object
			? Prettify<{
					[K in keyof A | keyof B]: K extends keyof B
						? K extends keyof A
							? IsNonFunctionObject<A[K]> extends true
								? IsNonFunctionObject<B[K]> extends true
									? Reconcile<A[K], B[K], Override, [0, ...Stack]>
									: Override extends true
										? B[K]
										: A[K]
								: Override extends true
									? B[K]
									: A[K]
							: B[K]
						: K extends keyof A
							? A[K]
							: never;
				}>
			: Override extends true
				? B
				: A
		: Override extends true
			? B
			: A;
