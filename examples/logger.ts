import { Aether } from "../src/index.ts";

/**
 * Reusable logger plugin.
 * Demonstrates: factory decorators, global scope, onLoad hooks.
 */
export const logger = new Aether("logger")
	.decorate("logLevel", "info", { scope: "global" })
	.decorate(
		"log",
		(ctx) => ({
			info: (msg: string) => console.log(`[INFO] ${msg}`),
			warn: (msg: string) => console.warn(`[WARN] ${msg}`),
			error: (msg: string) => console.error(`[ERROR] ${msg}`),
			debug: (msg: string) => {
				if (ctx.logLevel === "debug") {
					console.log(`[DEBUG] ${msg}`);
				}
			},
		}),
		{ scope: "global" },
	)
	.onLoad(({ log }) => {
		log.info("Logger initialized");
	});
