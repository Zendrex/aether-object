import { Aether } from "../src/index.ts";

export const logger = new Aether("logger")
	.decorate("logLevel", "info")
	.decorate(
		"log",
		(ctx) => ({
			info: (message: string) => console.log(`[${ctx.logLevel.toUpperCase()}] ${message}`),
			error: (message: string) => console.error(`[ERROR] ${message}`),
			debug: (message: string) => {
				if (ctx.logLevel === "debug") {
					console.log(`[DEBUG] ${message}`);
				}
			},
		}),
		{ scope: "global" },
	)
	.onLoad(({ log }) => {
		log.info("Logger initialized");
	});
