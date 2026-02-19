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
