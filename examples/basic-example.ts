import { Aether } from "@/index";

import { logger } from "./logger";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CommandHandler = (args: string[]) => void | Promise<void>;

const commandPlugin = new Aether("commands")
	.use(logger)
	.state("commands", new Map<string, CommandHandler>(), { scope: "global" })
	.decorate(
		"executeCommand",
		({ store, log }) =>
			async (name: string, args: string[]) => {
				const handler = store.commands.get(name);
				if (!handler) {
					log.error(`[Commands] Unknown command: ${name}`);
					return;
				}
				await handler(args);
			},
		{ scope: "global" },
	)
	.decorate(
		"registerCommand",
		({ store, log }) =>
			async (name: string, handler: CommandHandler) => {
				await wait(1000);
				store.commands.set(name, handler);
				log.info(`Registered command: ${name}`);
			},
		{ scope: "global" },
	)
	.extend("registerCommand", function (name: string, handler: CommandHandler) {
		return this.onLoad(({ log, store }) => {
			store.commands.set(name, handler);
			log.info(`Registered command: ${name}`);
		});
	});

const app = new Aether("app")
	.use(logger)
	.use(commandPlugin) // Brings in .ext.command() extension method
	.ext.registerCommand("ping", () => console.log("Pong!"))
	.ext.registerCommand("status", () => console.log("All systems operational!"))
	.decorate("port", 3000, { scope: "global" })
	.decorate(
		"server",
		(ctx) => ({
			port: ctx.port,
			start: () => {
				ctx.log.info(`Server starting on port ${ctx.port}`);
				return `http://localhost:${ctx.port}`;
			},
			stop: () => {
				ctx.log.info("Server stopping");
			},
		}),
		{ scope: "global" },
	)
	.onLoad((ctx) => {
		ctx.log.info("Application loading...");
		const url = ctx.server.start();
		ctx.log.info(`Application ready at ${url}`);
	})
	.onUnload((ctx) => {
		ctx.log.info("Application shutting down...");
		ctx.server.stop();
	});

async function main() {
	await app.start();
	console.log(`App is running: ${app.isRunning}`);

	await app.context.executeCommand("ping", []);
	await app.context.executeCommand("status", []);

	await new Promise((resolve) => setTimeout(resolve, 500));

	await app.stop();
	console.log(`App is running: ${app.isRunning}`);
}

if (require.main === module) {
	main().catch(console.error);
}
